import { NextRequest, NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// In-memory rate-limit store (per-IP, resets when server restarts)
// For production at scale, swap this for a Redis-based counter via Upstash.
// ---------------------------------------------------------------------------
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

const RATE_LIMITS: { pattern: RegExp; limit: number; windowMs: number }[] = [
  // Payment endpoints — very tight: 10 requests per minute per IP
  { pattern: /^\/api\/payments\//, limit: 10, windowMs: 60_000 },
  // Auth-adjacent admin endpoints — 30 per minute
  { pattern: /^\/api\/admin\//, limit: 30, windowMs: 60_000 },
  // Canteen toggle — 20 per minute
  { pattern: /^\/api\/canteens\//, limit: 20, windowMs: 60_000 },
  // All other API routes — 120 per minute
  { pattern: /^\/api\//, limit: 120, windowMs: 60_000 },
];

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

function rateLimit(
  ip: string,
  key: string,
  limit: number,
  windowMs: number
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const mapKey = `${ip}:${key}`;
  const entry = rateLimitMap.get(mapKey);

  if (!entry || now > entry.resetAt) {
    const resetAt = now + windowMs;
    rateLimitMap.set(mapKey, { count: 1, resetAt });
    return { allowed: true, remaining: limit - 1, resetAt };
  }

  if (entry.count >= limit) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count++;
  return { allowed: true, remaining: limit - entry.count, resetAt: entry.resetAt };
}

// Prune stale entries every 5 minutes to prevent memory leaks
let lastPrune = Date.now();
function maybePrune() {
  const now = Date.now();
  if (now - lastPrune > 5 * 60_000) {
    for (const [k, v] of rateLimitMap.entries()) {
      if (now > v.resetAt) rateLimitMap.delete(k);
    }
    lastPrune = now;
  }
}

export function proxy(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;
  const ip = getClientIp(req);

  maybePrune();

  // ── Rate limiting ─────────────────────────────────────────────────────────
  const matched = RATE_LIMITS.find((r) => r.pattern.test(pathname));
  if (matched) {
    const result = rateLimit(ip, pathname, matched.limit, matched.windowMs);
    if (!result.allowed) {
      return new NextResponse(
        JSON.stringify({ error: "Too many requests. Please slow down." }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": String(Math.ceil((result.resetAt - Date.now()) / 1000)),
            "X-RateLimit-Limit":     String(matched.limit),
            "X-RateLimit-Remaining": "0",
          },
        }
      );
    }
  }

  // ── Prevent webhooks from being hit without the right method ─────────────
  if (pathname === "/api/payments/razorpay-webhook" && req.method !== "POST") {
    return new NextResponse(JSON.stringify({ error: "Method not allowed." }), {
      status: 405,
      headers: { "Content-Type": "application/json", Allow: "POST" },
    });
  }

  // ── Security response headers (belt-and-suspenders beyond next.config.ts) ─
  const res = NextResponse.next();
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "SAMEORIGIN");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

  return res;
}

export const config = {
  matcher: [
    // Apply to all API routes
    "/api/:path*",
    // Exclude Next internals and static files
    "/((?!_next/static|_next/image|favicon.ico|manifest.json|sw.js|icons/).*)",
  ],
};

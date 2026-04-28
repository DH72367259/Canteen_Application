/**
 * Lightweight in-memory rate limiter for Next.js API routes.
 *
 * Why in-memory?
 *   - Zero new dependencies, zero new infra cost.
 *   - Railway runs a single Node process per service, so a Map is sufficient
 *     for the current deployment topology. If we ever scale horizontally
 *     (multiple workers / pods), swap `bucket` for an Upstash Redis client
 *     without changing the call-sites.
 *
 * Algorithm: fixed-window counter with automatic eviction of stale keys
 * every 60 seconds, capped at 10 000 entries (memory bound).
 *
 * Usage:
 *   const rl = checkRateLimit(`orders:${userId}`, { limit: 10, windowMs: 60_000 });
 *   if (!rl.allowed) return Response.json({ error: rl.message }, { status: 429 });
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const MAX_BUCKETS = 10_000;
const bucket = new Map<string, Bucket>();
let lastSweep = Date.now();

function sweep(now: number) {
  // O(n) sweep; runs at most once per minute. At 10k keys this is <2 ms.
  for (const [k, v] of bucket) {
    if (v.resetAt <= now) bucket.delete(k);
  }
  // Hard cap — drop oldest if we somehow grow past the bound (DoS defence).
  if (bucket.size > MAX_BUCKETS) {
    const overflow = bucket.size - MAX_BUCKETS;
    let dropped = 0;
    for (const k of bucket.keys()) {
      bucket.delete(k);
      if (++dropped >= overflow) break;
    }
  }
  lastSweep = now;
}

export interface RateLimitOptions {
  /** Max requests allowed per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  message: string;
}

export function checkRateLimit(key: string, opts: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  if (now - lastSweep > 60_000) sweep(now);

  const existing = bucket.get(key);
  if (!existing || existing.resetAt <= now) {
    const fresh: Bucket = { count: 1, resetAt: now + opts.windowMs };
    bucket.set(key, fresh);
    return {
      allowed: true,
      remaining: opts.limit - 1,
      resetAt: fresh.resetAt,
      message: "",
    };
  }

  if (existing.count >= opts.limit) {
    const retryInSec = Math.ceil((existing.resetAt - now) / 1000);
    return {
      allowed: false,
      remaining: 0,
      resetAt: existing.resetAt,
      message: `Too many requests. Please retry in ${retryInSec}s.`,
    };
  }

  existing.count += 1;
  return {
    allowed: true,
    remaining: opts.limit - existing.count,
    resetAt: existing.resetAt,
    message: "",
  };
}

/** Extract a stable client key from a request — uid if authed, else IP. */
export function clientKey(req: Request, uid?: string | null): string {
  if (uid) return `u:${uid}`;
  const fwd = req.headers.get("x-forwarded-for") ?? "";
  const ip = fwd.split(",")[0].trim() || "unknown";
  return `ip:${ip}`;
}

import { NextRequest } from "next/server";
import { getRequestContext } from "@/lib/authServer";

const KEY_ID     = process.env.RAZORPAY_KEY_ID     || "";
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "";

// Razorpay payment IDs are alphanumeric and always start with "pay_"
const PAYMENT_ID_RE = /^pay_[A-Za-z0-9]{14,}$/;

// Allowed ADMIN-ONLY refund reasons — prevents unvalidated data reaching Razorpay notes
const ALLOWED_REASONS = ["payment_failed", "duplicate_payment", "order_cancelled", "customer_request", "test"] as const;

export async function POST(req: NextRequest) {
  // ── Authentication: only super_admin or co_admin may trigger refunds ──────
  const ctx = await getRequestContext(req);
  if (!ctx) return Response.json({ error: "Unauthorized." }, { status: 401 });
  if (ctx.role !== "super_admin" && ctx.role !== "co_admin") {
    return Response.json({ error: "Forbidden. Admin access required." }, { status: 403 });
  }

  if (!KEY_ID || !KEY_SECRET) {
    return Response.json({ error: "Razorpay is not configured on this server." }, { status: 503 });
  }

  let body: { paymentId?: string; amount?: unknown; reason?: string };
  try { body = await req.json() } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { paymentId, amount, reason } = body;

  // Validate paymentId format — prevents injecting arbitrary IDs / path traversal to Razorpay API
  if (!paymentId || !PAYMENT_ID_RE.test(paymentId)) {
    return Response.json({ error: "Invalid payment ID format." }, { status: 400 });
  }

  // Validate reason against allowlist — prevents uncontrolled data in Razorpay notes
  const sanitisedReason: string = ALLOWED_REASONS.includes(reason as typeof ALLOWED_REASONS[number])
    ? (reason as string)
    : "payment_failed";

  const rzpAuth = Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64");
  const refundBody: Record<string, unknown> = { speed: "optimum", notes: { reason: sanitisedReason } };
  if (amount) {
    const paise = Math.round(Number(amount) * 100);
    if (paise > 0) refundBody.amount = paise;
  }

  const resp = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}/refund`, {
    method:  "POST",
    headers: { Authorization: `Basic ${rzpAuth}`, "Content-Type": "application/json" },
    body:    JSON.stringify(refundBody),
  });
  const data = await resp.json();
  if (!resp.ok) {
    return Response.json({ error: data.error?.description ?? "Refund failed." }, { status: 502 });
  }
  return Response.json({
    success:  true,
    refundId: data.id,
    status:   data.status,
  });
}

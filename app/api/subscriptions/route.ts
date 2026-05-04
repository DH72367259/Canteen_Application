import { NextResponse } from "next/server";
import { getRequestContext } from "@/lib/authServer";
import { createAdminClient } from "@/lib/supabase-server";
import { withCache, invalidateCache, CACHE_KEYS, CACHE_TTL } from "@/lib/redis-client";

export const dynamic = "force-dynamic";

// GET /api/subscriptions — returns current user's Pro subscription status
export async function GET(request: Request) {
  const ctx = await getRequestContext(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const cacheKey = CACHE_KEYS.SUBSCRIPTION(ctx.uid);

  const data = await withCache(cacheKey, CACHE_TTL.SUBSCRIPTION, async () => {
    const sb = createAdminClient();
    const { data: subData, error } = await sb
      .from("noqx_pro_subscriptions")
      .select("id, status, started_at, expires_at, amount_paid")
      .eq("user_id", ctx.uid)
      .single();

    if (error && error.code !== "PGRST116") {
      throw new Error("Failed to fetch subscription");
    }

    return subData;
  });

  const isActive = data?.status === "active" && (
    !data.expires_at || new Date(data.expires_at) > new Date()
  );

  // Compute total savings since the subscription started:
  //   savings = (#orders since started_at) × ₹4 convenience fee waived per order.
  // Failure here must NOT fail the whole call — the savings card just shows ₹0.
  let savingsPaise = 0;
  let ordersSincePro = 0;
  let daysLeft = 0;
  if (isActive && data?.started_at) {
    const sb = createAdminClient();
    const { count } = await sb
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("user_id", ctx.uid)
      .gte("created_at", data.started_at);
    ordersSincePro = count ?? 0;
    savingsPaise = ordersSincePro * 400; // ₹4 = 400 paise
    if (data.expires_at) {
      const ms = new Date(data.expires_at).getTime() - Date.now();
      daysLeft = Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
    }
  }

  return NextResponse.json({
    subscription: data ?? null,
    isActive,
    savingsPaise,
    ordersSincePro,
    daysLeft,
  });
}

// POST /api/subscriptions — create or renew Pro subscription after payment
export async function POST(request: Request) {
  const ctx = await getRequestContext(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let paymentId: string | undefined;
  let amount = 49;
  try {
    const body = await request.json() as { paymentId?: string; amount?: number };
    paymentId = body.paymentId;
    if (body.amount && typeof body.amount === "number") amount = body.amount;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const supabase = createAdminClient();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("noqx_pro_subscriptions")
    .upsert(
      {
        user_id: ctx.uid,
        status: "active",
        started_at: new Date().toISOString(),
        expires_at: expiresAt,
        payment_id: paymentId ?? null,
        amount_paid: amount,
      },
      { onConflict: "user_id" }
    )
    .select("id, status, expires_at")
    .single();

  if (error) {
    return NextResponse.json({ error: "Failed to create subscription" }, { status: 500 });
  }

  // Invalidate subscription cache - user's subscription just changed
  await invalidateCache(CACHE_KEYS.SUBSCRIPTION(ctx.uid));

  return NextResponse.json({ subscription: data, isActive: true });
}

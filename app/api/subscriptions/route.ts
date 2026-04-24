import { NextResponse } from "next/server";
import { getRequestContext } from "@/lib/authServer";
import { createAdminClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

// GET /api/subscriptions — returns current user's Pro subscription status
export async function GET(request: Request) {
  const ctx = await getRequestContext(request);
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("noqx_pro_subscriptions")
    .select("id, status, started_at, expires_at, amount_paid")
    .eq("user_id", ctx.uid)
    .single();

  if (error && error.code !== "PGRST116") {
    return NextResponse.json({ error: "Failed to fetch subscription" }, { status: 500 });
  }

  const isActive = data?.status === "active" && (
    !data.expires_at || new Date(data.expires_at) > new Date()
  );

  return NextResponse.json({ subscription: data ?? null, isActive });
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

  return NextResponse.json({ subscription: data, isActive: true });
}

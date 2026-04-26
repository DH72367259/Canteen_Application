import { getRequestContext } from "@/lib/authServer";
import { createAdminClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const ctx = await getRequestContext(request);
  if (!ctx || ctx.role !== "super_admin") return Response.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json();
  const {
    canteen_id,
    amount_paid,
    payment_mode,
    transaction_ref,
    notes,
    period_start,
    period_end,
    gross_amount,
    platform_charge,
    gst_on_charge,
    net_payable,
  } = body;

  if (!canteen_id || !amount_paid || !payment_mode || !period_start || !period_end) {
    return Response.json({ error: "Missing required fields." }, { status: 400 });
  }
  if (Number(amount_paid) <= 0) return Response.json({ error: "Amount must be positive." }, { status: 400 });

  const VALID_MODES = ["upi", "bank_transfer", "cash", "other"];
  if (!VALID_MODES.includes(payment_mode))
    return Response.json({ error: "Invalid payment_mode." }, { status: 400 });

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("settlement_payments")
    .insert({
      canteen_id,
      period_start,
      period_end,
      gross_amount:    Number(gross_amount    ?? 0),
      platform_charge: Number(platform_charge ?? 0),
      gst_on_charge:   Number(gst_on_charge   ?? 0),
      net_payable:     Number(net_payable      ?? 0),
      amount_paid:     Number(amount_paid),
      payment_mode,
      transaction_ref: transaction_ref || null,
      notes:           notes           || null,
      paid_by:         ctx.uid,
    })
    .select("*")
    .single();

  if (error) return Response.json({ error: "Failed to record settlement payment." }, { status: 500 });
  return Response.json({ success: true, payment: data });
}

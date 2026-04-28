import { createAdminClient } from "./supabase-server";

export interface CommissionBreakdown {
  charge_pct: number;
  flat_charge: number;
  gst_pct: number;
  platform_earnings: number;   // raw % charge + flat (rupees, 2dp)
  gst_on_charge:     number;   // GST on platform_earnings (rupees, 2dp)
  net_to_canteen:    number;   // gross - (platform_earnings + gst_on_charge) (rupees, 2dp)
}

/** Round to 2 decimal places (avoids floating-point accumulation). */
function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Compute the per-transaction commission split.
 *
 * @param grossRupees the order total paid by the user (rupees)
 * @param charge_pct  percentage of gross the platform keeps (e.g. 2.0 = 2%)
 * @param flat_charge flat ₹ per order the platform keeps (e.g. 0.0 disables)
 * @param gst_pct     GST on the platform charge (e.g. 18.0 = 18%)
 */
export function computeCommission(
  grossRupees: number,
  charge_pct: number,
  flat_charge: number,
  gst_pct: number
): CommissionBreakdown {
  const platform_earnings = r2(grossRupees * (charge_pct / 100) + flat_charge);
  const gst_on_charge     = r2(platform_earnings * (gst_pct / 100));
  const net_to_canteen    = r2(Math.max(0, grossRupees - platform_earnings - gst_on_charge));
  return {
    charge_pct,
    flat_charge,
    gst_pct,
    platform_earnings,
    gst_on_charge,
    net_to_canteen,
  };
}

/** Fetches the active platform_charges row (single-row config table). */
export async function fetchActiveCharges(): Promise<{
  charge_pct: number;
  flat_charge: number;
  gst_pct: number;
}> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("platform_charges")
    .select("charge_pct, flat_charge, gst_pct")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    charge_pct:  Number(data?.charge_pct  ?? 2.0),
    flat_charge: Number(data?.flat_charge ?? 0.0),
    gst_pct:     Number(data?.gst_pct     ?? 18.0),
  };
}

export interface RecordPaymentArgs {
  razorpay_order_id:   string;
  razorpay_payment_id: string;
  razorpay_signature?: string | null;
  order_id?:   string | null;
  user_id?:    string | null;
  canteen_id?: string | null;
  amount_paise: number;
  status?: 'created' | 'captured' | 'failed' | 'refunded' | 'partial_refund';
  raw_event?: unknown;
}

/**
 * Idempotently record a Razorpay capture in the payments audit table with the
 * commission snapshot computed at this moment. Uses razorpay_payment_id as
 * the natural unique key — re-invoking with the same payment_id is a no-op
 * (so webhooks + the synchronous handler can both call this safely).
 */
export async function recordPaymentIdempotent(args: RecordPaymentArgs): Promise<{
  inserted: boolean;
  payment_id: string;
  breakdown: CommissionBreakdown;
}> {
  const supabase = createAdminClient();

  // Fast path: if a row already exists for this razorpay_payment_id, return it.
  const { data: existing } = await supabase
    .from("payments")
    .select("id, charge_pct_snapshot, flat_charge_snapshot, gst_pct_snapshot, platform_earnings, gst_on_charge, net_to_canteen")
    .eq("razorpay_payment_id", args.razorpay_payment_id)
    .maybeSingle();

  if (existing) {
    return {
      inserted: false,
      payment_id: existing.id,
      breakdown: {
        charge_pct:        Number(existing.charge_pct_snapshot),
        flat_charge:       Number(existing.flat_charge_snapshot),
        gst_pct:           Number(existing.gst_pct_snapshot),
        platform_earnings: Number(existing.platform_earnings),
        gst_on_charge:     Number(existing.gst_on_charge),
        net_to_canteen:    Number(existing.net_to_canteen),
      },
    };
  }

  const charges = await fetchActiveCharges();
  const grossRupees = args.amount_paise / 100;
  const breakdown = computeCommission(
    grossRupees,
    charges.charge_pct,
    charges.flat_charge,
    charges.gst_pct
  );

  const { data: inserted, error } = await supabase
    .from("payments")
    .insert({
      razorpay_order_id:    args.razorpay_order_id,
      razorpay_payment_id:  args.razorpay_payment_id,
      razorpay_signature:   args.razorpay_signature ?? null,
      order_id:             args.order_id   ?? null,
      user_id:              args.user_id    ?? null,
      canteen_id:           args.canteen_id ?? null,
      amount_paise:         args.amount_paise,
      currency:             'INR',
      charge_pct_snapshot:  breakdown.charge_pct,
      flat_charge_snapshot: breakdown.flat_charge,
      gst_pct_snapshot:     breakdown.gst_pct,
      platform_earnings:    breakdown.platform_earnings,
      gst_on_charge:        breakdown.gst_on_charge,
      net_to_canteen:       breakdown.net_to_canteen,
      status:               args.status ?? 'captured',
      raw_event:            args.raw_event ?? null,
    })
    .select("id")
    .single();

  if (error) {
    // Race condition: another concurrent call inserted first — re-fetch.
    const { data: retry } = await supabase
      .from("payments")
      .select("id")
      .eq("razorpay_payment_id", args.razorpay_payment_id)
      .maybeSingle();
    if (retry) return { inserted: false, payment_id: retry.id, breakdown };
    throw new Error(`Failed to record payment: ${error.message}`);
  }

  return { inserted: true, payment_id: inserted!.id, breakdown };
}

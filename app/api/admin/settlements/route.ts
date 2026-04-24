import { getRequestContext } from "@/lib/authServer";
import { createAdminClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const ctx = await getRequestContext(request);
  if (!ctx || ctx.role !== "super_admin") return Response.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const now = new Date();
  // Default period: last 30 days
  const defaultStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const defaultEnd   = now.toISOString().split("T")[0];
  const period_start = searchParams.get("period_start") || defaultStart;
  const period_end   = searchParams.get("period_end")   || defaultEnd;

  const supabase = createAdminClient();

  // Fetch all active canteens, orders in period, platform charges, payments made, bank details
  const [
    { data: canteens },
    { data: orders },
    { data: chargesRows },
    { data: payments },
    { data: bankDetails },
  ] = await Promise.all([
    supabase.from("canteens").select("id, name, city, college").eq("is_active", true),
    supabase
      .from("orders")
      .select("id, canteen_id, total_amount, status, created_at, payment_id")
      .gte("created_at", period_start + "T00:00:00Z")
      .lte("created_at", period_end + "T23:59:59Z"),
    supabase.from("platform_charges").select("*").limit(1),
    supabase
      .from("settlement_payments")
      .select("*")
      .gte("period_start", period_start)
      .lte("period_end",   period_end),
    supabase.from("canteen_bank_details").select("*"),
  ]);

  const charges    = chargesRows?.[0];
  const charge_pct  = Number(charges?.charge_pct  ?? 2.0);
  const flat_charge = Number(charges?.flat_charge ?? 0.0);
  const gst_pct     = Number(charges?.gst_pct     ?? 18.0);

  const summary = (canteens ?? []).map(canteen => {
    const co = (orders ?? []).filter(o => o.canteen_id === canteen.id);
    const completed = co.filter(o => o.status === "collected");
    const cancelled  = co.filter(o => o.status === "cancelled");
    const pending    = co.filter(o => !["collected","cancelled"].includes(o.status));

    const gross_amount = completed.reduce((s, o) => s + Number(o.total_amount), 0);
    const raw_charge   = gross_amount * (charge_pct / 100) + (flat_charge * completed.length);
    const gst_on_charge = raw_charge * (gst_pct / 100);
    const platform_charge_amount = raw_charge + gst_on_charge;
    const net_payable  = Math.max(0, gross_amount - platform_charge_amount);

    const cp         = (payments ?? []).filter(p => p.canteen_id === canteen.id);
    const amount_paid = cp.reduce((s, p) => s + Number(p.amount_paid), 0);
    const amount_remaining = Math.max(0, net_payable - amount_paid);

    const bank = (bankDetails ?? []).find(b => b.canteen_id === canteen.id) ?? null;

    return {
      canteen_id:              canteen.id,
      canteen_name:            canteen.name,
      city:                    canteen.city,
      college:                 canteen.college,
      total_orders:            co.length,
      completed_orders:        completed.length,
      cancelled_orders:        cancelled.length,
      pending_orders:          pending.length,
      gross_amount:            r2(gross_amount),
      charge_pct,
      flat_charge,
      platform_charge_amount:  r2(platform_charge_amount),
      gst_on_charge:           r2(gst_on_charge),
      net_payable:             r2(net_payable),
      amount_paid:             r2(amount_paid),
      amount_remaining:        r2(amount_remaining),
      payment_status:          amount_remaining <= 0 && net_payable > 0 ? "paid"
                                 : amount_paid > 0 ? "partial" : "pending",
      payments:                cp,
      bank_details:            bank,
    };
  });

  const ss = summary;
  return Response.json({
    period_start,
    period_end,
    platform_charges:  { charge_pct, flat_charge, gst_pct, id: charges?.id },
    summary_stats: {
      total_collected:         r2(ss.reduce((a, c) => a + c.gross_amount, 0)),
      total_platform_earnings: r2(ss.reduce((a, c) => a + c.platform_charge_amount, 0)),
      total_net_payable:       r2(ss.reduce((a, c) => a + c.net_payable, 0)),
      total_paid:              r2(ss.reduce((a, c) => a + c.amount_paid, 0)),
      total_remaining:         r2(ss.reduce((a, c) => a + c.amount_remaining, 0)),
      total_orders:            ss.reduce((a, c) => a + c.total_orders, 0),
      total_completed:         ss.reduce((a, c) => a + c.completed_orders, 0),
      total_cancelled:         ss.reduce((a, c) => a + c.cancelled_orders, 0),
    },
    canteens: summary,
  });
}

function r2(n: number) { return Math.round(n * 100) / 100; }

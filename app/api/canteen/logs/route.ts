/**
 * GET /api/canteen/logs
 *
 * Synthesised activity feed for a canteen. We don't have a dedicated
 * audit_log table yet, so logs are derived from orders + settlement_payments
 * + menu_items.updated_at. This gives the vendor visibility into recent
 * order lifecycle events, OTP collections, and payouts without requiring
 * any new write paths in the existing flows.
 */
import { getRequestContext } from "@/lib/authServer";
import { createAdminClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

type LogRow = { id: string; time: string; action: string; detail: string; actor: string; result: "ok" | "fail"; kind: "otp" | "menu" | "override" | "order" | "payout" };

export async function GET(request: Request) {
  const ctx = await getRequestContext(request);
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!["canteen_admin", "vendor", "super_admin", "co_admin", "worker"].includes(ctx.role ?? "")) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const supabase = createAdminClient();

  const { data: profile } = await supabase
    .from("profiles").select("canteen_id").eq("id", ctx.uid).single();
  const url = new URL(request.url);
  const canteenId = ctx.role === "super_admin"
    ? (url.searchParams.get("canteen_id") || profile?.canteen_id)
    : profile?.canteen_id;
  if (!canteenId) return Response.json({ error: "No canteen associated" }, { status: 404 });

  const sinceIso = new Date(Date.now() - 7 * 86_400_000).toISOString(); // last 7d

  // Defensive selects — `updated_at` exists in some envs but not others,
  // so we try-then-fallback rather than break the whole feed.
  async function loadOrders() {
    const full = await supabase
      .from("orders")
      .select("id, status, created_at, updated_at, total_amount, payment_id")
      .eq("canteen_id", canteenId)
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(200);
    if (!full.error) return full.data ?? [];
    const base = await supabase
      .from("orders")
      .select("id, status, created_at, total_amount, payment_id")
      .eq("canteen_id", canteenId)
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(200);
    return (base.data ?? []).map(r => ({ ...r, updated_at: r.created_at }));
  }
  async function loadMenu() {
    const full = await supabase
      .from("menu_items")
      .select("id, name, updated_at, created_at, is_available")
      .eq("canteen_id", canteenId)
      .gte("updated_at", sinceIso)
      .order("updated_at", { ascending: false })
      .limit(50);
    if (!full.error) return full.data ?? [];
    return [];
  }
  const [orders, payouts, menuRows] = await Promise.all([
    loadOrders(),
    supabase
      .from("settlement_payments")
      .select("id, amount_paid, payment_mode, transaction_ref, created_at")
      .eq("canteen_id", canteenId)
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(50)
      .then(r => r.data ?? []),
    loadMenu(),
  ]);

  const logs: LogRow[] = [];

  for (const o of orders) {
    const ref = String(o.id).slice(-8).toUpperCase();
    const amt = `\u20b9${Number(o.total_amount || 0).toFixed(0)}`;
    logs.push({
      id: `order-${o.id}-placed`,
      time: o.created_at,
      action: "Order placed",
      detail: `${ref} \u00b7 ${amt}${o.payment_id ? ` \u00b7 ${o.payment_id}` : ""}`,
      actor: "Student",
      result: "ok",
      kind: "order",
    });
    if (o.status === "collected") {
      logs.push({
        id: `order-${o.id}-collected`,
        time: o.updated_at ?? o.created_at,
        action: "OTP verified",
        detail: `${ref} collected`,
        actor: "Worker",
        result: "ok",
        kind: "otp",
      });
    } else if (o.status === "cancelled") {
      logs.push({
        id: `order-${o.id}-cancelled`,
        time: o.updated_at ?? o.created_at,
        action: "Order cancelled",
        detail: `${ref}`,
        actor: "Student",
        result: "fail",
        kind: "override",
      });
    } else if (o.status === "preparing") {
      logs.push({
        id: `order-${o.id}-accepted`,
        time: o.updated_at ?? o.created_at,
        action: "Order accepted",
        detail: `${ref} \u2192 preparing`,
        actor: "Vendor",
        result: "ok",
        kind: "order",
      });
    } else if (o.status === "ready_for_pickup" || o.status === "placed_in_bin") {
      logs.push({
        id: `order-${o.id}-ready`,
        time: o.updated_at ?? o.created_at,
        action: "Marked ready",
        detail: `${ref} \u2192 ready for pickup`,
        actor: "Vendor",
        result: "ok",
        kind: "order",
      });
    }
  }

  for (const p of payouts) {
    logs.push({
      id: `payout-${p.id}`,
      time: p.created_at,
      action: "Payout received",
      detail: `\u20b9${Number(p.amount_paid).toFixed(2)} via ${p.payment_mode || "bank"} \u00b7 ${p.transaction_ref || "no ref"}`,
      actor: "Admin",
      result: "ok",
      kind: "payout",
    });
  }

  for (const m of menuRows) {
    logs.push({
      id: `menu-${m.id}-${m.updated_at}`,
      time: m.updated_at ?? m.created_at,
      action: m.is_available ? "Menu item enabled" : "Menu item disabled",
      detail: m.name,
      actor: "Vendor",
      result: "ok",
      kind: "menu",
    });
  }

  logs.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
  return Response.json({ logs: logs.slice(0, 200) });
}

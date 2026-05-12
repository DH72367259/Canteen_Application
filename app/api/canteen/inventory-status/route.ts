/**
 * GET /api/canteen/inventory-status
 *
 * Returns per-item consumption data for today so the vendor dashboard can
 * show consumed vs. remaining and trigger low-stock alerts.
 *
 * Response shape:
 *   { items: InventoryStatusItem[] }
 *
 * Each item includes:
 *   id, name, availability_type, total_per_day, quantity_per_slot,
 *   day_consumed, day_remaining, slot_consumed, slot_remaining,
 *   is_sold_out, is_exhausted (day cap fully consumed)
 */
import { getRequestContext } from "@/lib/authServer";
import { createAdminClient } from "@/lib/supabase-server";
import { getMenuItemUsageForToday } from "@/lib/menuItemCapacity";

export const dynamic = "force-dynamic";

function notifySessionExpired() {
  // Server-side stub — client-side callers emit the window event themselves
}
void notifySessionExpired;

export async function GET(request: Request) {
  const ctx = await getRequestContext(request);
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const allowed = ["canteen_admin", "vendor", "super_admin", "co_admin"];
  if (!allowed.includes(ctx.role ?? ""))
    return Response.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const supabase = createAdminClient();

  // Resolve canteen_id
  let canteenId = ctx.canteenId ?? null;
  if ((ctx.role === "super_admin" || ctx.role === "co_admin") && searchParams.get("canteen_id")) {
    canteenId = searchParams.get("canteen_id");
  }
  if (!canteenId) {
    // Try fetching from profiles
    const { data: profile } = await supabase
      .from("profiles")
      .select("canteen_id")
      .eq("id", ctx.uid)
      .single();
    canteenId = profile?.canteen_id ?? null;
  }
  if (!canteenId) return Response.json({ error: "No canteen associated with this account." }, { status: 404 });

  // Load all menu items for this canteen
  const { data: menuRows, error: menuErr } = await supabase
    .from("menu_items")
    .select("id, name, availability_type, quantity_per_slot, total_per_day, is_sold_out, is_available")
    .eq("canteen_id", canteenId)
    .order("name", { ascending: true });

  if (menuErr) return Response.json({ error: menuErr.message }, { status: 500 });
  const rows = menuRows ?? [];

  // Get today's usage
  const usage = await getMenuItemUsageForToday(supabase, {
    canteenId,
    menuItemIds: rows.map((r) => r.id as string),
  });

  const items = rows.map((r) => {
    const dayConsumed = usage.dayUsed.get(r.id as string) ?? 0;
    const slotConsumed = usage.slotUsed.get(r.id as string) ?? 0;
    const dayCap = Number(r.total_per_day ?? 0);
    const slotCap = Number(r.quantity_per_slot ?? 0);
    const dayRemaining = dayCap > 0 ? Math.max(0, dayCap - dayConsumed) : null;
    const slotRemaining = slotCap > 0 ? Math.max(0, slotCap - slotConsumed) : null;
    const isExhausted =
      (dayCap > 0 && dayConsumed >= dayCap) ||
      (slotCap > 0 && slotConsumed >= slotCap);

    return {
      id: r.id,
      name: r.name,
      availability_type: r.availability_type ?? "slot_based",
      total_per_day: dayCap > 0 ? dayCap : null,
      quantity_per_slot: slotCap > 0 ? slotCap : null,
      day_consumed: dayConsumed,
      day_remaining: dayRemaining,
      slot_consumed: slotConsumed,
      slot_remaining: slotRemaining,
      is_sold_out: !!r.is_sold_out,
      is_available: !!r.is_available,
      is_exhausted: isExhausted,
    };
  });

  return Response.json({ items });
}

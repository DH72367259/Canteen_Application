/**
 * Deferred bin assignment — bins are NOT claimed at order placement.
 * Instead, this function is called on every vendor poll (live-orders,
 * /api/orders GET) and batch-assigns physical bins to orders whose
 * slot start time has arrived. The same 60 physical bins then recycle
 * across every 15-minute slot throughout the day.
 *
 * Late-pickup bins stay occupied until the student collects. If late
 * pickups exhaust the free pool, orders for the next slot wait until
 * at least one bin is freed — the vendor can use Release All to unblock.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { assignBins, type CartLine } from "@/lib/slotCapacity";

function nowISTMinutes(): number {
  const now = new Date();
  const istMs = now.getTime() + 5.5 * 60 * 60 * 1000;
  const ist = new Date(istMs);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

// Parse slot label like "9:15 PM - 9:30 PM" → slot start in minutes (1275)
function parseSlotStartMinutes(slotLabel: string): number | null {
  const m = slotLabel.trim().match(/^(\d+):(\d+)\s*(AM|PM)/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const isPm = m[3].toUpperCase() === "PM";
  if (isPm && h !== 12) h += 12;
  if (!isPm && h === 12) h = 0;
  return h * 60 + min;
}

export async function assignDeferredBins(
  supabase: SupabaseClient,
  canteenId: string
): Promise<{ assigned: number }> {
  const nowMin = nowISTMinutes();

  // Find active orders for this canteen that still have no physical bin.
  // Try with bin_count first; fall back without it if the column doesn't exist.
  type UnassignedRow = { id: string; slot_label: unknown; bin_count: unknown; status: string };
  let unassigned: UnassignedRow[] = [];
  const unassignedProjs = ["id, slot_label, bin_count, status", "id, slot_label, status"];
  for (const proj of unassignedProjs) {
    const r = await supabase
      .from("orders")
      .select(proj)
      .eq("canteen_id", canteenId)
      .is("bin_id", null)
      .in("status", ["placed", "confirmed", "preparing"])
      .not("slot_label", "is", null)
      .order("created_at", { ascending: true });
    if (!r.error) { unassigned = (r.data ?? []) as unknown as UnassignedRow[]; break; }
    const isSchemaErr = /column .* does not exist/i.test(r.error.message) || r.error.code === "42703";
    if (!isSchemaErr) break;
  }

  if (!unassigned.length) return { assigned: 0 };

  // Only assign bins for slots whose start time has passed.
  // Sort by slot start time ascending so the most overdue slot always
  // gets bins first — prevents a later-created order for an earlier slot
  // from being skipped when a race puts an older order first in the queue.
  const readyOrders = unassigned
    .filter((o) => {
      const startMin = parseSlotStartMinutes(String(o.slot_label ?? ""));
      return startMin !== null && nowMin >= startMin;
    })
    .sort((a, b) => {
      const aMin = parseSlotStartMinutes(String(a.slot_label ?? "")) ?? 9999;
      const bMin = parseSlotStartMinutes(String(b.slot_label ?? "")) ?? 9999;
      return aMin - bMin; // earliest slot first
    });

  if (!readyOrders.length) return { assigned: 0 };

  const totalNeeded = readyOrders.reduce((sum, o) => sum + (Number(o.bin_count) || 1), 0);

  // Fetch available bins once, pick sequentially per order
  const { data: freeBins } = await supabase
    .from("bins")
    .select("id, bin_code, color")
    .eq("canteen_id", canteenId)
    .eq("is_occupied", false)
    .eq("status", "empty")
    .order("bin_code", { ascending: true })
    .limit(totalNeeded + 10);

  type FreeBin = { id: string; bin_code: string; color: string | null };
  let pool = (freeBins ?? []) as FreeBin[];
  let assigned = 0;
  const now = new Date().toISOString();

  for (const order of readyOrders) {
    const needed = Number(order.bin_count) || 1;
    if (pool.length < needed) continue; // skip this order, try the next one

    const pick = pool.slice(0, needed);
    pool = pool.slice(needed);
    const firstBin = pick[0];
    const slotLabel = String(order.slot_label ?? "");
    const pickIds = pick.map((b) => b.id);

    // Atomic claim: UPDATE WHERE is_occupied=false prevents races
    const { data: claimed } = await supabase
      .from("bins")
      .update({
        is_occupied: true,
        order_id: order.id,
        assigned_order_id: order.id,
        status: "reserved",
        slot_label: slotLabel,
        updated_at: now,
      })
      .eq("canteen_id", canteenId)
      .eq("is_occupied", false)
      .in("id", pickIds)
      .select("id");

    const claimedCount = (claimed ?? []).length;
    if (claimedCount < needed) {
      // Race condition — rollback any partial claims
      if (claimedCount > 0) {
        const ids = (claimed as { id: string }[]).map((r) => r.id);
        await supabase
          .from("bins")
          .update({ is_occupied: false, order_id: null, assigned_order_id: null, status: "empty", updated_at: now })
          .in("id", ids);
      }
      continue;
    }

    // Stamp the order with its bin.
    // Try full update (bin_id + bin_label + bin_color); if bin_label/bin_color
    // columns don't exist in this DB (pre-phase15), retry with just bin_id.
    let orderErr: { message: string; code?: string } | null = null;
    for (const payload of [
      { bin_id: firstBin.id, bin_label: firstBin.bin_code, bin_color: firstBin.color ?? "blue" },
      { bin_id: firstBin.id },
    ] as const) {
      const r = await supabase
        .from("orders")
        .update(payload)
        .eq("id", order.id)
        .is("bin_id", null); // guard: skip if already assigned by a concurrent poll
      if (!r.error) { orderErr = null; break; }
      orderErr = r.error as { message: string; code?: string };
      const isSchemaErr = /column .* does not exist/i.test(r.error.message) || r.error.code === "42703";
      if (!isSchemaErr) break;
    }

    if (orderErr) {
      // Rollback bin claims
      await supabase
        .from("bins")
        .update({ is_occupied: false, order_id: null, assigned_order_id: null, status: "empty", updated_at: now })
        .in("id", pickIds);
      continue;
    }

    // Populate order_bins with per-bin item assignments so the worker app
    // can display which items go into which physical bin.
    type OIRow = {
      menu_item_id: string;
      quantity: number;
      menu_items: { name: string; is_meal: boolean | null } | null;
    };
    const { data: oiRows } = await supabase
      .from("order_items")
      .select("menu_item_id, quantity, menu_items(name, is_meal)")
      .eq("order_id", order.id);

    const cartLines: CartLine[] = ((oiRows ?? []) as unknown as OIRow[]).map((oi) => ({
      itemId:   String(oi.menu_item_id),
      name:     String(oi.menu_items?.name ?? oi.menu_item_id),
      quantity: Number(oi.quantity ?? 1),
      // null means vendor didn't tag it — default to meal (1 per bin) so workers
      // always get a dedicated bin per item rather than 5-per-bin snack packing
      isMeal:   oi.menu_items?.is_meal !== false,
    }));

    const binPlan = assignBins(cartLines);

    const orderBinsRows = pick.map((physicalBin, idx) => {
      const slot = binPlan.bins[idx];
      const items = [
        ...(slot?.meals  ?? []).map((m) => ({ name: m.name, quantity: m.quantity, isMeal: true })),
        ...(slot?.snacks ?? []).map((s) => ({ name: s.name, quantity: s.quantity, isMeal: false })),
      ];
      return {
        order_id:  order.id,
        bin_id:    physicalBin.id,
        bin_index: idx + 1,
        bin_code:  physicalBin.bin_code,
        bin_color: physicalBin.color ?? "blue",
        items,
      };
    });

    await supabase
      .from("order_bins")
      .upsert(orderBinsRows, { onConflict: "order_id,bin_index" });

    assigned++;
  }

  // Backfill: orders that already have a bin_id (set by old instant-assign logic)
  // but were never written to order_bins. Create one-bin rows for them so the
  // worker app can display items instead of showing "Bin Unassigned".
  const { data: needsBackfill } = await supabase
    .from("orders")
    .select("id, bin_id, bin_label, bin_color, slot_label")
    .eq("canteen_id", canteenId)
    .not("bin_id", "is", null)
    .in("status", ["confirmed", "preparing", "ready_for_placement", "placed_in_bin"]);

  if (needsBackfill?.length) {
    for (const ord of needsBackfill) {
      const { count } = await supabase
        .from("order_bins")
        .select("id", { count: "exact", head: true })
        .eq("order_id", ord.id);
      if ((count ?? 0) > 0) continue;

      type OIRow2 = { menu_item_id: string; quantity: number; menu_items: { name: string; is_meal: boolean | null } | null };
      const { data: oiRows2 } = await supabase
        .from("order_items")
        .select("menu_item_id, quantity, menu_items(name, is_meal)")
        .eq("order_id", ord.id);

      const cartLines2: CartLine[] = ((oiRows2 ?? []) as unknown as OIRow2[]).map((oi) => ({
        itemId:   String(oi.menu_item_id),
        name:     String(oi.menu_items?.name ?? oi.menu_item_id),
        quantity: Number(oi.quantity ?? 1),
        isMeal:   oi.menu_items?.is_meal !== false,
      }));
      const plan2 = assignBins(cartLines2);

      const { data: physBins } = await supabase
        .from("bins")
        .select("id, bin_code, color")
        .eq("canteen_id", canteenId)
        .eq("is_occupied", true)
        .or(`order_id.eq.${ord.id},assigned_order_id.eq.${ord.id}`);

      const physArr = physBins ?? [];
      const rows2 = plan2.bins.map((slot, idx) => {
        const phys = physArr[idx];
        const items = [
          ...(slot?.meals  ?? []).map((m) => ({ name: m.name, quantity: m.quantity, isMeal: true  })),
          ...(slot?.snacks ?? []).map((s) => ({ name: s.name, quantity: s.quantity, isMeal: false })),
        ];
        return {
          order_id:  ord.id,
          bin_id:    phys?.id ?? ord.bin_id,
          bin_index: idx + 1,
          bin_code:  phys?.bin_code ?? String(ord.bin_label ?? ""),
          bin_color: phys?.color ?? String(ord.bin_color ?? "blue"),
          items,
        };
      });

      if (rows2.length > 0) {
        await supabase.from("order_bins").upsert(rows2, { onConflict: "order_id,bin_index" });
      }
    }
  }

  return { assigned };
}

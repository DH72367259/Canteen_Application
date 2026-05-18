import { createAdminClient } from "@/lib/supabase-server";
import { generateTimeSlots, computeSlotCapacity, assignBins, type CartLine } from "@/lib/slotCapacity";
import { ensureSlotControl } from "@/lib/slotControlEnsure";

export const dynamic = "force-dynamic";

function pad(n: number) {
  return n < 10 ? `0${n}` : `${n}`;
}

function formatLabel(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(":");
  let h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  const period = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${pad(m)} ${period}`;
}

function rangeLabel(start: string, end: string) {
  return `${formatLabel(start)} - ${formatLabel(end)}`;
}

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((v) => parseInt(v, 10));
  return h * 60 + m;
}

function nowISTMinutes(): { minutes: number; dateStr: string } {
  const now = new Date();
  // IST = UTC + 5:30
  const istMs = now.getTime() + 5.5 * 60 * 60 * 1000;
  const ist = new Date(istMs);
  const minutes = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const dateStr = `${ist.getUTCFullYear()}-${pad(ist.getUTCMonth() + 1)}-${pad(ist.getUTCDate())}`;
  return { minutes, dateStr };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const canteenId = url.searchParams.get("canteenId");
    if (!canteenId) {
      return Response.json({ error: "canteenId required" }, { status: 400 });
    }

    const supabase = createAdminClient();

  // Try slot_control (Phase-1 source of truth). Lazy-create defaults for
  // older canteens so students never see "no slots" on a live canteen.
  const control = await ensureSlotControl(supabase, canteenId);

  type Slot = {
    id: string;
    label: string;
    available: boolean;
    is_full: boolean;
    capacity: number;
    bins_used?: number;
    bins_total?: number;
  };

  const result: Slot[] = [];

  if (control) {
    const duration = control.slot_duration_mins || 15;
    const cap = computeSlotCapacity(control.max_bins || 60).maxOrdersPerSlot;

    const windows: Array<[string | null, string | null]> = [
      [control.morning_start, control.morning_end],
      [control.afternoon_start, control.afternoon_end],
      [control.evening_start, control.evening_end],
    ];

    const { minutes: nowMin, dateStr } = nowISTMinutes();
    // Per revised workflow Step 7: a slot disappears from the user-facing
    // selector once the prep batch starts (slot_start - slot_duration). Using
    // `duration` here means a 15-min slot (1:00–1:15) is removed at 12:45 —
    // exactly when the canteen begins preparing it. This also matches the
    // "order before 12:45 for 1:00 slot" rule on the Vendor flow doc.
    const cutoff = nowMin + duration;
    // Client request 2026-04-30: cap visible slots to the next ~60 minutes
    // so the picker shows e.g. 8:10 → 9:10 only, not the whole day. Keeps
    // the UI scannable on phones and matches user mental model (pick within
    // the next hour). 60 + duration accounts for slots that extend just
    // past the hour (e.g. 8:45–9:00 still shows when nowMin=8:00).
    const windowEndMin = nowMin + 60 + duration;

    // Fetch today's order counts grouped by slot label. Resilient against
    // prod schema drift: prod may have `slot_label` (new) or `pickup_slot`
    // (legacy) — try the new name first and fall back. Without the fallback
    // a single missing column would throw and bubble up as a 500, leaving
    // the user with "Loading slots…" forever. Wrapped in try/catch because
    // PostgREST will surface unknown columns as a thrown error inside the
    // supabase-js client in some build modes.
    type OrderRow = { slot?: string | null; status: string };
    let orderRows: OrderRow[] = [];
    for (const slotCol of ["slot_label", "pickup_slot"] as const) {
      try {
        const q = await supabase
          .from("orders")
          .select(`${slotCol}, status`)
          .eq("canteen_id", canteenId)
          .gte("created_at", `${dateStr}T00:00:00.000Z`)
          .lte("created_at", `${dateStr}T23:59:59.999Z`);
        if (!q.error) {
          orderRows = (q.data || []).map((r) => {
            const obj = r as Record<string, unknown>;
            return { slot: (obj[slotCol] as string | null) ?? null, status: String(obj.status ?? "") };
          });
          break;
        }
      } catch (innerE) {
        // Try the next column name; ignore individual probe failures.
        console.warn("[/api/slots] orders probe failed for", slotCol, innerE);
      }
    }

    const counts = new Map<string, number>();
    for (const o of orderRows) {
      if (!o.slot) continue;
      if (o.status === "cancelled" || o.status === "refunded") continue;
      counts.set(o.slot, (counts.get(o.slot) || 0) + 1);
    }

    // ── BIN-LEVEL capacity (more accurate than order-count) ───────────────
    // Capacity is whatever the canteen manager set as max_bins in
    // Slot & Bin Control — anywhere from 1 to 72 (we do NOT assume 60).
    // A single order can occupy multiple bins, so counting orders alone
    // under-reports usage. Mirror the cart/check logic: fetch all
    // order_items for today's orders, group by order, run assignBins per
    // order, sum bins per slot label.
    const mealsPerBin  = Number(control.meals_per_bin)  || 1;
    const snacksPerBin = Number(control.snacks_per_bin) || 3;
    const binsBySlot = new Map<string, number>();

    const activeOrderIds = orderRows
      .filter((o) => o.slot && o.status !== "cancelled" && o.status !== "refunded")
      .map((o) => o.slot as string);

    if (activeOrderIds.length > 0) {
      // Need order IDs to look up items — re-fetch with id column included.
      type IdRow = { id: string; slot: string | null };
      let idRows: IdRow[] = [];
      for (const slotCol of ["slot_label", "pickup_slot"] as const) {
        try {
          const q = await supabase
            .from("orders")
            .select(`id, ${slotCol}`)
            .eq("canteen_id", canteenId)
            .gte("created_at", `${dateStr}T00:00:00.000Z`)
            .lte("created_at", `${dateStr}T23:59:59.999Z`)
            .not("status", "in", '("cancelled")');
          if (!q.error) {
            idRows = (q.data || []).map((r) => {
              const obj = r as Record<string, unknown>;
              return { id: String(obj.id), slot: (obj[slotCol] as string | null) ?? null };
            });
            break;
          }
        } catch { /* try next column name */ }
      }

      const slotByOrderId = new Map(idRows.map((r) => [r.id, r.slot] as const));
      const orderIds = idRows.map((r) => r.id);

      if (orderIds.length > 0) {
        type ItemRow = { order_id: string; menu_item_id: string; quantity: number; cancelled_quantity?: number | null };
        let itemRows: ItemRow[] = [];
        for (const cols of ["order_id, menu_item_id, quantity, cancelled_quantity", "order_id, menu_item_id, quantity"]) {
          const { data, error } = await supabase.from("order_items").select(cols).in("order_id", orderIds);
          if (!error) { itemRows = (data ?? []) as unknown as ItemRow[]; break; }
        }
        const menuIds = [...new Set(itemRows.map((r) => r.menu_item_id))];
        const isMealMap = new Map<string, boolean>();
        if (menuIds.length > 0) {
          const { data: mealRows } = await supabase.from("menu_items").select("id, is_meal").in("id", menuIds);
          for (const m of (mealRows ?? []) as Array<{ id: string; is_meal: boolean | null }>) {
            isMealMap.set(String(m.id), !!m.is_meal);
          }
        }
        // Group items by order
        const linesPerOrder = new Map<string, CartLine[]>();
        for (const r of itemRows) {
          const net = Math.max(0, Number(r.quantity ?? 0) - Number(r.cancelled_quantity ?? 0));
          if (net <= 0) continue;
          const list = linesPerOrder.get(r.order_id) ?? [];
          list.push({
            itemId: String(r.menu_item_id),
            name: "",
            quantity: net,
            isMeal: isMealMap.get(String(r.menu_item_id)) ?? false,
          });
          linesPerOrder.set(r.order_id, list);
        }
        // Sum bins per slot
        for (const [orderId, lines] of linesPerOrder.entries()) {
          const slotLabel = slotByOrderId.get(orderId);
          if (!slotLabel) continue;
          const bins = assignBins(lines, mealsPerBin, snacksPerBin, 0).bins.length;
          binsBySlot.set(slotLabel, (binsBySlot.get(slotLabel) ?? 0) + bins);
        }
      }
    }

    // max_bins is the canteen manager's configured value (1..72).
    // The || fallback only fires when control.max_bins is null/0, which
    // ensureSlotControl above guarantees never happens — defensive only.
    const maxBins = Number(control.max_bins) || 60;

    for (const [winStart, winEnd] of windows) {
      if (!winStart || !winEnd) continue;
      const pieces = generateTimeSlots(winStart, winEnd, duration);
      for (const p of pieces) {
        const startMin = hhmmToMinutes(p.start);
        if (startMin < cutoff) continue;
        if (startMin > windowEndMin) continue;
        const label = rangeLabel(p.start, p.end);
        const id = `${winStart}-${p.start}`;
        const orderCount = counts.get(label) || 0;
        const binsUsed = binsBySlot.get(label) || 0;
        // A slot is full when EITHER the bin pool is exhausted (e.g. 60/60)
        // OR the order-cap is hit (whichever happens first). This is the
        // 60-bin hard stop the workflow requires.
        const isFull = binsUsed >= maxBins || orderCount >= cap;
        result.push({
          id,
          label,
          available: !isFull,
          is_full: isFull,
          capacity: cap,
          bins_used: binsUsed,
          bins_total: maxBins,
        });
      }
    }

    if (result.length > 0) {
      return Response.json({ slots: result });
    }
  }

  // Legacy fallback
  const { data: legacy } = await supabase
    .from("time_slots")
    .select("id, label, is_full")
    .eq("canteen_id", canteenId)
    .order("label", { ascending: true });

  for (const s of legacy || []) {
    result.push({
      id: String(s.id),
      label: s.label,
      available: !s.is_full,
      is_full: !!s.is_full,
      capacity: 0,
    });
  }

  return Response.json({ slots: result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Internal error";
    console.error("[/api/slots] failed:", msg, e);
    return Response.json({ error: msg, slots: [] }, { status: 500 });
  }
}

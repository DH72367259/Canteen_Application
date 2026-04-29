import { createAdminClient } from "@/lib/supabase-server";
import { generateTimeSlots, computeSlotCapacity } from "@/lib/slotCapacity";
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

    for (const [winStart, winEnd] of windows) {
      if (!winStart || !winEnd) continue;
      const pieces = generateTimeSlots(winStart, winEnd, duration);
      for (const p of pieces) {
        const startMin = hhmmToMinutes(p.start);
        if (startMin < cutoff) continue;
        const label = rangeLabel(p.start, p.end);
        const id = `${winStart}-${p.start}`;
        const booked = counts.get(label) || 0;
        const isFull = booked >= cap;
        result.push({
          id,
          label,
          available: !isFull,
          is_full: isFull,
          capacity: cap,
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

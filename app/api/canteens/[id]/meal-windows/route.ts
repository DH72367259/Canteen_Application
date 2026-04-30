import { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase-server";

// Returns the canteen's actual meal windows derived from slot_control. The
// student menu uses these to hide items whose meal-type doesn't match the
// current time. Dynamic — every canteen admin can set their own breakfast/
// lunch/dinner times via Slot and Bin Control, and this endpoint reflects
// those changes immediately. Snacks defaults to the afternoon-end → evening-
// start gap; if there's no gap, snacks is null.
//
// Public (no auth) — student app needs it before login on landing flows.
export const dynamic = "force-dynamic";

interface SlotControlRow {
  morning_start:   string; morning_end:   string;
  afternoon_start: string; afternoon_end: string;
  evening_start:   string; evening_end:   string;
}

function hhmm(s: string | null | undefined): string | null {
  if (!s) return null;
  return s.length >= 5 ? s.slice(0, 5) : s;
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id: canteenId } = await ctx.params;
  if (!canteenId) return Response.json({ error: "canteenId required" }, { status: 400 });

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("slot_control")
    .select("morning_start, morning_end, afternoon_start, afternoon_end, evening_start, evening_end")
    .eq("canteen_id", canteenId)
    .maybeSingle<SlotControlRow>();

  if (error) {
    return Response.json({ error: "Failed to load meal windows" }, { status: 500 });
  }

  // No row yet → use the same defaults as slot-control upsert.
  const row: SlotControlRow = data ?? {
    morning_start:   "07:00:00", morning_end:   "11:00:00",
    afternoon_start: "11:30:00", afternoon_end: "15:00:00",
    evening_start:   "18:00:00", evening_end:   "21:30:00",
  };

  // Snacks = gap between afternoon_end and evening_start, only if positive.
  const aEnd = hhmm(row.afternoon_end)!;
  const eStart = hhmm(row.evening_start)!;
  const snacks = aEnd && eStart && aEnd < eStart
    ? { start: aEnd, end: eStart }
    : null;

  const windows = {
    breakfast: { start: hhmm(row.morning_start)!,   end: hhmm(row.morning_end)! },
    lunch:     { start: hhmm(row.afternoon_start)!, end: hhmm(row.afternoon_end)! },
    snacks:    snacks,
    dinner:    { start: hhmm(row.evening_start)!,   end: hhmm(row.evening_end)! },
  };

  return Response.json({ windows });
}

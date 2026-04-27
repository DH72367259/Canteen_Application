import { NextResponse } from "next/server";
import { getRequestContext } from "@/lib/authServer";
import { createAdminClient } from "@/lib/supabase-server";
import { computeSlotCapacity, generateTimeSlots } from "@/lib/slotCapacity";

export const dynamic = "force-dynamic";

type SlotControlRow = {
  canteen_id: string;
  max_bins: number;
  slot_duration_mins: number;
  morning_start: string; morning_end: string;
  afternoon_start: string; afternoon_end: string;
  evening_start: string; evening_end: string;
  grace_period_mins: number;
  extra_bin_fee_paise: number;
  meals_per_bin: number;
  snacks_per_bin: number;
  max_orders_per_slot: number;
  batched_prepared_cap: number;
  made_to_order_cap: number;
};

function canEdit(role: string): boolean {
  return role === "canteen_admin" || role === "vendor" ||
         role === "co_admin" || role === "super_admin";
}

function resolveCanteenId(request: Request, auth: { role: string; canteenId?: string }): string | null {
  const url = new URL(request.url);
  const queryId = url.searchParams.get("canteenId");
  if (auth.role === "super_admin" || auth.role === "co_admin") {
    return queryId ?? auth.canteenId ?? null;
  }
  // Canteen-scoped roles always operate on their own canteen
  return auth.canteenId ?? null;
}

export async function GET(request: Request) {
  const auth = await getRequestContext(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (!canEdit(auth.role) && auth.role !== "worker") {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }
  const canteenId = resolveCanteenId(request, auth);
  if (!canteenId) return NextResponse.json({ error: "canteenId required." }, { status: 400 });

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("slot_control")
    .select("*")
    .eq("canteen_id", canteenId)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "slot_control row not found for canteen." }, { status: 404 });
  }

  const row = data as SlotControlRow;
  const capacity = computeSlotCapacity(row.max_bins);
  // Generate today's slot windows for visualization
  const windows = {
    morning:   generateTimeSlots(row.morning_start.slice(0, 5),   row.morning_end.slice(0, 5),   row.slot_duration_mins),
    afternoon: generateTimeSlots(row.afternoon_start.slice(0, 5), row.afternoon_end.slice(0, 5), row.slot_duration_mins),
    evening:   generateTimeSlots(row.evening_start.slice(0, 5),   row.evening_end.slice(0, 5),   row.slot_duration_mins),
  };

  return NextResponse.json({ slot_control: row, capacity, windows });
}

export async function PATCH(request: Request) {
  const auth = await getRequestContext(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (!canEdit(auth.role)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }
  const canteenId = resolveCanteenId(request, auth);
  if (!canteenId) return NextResponse.json({ error: "canteenId required." }, { status: 400 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });

  // Whitelist editable fields. Generated columns are not editable.
  const allowed = [
    "max_bins", "slot_duration_mins", "grace_period_mins",
    "morning_start", "morning_end",
    "afternoon_start", "afternoon_end",
    "evening_start", "evening_end",
    "extra_bin_fee_paise", "meals_per_bin", "snacks_per_bin",
  ];
  const updates: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in body) updates[key] = body[key];
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No editable fields supplied." }, { status: 400 });
  }

  // Validate numeric fields
  if ("max_bins" in updates) {
    const v = Number(updates.max_bins);
    if (!Number.isInteger(v) || v <= 0) {
      return NextResponse.json({ error: "max_bins must be a positive integer." }, { status: 400 });
    }
    updates.max_bins = v;
  }
  if ("slot_duration_mins" in updates) {
    const v = Number(updates.slot_duration_mins);
    if (![10, 15, 20].includes(v)) {
      return NextResponse.json({ error: "slot_duration_mins must be 10, 15 or 20." }, { status: 400 });
    }
    updates.slot_duration_mins = v;
  }

  updates.updated_at = new Date().toISOString();

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("slot_control")
    .update(updates)
    .eq("canteen_id", canteenId)
    .select("*")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Failed to update slot control." }, { status: 500 });
  }

  const row = data as SlotControlRow;
  return NextResponse.json({ slot_control: row, capacity: computeSlotCapacity(row.max_bins) });
}

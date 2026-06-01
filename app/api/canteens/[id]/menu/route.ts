import { createAdminClient } from "@/lib/supabase-server";
import { getMenuItemUsageForToday } from "@/lib/menuItemCapacity";

export const dynamic = "force-dynamic";

function missingColumn(errorMessage: string): string | null {
  const m = errorMessage.match(/column\s+"?([a-zA-Z0-9_\.]+)"?\s+does not exist/i);
  if (!m) return null;
  const raw = m[1].split(".").pop() ?? m[1];
  return raw.replace(/"/g, "");
}

function istMinuteOfDay(now = new Date()): number {
  return (now.getUTCHours() * 60 + now.getUTCMinutes() + 330) % 1440;
}

function pickNextOpenSlot(
  slots: Array<{ id: string; start_time: string; is_active?: boolean | null }>,
  slotDurationMins: number,
): string | null {
  if (slots.length === 0) return null;
  const nowMin = istMinuteOfDay();
  const active = slots
    .filter((s) => s.is_active !== false)
    .slice()
    .sort((a, b) => a.start_time.localeCompare(b.start_time));
  for (const s of active) {
    const [h, m] = s.start_time.split(":").map(Number);
    const cutoff = h * 60 + m - slotDurationMins;
    if (nowMin <= cutoff) return s.id;
  }
  return active[0]?.id ?? null;
}

/**
 * GET /api/canteens/[id]/menu
 * Public endpoint that returns the menu items a STUDENT can browse for a given
 * canteen. Filters server-side to only items that are: available, not hidden,
 * not sold out. Categories are read straight off the row (string column).
 *
 * NOTE: the existing /api/canteen/menu endpoint requires canteen-staff auth
 * and is scoped via getRequestContext — it is NOT usable for the user app.
 * That gap is why students used to see an empty menu.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id || typeof id !== "string" || id.length > 100) {
    return Response.json({ error: "id required" }, { status: 400 });
  }

  const supabase = createAdminClient();

  // Resilient select: try with the new phase-1 columns first; if production DB
  // has not yet had the migration applied, fall back to the base column set so
  // the menu still loads (degraded → all items default to "slot_based").
  type MenuRow = {
    id: string; name: string; description: string | null; price: number | string;
    category: string | null; image_url: string | null;
    is_available: boolean; is_hidden: boolean; is_sold_out: boolean;
    availability_type?: string | null; is_meal?: boolean | null;
    quantity_per_slot?: number | null; total_per_day?: number | null;
  };
  const selectedCols = [
    "id", "name", "description", "price", "category", "image_url",
    "is_available", "is_hidden", "is_sold_out",
    "availability_type", "is_meal", "quantity_per_slot", "total_per_day",
  ];
  let rows: MenuRow[] | null = null;
  let lastError: string | null = null;
  for (let attempt = 0; attempt < 10 && selectedCols.length > 0; attempt++) {
    const cols = selectedCols.join(", ");
    const { data, error } = await supabase
      .from("menu_items")
      .select(cols)
      .eq("canteen_id", id)
      .eq("is_available", true)
      .eq("is_hidden",    false)
      .order("category", { ascending: true })
      .order("name",     { ascending: true });
    if (!error) { rows = (data ?? []) as unknown as MenuRow[]; break; }
    lastError = error.message;
    const miss = missingColumn(error.message);
    if (!miss) break;
    const idx = selectedCols.findIndex((c) => c === miss);
    if (idx < 0) break;
    selectedCols.splice(idx, 1);
  }
  if (rows === null) return Response.json({ error: lastError ?? "menu query failed" }, { status: 500 });

  // Slot-aware hiding for capped items: if an item's configured cap is fully
  // consumed, it disappears from student menu so students cannot attempt the
  // 11th order when the canteen cap is 10.
  const { data: slotControl } = await supabase
    .from("slot_control")
    .select("slot_duration_mins, slot_mode")
    .eq("canteen_id", id)
    .maybeSingle();
  const slotDurationMins = Number(slotControl?.slot_duration_mins) || 15;
  // In batched_only mode the canteen has paused its made-to-order line —
  // hide made-to-order MEALS so students never see options they can't order.
  // Snacks stay visible regardless (they're always pre-packed in practice).
  // Client decision 2026-05-30.
  const slotMode = (slotControl as Record<string, unknown> | null)?.slot_mode === "batched_only"
    ? "batched_only"
    : "both";
  if (slotMode === "batched_only") {
    rows = rows.filter((r) => {
      const availType = r.availability_type ?? "slot_based";
      // Visible when: it's a batched item OR it's a snack (not a meal)
      return availType === "batched_prepared" || r.is_meal === false;
    });
  }
  const { data: slotRows } = await supabase
    .from("time_slots")
    .select("id, start_time, is_active")
    .eq("canteen_id", id)
    .limit(200);
  const nextSlotId = pickNextOpenSlot((slotRows ?? []) as Array<{ id: string; start_time: string; is_active?: boolean | null }>, slotDurationMins);
  const usage = await getMenuItemUsageForToday(supabase, {
    canteenId: id,
    menuItemIds: rows.map((r) => r.id),
    slotId: nextSlotId,
  });

  const items = rows
    .map(r => {
      const availType = r.availability_type ?? "slot_based";
      const slotCap = Number(r.quantity_per_slot ?? 0);
      const dayCap = Number(r.total_per_day ?? 0);
      const slotUsed = usage.slotUsed.get(r.id) ?? 0;
      const dayUsed = usage.dayUsed.get(r.id) ?? 0;

      // Determine if item is available for ordering
      let isAvailable = true;
      if (availType === "slot_based" && slotCap > 0) isAvailable = slotUsed < slotCap;
      else if (availType === "batched_prepared" && dayCap > 0) isAvailable = dayUsed < dayCap;

      // Mark as sold out if already flagged in DB or if capacity is exhausted
      const isSoldOut = r.is_sold_out || !isAvailable;

      // Surface remaining count so the student app can show "X left" badges
      // and feel the count tick down as other students place orders. null
      // means "no cap configured" (vendor didn't set total_per_day or
      // quantity_per_slot) — UI should treat as unlimited.
      let remaining: number | null = null;
      if (availType === "slot_based" && slotCap > 0) {
        remaining = Math.max(0, slotCap - slotUsed);
      } else if (availType === "batched_prepared" && dayCap > 0) {
        remaining = Math.max(0, dayCap - dayUsed);
      }

      return {
        id:                r.id,
        name:              r.name,
        description:       r.description ?? "",
        price:             Number(r.price ?? 0),
        category:          (r.category ?? "Other").toString(),
        image_url:         r.image_url ?? null,
        availability_type: r.availability_type ?? "slot_based",
        is_meal:           !!r.is_meal,
        is_sold_out:       isSoldOut,
        remaining,
      };
    });

  // Build a unique, ordered list of category labels for the tab bar
  const categoriesSet = new Set<string>();
  for (const it of items) categoriesSet.add(it.category);
  const categories = Array.from(categoriesSet);

  // 2-second cache (was 5s) — keeps inventory counts feeling near-real-time
  // for the student menu as other students place orders. Cloudflare still
  // absorbs burst polling at the edge.
  return Response.json(
    { items, categories, count: items.length, slot_mode: slotMode },
    { headers: { "Cache-Control": "public, max-age=2, s-maxage=2, stale-while-revalidate=30" } },
  );
}

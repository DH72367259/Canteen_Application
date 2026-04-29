import { createAdminClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

/**
 * GET /api/canteens/[id]
 * Public endpoint — returns the bare canteen card data the menu page needs to
 * decide whether to render the menu or block the user (offline).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!id) return Response.json({ error: "id required" }, { status: 400 });

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("canteens")
    .select("id, name, college, city, address, lat, lng, status, is_active")
    .eq("id", id)
    .maybeSingle();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!data)  return Response.json({ error: "Canteen not found." }, { status: 404 });

  // Authoritative readiness signals so the vendor toggle gate is not
  // dependent on per-browser localStorage flags. The vendor's "Open" toggle
  // can only flip ON when both of these are true:
  //   - menu_ready: at least one available, non-hidden, non-sold-out item
  //   - slots_ready: a slot_control row exists with usable capacity
  // Without this, a fresh browser session would silently lock every canteen
  // OFF even when the DB has full menu + slots configured.
  const [{ count: menuCount }, { data: slotRow }] = await Promise.all([
    supabase
      .from("menu_items")
      .select("id", { count: "exact", head: true })
      .eq("canteen_id", id)
      .eq("is_available", true)
      .eq("is_hidden", false)
      .eq("is_sold_out", false),
    supabase
      .from("slot_control")
      .select("max_bins, slot_duration_mins")
      .eq("canteen_id", id)
      .maybeSingle(),
  ]);
  const menuReady  = (menuCount ?? 0) > 0;
  const slotsReady = !!slotRow && (slotRow.max_bins ?? 0) > 0 && (slotRow.slot_duration_mins ?? 0) > 0;

  return Response.json({ canteen: data, menuReady, slotsReady });
}

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
  // Resilient against prod schema drift — try the strict Phase-1 query first,
  // then progressively widen if any expected column is missing. Without the
  // fallback a single missing column (is_hidden / is_sold_out / slot_duration_mins)
  // would silently force readiness=false and lock the vendor toggle.
  let menuCount = 0;
  {
    const strict = await supabase
      .from("menu_items")
      .select("id", { count: "exact", head: true })
      .eq("canteen_id", id)
      .eq("is_available", true)
      .eq("is_hidden", false)
      .eq("is_sold_out", false);
    if (!strict.error) {
      menuCount = strict.count ?? 0;
    } else {
      const loose = await supabase
        .from("menu_items")
        .select("id", { count: "exact", head: true })
        .eq("canteen_id", id)
        .eq("is_available", true);
      menuCount = loose.count ?? 0;
    }
  }

  let slotsReady = false;
  {
    // Try with slot_duration_mins, fall back to slot_duration_minutes, finally
    // fall back to "any row with max_bins > 0".
    const tryFull = await supabase
      .from("slot_control")
      .select("max_bins, slot_duration_mins")
      .eq("canteen_id", id)
      .maybeSingle();
    if (!tryFull.error && tryFull.data) {
      slotsReady = (tryFull.data.max_bins ?? 0) > 0 && (tryFull.data.slot_duration_mins ?? 0) > 0;
    } else {
      const tryAlt = await supabase
        .from("slot_control")
        .select("max_bins, slot_duration_minutes")
        .eq("canteen_id", id)
        .maybeSingle();
      if (!tryAlt.error && tryAlt.data) {
        slotsReady = (tryAlt.data.max_bins ?? 0) > 0 && ((tryAlt.data as { slot_duration_minutes?: number }).slot_duration_minutes ?? 0) > 0;
      } else {
        const justBins = await supabase
          .from("slot_control")
          .select("max_bins")
          .eq("canteen_id", id)
          .maybeSingle();
        slotsReady = !!justBins.data && (justBins.data.max_bins ?? 0) > 0;
      }
    }
  }
  const menuReady = menuCount > 0;

  return Response.json({ canteen: data, menuReady, slotsReady });
}

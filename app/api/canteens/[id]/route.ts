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

  return Response.json({ canteen: data });
}

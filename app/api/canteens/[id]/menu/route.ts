import { createAdminClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

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
  };
  const baseCols = "id, name, description, price, category, image_url, is_available, is_hidden, is_sold_out";
  const fullCols = `${baseCols}, availability_type, is_meal`;
  let rows: MenuRow[] | null = null;
  let lastError: string | null = null;
  for (const cols of [fullCols, baseCols]) {
    const { data, error } = await supabase
      .from("menu_items")
      .select(cols)
      .eq("canteen_id", id)
      .eq("is_available", true)
      .eq("is_hidden",    false)
      .eq("is_sold_out",  false)
      .order("category", { ascending: true })
      .order("name",     { ascending: true });
    if (!error) { rows = (data ?? []) as unknown as MenuRow[]; break; }
    lastError = error.message;
    // Only retry with reduced columns if it's a missing-column error
    if (!/column .* does not exist/i.test(error.message)) break;
  }
  if (rows === null) return Response.json({ error: lastError ?? "menu query failed" }, { status: 500 });

  const items = rows.map(r => ({
    id:                r.id,
    name:              r.name,
    description:       r.description ?? "",
    price:             Number(r.price ?? 0),
    category:          (r.category ?? "Other").toString(),
    image_url:         r.image_url ?? null,
    availability_type: r.availability_type ?? "slot_based",
    is_meal:           !!r.is_meal,
  }));

  // Build a unique, ordered list of category labels for the tab bar
  const categoriesSet = new Set<string>();
  for (const it of items) categoriesSet.add(it.category);
  const categories = Array.from(categoriesSet);

  // 60 s cache: menu changes are rare and the user can pull-to-refresh.
  // Cuts repeat-visit egress by ~95 % for the typical browse session.
  return Response.json(
    { items, categories, count: items.length },
    { headers: { "Cache-Control": "public, max-age=60, s-maxage=60, stale-while-revalidate=120" } },
  );
}

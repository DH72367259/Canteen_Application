import { NextResponse } from "next/server";
import { getRequestContext } from "@/lib/authServer";
import { createAdminClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

const ALLOWED_AVAIL = ["slot_based", "batched_prepared"] as const;

function canEdit(role: string): boolean {
  return role === "canteen_admin" || role === "vendor" ||
         role === "co_admin" || role === "super_admin";
}

function resolveCanteenId(req: Request, auth: { role: string; canteenId?: string }): string | null {
  const url = new URL(req.url);
  const q = url.searchParams.get("canteenId");
  if (auth.role === "super_admin" || auth.role === "co_admin") {
    return q ?? auth.canteenId ?? null;
  }
  return auth.canteenId ?? null;
}

// GET /api/canteen/menu — list items for canteen with all Phase 1 fields
export async function GET(request: Request) {
  const auth = await getRequestContext(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const canteenId = resolveCanteenId(request, auth);
  if (!canteenId) return NextResponse.json({ error: "canteenId required." }, { status: 400 });

  const supabase = createAdminClient();
  // Resilient select: prod databases that haven't yet had every Phase-1
  // column applied would fail the whole query (single missing column =
  // PostgREST 400) and surface as "Failed to load menu" in the vendor UI.
  // Try the full set first; on missing-column error, retry with the base set.
  const fullCols = "id, canteen_id, name, description, price, category, image_url, is_available, availability_type, quantity_per_slot, total_per_day, is_meal, is_hidden, is_sold_out, created_at, updated_at";
  const midCols  = "id, canteen_id, name, description, price, category, image_url, is_available, is_hidden, is_sold_out, created_at";
  const baseCols = "id, canteen_id, name, description, price, category, image_url, is_available";
  let data: unknown[] | null = null;
  let lastError: string | null = null;
  for (const cols of [fullCols, midCols, baseCols]) {
    const q = supabase
      .from("menu_items")
      .select(cols)
      .eq("canteen_id", canteenId);
    // created_at ordering only when the column is in the projection (it
    // exists in prod alongside the base set); otherwise sort by name as a
    // stable deterministic fallback.
    const r = await (cols.includes("created_at")
      ? q.order("created_at", { ascending: false })
      : q.order("name", { ascending: true }));
    if (!r.error) { data = r.data ?? []; break; }
    lastError = r.error.message;
    if (!/column .* does not exist/i.test(r.error.message)) break;
  }
  if (data === null) {
    return NextResponse.json({ error: lastError ?? "Failed to load menu." }, { status: 500 });
  }
  return NextResponse.json({ items: data });
}

// POST /api/canteen/menu — create item with Phase 1 fields
export async function POST(request: Request) {
  const auth = await getRequestContext(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (!canEdit(auth.role)) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  const canteenId = resolveCanteenId(request, auth);
  if (!canteenId) return NextResponse.json({ error: "canteenId required." }, { status: 400 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const price = Number(body.price);
  if (!name) return NextResponse.json({ error: "name is required." }, { status: 400 });
  if (!Number.isFinite(price) || price < 0) {
    return NextResponse.json({ error: "price must be a non-negative number." }, { status: 400 });
  }
  const availability_type = typeof body.availability_type === "string"
    ? body.availability_type
    : "batched_prepared";
  if (!(ALLOWED_AVAIL as readonly string[]).includes(availability_type)) {
    return NextResponse.json({ error: "availability_type must be slot_based or batched_prepared." }, { status: 400 });
  }

  const insertRow: Record<string, unknown> = {
    canteen_id: canteenId,
    name,
    description: typeof body.description === "string" ? body.description : null,
    price,
    category: typeof body.category === "string" ? body.category : null,
    image_url: typeof body.image_url === "string" ? body.image_url : null,
    availability_type,
    quantity_per_slot: body.quantity_per_slot != null ? Number(body.quantity_per_slot) : null,
    total_per_day: body.total_per_day != null ? Number(body.total_per_day) : null,
    is_meal: Boolean(body.is_meal),
    is_hidden: Boolean(body.is_hidden),
    is_sold_out: Boolean(body.is_sold_out),
    is_available: body.is_available !== false,
  };

  const supabase = createAdminClient();
  // Resilient insert: if the prod DB hasn't yet had every Phase-1 column
  // (availability_type / quantity_per_slot / total_per_day / is_meal),
  // strip them and retry. Otherwise the vendor's Save would silently fail
  // and the saved item would never appear in the list.
  const phase1Cols = ["availability_type", "quantity_per_slot", "total_per_day", "is_meal"];
  const tryInsert = async (row: Record<string, unknown>) =>
    supabase.from("menu_items").insert(row).select("*").single();
  let inserted = await tryInsert(insertRow);
  if (inserted.error && /column .* does not exist/i.test(inserted.error.message)) {
    const fallback = { ...insertRow };
    for (const c of phase1Cols) delete fallback[c];
    inserted = await tryInsert(fallback);
  }
  if (inserted.error || !inserted.data) {
    return NextResponse.json({ error: inserted.error?.message ?? "Failed to create item." }, { status: 500 });
  }
  return NextResponse.json({ item: inserted.data }, { status: 201 });
}

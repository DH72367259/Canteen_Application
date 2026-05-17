import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ results: [] });

  // Search menu items across all active canteens.
  // Returns canteens that have at least one matching available item.
  const { data, error } = await supabase
    .from("menu_items")
    .select(`
      id, name, price, is_sold_out,
      canteen:canteens!inner(id, name, is_active)
    `)
    .or(`name.ilike.%${q}%,description.ilike.%${q}%`)
    .eq("is_sold_out", false)
    .eq("canteens.is_active", true)
    .limit(60);

  if (error) {
    // Fallback: just return empty so UI degrades gracefully
    return NextResponse.json({ results: [] });
  }

  // Group by canteen — collect unique canteen IDs and up to 3 matching item names
  const byCanteen = new Map<string, { canteenId: string; canteenName: string; items: string[] }>();
  for (const row of (data ?? [])) {
    const c = row.canteen as unknown as { id: string; name: string } | null;
    if (!c) continue;
    const entry = byCanteen.get(c.id) ?? { canteenId: c.id, canteenName: c.name, items: [] };
    if (entry.items.length < 3) entry.items.push(row.name as string);
    byCanteen.set(c.id, entry);
  }

  return NextResponse.json({ results: Array.from(byCanteen.values()) });
}

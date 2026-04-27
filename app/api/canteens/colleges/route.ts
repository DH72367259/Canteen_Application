import { createAdminClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

/**
 * GET /api/canteens/colleges
 * Returns the distinct list of college names across all active canteens
 * for populating the college dropdown in the user app.
 */
export async function GET() {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("canteens")
    .select("college")
    .eq("is_active", true)
    .not("college", "is", null);

  if (error) return Response.json({ error: error.message }, { status: 500 });

  const set = new Set<string>();
  for (const row of data ?? []) {
    const c = (row as { college: string | null }).college?.trim();
    if (c) set.add(c);
  }
  const colleges = [...set].sort((a, b) => a.localeCompare(b));
  return Response.json({ colleges });
}

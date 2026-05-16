/**
 * GET /api/canteen/receipts?page=0&limit=20&date=YYYY-MM-DD&slot=<label>&search=<text>
 *
 * Returns a paginated list of past orders (receipts) for the calling canteen.
 * Vendor / canteen_admin can view; super_admin can pass ?canteen_id= for any.
 *
 * Response:
 *   { total, page, limit, orders: [{ id, student_name, phone, slot_label,
 *     bin_label, total_amount, status, created_at, items }] }
 */
import { getRequestContext } from "@/lib/authServer";
import { createAdminClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

const IST_OFFSET_MIN = 330;
function toIst(d: Date): Date { return new Date(d.getTime() + IST_OFFSET_MIN * 60_000); }
function istDayStart(d: Date): Date {
  const ist = toIst(d);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - IST_OFFSET_MIN * 60_000);
}

export async function GET(request: Request) {
  const ctx = await getRequestContext(request);
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const allowed = ["canteen_admin", "vendor", "super_admin", "co_admin"];
  if (!allowed.includes(ctx.role ?? ""))
    return Response.json({ error: "Forbidden" }, { status: 403 });

  const supabase = createAdminClient();
  const url = new URL(request.url);

  const { data: profile } = await supabase
    .from("profiles").select("canteen_id").eq("id", ctx.uid).single();

  const canteenId =
    ctx.role === "super_admin" || ctx.role === "co_admin"
      ? (url.searchParams.get("canteen_id") || profile?.canteen_id)
      : profile?.canteen_id;

  if (!canteenId)
    return Response.json({ error: "No canteen associated." }, { status: 404 });

  const page  = Math.max(0, parseInt(url.searchParams.get("page")  ?? "0", 10));
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get("limit") ?? "20", 10)));
  const dateParam = url.searchParams.get("date");
  const slotParam = url.searchParams.get("slot");
  const search    = (url.searchParams.get("search") ?? "").trim().toLowerCase();

  // Build date range filter — supports single ?date=, or ?from_date=&to_date= range
  let fromDate: string | null = null;
  let toDate:   string | null = null;
  const fromDateParam = url.searchParams.get("from_date");
  const toDateParam   = url.searchParams.get("to_date");
  if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
    const [y, m, d] = dateParam.split("-").map(Number);
    const start = new Date(Date.UTC(y, m - 1, d) - IST_OFFSET_MIN * 60_000);
    fromDate = start.toISOString();
    toDate   = new Date(start.getTime() + 86_400_000).toISOString();
  } else if (fromDateParam && /^\d{4}-\d{2}-\d{2}$/.test(fromDateParam)) {
    const [fy, fm, fd] = fromDateParam.split("-").map(Number);
    fromDate = new Date(Date.UTC(fy, fm - 1, fd) - IST_OFFSET_MIN * 60_000).toISOString();
    if (toDateParam && /^\d{4}-\d{2}-\d{2}$/.test(toDateParam)) {
      const [ty, tm, td] = toDateParam.split("-").map(Number);
      toDate = new Date(Date.UTC(ty, tm - 1, td + 1) - IST_OFFSET_MIN * 60_000).toISOString();
    }
  }

  // Fetch orders (with user profile join for student name/phone)
  let query = supabase
    .from("orders")
    .select(`
      id,
      slot_label,
      bin_label,
      bin_color,
      total_amount,
      status,
      created_at,
      profiles(name, phone)
    `, { count: "exact" })
    .eq("canteen_id", canteenId)
    .neq("status", "cancelled")
    .order("created_at", { ascending: false })
    .range(page * limit, page * limit + limit - 1);

  if (fromDate) query = query.gte("created_at", fromDate);
  if (toDate)   query = query.lt("created_at", toDate);
  if (slotParam) query = query.eq("slot_label", slotParam);

  const { data: orders, error: ordErr, count } = await query;
  if (ordErr) return Response.json({ error: ordErr.message }, { status: 500 });

  const orderList = orders ?? [];

  // Filter by search (student name or phone — done in JS since Supabase
  // doesn't easily support cross-relation text search without full-text index)
  const filtered = search
    ? orderList.filter(o => {
        const p = Array.isArray(o.profiles) ? o.profiles[0] : o.profiles;
        const profile = p as { name?: string; phone?: string } | null;
        return (
          profile?.name?.toLowerCase().includes(search) ||
          profile?.phone?.includes(search) ||
          o.id.toLowerCase().includes(search)
        );
      })
    : orderList;

  // Fetch order_items for these orders
  const orderIds = filtered.map(o => o.id);
  let itemsByOrder: Record<string, { name: string; quantity: number; unit_price: number }[]> = {};

  if (orderIds.length > 0) {
    const { data: rawItems } = await supabase
      .from("order_items")
      .select("order_id, quantity, cancelled_quantity, unit_price, menu_items(name)")
      .in("order_id", orderIds);

    for (const row of rawItems ?? []) {
      const qty = Math.max(0, Number(row.quantity ?? 0) - Number(row.cancelled_quantity ?? 0));
      if (qty === 0) continue;
      const menuItem = Array.isArray(row.menu_items) ? row.menu_items[0] : row.menu_items;
      const name = (menuItem as { name?: string } | null)?.name ?? "Unknown";
      if (!itemsByOrder[row.order_id]) itemsByOrder[row.order_id] = [];
      itemsByOrder[row.order_id].push({ name, quantity: qty, unit_price: Number(row.unit_price ?? 0) });
    }
  }

  const result = filtered.map(o => {
    const p = Array.isArray(o.profiles) ? o.profiles[0] : o.profiles;
    const prof = p as { name?: string; phone?: string } | null;
    return {
      id: o.id,
      student_name: prof?.name ?? "—",
      phone: prof?.phone ?? "—",
      slot_label:   o.slot_label ?? "—",
      bin_label:    o.bin_label  ?? "—",
      bin_color:    o.bin_color  ?? null,
      total_amount: Number(o.total_amount ?? 0),
      status:       o.status,
      created_at:   o.created_at,
      items:        itemsByOrder[o.id] ?? [],
    };
  });

  return Response.json({
    total: search ? result.length : (count ?? 0),
    page,
    limit,
    orders: result,
  });
}

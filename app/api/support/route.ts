import { getRequestContext } from "@/lib/authServer";
import { createAdminClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

// ── GET /api/support — list tickets (admin gets all; others get own) ─────────
export async function GET(request: Request) {
  const ctx = await getRequestContext(request);
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = createAdminClient();
  const { searchParams } = new URL(request.url);
  const status   = searchParams.get("status");     // filter by status
  const category = searchParams.get("category");   // filter by category

  let query = supabase
    .from("support_tickets")
    .select(`
      id, ticket_ref, raised_by, raised_by_role, canteen_id,
      category, subject, description, priority, status,
      admin_notes, resolved_at, created_at, updated_at,
      order_id,
      canteen:canteens(name)
    `)
    .order("created_at", { ascending: false });

  // Non-admins only see their own tickets
  if (ctx.role !== "super_admin") {
    query = query.eq("raised_by", ctx.uid);
  }
  if (status)   query = query.eq("status",   status);
  if (category) query = query.eq("category", category);

  const { data, error } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  // Batch-fetch profile names — avoids PostgREST FK join that fails when FK
  // is not registered in the Supabase schema cache.
  const uids = [...new Set((data ?? []).map((t: { raised_by: string }) => t.raised_by).filter(Boolean))];
  const profileMap: Record<string, { name: string | null; email: string | null }> = {};
  if (uids.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, name, email")
      .in("id", uids);
    for (const p of profiles ?? []) {
      profileMap[p.id] = { name: p.name, email: p.email };
    }
  }

  const tickets = (data ?? []).map((t: { raised_by: string } & Record<string, unknown>) => ({
    ...t,
    raised_profile: profileMap[t.raised_by] ?? null,
  }));

  return Response.json({ tickets });
}

// ── POST /api/support — raise a new ticket ────────────────────────────────────
export async function POST(request: Request) {
  const ctx = await getRequestContext(request);
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { category, subject, description, canteen_id, order_id } = body;

  if (!category || !subject?.trim() || !description?.trim()) {
    return Response.json({ error: "category, subject and description are required." }, { status: 400 });
  }

  const VALID_CATEGORIES = [
    "payment_issue", "order_not_found", "otp_mismatch", "vendor_refused",
    "refund_request", "menu_issue", "app_bug", "other",
  ];
  if (!VALID_CATEGORIES.includes(category)) {
    return Response.json({ error: "Invalid category." }, { status: 400 });
  }

  // Auto-assign priority based on category
  const priorityMap: Record<string, string> = {
    payment_issue: "critical",
    refund_request: "high",
    otp_mismatch: "high",
    vendor_refused: "high",
    order_not_found: "medium",
    menu_issue: "low",
    app_bug: "medium",
    other: "low",
  };
  const priority = priorityMap[category] ?? "medium";

  const raised_by_role = (["super_admin", "canteen_admin", "vendor"].includes(ctx.role ?? ""))
    ? (ctx.role === "super_admin" ? "vendor" : ctx.role)
    : "student";

  const supabase = createAdminClient();

  // Generate ticket_ref: TKT-YYYYMMDD-NNNN
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const { count } = await supabase
    .from("support_tickets")
    .select("*", { count: "exact", head: true });
  const seq = String((count ?? 0) + 1).padStart(4, "0");
  const ticket_ref = `TKT-${today}-${seq}`;

  const { data, error } = await supabase
    .from("support_tickets")
    .insert({
      ticket_ref,
      raised_by: ctx.uid,
      raised_by_role,
      canteen_id:  canteen_id  || null,
      order_id:    order_id    || null,
      category,
      subject:     subject.trim().slice(0, 200),
      description: description.trim().slice(0, 2000),
      priority,
    })
    .select("*")
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ success: true, ticket: data }, { status: 201 });
}

import { getRequestContext } from "@/lib/authServer";
import { createAdminClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

interface RouteContext { params: Promise<{ id: string }> }

// ── PATCH /api/support/[id] — admin updates ticket (status, notes, priority) ─
export async function PATCH(request: Request, { params }: RouteContext) {
  const ctx = await getRequestContext(request);
  if (!ctx || ctx.role !== "super_admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json();
  const { status, admin_notes, priority } = body;

  const VALID_STATUSES = ["open", "in_progress", "escalated", "resolved", "closed"];
  if (status && !VALID_STATUSES.includes(status)) {
    return Response.json({ error: "Invalid status." }, { status: 400 });
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (status)      updates.status      = status;
  if (admin_notes !== undefined) updates.admin_notes = admin_notes;
  if (priority)    updates.priority    = priority;
  if (status === "resolved") {
    updates.resolved_by = ctx.uid;
    updates.resolved_at = new Date().toISOString();
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("support_tickets")
    .update(updates)
    .eq("id", id)
    .select("*")
    .maybeSingle();

  if (error) {
    const msg = String(error.message ?? "").toLowerCase();
    if (msg.includes("invalid input syntax for type uuid")) {
      return Response.json({ error: "Invalid ticket id." }, { status: 400 });
    }
    console.error("[PATCH /api/support/:id] error:", error);
    return Response.json({ error: "Failed to update support ticket." }, { status: 500 });
  }
  if (!data) return Response.json({ error: "Ticket not found." }, { status: 404 });
  return Response.json({ success: true, ticket: data });
}

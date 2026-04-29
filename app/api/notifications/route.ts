import { NextResponse } from "next/server";
import { getRequestContext } from "@/lib/authServer";
import { createAdminClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

// GET /api/notifications — returns notifications visible to the current user
export async function GET(request: Request) {
  const auth = await getRequestContext(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const supabase = createAdminClient();

  // Fetch user's canteen_id from profile (already in auth context)
  const canteenId = auth.canteenId ?? null;

  // Build the filter: notifications targeted at 'all', or specific canteen/user
  let query = supabase
    .from("notifications")
    .select("id, title, body, type, recipient_type, recipient_id, target_role, created_at")
    .order("created_at", { ascending: false })
    .limit(50);

  // Super/co admins see all notifications
  if (auth.role !== "super_admin" && auth.role !== "co_admin") {
    // Per-role routing via target_role:
    //   - 'all'         -> visible to everyone
    //   - 'all_staff'   -> visible to worker/canteen_admin/vendor (any staff role)
    //   - 'user'        -> visible to user role
    //   - 'worker'      -> visible only to worker
    //   - 'canteen_admin' -> visible to canteen_admin / vendor
    const isStaff = ["worker", "canteen_admin", "vendor"].includes(auth.role);
    const roleTargets = ["all"];
    if (isStaff) roleTargets.push("all_staff");
    if (auth.role === "worker") roleTargets.push("worker");
    if (auth.role === "canteen_admin" || auth.role === "vendor") roleTargets.push("canteen_admin");
    if (auth.role === "user") roleTargets.push("user");

    const filters: string[] = [];
    // recipient-based (legacy)
    filters.push(`recipient_type.eq.all`);
    if (canteenId) filters.push(`and(recipient_type.eq.canteen,recipient_id.eq.${canteenId})`);
    filters.push(`and(recipient_type.eq.user,recipient_id.eq.${auth.uid})`);
    // target_role-based (Phase 1)
    filters.push(`target_role.in.(${roleTargets.join(",")})`);
    query = query.or(filters.join(","));
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: `Failed to fetch notifications: ${error.message}` }, { status: 500 });

  // Fetch read status for this user
  const ids = (data ?? []).map(n => n.id);
  const { data: reads } = ids.length > 0
    ? await supabase.from("notification_reads").select("notification_id").eq("user_id", auth.uid).in("notification_id", ids)
    : { data: [] };

  const readSet = new Set((reads ?? []).map(r => r.notification_id));
  const notifications = (data ?? []).map(n => ({ ...n, is_read: readSet.has(n.id) }));
  const unread_count = notifications.filter(n => !n.is_read).length;

  return NextResponse.json({ notifications, unread_count });
}

// POST /api/notifications — super_admin sends a notification
export async function POST(request: Request) {
  const auth = await getRequestContext(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (auth.role !== "super_admin" && auth.role !== "co_admin") {
    return NextResponse.json({ error: "Only admins can send notifications." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });

  const { title, message, recipient_type, recipient_id, target_role } = body as Record<string, string>;

  if (!title?.trim()) return NextResponse.json({ error: "Title is required." }, { status: 400 });
  if (!message?.trim()) return NextResponse.json({ error: "Message is required." }, { status: 400 });

  const validTypes = ["all", "all_users", "all_canteens", "canteen", "user"];
  if (!recipient_type || !validTypes.includes(recipient_type)) {
    return NextResponse.json({ error: `recipient_type must be one of: ${validTypes.join(", ")}.` }, { status: 400 });
  }

  if ((recipient_type === "canteen" || recipient_type === "user") && !recipient_id) {
    return NextResponse.json({ error: "recipient_id is required for targeted notifications." }, { status: 400 });
  }

  // Phase 5: target_role enables fan-out by role (all/all_staff/user/worker/canteen_admin)
  const validRoles = ["all", "all_staff", "user", "worker", "canteen_admin"];
  if (target_role && !validRoles.includes(target_role)) {
    return NextResponse.json({ error: `target_role must be one of: ${validRoles.join(", ")}.` }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("notifications")
    .insert({
      title: title.trim(),
      body: message.trim(),
      type: "admin",
      recipient_type,
      recipient_id: recipient_id ?? null,
      target_role: target_role ?? null,
      created_by: auth.uid,
    })
    .select("id")
    .single();

  if (error) return NextResponse.json({ error: `Failed to send notification: ${error.message}` }, { status: 500 });

  return NextResponse.json({ success: true, id: data.id });
}

// PATCH /api/notifications — mark notification(s) as read
export async function PATCH(request: Request) {
  const auth = await getRequestContext(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const ids: string[] = Array.isArray(body?.ids) ? body.ids : [];
  if (!ids.length) return NextResponse.json({ error: "ids array is required." }, { status: 400 });

  const supabase = createAdminClient();
  const rows = ids.map(id => ({ notification_id: id, user_id: auth.uid }));
  await supabase.from("notification_reads").upsert(rows, { onConflict: "notification_id,user_id" });

  return NextResponse.json({ success: true });
}

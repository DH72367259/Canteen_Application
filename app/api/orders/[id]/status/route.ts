import { NextResponse } from "next/server";
import { getRequestContext } from "@/lib/authServer";
import { canManageOrders } from "@/lib/roleChecks";
import { createAdminClient } from "@/lib/supabase-server";

// Raw DB statuses workers/admins may set directly.
const STAFF_STATUSES = [
  "placed", "confirmed", "preparing", "ready_for_placement",
  "placed_in_bin", "ready_for_pickup", "collected", "cancelled",
  "received", "ready", "completed",
];

// Pseudo-statuses worker UI sends; translated into side effects below.
//   skip      -> push order to back of pending queue (skipped_at = now)
//   grace_bin -> late pickup; cancel + audit + free bin
const WORKER_PSEUDO = ["skip", "grace_bin"] as const;

const STUDENT_STATUSES = ["collected"];

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  let auth;
  try {
    auth = await getRequestContext(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (!auth) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const payload = (await request.json().catch(() => null)) as { status?: string } | null;
  const status = payload?.status;
  if (!status) {
    return NextResponse.json({ error: "Status is required." }, { status: 400 });
  }

  const isStaff = canManageOrders(auth.role);
  const isPseudo = (WORKER_PSEUDO as readonly string[]).includes(status);

  if (isStaff) {
    if (!STAFF_STATUSES.includes(status) && !isPseudo) {
      return NextResponse.json({ error: "Invalid status." }, { status: 400 });
    }
  } else if (!STUDENT_STATUSES.includes(status)) {
    return NextResponse.json({ error: "Not permitted." }, { status: 403 });
  }

  const { id: orderId } = await context.params;
  const supabase = createAdminClient();

  // Non-staff must own the order
  if (!isStaff) {
    const { data: order } = await supabase.from("orders").select("user_id").eq("id", orderId).single();
    if (!order || order.user_id !== auth.uid) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }
  }

  // ── Pseudo: skip ───────────────────────────────────────────────
  if (status === "skip") {
    const { data: cur } = await supabase
      .from("orders").select("skipped_count, canteen_id")
      .eq("id", orderId).single();
    if (!cur) return NextResponse.json({ error: "Order not found." }, { status: 404 });

    const { data: updated, error } = await supabase
      .from("orders")
      .update({
        status: "confirmed",
        skipped_at: new Date().toISOString(),
        skipped_count: ((cur.skipped_count as number | null) ?? 0) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq("id", orderId)
      .select("id, status, skipped_at, skipped_count")
      .single();
    if (error || !updated) {
      return NextResponse.json({ error: "Failed to skip order." }, { status: 500 });
    }

    await supabase.from("notifications").insert({
      title: "Order skipped",
      body: `Worker skipped order ${orderId} — needs review.`,
      type: "warning",
      recipient_type: "canteen",
      recipient_id: cur.canteen_id,
      target_role: "canteen_admin",
      created_by: auth.uid,
    }).then(() => {}, () => {});

    return NextResponse.json({ order: updated });
  }

  // ── Pseudo: grace_bin ──────────────────────────────────────────
  if (status === "grace_bin") {
    const { data: cur } = await supabase
      .from("orders").select("bin_id, canteen_id")
      .eq("id", orderId).single();

    const { data: updated, error } = await supabase
      .from("orders")
      .update({
        status: "cancelled",
        grace_collected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", orderId)
      .select("id, status, grace_collected_at")
      .single();
    if (error || !updated) {
      return NextResponse.json({ error: "Failed to mark grace bin." }, { status: 500 });
    }

    if (cur?.bin_id) {
      await supabase.from("bins").update({
        is_occupied: false,
        current_order_id: null,
        updated_at: new Date().toISOString(),
      }).eq("id", cur.bin_id);
    }

    await supabase.from("notifications").insert({
      title: "Late pickup → grace bin",
      body: `Order ${orderId} moved to grace bin by worker.`,
      type: "warning",
      recipient_type: "canteen",
      recipient_id: cur?.canteen_id ?? null,
      target_role: "canteen_admin",
      created_by: auth.uid,
    }).then(() => {}, () => {});

    return NextResponse.json({ order: updated });
  }

  // ── Standard status update ─────────────────────────────────────
  const updates: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  };
  // Clear skipped_at when worker resumes work on the order
  if (isStaff && status === "preparing") {
    updates.skipped_at = null;
  }

  if (status === "collected") {
    await supabase.from("bins").update({
      is_occupied: false,
      current_order_id: null,
      updated_at: new Date().toISOString(),
    }).eq("current_order_id", orderId);
  }

  const { data: updated, error } = await supabase
    .from("orders")
    .update(updates)
    .eq("id", orderId)
    .select("id, status")
    .single();

  if (error || !updated) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }

  return NextResponse.json({ order: updated });
}

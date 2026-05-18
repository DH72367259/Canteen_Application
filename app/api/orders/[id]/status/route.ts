import { NextResponse } from "next/server";
import { getRequestContext } from "@/lib/authServer";
import { canManageOrders } from "@/lib/roleChecks";
import { createAdminClient } from "@/lib/supabase-server";
import { findUnfulfilledSiblings } from "@/lib/pickupGuard";
import { insertNotification } from "@/lib/notify";

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

const STUDENT_STATUSES = ["collected", "cancelled"];

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
    if (auth.role === "worker" && (status === "collected" || status === "completed")) {
      return NextResponse.json({ error: "Workers cannot complete pickup from this action." }, { status: 403 });
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

  // Student-initiated cancel: 30-second window from order creation — same
  // model as Swiggy/Zomato. Once that elapses the canteen has "accepted"
  // the order in practice and we lock cancellation. Vendor staff can still
  // cancel via their own UI if needed.
  if (!isStaff && status === "cancelled") {
    const { data: o } = await supabase
      .from("orders")
      .select("status, canteen_id, bin_id, slot_id, created_at")
      .eq("id", orderId)
      .single<{ status: string; canteen_id: string; bin_id: string | null; slot_id: string | null; created_at: string }>();
    if (!o) return NextResponse.json({ error: "Order not found." }, { status: 404 });
    if (["placed_in_bin", "ready_for_pickup", "collected", "cancelled", "completed", "preparing", "confirmed"].includes(o.status)) {
      return NextResponse.json({ error: "Order can no longer be cancelled." }, { status: 400 });
    }
    const ageMs = Date.now() - new Date(o.created_at).getTime();
    if (ageMs > 30_000) {
      return NextResponse.json({
        error: "Cancellation window closed. Orders can only be cancelled within 30 seconds of placement.",
      }, { status: 400 });
    }
    // Free the bin so it can be reused for another order in the same slot.
    if (o.bin_id) {
      await supabase.from("bins").update({
        is_occupied: false,
        assigned_order_id: null,
        order_id: null,
        status: "empty",
        updated_at: new Date().toISOString(),
      }).eq("id", o.bin_id);
    }
    // Phase 8: also free any rack bins linked via assigned_order_id (multi-bin)
    await supabase.from("bins").update({
      is_occupied: false,
      assigned_order_id: null,
      order_id: null,
      status: "empty",
      updated_at: new Date().toISOString(),
    }).eq("assigned_order_id", orderId);
  }

  // ── Pseudo: skip ───────────────────────────────────────────────
  if (status === "skip") {
    const { data: cur, error: curErr } = await supabase
      .from("orders").select("skipped_count, canteen_id")
      .eq("id", orderId).single();

    // If column is missing the error message contains "column" — fall back to basic fetch
    let canteenIdForNotif = "";
    let skipCount = 0;
    if (curErr || !cur) {
      if (curErr && !/column|does not exist/i.test(curErr.message ?? "")) {
        return NextResponse.json({ error: "Order not found." }, { status: 404 });
      }
      const { data: basic } = await supabase
        .from("orders").select("canteen_id").eq("id", orderId).maybeSingle();
      if (!basic) return NextResponse.json({ error: "Order not found." }, { status: 404 });
      canteenIdForNotif = (basic as { canteen_id?: string }).canteen_id ?? "";
    } else {
      canteenIdForNotif = (cur as { canteen_id?: string }).canteen_id ?? "";
      skipCount = ((cur as { skipped_count?: number | null }).skipped_count ?? 0) + 1;
    }

    const isoNow = new Date().toISOString();
    // Try full update with optional skip-tracking columns; fall back without them
    let updated: Record<string, unknown> | null = null;
    const { data: u1, error: e1 } = await supabase
      .from("orders")
      .update({ status: "confirmed", skipped_at: isoNow, skipped_count: skipCount, updated_at: isoNow })
      .eq("id", orderId).select("id, status").single();
    if (e1) {
      const { data: u2, error: e2 } = await supabase
        .from("orders")
        .update({ status: "confirmed", updated_at: isoNow })
        .eq("id", orderId).select("id, status").single();
      if (e2 || !u2) return NextResponse.json({ error: "Failed to skip order." }, { status: 500 });
      updated = u2 as Record<string, unknown>;
    } else {
      updated = u1 as Record<string, unknown>;
    }

    await insertNotification(supabase, {
      title: "Order skipped",
      body: `Worker skipped order ${orderId} — needs review.`,
      type: "warning",
      recipient_type: "canteen",
      recipient_id: canteenIdForNotif,
      target_role: "canteen_admin",
      created_by: auth.uid,
    }, "orders/status:skipped");

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
        assigned_order_id: null,
        order_id: null,
        status: "empty",
        updated_at: new Date().toISOString(),
      }).eq("id", cur.bin_id);
    }

    await insertNotification(supabase, {
      title: "Late pickup → grace bin",
      body: `Order ${orderId} moved to grace bin by worker.`,
      type: "warning",
      recipient_type: "canteen",
      recipient_id: cur?.canteen_id ?? null,
      target_role: "canteen_admin",
      created_by: auth.uid,
    }, "orders/status:grace-bin");

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
    // Per-customer pickup guard — block staff from marking collected while
    // sibling orders for the same customer are still being prepared.
    const { data: cur } = await supabase
      .from("orders").select("id, user_id, canteen_id")
      .eq("id", orderId)
      .single<{ id: string; user_id: string | null; canteen_id: string | null }>();
    if (cur) {
      const block = await findUnfulfilledSiblings(supabase, cur);
      if (block) {
        return NextResponse.json(
          { error: block.message, siblings: block.siblings },
          { status: block.status },
        );
      }
    }

    // Phase 8: free every bin linked to this order via order_id (legacy single-bin)
    // or assigned_order_id (multi-bin rack workflow).
    const freeUpdate = {
      is_occupied: false,
      assigned_order_id: null,
      order_id: null,
      status: "empty",
      updated_at: new Date().toISOString(),
    };
    await supabase.from("bins").update(freeUpdate).eq("order_id", orderId);
    await supabase.from("bins").update(freeUpdate).eq("assigned_order_id", orderId);
  }

  const { data: updated, error } = await supabase
    .from("orders")
    .update(updates)
    .eq("id", orderId)
    .select("id, status")
    .single();

  // Resilient against prod schema drift: not every database has the
  // optional `skipped_at` column (added in Phase 8). When it is missing,
  // Postgres rejects the whole UPDATE with a schema-cache error. Retry
  // without that field so worker transitions don't 404 silently.
  let finalRow = updated;
  let finalErr = error;
  if (error && /skipped_at|column .* does not exist/i.test(error.message) && "skipped_at" in updates) {
    const { skipped_at: _omit, ...slim } = updates;
    void _omit;
    const retry = await supabase
      .from("orders")
      .update(slim)
      .eq("id", orderId)
      .select("id, status")
      .single();
    finalRow = retry.data;
    finalErr = retry.error;
  }

  if (finalErr || !finalRow) {
    console.error("[orders/status] update failed", { orderId, status, error: finalErr?.message });
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }

  // Notify students on all key status transitions.
  if (["confirmed", "preparing", "placed_in_bin", "collected"].includes(status)) {
    const { data: orderRow } = await supabase
      .from("orders")
      .select("user_id, canteen_id, bin_label")
      .eq("id", orderId)
      .maybeSingle<{ user_id: string | null; canteen_id: string | null; bin_label: string | null }>();

    if (orderRow?.user_id) {
      let title = "";
      let body = "";
      let type = status;

      if (status === "confirmed") {
        title = "✅ Order Confirmed!";
        body = "Your order has been accepted by the canteen. We'll notify you when it starts being prepared.";
      } else if (status === "preparing") {
        title = "👨‍🍳 Your food is being prepared!";
        body = "The canteen has started preparing your order. It'll be ready for pickup soon.";
      } else if (status === "placed_in_bin") {
        const binText = orderRow.bin_label ? ` — Bin ${orderRow.bin_label}` : "";
        title = "🎉 Your food is ready!";
        body = `Your order is in the bin and ready for pickup${binText}. Show your QR code or OTP to collect it.`;
      } else if (status === "collected") {
        title = "✅ Order Collected!";
        body = "Your order has been collected. Enjoy your meal!";
      }

      // The insertNotification helper handles staging schemas that lack the
      // target_role column — retries once without it so the student bell
      // doesn't silently drop status-change pings.
      await insertNotification(supabase, {
        title, body, type,
        recipient_type: "user",
        recipient_id: orderRow.user_id,
        target_role: "user",
        created_by: auth.uid,
      }, `orders/status:${status}`);
    }
  }

  return NextResponse.json({ order: finalRow });
}

import { NextResponse } from "next/server";
import { getRequestContext } from "@/lib/authServer";
import { canManageOrders } from "@/lib/roleChecks";
import { createAdminClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

const PAYMENT_ID_RE = /^pay_[A-Za-z0-9]{14,}$/;
const MAX_REASON_LEN = 280;

type LedgerRow = {
  amount_paise: number | null;
  refunded_amount_paise: number | null;
};

async function getLedger(
  supabase: ReturnType<typeof createAdminClient>,
  paymentId: string,
): Promise<LedgerRow | null> {
  const { data } = await supabase
    .from("payments")
    .select("amount_paise, refunded_amount_paise")
    .eq("razorpay_payment_id", paymentId)
    .maybeSingle<LedgerRow>();
  return data ?? null;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; itemId: string }> },
) {
  const auth = await getRequestContext(request).catch(() => null);
  if (!auth) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const role = auth.role ?? "";
  const isPlatformAdmin = role === "super_admin" || role === "co_admin";
  const isCanteenManager = role === "canteen_admin" || role === "vendor";
  if (!isPlatformAdmin && !isCanteenManager) {
    return NextResponse.json({ error: "Only canteen managers and platform admins can cancel items." }, { status: 403 });
  }
  if (!canManageOrders(role)) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { reason?: string; quantity?: number } | null;
  const reasonRaw = (body?.reason ?? "").trim();
  if (!reasonRaw) return NextResponse.json({ error: "A cancellation reason is required." }, { status: 400 });
  if (reasonRaw.length > MAX_REASON_LEN) {
    return NextResponse.json({ error: `Reason must be under ${MAX_REASON_LEN} characters.` }, { status: 400 });
  }

  const { id: orderId, itemId } = await context.params;
  const supabase = createAdminClient();

  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .select("id, status, canteen_id, user_id, total_amount, payment_id, bin_id")
    .eq("id", orderId)
    .single<{
      id: string;
      status: string;
      canteen_id: string;
      user_id: string | null;
      total_amount: number;
      payment_id: string | null;
      bin_id: string | null;
    }>();

  if (orderErr || !order) return NextResponse.json({ error: "Order not found." }, { status: 404 });
  if (isCanteenManager && auth.canteenId && order.canteen_id !== auth.canteenId) {
    return NextResponse.json({ error: "You can only cancel items for your own canteen." }, { status: 403 });
  }
  if (["cancelled", "collected", "completed"].includes(order.status)) {
    return NextResponse.json({ error: "Cannot cancel items for this order stage." }, { status: 400 });
  }

  const { data: item, error: itemErr } = await supabase
    .from("order_items")
    .select("id, quantity, cancelled_quantity, unit_price")
    .eq("id", itemId)
    .eq("order_id", orderId)
    .single<{ id: string; quantity: number; cancelled_quantity: number | null; unit_price: number }>();

  if (itemErr || !item) return NextResponse.json({ error: "Order item not found." }, { status: 404 });

  const alreadyCancelled = Number(item.cancelled_quantity ?? 0);
  const remaining = Math.max(0, Number(item.quantity) - alreadyCancelled);
  if (remaining <= 0) return NextResponse.json({ error: "Item is already fully cancelled." }, { status: 400 });

  const requestedQty = body?.quantity == null ? remaining : Number(body.quantity);
  if (!Number.isInteger(requestedQty) || requestedQty < 1 || requestedQty > remaining) {
    return NextResponse.json({ error: `quantity must be between 1 and ${remaining}.` }, { status: 400 });
  }

  const cancelledAt = new Date().toISOString();
  const { error: updItemErr } = await supabase
    .from("order_items")
    .update({
      cancelled_quantity: alreadyCancelled + requestedQty,
      cancellation_reason: reasonRaw,
      cancelled_at: cancelledAt,
      cancelled_by: auth.uid,
      cancelled_by_role: role,
    })
    .eq("id", itemId)
    .eq("order_id", orderId);

  if (updItemErr) {
    return NextResponse.json({ error: "Failed to cancel item." }, { status: 500 });
  }

  const { data: allItems, error: allItemsErr } = await supabase
    .from("order_items")
    .select("quantity, cancelled_quantity, unit_price")
    .eq("order_id", orderId);

  if (allItemsErr || !allItems) {
    return NextResponse.json({ error: "Failed to recalculate order totals." }, { status: 500 });
  }

  const totals = allItems.reduce(
    (acc, row) => {
      const qty = Number(row.quantity ?? 0);
      const cancelled = Number(row.cancelled_quantity ?? 0);
      const price = Number(row.unit_price ?? 0);
      acc.totalFood += qty * price;
      acc.cancelledFood += cancelled * price;
      acc.remainingItems += Math.max(0, qty - cancelled);
      return acc;
    },
    { totalFood: 0, cancelledFood: 0, remainingItems: 0 },
  );

  const paymentId = (order.payment_id ?? "").trim();
  let refund_status: "processed" | "failed" | "pending" | "not_required" = "not_required";
  let refund_id: string | null = null;
  let refund_error: string | null = null;
  let refund_amount_paise = 0;

  if (PAYMENT_ID_RE.test(paymentId) && totals.totalFood > 0 && totals.cancelledFood > 0) {
    const ledger = await getLedger(supabase, paymentId);
    const grossPaise = Math.max(
      0,
      Number(ledger?.amount_paise ?? Math.round(Number(order.total_amount ?? 0) * 100)) || 0,
    );
    const alreadyRefunded = Math.max(0, Number(ledger?.refunded_amount_paise ?? 0) || 0);
    const cancelledRatio = Math.min(1, Math.max(0, totals.cancelledFood / totals.totalFood));
    const desiredRefunded = Math.min(grossPaise, Math.round(grossPaise * cancelledRatio));
    const incrementalRefund = Math.max(0, desiredRefunded - alreadyRefunded);

    if (incrementalRefund > 0) {
      const KEY_ID = process.env.RAZORPAY_KEY_ID || "";
      const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "";
      if (!KEY_ID || !KEY_SECRET) {
        refund_status = "pending";
        refund_error = "Razorpay credentials not configured on this server — refund must be processed manually.";
      } else {
        const rzpAuth = Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64");
        const refundBody = {
          speed: "optimum",
          amount: incrementalRefund,
          notes: {
            reason: "order_item_cancelled",
            order_id: orderId,
            item_id: itemId,
            cancelled_by_role: role,
          },
        };
        try {
          const resp = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}/refund`, {
            method: "POST",
            headers: { Authorization: `Basic ${rzpAuth}`, "Content-Type": "application/json" },
            body: JSON.stringify(refundBody),
          });
          const data = await resp.json().catch(() => ({}));
          if (resp.ok && data?.id) {
            refund_status = "processed";
            refund_id = data.id;
            refund_amount_paise = incrementalRefund;

            const newRefunded = Math.min(grossPaise, alreadyRefunded + incrementalRefund);
            await supabase
              .from("payments")
              .update({
                refunded_amount_paise: newRefunded,
                status: newRefunded >= grossPaise ? "refunded" : "partial_refund",
                updated_at: new Date().toISOString(),
              })
              .eq("razorpay_payment_id", paymentId)
              .then(() => {}, () => {});
          } else {
            refund_status = "failed";
            refund_error = data?.error?.description || `Razorpay returned status ${resp.status}.`;
          }
        } catch (e) {
          refund_status = "failed";
          refund_error = e instanceof Error ? e.message : "Refund request failed.";
        }
      }
    }
  }

  const allItemsCancelled = totals.remainingItems === 0;
  const orderUpdate: Record<string, unknown> = {
    refund_status,
    refund_id,
    updated_at: cancelledAt,
  };
  if (allItemsCancelled) {
    orderUpdate.status = "cancelled";
    orderUpdate.cancelled_at = cancelledAt;
    orderUpdate.cancelled_by = auth.uid;
    orderUpdate.cancelled_by_role = role;
    orderUpdate.cancellation_reason = `All items cancelled. Last reason: ${reasonRaw}`;
  }

  await supabase.from("orders").update(orderUpdate).eq("id", orderId).then(() => {}, () => {});

  if (allItemsCancelled) {
    const freeUpdate = {
      is_occupied: false,
      assigned_order_id: null,
      order_id: null,
      status: "empty",
      updated_at: cancelledAt,
    };
    if (order.bin_id) {
      await supabase.from("bins").update(freeUpdate).eq("id", order.bin_id).then(() => {}, () => {});
    }
    await supabase.from("bins").update(freeUpdate).eq("assigned_order_id", orderId).then(() => {}, () => {});
    await supabase.from("bins").update(freeUpdate).eq("order_id", orderId).then(() => {}, () => {});
  }

  if (order.user_id) {
    const rupees = (refund_amount_paise / 100).toFixed(2);
    const refundLine =
      refund_status === "processed"
        ? `Refund of ₹${rupees} has been initiated and will reflect in 5–7 business days.`
        : refund_status === "failed"
          ? "Refund attempt failed — our team will process it manually within 24 hours."
          : refund_status === "pending"
            ? "Refund will be processed manually within 24 hours."
            : "No payment was charged for this item cancellation.";
    await supabase.from("notifications").insert({
      title: allItemsCancelled ? "Order cancelled" : "Item cancelled from your order",
      body: `Reason: ${reasonRaw}. ${refundLine}`,
      type: "order",
      recipient_type: "user",
      recipient_id: order.user_id,
      target_role: "user",
      created_by: auth.uid,
    }).then(() => {}, () => {});
  }

  return NextResponse.json({
    success: true,
    all_items_cancelled: allItemsCancelled,
    refund: {
      status: refund_status,
      id: refund_id,
      amount_paise: refund_amount_paise,
      error: refund_error,
    },
  });
}

import { NextResponse } from "next/server";
import { getRequestContext } from "@/lib/authServer";
import { canManageOrders } from "@/lib/roleChecks";
import { menuItems } from "@/lib/menu";
import { autoAcceptPlacedOrders } from "@/lib/orderAutoAccept";
import { createAdminClient } from "@/lib/supabase-server";
import { assignDeferredBins } from "@/lib/deferredBinAssign";
import { releaseExpiredSlotBins, releaseStalePlacedInBinOrders, autoCloseEodLateOrders } from "@/lib/slotExpiry";
import { createOrder, listOrdersForUser, listRecentOrders } from "@/lib/orderRepository";
import type {
  CreateOrderRequest,
  OrderItem,
  OrderItemInput,
} from "@/types/canteen";

export const dynamic = "force-dynamic";

function validatePayload(body: unknown): body is CreateOrderRequest {
  if (!body || typeof body !== "object") {
    return false;
  }

  const payload = body as Record<string, unknown>;
  if (typeof payload.customerName !== "string") {
    return false;
  }

  if (!Array.isArray(payload.items) || payload.items.length === 0) {
    return false;
  }

  return payload.items.every((item) => {
    if (!item || typeof item !== "object") {
      return false;
    }

    const value = item as Record<string, unknown>;
    return typeof value.itemId === "string" && typeof value.quantity === "number";
  });
}

function mapOrderItems(items: OrderItemInput[]): OrderItem[] {
  return items
    .map((requested) => {
      const menuItem = menuItems.find((item) => item.id === requested.itemId && item.available);
      if (!menuItem || requested.quantity < 1 || !Number.isInteger(requested.quantity)) {
        return null;
      }

      const lineTotal = menuItem.price * requested.quantity;
      return {
        itemId: menuItem.id,
        name: menuItem.name,
        unitPrice: menuItem.price,
        quantity: requested.quantity,
        lineTotal,
      };
    })
    .filter((item): item is OrderItem => item !== null);
}

export async function GET(request: Request) {
  try {
    const context = await getRequestContext(request);
    if (!context) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    try {
      const isPlatformAdmin = (context.role === "super_admin" || context.role === "co_admin") && !context.canteenId;
      const adminSupa = createAdminClient();
      if (canManageOrders(context.role)) {
        if (isPlatformAdmin) {
          await autoAcceptPlacedOrders({ supabase: adminSupa }).catch(() => {});
        } else if (context.canteenId) {
          // Each step has its own .catch() so one failure never silently
          // blocks assignDeferredBins — the critical step for bin assignment.
          await autoAcceptPlacedOrders({ supabase: adminSupa, canteenId: context.canteenId }).catch(() => {});
          await releaseExpiredSlotBins(adminSupa, context.canteenId).catch(() => {});
          await releaseStalePlacedInBinOrders(adminSupa, context.canteenId).catch(() => {});
          await autoCloseEodLateOrders(adminSupa, context.canteenId).catch(() => {});
          await assignDeferredBins(adminSupa, context.canteenId).catch(() => {});
        }
      } else {
        await autoAcceptPlacedOrders({ supabase: adminSupa, userId: context.uid }).catch(() => {});
      }
    } catch (e) {
      // Auto-accept is best-effort; listing orders should still work.
      console.warn("[orders] auto-accept skipped", e);
    }

    let orders: Awaited<ReturnType<typeof listRecentOrders>> = [];
    if (canManageOrders(context.role)) {
      // Multi-tenant isolation: vendor / canteen_admin / worker only ever see
      // their own canteen's orders. Only super_admin / co_admin (no canteen)
      // see the global feed. Without this, two canteen admins logging in on
      // the same instance would each see every other canteen's live orders.
      const isPlatformAdmin = (context.role === "super_admin" || context.role === "co_admin") && !context.canteenId;
      if (isPlatformAdmin) {
        orders = await listRecentOrders(200);
      } else if (context.canteenId) {
        orders = await listRecentOrders(200, context.canteenId);
      } else {
        // Staff role with no assigned canteen — return nothing rather than
        // leaking another canteen's orders.
        orders = [];
      }
    } else {
      orders = await listOrdersForUser(context.uid);
    }

    // Surface slot_mode so client UIs (worker / vendor / student) can decide
    // whether the client-side "slot ended → LATE" badge should fire. In
    // batched_only the slot is just bookkeeping — only the 5-min after-bin
    // timer marks an order late.
    let slot_mode: "both" | "batched_only" = "both";
    if (context.canteenId) {
      const adminSupa = createAdminClient();
      const { data: control } = await adminSupa
        .from("slot_control")
        .select("slot_mode")
        .eq("canteen_id", context.canteenId)
        .maybeSingle();
      if ((control as { slot_mode?: string } | null)?.slot_mode === "batched_only") {
        slot_mode = "batched_only";
      }
    }

    return NextResponse.json({ orders, role: context.role, slot_mode });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load orders.";
    return NextResponse.json({ error: msg, orders: [] }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let context;
  try {
    context = await getRequestContext(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (!context) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const body = (await request.json().catch(() => null)) as unknown;

  if (!validatePayload(body)) {
    return NextResponse.json({ error: "Invalid order payload." }, { status: 400 });
  }

  const customerName = body.customerName.trim();
  if (customerName.length < 2 || customerName.length > 40) {
    return NextResponse.json({ error: "Customer name must be between 2 and 40 characters." }, { status: 400 });
  }

  const orderItems = mapOrderItems(body.items);
  if (orderItems.length === 0) {
    return NextResponse.json({ error: "Order items are invalid or unavailable." }, { status: 400 });
  }

  const total = orderItems.reduce((sum, item) => sum + item.lineTotal, 0);
  const newOrder = await createOrder({
    uid: context.uid,
    customerName,
    items: orderItems,
    total,
    status: "received",
    createdAt: new Date().toISOString(),
  });

  return NextResponse.json({ order: newOrder }, { status: 201 });
}

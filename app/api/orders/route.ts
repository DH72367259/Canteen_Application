import { NextResponse } from "next/server";
import { getRequestContext } from "@/lib/authServer";
import { canManageOrders } from "@/lib/roleChecks";
import { menuItems } from "@/lib/menu";
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
    const orders = canManageOrders(context.role)
      ? await listRecentOrders(200)
      : await listOrdersForUser(context.uid);

    return NextResponse.json({ orders, role: context.role });
  } catch {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
}

export async function POST(request: Request) {
  let context;
  try {
    context = await getRequestContext(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

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

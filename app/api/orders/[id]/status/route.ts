import { NextResponse } from "next/server";
import { getRequestContext } from "@/lib/authServer";
import { canManageOrders } from "@/lib/roleChecks";
import { updateOrderStatus } from "@/lib/orderRepository";
import type { OrderStatus } from "@/types/canteen";

const validStatuses: OrderStatus[] = ["received", "preparing", "ready", "completed", "cancelled"];

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

  if (!canManageOrders(auth.role)) {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  const payload = (await request.json().catch(() => null)) as {
    status?: OrderStatus;
  } | null;

  const status = payload?.status;
  if (!status || !validStatuses.includes(status)) {
    return NextResponse.json({ error: "Invalid status." }, { status: 400 });
  }

  const { id } = await context.params;
  const updated = await updateOrderStatus(id, status);
  if (!updated) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }

  return NextResponse.json({ order: updated });
}

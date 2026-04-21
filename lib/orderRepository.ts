import { randomUUID } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDb } from "@/lib/firebaseAdmin";
import type { CanteenOrder, OrderStatus } from "@/types/canteen";

function ordersCollection() {
  return getAdminDb().collection("orders");
}

type FirestoreOrder = {
  id: string;
  uid: string;
  customerName: string;
  items: CanteenOrder["items"];
  total: number;
  status: OrderStatus;
  createdAt: string;
  updatedAt: string;
};

function toCanteenOrder(payload: FirestoreOrder): CanteenOrder {
  return {
    id: payload.id,
    uid: payload.uid,
    customerName: payload.customerName,
    items: payload.items,
    total: payload.total,
    status: payload.status,
    createdAt: payload.createdAt,
  };
}

export async function listOrdersForUser(uid: string): Promise<CanteenOrder[]> {
  const snapshot = await ordersCollection()
    .where("uid", "==", uid)
    .orderBy("createdAt", "desc")
    .limit(50)
    .get();

  return snapshot.docs.map((entry) => toCanteenOrder(entry.data() as FirestoreOrder));
}

export async function listRecentOrders(limitCount = 100): Promise<CanteenOrder[]> {
  const snapshot = await ordersCollection().orderBy("createdAt", "desc").limit(limitCount).get();
  return snapshot.docs.map((entry) => toCanteenOrder(entry.data() as FirestoreOrder));
}

export async function createOrder(order: Omit<FirestoreOrder, "id" | "updatedAt">): Promise<CanteenOrder> {
  const id = `ORD-${randomUUID().slice(0, 8).toUpperCase()}`;
  const now = new Date().toISOString();

  const payload: FirestoreOrder = {
    ...order,
    id,
    createdAt: order.createdAt ?? now,
    updatedAt: now,
  };

  await ordersCollection().doc(id).set({
    ...payload,
    serverCreatedAt: FieldValue.serverTimestamp(),
    serverUpdatedAt: FieldValue.serverTimestamp(),
  });

  return toCanteenOrder(payload);
}

export async function updateOrderStatus(id: string, status: OrderStatus): Promise<CanteenOrder | null> {
  const ref = ordersCollection().doc(id);
  const snapshot = await ref.get();
  if (!snapshot.exists) {
    return null;
  }

  const updatedAt = new Date().toISOString();
  await ref.update({
    status,
    updatedAt,
    serverUpdatedAt: FieldValue.serverTimestamp(),
  });

  const merged = {
    ...(snapshot.data() as FirestoreOrder),
    status,
    updatedAt,
  };

  return toCanteenOrder(merged);
}

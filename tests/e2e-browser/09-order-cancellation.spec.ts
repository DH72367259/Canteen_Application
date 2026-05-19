/**
 * 09-order-cancellation.spec.ts
 * Order cancellation: staff can cancel with reason, students cannot,
 * already-cancelled orders reject re-cancel.
 */
import { test, expect } from "@playwright/test";
import { apiFetch, ACCOUNTS, adminClient, getCanteen1Id, getStudent1Id } from "./_helpers";

async function getAnyActiveOrder() {
  const db = adminClient();
  const { data } = await db
    .from("orders")
    .select("id, status, canteen_id")
    .in("status", ["placed", "confirmed", "placed_in_bin", "ready_for_pickup"])
    .limit(1);
  return data?.[0] ?? null;
}

async function placeTestOrder(canteenId: string): Promise<string | null> {
  const db = adminClient();
  const { data: items } = await db
    .from("menu_items")
    .select("id")
    .eq("canteen_id", canteenId)
    .eq("is_available", true)
    .limit(1);
  if (!items?.length) return null;

  const { data: sc } = await db
    .from("slot_control")
    .select("morning_start, slot_duration_mins")
    .eq("canteen_id", canteenId)
    .maybeSingle();

  const start = sc?.morning_start ?? "08:00";
  const dur = sc?.slot_duration_mins ?? 15;
  const [h, m] = start.split(":").map(Number);
  const endMin = m + dur;
  const slotLabel = `${start} - ${String(Math.floor(h + endMin / 60)).padStart(2, "0")}:${String(endMin % 60).padStart(2, "0")}`;

  // orders.user_id is NOT NULL on staging — must point at a real profile
  const userId = await getStudent1Id().catch(() => null);
  const { data: orderData, error } = await db
    .from("orders")
    .insert({
      canteen_id: canteenId,
      user_id: userId,
      status: "placed",
      total_amount: 80,
      slot_label: slotLabel,
      otp: "123456",
    })
    .select("id")
    .single();
  if (error) return null;

  await db.from("order_items").insert({
    order_id: orderData.id,
    menu_item_id: items[0].id,
    quantity: 1,
    // Real schema column is `unit_price`; older test code used the wrong name.
    unit_price: 80,
  });

  return orderData.id;
}

test.describe("Order cancellation — access control", () => {
  test("student cannot cancel any order via API", async () => {
    const order = await getAnyActiveOrder();
    if (!order) { test.skip(); return; }

    const res = await apiFetch(`/api/orders/${order.id}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "test" }),
    }, ACCOUNTS.student1);
    expect(res.status).toBe(403);
  });

  test("worker cannot cancel orders", async () => {
    const order = await getAnyActiveOrder();
    if (!order) { test.skip(); return; }

    const res = await apiFetch(`/api/orders/${order.id}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "test" }),
    }, ACCOUNTS.worker);
    expect(res.status).toBe(403);
  });

  test("unauthenticated request is rejected", async () => {
    const canteenId = await getCanteen1Id();
    const res = await fetch(`${process.env.APP_BASE_URL ?? "http://localhost:3000"}/api/orders/fake-id/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "test" }),
    });
    expect(res.status).toBe(401);
  });
});

test.describe("Order cancellation — validation", () => {
  let canteenId: string;

  test.beforeAll(async () => {
    canteenId = await getCanteen1Id();
  });

  test("cancel without reason is rejected (400)", async () => {
    const orderId = await placeTestOrder(canteenId);
    if (!orderId) { test.skip(); return; }

    const res = await apiFetch(`/api/orders/${orderId}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "" }),
    }, ACCOUNTS.canteenAdmin);
    expect(res.status).toBe(400);

    await adminClient().from("orders").delete().eq("id", orderId);
  });

  test("cancel non-existent order returns 404", async () => {
    const res = await apiFetch("/api/orders/00000000-0000-0000-0000-000000000000/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "Test cancellation" }),
    }, ACCOUNTS.canteenAdmin);
    expect([404, 400]).toContain(res.status);
  });

  test("canteen_admin can cancel an active order with reason", async () => {
    const orderId = await placeTestOrder(canteenId);
    if (!orderId) { test.skip(); return; }

    const res = await apiFetch(`/api/orders/${orderId}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "E2E test cancellation" }),
    }, ACCOUNTS.canteenAdmin);
    expect(res.status).toBe(200);

    const db = adminClient();
    const { data } = await db.from("orders").select("status").eq("id", orderId).single();
    expect(data?.status).toBe("cancelled");
    await db.from("orders").delete().eq("id", orderId);
  });

  test("super_admin can cancel any order with reason", async () => {
    const orderId = await placeTestOrder(canteenId);
    if (!orderId) { test.skip(); return; }

    const res = await apiFetch(`/api/orders/${orderId}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "Admin override cancellation" }),
    }, ACCOUNTS.superAdmin);
    expect(res.status).toBe(200);
    await adminClient().from("orders").delete().eq("id", orderId);
  });

  test("re-cancelling an already-cancelled order is rejected", async () => {
    const orderId = await placeTestOrder(canteenId);
    if (!orderId) { test.skip(); return; }

    await apiFetch(`/api/orders/${orderId}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "First cancel" }),
    }, ACCOUNTS.canteenAdmin);

    const res2 = await apiFetch(`/api/orders/${orderId}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "Second cancel" }),
    }, ACCOUNTS.canteenAdmin);
    expect(res2.status).toBe(400);
    await adminClient().from("orders").delete().eq("id", orderId);
  });

  test("cancel reason over 280 chars is rejected", async () => {
    const orderId = await placeTestOrder(canteenId);
    if (!orderId) { test.skip(); return; }

    const longReason = "A".repeat(281);
    const res = await apiFetch(`/api/orders/${orderId}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: longReason }),
    }, ACCOUNTS.canteenAdmin);
    expect(res.status).toBe(400);
    await adminClient().from("orders").delete().eq("id", orderId);
  });
});

test.describe("Order cancellation — cross-canteen isolation", () => {
  test("canteen2_admin cannot cancel canteen1 orders", async () => {
    const canteenId = await getCanteen1Id();
    const orderId = await placeTestOrder(canteenId);
    if (!orderId) { test.skip(); return; }

    const res = await apiFetch(`/api/orders/${orderId}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "Attempted cross-canteen cancel" }),
    }, ACCOUNTS.canteen2Admin);
    expect([403, 404]).toContain(res.status);

    await adminClient().from("orders").delete().eq("id", orderId);
  });
});

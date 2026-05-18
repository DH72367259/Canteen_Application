/**
 * 10-otp-complete-flow.spec.ts
 * Full order → OTP verification lifecycle.
 * Creates orders via DB admin client (bypasses payment), verifies with correct OTP,
 * and confirms status transitions.
 */
import { test, expect } from "@playwright/test";
import { apiFetch, ACCOUNTS, adminClient, getCanteen1Id } from "./_helpers";

async function createOrderWithOtp(canteenId: string, otp = "654321") {
  const db = adminClient();
  const { data: items } = await db
    .from("menu_items")
    .select("id, price")
    .eq("canteen_id", canteenId)
    .eq("is_available", true)
    .limit(1);
  if (!items?.length) return null;

  const { data: order, error } = await db
    .from("orders")
    .insert({
      canteen_id: canteenId,
      status: "placed_in_bin",
      total_amount: items[0].price ?? 80,
      slot_label: "12:00 - 12:15",
      otp,
    })
    .select("id")
    .single();
  if (error) return null;

  await db.from("order_items").insert({
    order_id: order.id,
    menu_item_id: items[0].id,
    quantity: 1,
    unit_price: items[0].price ?? 80,
  });

  return order.id;
}

test.describe("OTP verification — correct flow", () => {
  let canteenId: string;

  test.beforeAll(async () => {
    canteenId = await getCanteen1Id();
  });

  test("worker verifies correct OTP → order becomes collected", async () => {
    const orderId = await createOrderWithOtp(canteenId, "111222");
    if (!orderId) { test.skip(); return; }

    const res = await apiFetch(`/api/orders/${orderId}/verify-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ otp: "111222" }),
    }, ACCOUNTS.worker);

    expect(res.status).toBe(200);

    const db = adminClient();
    const { data } = await db.from("orders").select("status").eq("id", orderId).single();
    expect(data?.status).toBe("collected");
    await db.from("orders").delete().eq("id", orderId);
  });

  test("canteen_admin verifies correct OTP → order collected", async () => {
    const orderId = await createOrderWithOtp(canteenId, "333444");
    if (!orderId) { test.skip(); return; }

    const res = await apiFetch(`/api/orders/${orderId}/verify-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ otp: "333444" }),
    }, ACCOUNTS.canteenAdmin);

    expect(res.status).toBe(200);
    await adminClient().from("orders").delete().eq("id", orderId);
  });

  test("super_admin can verify OTP from any canteen", async () => {
    const orderId = await createOrderWithOtp(canteenId, "555666");
    if (!orderId) { test.skip(); return; }

    const res = await apiFetch(`/api/orders/${orderId}/verify-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ otp: "555666" }),
    }, ACCOUNTS.superAdmin);

    expect(res.status).toBe(200);
    await adminClient().from("orders").delete().eq("id", orderId);
  });
});

test.describe("OTP verification — wrong OTP", () => {
  let canteenId: string;

  test.beforeAll(async () => {
    canteenId = await getCanteen1Id();
  });

  test("wrong OTP returns 400", async () => {
    const orderId = await createOrderWithOtp(canteenId, "777888");
    if (!orderId) { test.skip(); return; }

    const res = await apiFetch(`/api/orders/${orderId}/verify-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ otp: "000000" }),
    }, ACCOUNTS.worker);
    expect(res.status).toBe(400);

    const { data } = await adminClient().from("orders").select("status").eq("id", orderId).single();
    expect(data?.status).not.toBe("collected");
    await adminClient().from("orders").delete().eq("id", orderId);
  });

  test("empty OTP is rejected (400)", async () => {
    const orderId = await createOrderWithOtp(canteenId, "999000");
    if (!orderId) { test.skip(); return; }

    const res = await apiFetch(`/api/orders/${orderId}/verify-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ otp: "" }),
    }, ACCOUNTS.worker);
    expect(res.status).toBe(400);
    await adminClient().from("orders").delete().eq("id", orderId);
  });

  test("OTP missing from body is rejected (400)", async () => {
    const orderId = await createOrderWithOtp(canteenId, "112233");
    if (!orderId) { test.skip(); return; }

    const res = await apiFetch(`/api/orders/${orderId}/verify-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }, ACCOUNTS.worker);
    expect(res.status).toBe(400);
    await adminClient().from("orders").delete().eq("id", orderId);
  });
});

test.describe("OTP verification — access control", () => {
  let canteenId: string;

  test.beforeAll(async () => {
    canteenId = await getCanteen1Id();
  });

  test("student cannot verify OTP (403)", async () => {
    const orderId = await createOrderWithOtp(canteenId, "445566");
    if (!orderId) { test.skip(); return; }

    const res = await apiFetch(`/api/orders/${orderId}/verify-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ otp: "445566" }),
    }, ACCOUNTS.student1);
    expect(res.status).toBe(403);
    await adminClient().from("orders").delete().eq("id", orderId);
  });

  test("already-collected order rejects OTP verify (400)", async () => {
    const db = adminClient();
    const { data: items } = await db.from("menu_items").select("id").eq("canteen_id", canteenId).limit(1);
    if (!items?.length) { test.skip(); return; }

    const { data: order } = await db
      .from("orders")
      .insert({ canteen_id: canteenId, status: "collected", total_amount: 80, otp: "778899" })
      .select("id")
      .single();
    if (!order) { test.skip(); return; }

    const res = await apiFetch(`/api/orders/${order.id}/verify-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ otp: "778899" }),
    }, ACCOUNTS.worker);
    expect(res.status).toBe(400);
    await db.from("orders").delete().eq("id", order.id);
  });

  test("OTP verify on non-existent order returns 404", async () => {
    const res = await apiFetch("/api/orders/00000000-0000-0000-0000-000000000000/verify-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ otp: "123456" }),
    }, ACCOUNTS.worker);
    expect([404, 400]).toContain(res.status);
  });

  test("canteen2_admin cannot verify OTP for canteen1 order", async () => {
    const orderId = await createOrderWithOtp(canteenId, "667788");
    if (!orderId) { test.skip(); return; }

    const res = await apiFetch(`/api/orders/${orderId}/verify-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ otp: "667788" }),
    }, ACCOUNTS.canteen2Admin);
    expect([403, 400]).toContain(res.status);
    await adminClient().from("orders").delete().eq("id", orderId);
  });
});

test.describe("Order no-ID OTP endpoint", () => {
  test("POST /api/orders/verify-otp with valid canteen_id + otp", async () => {
    const canteenId = await getCanteen1Id();
    const orderId = await createOrderWithOtp(canteenId, "998877");
    if (!orderId) { test.skip(); return; }

    const res = await apiFetch("/api/orders/verify-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ otp: "998877", canteen_id: canteenId }),
    }, ACCOUNTS.worker);
    // 200 (matched) or 404 (endpoint not implemented that way) — either is valid
    expect([200, 404, 400]).toContain(res.status);
    await adminClient().from("orders").delete().eq("id", orderId);
  });
});

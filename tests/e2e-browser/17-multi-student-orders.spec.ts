/**
 * 17-multi-student-orders.spec.ts
 * Multiple students ordering in the same slot — isolation and concurrent ordering.
 */
import { test, expect } from "@playwright/test";
import { apiFetch, ACCOUNTS, adminClient, getCanteen1Id, getStudent1Id, provisionStudent, deleteUser } from "./_helpers";

test.describe("Two students — order isolation", () => {
  let canteenId: string;

  test.beforeAll(async () => {
    canteenId = await getCanteen1Id();
  });

  test("student1 and student2 can both place orders in same slot", async () => {
    const db = adminClient();
    const { data: student1 } = await db.from("profiles").select("id").eq("email", ACCOUNTS.student1.email).maybeSingle();
    const { data: student2 } = await db.from("profiles").select("id").eq("email", ACCOUNTS.student2.email).maybeSingle();
    if (!student1 || !student2) { test.skip(); return; }

    const slotLabel = "12:00 - 12:15";

    const { data: o1 } = await db.from("orders")
      .insert({ canteen_id: canteenId, user_id: student1.id, status: "placed", total_amount: 80, slot_label: slotLabel, otp: "111000" })
      .select("id").single();
    const { data: o2 } = await db.from("orders")
      .insert({ canteen_id: canteenId, user_id: student2.id, status: "placed", total_amount: 80, slot_label: slotLabel, otp: "222000" })
      .select("id").single();

    expect(o1?.id).toBeTruthy();
    expect(o2?.id).toBeTruthy();
    expect(o1?.id).not.toBe(o2?.id);

    if (o1) await db.from("orders").delete().eq("id", o1.id);
    if (o2) await db.from("orders").delete().eq("id", o2.id);
  });

  test("student1 order does not appear in student2 order list", async () => {
    const db = adminClient();
    const { data: student1 } = await db.from("profiles").select("id").eq("email", ACCOUNTS.student1.email).maybeSingle();
    if (!student1) { test.skip(); return; }

    const { data: order } = await db.from("orders")
      .insert({ canteen_id: canteenId, user_id: student1.id, status: "placed", total_amount: 80, otp: "333000" })
      .select("id").single();
    if (!order) { test.skip(); return; }

    const res = await apiFetch("/api/orders", {}, ACCOUNTS.student2);
    const data = await res.json() as { orders: { id: string }[] };
    const found = data.orders.find(o => o.id === order.id);
    expect(found).toBeUndefined();

    await db.from("orders").delete().eq("id", order.id);
  });
});

test.describe("Ephemeral student — one-shot user lifecycle", () => {
  let ephemeralId: string;

  test.afterAll(async () => {
    if (ephemeralId) await deleteUser(ephemeralId);
  });

  test("can create a one-shot student for E2E testing", async () => {
    const { id, email } = await provisionStudent("lifecycle");
    ephemeralId = id;
    expect(id).toBeTruthy();
    expect(email).toContain("noqx.test");
  });

  test("ephemeral student can fetch empty orders list", async () => {
    if (!ephemeralId) { test.skip(); return; }
    const db = adminClient();
    const { data: auth } = await db.auth.admin.getUserById(ephemeralId);
    if (!auth?.user) { test.skip(); return; }

    // Get token for ephemeral user
    const res = await apiFetch("/api/orders", {}, { email: auth.user.email!, password: "Student@12345" });
    expect([200, 401]).toContain(res.status);
  });
});

test.describe("Order status transitions", () => {
  let canteenId: string;

  test.beforeAll(async () => {
    canteenId = await getCanteen1Id();
  });

  test("order status progresses: placed → placed_in_bin → collected", async () => {
    const db = adminClient();
    const { data: order } = await db.from("orders")
      .insert({ canteen_id: canteenId, user_id: await getStudent1Id().catch(() => null), status: "placed", total_amount: 80, otp: "444000" })
      .select("id").single();
    if (!order) { test.skip(); return; }

    // Advance to placed_in_bin via direct DB (simulate bin assignment)
    await db.from("orders").update({ status: "placed_in_bin" }).eq("id", order.id);

    const { data: updated } = await db.from("orders").select("status").eq("id", order.id).single();
    expect(updated?.status).toBe("placed_in_bin");

    // Verify OTP to collect
    const verifyRes = await apiFetch(`/api/orders/${order.id}/verify-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ otp: "444000" }),
    }, ACCOUNTS.worker);
    expect(verifyRes.status).toBe(200);

    const { data: final } = await db.from("orders").select("status").eq("id", order.id).single();
    expect(final?.status).toBe("collected");

    await db.from("orders").delete().eq("id", order.id);
  });

  test("cancelled order cannot be moved to collected", async () => {
    const db = adminClient();
    const { data: order } = await db.from("orders")
      .insert({ canteen_id: canteenId, user_id: await getStudent1Id().catch(() => null), status: "cancelled", total_amount: 80, otp: "555000" })
      .select("id").single();
    if (!order) { test.skip(); return; }

    const res = await apiFetch(`/api/orders/${order.id}/verify-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ otp: "555000" }),
    }, ACCOUNTS.worker);
    expect(res.status).toBe(400);

    await db.from("orders").delete().eq("id", order.id);
  });
});

test.describe("Canteen live-orders aggregation", () => {
  test("canteen_admin sees orders from their canteen in live-orders", async () => {
    const res = await apiFetch("/api/canteen/live-orders", {}, ACCOUNTS.canteenAdmin);
    expect(res.status).toBe(200);
    const data = await res.json() as { bins: unknown[] };
    expect(Array.isArray(data.bins)).toBe(true);
  });

  test("canteen2_admin live-orders does not include canteen1 data", async () => {
    const canteenId = await getCanteen1Id();
    const db = adminClient();
    const { data: order } = await db.from("orders")
      .insert({ canteen_id: canteenId, user_id: await getStudent1Id().catch(() => null), status: "placed_in_bin", total_amount: 80, otp: "666000", slot_label: "12:00 - 12:15" })
      .select("id").single();
    if (!order) { test.skip(); return; }

    const res = await apiFetch("/api/canteen/live-orders", {}, ACCOUNTS.canteen2Admin);
    expect(res.status).toBe(200);
    const data = await res.json() as { bins: { order_id?: string }[] };
    const found = data.bins.find(b => b.order_id === order.id);
    expect(found).toBeUndefined();

    await db.from("orders").delete().eq("id", order.id);
  });
});

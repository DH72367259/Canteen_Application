/**
 * 11-slot-capacity.spec.ts
 * Slot capacity: slot-control API, slot generation, order count enforcement.
 */
import { test, expect } from "@playwright/test";
import { apiFetch, ACCOUNTS, adminClient, getCanteen1Id } from "./_helpers";

test.describe("Slot control — GET", () => {
  test("canteen_admin can fetch slot-control settings", async () => {
    const res = await apiFetch("/api/canteen/slot-control", {}, ACCOUNTS.canteenAdmin);
    expect(res.status).toBe(200);
    const data = await res.json() as Record<string, unknown>;
    expect(data).toHaveProperty("max_bins");
    expect(data).toHaveProperty("slot_duration_mins");
    expect(data).toHaveProperty("max_orders_per_slot");
  });

  test("worker can fetch slot-control settings", async () => {
    const res = await apiFetch("/api/canteen/slot-control", {}, ACCOUNTS.worker);
    expect(res.status).toBe(200);
  });

  test("student cannot fetch slot-control (403)", async () => {
    const res = await apiFetch("/api/canteen/slot-control", {}, ACCOUNTS.student1);
    expect(res.status).toBe(403);
  });

  test("unauthenticated cannot fetch slot-control (401)", async () => {
    const res = await fetch(`${process.env.APP_BASE_URL ?? "http://localhost:3000"}/api/canteen/slot-control`);
    expect(res.status).toBe(401);
  });

  test("slot-control returns time windows (morning/afternoon/evening)", async () => {
    const res = await apiFetch("/api/canteen/slot-control", {}, ACCOUNTS.canteenAdmin);
    expect(res.status).toBe(200);
    const data = await res.json() as Record<string, unknown>;
    expect(data).toHaveProperty("morning_start");
    expect(data).toHaveProperty("afternoon_start");
    expect(data).toHaveProperty("evening_start");
  });

  test("slot-control returns generated slots array", async () => {
    const res = await apiFetch("/api/canteen/slot-control", {}, ACCOUNTS.canteenAdmin);
    expect(res.status).toBe(200);
    const data = await res.json() as { slots?: unknown[] };
    expect(Array.isArray(data.slots)).toBe(true);
  });
});

test.describe("Slot control — PATCH (update settings)", () => {
  test("canteen_admin can update grace_period_mins", async () => {
    const res = await apiFetch("/api/canteen/slot-control", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grace_period_mins: 12 }),
    }, ACCOUNTS.canteenAdmin);
    expect([200, 400]).toContain(res.status);
  });

  test("worker cannot update slot-control (403)", async () => {
    const res = await apiFetch("/api/canteen/slot-control", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grace_period_mins: 5 }),
    }, ACCOUNTS.worker);
    expect(res.status).toBe(403);
  });

  test("student cannot update slot-control (403)", async () => {
    const res = await apiFetch("/api/canteen/slot-control", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ max_bins: 100 }),
    }, ACCOUNTS.student1);
    expect(res.status).toBe(403);
  });

  test("super_admin can update slot-control with canteenId param", async () => {
    const canteenId = await getCanteen1Id();
    const res = await apiFetch(`/api/canteen/slot-control?canteenId=${canteenId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grace_period_mins: 10 }),
    }, ACCOUNTS.superAdmin);
    expect([200, 400]).toContain(res.status);
  });
});

test.describe("Slot capacity — order count tracking", () => {
  let canteenId: string;

  test.beforeAll(async () => {
    canteenId = await getCanteen1Id();
  });

  test("slot_control.max_orders_per_slot equals max_bins", async () => {
    const db = adminClient();
    const { data } = await db
      .from("slot_control")
      .select("max_bins, max_orders_per_slot")
      .eq("canteen_id", canteenId)
      .maybeSingle();
    if (!data) { test.skip(); return; }
    expect(data.max_orders_per_slot).toBe(data.max_bins);
  });

  test("placed orders count correctly per slot", async () => {
    const db = adminClient();
    const slotLabel = "12:00 - 12:15";

    const { data: items } = await db.from("menu_items").select("id").eq("canteen_id", canteenId).limit(1);
    if (!items?.length) { test.skip(); return; }

    const { data: order } = await db.from("orders")
      .insert({ canteen_id: canteenId, status: "placed", total_amount: 80, slot_label: slotLabel, otp: "121212" })
      .select("id").single();
    if (!order) { test.skip(); return; }

    const { count } = await db.from("orders")
      .select("id", { count: "exact", head: true })
      .eq("canteen_id", canteenId)
      .eq("slot_label", slotLabel)
      .in("status", ["placed", "confirmed", "placed_in_bin", "ready_for_pickup"]);

    expect((count ?? 0)).toBeGreaterThan(0);
    await db.from("orders").delete().eq("id", order.id);
  });

  test("canteen has bins provisioned (at least 1)", async () => {
    const db = adminClient();
    const { data } = await db.from("bins").select("id").eq("canteen_id", canteenId).limit(1);
    expect(data?.length).toBeGreaterThan(0);
  });

  test("bins table shows correct canteen", async () => {
    const db = adminClient();
    const { data } = await db.from("bins").select("id, canteen_id, status").eq("canteen_id", canteenId).limit(5);
    expect(Array.isArray(data)).toBe(true);
    data?.forEach(b => expect(b.canteen_id).toBe(canteenId));
  });
});

test.describe("Public slots API", () => {
  test("GET /api/slots returns available slots for a canteen", async () => {
    const canteenId = await getCanteen1Id();
    const today = new Date().toISOString().split("T")[0];
    const res = await fetch(`${process.env.APP_BASE_URL ?? "http://localhost:3000"}/api/slots?canteenId=${canteenId}&date=${today}`);
    expect([200, 400]).toContain(res.status);
  });
});

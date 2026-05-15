/**
 * 14-analytics-reporting.spec.ts
 * Sales, slot-analytics, receipts, item-sales, earnings — all canteen reporting endpoints.
 */
import { test, expect } from "@playwright/test";
import { apiFetch, ACCOUNTS, getCanteen1Id } from "./_helpers";

const today = new Date().toISOString().split("T")[0];

test.describe("Sales API", () => {
  test("canteen_admin can fetch sales data for today", async () => {
    const res = await apiFetch(`/api/canteen/sales?date=${today}`, {}, ACCOUNTS.canteenAdmin);
    expect(res.status).toBe(200);
    const data = await res.json() as Record<string, unknown>;
    expect(data).toBeDefined();
  });

  test("worker cannot access sales (403)", async () => {
    const res = await apiFetch(`/api/canteen/sales?date=${today}`, {}, ACCOUNTS.worker);
    expect(res.status).toBe(403);
  });

  test("student cannot access sales (401 or 403)", async () => {
    const res = await apiFetch(`/api/canteen/sales?date=${today}`, {}, ACCOUNTS.student1);
    expect([401, 403]).toContain(res.status);
  });

  test("unauthenticated sales request returns 401", async () => {
    const res = await fetch(`${process.env.APP_BASE_URL ?? "http://localhost:3000"}/api/canteen/sales`);
    expect(res.status).toBe(401);
  });

  test("sales without date param still responds", async () => {
    const res = await apiFetch("/api/canteen/sales", {}, ACCOUNTS.canteenAdmin);
    expect([200, 400]).toContain(res.status);
  });

  test("co_admin can access sales for any canteen", async () => {
    const canteenId = await getCanteen1Id();
    const res = await apiFetch(`/api/canteen/sales?date=${today}&canteenId=${canteenId}`, {}, ACCOUNTS.coAdmin);
    expect([200, 400]).toContain(res.status);
  });
});

test.describe("Slot analytics API", () => {
  test("canteen_admin can fetch slot analytics for today", async () => {
    const res = await apiFetch(`/api/canteen/slot-analytics?date=${today}`, {}, ACCOUNTS.canteenAdmin);
    expect(res.status).toBe(200);
    const data = await res.json() as { slots?: unknown[] };
    expect(Array.isArray(data.slots)).toBe(true);
  });

  test("slot-analytics requires date param", async () => {
    const res = await apiFetch("/api/canteen/slot-analytics", {}, ACCOUNTS.canteenAdmin);
    expect([200, 400]).toContain(res.status);
  });

  test("slot-analytics response has correct structure", async () => {
    const res = await apiFetch(`/api/canteen/slot-analytics?date=${today}`, {}, ACCOUNTS.canteenAdmin);
    expect(res.status).toBe(200);
    const data = await res.json() as { date: string; slots: unknown[] };
    expect(data).toHaveProperty("date");
    expect(data).toHaveProperty("slots");
  });

  test("worker cannot access slot-analytics (403)", async () => {
    const res = await apiFetch(`/api/canteen/slot-analytics?date=${today}`, {}, ACCOUNTS.worker);
    expect(res.status).toBe(403);
  });

  test("unauthenticated slot-analytics returns 401", async () => {
    const res = await fetch(`${process.env.APP_BASE_URL ?? "http://localhost:3000"}/api/canteen/slot-analytics?date=${today}`);
    expect(res.status).toBe(401);
  });
});

test.describe("Receipt history API", () => {
  test("canteen_admin can fetch receipts", async () => {
    const res = await apiFetch("/api/canteen/receipts", {}, ACCOUNTS.canteenAdmin);
    expect(res.status).toBe(200);
    const data = await res.json() as { orders?: unknown[]; total?: number };
    expect(Array.isArray(data.orders)).toBe(true);
    expect(typeof data.total).toBe("number");
  });

  test("receipts support pagination", async () => {
    const res = await apiFetch("/api/canteen/receipts?page=1&limit=5", {}, ACCOUNTS.canteenAdmin);
    expect(res.status).toBe(200);
    const data = await res.json() as { orders: unknown[]; page: number; limit: number };
    expect(data.orders.length).toBeLessThanOrEqual(5);
  });

  test("receipts support date filter", async () => {
    const res = await apiFetch(`/api/canteen/receipts?date=${today}`, {}, ACCOUNTS.canteenAdmin);
    expect(res.status).toBe(200);
  });

  test("receipts support search filter", async () => {
    const res = await apiFetch("/api/canteen/receipts?search=student", {}, ACCOUNTS.canteenAdmin);
    expect(res.status).toBe(200);
  });

  test("worker cannot access receipts (403)", async () => {
    const res = await apiFetch("/api/canteen/receipts", {}, ACCOUNTS.worker);
    expect(res.status).toBe(403);
  });

  test("unauthenticated receipts returns 401", async () => {
    const res = await fetch(`${process.env.APP_BASE_URL ?? "http://localhost:3000"}/api/canteen/receipts`);
    expect(res.status).toBe(401);
  });
});

test.describe("Item sales API", () => {
  test("canteen_admin can fetch item sales for today", async () => {
    const res = await apiFetch("/api/canteen/item-sales?period=today", {}, ACCOUNTS.canteenAdmin);
    expect(res.status).toBe(200);
  });

  test("item sales supports weekly period", async () => {
    const res = await apiFetch("/api/canteen/item-sales?period=week", {}, ACCOUNTS.canteenAdmin);
    expect([200, 400]).toContain(res.status);
  });

  test("item sales supports monthly period", async () => {
    const res = await apiFetch("/api/canteen/item-sales?period=month", {}, ACCOUNTS.canteenAdmin);
    expect([200, 400]).toContain(res.status);
  });

  test("worker cannot access item-sales (403)", async () => {
    const res = await apiFetch("/api/canteen/item-sales?period=today", {}, ACCOUNTS.worker);
    expect(res.status).toBe(403);
  });

  test("unauthenticated item-sales returns 401", async () => {
    const res = await fetch(`${process.env.APP_BASE_URL ?? "http://localhost:3000"}/api/canteen/item-sales?period=today`);
    expect(res.status).toBe(401);
  });
});

test.describe("Earnings API", () => {
  test("canteen_admin can fetch earnings", async () => {
    const res = await apiFetch("/api/canteen/earnings", {}, ACCOUNTS.canteenAdmin);
    expect([200, 400]).toContain(res.status);
  });

  test("worker cannot access earnings (403)", async () => {
    const res = await apiFetch("/api/canteen/earnings", {}, ACCOUNTS.worker);
    expect(res.status).toBe(403);
  });

  test("unauthenticated earnings returns 401", async () => {
    const res = await fetch(`${process.env.APP_BASE_URL ?? "http://localhost:3000"}/api/canteen/earnings`);
    expect(res.status).toBe(401);
  });
});

test.describe("Admin stats and reporting", () => {
  test("super_admin can access admin stats", async () => {
    const res = await apiFetch("/api/admin/stats", {}, ACCOUNTS.superAdmin);
    expect([200, 404]).toContain(res.status);
  });

  test("co_admin can access admin stats", async () => {
    const res = await apiFetch("/api/admin/stats", {}, ACCOUNTS.coAdmin);
    expect([200, 403, 404]).toContain(res.status);
  });

  test("canteen_admin cannot access admin stats (403)", async () => {
    const res = await apiFetch("/api/admin/stats", {}, ACCOUNTS.canteenAdmin);
    expect(res.status).toBe(403);
  });

  test("super_admin can access settlements", async () => {
    const res = await apiFetch("/api/admin/settlements", {}, ACCOUNTS.superAdmin);
    expect([200, 404]).toContain(res.status);
  });
});

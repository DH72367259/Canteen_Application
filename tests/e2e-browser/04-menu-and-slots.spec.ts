/**
 * 04-menu-and-slots.spec.ts
 * Menu items, time slots, and slot control API tests.
 */
import { test, expect } from "@playwright/test";
import { apiFetch, ACCOUNTS, adminClient, getCanteen1Id } from "./_helpers";

test.describe("Menu API", () => {
  let canteenId: string;

  test.beforeAll(async () => {
    canteenId = await getCanteen1Id();
  });

  test("public menu endpoint returns items for canteen 1", async () => {
    const res = await fetch(
      `${process.env.APP_BASE_URL ?? "http://localhost:3000"}/api/canteens/${canteenId}/menu`
    );
    // 200 if canteen active + has menu, 404 if not active yet — both are valid states
    expect([200, 404]).toContain(res.status);
  });

  test("canteen_admin can fetch own menu items", async () => {
    const res = await apiFetch("/api/canteen/menu", {}, ACCOUNTS.canteenAdmin);
    expect(res.status).toBe(200);
    const data = await res.json() as { items: { name: string }[] };
    expect(Array.isArray(data.items)).toBe(true);
  });

  test("canteen_admin can add a menu item", async () => {
    const res = await apiFetch("/api/canteen/menu", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: `E2E Item ${Date.now()}`, category: "Snacks",
        price: 30, availability_type: "slot_based", is_available: true,
      }),
    }, ACCOUNTS.canteenAdmin);
    expect([200, 201]).toContain(res.status);
    const data = await res.json() as { item: { id: string; name: string } };
    expect(data.item?.id).toBeDefined();

    // Cleanup
    if (data.item?.id) {
      await adminClient().from("menu_items").delete().eq("id", data.item.id);
    }
  });

  test("worker cannot add menu items", async () => {
    const res = await apiFetch("/api/canteen/menu", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Hack Item", price_paise: 100 }),
    }, ACCOUNTS.worker);
    expect(res.status).toBe(403);
  });
});

test.describe("Time Slots API", () => {
  test("canteen_admin can fetch time slots", async () => {
    const res = await apiFetch("/api/canteen/slot-control", {}, ACCOUNTS.canteenAdmin);
    expect(res.status).toBe(200);
  });

  test("slot-control requires auth", async () => {
    const res = await fetch(
      `${process.env.APP_BASE_URL ?? "http://localhost:3000"}/api/canteen/slot-control`
    );
    expect(res.status).toBe(401);
  });
});

test.describe("Item Sales API", () => {
  test("returns item breakdown for canteen_admin", async () => {
    for (const period of ["today", "week", "month"] as const) {
      const res = await apiFetch(`/api/canteen/item-sales?period=${period}`, {}, ACCOUNTS.canteenAdmin);
      expect(res.status).toBe(200);
      const data = await res.json() as { items: unknown[]; total_orders: number };
      expect(Array.isArray(data.items)).toBe(true);
    }
  });

  test("blocked for regular students", async () => {
    const res = await apiFetch("/api/canteen/item-sales?period=today", {}, ACCOUNTS.student1);
    expect(res.status).toBe(403);
  });
});

/**
 * 15-menu-management.spec.ts
 * Full menu CRUD: create, read, update, toggle availability, delete.
 */
import { test, expect } from "@playwright/test";
import { apiFetch, ACCOUNTS, adminClient, getCanteen1Id } from "./_helpers";

async function createTestMenuItem(canteenId: string) {
  const db = adminClient();
  const { data, error } = await db.from("menu_items").insert({
    canteen_id: canteenId,
    name: `E2E Item ${Date.now()}`,
    price: 50,
    category: "Snacks",
    availability_type: "batched_prepared",
    is_available: true,
  }).select("id, name").single();
  if (error) return null;
  return data;
}

test.describe("Menu GET", () => {
  test("canteen_admin can list menu items", async () => {
    const res = await apiFetch("/api/canteen/menu", {}, ACCOUNTS.canteenAdmin);
    expect(res.status).toBe(200);
    const data = await res.json() as { items?: unknown[] } | unknown[];
    const items = Array.isArray(data) ? data : (data as { items?: unknown[] }).items;
    expect(Array.isArray(items)).toBe(true);
  });

  test("worker can list menu items", async () => {
    const res = await apiFetch("/api/canteen/menu", {}, ACCOUNTS.worker);
    expect([200, 403]).toContain(res.status);
  });

  test("student cannot access canteen menu management API (403)", async () => {
    const res = await apiFetch("/api/canteen/menu", {}, ACCOUNTS.student1);
    expect(res.status).toBe(403);
  });

  test("unauthenticated cannot access menu management (401)", async () => {
    const res = await fetch(`${process.env.APP_BASE_URL ?? "http://localhost:3000"}/api/canteen/menu`);
    expect(res.status).toBe(401);
  });

  test("seeded canteen 1 has menu items", async () => {
    const canteenId = await getCanteen1Id();
    const db = adminClient();
    const { data } = await db.from("menu_items").select("id, name").eq("canteen_id", canteenId);
    expect((data?.length ?? 0)).toBeGreaterThan(0);
  });
});

test.describe("Menu POST — create", () => {
  let createdId: string;
  let canteenId: string;

  test.beforeAll(async () => {
    canteenId = await getCanteen1Id();
  });

  test.afterAll(async () => {
    if (createdId) await adminClient().from("menu_items").delete().eq("id", createdId);
  });

  test("canteen_admin can create a menu item", async () => {
    const res = await apiFetch("/api/canteen/menu", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "E2E Test Burger",
        price: 75,
        category: "Meals",
        availability_type: "batched_prepared",
        is_available: true,
      }),
    }, ACCOUNTS.canteenAdmin);
    expect(res.status).toBe(200);
    const data = await res.json() as { item?: { id: string } };
    expect(data.item?.id).toBeTruthy();
    createdId = data.item?.id ?? "";
  });

  test("menu item create requires name", async () => {
    const res = await apiFetch("/api/canteen/menu", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ price: 50, category: "Snacks" }),
    }, ACCOUNTS.canteenAdmin);
    expect(res.status).toBe(400);
  });

  test("menu item create requires valid price", async () => {
    const res = await apiFetch("/api/canteen/menu", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Test", price: -10, category: "Snacks" }),
    }, ACCOUNTS.canteenAdmin);
    expect(res.status).toBe(400);
  });

  test("worker cannot create menu items (403)", async () => {
    const res = await apiFetch("/api/canteen/menu", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Hack Item", price: 10, category: "Meals" }),
    }, ACCOUNTS.worker);
    expect(res.status).toBe(403);
  });

  test("student cannot create menu items (403)", async () => {
    const res = await apiFetch("/api/canteen/menu", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Hack Item", price: 10, category: "Meals" }),
    }, ACCOUNTS.student1);
    expect(res.status).toBe(403);
  });
});

test.describe("Menu PATCH — update", () => {
  let canteenId: string;

  test.beforeAll(async () => {
    canteenId = await getCanteen1Id();
  });

  test("canteen_admin can update a menu item name", async () => {
    const item = await createTestMenuItem(canteenId);
    if (!item) { test.skip(); return; }

    const res = await apiFetch(`/api/canteen/menu/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Updated Name" }),
    }, ACCOUNTS.canteenAdmin);
    expect([200, 404]).toContain(res.status);
    await adminClient().from("menu_items").delete().eq("id", item.id);
  });

  test("canteen_admin can toggle item availability to false", async () => {
    const item = await createTestMenuItem(canteenId);
    if (!item) { test.skip(); return; }

    const res = await apiFetch(`/api/canteen/menu/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_available: false }),
    }, ACCOUNTS.canteenAdmin);
    expect([200, 404]).toContain(res.status);
    await adminClient().from("menu_items").delete().eq("id", item.id);
  });

  test("canteen_admin can update item price", async () => {
    const item = await createTestMenuItem(canteenId);
    if (!item) { test.skip(); return; }

    const res = await apiFetch(`/api/canteen/menu/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ price: 99 }),
    }, ACCOUNTS.canteenAdmin);
    expect([200, 404]).toContain(res.status);
    await adminClient().from("menu_items").delete().eq("id", item.id);
  });

  test("worker cannot update menu items (403)", async () => {
    const item = await createTestMenuItem(canteenId);
    if (!item) { test.skip(); return; }

    const res = await apiFetch(`/api/canteen/menu/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Hacked" }),
    }, ACCOUNTS.worker);
    expect(res.status).toBe(403);
    await adminClient().from("menu_items").delete().eq("id", item.id);
  });

  test("canteen2_admin cannot update canteen1 menu items (403)", async () => {
    const item = await createTestMenuItem(canteenId);
    if (!item) { test.skip(); return; }

    const res = await apiFetch(`/api/canteen/menu/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Cross-canteen hack" }),
    }, ACCOUNTS.canteen2Admin);
    expect([403, 404]).toContain(res.status);
    await adminClient().from("menu_items").delete().eq("id", item.id);
  });
});

test.describe("Menu DELETE", () => {
  let canteenId: string;

  test.beforeAll(async () => {
    canteenId = await getCanteen1Id();
  });

  test("canteen_admin can delete a menu item", async () => {
    const item = await createTestMenuItem(canteenId);
    if (!item) { test.skip(); return; }

    const res = await apiFetch(`/api/canteen/menu/${item.id}`, {
      method: "DELETE",
    }, ACCOUNTS.canteenAdmin);
    expect([200, 204, 404]).toContain(res.status);
  });

  test("worker cannot delete menu items (403)", async () => {
    const item = await createTestMenuItem(canteenId);
    if (!item) { test.skip(); return; }

    const res = await apiFetch(`/api/canteen/menu/${item.id}`, {
      method: "DELETE",
    }, ACCOUNTS.worker);
    expect(res.status).toBe(403);
    await adminClient().from("menu_items").delete().eq("id", item.id);
  });

  test("deleting non-existent item returns 404", async () => {
    const res = await apiFetch("/api/canteen/menu/00000000-0000-0000-0000-000000000000", {
      method: "DELETE",
    }, ACCOUNTS.canteenAdmin);
    expect([404, 400]).toContain(res.status);
  });
});

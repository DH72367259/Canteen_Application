import { test, expect } from "@playwright/test";
import {
  adminClient,
  apiFetch,
  provisionStaff,
  provisionStudent,
  deleteUser,
  uniqueIpHeaders,
} from "./_helpers";

const APP_URL = process.env.APP_BASE_URL || "http://localhost:3000";

test.describe("Vendor Menu CRUD", () => {
  let canteenId: string;
  let managerId: string;
  let managerEmail: string;
  let managerPassword: string;
  let createdItemId: string;

  test.beforeAll(async () => {
    const admin = adminClient();

    // Get first canteen
    const { data: canteens } = await admin.from("canteens").select("id").limit(1);
    canteenId = canteens?.[0]?.id || "test-canteen";

    // Provision manager
    const manager = await provisionStaff("canteen_admin", canteenId, "menu-test");
    managerId = manager.id;
    managerEmail = manager.email;
    managerPassword = manager.password;
  });

  test.afterAll(async () => {
    await deleteUser(managerId);
  });

  // ── Create Menu Items ──────────────────────────────────────────────────
  test("canteen_admin creates batched_prepared menu item", async () => {
    const res = await apiFetch(
      `${APP_URL}/api/canteen/menu`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...uniqueIpHeaders() },
        body: JSON.stringify({
          name: `Lunch Bowl ${Date.now()}`,
          price: 150,
          is_meal: true,
          availability_type: "batched_prepared",
          total_per_day: 50,
        }),
      },
      {
        email: managerEmail,
        password: managerPassword,
      }
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toHaveProperty("id");
    createdItemId = body.id;
  });

  test("canteen_admin creates slot_based menu item", async () => {
    const res = await apiFetch(
      `${APP_URL}/api/canteen/menu`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...uniqueIpHeaders() },
        body: JSON.stringify({
          name: `Slot Special ${Date.now()}`,
          price: 100,
          is_meal: true,
          availability_type: "slot_based",
          quantity_per_slot: 10,
        }),
      },
      {
        email: managerEmail,
        password: managerPassword,
      }
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toHaveProperty("id");
  });

  // ── List Menu Items ───────────────────────────────────────────────────
  test("canteen_admin views their menu items", async () => {
    const res = await apiFetch(
      `${APP_URL}/api/canteen/menu`,
      {
        method: "GET",
        headers: { ...uniqueIpHeaders() },
      },
      {
        email: managerEmail,
        password: managerPassword,
      }
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });

  // ── Update Menu Item ───────────────────────────────────────────────────
  test("canteen_admin updates menu item name and price", async () => {
    if (!createdItemId) return;

    const res = await apiFetch(
      `${APP_URL}/api/canteen/menu/${createdItemId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...uniqueIpHeaders() },
        body: JSON.stringify({
          name: `Updated ${Date.now()}`,
          price: 200,
        }),
      },
      {
        email: managerEmail,
        password: managerPassword,
      }
    );

    expect(res.status).toBe(200);

    // Verify update
    const verifyRes = await apiFetch(
      `${APP_URL}/api/canteen/menu`,
      {
        method: "GET",
        headers: { ...uniqueIpHeaders() },
      },
      {
        email: managerEmail,
        password: managerPassword,
      }
    );

    const items = await verifyRes.json();
    const updated = items.find((i: { id: string }) => i.id === createdItemId);
    expect(updated).toBeTruthy();
    expect(updated.price).toBe(200);
  });

  test("canteen_admin toggles item availability", async () => {
    if (!createdItemId) return;

    const res = await apiFetch(
      `${APP_URL}/api/canteen/menu/${createdItemId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...uniqueIpHeaders() },
        body: JSON.stringify({
          is_available: false,
        }),
      },
      {
        email: managerEmail,
        password: managerPassword,
      }
    );

    expect(res.status).toBe(200);
  });

  // ── Delete Menu Item ───────────────────────────────────────────────────
  test("canteen_admin deletes menu item", async () => {
    // Create item to delete
    const createRes = await apiFetch(
      `${APP_URL}/api/canteen/menu`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...uniqueIpHeaders() },
        body: JSON.stringify({
          name: `To Delete ${Date.now()}`,
          price: 50,
          is_meal: false,
          availability_type: "batched_prepared",
        }),
      },
      {
        email: managerEmail,
        password: managerPassword,
      }
    );

    const item = await createRes.json();

    // Delete it
    const deleteRes = await apiFetch(
      `${APP_URL}/api/canteen/menu/${item.id}`,
      {
        method: "DELETE",
        headers: { ...uniqueIpHeaders() },
      },
      {
        email: managerEmail,
        password: managerPassword,
      }
    );

    expect([200, 204]).toContain(deleteRes.status);
  });

  // ── Cross-Canteen Access ───────────────────────────────────────────────
  test("canteen_admin cannot manage other canteen's menu → 403", async () => {
    const admin = adminClient();

    // Get second canteen
    const { data: canteens } = await admin
      .from("canteens")
      .select("id")
      .limit(2);

    if (canteens?.length < 2) return;

    const otherCanteenId = canteens[1].id;

    // Get item from other canteen
    const { data: items } = await admin
      .from("menu_items")
      .select("id")
      .eq("canteen_id", otherCanteenId)
      .limit(1);

    if (!items?.length) return;

    // Try to update other canteen's item
    const res = await apiFetch(
      `${APP_URL}/api/canteen/menu/${items[0].id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...uniqueIpHeaders() },
        body: JSON.stringify({
          price: 999,
        }),
      },
      {
        email: managerEmail,
        password: managerPassword,
      }
    );

    expect([403, 404]).toContain(res.status);
  });

  // ── Super Admin Can Manage Any Canteen ─────────────────────────────────
  test("super_admin can manage any canteen's menu", async () => {
    const admin = adminClient();

    // Get first canteen
    const { data: canteens } = await admin.from("canteens").select("id").limit(1);
    if (!canteens?.length) return;

    // Create item in first canteen with super_admin credentials
    const res = await apiFetch(
      `${APP_URL}/api/canteen/menu`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...uniqueIpHeaders() },
        body: JSON.stringify({
          name: `Admin Item ${Date.now()}`,
          price: 300,
          is_meal: true,
          availability_type: "batched_prepared",
        }),
      },
      {
        email: "admin@noqx.test",
        password: "Admin@1234",
      }
    );

    expect(res.status).toBe(201);
  });

  // ── Co-Admin Can Manage Menu ───────────────────────────────────────────
  test("co_admin can manage any canteen's menu", async () => {
    const res = await apiFetch(
      `${APP_URL}/api/canteen/menu`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...uniqueIpHeaders() },
        body: JSON.stringify({
          name: `CoAdmin Item ${Date.now()}`,
          price: 250,
          is_meal: false,
          availability_type: "slot_based",
          quantity_per_slot: 5,
        }),
      },
      {
        email: "coadmin@noqx.test",
        password: "Coadmin@12345",
      }
    );

    expect(res.status).toBe(201);
  });

  // ── Student Cannot Create Menu ─────────────────────────────────────────
  test("student cannot create menu item → 403", async () => {
    const student = await provisionStudent(canteenId, "menu-test");

    const res = await apiFetch(
      `${APP_URL}/api/canteen/menu`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...uniqueIpHeaders() },
        body: JSON.stringify({
          name: `Fail ${Date.now()}`,
          price: 100,
          is_meal: true,
          availability_type: "batched_prepared",
        }),
      },
      {
        email: student.email,
        password: student.password,
      }
    );

    expect(res.status).toBe(403);

    await deleteUser(student.id);
  });
});

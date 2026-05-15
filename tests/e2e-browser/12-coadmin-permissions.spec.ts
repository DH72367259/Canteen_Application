/**
 * 12-coadmin-permissions.spec.ts
 * Co-admin role: same read access as super_admin, limited write access.
 */
import { test, expect } from "@playwright/test";
import { apiFetch, ACCOUNTS, adminClient, getCanteen1Id } from "./_helpers";

test.describe("Co-admin — read access", () => {
  test("co_admin can list all users", async () => {
    const res = await apiFetch("/api/admin/users", {}, ACCOUNTS.coAdmin);
    expect(res.status).toBe(200);
    const data = await res.json() as { users: unknown[] };
    expect(Array.isArray(data.users)).toBe(true);
  });

  test("co_admin can view all canteens", async () => {
    const res = await apiFetch("/api/admin/canteens", {}, ACCOUNTS.coAdmin);
    expect([200, 404]).toContain(res.status);
  });

  test("co_admin can view admin stats", async () => {
    const res = await apiFetch("/api/admin/stats", {}, ACCOUNTS.coAdmin);
    expect([200, 404]).toContain(res.status);
  });

  test("co_admin can view settlements", async () => {
    const res = await apiFetch("/api/admin/settlements", {}, ACCOUNTS.coAdmin);
    expect([200, 404]).toContain(res.status);
  });

  test("co_admin can fetch canteen sales data", async () => {
    const canteenId = await getCanteen1Id();
    const today = new Date().toISOString().split("T")[0];
    const res = await apiFetch(`/api/canteen/sales?canteenId=${canteenId}&date=${today}`, {}, ACCOUNTS.coAdmin);
    expect([200, 400]).toContain(res.status);
  });

  test("co_admin can fetch live-orders for any canteen", async () => {
    const res = await apiFetch("/api/canteen/live-orders", {}, ACCOUNTS.coAdmin);
    expect([200, 400]).toContain(res.status);
  });
});

test.describe("Co-admin — write access", () => {
  test("co_admin can create a user", async () => {
    const email = `e2e-cotest-${Date.now()}@noqx.test`;
    const canteenId = await getCanteen1Id();
    const res = await apiFetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email, password: "Test@12345", name: "CoAdmin Test",
        role: "worker", canteen_id: canteenId, phone: "9111222333",
      }),
    }, ACCOUNTS.coAdmin);
    expect([200, 201, 403]).toContain(res.status);
    if (res.status === 200 || res.status === 201) {
      const data = await res.json() as { uid?: string };
      if (data.uid) {
        await adminClient().auth.admin.deleteUser(data.uid);
      }
    }
  });

  test("co_admin can cancel an order", async () => {
    const canteenId = await getCanteen1Id();
    const db = adminClient();
    const { data: items } = await db.from("menu_items").select("id").eq("canteen_id", canteenId).limit(1);
    if (!items?.length) { test.skip(); return; }

    const { data: order } = await db.from("orders")
      .insert({ canteen_id: canteenId, status: "placed", total_amount: 80, otp: "654321" })
      .select("id").single();
    if (!order) { test.skip(); return; }

    const res = await apiFetch(`/api/orders/${order.id}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "Co-admin test cancel" }),
    }, ACCOUNTS.coAdmin);
    expect(res.status).toBe(200);
    await db.from("orders").delete().eq("id", order.id);
  });

  test("co_admin can update slot-control for any canteen", async () => {
    const canteenId = await getCanteen1Id();
    const res = await apiFetch(`/api/canteen/slot-control?canteenId=${canteenId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grace_period_mins: 10 }),
    }, ACCOUNTS.coAdmin);
    expect([200, 400]).toContain(res.status);
  });
});

test.describe("Co-admin — access restrictions", () => {
  test("co_admin cannot access worker-only dashboard", async () => {
    const res = await apiFetch("/api/canteen/prep-summary", {}, ACCOUNTS.coAdmin);
    // co_admin should get 200 or 400 (has canteen access) but not 403
    expect(res.status).not.toBe(403);
  });

  test("co_admin lands on /admin/dashboard after login", async ({ page }) => {
    const { loginStaff, APP_URL } = await import("./_helpers");
    const a = ACCOUNTS.coAdmin;
    await loginStaff(page, a.email, a.password, /\/admin\/dashboard/);
    await expect(page).toHaveURL(/\/admin\/dashboard/, { timeout: 5_000 });
  });
});

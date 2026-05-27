/**
 * 02-admin-management.spec.ts
 * Super admin can create canteens, view users, and manage the platform.
 */
import { test, expect } from "@playwright/test";
import { APP_URL, ACCOUNTS, loginSuperAdmin, apiFetch, adminClient } from "./_helpers";

test.describe("Admin — canteen and user management", () => {
  test("admin dashboard loads with Canteens tab", async ({ page }) => {
    await loginSuperAdmin(page);
    await expect(page.getByText(/canteen/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test("canteen list shows seeded canteens", async ({ page }) => {
    await loginSuperAdmin(page);
    // Click the Canteens tab if the dashboard has one
    const canteensTab = page.getByRole("button", { name: /canteens?/i }).first();
    if (await canteensTab.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await canteensTab.click();
    }
    // Wait for page to settle then check the canteen appears in the list.
    // scrollIntoViewIfNeeded is NOT used — it times out when the list re-renders
    // during SSR hydration; toBeVisible() does not require viewport intersection.
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
    const canteenEl = page.getByText(/Test Canteen/i).first();
    await expect(canteenEl).toBeVisible({ timeout: 15_000 });
  });

  test("user list API returns all seeded accounts", async () => {
    const res = await apiFetch("/api/admin/users", {}, ACCOUNTS.superAdmin);
    expect(res.status).toBe(200);
    const data = await res.json() as { users: { email: string; role: string }[] };
    const emails = data.users.map(u => u.email);
    expect(emails).toContain(ACCOUNTS.canteenAdmin.email);
    expect(emails).toContain(ACCOUNTS.worker.email);
  });

  test("API: co_admin can also list users", async () => {
    const res = await apiFetch("/api/admin/users", {}, ACCOUNTS.coAdmin);
    expect(res.status).toBe(200);
  });

  test("API: canteen_admin cannot list all users", async () => {
    const res = await apiFetch("/api/admin/users", {}, ACCOUNTS.canteenAdmin);
    expect(res.status).toBe(403);
  });

  test("API: create and delete a one-shot canteen admin", async () => {
    const email = `e2e-ca-${Date.now()}@noqx.test`;

    // Get a canteen to assign
    const db = adminClient();
    const { data: canteens } = await db.from("canteens").select("id").limit(1);
    const canteenId = canteens?.[0]?.id;
    if (!canteenId) { test.skip(); return; }

    // Create
    const create = await apiFetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email, password: "Canteen@12345", name: "Temp Admin",
        role: "canteen_admin", canteen_id: canteenId, phone: "9111111111",
      }),
    }, ACCOUNTS.superAdmin);
    expect(create.status).toBe(200);
    const { uid } = await create.json() as { uid: string };

    // Delete
    const del = await apiFetch("/api/admin/users", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid }),
    }, ACCOUNTS.superAdmin);
    expect(del.status).toBe(200);
  });
});

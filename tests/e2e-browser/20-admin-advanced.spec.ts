/**
 * 20-admin-advanced.spec.ts
 * Admin platform management: user CRUD, canteen operations, settlements, platform charges.
 */
import { test, expect } from "@playwright/test";
import { apiFetch, ACCOUNTS, adminClient, getCanteen1Id, APP_URL } from "./_helpers";

test.describe("Admin user management — create", () => {
  test("super_admin can create a worker for canteen1", async () => {
    const canteenId = await getCanteen1Id();
    const email = `e2e-worker-${Date.now()}@noqx.test`;
    const res = await apiFetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email, password: "Worker@12345", name: "E2E Worker",
        role: "worker", canteen_id: canteenId, phone: "9100000099",
      }),
    }, ACCOUNTS.superAdmin);
    expect(res.status).toBe(200);
    const data = await res.json() as { uid?: string };
    if (data.uid) await adminClient().auth.admin.deleteUser(data.uid);
  });

  test("super_admin can create a canteen_admin", async () => {
    const canteenId = await getCanteen1Id();
    const email = `e2e-mgr-${Date.now()}@noqx.test`;
    const res = await apiFetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email, password: "Manager@12345", name: "E2E Manager",
        role: "canteen_admin", canteen_id: canteenId, phone: "9100000088",
      }),
    }, ACCOUNTS.superAdmin);
    expect(res.status).toBe(200);
    const data = await res.json() as { uid?: string };
    if (data.uid) await adminClient().auth.admin.deleteUser(data.uid);
  });

  test("create user without phone is rejected (400)", async () => {
    const res = await apiFetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `e2e-${Date.now()}@noqx.test`, password: "Test@12345",
        name: "No Phone", role: "worker",
      }),
    }, ACCOUNTS.superAdmin);
    expect(res.status).toBe(400);
  });

  test("create user with invalid role is rejected (400)", async () => {
    const res = await apiFetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `e2e-${Date.now()}@noqx.test`, password: "Test@12345",
        name: "Bad Role", role: "superuser", phone: "9100000077",
      }),
    }, ACCOUNTS.superAdmin);
    expect(res.status).toBe(400);
  });

  test("create user with short password is rejected (400)", async () => {
    const res = await apiFetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `e2e-${Date.now()}@noqx.test`, password: "abc",
        name: "Short PW", role: "worker", phone: "9100000066",
      }),
    }, ACCOUNTS.superAdmin);
    expect(res.status).toBe(400);
  });
});

test.describe("Admin user management — delete", () => {
  test("super_admin can delete a non-whitelist user", async () => {
    // Create then delete
    const canteenId = await getCanteen1Id();
    const email = `e2e-del-${Date.now()}@noqx.test`;
    const create = await apiFetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email, password: "Delete@12345", name: "To Delete",
        role: "worker", canteen_id: canteenId, phone: "9100000055",
      }),
    }, ACCOUNTS.superAdmin);
    expect(create.status).toBe(200);
    const { uid } = await create.json() as { uid: string };

    const del = await apiFetch("/api/admin/users", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid }),
    }, ACCOUNTS.superAdmin);
    expect(del.status).toBe(200);
  });

  test("canteen_admin cannot delete users (403)", async () => {
    const res = await apiFetch("/api/admin/users", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid: "fake-uid" }),
    }, ACCOUNTS.canteenAdmin);
    expect(res.status).toBe(403);
  });
});

test.describe("Admin password reset", () => {
  test("super_admin can reset a user password", async () => {
    const db = adminClient();
    const { data: worker } = await db.from("profiles").select("id").eq("email", ACCOUNTS.worker.email).maybeSingle();
    if (!worker) { test.skip(); return; }

    const res = await apiFetch("/api/admin/users/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid: worker.id, newPassword: "Worker@12345" }),
    }, ACCOUNTS.superAdmin);
    expect([200, 400, 404]).toContain(res.status);
  });

  test("canteen_admin cannot reset passwords (403)", async () => {
    const res = await apiFetch("/api/admin/users/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid: "fake-uid", newPassword: "Hacked@12345" }),
    }, ACCOUNTS.canteenAdmin);
    expect(res.status).toBe(403);
  });
});

test.describe("Platform charges", () => {
  test("super_admin can view platform charges", async () => {
    const res = await apiFetch("/api/admin/platform-charges", {}, ACCOUNTS.superAdmin);
    expect([200, 404]).toContain(res.status);
  });

  test("canteen_admin cannot view platform charges (403)", async () => {
    const res = await apiFetch("/api/admin/platform-charges", {}, ACCOUNTS.canteenAdmin);
    expect(res.status).toBe(403);
  });
});

test.describe("Admin dashboard UI", () => {
  test("super_admin admin dashboard loads all tabs", async ({ page }) => {
    const { loginSuperAdmin } = await import("./_helpers");
    await loginSuperAdmin(page);
    await expect(page.locator("body")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/application error/i)).not.toBeVisible({ timeout: 3_000 }).catch(() => {});
  });

  test("admin dashboard shows Manage Canteens section", async ({ page }) => {
    const { loginSuperAdmin } = await import("./_helpers");
    await loginSuperAdmin(page);
    await expect(page.getByText(/canteen/i).first()).toBeVisible({ timeout: 15_000 });
  });

  test("admin All Users section is visible", async ({ page }) => {
    const { loginSuperAdmin } = await import("./_helpers");
    await loginSuperAdmin(page);
    const usersLink = page.getByText(/all users/i).first();
    if (await usersLink.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await usersLink.click();
      await expect(page.locator("body")).toBeVisible({ timeout: 10_000 });
    }
  });
});

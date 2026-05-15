/**
 * 01-smoke.spec.ts
 * Quick sanity check: every role can log in and lands on the correct dashboard.
 * Fails fast if accounts are missing — run scripts/seed-staging.mjs first.
 */
import { test, expect } from "@playwright/test";
import { APP_URL, ACCOUNTS, loginStaff, loginWorker } from "./_helpers";

test.describe("Smoke — all roles can log in", () => {
  test("super_admin → /admin/dashboard", async ({ page }) => {
    const a = ACCOUNTS.superAdmin;
    await loginStaff(page, a.email, a.password, /\/admin\/dashboard/);
    await expect(page).toHaveURL(/\/admin\/dashboard/, { timeout: 5_000 });
  });

  test("co_admin → /admin/dashboard", async ({ page }) => {
    const a = ACCOUNTS.coAdmin;
    await loginStaff(page, a.email, a.password, /\/admin\/dashboard/);
    await expect(page).toHaveURL(/\/admin\/dashboard/);
  });

  test("canteen_admin → /vendor/dashboard", async ({ page }) => {
    const a = ACCOUNTS.canteenAdmin;
    await loginStaff(page, a.email, a.password, /\/vendor\/dashboard/);
    await expect(page).toHaveURL(/\/vendor\/dashboard/);
  });

  test("worker → /worker/orders or /worker/dashboard", async ({ page }) => {
    await loginWorker(page);
    await expect(page).toHaveURL(/\/worker\/(orders|dashboard)/);
  });

  test("student can reach login page", async ({ page }) => {
    await page.goto(`${APP_URL}/login`, { waitUntil: "domcontentloaded" });
    await expect(page.locator('button:has-text("Student")')).toBeVisible({ timeout: 10_000 });
  });

  test("unauthenticated → redirected to login", async ({ page }) => {
    await page.goto(`${APP_URL}/vendor/dashboard`, { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
  });

  test("wrong role blocked from vendor dashboard", async ({ page }) => {
    // Worker should not reach /vendor/dashboard
    await loginWorker(page);
    await page.goto(`${APP_URL}/vendor/dashboard`);
    // Should redirect away — either to /login or worker dashboard
    await page.waitForURL(/\/(login|worker)/, { timeout: 15_000 });
  });
});

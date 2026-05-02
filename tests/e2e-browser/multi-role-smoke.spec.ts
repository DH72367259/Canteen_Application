/**
 * Multi-role headless smoke E2E. Verifies every role can log in via the real
 * UI and lands on its proper dashboard. Each test is independent.
 */
import { test, expect } from "@playwright/test";
import {
  APP_URL, WHITELIST,
  loginViaPasswordTab, loginWorkerUI,
  provisionStudent, deleteUser,
} from "./_helpers";

const CANTEEN_ID = "9d1b1e36-48a1-4ce8-a270-704eec9018c8";

test.describe("multi-role headless smoke", () => {
  test("super_admin lands on /admin/dashboard with sidebar", async ({ page }) => {
    await loginViaPasswordTab(page, WHITELIST.superAdmin.email, WHITELIST.superAdmin.password, /\/admin\/dashboard/);
    await expect(page.locator("aside.sidebar")).toBeVisible({ timeout: 15_000 });
  });

  test("co_admin lands on /admin/dashboard", async ({ page }) => {
    await loginViaPasswordTab(page, WHITELIST.coAdmin.email, WHITELIST.coAdmin.password, /\/admin\/dashboard/);
    await expect(page.locator("aside.sidebar")).toBeVisible({ timeout: 15_000 });
  });

  test("canteen_admin (manager) lands on /vendor/dashboard", async ({ page }) => {
    await loginViaPasswordTab(page, WHITELIST.canteenAdmin.email, WHITELIST.canteenAdmin.password, /\/vendor\/dashboard/);
    // Wait for the page to render past initial loading. The vendor dashboard
    // surfaces "Live Orders" in its sidebar once the role gate passes.
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await expect(page.locator("body")).toContainText(/Live Orders|Prep Summary|Vendor|Dashboard/i, { timeout: 20_000 });
  });

  test("worker lands on /worker/orders", async ({ page }) => {
    await loginWorkerUI(page);
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await expect(page.locator("body")).toContainText(/Orders|No orders|Preparing|Ready|Bin/i, { timeout: 20_000 });
  });

  test("student logs in, lands on /dashboard, sees canteen list", async ({ page }) => {
    const stu = await provisionStudent(CANTEEN_ID, "smoke-student");
    try {
      // Students provisioned via admin SDK have only email — use the password
      // tab (signInWithPassword) which the shared post-login redirect routes
      // to /dashboard for role=student.
      await loginViaPasswordTab(page, stu.email, stu.password, /\/dashboard(\?|$|\/)/);
      await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
      // /dashboard fetches /api/canteens — page should render some canteen text.
      await expect(page.locator("body")).toContainText(/canteen|menu|order/i, { timeout: 20_000 });
    } finally {
      await deleteUser(stu.id);
    }
  });

  test("unauthenticated /admin/dashboard redirects to /login", async ({ page }) => {
    await page.goto(`${APP_URL}/admin/dashboard`);
    // Either the auth gate redirects to /login OR renders a login-prompt.
    await page.waitForURL(/\/login|\/admin\/dashboard/, { timeout: 10_000 });
    // If we ended up on /admin/dashboard, it must have a login UI shown.
    const url = page.url();
    if (!/\/login/.test(url)) {
      await expect(page.getByText(/Sign In|Login|Please sign in/i).first()).toBeVisible({ timeout: 10_000 });
    }
  });
});

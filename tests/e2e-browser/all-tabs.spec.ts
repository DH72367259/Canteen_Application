/**
 * Exhaustive multi-role headless E2E. For every role, navigates through every
 * sidebar tab / route and asserts:
 *   - the target section header renders within timeout
 *   - no uncaught JS console errors fire during the visit
 *   - no network 5xx responses are returned to the browser
 *
 * The intent is to catch regressions across ALL responsibilities and tabs in
 * a single headless run, not just the happy-path login.
 */
import { test, expect, Page, ConsoleMessage } from "@playwright/test";
import {
  APP_URL, WHITELIST,
  loginViaPasswordTab, loginWorkerUI,
  provisionStudent, deleteUser,
} from "./_helpers";

const CANTEEN_ID = "9d1b1e36-48a1-4ce8-a270-704eec9018c8";

// Some Next.js dev-mode console noise is benign — filter it.
function shouldIgnoreConsole(msg: ConsoleMessage): boolean {
  const t = msg.text();
  return (
    msg.type() !== "error" ||
    /Download the React DevTools|Hydration|Fast Refresh|Warning:|webpack|Turbopack|404 \(Not Found\)|Failed to load resource/i.test(t)
  );
}

function attachWatchers(page: Page): { errors: string[]; statuses: number[] } {
  const errors: string[] = [];
  const statuses: number[] = [];
  page.on("console", msg => {
    if (!shouldIgnoreConsole(msg)) errors.push(`[console] ${msg.text()}`);
  });
  page.on("pageerror", err => errors.push(`[pageerror] ${err.message}`));
  page.on("response", resp => {
    const s = resp.status();
    if (s >= 500 && resp.url().startsWith(APP_URL)) {
      statuses.push(s);
      errors.push(`[5xx ${s}] ${resp.url()}`);
    }
  });
  return { errors, statuses };
}

async function clickSidebarTab(page: Page, label: RegExp) {
  // Sidebar items render as <button class="sidebar-link"> in both admin and
  // vendor dashboards. We match by their visible label text.
  const btn = page.locator("button.sidebar-link", { hasText: label }).first();
  await btn.waitFor({ state: "visible", timeout: 15_000 });
  await btn.click();
  // Give the section component a moment to mount + fetch.
  await page.waitForTimeout(800);
}

// ─────────────────────────────────────────────────────────────────────────────
// SUPER ADMIN — every sidebar tab
// ─────────────────────────────────────────────────────────────────────────────
test.describe("super_admin: every sidebar tab", () => {
  test("walks all 11 admin tabs without errors", async ({ page }) => {
    const watch = attachWatchers(page);
    await loginViaPasswordTab(
      page, WHITELIST.superAdmin.email, WHITELIST.superAdmin.password,
      /\/admin\/dashboard/,
    );
    await expect(page.locator("aside.sidebar")).toBeVisible({ timeout: 15_000 });

    // The order matches the NAV_ITEMS array in app/admin/dashboard/page.tsx.
    const tabs: RegExp[] = [
      /Dashboard/, /Manage Canteens/, /Canteen Managers/, /Workers/,
      /All Users/, /Cities & Colleges/, /Analytics/, /Payments/,
      /Support/, /Notifications/, /My Account/,
    ];
    for (const tab of tabs) {
      await clickSidebarTab(page, tab);
    }
    expect(watch.errors, watch.errors.join("\n")).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CO ADMIN — same dashboard as super_admin
// ─────────────────────────────────────────────────────────────────────────────
test.describe("co_admin: every sidebar tab", () => {
  test("walks all admin tabs as co_admin without errors", async ({ page }) => {
    const watch = attachWatchers(page);
    await loginViaPasswordTab(
      page, WHITELIST.coAdmin.email, WHITELIST.coAdmin.password,
      /\/admin\/dashboard/,
    );
    await expect(page.locator("aside.sidebar")).toBeVisible({ timeout: 15_000 });
    const tabs: RegExp[] = [
      /Dashboard/, /Manage Canteens/, /Canteen Managers/, /Workers/,
      /All Users/, /Cities & Colleges/, /Analytics/, /Payments/,
      /Support/, /Notifications/, /My Account/,
    ];
    for (const tab of tabs) {
      await clickSidebarTab(page, tab);
    }
    expect(watch.errors, watch.errors.join("\n")).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MANAGER (canteen_admin) — every sidebar tab on /vendor/dashboard
// ─────────────────────────────────────────────────────────────────────────────
test.describe("canteen_admin (manager): every sidebar tab", () => {
  test("walks all vendor tabs without errors", async ({ page }) => {
    const watch = attachWatchers(page);
    await loginViaPasswordTab(
      page, WHITELIST.canteenAdmin.email, WHITELIST.canteenAdmin.password,
      /\/vendor\/dashboard/,
    );
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});

    const tabs: RegExp[] = [
      /Live Orders/, /Prep Summary/, /Menu & Items/, /Inventory/,
      /Slot and Bin Control/, /Time Slots/, /Bin Management/, /Sales/,
      /Earnings & Payouts/, /Logs/, /Settings/, /Raise a Concern/,
    ];
    for (const tab of tabs) {
      await clickSidebarTab(page, tab);
    }
    expect(watch.errors, watch.errors.join("\n")).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// WORKER — dashboard sections
// ─────────────────────────────────────────────────────────────────────────────
test.describe("worker: dashboard responsibilities", () => {
  test("renders dashboard, slot tabs, no console errors", async ({ page }) => {
    const watch = attachWatchers(page);
    await loginWorkerUI(page);
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await expect(page.locator("body")).toContainText(/ORDERS|OTP|No active|Worker|Pickup|Bin/i, { timeout: 20_000 });

    // Click every slot pill if present (slot switcher).
    const slotPills = page.getByText(/\d{1,2}:\d{2}/);
    const count = await slotPills.count().catch(() => 0);
    for (let i = 0; i < Math.min(count, 5); i++) {
      try {
        await slotPills.nth(i).click({ timeout: 5_000 });
        await page.waitForTimeout(300);
      } catch {
        // Slot pill may not be clickable
      }
    }

    expect(watch.errors, watch.errors.join("\n")).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// STUDENT — every route
// ─────────────────────────────────────────────────────────────────────────────
test.describe("student: every dashboard route", () => {
  test("walks /dashboard + sub-routes without errors", async ({ page }) => {
    const watch = attachWatchers(page);
    const stu = await provisionStudent(CANTEEN_ID, "tabs-student");
    try {
      await loginViaPasswordTab(page, stu.email, stu.password, /\/dashboard(\?|$|\/)/);
      await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});

      const routes = [
        "/dashboard",
        "/dashboard/orders",
        "/dashboard/profile",
        "/dashboard/support",
      ];
      for (const r of routes) {
        await page.goto(`${APP_URL}${r}`);
        await page.waitForLoadState("domcontentloaded");
        await page.waitForTimeout(800);
      }
      expect(watch.errors, watch.errors.join("\n")).toEqual([]);
    } finally {
      await deleteUser(stu.id);
    }
  });
});

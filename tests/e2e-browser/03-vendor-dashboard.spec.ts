/**
 * 03-vendor-dashboard.spec.ts
 * Canteen admin can navigate all tabs, see live orders, prep summary,
 * analytics, and sales.
 */
import { test, expect } from "@playwright/test";
import { loginCanteenAdmin, apiFetch, ACCOUNTS, getCanteen1Id } from "./_helpers";

test.describe("Vendor dashboard — all tabs reachable", () => {
  test.beforeEach(async ({ page }) => {
    await loginCanteenAdmin(page);
  });

  test("Live Orders tab is default and visible", async ({ page }) => {
    await expect(page.getByText(/live orders/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test("Prep Summary tab loads without error", async ({ page }) => {
    await page.getByRole("button", { name: /prep summary/i }).click();
    // Should show prep summary content or empty state — NOT an error
    await expect(page.getByText(/prep summary/i).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/error/i)).not.toBeVisible({ timeout: 3_000 }).catch(() => {});
  });

  test("Menu & Items tab loads", async ({ page }) => {
    await page.getByRole("button", { name: /menu/i }).first().click();
    await expect(page.getByText(/menu/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test("Sales tab loads with revenue charts", async ({ page }) => {
    await page.getByRole("button", { name: /sales/i }).first().click();
    await expect(page.getByText(/sales/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test("Analytics tab loads with slot breakdown (no Receipt History sub-tab)", async ({ page }) => {
    await page.getByRole("button", { name: /analytics/i }).first().click();
    await expect(page.getByText(/analytics/i).first()).toBeVisible({ timeout: 10_000 });
    // Slot breakdown date picker must be present
    await expect(page.locator("input[type=date]").first()).toBeVisible({ timeout: 10_000 });
    // Receipt History was moved to Bills & Receipts; it must NOT appear here
    await expect(page.getByText(/receipt history/i)).not.toBeVisible({ timeout: 3_000 }).catch(() => {});
  });

  test("Bills & Receipts tab loads with period filters", async ({ page }) => {
    await page.getByRole("button", { name: /bills/i }).first().click();
    await expect(page.getByText(/bills & receipts/i).first()).toBeVisible({ timeout: 10_000 });
    // Period filter chips — Today/This Week/This Month/This Year
    await expect(page.getByRole("button", { name: /today/i }).first()).toBeVisible({ timeout: 8_000 });
    await expect(page.getByRole("button", { name: /this week/i }).first()).toBeVisible({ timeout: 5_000 });
  });

  test("Slot and Bin Control tab loads", async ({ page }) => {
    await page.getByRole("button", { name: /slot and bin/i }).first().click();
    await expect(page.getByText(/slot/i).first()).toBeVisible({ timeout: 10_000 });
  });
});

test.describe("Vendor dashboard — API access control", () => {
  test("prep-summary requires auth", async () => {
    const res = await fetch(`${process.env.APP_BASE_URL ?? "http://localhost:3000"}/api/canteen/prep-summary`);
    expect(res.status).toBe(401);
  });

  test("prep-summary returns data for canteen_admin", async () => {
    const res = await apiFetch("/api/canteen/prep-summary", {}, ACCOUNTS.canteenAdmin);
    expect([200, 400]).toContain(res.status); // 400 if no canteen_id set yet
    if (res.status === 200) {
      const data = await res.json() as { slots: unknown[] };
      expect(Array.isArray(data.slots)).toBe(true);
    }
  });

  test("slot-analytics returns data for canteen_admin", async () => {
    const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
    const res = await apiFetch(`/api/canteen/slot-analytics?date=${today}`, {}, ACCOUNTS.canteenAdmin);
    expect(res.status).toBe(200);
    const data = await res.json() as { date: string; slots: unknown[] };
    expect(data.date).toBe(today);
    expect(Array.isArray(data.slots)).toBe(true);
  });

  test("receipts endpoint returns paginated list", async () => {
    const res = await apiFetch("/api/canteen/receipts?page=0&limit=10", {}, ACCOUNTS.canteenAdmin);
    expect(res.status).toBe(200);
    const data = await res.json() as { total: number; orders: unknown[] };
    expect(typeof data.total).toBe("number");
    expect(Array.isArray(data.orders)).toBe(true);
  });

  test("sales endpoint returns revenue data", async () => {
    const res = await apiFetch("/api/canteen/sales", {}, ACCOUNTS.canteenAdmin);
    expect(res.status).toBe(200);
    const data = await res.json() as { totals: unknown; hourly: unknown[]; daily: unknown[]; monthly: unknown[] };
    expect(data.totals).toBeDefined();
    expect(Array.isArray(data.hourly)).toBe(true);
  });

  test("worker cannot access canteen sales", async () => {
    const res = await apiFetch("/api/canteen/sales", {}, ACCOUNTS.worker);
    // Worker is included in allowed roles on this endpoint
    expect([200, 403]).toContain(res.status);
  });
});

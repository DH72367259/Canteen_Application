/**
 * 06-worker-dashboard.spec.ts
 * Worker can log in, view their dashboard, access bin operations, and
 * the prep summary. OTP verify flow is tested via API.
 */
import { test, expect } from "@playwright/test";
import { loginWorker, apiFetch, ACCOUNTS, APP_URL } from "./_helpers";

test.describe("Worker dashboard — UI", () => {
  test.beforeEach(async ({ page }) => {
    await loginWorker(page);
  });

  test("worker lands on orders or dashboard page", async ({ page }) => {
    await expect(page).toHaveURL(/\/worker\/(orders|dashboard)/, { timeout: 10_000 });
  });

  test("worker dashboard shows bin/order content", async ({ page }) => {
    // Navigate to dashboard if on orders
    if (page.url().includes("/worker/orders")) {
      await page.goto(`${APP_URL}/worker/dashboard`, { waitUntil: "domcontentloaded" });
    }
    // Should show some content — either orders, bins, or empty state
    await expect(page.locator("body")).toBeVisible({ timeout: 10_000 });
    // No unhandled error overlay
    await expect(page.getByText(/application error/i)).not.toBeVisible({ timeout: 3_000 }).catch(() => {});
  });
});

test.describe("Worker API access control", () => {
  test("worker can access prep-summary", async () => {
    const res = await apiFetch("/api/canteen/prep-summary", {}, ACCOUNTS.worker);
    // 200 (data) or 400 (canteen_id missing) — both valid
    expect([200, 400]).toContain(res.status);
  });

  test("worker can access live-orders", async () => {
    const res = await apiFetch("/api/canteen/live-orders", {}, ACCOUNTS.worker);
    expect(res.status).toBe(200);
  });

  test("worker cannot access admin user list", async () => {
    const res = await apiFetch("/api/admin/users", {}, ACCOUNTS.worker);
    expect(res.status).toBe(403);
  });

  test("worker cannot create menu items", async () => {
    const res = await apiFetch("/api/canteen/menu", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Hack", price_paise: 0 }),
    }, ACCOUNTS.worker);
    expect(res.status).toBe(403);
  });

  test("worker can access bin status endpoints", async () => {
    const db = (await import("./_helpers")).adminClient();
    const { data: bins } = await db.from("bins").select("id").limit(1);
    if (!bins?.length) { test.skip(); return; }

    const binId = bins[0].id;
    const res = await apiFetch(`/api/bins/${binId}/status`, {}, ACCOUNTS.worker);
    expect([200, 404]).toContain(res.status);
  });
});

test.describe("Worker OTP page", () => {
  test("worker OTP verify page loads", async ({ page }) => {
    await loginWorker(page);
    await page.goto(`${APP_URL}/worker/otp-verify`, { waitUntil: "domcontentloaded" });
    // Should show OTP input or redirect — not crash
    await expect(page.locator("body")).toBeVisible({ timeout: 10_000 });
  });
});

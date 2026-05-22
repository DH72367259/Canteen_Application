/**
 * 31-launch-fixes.spec.ts
 *
 * Browser-level regression coverage for the launch-week fixes:
 *
 *   - Inventory `remaining` field shows on the public menu API
 *     (commit cd27690 — SQL enum bug fix)
 *   - Worker dashboard has a Bins tab in the bottom nav
 *     (commit 3d9d5c3 — Bins + search)
 *   - Worker Orders tab has a search input
 *     (commit 3d9d5c3)
 *   - Login page (student app) does not show "Canteen Login" tab when
 *     accessed in native context (best-effort: web defaults to showing
 *     both tabs; we just verify the page loads and tabs work)
 *
 * These complement the earlier 26-critical-fixes.spec.ts and
 * 27-recent-fixes.spec.ts files.
 */
import { test, expect } from "@playwright/test";
import { APP_URL, ACCOUNTS, loginWorker } from "./_helpers";

test.describe("Launch-week regression", () => {
  test("public menu API returns `remaining` per item", async ({ request }) => {
    // Fetch canteens directly from Supabase to find a real id. We could hit
    // /api/canteens/colleges but that returns a different shape.
    const { createClient } = await import("@supabase/supabase-js");
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );
    const { data: canteens } = await sb.from("canteens").select("id").limit(1);
    expect(canteens?.length ?? 0).toBeGreaterThan(0);
    const canteenId = canteens![0].id;

    const res = await request.get(`${APP_URL}/api/canteens/${canteenId}/menu`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(Array.isArray(body.items)).toBe(true);
    for (const item of body.items) {
      // remaining is either a non-negative number OR null (no cap configured)
      expect(item).toHaveProperty("remaining");
      if (item.remaining !== null) {
        expect(typeof item.remaining).toBe("number");
        expect(item.remaining).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test("worker bottom-nav includes Bins tab", async ({ page }) => {
    await loginWorker(page);
    // Staging may have stale late orders that auto-switch the worker into
    // the Late Pickup tab — the bottom nav is still rendered there, so
    // we look for the button by its accessible name (includes icon + label).
    await page.waitForURL(/\/worker\/(orders|dashboard)/, { timeout: 15_000 });
    const binsButton = page.locator('button:has-text("Bins")').first();
    await expect(binsButton).toBeVisible({ timeout: 15_000 });
  });

  test("worker Orders tab has search input", async ({ page }) => {
    await loginWorker(page);
    // Force-navigate to Orders tab in case auto-late-switch redirected.
    // The bottom-nav button click pulls us back to orders.
    const ordersButton = page.locator('button:has-text("Orders")').first();
    await ordersButton.click({ timeout: 15_000 });
    const search = page.getByPlaceholder(/search/i);
    await expect(search.first()).toBeVisible({ timeout: 15_000 });
  });

  test("clicking Bins tab swaps content to bin grid", async ({ page }) => {
    await loginWorker(page);
    const binsButton = page.locator('button:has-text("Bins")').first();
    await binsButton.click({ timeout: 15_000 });
    // The Bins tab content shows either a color filter chip ("All") OR
    // the empty state when no bins are assigned. Both are valid.
    const allChip = page.getByText(/^All \(\d+\)$/);
    const emptyMsg = page.getByText(/No bins assigned/i);
    await expect(allChip.or(emptyMsg).first()).toBeVisible({ timeout: 15_000 });
  });

  test("ORDER_STATUS_ENUM does not contain 'refunded'", async () => {
    // Regression guard against the inventory bug. If someone adds "refunded"
    // to the order_status enum, lib/menuItemCapacity.ts must be updated to
    // re-include it in the not-in filter. This test fails loudly so it
    // can't go unnoticed.
    const { createClient } = await import("@supabase/supabase-js");
    const sb = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );
    const probe = await sb.from("orders").select("id").not("status", "in", '("refunded")').limit(1);
    expect(probe.error?.message ?? "").toContain("invalid input value for enum");
  });
});

test.describe("Smoke — login (sanity)", () => {
  test("admin login lands on /admin/dashboard", async ({ page }) => {
    const a = ACCOUNTS.superAdmin;
    await page.goto(`${APP_URL}/login?role=canteen_admin`);
    await page.fill('input[type="email"]', a.email);
    await page.fill('input[type="password"]', a.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/admin\/dashboard/, { timeout: 15_000 });
  });
});

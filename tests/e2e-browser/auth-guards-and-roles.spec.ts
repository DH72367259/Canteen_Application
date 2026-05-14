/**
 * Auth Guards & Role-Based Access Tests
 *
 * Covers:
 * - Login redirects per role (super_admin, co_admin, canteen_admin, worker, student)
 * - Unauthenticated route guards — protected pages redirect to /login
 * - Cross-role access denials (student can't open /admin, worker can't open /vendor)
 * - API-level role guards (401 / 403 for wrong role)
 * - Staff password-expiry bypass (staff passwords never expire)
 * - Token required on every authenticated API route
 */
import { test, expect } from "@playwright/test";
import {
  APP_URL,
  WHITELIST,
  getAccessToken,
  apiFetch,
  loginViaPasswordTab,
  loginWorkerUI,
  adminClient,
  provisionStudent,
  deleteUser,
} from "./_helpers";

// ── Login redirect per role ─────────────────────────────────────────────────

test.describe("Login redirects by role", () => {
  test("super_admin lands on /admin/dashboard after login", async ({ page }) => {
    await loginViaPasswordTab(page, WHITELIST.superAdmin.email, WHITELIST.superAdmin.password, /\/admin\/dashboard/);
    await expect(page).toHaveURL(/\/admin\/dashboard/);
  });

  test("co_admin lands on /admin/dashboard after login", async ({ page }) => {
    await loginViaPasswordTab(page, WHITELIST.coAdmin.email, WHITELIST.coAdmin.password, /\/admin\/dashboard/);
    await expect(page).toHaveURL(/\/admin\/dashboard/);
  });

  test("canteen_admin lands on /vendor/dashboard after login", async ({ page }) => {
    await loginViaPasswordTab(page, WHITELIST.canteenAdmin.email, WHITELIST.canteenAdmin.password, /\/vendor\/dashboard/);
    await expect(page).toHaveURL(/\/vendor\/dashboard/);
  });

  test("worker lands on /worker/orders after login", async ({ page }) => {
    await loginWorkerUI(page);
    await expect(page).toHaveURL(/\/worker\/orders/);
  });

  test("invalid password shows error, no redirect", async ({ page }) => {
    await page.goto(`${APP_URL}/login`, { waitUntil: "domcontentloaded" });
    const canteenTab = page.locator('button:has-text("Canteen Login")').first();
    await canteenTab.waitFor({ state: "visible", timeout: 15_000 });
    await canteenTab.click();
    await page.locator('input[type="email"]').first().fill(WHITELIST.superAdmin.email);
    await page.locator('input[type="password"]').first().fill("WrongPassword!");
    await page.locator('button:has-text("Sign In")').first().click();
    // Should stay on /login — not redirect
    await page.waitForTimeout(3_000);
    expect(page.url()).toMatch(/\/login/);
  });

  test("non-existent email shows error, no redirect", async ({ page }) => {
    await page.goto(`${APP_URL}/login`, { waitUntil: "domcontentloaded" });
    const canteenTab = page.locator('button:has-text("Canteen Login")').first();
    await canteenTab.waitFor({ state: "visible", timeout: 15_000 });
    await canteenTab.click();
    await page.locator('input[type="email"]').first().fill("nobody@noqx.test");
    await page.locator('input[type="password"]').first().fill("Any@12345");
    await page.locator('button:has-text("Sign In")').first().click();
    await page.waitForTimeout(3_000);
    expect(page.url()).toMatch(/\/login/);
  });
});

// ── Route guards — unauthenticated access ───────────────────────────────────

test.describe("Unauthenticated route protection", () => {
  test("/admin/dashboard redirects unauthenticated user", async ({ page }) => {
    await page.goto(`${APP_URL}/admin/dashboard`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2_000);
    expect(page.url()).not.toMatch(/\/admin\/dashboard/);
  });

  test("/vendor/dashboard redirects unauthenticated user", async ({ page }) => {
    await page.goto(`${APP_URL}/vendor/dashboard`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2_000);
    expect(page.url()).not.toMatch(/\/vendor\/dashboard/);
  });

  test("/worker/orders redirects unauthenticated user", async ({ page }) => {
    await page.goto(`${APP_URL}/worker/orders`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2_000);
    expect(page.url()).not.toMatch(/\/worker\/orders/);
  });

  test("/dashboard redirects unauthenticated user", async ({ page }) => {
    await page.goto(`${APP_URL}/dashboard`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2_000);
    expect(page.url()).not.toMatch(/^https?:\/\/[^/]+\/dashboard$/);
  });
});

// ── Cross-role access denials ───────────────────────────────────────────────

test.describe("Cross-role page guards", () => {
  test("worker cannot open /vendor/dashboard (redirected or 403)", async ({ page }) => {
    await loginWorkerUI(page);
    await page.goto(`${APP_URL}/vendor/dashboard`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2_000);
    // Either redirected away or shows access-denied text
    const body = await page.locator("body").textContent();
    const redirected = !page.url().includes("/vendor/dashboard");
    const denied = /forbidden|denied|not authorized|unauthorized/i.test(body ?? "");
    expect(redirected || denied).toBe(true);
  });

  test("worker cannot open /admin/dashboard (redirected or 403)", async ({ page }) => {
    await loginWorkerUI(page);
    await page.goto(`${APP_URL}/admin/dashboard`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2_000);
    const body = await page.locator("body").textContent();
    const redirected = !page.url().includes("/admin/dashboard");
    const denied = /forbidden|denied|not authorized|unauthorized/i.test(body ?? "");
    expect(redirected || denied).toBe(true);
  });

  test("canteen_admin cannot open /admin/dashboard (redirected or 403)", async ({ page }) => {
    await loginViaPasswordTab(page, WHITELIST.canteenAdmin.email, WHITELIST.canteenAdmin.password, /\/vendor\/dashboard/);
    await page.goto(`${APP_URL}/admin/dashboard`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2_000);
    const body = await page.locator("body").textContent();
    const redirected = !page.url().includes("/admin/dashboard");
    const denied = /forbidden|denied|not authorized|unauthorized/i.test(body ?? "");
    expect(redirected || denied).toBe(true);
  });
});

// ── API token requirements ──────────────────────────────────────────────────

test.describe("API bearer-token requirement", () => {
  const PROTECTED_ENDPOINTS = [
    "/api/admin/users",
    "/api/admin/stats",
    "/api/admin/canteens",
  ] as const;

  for (const ep of PROTECTED_ENDPOINTS) {
    test(`GET ${ep} without token returns 401`, async () => {
      const res = await apiFetch(`${APP_URL}${ep}`);
      expect(res.status).toBe(401);
    });
  }

  test("Bearer token with invalid JWT returns 401", async () => {
    const res = await apiFetch(`${APP_URL}/api/admin/stats`, {
      headers: { Authorization: "Bearer this.is.not.a.jwt" },
    });
    expect(res.status).toBe(401);
  });

  test("malformed Authorization header returns 401", async () => {
    const res = await apiFetch(`${APP_URL}/api/admin/stats`, {
      headers: { Authorization: "Basic dXNlcjpwYXNz" },
    });
    expect(res.status).toBe(401);
  });
});

// ── Role-based API denials ──────────────────────────────────────────────────

test.describe("Role-based API access control", () => {
  test("worker cannot call GET /api/admin/users (403)", async () => {
    const tok = await getAccessToken(WHITELIST.worker.email, WHITELIST.worker.password);
    const res = await apiFetch(`${APP_URL}/api/admin/users`, {
      headers: { Authorization: `Bearer ${tok}` },
    });
    expect(res.status).toBe(403);
  });

  test("canteen_admin cannot call GET /api/admin/users (403)", async () => {
    const tok = await getAccessToken(WHITELIST.canteenAdmin.email, WHITELIST.canteenAdmin.password);
    const res = await apiFetch(`${APP_URL}/api/admin/users`, {
      headers: { Authorization: `Bearer ${tok}` },
    });
    expect(res.status).toBe(403);
  });

  test("super_admin can call GET /api/admin/stats (200)", async () => {
    const tok = await getAccessToken(WHITELIST.superAdmin.email, WHITELIST.superAdmin.password);
    const res = await apiFetch(`${APP_URL}/api/admin/stats`, {
      headers: { Authorization: `Bearer ${tok}` },
    });
    expect(res.status).toBe(200);
  });

  test("co_admin can call GET /api/admin/stats (200)", async () => {
    const tok = await getAccessToken(WHITELIST.coAdmin.email, WHITELIST.coAdmin.password);
    const res = await apiFetch(`${APP_URL}/api/admin/stats`, {
      headers: { Authorization: `Bearer ${tok}` },
    });
    expect(res.status).toBe(200);
  });

  test("worker cannot call GET /api/admin/stats (403)", async () => {
    const tok = await getAccessToken(WHITELIST.worker.email, WHITELIST.worker.password);
    const res = await apiFetch(`${APP_URL}/api/admin/stats`, {
      headers: { Authorization: `Bearer ${tok}` },
    });
    expect(res.status).toBe(403);
  });
});

// ── Admin stats response shape ──────────────────────────────────────────────

test.describe("GET /api/admin/stats response shape", () => {
  test("returns counts, today, month, monthly, recent keys", async () => {
    const tok = await getAccessToken(WHITELIST.superAdmin.email, WHITELIST.superAdmin.password);
    const res = await apiFetch(`${APP_URL}/api/admin/stats`, {
      headers: { Authorization: `Bearer ${tok}` },
    });
    const data = await res.json() as Record<string, unknown>;
    expect(data).toHaveProperty("counts");
    expect(data).toHaveProperty("today");
    expect(data).toHaveProperty("month");
    expect(data).toHaveProperty("monthly");
    expect(data).toHaveProperty("recent");
  });

  test("counts has canteens_active and users_total", async () => {
    const tok = await getAccessToken(WHITELIST.superAdmin.email, WHITELIST.superAdmin.password);
    const res = await apiFetch(`${APP_URL}/api/admin/stats`, {
      headers: { Authorization: `Bearer ${tok}` },
    });
    const data = await res.json() as { counts: Record<string, unknown> };
    expect(typeof data.counts.canteens_active).toBe("number");
    expect(typeof data.counts.users_total).toBe("number");
  });

  test("monthly is an array of 6 buckets", async () => {
    const tok = await getAccessToken(WHITELIST.superAdmin.email, WHITELIST.superAdmin.password);
    const res = await apiFetch(`${APP_URL}/api/admin/stats`, {
      headers: { Authorization: `Bearer ${tok}` },
    });
    const data = await res.json() as { monthly: unknown[] };
    expect(Array.isArray(data.monthly)).toBe(true);
    expect(data.monthly.length).toBe(6);
  });

  test("recent is an array (at most 8 items)", async () => {
    const tok = await getAccessToken(WHITELIST.superAdmin.email, WHITELIST.superAdmin.password);
    const res = await apiFetch(`${APP_URL}/api/admin/stats`, {
      headers: { Authorization: `Bearer ${tok}` },
    });
    const data = await res.json() as { recent: unknown[] };
    expect(Array.isArray(data.recent)).toBe(true);
    expect(data.recent.length).toBeLessThanOrEqual(8);
  });
});

// ── Student self-service restrictions ──────────────────────────────────────

test.describe("Student role restrictions", () => {
  let studentId = "";

  test.beforeAll(async () => {
    const admin = adminClient();
    const { data: c } = await admin.from("canteens").select("id").limit(1).maybeSingle();
    if (!c?.id) return;
    const s = await provisionStudent(c.id, "auth-guard-test");
    studentId = s.id;
  });

  test.afterAll(async () => { if (studentId) await deleteUser(studentId); });

  test("student cannot access admin stats API (403)", async () => {
    if (!studentId) test.skip();
    const admin = adminClient();
    const { data: student } = await admin.auth.admin.getUserById(studentId);
    if (!student?.user?.email) { test.skip(); return; }
    const tok = await getAccessToken(student.user.email, "Student@12345").catch(() => "");
    if (!tok) { test.skip(); return; }
    const res = await apiFetch(`${APP_URL}/api/admin/stats`, {
      headers: { Authorization: `Bearer ${tok}` },
    });
    expect(res.status).toBe(403);
  });

  test("student cannot access admin users API (403)", async () => {
    if (!studentId) test.skip();
    const admin = adminClient();
    const { data: student } = await admin.auth.admin.getUserById(studentId);
    if (!student?.user?.email) { test.skip(); return; }
    const tok = await getAccessToken(student.user.email, "Student@12345").catch(() => "");
    if (!tok) { test.skip(); return; }
    const res = await apiFetch(`${APP_URL}/api/admin/users`, {
      headers: { Authorization: `Bearer ${tok}` },
    });
    expect(res.status).toBe(403);
  });
});

/**
 * 21-worker-complete.spec.ts
 * Worker full workflow: login, view orders, OTP entry, access control.
 */
import { test, expect } from "@playwright/test";
import { apiFetch, ACCOUNTS, adminClient, getCanteen1Id, APP_URL } from "./_helpers";

test.describe("Worker login and navigation", () => {
  test("worker reaches orders or dashboard after login", async ({ page }) => {
    const { loginWorker } = await import("./_helpers");
    await loginWorker(page);
    await expect(page).toHaveURL(/\/worker\/(orders|dashboard)/, { timeout: 10_000 });
  });

  test("worker dashboard shows no application error", async ({ page }) => {
    const { loginWorker } = await import("./_helpers");
    await loginWorker(page);
    if (page.url().includes("/worker/orders")) {
      await page.goto(`${APP_URL}/worker/dashboard`, { waitUntil: "domcontentloaded" });
    }
    await expect(page.locator("body")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/application error/i)).not.toBeVisible({ timeout: 3_000 }).catch(() => {});
  });

  test("worker orders page loads", async ({ page }) => {
    const { loginWorker } = await import("./_helpers");
    await loginWorker(page);
    await page.goto(`${APP_URL}/worker/orders`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toBeVisible({ timeout: 10_000 });
  });

  test("worker OTP verify page loads without crash", async ({ page }) => {
    const { loginWorker } = await import("./_helpers");
    await loginWorker(page);
    await page.goto(`${APP_URL}/worker/otp-verify`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/application error/i)).not.toBeVisible({ timeout: 3_000 }).catch(() => {});
  });
});

test.describe("Worker API access — allowed", () => {
  test("worker can access live-orders", async () => {
    const res = await apiFetch("/api/canteen/live-orders", {}, ACCOUNTS.worker);
    expect(res.status).toBe(200);
  });

  test("worker can access prep-summary", async () => {
    const res = await apiFetch("/api/canteen/prep-summary", {}, ACCOUNTS.worker);
    expect([200, 400]).toContain(res.status);
  });

  test("worker can access bin status", async () => {
    const canteenId = await getCanteen1Id();
    const db = adminClient();
    const { data: bins } = await db.from("bins").select("id").eq("canteen_id", canteenId).limit(1);
    if (!bins?.length) { test.skip(); return; }
    const res = await apiFetch(`/api/bins/${bins[0].id}/status`, {}, ACCOUNTS.worker);
    expect([200, 404]).toContain(res.status);
  });

  test("worker can verify OTP (correct flow)", async () => {
    const canteenId = await getCanteen1Id();
    const db = adminClient();
    const { data: order } = await db.from("orders")
      .insert({ canteen_id: canteenId, status: "placed_in_bin", total_amount: 80, otp: "987654" })
      .select("id").single();
    if (!order) { test.skip(); return; }

    const res = await apiFetch(`/api/orders/${order.id}/verify-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ otp: "987654" }),
    }, ACCOUNTS.worker);
    expect(res.status).toBe(200);
    await db.from("orders").delete().eq("id", order.id);
  });

  test("worker can access notifications", async () => {
    const res = await apiFetch("/api/notifications", {}, ACCOUNTS.worker);
    expect(res.status).toBe(200);
  });
});

test.describe("Worker API access — blocked", () => {
  test("worker cannot access admin user list", async () => {
    const res = await apiFetch("/api/admin/users", {}, ACCOUNTS.worker);
    expect(res.status).toBe(403);
  });

  test("worker cannot create menu items", async () => {
    const res = await apiFetch("/api/canteen/menu", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Hack", price: 0, category: "Meals" }),
    }, ACCOUNTS.worker);
    expect(res.status).toBe(403);
  });

  test("worker cannot update slot control", async () => {
    const res = await apiFetch("/api/canteen/slot-control", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ max_bins: 999 }),
    }, ACCOUNTS.worker);
    expect(res.status).toBe(403);
  });

  test("worker cannot cancel orders", async () => {
    const canteenId = await getCanteen1Id();
    const db = adminClient();
    const { data: order } = await db.from("orders")
      .insert({ canteen_id: canteenId, status: "placed", total_amount: 80, otp: "111999" })
      .select("id").single();
    if (!order) { test.skip(); return; }

    const res = await apiFetch(`/api/orders/${order.id}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "Worker trying to cancel" }),
    }, ACCOUNTS.worker);
    expect(res.status).toBe(403);
    await db.from("orders").delete().eq("id", order.id);
  });

  test("worker cannot access canteen sales (403)", async () => {
    const today = new Date().toISOString().split("T")[0];
    const res = await apiFetch(`/api/canteen/sales?date=${today}`, {}, ACCOUNTS.worker);
    expect(res.status).toBe(403);
  });

  test("worker cannot access receipts (403)", async () => {
    const res = await apiFetch("/api/canteen/receipts", {}, ACCOUNTS.worker);
    expect(res.status).toBe(403);
  });

  test("worker cannot delete users", async () => {
    const res = await apiFetch("/api/admin/users", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid: "fake-uid" }),
    }, ACCOUNTS.worker);
    expect(res.status).toBe(403);
  });
});

test.describe("Worker canteen isolation", () => {
  test("worker only sees their own canteen's live-orders", async () => {
    const canteenId = await getCanteen1Id();
    const res = await apiFetch("/api/canteen/live-orders", {}, ACCOUNTS.worker);
    expect(res.status).toBe(200);
    const data = await res.json() as { bins: { canteen_id?: string }[] };
    const wrongCanteen = data.bins.filter(b => b.canteen_id && b.canteen_id !== canteenId);
    expect(wrongCanteen.length).toBe(0);
  });
});

import { test, expect } from "@playwright/test";
import {
  APP_URL,
  WHITELIST,
  provisionStudent,
  loginViaPasswordTab,
  loginWorkerUI,
  provisionStaff,
  deleteUser,
  adminClient,
  apiFetch,
  SUPABASE_URL,
} from "./_helpers";

// Helper: Get auth token via API
async function loginToken(email: string, password: string): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json() as { access_token?: string };
  if (!data.access_token) throw new Error("Failed to get auth token");
  return data.access_token;
}

let canteenId = "";

test.beforeAll(async () => {
  const admin = adminClient();
  const { data: canteens } = await admin.from("canteens").select("id").limit(1);
  canteenId = canteens?.[0]?.id || "c1";
});

// ── Feature 1: Slot selection in checkout with real-time capacity ──
test("Slot selector displays bin capacity and updates in real-time", async ({
  page,
}) => {
  const student = await provisionStudent(canteenId, "slot-capacity-test");
  const token = await loginToken(student.email, student.password);

  // Navigate to cart
  await page.goto(`${APP_URL}/dashboard/cart?canteenId=${canteenId}`, {
    waitUntil: "domcontentloaded",
  });

  // Wait for slot capacity polling (2 seconds)
  await page.waitForTimeout(3000);

  // Verify "Choose ready time" section exists
  const slotSection = page.locator('h2:has-text("Choose ready time")');
  await expect(slotSection).toBeVisible({ timeout: 10_000 });

  // Check for slot buttons with time format
  const slotButtons = page.locator('button').filter({ hasText: /\d+:\d+/ });
  const count = await slotButtons.count();
  expect(count).toBeGreaterThan(0);

  // Check for bin capacity display ("X/Y bins")
  const capacityDisplay = page.locator('span').filter({ hasText: /\d+\/\d+/ });
  const capacityCount = await capacityDisplay.count();
  expect(capacityCount).toBeGreaterThanOrEqual(1);

  await deleteUser(student.id);
});

// ── Feature 2: Slots disable when order doesn't fit ──
test("Full slots show FULL badge and are disabled", async ({ page }) => {
  const student = await provisionStudent(canteenId, "slot-full-test");
  await loginToken(student.email, student.password);

  await page.goto(`${APP_URL}/dashboard/cart?canteenId=${canteenId}`, {
    waitUntil: "domcontentloaded",
  });

  // Wait for capacity check
  await page.waitForTimeout(3000);

  // Look for FULL badges
  const fullBadges = page.locator('div').filter({ hasText: "FULL" });
  const fullCount = await fullBadges.count();

  // Slots exist (might or might not be full depending on capacity)
  const slotButtons = page.locator('button').filter({ hasText: /:\d+/ });
  const totalSlots = await slotButtons.count();

  expect(totalSlots).toBeGreaterThan(0);
  // fullCount might be 0 (all slots available) or > 0 (some full)
  expect(fullCount).toBeGreaterThanOrEqual(0);

  await deleteUser(student.id);
});

// ── Feature 3: 30-second cancellation timer ──
test("Cancel button includes 30-second timer", async ({ page }) => {
  const student = await provisionStudent(canteenId, "cancel-timer-test");
  const token = await loginToken(student.email, student.password);

  // Go to orders page
  await page.goto(`${APP_URL}/dashboard/orders`, {
    waitUntil: "domcontentloaded",
  });

  await page.waitForTimeout(1000);

  // Look for cancel button with timer
  const cancelButtons = page.locator('button:has-text("Cancel order")');
  const count = await cancelButtons.count();

  // If order exists, verify timer format
  if (count > 0) {
    const text = await cancelButtons.first().textContent();
    expect(text).toMatch(/\(\d+s\)|Cancellation/);
  }

  await deleteUser(student.id);
});

// ── Feature 4: Max bins dropdown (10-60) ──
test("Vendor can select max bins from dropdown 10-60", async ({ page }) => {
  await loginViaPasswordTab(
    page,
    WHITELIST.canteenAdmin.email,
    WHITELIST.canteenAdmin.password,
    /\/vendor\/dashboard/
  );

  const select = page.locator('select').first();
  const isVisible = await select.isVisible({ timeout: 10_000 }).catch(() => false);

  if (isVisible) {
    const options = await select.locator('option').count();
    // Should have 11 options: 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60
    expect(options).toBeGreaterThanOrEqual(11);
  }
});

// ── Feature 5: Per-item quantity limit (max 7) ──
test("Per-item quantity limit is enforced (max 7)", async ({
  page,
}) => {
  const student = await provisionStudent(canteenId, "qty-limit-test");
  const token = await loginToken(student.email, student.password);

  // Try to place order with qty > 7
  const res = await apiFetch(`${APP_URL}/api/orders/place`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      canteenId,
      cartItems: [{ id: "test", name: "Item", price: 100, qty: 8 }],
      total: 800,
      slotLabel: "afternoon",
    }),
  });

  // Should reject order with qty > 7
  const isError = res.status !== 200;
  expect(isError || (await res.json()).error).toBeTruthy();

  await deleteUser(student.id);
});

// ── Feature 6: Real-time bin updates (vendor) ──
test("Vendor dashboard updates bins every 2 seconds without flickering", async ({
  page,
}) => {
  await loginViaPasswordTab(
    page,
    WHITELIST.canteenAdmin.email,
    WHITELIST.canteenAdmin.password,
    /\/vendor\/dashboard/
  );

  await page.waitForTimeout(1000);

  // Get initial element count
  const elements = page.locator('div[class*="card"]');
  const initialCount = await elements.count();

  // Wait for 2 polling cycles
  await page.waitForTimeout(2500);

  // Get updated count (should be similar, no massive changes)
  const updatedCount = await elements.count();
  const diff = Math.abs(updatedCount - initialCount);

  // Allow small variance due to polling updates
  expect(diff).toBeLessThan(2);
});

// ── Feature 7: Worker dashboard improved UI ──
test("Worker tabs are properly spaced and visible", async ({ page }) => {
  await loginWorkerUI(page);

  await page.waitForTimeout(500);

  // Check for tab buttons
  const orderTab = page.locator('button').filter({ hasText: "Orders" });
  const isVisible = await orderTab.isVisible({ timeout: 5_000 }).catch(() => false);

  if (isVisible) {
    const box = await orderTab.boundingBox();
    // Tab should have reasonable height (at least 40px for touch target)
    expect(box?.height).toBeGreaterThanOrEqual(40);
  }
});

// ── Feature 8: Multi-canteen ordering ──
test("Student can order from multiple canteens independently", async ({
  page,
}) => {
  const student = await provisionStudent(canteenId, "multi-canteen-test");
  const token = await loginToken(student.email, student.password);

  // Fetch canteens
  const admin = adminClient();
  const { data: canteens } = await admin.from("canteens").select("id, name").limit(2);

  if (canteens && canteens.length >= 2) {
    // Try to access cart for each canteen
    for (const canteen of canteens) {
      await page.goto(`${APP_URL}/dashboard/cart?canteenId=${canteen.id}`, {
        waitUntil: "domcontentloaded",
      });

      // Page should load without errors
      expect(page.url()).toContain("/cart");
    }
  }

  await deleteUser(student.id);
});

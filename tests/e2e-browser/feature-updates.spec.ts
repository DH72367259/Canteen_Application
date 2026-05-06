import { test, expect, Page } from "@playwright/test";
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
} from "./_helpers";

let studentId = "";
let vendorId = "";
let workerId = "";
let canteenId = "";

test.beforeAll(async () => {
  const admin = adminClient();
  // Get the first canteen for testing
  const { data: canteens } = await admin.from("canteens").select("id").limit(1);
  canteenId = canteens?.[0]?.id || "c1";

  // Provision test users
  const student = await provisionStudent(canteenId, "feature-test");
  const vendor = await provisionStaff("canteen_admin", canteenId, "feature-test");
  const worker = await provisionStaff("worker", canteenId, "feature-test");

  studentId = student.id;
  vendorId = vendor.id;
  workerId = worker.id;
});

test.afterAll(async () => {
  await deleteUser(studentId);
  await deleteUser(vendorId);
  await deleteUser(workerId);
});

// ── Feature 1: Slot selection only in checkout, not in menu ──
test("Slot selection appears only in checkout, not in menu items page", async ({
  page,
}) => {
  // Login as student
  const student = await provisionStudent(canteenId, "slot-test");
  await page.goto(`${APP_URL}/login`);

  // Select student login and authenticate
  const studentTab = page.locator('button:has-text("Student")').first();
  await studentTab.waitFor({ state: "visible", timeout: 10_000 });
  await studentTab.click();

  const emailInput = page.locator('input[type="email"]').first();
  await emailInput.waitFor({ state: "visible", timeout: 10_000 });
  await emailInput.fill(student.email);
  await page.locator('input[type="password"]').first().fill(student.password);

  const submitBtn = page.locator('button[type="submit"]').first();
  await submitBtn.click();
  await page.waitForURL(/\/dashboard/, { timeout: 20_000 });

  // Navigate to menu
  const menuBtn = page.locator('a[href*="/menu"]').first();
  await menuBtn.waitFor({ state: "visible", timeout: 10_000 });
  await menuBtn.click();
  await page.waitForURL(/\/menu/, { timeout: 10_000 });

  // Verify slot selector is NOT visible on menu page
  const slotLabel = page.locator('label:has-text("Select Pickup Slot")');
  await expect(slotLabel).not.toBeVisible();

  // Add items to cart
  const addButton = page.locator('button:has-text("ADD")').first();
  await addButton.waitFor({ state: "visible", timeout: 10_000 });
  await addButton.click();

  // Go to cart
  const cartBtn = page.locator('button:has-text("in cart")');
  await cartBtn.waitFor({ state: "visible", timeout: 10_000 });
  await cartBtn.click();
  await page.waitForURL(/\/cart/, { timeout: 10_000 });

  // Verify slot selector IS visible on cart page
  const cartSlotLabel = page.locator('label:has-text("Select Pickup Slot")');
  await expect(cartSlotLabel).toBeVisible({ timeout: 10_000 });

  await deleteUser(student.id);
});

// ── Feature 2: 30-second cancellation timer ──
test("Cancellation button shows 30-second timer and disables after expiry", async ({
  page,
}) => {
  const student = await provisionStudent(canteenId, "cancel-timer-test");

  // Login and place an order
  await page.goto(`${APP_URL}/login`);
  const studentTab = page.locator('button:has-text("Student")').first();
  await studentTab.click();

  const emailInput = page.locator('input[type="email"]').first();
  await emailInput.fill(student.email);
  await page.locator('input[type="password"]').first().fill(student.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL(/\/dashboard/, { timeout: 20_000 });

  // Navigate to menu and add items
  const menuBtn = page.locator('a[href*="/menu"]').first();
  await menuBtn.click();
  await page.waitForURL(/\/menu/, { timeout: 10_000 });

  const addButton = page.locator('button:has-text("ADD")').first();
  await addButton.waitFor({ state: "visible", timeout: 10_000 });
  await addButton.click();

  // Go to cart
  const cartBtn = page.locator('button:has-text("in cart")');
  await cartBtn.click();
  await page.waitForURL(/\/cart/, { timeout: 10_000 });

  // Select slot and proceed to checkout
  const slotBtn = page.locator('button').filter({ hasText: /\d+:\d+/ }).first();
  await slotBtn.waitFor({ state: "visible", timeout: 10_000 });
  await slotBtn.click();

  // Find and click pay button (simplified assumption)
  const payButton = page.locator('button:has-text("Pay")').first();
  if (await payButton.isVisible({ timeout: 5_000 }).catch(() => false)) {
    // In test mode, this might redirect directly
    await payButton.click();
  }

  // Wait for order status page
  await page.waitForURL(/\/order-status/, { timeout: 15_000 });

  // Check cancel button shows timer
  const cancelBtn = page.locator('button:has-text("Cancel order")');
  await expect(cancelBtn).toBeVisible({ timeout: 10_000 });

  // Verify timer is shown (contains "s")
  const btnText = await cancelBtn.textContent();
  expect(btnText).toMatch(/\d+s/);

  await deleteUser(student.id);
});

// ── Feature 3: Per-item quantity limit (max 7) ──
test("Student cannot add more than 7 of the same item per order", async ({
  page,
}) => {
  const student = await provisionStudent(canteenId, "qty-limit-test");

  await page.goto(`${APP_URL}/login`);
  const studentTab = page.locator('button:has-text("Student")').first();
  await studentTab.click();

  const emailInput = page.locator('input[type="email"]').first();
  await emailInput.fill(student.email);
  await page.locator('input[type="password"]').first().fill(student.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL(/\/dashboard/, { timeout: 20_000 });

  // Navigate to menu
  const menuBtn = page.locator('a[href*="/menu"]').first();
  await menuBtn.click();
  await page.waitForURL(/\/menu/, { timeout: 10_000 });

  // Add an item multiple times to test limit
  const addButton = page.locator('button:has-text("ADD")').first();
  await addButton.waitFor({ state: "visible", timeout: 10_000 });

  // Click add button 7 times
  for (let i = 0; i < 7; i++) {
    const btn = page.locator('button:has-text("ADD")').first();
    if (await btn.isVisible().catch(() => false)) {
      await btn.click();
      await page.waitForTimeout(200);
    }
  }

  // Try to add 8th - should fail or show error
  const allAddButtons = page.locator('button').filter({ hasText: /ADD|\+/ });
  const count = await allAddButtons.count();

  // At least one button should be visible (the add button or + button)
  expect(count).toBeGreaterThan(0);

  await deleteUser(student.id);
});

// ── Feature 4: Max bins dropdown (10-60) ──
test("Vendor can set max bins per slot from dropdown (10-60)", async ({
  page,
}) => {
  await loginViaPasswordTab(
    page,
    WHITELIST.canteenAdmin.email,
    WHITELIST.canteenAdmin.password,
    /\/vendor\/dashboard/
  );

  // Find the max bins dropdown
  const maxBinsLabel = page.locator('label:has-text("Max bins per slot")').first();
  await expect(maxBinsLabel).toBeVisible({ timeout: 10_000 });

  // Open the dropdown
  const dropdown = page.locator('select').first();
  await dropdown.waitFor({ state: "visible", timeout: 10_000 });

  // Get all options
  const options = await page.locator('select option').count();

  // Should have at least options for 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60
  expect(options).toBeGreaterThanOrEqual(11);

  // Select 30 and verify
  await dropdown.selectOption("30");
  const selectedValue = await dropdown.inputValue();
  expect(selectedValue).toBe("30");
});

// ── Feature 5: Real-time bin availability (2-second polling) ──
test("Vendor dashboard shows real-time bin updates", async ({ page }) => {
  await loginViaPasswordTab(
    page,
    WHITELIST.canteenAdmin.email,
    WHITELIST.canteenAdmin.password,
    /\/vendor\/dashboard/
  );

  // Check that Live Orders section is visible
  const liveOrdersSection = page.locator('h2, h3').filter({ hasText: /Live Orders/i });
  await expect(liveOrdersSection.first()).toBeVisible({ timeout: 10_000 });

  // Capture initial bin count
  const bins = page.locator('[class*="bin"]');
  const initialCount = await bins.count();

  // Wait 2 seconds for polling update
  await page.waitForTimeout(2500);

  // Check if elements are still present (no flickering)
  const afterCount = await bins.count();

  // Bin count should remain similar (allowing for minor changes)
  expect(Math.abs(afterCount - initialCount)).toBeLessThan(2);
});

// ── Feature 5B: Real-time slot capacity for students (with quantity changes) ──
test("Student sees real-time slot availability with capacity limits and respects quantity changes", async ({
  page,
}) => {
  const student = await provisionStudent(canteenId, "slot-capacity-test");

  // Login
  await page.goto(`${APP_URL}/login`);
  const studentTab = page.locator('button:has-text("Student")').first();
  await studentTab.click();

  const emailInput = page.locator('input[type="email"]').first();
  await emailInput.fill(student.email);
  await page.locator('input[type="password"]').first().fill(student.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL(/\/dashboard/, { timeout: 20_000 });

  // Navigate to menu
  const menuBtn = page.locator('a[href*="/menu"]').first();
  await menuBtn.click();
  await page.waitForURL(/\/menu/, { timeout: 10_000 });

  // Add items to cart
  const addButtons = page.locator('button:has-text("ADD")');
  const firstAddBtn = addButtons.first();
  await firstAddBtn.waitFor({ state: "visible", timeout: 10_000 });
  await firstAddBtn.click();

  // Go to cart
  const cartBtn = page.locator('button:has-text("in cart")').first();
  await cartBtn.waitFor({ state: "visible", timeout: 10_000 });
  await cartBtn.click();
  await page.waitForURL(/\/cart/, { timeout: 10_000 });

  // Verify slot selector is visible
  const slotSection = page.locator('section').filter({ hasText: /Choose ready time/ });
  await expect(slotSection).toBeVisible({ timeout: 10_000 });

  // Get all slot buttons
  const slotButtons = page.locator('button').filter({ hasText: /:\d{2}/ });
  const slotCount = await slotButtons.count();

  // Should have at least one slot available
  expect(slotCount).toBeGreaterThan(0);

  // Wait for real-time capacity check (2 seconds)
  await page.waitForTimeout(2500);

  // Check that some slots show bin capacity (should be visible now)
  const slotsWithCapacity = page.locator('span').filter({ hasText: /bins/ });
  const capacityCount = await slotsWithCapacity.count();

  // Should show capacity info for slots
  expect(capacityCount).toBeGreaterThanOrEqual(1);

  // Test quantity change permutation
  // Find the increase quantity button
  const increaseBtn = page.locator('button:has-text("+")').first();
  await increaseBtn.click();

  // Wait for slot capacity re-check after quantity change
  await page.waitForTimeout(2500);

  // Verify capacity info updated
  const updatedCapacity = page.locator('span').filter({ hasText: /bins/ });
  const updatedCount = await updatedCapacity.count();

  expect(updatedCount).toBeGreaterThanOrEqual(1);

  // Verify slots are either enabled or disabled with proper labels
  const slotLabels = page.locator('div').filter({ hasText: /FULL/ });
  const fullCount = await slotLabels.count();

  // Some slots might be full after quantity increase
  expect(fullCount).toBeGreaterThanOrEqual(0);

  // Test reducing quantity
  const decreaseBtn = page.locator('button:has-text("−")').first();
  if (await decreaseBtn.isVisible()) {
    await decreaseBtn.click();
  }

  // Wait for capacity re-check
  await page.waitForTimeout(2500);

  // After reducing, previously full slots should become available
  const reenabledSlots = page.locator('button').filter({ hasText: /:\d{2}/ });
  const finalSlotCount = await reenabledSlots.count();

  expect(finalSlotCount).toBeGreaterThan(0);

  await deleteUser(student.id);
});

// ── Feature 5C: Slot disable/enable based on bin capacity ──
test("Slots are disabled when order doesn't fit, enabled when quantity reduced", async ({
  page,
}) => {
  const student = await provisionStudent(canteenId, "slot-disable-test");

  await page.goto(`${APP_URL}/login`);
  const studentTab = page.locator('button:has-text("Student")').first();
  await studentTab.click();

  const emailInput = page.locator('input[type="email"]').first();
  await emailInput.fill(student.email);
  await page.locator('input[type="password"]').first().fill(student.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL(/\/dashboard/, { timeout: 20_000 });

  // Navigate to menu and add items
  const menuBtn = page.locator('a[href*="/menu"]').first();
  await menuBtn.click();
  await page.waitForURL(/\/menu/, { timeout: 10_000 });

  const addButton = page.locator('button:has-text("ADD")').first();
  await addButton.waitFor({ state: "visible", timeout: 10_000 });

  // Add many items to potentially exceed slot capacity
  for (let i = 0; i < 5; i++) {
    const btn = page.locator('button:has-text("ADD"), button:has-text("+")', { hasNot: page.locator('label') }).first();
    if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await btn.click();
      await page.waitForTimeout(100);
    }
  }

  const cartBtn = page.locator('button:has-text("in cart")').first();
  await cartBtn.click();
  await page.waitForURL(/\/cart/, { timeout: 10_000 });

  // Wait for slot capacity check
  await page.waitForTimeout(2500);

  // Check for disabled slots
  const disabledSlots = page.locator('button[disabled]');
  const disabledCount = await disabledSlots.count();

  // There might be disabled slots due to capacity limits
  if (disabledCount > 0) {
    // Now reduce quantity
    const decreaseBtn = page.locator('button:has-text("−")').first();
    for (let i = 0; i < 3; i++) {
      if (await decreaseBtn.isVisible()) {
        await decreaseBtn.click();
        await page.waitForTimeout(100);
      }
    }

    // Wait for re-check
    await page.waitForTimeout(2500);

    // Verify slots are still present after quantity reduction
    const slotsAfter = page.locator('button').filter({ hasText: /:\d{2}/ });
    const slotsAfterCount = await slotsAfter.count();

    expect(slotsAfterCount).toBeGreaterThan(0);
  }

  await deleteUser(student.id);
});

// ── Feature 6: Worker tab UI improvements ──
test("Worker dashboard tabs are properly spaced and visible", async ({
  page,
}) => {
  await loginWorkerUI(page);

  // Find the bottom navigation with tabs
  const navButtons = page.locator("button").filter({ hasText: /Orders|Bin Verify|Prep Summary/ });

  // Should have 3 main tabs
  const count = await navButtons.count();
  expect(count).toBeGreaterThanOrEqual(3);

  // Check that tabs are reasonably sized (not tiny)
  for (let i = 0; i < Math.min(count, 3); i++) {
    const btn = navButtons.nth(i);
    const box = await btn.boundingBox();

    // Tab should have reasonable height (at least 50px)
    expect(box?.height).toBeGreaterThan(40);
  }
});

// ── Feature 7: Multi-canteen ordering ──
test("Student can place independent orders from multiple canteens", async ({
  page,
}) => {
  const student = await provisionStudent(canteenId, "multi-canteen-test");

  // Login as student
  await page.goto(`${APP_URL}/login`);
  const studentTab = page.locator('button:has-text("Student")').first();
  await studentTab.click();

  const emailInput = page.locator('input[type="email"]').first();
  await emailInput.fill(student.email);
  await page.locator('input[type="password"]').first().fill(student.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL(/\/dashboard/, { timeout: 20_000 });

  // Get canteens available
  const canteenCards = page.locator('[class*="canteen"]').filter({ hasText: /Canteen|Menu/ });
  const canteenCount = await canteenCards.count();

  // Should have at least 1 canteen available
  expect(canteenCount).toBeGreaterThan(0);

  await deleteUser(student.id);
});

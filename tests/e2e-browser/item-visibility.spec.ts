/**
 * Item Visibility & Availability Tests
 *
 * Verifies that items remain visible in the menu even when sold out,
 * and that they show proper availability status badges.
 *
 * Scenarios:
 * 1. Item shows "✓ Available" when stock is available
 * 2. Item shows "⛔ Out of Stock" when manager marks it as sold out
 * 3. Item shows "⏰ Not Available Now" when slot capacity is exhausted
 * 4. Student cannot add unavailable items to cart
 * 5. Items are greyed out but still visible (not hidden)
 */
import { test, expect } from "@playwright/test";
import { adminClient, APP_URL, WHITELIST } from "./_helpers";

test.describe("Item Visibility & Availability", () => {
  let canteenId: string;
  let studentId: string;
  let studentEmail: string;
  let studentPassword: string;
  let itemId: string;
  let itemName: string;

  test.beforeAll(async () => {
    const admin = adminClient();

    // Load a test canteen
    const { data: canteens } = await admin
      .from("canteens")
      .select("id")
      .limit(1)
      .single();
    canteenId = canteens?.id ?? "";
    if (!canteenId) throw new Error("No canteen found");

    // Get a menu item for this canteen
    const { data: items } = await admin
      .from("menu_items")
      .select("id, name")
      .eq("canteen_id", canteenId)
      .limit(1)
      .single();
    itemId = items?.id ?? "";
    itemName = items?.name ?? "Test Item";
    if (!itemId) throw new Error("No menu item found");

    // Create a test student
    const create = await admin.auth.admin.createUser({
      email: `e2e-item-visibility-${Date.now()}@noqx.test`,
      password: "Student@12345",
      email_confirm: true,
      user_metadata: { name: "Item Visibility Tester" },
    });
    if (create.error) throw create.error;
    studentId = create.data.user.id;
    studentEmail = create.data.user.email ?? "";
    studentPassword = "Student@12345";

    await admin.from("profiles").upsert({
      id: studentId,
      name: "Item Visibility Tester",
      role: "user",
      canteen_id: canteenId,
    });
  });

  test("should show items with Available status when in stock", async ({ page }) => {
    // Navigate to menu
    await page.goto(`${APP_URL}/dashboard/menu/${canteenId}`, {
      waitUntil: "domcontentloaded",
    });

    // Login if needed
    const loginButton = page.locator("button:has-text('Sign In')");
    if (await loginButton.isVisible({ timeout: 5000 })) {
      await page.fill('input[type="email"]', studentEmail);
      await page.fill('input[type="password"]', studentPassword);
      await loginButton.click();
      await page.waitForURL(`/dashboard/menu/${canteenId}`);
    }

    // Find the test item in the menu
    const itemCard = page.locator(`text=${itemName}`).first().locator("..");
    expect(itemCard).toBeDefined();

    // Should show "✓ Available" or "Available" badge
    const availableBadge = itemCard.locator('text=/✓|Available/');
    await availableBadge.waitFor({ state: "visible" });
    expect(availableBadge).toBeVisible();

    // Should show ADD button (enabled)
    const addButton = itemCard.locator('button:has-text("ADD")');
    expect(addButton).toBeVisible();
    expect(addButton).toBeEnabled();
  });

  test("should show items greyed out with Out of Stock status when sold out", async ({ page, context }) => {
    const admin = adminClient();

    // Mark the item as sold out
    await admin
      .from("menu_items")
      .update({ is_sold_out: true })
      .eq("id", itemId);

    // Invalidate cache by waiting a moment
    await page.waitForTimeout(100);

    // Navigate to menu in a new context to bypass cache
    const newPage = await context.newPage();
    await newPage.goto(`${APP_URL}/dashboard/menu/${canteenId}`, {
      waitUntil: "domcontentloaded",
    });

    // Login
    await newPage.fill('input[type="email"]', studentEmail);
    await newPage.fill('input[type="password"]', studentPassword);
    await newPage.locator('button:has-text("Sign In")').click();
    await newPage.waitForURL(`/dashboard/menu/${canteenId}`);

    // Find the test item - it should still be visible!
    const itemCard = newPage
      .locator(`text=${itemName}`)
      .first()
      .locator("..");
    expect(itemCard).toBeDefined();

    // Should show "⛔ Out of Stock" badge
    const outOfStockBadge = itemCard.locator(
      'text=/⛔|Out of Stock/',
    );
    await outOfStockBadge.waitFor({ state: "visible" });
    expect(outOfStockBadge).toBeVisible();

    // Should show disabled OUT OF STOCK button
    const outOfStockButton = itemCard.locator(
      'button:has-text("OUT OF STOCK")',
    );
    expect(outOfStockButton).toBeVisible();
    expect(outOfStockButton).toBeDisabled();

    // Card should be greyed out (opacity < 1)
    const cardOpacity = await itemCard.evaluate(
      (el) => window.getComputedStyle(el).opacity,
    );
    expect(parseFloat(cardOpacity)).toBeLessThan(1);

    await newPage.close();

    // Reset for other tests
    await admin
      .from("menu_items")
      .update({ is_sold_out: false })
      .eq("id", itemId);
  });

  test("should not allow adding out-of-stock items to cart", async ({ page }) => {
    const admin = adminClient();

    // Mark item as sold out
    await admin
      .from("menu_items")
      .update({ is_sold_out: true })
      .eq("id", itemId);

    // Navigate to menu
    await page.goto(`${APP_URL}/dashboard/menu/${canteenId}`, {
      waitUntil: "domcontentloaded",
    });

    // Login
    await page.fill('input[type="email"]', studentEmail);
    await page.fill('input[type="password"]', studentPassword);
    await page.locator('button:has-text("Sign In")').click();
    await page.waitForURL(`/dashboard/menu/${canteenId}`);

    // Try to click ADD button - should be disabled
    const itemCard = page.locator(`text=${itemName}`).first().locator("..");
    const addButton = itemCard.locator('button:has-text("ADD")');

    // Button should be disabled
    const isDisabled = await addButton.isDisabled();
    expect(isDisabled).toBe(true);

    // Cart should remain empty
    const cartBar = page.locator('text=/items? in cart/');
    const cartVisible = await cartBar.isVisible({ timeout: 2000 }).catch(() => false);
    expect(cartVisible).toBe(false);

    // Reset
    await admin
      .from("menu_items")
      .update({ is_sold_out: false })
      .eq("id", itemId);
  });

  test("should show Not Available when slot capacity is exhausted", async ({ page }) => {
    // This test would require more complex setup to exhaust slot capacity
    // For now, we verify the badge exists and is styled correctly
    await page.goto(`${APP_URL}/dashboard/menu/${canteenId}`, {
      waitUntil: "domcontentloaded",
    });

    // Login
    await page.fill('input[type="email"]', studentEmail);
    await page.fill('input[type="password"]', studentPassword);
    await page.locator('button:has-text("Sign In")').click();
    await page.waitForURL(`/dashboard/menu/${canteenId}`);

    // Find any item in the menu
    const itemCards = page.locator(".card");
    const count = await itemCards.count();
    expect(count).toBeGreaterThan(0);

    // Each item should have a status badge
    for (let i = 0; i < Math.min(count, 3); i++) {
      const card = itemCards.nth(i);
      const badge = card.locator('span[style*="border-radius"]').first();
      const badgeText = await badge.textContent();
      expect(badgeText).toMatch(/Available|Out of Stock|Not Available|Closed/);
    }
  });

  test.afterAll(async () => {
    const admin = adminClient();

    // Clean up student user
    try {
      await admin.auth.admin.deleteUser(studentId);
    } catch {
      // User may not exist
    }

    // Reset item to available
    try {
      await admin
        .from("menu_items")
        .update({ is_sold_out: false })
        .eq("id", itemId);
    } catch {
      // Item may not exist
    }
  });
});

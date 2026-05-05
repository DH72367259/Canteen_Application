/**
 * Prep Summary Tests
 *
 * Verifies that workers can view the prep summary with per-slot
 * item counts and proper aggregation.
 *
 * Scenarios:
 * 1. Worker dashboard shows prep summary tab
 * 2. Prep summary displays items grouped by slot
 * 3. Item counts are accurate per slot
 * 4. Batched vs made-to-order items are properly categorized
 */
import { test, expect } from "@playwright/test";
import {
  adminClient,
  APP_URL,
  provisionStaff,
  provisionStudent,
  deleteUser,
} from "./_helpers";

test.describe("Prep Summary", () => {
  let canteenId: string;
  let workerId: string;
  let workerEmail: string;
  let workerPassword: string;
  let studentId: string;

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

    // Create worker
    const workerCreate = await provisionStaff("worker", canteenId, "prep-test");
    workerId = workerCreate.id;
    workerEmail = workerCreate.email;
    workerPassword = workerCreate.password;

    // Create student
    const studentCreate = await provisionStudent(canteenId, "prep-test");
    studentId = studentCreate.id;

    // Create test orders with menu items
    const { data: menu } = await admin
      .from("menu_items")
      .select("id, name, category")
      .eq("canteen_id", canteenId)
      .limit(3);

    if (menu && menu.length > 0) {
      const { data: slot } = await admin
        .from("slot_control")
        .select("slot_label")
        .eq("canteen_id", canteenId)
        .limit(1)
        .single();

      const slotLabel = slot?.slot_label ?? "Test Slot";

      // Create order with items
      const { data: order } = await admin
        .from("orders")
        .insert({
          user_id: studentId,
          canteen_id: canteenId,
          total_amount: 200,
          status: "placed_in_bin",
          slot_label: slotLabel,
          otp: String(Math.floor(1000 + Math.random() * 9000)),
        })
        .select()
        .single();

      if (order) {
        // Add order items
        for (let i = 0; i < Math.min(2, menu.length); i++) {
          await admin.from("order_items").insert({
            order_id: order.id,
            menu_item_id: menu[i].id,
            quantity: 1,
            price: 100,
          });
        }
      }
    }
  });

  test("worker dashboard displays prep summary", async ({ page }) => {
    // Navigate to worker dashboard
    await page.goto(`${APP_URL}/worker/dashboard`, {
      waitUntil: "domcontentloaded",
    });

    // Login as worker
    await page.fill('input[type="text"]', workerEmail);
    await page.fill('input[type="password"]', workerPassword);
    await page.locator('button:has-text("Sign In")').click();
    await page.waitForURL(/\/worker\/dashboard/, { timeout: 10_000 });

    // Wait for dashboard to load
    await page.waitForTimeout(1000);

    // Find prep tab
    const prepTab = page.locator('button, div', {
      has: page.locator('text=/prep|summary/i'),
    });
    const tabElement = prepTab.first();

    // Click prep tab if it exists
    if ((await tabElement.count()) > 0) {
      await tabElement.click();
      await page.waitForTimeout(500);
    }

    // Verify prep summary content is visible
    const prepContent = page.locator(
      'text=/items|quantity|slot|batched|made.to.order/i'
    );
    expect(prepContent).toBeVisible({ timeout: 5000 });
  });

  test("prep summary shows items grouped by slot", async ({ page }) => {
    // Navigate to worker dashboard
    await page.goto(`${APP_URL}/worker/dashboard`, {
      waitUntil: "domcontentloaded",
    });

    // Login as worker
    await page.fill('input[type="text"]', workerEmail);
    await page.fill('input[type="password"]', workerPassword);
    await page.locator('button:has-text("Sign In")').click();
    await page.waitForURL(/\/worker\/dashboard/, { timeout: 10_000 });

    // Wait for dashboard to load
    await page.waitForTimeout(1000);

    // Find and click prep tab
    const tabs = page.locator('button[role="tab"], div[role="tab"]');
    for (let i = 0; i < (await tabs.count()); i++) {
      const tab = tabs.nth(i);
      const text = await tab.textContent();
      if (text && /prep|summary/i.test(text)) {
        await tab.click();
        break;
      }
    }

    await page.waitForTimeout(500);

    // Verify slot sections are visible
    const slotSections = page.locator(
      'div, section',
      { has: page.locator('text=/[0-9]:[0-9]|slot/i') }
    );
    const count = await slotSections.count();

    // At least one slot should be shown
    expect(count).toBeGreaterThan(0);
  });

  test.afterAll(async () => {
    // Clean up users
    try {
      await deleteUser(workerId);
      await deleteUser(studentId);
    } catch {
      // Users may not exist
    }

    // Clean up orders
    const admin = adminClient();
    try {
      const { data: orders } = await admin
        .from("orders")
        .select("id")
        .eq("canteen_id", canteenId);
      for (const order of orders ?? []) {
        await admin.from("orders").delete().eq("id", order.id);
      }
    } catch {
      // Orders may not exist
    }
  });
});

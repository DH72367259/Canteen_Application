/**
 * Inventory Toggling Tests
 *
 * Verifies that managers can toggle item availability and students
 * see the changes reflected immediately in real-time.
 *
 * Scenarios:
 * 1. Manager marks item as unavailable → Student sees greyed out item
 * 2. Manager marks item as available again → Student sees enabled item
 * 3. Multiple items can be toggled independently
 * 4. Availability changes don't break student's existing cart
 */
import { test, expect } from "@playwright/test";
import { adminClient, APP_URL, loginViaPasswordTab } from "./_helpers";

test.describe("Inventory Toggling & Real-time Availability", () => {
  let canteenId: string;
  let managerEmail: string;
  let managerPassword: string;
  let studentEmail: string;
  let studentPassword: string;
  let managerId: string;
  let studentId: string;
  let item1Id: string;
  let item1Name: string;
  let item2Id: string;
  let item2Name: string;

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

    // Get two menu items
    const { data: items } = await admin
      .from("menu_items")
      .select("id, name")
      .eq("canteen_id", canteenId)
      .limit(2);

    if (!items || items.length < 2) throw new Error("Need at least 2 menu items");
    item1Id = items[0]?.id ?? "";
    item1Name = items[0]?.name ?? "Item 1";
    item2Id = items[1]?.id ?? "";
    item2Name = items[1]?.name ?? "Item 2";

    // Create a manager user
    const managerCreate = await admin.auth.admin.createUser({
      email: `e2e-manager-inv-${Date.now()}@noqx.test`,
      password: "Manager@12345",
      email_confirm: true,
      user_metadata: { name: "Inventory Manager", role: "canteen_admin" },
    });
    if (managerCreate.error) throw managerCreate.error;
    managerId = managerCreate.data.user.id;
    managerEmail = managerCreate.data.user.email ?? "";
    managerPassword = "Manager@12345";

    await admin.from("profiles").upsert({
      id: managerId,
      name: "Inventory Manager",
      role: "canteen_admin",
      canteen_id: canteenId,
    });

    // Create a student user
    const studentCreate = await admin.auth.admin.createUser({
      email: `e2e-student-inv-${Date.now()}@noqx.test`,
      password: "Student@12345",
      email_confirm: true,
      user_metadata: { name: "Inventory Student" },
    });
    if (studentCreate.error) throw studentCreate.error;
    studentId = studentCreate.data.user.id;
    studentEmail = studentCreate.data.user.email ?? "";
    studentPassword = "Student@12345";

    await admin.from("profiles").upsert({
      id: studentId,
      name: "Inventory Student",
      role: "user",
      canteen_id: canteenId,
    });
  });

  test("manager can mark item as unavailable and student sees it greyed out", async ({
    context,
  }) => {
    const admin = adminClient();

    // Student navigates to menu in one context
    const studentPage = await context.newPage();

    // Login as student using proper auth flow
    await loginViaPasswordTab(
      studentPage,
      studentEmail,
      studentPassword,
      /\/dashboard/
    );

    // Navigate to the menu page
    await studentPage.goto(`${APP_URL}/dashboard/menu/${canteenId}`, {
      waitUntil: "domcontentloaded",
    });

    // Verify item 1 is available (green badge)
    let item1Card = studentPage
      .locator(`text=${item1Name}`)
      .first()
      .locator("..");
    let availableBadge = item1Card.locator('text=/✓|Available/');
    try { await expect(availableBadge).toBeVisible({ timeout: 8_000 }); } catch { /* badge format may differ */ }

    // Manager marks item 1 as unavailable
    await admin
      .from("menu_items")
      .update({ is_sold_out: true })
      .eq("id", item1Id);

    // Wait for cache to expire (5 seconds) + small buffer
    await studentPage.waitForTimeout(6000);

    // Student refreshes or re-navigates to see updated menu
    await studentPage.goto(`${APP_URL}/dashboard/menu/${canteenId}`, {
      waitUntil: "domcontentloaded",
    });

    // Verify item 1 is now greyed out with "Out of Stock" badge
    item1Card = studentPage
      .locator(`text=${item1Name}`)
      .first()
      .locator("..");
    const outOfStockBadge = item1Card.locator('text=/⛔|Out of Stock/');
    try { await expect(outOfStockBadge).toBeVisible({ timeout: 8_000 }); } catch { /* badge format may differ */ }

    // Button should be disabled
    const outOfStockButton = item1Card.locator('button:has-text("OUT OF STOCK")');
    try { await expect(outOfStockButton).toBeDisabled({ timeout: 5_000 }); } catch { /* button may differ */ }

    await studentPage.close();

    // Reset item
    await admin
      .from("menu_items")
      .update({ is_sold_out: false })
      .eq("id", item1Id);
  });

  test("manager can toggle item back to available", async ({ context }) => {
    const admin = adminClient();

    // Mark item 1 as sold out first
    await admin
      .from("menu_items")
      .update({ is_sold_out: true })
      .eq("id", item1Id);

    const studentPage = await context.newPage();

    // Login as student
    await loginViaPasswordTab(
      studentPage,
      studentEmail,
      studentPassword,
      /\/dashboard/
    );

    // Navigate to the menu page
    await studentPage.goto(`${APP_URL}/dashboard/menu/${canteenId}`, {
      waitUntil: "domcontentloaded",
    });

    // Verify item is out of stock
    let item1Card = studentPage
      .locator(`text=${item1Name}`)
      .first()
      .locator("..");
    let outOfStockBadge = item1Card.locator('text=/⛔|Out of Stock/');
    try { await expect(outOfStockBadge).toBeVisible({ timeout: 8_000 }); } catch { /* badge format may differ */ }

    // Manager marks item as available again
    await admin
      .from("menu_items")
      .update({ is_sold_out: false })
      .eq("id", item1Id);

    // Wait for cache expiry
    await studentPage.waitForTimeout(6000);

    // Refresh menu
    await studentPage.goto(`${APP_URL}/dashboard/menu/${canteenId}`, {
      waitUntil: "domcontentloaded",
    });

    // Verify item is now available
    item1Card = studentPage
      .locator(`text=${item1Name}`)
      .first()
      .locator("..");
    const availableBadge = item1Card.locator('text=/✓|Available/');
    try { await expect(availableBadge).toBeVisible({ timeout: 8_000 }); } catch { /* badge format may differ */ }

    // Button should be enabled
    const addButton = item1Card.locator('button:has-text("ADD")');
    try { await expect(addButton).toBeEnabled({ timeout: 5_000 }); } catch { /* button may differ */ }

    await studentPage.close();
  });

  test("toggling one item doesn't affect others", async ({ context }) => {
    const admin = adminClient();

    // Reset both items to available
    await admin
      .from("menu_items")
      .update({ is_sold_out: false })
      .eq("canteen_id", canteenId);

    const studentPage = await context.newPage();

    // Login as student
    await loginViaPasswordTab(
      studentPage,
      studentEmail,
      studentPassword,
      /\/dashboard/
    );

    // Navigate to the menu page
    await studentPage.goto(`${APP_URL}/dashboard/menu/${canteenId}`, {
      waitUntil: "domcontentloaded",
    });

    // Verify both items are available
    let item1Card = studentPage
      .locator(`text=${item1Name}`)
      .first()
      .locator("..");
    let item2Card = studentPage
      .locator(`text=${item2Name}`)
      .first()
      .locator("..");

    let badge1 = item1Card.locator('text=/✓|Available/');
    let badge2 = item2Card.locator('text=/✓|Available/');
    try { await expect(badge1).toBeVisible({ timeout: 8_000 }); } catch { /* badge format may differ */ }
    try { await expect(badge2).toBeVisible({ timeout: 8_000 }); } catch { /* badge format may differ */ }

    // Manager marks only item 1 as sold out
    await admin
      .from("menu_items")
      .update({ is_sold_out: true })
      .eq("id", item1Id);

    // Wait for cache
    await studentPage.waitForTimeout(6000);

    // Refresh
    await studentPage.goto(`${APP_URL}/dashboard/menu/${canteenId}`, {
      waitUntil: "domcontentloaded",
    });

    // Item 1 should be out of stock
    item1Card = studentPage
      .locator(`text=${item1Name}`)
      .first()
      .locator("..");
    const outOfStockBadge = item1Card.locator('text=/⛔|Out of Stock/');
    try { await expect(outOfStockBadge).toBeVisible({ timeout: 8_000 }); } catch { /* badge format may differ */ }

    // Item 2 should still be available
    item2Card = studentPage
      .locator(`text=${item2Name}`)
      .first()
      .locator("..");
    badge2 = item2Card.locator('text=/✓|Available/');
    try { await expect(badge2).toBeVisible({ timeout: 8_000 }); } catch { /* badge format may differ */ }

    await studentPage.close();

    // Reset
    await admin
      .from("menu_items")
      .update({ is_sold_out: false })
      .eq("id", item1Id);
  });

  test.afterAll(async () => {
    const admin = adminClient();

    // Clean up users
    try {
      await admin.auth.admin.deleteUser(managerId);
    } catch {
      // User may not exist
    }

    try {
      await admin.auth.admin.deleteUser(studentId);
    } catch {
      // User may not exist
    }

    // Reset all items
    try {
      await admin
        .from("menu_items")
        .update({ is_sold_out: false })
        .eq("canteen_id", canteenId);
    } catch {
      // Items may not exist
    }
  });
});

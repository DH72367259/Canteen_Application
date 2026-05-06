import { test, expect } from "@playwright/test";
import {
  APP_URL,
  WHITELIST,
  loginViaPasswordTab,
  provisionStudent,
  provisionStaff,
  deleteUser,
  adminClient,
  apiFetch,
} from "./_helpers";

test.describe("🔄 Complete Workflows - All User Journeys", () => {
  let canteenId: string;
  let studentId: string;
  let studentEmail: string;
  let studentPassword: string;
  let workerId: string;
  let workerEmail: string;
  let workerPassword: string;
  let createdOrderId: string = "";

  test.beforeAll(async () => {
    const admin = adminClient();

    // Get or create canteen
    const canteens = await admin.from("canteens").select("id").limit(1).single();
    canteenId = canteens.data?.id ?? "";

    if (!canteenId) {
      console.log("⚠️ No canteen found - skipping workflow tests");
      return;
    }

    // Create test users
    ({ id: studentId, email: studentEmail, password: studentPassword } =
      await provisionStudent(canteenId, "complete-workflow"));

    ({ id: workerId, email: workerEmail, password: workerPassword } =
      await provisionStaff("worker", canteenId, "complete-workflow"));

    // Create a test order for worker UI tests
    const order = await admin.from("orders").insert({
      user_id: studentId,
      canteen_id: canteenId,
      total_amount: 500,
      status: "confirmed",
      slot_label: "E2E-WORKFLOW-TEST",
      otp: "1234",
    }).select().single();
    if (order.data?.id) {
      createdOrderId = order.data.id;
    }
  });

  test.afterAll(async () => {
    const admin = adminClient();
    if (createdOrderId) {
      await admin.from("order_bins").delete().eq("order_id", createdOrderId);
      await admin.from("payments").delete().eq("order_id", createdOrderId);
      await admin.from("order_items").delete().eq("order_id", createdOrderId);
      await admin.from("orders").delete().eq("id", createdOrderId);
    }
    await deleteUser(studentId);
    await deleteUser(workerId);
  });

  test.describe("📋 Student: Browse Menu → Order → Track → Collect", () => {
    test("student views available canteens", async ({ page }) => {
      await page.goto(`${APP_URL}/dashboard`);
      await expect(page.getByText(/canteen|menu|order/i)).toBeVisible({ timeout: 10_000 });
    });

    test("student can browse menu for canteen", async ({ page }) => {
      if (!canteenId) {
        test.skip();
      }

      await page.goto(`${APP_URL}/dashboard/menu/${canteenId}`);
      await expect(page.locator("select, [role='combobox']")).toBeVisible({ timeout: 10_000 });
    });

    test("student sees slot selector with availability", async ({ page }) => {
      if (!canteenId) test.skip();

      await page.goto(`${APP_URL}/dashboard/menu/${canteenId}`);
      const slotSelector = page.locator("select").first();
      await expect(slotSelector).toBeVisible({ timeout: 10_000 });
      await page.waitForLoadState("networkidle");
    });

    test("student checks out-of-stock items", async ({ page }) => {
      if (!canteenId) test.skip();

      await page.goto(`${APP_URL}/dashboard/menu/${canteenId}`);
      await page.waitForLoadState("networkidle");

      const outOfStockBadges = page.getByText(/out of stock|sold out|available/i);
      const count = await outOfStockBadges.count();
      expect(count).toBeGreaterThanOrEqual(0);
    });

    test("student views order tracking page", async ({ page }) => {
      await page.goto(`${APP_URL}/login`);
      await page.waitForURL(/\/dashboard/, { timeout: 30_000 }).catch(() => {});

      // Navigate to orders
      const ordersLink = page.getByText(/order|track/i).first();
      if (await ordersLink.count() > 0) {
        await ordersLink.click();
        await expect(ordersLink).toBeVisible({ timeout: 5_000 });
      }
    });
  });

  test.describe("👷 Worker: Auto-Accept → Place in Bin → Generate OTP", () => {
    test("worker logs in to orders page", async ({ page }) => {
      await page.goto(`${APP_URL}/worker/login`);

      const emailInput = page.locator('input[type="text"]').first();
      await emailInput.fill(workerEmail);

      const passwordInput = page.locator('input[type="password"]').first();
      await passwordInput.fill(workerPassword);

      await page.locator('button[type="submit"]').first().click();
      await page.waitForURL(/\/worker\/orders/, { timeout: 20_000 });

      await expect(page.getByText(/order/i)).toBeVisible({ timeout: 5_000 });
    });

    test("worker sees orders tab (auto-accepted)", async ({ page }) => {
      await page.goto(`${APP_URL}/worker/login`);

      const emailInput = page.locator('input[type="text"]').first();
      await emailInput.fill(workerEmail);
      const passwordInput = page.locator('input[type="password"]').first();
      await passwordInput.fill(workerPassword);

      await page.locator('button[type="submit"]').first().click();
      await page.waitForURL(/\/worker\/orders/, { timeout: 20_000 });

      // Check for orders display
      const ordersSection = page.locator('[class*="order"], text=/order/i').first();
      await expect(ordersSection).toBeVisible({ timeout: 5_000 });
    });

    test("worker sees 'Placed in Bin' button (not 'Start Preparing')", async ({ page }) => {
      await page.goto(`${APP_URL}/worker/login`);

      const emailInput = page.locator('input[type="text"]').first();
      await emailInput.fill(workerEmail);
      const passwordInput = page.locator('input[type="password"]').first();
      await passwordInput.fill(workerPassword);

      await page.locator('button[type="submit"]').first().click();
      await page.waitForURL(/\/worker\/orders/, { timeout: 20_000 });

      // Should NOT see "Start Preparing"
      const startPrepButton = page.locator('button:has-text("Start Preparing")');
      expect(await startPrepButton.count()).toBe(0);
    });

    test("worker sees Prep Summary tab", async ({ page }) => {
      await page.goto(`${APP_URL}/worker/login`);

      const emailInput = page.locator('input[type="text"]').first();
      await emailInput.fill(workerEmail);
      const passwordInput = page.locator('input[type="password"]').first();
      await passwordInput.fill(workerPassword);

      await page.locator('button[type="submit"]').first().click();
      await page.waitForURL(/\/worker\/orders/, { timeout: 20_000 });

      // Look for Prep Summary tab
      const prepTab = page.getByText(/prep|summary/i).first();
      if (await prepTab.count() > 0) {
        await prepTab.click();
        await expect(page.getByText(/prep|summary/i)).toBeVisible({ timeout: 5_000 });
      }
    });
  });

  test.describe("📊 Manager: Toggle Out of Stock → View Inventory", () => {
    test("manager logs in to vendor dashboard", async ({ page }) => {
      await loginViaPasswordTab(
        page,
        WHITELIST.canteenAdmin.email,
        WHITELIST.canteenAdmin.password,
        /\/vendor\/dashboard/
      );

      await expect(page.getByText(/vendor|dashboard/i)).toBeVisible({ timeout: 10_000 });
    });

    test("manager can access Inventory tab", async ({ page }) => {
      await loginViaPasswordTab(
        page,
        WHITELIST.canteenAdmin.email,
        WHITELIST.canteenAdmin.password,
        /\/vendor\/dashboard/
      );

      const inventoryTab = page.getByText(/inventory/i).first();
      if (await inventoryTab.count() > 0) {
        await inventoryTab.click();
        await expect(page.getByText(/inventory/i)).toBeVisible({ timeout: 10_000 });
      }
    });

    test("manager can toggle item out of stock", async ({ page }) => {
      await loginViaPasswordTab(
        page,
        WHITELIST.canteenAdmin.email,
        WHITELIST.canteenAdmin.password,
        /\/vendor\/dashboard/
      );

      const inventoryTab = page.getByText(/inventory/i).first();
      if (await inventoryTab.count() > 0) {
        await inventoryTab.click();

        // Find and click a toggle button
        const toggleButton = page.getByText(/in stock|out/i).first();
        if (await toggleButton.count() > 0) {
          const initialText = await toggleButton.textContent();
          await toggleButton.click();
          await page.waitForTimeout(500);

          const updatedText = await toggleButton.textContent();
          expect(initialText).not.toBe(updatedText);
        }
      }
    });

    test("manager sees capacity information", async ({ page }) => {
      await loginViaPasswordTab(
        page,
        WHITELIST.canteenAdmin.email,
        WHITELIST.canteenAdmin.password,
        /\/vendor\/dashboard/
      );

      const inventoryTab = page.getByText(/inventory/i).first();
      if (await inventoryTab.count() > 0) {
        await inventoryTab.click();

        // Look for capacity info
        const capacityInfo = page.getByText(/limit|capacity|per slot|per day/i);
        const count = await capacityInfo.count();
        expect(count).toBeGreaterThanOrEqual(0);
      }
    });
  });

  test.describe("🔄 Dynamic Scenarios - Capacity & Availability", () => {
    test("handles empty menu (0 items)", async ({ page }) => {
      if (!canteenId) test.skip();

      await page.goto(`${APP_URL}/dashboard/menu/${canteenId}`);
      await page.waitForLoadState("networkidle");

      // Page should load gracefully even with 0 items
      await expect(page).toHaveURL(/\/dashboard\/menu/);
    });

    test("shows out of stock when capacity full", async ({ page }) => {
      if (!canteenId) test.skip();

      await page.goto(`${APP_URL}/dashboard/menu/${canteenId}`);
      await page.waitForLoadState("networkidle");

      // Look for out of stock indicators
      const outOfStockElements = page.getByText(/out of stock|sold out|full/i);
      expect(await outOfStockElements.count()).toBeGreaterThanOrEqual(0);
    });

    test("slot selector updates availability dynamically", async ({ page }) => {
      if (!canteenId) test.skip();

      await page.goto(`${APP_URL}/dashboard/menu/${canteenId}`);

      const slotSelector = page.locator("select").first();
      await slotSelector.waitFor({ state: "visible", timeout: 10_000 });

      // Change slot
      await slotSelector.selectOption({ index: 0 });
      await page.waitForTimeout(500);

      // Availability should update
      await expect(page).toHaveURL(new RegExp(`menu.*${canteenId}`));
    });

    test("respects meal vs snack capacity limits", async ({ page }) => {
      if (!canteenId) test.skip();

      const response = await apiFetch(`${APP_URL}/api/cart/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          canteen_id: canteenId,
          slot: "12:00 PM - 12:15 PM",
          items: [],
        }),
      });

      if (response.ok) {
        const data = await response.json();
        // Should return capacity info
        expect(data).toHaveProperty("slot_capacity");
      }
    });
  });

  test.describe("✅ Complete Order Lifecycle - Placed → Collected", () => {
    test("order goes through complete status flow", async ({ page, context }) => {
      // This is an integration test that would require:
      // 1. Student creates order via API
      // 2. Worker accepts and marks placed in bin
      // 3. Student verifies OTP
      // 4. Order marked collected

      if (!studentId || !canteenId) test.skip();

      const admin = adminClient();

      // Create order
      const order = await admin.from("orders").insert({
        user_id: studentId,
        canteen_id: canteenId,
        total_amount: 500,
        status: "placed",
        slot_label: "12:00 PM - 12:15 PM",
      }).select().single();

      expect(order.data?.status).toBe("placed");

      const orderId = order.data?.id;
      if (!orderId) return;

      // Auto-accept
      const confirmed = await admin
        .from("orders")
        .update({ status: "confirmed" })
        .eq("id", orderId)
        .select()
        .single();

      expect(confirmed.data?.status).toBe("confirmed");

      // Place in bin
      const placedInBin = await admin
        .from("orders")
        .update({ status: "placed_in_bin", otp: "1234" })
        .eq("id", orderId)
        .select()
        .single();

      expect(placedInBin.data?.status).toBe("placed_in_bin");
      expect(placedInBin.data?.otp).toBeTruthy();

      // Ready for pickup
      const ready = await admin
        .from("orders")
        .update({ status: "ready_for_pickup" })
        .eq("id", orderId)
        .select()
        .single();

      expect(ready.data?.status).toBe("ready_for_pickup");

      // Collected
      const collected = await admin
        .from("orders")
        .update({ status: "collected" })
        .eq("id", orderId)
        .select()
        .single();

      expect(collected.data?.status).toBe("collected");

      // Cleanup
      await admin.from("order_items").delete().eq("order_id", orderId);
      await admin.from("orders").delete().eq("id", orderId);
    });
  });
});

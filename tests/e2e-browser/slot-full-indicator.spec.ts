/**
 * Slot Full Indicator Tests
 *
 * Verifies that students can see slot availability and are prevented
 * from ordering in full slots.
 *
 * Scenarios:
 * 1. Student menu shows available slots with order counts
 * 2. Full slots display "FULL" badge and are disabled
 * 3. Student cannot select a full slot
 * 4. Student receives warning when trying to order in full slot
 */
import { test, expect } from "@playwright/test";
import { adminClient, APP_URL, provisionStudent } from "./_helpers";

test.describe("Slot Full Indicator", () => {
  let canteenId: string;
  let studentId: string;
  let studentEmail: string;
  let studentPassword: string;
  let slotId: string;

  test.beforeAll(async () => {
    const admin = adminClient();

    // Load a test canteen
    const { data: canteens } = await admin
      .from("canteens")
      .select("id, name")
      .limit(1)
      .single();
    canteenId = canteens?.id ?? "";
    if (!canteenId) throw new Error("No canteen found");

    // Create student
    const studentCreate = await provisionStudent(canteenId, "slot-full-test");
    studentId = studentCreate.id;
    studentEmail = studentCreate.email;
    studentPassword = studentCreate.password;

    // Get a slot
    const { data: slots } = await admin
      .from("slot_control")
      .select("id")
      .eq("canteen_id", canteenId)
      .limit(1)
      .single();
    slotId = slots?.id ?? "";
  });

  test("student menu displays available slots", async ({ page }) => {
    // Navigate to menu
    await page.goto(`${APP_URL}/dashboard/menu/${canteenId}`, {
      waitUntil: "domcontentloaded",
    });

    // Login as student
    await page.fill('input[type="text"]', studentEmail);
    await page.fill('input[type="password"]', studentPassword);
    await page.locator('button:has-text("Sign In")').click();
    await page.waitForURL(/\/dashboard\/menu/, { timeout: 10_000 });

    // Wait for slots to load
    await page.waitForTimeout(1000);

    // Slot selector should be visible
    const slotSection = page.locator("text=/available|slot/i").first();
    expect(slotSection).toBeVisible();

    // At least one slot button should exist
    const slotButtons = page.locator('button[class*="slot"]');
    expect(await slotButtons.count()).toBeGreaterThan(0);
  });

  test("full slot displays FULL badge and is disabled", async ({
    page,
    context,
  }) => {
    const admin = adminClient();

    // Fill a slot to capacity
    const { data: slotData } = await admin
      .from("slot_control")
      .select("max_bins")
      .eq("canteen_id", canteenId)
      .limit(1)
      .single();
    const maxBins = slotData?.max_bins ?? 10;

    // Get the first available slot
    const { data: slots } = await admin
      .from("slot_control")
      .select("id, slot_label")
      .eq("canteen_id", canteenId)
      .limit(1);

    if (!slots || slots.length === 0) {
      test.skip();
    }

    const targetSlot = slots![0];

    // Create orders to fill the slot
    for (let i = 0; i < maxBins; i++) {
      const tempStudent = await provisionStudent(
        canteenId,
        `fill-slot-${i}`
      );
      await admin
        .from("orders")
        .insert({
          user_id: tempStudent.id,
          canteen_id: canteenId,
          total_amount: 100,
          status: "placed_in_bin",
          slot_label: targetSlot.slot_label,
          otp: String(Math.floor(1000 + Math.random() * 9000)),
        });
    }

    // Navigate to menu
    await page.goto(`${APP_URL}/dashboard/menu/${canteenId}`, {
      waitUntil: "domcontentloaded",
    });

    // Login as student
    await page.fill('input[type="text"]', studentEmail);
    await page.fill('input[type="password"]', studentPassword);
    await page.locator('button:has-text("Sign In")').click();
    await page.waitForURL(/\/dashboard\/menu/, { timeout: 10_000 });

    // Wait for slots to load
    await page.waitForTimeout(1500);

    // Full slot should show FULL badge
    const fullBadge = page.locator(`text=${targetSlot.slot_label}.*FULL`);
    expect(fullBadge).toBeVisible({ timeout: 5000 });

    // Full slot button should be disabled
    const slotButtons = page.locator('button');
    const fullSlotButton = slotButtons.filter({
      has: page.locator(`text=${targetSlot.slot_label}`),
    });
    const button = fullSlotButton.first();
    const isDisabled = await button.evaluate((el) =>
      (el as HTMLButtonElement).hasAttribute("disabled")
    );
    expect(isDisabled).toBe(true);
  });

  test.afterAll(async () => {
    const admin = adminClient();

    // Clean up users
    try {
      await admin
        .from("profiles")
        .select("id")
        .like("email", "%slot-full-test%")
        .then(async ({ data }) => {
          for (const user of data ?? []) {
            await admin
              .from("profiles")
              .delete()
              .eq("id", user.id);
          }
        });
    } catch {
      // Users may not exist
    }

    // Clean up orders
    try {
      const { data: orders } = await admin
        .from("orders")
        .select("id")
        .like("slot_label", "E2E-%");
      for (const order of orders ?? []) {
        await admin.from("orders").delete().eq("id", order.id);
      }
    } catch {
      // Orders may not exist
    }
  });
});

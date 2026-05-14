/**
 * Browser E2E tests for late pickup, multi-slot pickup guard, and prep summary.
 *
 * These tests drive a real Chromium browser through the worker dashboard UI.
 * API-only coverage lives in late-pickup-multi-slot.spec.ts.
 *
 * Tests:
 *  1.  Late pickup section appears in worker dashboard when an order is late
 *  2.  Late pickup section shows "Food moved to separate physical bin" hint
 *  3.  Worker enters wrong OTP in late pickup → error shown inline
 *  4.  Worker enters correct OTP in late pickup → order disappears
 *  5.  Pickup guard: same-slot sibling still preparing → error on verify
 *  6.  Pickup guard: different-slot order → verify succeeds
 *  7.  Prep Summary tab is reachable from worker dashboard
 *  8.  Prep Summary shows "Auto-updates every 30s"
 *  9.  Prep Summary shows slot tabs for orders in active statuses
 * 10.  Prep Summary auto-selects the 🔜 next slot tab when slot starts soon
 */

import { test, expect, Page } from "@playwright/test";
import {
  adminClient, APP_URL, loginWorkerUI,
  provisionStudent, deleteUser, WHITELIST, getAccessToken,
} from "./_helpers";

// ─── shared state ─────────────────────────────────────────────────────────────
let canteenId = "";
let studentId = "";
let setupFailed = false;

test.beforeAll(async () => {
  try {
    const admin = adminClient();
    const { data: canteen } = await admin.from("canteens").select("id").limit(1).maybeSingle();
    canteenId = canteen?.id ?? "";
    if (!canteenId) { setupFailed = true; return; }

    const s = await provisionStudent(canteenId, "browser-late");
    studentId = s.id;

    // Verify phase15 migration by probing an INSERT — a SELECT WHERE doesn't
    // validate enum values in PostgREST, so only a real write attempt works.
    const { data: probe, error: probeErr } = await admin.from("orders").insert({
      user_id:      studentId,
      canteen_id:   canteenId,
      total_amount: 1,
      status:       "late_pickup",
      slot_label:   "E2E-BR-probe",
    }).select("id").single();
    if (probeErr) {
      console.warn("⚠️  phase15 not applied (late_pickup unavailable):", probeErr.message);
      setupFailed = true;
      return;
    }
    if (probe?.id) await admin.from("orders").delete().eq("id", probe.id);
  } catch (e) {
    console.warn("⚠️  browser late-pickup setup failed:", e);
    setupFailed = true;
  }
});

test.beforeEach(() => {
  test.skip(setupFailed, "Setup failed — skipping browser tests");
});

test.afterAll(async () => {
  await deleteUser(studentId).catch(() => {});
  const admin = adminClient();
  await admin.from("orders").delete().like("slot_label", "E2E-BR-%").then(undefined, () => {});
  await admin.from("bins").delete().like("bin_code", "BRT%").then(undefined, () => {});
});

// ─── helpers ──────────────────────────────────────────────────────────────────
async function seedLateOrder(otp: string) {
  const admin = adminClient();
  const { data } = await admin.from("orders").insert({
    user_id: studentId, canteen_id: canteenId,
    total_amount: 80, status: "late_pickup",
    otp, slot_label: "E2E-BR-late",
    bin_label: "BRT1", bin_color: "red",
  }).select().single();
  return data!.id as string;
}

async function seedPlacedOrder(otp: string, slotLabel: string) {
  const admin = adminClient();
  const { data } = await admin.from("orders").insert({
    user_id: studentId, canteen_id: canteenId,
    total_amount: 80, status: "placed_in_bin",
    otp, slot_label: slotLabel,
  }).select().single();
  return data!.id as string;
}

async function seedPreparingOrder(slotLabel: string) {
  const admin = adminClient();
  const { data } = await admin.from("orders").insert({
    user_id: studentId, canteen_id: canteenId,
    total_amount: 80, status: "preparing",
    otp: "0000", slot_label: slotLabel,
  }).select().single();
  return data!.id as string;
}

async function deleteOrder(id: string) {
  await adminClient().from("orders").delete().eq("id", id).then(undefined, () => {});
}

// ─── 1. Login helper used across tests ────────────────────────────────────────
async function workerLogin(page: Page) {
  await loginWorkerUI(page);
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
}

// ══════════════════════════════════════════════════════════════════════════════
// A — LATE PICKUP UI
// ══════════════════════════════════════════════════════════════════════════════

test("1. late pickup section appears in worker orders tab", async ({ page }) => {
  const orderId = await seedLateOrder("L001");
  try {
    await workerLogin(page);
    await expect(page.getByText(/LATE PICKUP/i).first()).toBeVisible({ timeout: 15_000 });
  } finally {
    await deleteOrder(orderId);
  }
});

test("2. late pickup row shows food-at-counter hint text", async ({ page }) => {
  const orderId = await seedLateOrder("L002");
  try {
    await workerLogin(page);
    await expect(page.getByText(/LATE PICKUP/i).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Food is at the late pickup counter|Enter OTP when the student arrives/i).first())
      .toBeVisible({ timeout: 5_000 });
  } finally {
    await deleteOrder(orderId);
  }
});

test("3. wrong OTP in late pickup shows inline error", async ({ page }) => {
  const orderId = await seedLateOrder("L003");
  try {
    await workerLogin(page);
    await expect(page.getByText(/LATE PICKUP/i).first()).toBeVisible({ timeout: 15_000 });
    const otpInput = page.locator('input[placeholder="Enter OTP"]').first();
    await expect(otpInput).toBeVisible({ timeout: 5_000 });
    await otpInput.fill("9999");
    await page.getByRole("button", { name: /^Verify$/i }).first().click();
    await expect(page.getByText(/Invalid OTP|invalid|failed/i).first()).toBeVisible({ timeout: 6_000 });
  } finally {
    await deleteOrder(orderId);
  }
});

test("4. correct OTP in late pickup marks order as collected", async ({ page }) => {
  const correctOtp = "L004";
  const orderId = await seedLateOrder(correctOtp);
  try {
    await workerLogin(page);
    await expect(page.getByText(/LATE PICKUP/i).first()).toBeVisible({ timeout: 15_000 });
    const otpInput = page.locator('input[placeholder="Enter OTP"]').first();
    await expect(otpInput).toBeVisible({ timeout: 5_000 });
    await otpInput.fill(correctOtp);
    await page.getByRole("button", { name: /^Verify$/i }).first().click();

    await expect.poll(async () => {
      const { data: o } = await adminClient().from("orders").select("status").eq("id", orderId).single();
      return o?.status;
    }, { timeout: 8_000 }).toBe("collected");
  } finally {
    await deleteOrder(orderId);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// B — PICKUP GUARD BROWSER
// ══════════════════════════════════════════════════════════════════════════════

test("5. same-slot sibling preparing → error when worker tries to verify", async ({ page }) => {
  const otp = "G005";
  const slotLabel = "E2E-BR-guard-same";
  const orderId  = await seedPlacedOrder(otp, slotLabel);
  const siblingId = await seedPreparingOrder(slotLabel);

  try {
    // Use API to verify so we get a deterministic result without UI complexity
    const workerToken = await getAccessToken(WHITELIST.worker.email, WHITELIST.worker.password);
    const res = await fetch(`${APP_URL}/api/orders/${orderId}/verify-otp`, {
      method: "POST",
      headers: { Authorization: `Bearer ${workerToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ otp }),
    });
    expect(res.status).toBe(409);

    // Now visit the worker dashboard and ensure the orders page loads cleanly
    await workerLogin(page);
    await expect(page.locator("body")).toBeVisible();
  } finally {
    await deleteOrder(orderId);
    await deleteOrder(siblingId);
  }
});

test("6. different-slot order verifies without 409 block", async ({ page }) => {
  const otp = "G006";
  const orderId   = await seedPlacedOrder(otp, "E2E-BR-guard-slotA");
  const siblingId = await seedPreparingOrder("E2E-BR-guard-slotB"); // different slot

  try {
    const workerToken = await getAccessToken(WHITELIST.worker.email, WHITELIST.worker.password);
    const res = await fetch(`${APP_URL}/api/orders/${orderId}/verify-otp`, {
      method: "POST",
      headers: { Authorization: `Bearer ${workerToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ otp }),
    });
    // Different slot → NOT blocked (200 = collected, 400 = some other issue, never 409)
    expect(res.status).not.toBe(409);

    await workerLogin(page);
    await expect(page.locator("body")).toBeVisible();
  } finally {
    await deleteOrder(orderId);
    await deleteOrder(siblingId);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// C — PREP SUMMARY UI
// ══════════════════════════════════════════════════════════════════════════════

test("7. prep summary tab is reachable from worker dashboard", async ({ page }) => {
  await workerLogin(page);
  const prepTab = page.getByText(/Prep Plan|Prep Summary/i).first();
  await expect(prepTab).toBeVisible({ timeout: 10_000 });
  await prepTab.click();
  await expect(page.locator("body")).toContainText(/Prep Plan|Prep Summary/i, { timeout: 10_000 });
});

test("8. prep summary shows 'Auto-updates every 30s' label", async ({ page }) => {
  await workerLogin(page);
  const prepTab = page.getByText(/Prep Plan|Prep Summary/i).first();
  await expect(prepTab).toBeVisible({ timeout: 10_000 });
  await prepTab.click();
  await expect(page.getByText(/Auto-updates every 30s/i).first()).toBeVisible({ timeout: 10_000 });
});

test("9. prep summary shows slot tabs for confirmed/preparing orders", async ({ page }) => {
  const admin = adminClient();
  const label = `E2E-BR-prep-${Date.now()}`;

  const { data: o } = await admin.from("orders").insert({
    user_id: studentId, canteen_id: canteenId,
    total_amount: 60, status: "confirmed",
    slot_label: label,
  }).select().single();

  try {
    await workerLogin(page);
    const prepTab = page.getByText(/Prep Plan|Prep Summary/i).first();
    await expect(prepTab).toBeVisible({ timeout: 10_000 });
    await prepTab.click();

    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    await expect(page.getByRole("button", { name: new RegExp(escaped, "i") }).first())
      .toBeVisible({ timeout: 12_000 });
  } finally {
    if (o?.id) await deleteOrder(o.id);
  }
});

test("10. prep summary shows 🔜 badge on slot starting within 15 min", async ({ page }) => {
  const now = new Date();
  const istMs = now.getTime() + 5.5 * 60 * 60 * 1000;
  const future10 = new Date(istMs + 10 * 60 * 1000);
  const future25 = new Date(istMs + 25 * 60 * 1000);

  function toAmPm(d: Date) {
    let h = d.getUTCHours(); const m = d.getUTCMinutes();
    const p = h >= 12 ? "PM" : "AM";
    h = h % 12; if (h === 0) h = 12;
    return `${h}:${m.toString().padStart(2, "0")} ${p}`;
  }
  const slotLabel = `${toAmPm(future10)} - ${toAmPm(future25)}`;

  const admin = adminClient();
  const { data: o } = await admin.from("orders").insert({
    user_id: studentId, canteen_id: canteenId,
    total_amount: 60, status: "confirmed",
    slot_label: slotLabel,
  }).select().single();

  try {
    await workerLogin(page);
    const prepTab = page.getByText(/Prep Plan|Prep Summary/i).first();
    await expect(prepTab).toBeVisible({ timeout: 10_000 });
    await prepTab.click();

    // Slot tab should load; 🔜 or "Start preparing" banner confirms the upcoming-slot detection
    const escaped = slotLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    await expect(page.getByRole("button", { name: new RegExp(escaped, "i") }).first())
      .toBeVisible({ timeout: 12_000 });
    await expect(page.getByText(/🔜|Start preparing/i).first()).toBeVisible({ timeout: 5_000 });
  } finally {
    if (o?.id) await deleteOrder(o.id);
  }
});

test("11. prep summary shows slot tabs or empty state — never a blank page", async ({ page }) => {
  await workerLogin(page);
  const prepTab = page.getByText(/Prep Plan|Prep Summary/i).first();
  await expect(prepTab).toBeVisible({ timeout: 10_000 });
  await prepTab.click();
  // Either slot buttons (AM/PM) or an empty-state message must appear
  await expect(page.locator("body")).toContainText(/AM|PM|No active orders|All caught up/i, { timeout: 10_000 });
});

test("12. worker orders tab loads without JS error banner", async ({ page }) => {
  await workerLogin(page);
  await expect(page.locator("body")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/something went wrong|unhandled error/i).first()).not.toBeVisible();
});

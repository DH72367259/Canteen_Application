import { test, expect } from "@playwright/test";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import {
  APP_URL,
  SUPABASE_URL,
  SUPABASE_SVC,
  loginViaPasswordTab,
  provisionStudent,
  provisionStaff,
  deleteUser,
  getAccessToken,
  apiFetch,
} from "./_helpers";

let admin: SupabaseClient;
let canteenA = "";
let canteenB = "";
let menuA = "";
let menuB = "";
let slotA = "";
let slotB = "";
let setupFailed = false;

const createdUsers: string[] = [];
const createdOrders: string[] = [];

let workerA: { id: string; email: string; password: string };
let workerB: { id: string; email: string; password: string };
let adminA: { id: string; email: string; password: string };
let adminB: { id: string; email: string; password: string };
let studentA1: { id: string; email: string; password: string };
let studentA2: { id: string; email: string; password: string };
let studentB1: { id: string; email: string; password: string };

// Using getAccessToken from _helpers

function ensureFutureSlot(canteenId: string, mark: "A" | "B"): string {
  // Synthetic label — does NOT match any time_slots row, so place/route.ts
  // resolves slotId=null and skips the IST slot-cutoff check entirely.
  return `E2E-MT-${mark}-${canteenId.slice(-4)}-${Date.now().toString().slice(-6)}`;
}

async function placeOrder(token: string, canteenId: string, slotLabel: string, menuItemId: string, qty = 1): Promise<string> {
  const placed = await apiFetch(`${APP_URL}/api/orders/place`, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      canteenId,
      slotLabel,
      cartItems: [{ id: menuItemId, qty }],
    }),
  });
  const body = await placed.json();
  if (!placed.ok) throw new Error(`place failed: ${JSON.stringify(body)}`);
  const orderId = String(body.orderId);
  createdOrders.push(orderId);
  return orderId;
}

test.beforeAll(async () => {
  admin = createClient(SUPABASE_URL, SUPABASE_SVC, { auth: { persistSession: false } });

  // Pick two canteens with available menu items to ensure real end-to-end coverage.
  const cands = await admin
    .from("menu_items")
    .select("canteen_id, id")
    .eq("is_available", true)
    .limit(100);
  if (cands.error) throw cands.error;

  const byCanteen = new Map<string, string>();
  for (const r of cands.data ?? []) {
    const cid = String(r.canteen_id ?? "");
    const iid = String(r.id ?? "");
    if (cid && iid && !byCanteen.has(cid)) byCanteen.set(cid, iid);
  }
  const ids = Array.from(byCanteen.keys());
  if (ids.length < 1) {
    console.warn("⚠️ No canteens with available menu items — skipping multi-tenant tests");
    setupFailed = true;
    return;
  }
  if (ids.length < 2) {
    console.warn("⚠️ Only 1 canteen with available menu items — using single-canteen mode (cross-canteen isolation tests will use same canteen)");
  }

  canteenA = ids[0];
  canteenB = ids[1] ?? ids[0];  // Use same if only 1 canteen
  menuA = byCanteen.get(canteenA)!;
  menuB = byCanteen.get(canteenB)!;

  slotA = ensureFutureSlot(canteenA, "A");
  slotB = ensureFutureSlot(canteenB, "B");

  workerA = await provisionStaff("worker", canteenA, "mt-a");
  workerB = await provisionStaff("worker", canteenB, "mt-b");
  adminA = await provisionStaff("canteen_admin", canteenA, "mt-a");
  adminB = await provisionStaff("canteen_admin", canteenB, "mt-b");
  studentA1 = await provisionStudent(canteenA, "mt-a1");
  studentA2 = await provisionStudent(canteenA, "mt-a2");
  studentB1 = await provisionStudent(canteenB, "mt-b1");

  createdUsers.push(
    workerA.id,
    workerB.id,
    adminA.id,
    adminB.id,
    studentA1.id,
    studentA2.id,
    studentB1.id,
  );
});

test.afterAll(async () => {
  for (const orderId of createdOrders) {
    await admin.from("order_bins").delete().eq("order_id", orderId);
    await admin.from("payments").delete().eq("order_id", orderId);
    await admin.from("order_items").delete().eq("order_id", orderId);
    await admin.from("orders").delete().eq("id", orderId);
    const free = { is_occupied: false, order_id: null, assigned_order_id: null, status: "empty", updated_at: new Date().toISOString() };
    await admin.from("bins").update(free).eq("order_id", orderId);
    await admin.from("bins").update(free).eq("assigned_order_id", orderId);
  }

  for (const uid of createdUsers) {
    await deleteUser(uid);
  }
});

test("multi-tenant users + auto-accept timing + scoped visibility", async ({ page }) => {
  test.skip(setupFailed, "Setup failed: no canteens with available menu items");
  const studentA1Token = await getAccessToken(studentA1.email, studentA1.password);
  const studentA2Token = await getAccessToken(studentA2.email, studentA2.password);
  const studentB1Token = await getAccessToken(studentB1.email, studentB1.password);

  const orderA1 = await placeOrder(studentA1Token, canteenA, slotA, menuA, 1);
  const orderA2 = await placeOrder(studentA2Token, canteenA, slotA, menuA, 1);
  const orderB1 = await placeOrder(studentB1Token, canteenB, slotB, menuB, 1);

  // Force age >35s so GET /api/orders triggers auto-accept immediately.
  const oldIso = new Date(Date.now() - 50_000).toISOString();
  const toAge = [orderA1, orderA2, orderB1];
  await admin.from("orders").update({ status: "placed", created_at: oldIso }).in("id", toAge);

  const workerAToken = await getAccessToken(workerA.email, workerA.password);
  const workerBToken = await getAccessToken(workerB.email, workerB.password);
  const adminAToken = await getAccessToken(adminA.email, adminA.password);
  const adminBToken = await getAccessToken(adminB.email, adminB.password);

  const workerARes = await apiFetch(`${APP_URL}/api/orders?worker=true`, {
    headers: { Authorization: `Bearer ${workerAToken}` },
  });
  const workerABody = await workerARes.json();
  expect(workerARes.ok).toBeTruthy();
  const workerAIds = new Set((workerABody.orders ?? []).map((o: { id: string }) => o.id));
  expect(workerAIds.has(orderA1)).toBeTruthy();
  expect(workerAIds.has(orderA2)).toBeTruthy();
  expect(workerAIds.has(orderB1)).toBeFalsy();
  const workerAStatuses = new Map((workerABody.orders ?? []).map((o: { id: string; rawStatus?: string; status?: string }) => [o.id, o.rawStatus ?? o.status]));
  expect(workerAStatuses.get(orderA1)).toBe("confirmed");
  expect(workerAStatuses.get(orderA2)).toBe("confirmed");

  const workerBRes = await apiFetch(`${APP_URL}/api/orders?worker=true`, {
    headers: { Authorization: `Bearer ${workerBToken}` },
  });
  const workerBBody = await workerBRes.json();
  expect(workerBRes.ok).toBeTruthy();
  const workerBIds = new Set((workerBBody.orders ?? []).map((o: { id: string }) => o.id));
  expect(workerBIds.has(orderB1)).toBeTruthy();
  expect(workerBIds.has(orderA1)).toBeFalsy();
  expect(workerBIds.has(orderA2)).toBeFalsy();

  const adminARes = await apiFetch(`${APP_URL}/api/orders`, {
    headers: { Authorization: `Bearer ${adminAToken}` },
  });
  const adminABody = await adminARes.json();
  expect(adminARes.ok).toBeTruthy();
  const adminAIds = new Set((adminABody.orders ?? []).map((o: { id: string }) => o.id));
  expect(adminAIds.has(orderA1)).toBeTruthy();
  expect(adminAIds.has(orderA2)).toBeTruthy();
  expect(adminAIds.has(orderB1)).toBeFalsy();

  const adminBRes = await apiFetch(`${APP_URL}/api/orders`, {
    headers: { Authorization: `Bearer ${adminBToken}` },
  });
  const adminBBody = await adminBRes.json();
  expect(adminBRes.ok).toBeTruthy();
  const adminBIds = new Set((adminBBody.orders ?? []).map((o: { id: string }) => o.id));
  expect(adminBIds.has(orderB1)).toBeTruthy();
  expect(adminBIds.has(orderA1)).toBeFalsy();

  // Verify UI behavior for one new worker and one new student account.
  await page.goto(`${APP_URL}/worker/login`);
  await page.locator('input[type="text"]').first().fill(workerA.email);
  await page.locator('input[type="password"]').first().fill(workerA.password);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL(/\/worker\/orders/, { timeout: 20_000 });
  await expect(page.locator("body")).toContainText(/Orders|Prep Plan|Bins/i, { timeout: 20_000 });

  // Reset auth storage/cookies before switching to a different role in the
  // same Playwright page instance.
  await page.context().clearCookies();
  await page.goto(`${APP_URL}/login`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  await loginViaPasswordTab(page, studentA1.email, studentA1.password, /\/dashboard(\?|$|\/)/);
  await page.goto(`${APP_URL}/dashboard/orders`);
  await expect(page.locator("body")).toContainText(new RegExp(orderA1.slice(-6).toUpperCase(), "i"), { timeout: 20_000 });

  // Final DB assertion: placed orders were auto-promoted to confirmed.
  const db = await admin.from("orders").select("id, status").in("id", toAge);
  expect(db.error, db.error?.message).toBeFalsy();
  const byId = new Map((db.data ?? []).map((r) => [String(r.id), String(r.status)]));
  expect(byId.get(orderA1)).toBe("confirmed");
  expect(byId.get(orderA2)).toBe("confirmed");
  expect(byId.get(orderB1)).toBe("confirmed");
});

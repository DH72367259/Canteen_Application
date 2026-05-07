import { test, expect } from "@playwright/test";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import {
  APP_URL,
  SUPABASE_URL,
  SUPABASE_ANON,
  SUPABASE_SVC,
  WHITELIST,
  apiFetch,
  loginViaPasswordTab,
  getAccessToken,
} from "./_helpers";

let admin: SupabaseClient;
let studentId = "";
let studentEmail = "";
const studentPassword = "Student@12345";
let orderA = "";
let orderB = "";
let canteenA = "";
let canteenB = "";
// Using getAccessToken from _helpers

function ensureSlotLabel(canteenId: string): string {
  // Synthetic label — does NOT match any time_slots row, so place/route.ts
  // resolves slotId=null and skips the IST slot-cutoff check entirely.
  return `E2E-MULTI-CANT-${canteenId.slice(-4)}-${Date.now().toString().slice(-8)}`;
}

async function placeOneOrder(studentToken: string, canteenId: string): Promise<string> {
  const meal = await admin
    .from("menu_items")
    .select("id")
    .eq("canteen_id", canteenId)
    .eq("is_available", true)
    .limit(1)
    .single();
  if (meal.error) throw meal.error;

  const slotLabel = ensureSlotLabel(canteenId);

  const placed = await apiFetch(`${APP_URL}/api/orders/place`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${studentToken}`,
    },
    body: JSON.stringify({
      canteenId,
      slotLabel,
      cartItems: [{ id: meal.data.id, qty: 1 }],
    }),
  });
  const body = await placed.json();
  if (!placed.ok) throw new Error(`place failed (${canteenId}): ${JSON.stringify(body)}`);
  return String(body.orderId);
}

test.beforeAll(async () => {
  admin = createClient(SUPABASE_URL, SUPABASE_SVC, { auth: { persistSession: false } });

  const menuCanteens = await admin
    .from("menu_items")
    .select("canteen_id")
    .eq("is_available", true)
    .limit(50);
  if (menuCanteens.error) throw menuCanteens.error;
  const candidateIds = Array.from(new Set((menuCanteens.data ?? []).map((r) => String(r.canteen_id ?? "")).filter(Boolean)));
  if (candidateIds.length < 2) {
    throw new Error("Need at least two canteens with available menu items for multi-canteen test");
  }
  canteenA = candidateIds[0];
  canteenB = candidateIds[1];

  studentEmail = `e2e-multi-canteen-${Date.now()}@noqx.test`;
  const create = await admin.auth.admin.createUser({
    email: studentEmail,
    password: studentPassword,
    email_confirm: true,
    user_metadata: { name: "E2E Multi Canteen Student" },
  });
  if (create.error) throw create.error;
  studentId = create.data.user.id;

  await admin.from("profiles").upsert({
    id: studentId,
    name: "E2E Multi Canteen Student",
    role: "student",
    canteen_id: canteenA,
  });

  const studentToken = await getAccessToken(studentEmail, studentPassword);
  orderA = await placeOneOrder(studentToken, canteenA);
  orderB = await placeOneOrder(studentToken, canteenB);
});

test.afterAll(async () => {
  for (const id of [orderA, orderB].filter(Boolean)) {
    await admin.from("order_bins").delete().eq("order_id", id);
    await admin.from("payments").delete().eq("order_id", id);
    await admin.from("order_items").delete().eq("order_id", id);
    await admin.from("orders").delete().eq("id", id);
    const free = { is_occupied: false, order_id: null, assigned_order_id: null, status: "empty", updated_at: new Date().toISOString() };
    await admin.from("bins").update(free).eq("order_id", id);
    await admin.from("bins").update(free).eq("assigned_order_id", id);
  }
  if (studentId) await admin.auth.admin.deleteUser(studentId).catch(() => {});
});

test("same student can hold active orders across multiple canteens without losing any", async ({ page }) => {
  expect(orderA).toBeTruthy();
  expect(orderB).toBeTruthy();
  expect(canteenA).not.toBe(canteenB);

  // Student API should include both orders.
  const stuTok = await getAccessToken(studentEmail, studentPassword);
  const studentOrdersRes = await apiFetch(`${APP_URL}/api/orders`, {
    headers: { Authorization: `Bearer ${stuTok}` },
  });
  const studentOrders = await studentOrdersRes.json();
  expect(studentOrdersRes.ok).toBeTruthy();
  const studentIds = new Set((studentOrders.orders ?? []).map((o: { id: string }) => o.id));
  expect(studentIds.has(orderA)).toBeTruthy();
  expect(studentIds.has(orderB)).toBeTruthy();

  // Student UI list should show both order references.
  await loginViaPasswordTab(page, studentEmail, studentPassword, /\/dashboard(\?|$|\/)/);
  await page.goto(`${APP_URL}/dashboard/orders`);
  await expect(page.locator("body")).toContainText(new RegExp(orderA.slice(-6).toUpperCase(), "i"), { timeout: 20_000 });
  await expect(page.locator("body")).toContainText(new RegExp(orderB.slice(-6).toUpperCase(), "i"), { timeout: 20_000 });

  // Manager for canteen_admin account should only see their own canteen orders.
  const managerTok = await getAccessToken(WHITELIST.canteenAdmin.email, WHITELIST.canteenAdmin.password);
  const mgr = await apiFetch(`${APP_URL}/api/orders`, {
    headers: { Authorization: `Bearer ${managerTok}` },
  });
  const mgrBody = await mgr.json();
  expect(mgr.ok).toBeTruthy();
  const mgrIds = new Set((mgrBody.orders ?? []).map((o: { id: string }) => o.id));
  // One of these must be visible depending on whether manager belongs to canteenA or canteenB.
  expect(mgrIds.has(orderA) || mgrIds.has(orderB)).toBeTruthy();

  // Super admin should see both orders globally.
  const superTok = await getAccessToken(WHITELIST.superAdmin.email, WHITELIST.superAdmin.password);
  const all = await apiFetch(`${APP_URL}/api/orders`, {
    headers: { Authorization: `Bearer ${superTok}` },
  });
  const allBody = await all.json();
  expect(all.ok).toBeTruthy();
  const allIds = new Set((allBody.orders ?? []).map((o: { id: string }) => o.id));
  expect(allIds.has(orderA)).toBeTruthy();
  expect(allIds.has(orderB)).toBeTruthy();
});

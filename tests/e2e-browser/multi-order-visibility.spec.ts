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

const CANTEEN_ID = "9d1b1e36-48a1-4ce8-a270-704eec9018c8";

let admin: SupabaseClient;
let studentId = "";
let studentEmail = "";
const studentPassword = "Student@12345";
let order1Id = "";
let order2Id = "";
let seededSlotId: string | null = null;

// Using getAccessToken from _helpers

async function ensureSlotLabel() {
  const slots = await admin
    .from("time_slots")
    .select("id, slot_name, start_time")
    .eq("canteen_id", CANTEEN_ID)
    .eq("is_active", true)
    .order("start_time", { ascending: true });
  if (slots.error) throw slots.error;

  const istNow = (() => {
    const d = new Date();
    return (d.getUTCHours() * 60 + d.getUTCMinutes() + 330) % 1440;
  })();

  const future = (slots.data ?? []).find((s) => {
    const [h, m] = String(s.start_time).split(":").map(Number);
    return h * 60 + m - 15 > istNow;
  });
  if (future) return String(future.slot_name);

  const startMin = Math.min(istNow + 30, 23 * 60 + 30);
  const endMin = Math.min(startMin + 30, 23 * 60 + 59);
  const sh = String(Math.floor(startMin / 60)).padStart(2, "0");
  const sm = String(startMin % 60).padStart(2, "0");
  const eh = String(Math.floor(endMin / 60)).padStart(2, "0");
  const em = String(endMin % 60).padStart(2, "0");
  const slotName = `E2E-MULTI-${Date.now().toString().slice(-4)}`;
  const seed = await admin
    .from("time_slots")
    .insert({
      canteen_id: CANTEEN_ID,
      slot_name: slotName,
      start_time: `${sh}:${sm}:00`,
      end_time: `${eh}:${em}:00`,
      capacity: 60,
      is_active: true,
    })
    .select("id, slot_name")
    .single();
  if (seed.error) throw seed.error;
  seededSlotId = String(seed.data.id);
  return String(seed.data.slot_name);
}

test.beforeAll(async () => {
  admin = createClient(SUPABASE_URL, SUPABASE_SVC, { auth: { persistSession: false } });

  studentEmail = `e2e-multi-order-${Date.now()}@noqx.test`;
  const create = await admin.auth.admin.createUser({
    email: studentEmail,
    password: studentPassword,
    email_confirm: true,
    user_metadata: { name: "E2E Multi Order Student" },
  });
  if (create.error) throw create.error;
  studentId = create.data.user.id;

  await admin.from("profiles").upsert({
    id: studentId,
    name: "E2E Multi Order Student",
    role: "student",
    canteen_id: CANTEEN_ID,
  });

  const meal = await admin
    .from("menu_items")
    .select("id")
    .eq("canteen_id", CANTEEN_ID)
    .eq("is_available", true)
    .limit(1)
    .single();
  if (meal.error) throw meal.error;

  const slotLabel = await ensureSlotLabel();
  const studentToken = await getAccessToken(studentEmail, studentPassword);

  for (let i = 0; i < 2; i++) {
    const res = await apiFetch(`${APP_URL}/api/orders/place`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${studentToken}`,
      },
      body: JSON.stringify({
        canteenId: CANTEEN_ID,
        slotLabel,
        cartItems: [{ id: meal.data.id, qty: 1 }],
      }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(`order place failed: ${JSON.stringify(body)}`);
    if (i === 0) order1Id = String(body.orderId);
    else order2Id = String(body.orderId);
  }
});

test.afterAll(async () => {
  for (const id of [order1Id, order2Id].filter(Boolean)) {
    await admin.from("order_bins").delete().eq("order_id", id);
    await admin.from("payments").delete().eq("order_id", id);
    await admin.from("order_items").delete().eq("order_id", id);
    await admin.from("orders").delete().eq("id", id);
    const free = { is_occupied: false, order_id: null, assigned_order_id: null, status: "empty", updated_at: new Date().toISOString() };
    await admin.from("bins").update(free).eq("order_id", id);
    await admin.from("bins").update(free).eq("assigned_order_id", id);
  }
  if (seededSlotId) await admin.from("time_slots").delete().eq("id", seededSlotId);
  if (studentId) await admin.auth.admin.deleteUser(studentId).catch(() => {});
});

test("two same-canteen orders remain visible for student, canteen admin, and super admin", async ({ page }) => {
  expect(order1Id).toBeTruthy();
  expect(order2Id).toBeTruthy();

  // Student UI should keep both active orders visible.
  await loginViaPasswordTab(page, studentEmail, studentPassword, /\/dashboard(\?|$|\/)/);
  await page.goto(`${APP_URL}/dashboard/orders`);
  await expect(page.locator("body")).toContainText(new RegExp(order1Id.slice(-6).toUpperCase(), "i"), { timeout: 20_000 });
  await expect(page.locator("body")).toContainText(new RegExp(order2Id.slice(-6).toUpperCase(), "i"), { timeout: 20_000 });

  // Student API should return both orders.
  const studentToken = await getAccessToken(studentEmail, studentPassword);
  const studentOrdersRes = await apiFetch(`${APP_URL}/api/orders`, {
    headers: { Authorization: `Bearer ${studentToken}` },
  });
  const studentOrders = await studentOrdersRes.json();
  expect(studentOrdersRes.ok).toBeTruthy();
  const studentIds = new Set((studentOrders.orders ?? []).map((o: { id: string }) => o.id));
  expect(studentIds.has(order1Id)).toBeTruthy();
  expect(studentIds.has(order2Id)).toBeTruthy();

  // Canteen admin API should also see both live orders for their canteen.
  const managerToken = await getAccessToken(WHITELIST.canteenAdmin.email, WHITELIST.canteenAdmin.password);
  const managerOrdersRes = await apiFetch(`${APP_URL}/api/orders`, {
    headers: { Authorization: `Bearer ${managerToken}` },
  });
  const managerOrders = await managerOrdersRes.json();
  expect(managerOrdersRes.ok).toBeTruthy();
  const managerIds = new Set((managerOrders.orders ?? []).map((o: { id: string }) => o.id));
  expect(managerIds.has(order1Id)).toBeTruthy();
  expect(managerIds.has(order2Id)).toBeTruthy();

  // Super admin global order feed should include both orders.
  const superToken = await getAccessToken(WHITELIST.superAdmin.email, WHITELIST.superAdmin.password);
  const adminOrdersRes = await apiFetch(`${APP_URL}/api/orders`, {
    headers: { Authorization: `Bearer ${superToken}` },
  });
  const adminOrders = await adminOrdersRes.json();
  expect(adminOrdersRes.ok).toBeTruthy();
  const adminIds = new Set((adminOrders.orders ?? []).map((o: { id: string }) => o.id));
  expect(adminIds.has(order1Id)).toBeTruthy();
  expect(adminIds.has(order2Id)).toBeTruthy();
});

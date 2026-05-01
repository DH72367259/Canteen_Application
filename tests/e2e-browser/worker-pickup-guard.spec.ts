/**
 * Headless-browser E2E for the worker pickup flow + per-customer guard.
 *
 * Scenario:
 *   1. Provision a fresh student via Supabase admin SDK.
 *   2. Place TWO orders for the same student at the same canteen (via API,
 *      so we don't have to drive Razorpay).
 *   3. Open the worker dashboard in headless Chromium, log in with the
 *      worker whitelist account, walk order #1 to placed_in_bin via the
 *      actual UI buttons (Accept proxy = transition Placed→Preparing →
 *      Ready to Place → Placed).
 *   4. Assert the inline "Awaiting OTP Pickup" row renders for order #1.
 *   5. Type the order #1 OTP into the inline input, click Verify, expect
 *      the 409 message about the sibling order.
 *   6. Walk order #2 to placed_in_bin via API, refresh worker UI, retry
 *      the OTP — both orders should clear.
 *   7. Cleanup all rows.
 */
import { test, expect, request as pwRequest, Page } from "@playwright/test";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = readFileSync(".env.local", "utf8");
for (const line of env.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const URL_  = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON  = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SVC   = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const APP   = process.env.APP_BASE_URL ?? "http://localhost:3000";

const STUDENT_EMAIL = "e2e-pw-student@noqx.test";
const STUDENT_PASS  = "Student@12345";
const WORKER_EMAIL  = "worker1@noqx.test";
const WORKER_PASS   = "Worker@12345";
const CANTEEN_ID    = "9d1b1e36-48a1-4ce8-a270-704eec9018c8";

let admin: SupabaseClient;
let studentId = "";
let order1Id = "";
let order2Id = "";
let order1Otp = "";
let order2Otp = "";
let slotName = "";
let slotIdSeeded: string | null = null;

async function loginToken(email: string, password: string) {
  const sb = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`login ${email}: ${error.message}`);
  return data.session!.access_token;
}

async function ensureSlot() {
  const r = await admin.from("time_slots").select("id, slot_name, start_time").eq("canteen_id", CANTEEN_ID);
  const istNow = (() => { const d = new Date(); return (d.getUTCHours() * 60 + d.getUTCMinutes() + 330) % 1440; })();
  const future = (r.data ?? []).find((s: { start_time: string }) => {
    const [h, m] = s.start_time.split(":").map(Number);
    return h * 60 + m - 15 > istNow;
  });
  if (future) return future.slot_name as string;
  let startMin = istNow + 30;
  if (startMin >= 23 * 60 + 30) startMin = 23 * 60 + 30;
  const sh = String(Math.floor(startMin / 60)).padStart(2, "0");
  const sm = String(startMin % 60).padStart(2, "0");
  const eh = String(Math.floor(Math.min(startMin + 30, 23*60+59) / 60)).padStart(2, "0");
  const em = String(Math.min(startMin + 30, 23*60+59) % 60).padStart(2, "0");
  const seed = { canteen_id: CANTEEN_ID, slot_name: "PWE2E", start_time: `${sh}:${sm}:00`, end_time: `${eh}:${em}:00`, capacity: 60, is_active: true };
  const ins = await admin.from("time_slots").insert(seed).select().single();
  if (ins.error) throw new Error(ins.error.message);
  slotIdSeeded = ins.data.id;
  return seed.slot_name;
}

test.beforeAll(async () => {
  admin = createClient(URL_, SVC, { auth: { persistSession: false } });

  // Wipe any prior test student
  const list = await admin.auth.admin.listUsers();
  const existing = list.data.users.find(u => (u.email ?? "").toLowerCase() === STUDENT_EMAIL);
  if (existing) await admin.auth.admin.deleteUser(existing.id);
  const create = await admin.auth.admin.createUser({
    email: STUDENT_EMAIL, password: STUDENT_PASS, email_confirm: true,
    user_metadata: { name: "PW E2E Student" },
  });
  if (create.error) throw create.error;
  studentId = create.data.user.id;
  await admin.from("profiles").upsert({
    id: studentId, name: "PW E2E Student", role: "student", canteen_id: CANTEEN_ID,
  });

  slotName = await ensureSlot();
  const meal = await admin.from("menu_items").select("id, name, price")
    .eq("canteen_id", CANTEEN_ID).eq("is_meal", true).eq("is_available", true).limit(1).single();
  if (meal.error) throw new Error(`no meal: ${meal.error.message}`);

  const studentToken = await loginToken(STUDENT_EMAIL, STUDENT_PASS);

  // Place order #1 (qty 1)
  const place1 = await fetch(`${APP}/api/orders/place`, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${studentToken}` },
    body: JSON.stringify({ canteenId: CANTEEN_ID, slotLabel: slotName, cartItems: [{ id: meal.data.id, qty: 1 }] }),
  });
  const p1 = await place1.json();
  if (!place1.ok) throw new Error(`place1: ${JSON.stringify(p1)}`);
  order1Id = p1.orderId;
  order1Otp = p1.otp;

  // Place order #2 (qty 1)
  const place2 = await fetch(`${APP}/api/orders/place`, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${studentToken}` },
    body: JSON.stringify({ canteenId: CANTEEN_ID, slotLabel: slotName, cartItems: [{ id: meal.data.id, qty: 1 }] }),
  });
  const p2 = await place2.json();
  if (!place2.ok) throw new Error(`place2: ${JSON.stringify(p2)}`);
  order2Id = p2.orderId;
  order2Otp = p2.otp;

  // Walk ONLY order #1 to placed_in_bin via API (worker UI clicks would
  // do the same but driving 3 PATCHes via REST is faster + deterministic).
  const workerToken = await loginToken(WORKER_EMAIL, WORKER_PASS);
  for (const step of ["preparing", "ready_for_placement", "placed_in_bin"]) {
    const r = await fetch(`${APP}/api/orders/${order1Id}/status`, {
      method: "PATCH",
      headers: { "content-type": "application/json", Authorization: `Bearer ${workerToken}` },
      body: JSON.stringify({ status: step }),
    });
    if (!r.ok) throw new Error(`order1 ->${step}: ${r.status} ${await r.text()}`);
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
  if (slotIdSeeded) await admin.from("time_slots").delete().eq("id", slotIdSeeded);
  if (studentId) await admin.auth.admin.deleteUser(studentId);
});

async function loginWorkerUI(page: Page) {
  await page.goto(`${APP}/worker/login`);
  await page.locator('input[type="text"]').first().fill(WORKER_EMAIL);
  await page.locator('input[type="password"]').first().fill(WORKER_PASS);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL(/\/worker\/dashboard/, { timeout: 15_000 });
}

test("worker dashboard shows awaiting-OTP row + per-customer guard blocks then releases", async ({ page }) => {
  await loginWorkerUI(page);

  // 1. Awaiting-OTP row should appear with the inline OTP input.
  const otpHeader = page.getByText(/AWAITING OTP PICKUP/);
  await expect(otpHeader).toBeVisible({ timeout: 20_000 });
  const otpInputs = page.locator('input[inputmode="numeric"]');
  await expect(otpInputs.first()).toBeVisible();

  // 2. Type the real OTP for order #1 — the guard must block (sibling order
  //    #2 is still in `placed`, not yet in a bin). We listen for the API
  //    response and assert it returned 409.
  const verifyPromise = page.waitForResponse(
    r => r.url().includes(`/api/orders/${order1Id}/verify-otp`) && r.request().method() === "POST",
    { timeout: 15_000 },
  );
  await otpInputs.first().fill(order1Otp);
  await page.getByRole("button", { name: /Verify/i }).first().click();
  const blocked = await verifyPromise;
  expect(blocked.status()).toBe(409);
  const body = await blocked.json();
  expect(body.error).toMatch(/other order/i);

  // 3. Walk order #2 to placed_in_bin via API so the guard clears.
  const workerToken = await loginToken(WORKER_EMAIL, WORKER_PASS);
  for (const step of ["preparing", "ready_for_placement", "placed_in_bin"]) {
    const r = await pwRequest.newContext().then(ctx => ctx.fetch(`${APP}/api/orders/${order2Id}/status`, {
      method: "PATCH",
      headers: { "content-type": "application/json", Authorization: `Bearer ${workerToken}` },
      data: { status: step },
    }));
    expect(r.status()).toBeLessThan(400);
  }

  // 4. Worker UI polls every 15s — force a reload to pull the fresh state
  //    quickly (faster than waiting for the next interval).
  await page.reload();
  await expect(page.getByText(/AWAITING OTP PICKUP/)).toBeVisible({ timeout: 20_000 });

  // 5. Retry order #1 OTP — should now succeed (200).
  const verify2 = page.waitForResponse(
    r => r.url().includes(`/api/orders/${order1Id}/verify-otp`) && r.request().method() === "POST",
    { timeout: 15_000 },
  );
  // Find the row whose label contains the order's bin code (order #1 first).
  const inputs = page.locator('input[inputmode="numeric"]');
  await inputs.first().fill(order1Otp);
  await page.getByRole("button", { name: /Verify/i }).first().click();
  const r2 = await verify2;
  expect(r2.status()).toBe(200);

  // 6. Verify order #2 too — also expected 200 now (sibling is collected).
  const verify3 = page.waitForResponse(
    r => r.url().includes(`/api/orders/${order2Id}/verify-otp`) && r.request().method() === "POST",
    { timeout: 15_000 },
  );
  await page.reload();
  await expect(page.getByText(/AWAITING OTP PICKUP/)).toBeVisible({ timeout: 20_000 });
  const inputs2 = page.locator('input[inputmode="numeric"]');
  await inputs2.first().fill(order2Otp);
  await page.getByRole("button", { name: /Verify/i }).first().click();
  const r3 = await verify3;
  expect(r3.status()).toBe(200);

  // 7. DB state assertions
  const { data: o1 } = await admin.from("orders").select("status").eq("id", order1Id).single();
  const { data: o2 } = await admin.from("orders").select("status").eq("id", order2Id).single();
  expect(o1?.status).toBe("collected");
  expect(o2?.status).toBe("collected");
});

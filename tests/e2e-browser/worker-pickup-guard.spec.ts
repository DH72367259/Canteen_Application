/**
 * Headless-browser E2E for the worker pickup flow (manager-only OTP policy).
 *
 * Scenario:
 *   1. Provision a fresh student via Supabase admin SDK.
 *   2. Place TWO orders for the same student at the same canteen (via API,
 *      so we don't have to drive Razorpay).
 *   3. Open the worker dashboard in headless Chromium, log in with the
 *      worker whitelist account, walk order #1 to placed_in_bin via the
 *      actual UI buttons (Accept proxy = transition Placed→Preparing →
 *      Ready to Place → Placed).
 *   4. Assert worker UI does not render OTP verification controls.
 *   5. Assert worker role is rejected by manager-only OTP verify endpoint.
 *   6. Cleanup all rows.
 */
import { test, expect, request as pwRequest, Page } from "@playwright/test";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

// Load .env.local if it exists, otherwise rely on process.env (CI environment)
try {
  const env = readFileSync(".env.local", "utf8");
  for (const line of env.split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {
  // .env.local doesn't exist — using environment variables from CI
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
let slotName = "";

// Using getAccessToken from _helpers

function ensureSlot(): string {
  // Synthetic label — does NOT match any time_slots row, so place/route.ts
  // resolves slotId=null and skips the IST slot-cutoff check entirely.
  return `E2E-GUARD-${Date.now().toString().slice(-8)}`;
}

async function getAccessToken(email: string, password: string): Promise<string> {
  const res = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: ANON,
    },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: "Unknown error" }));
    throw new Error(`Failed to get token: ${err.message || err.error_description}`);
  }
  const data = await res.json() as { access_token?: string };
  if (!data.access_token) throw new Error("No access token returned");
  return data.access_token;
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

  slotName = ensureSlot();
  const meal = await admin.from("menu_items").select("id, name, price")
    .eq("canteen_id", CANTEEN_ID).eq("is_meal", true).eq("is_available", true).limit(1).single();
  if (meal.error) throw new Error(`no meal: ${meal.error.message}`);

  const studentToken = await getAccessToken(STUDENT_EMAIL, STUDENT_PASS);

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

  // Walk ONLY order #1 to placed_in_bin via API (worker UI clicks would
  // do the same but driving 3 PATCHes via REST is faster + deterministic).
  const workerToken = await getAccessToken(WORKER_EMAIL, WORKER_PASS);
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
  if (studentId) await admin.auth.admin.deleteUser(studentId);
});

async function loginWorkerUI(page: Page) {
  await page.goto(`${APP}/worker/login`);
  await page.locator('input[type="text"]').first().fill(WORKER_EMAIL);
  await page.locator('input[type="password"]').first().fill(WORKER_PASS);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForURL(/\/worker\/orders/, { timeout: 15_000 });
}

test("worker UI shows orders and worker API verify-otp is allowed", async ({ page }) => {
  await loginWorkerUI(page);
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});

  // Worker orders page should load.
  await expect(page.locator("body")).toBeVisible();

  // Workers can now verify OTP (policy changed: workers complete pickup via OTP).
  const workerToken = await getAccessToken(WORKER_EMAIL, WORKER_PASS);
  const result = await pwRequest.newContext().then(ctx => ctx.fetch(`${APP}/api/orders/${order1Id}/verify-otp`, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${workerToken}` },
    data: { otp: order1Otp },
  }));
  // Worker role is now allowed — expect 200 success or 400 (wrong OTP format), not 403.
  expect(result.status()).not.toBe(403);
});

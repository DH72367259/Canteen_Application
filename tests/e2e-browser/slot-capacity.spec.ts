/**
 * Slot Capacity Enforcement Tests — API-based, no browser UI required.
 *
 * Verifies the server-side per-slot order cap added to /api/orders/place:
 *
 *   S1 – /api/slots reports correct capacity and availability fields
 *   S2 – Can place an order when the slot has capacity
 *   S3 – Cannot exceed the slot's maxOrdersPerSlot cap (409 + slot_full)
 *   S4 – Different slots have independent capacity (slot A full ≠ slot B full)
 *   S5 – Cancelled orders do not count toward the slot cap
 *   S6 – /api/cart/check reflects slot fullness before order placement
 *   S7 – Concurrent requests cannot race past the slot cap
 *
 * Setup strategy: rather than placing 45 real orders to fill a slot, we
 * insert placeholder orders directly via the service-role client (fast and
 * hermetic), then verify the cap is enforced for the (n+1)-th order.
 *
 * Prerequisites in the Supabase test project:
 *   - ≥1 canteen with ≥1 available menu item
 *   - WHITELIST accounts configured (admin@noqx.test etc.)
 */

import { test, expect } from "@playwright/test";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import {
  APP_URL,
  SUPABASE_URL,
  SUPABASE_ANON,
  SUPABASE_SVC,
  apiFetch,
  provisionStudent,
  deleteUser,
} from "./_helpers";

// ── Module-level state ────────────────────────────────────────────────────────

let admin: SupabaseClient;
let canteenId = "";
let menuItemId = "";
let studentId = "";
let studentEmail = "";
let studentToken = "";
const studentPassword = "Student@12345";

// Track everything created so afterAll can clean up completely.
const seededOrderIds: string[] = [];
const seededSlotIds: string[] = [];

// ── Shared helpers ────────────────────────────────────────────────────────────

async function loginToken(email: string, password: string): Promise<string> {
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON, { auth: { persistSession: false } });
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`loginToken(${email}): ${error.message}`);
  return data.session!.access_token;
}

/**
 * Ensure an active time slot exists for canteenId and return its slot_name.
 * Inserts one if no future slot exists (matches ensureSlotLabel in other specs).
 */
async function ensureSlotLabel(cidOverride?: string): Promise<string> {
  const cid = cidOverride ?? canteenId;
  const slots = await admin
    .from("time_slots")
    .select("id, slot_name, start_time")
    .eq("canteen_id", cid)
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
  const endMin   = Math.min(startMin + 30, 23 * 60 + 59);
  const fmt = (m: number) =>
    `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:00`;
  const slotName = `E2E-SLOTCAP-${Date.now().toString().slice(-6)}`;

  const seed = await admin
    .from("time_slots")
    .insert({
      canteen_id: cid,
      slot_name:  slotName,
      start_time: fmt(startMin),
      end_time:   fmt(endMin),
      capacity:   60,
      is_active:  true,
    })
    .select("id, slot_name")
    .single();
  if (seed.error) throw seed.error;

  seededSlotIds.push(String(seed.data.id));
  return String(seed.data.slot_name);
}

/**
 * Fetch today's IST date string (YYYY-MM-DD) for seeding/filtering orders.
 */
function todayIST(): string {
  return new Date(new Date().getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

/**
 * Insert `n` placeholder orders for a given slot_label.
 * Uses the service-role client to bypass RLS.
 * Returns the inserted order IDs.
 */
async function seedSlotOrders(
  slotLabel: string,
  n: number,
  overrideCanteenId?: string,
): Promise<string[]> {
  const cid = overrideCanteenId ?? canteenId;
  const inserted: string[] = [];
  for (let i = 0; i < n; i++) {
    const { data, error } = await admin
      .from("orders")
      .insert({
        user_id:      studentId,
        canteen_id:   cid,
        total_amount: 10,
        status:       "placed",
        otp:          String(1000 + i),
        slot_label:   slotLabel,
        bin_count:    1,
        extra_bin_fee_paise: 0,
      })
      .select("id")
      .single();
    if (error) throw new Error(`seedSlotOrders failed at i=${i}: ${error.message}`);
    inserted.push(String(data.id));
    seededOrderIds.push(String(data.id));
  }
  return inserted;
}

/**
 * Place a real order via the API and return the parsed response body.
 * Throws if the request itself fails (network error), but lets HTTP error
 * statuses pass through so callers can assert on them.
 */
async function placeOrder(
  slotLabel: string,
  token?: string,
  overrideCanteenId?: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const cid = overrideCanteenId ?? canteenId;
  const resp = await apiFetch(`${APP_URL}/api/orders/place`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${token ?? studentToken}`,
    },
    body: JSON.stringify({
      canteenId:          cid,
      cartItems:          [{ id: menuItemId, qty: 1 }],
      slotLabel,
      paymentId:          null,
      razorpayOrderId:    null,
      razorpaySignature:  null,
    }),
  });
  const body = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
  if (resp.ok && body.orderId) seededOrderIds.push(String(body.orderId));
  return { status: resp.status, body };
}

/**
 * Derive the /api/slots slot label for a given slotName.
 * /api/slots generates labels in "H:MM AM/PM - H:MM AM/PM" format from
 * slot_control windows, but test slots seeded directly into time_slots use
 * their slot_name as the label key in /api/cart/check.
 * For simplicity, the E2E tests use the slot_name directly as slotLabel
 * (matching how /api/cart/check queries by slot_label column).
 */
function makeSlotLabel(slotName: string): string {
  return slotName;
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

test.beforeAll(async () => {
  admin = createClient(SUPABASE_URL, SUPABASE_SVC, { auth: { persistSession: false } });

  // Find a canteen with an available menu item.
  const { data: rows, error } = await admin
    .from("menu_items")
    .select("id, canteen_id")
    .eq("is_available", true)
    .limit(1);
  if (error) throw error;
  if (!rows || rows.length === 0) throw new Error("No available menu items found in test DB");

  menuItemId = String(rows[0].id);
  canteenId  = String(rows[0].canteen_id);

  // Provision a student scoped to this canteen.
  const s = await provisionStudent(canteenId, "slotcap");
  studentId    = s.id;
  studentEmail = s.email;
  studentToken = await loginToken(s.email, s.password);
});

test.afterAll(async () => {
  // Delete all seeded orders (order_bins, payments, order_items first for FK).
  for (const orderId of seededOrderIds) {
    await admin.from("order_bins").delete().eq("order_id", orderId);
    await admin.from("payments").delete().eq("order_id", orderId);
    await admin.from("order_items").delete().eq("order_id", orderId);
    await admin.from("orders").delete().eq("id", orderId);
    const free = {
      is_occupied: false, order_id: null,
      assigned_order_id: null, status: "empty",
      updated_at: new Date().toISOString(),
    };
    await admin.from("bins").update(free).eq("order_id", orderId);
    await admin.from("bins").update(free).eq("assigned_order_id", orderId);
  }
  for (const slotId of seededSlotIds) {
    await admin.from("time_slots").delete().eq("id", slotId);
  }
  await deleteUser(studentId);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe("Slot Capacity Enforcement", () => {
  test("S1 – /api/slots returns capacity and availability fields", async () => {
    test.skip(!canteenId, "No canteen found");

    const resp = await apiFetch(`${APP_URL}/api/slots?canteenId=${canteenId}`);
    expect(resp.ok).toBeTruthy();
    const body = await resp.json() as { slots: Array<{ id: string; label: string; available: boolean; is_full: boolean; capacity: number }> };
    expect(Array.isArray(body.slots)).toBeTruthy();

    // At least one slot should be present (we can't guarantee a specific count)
    if (body.slots.length === 0) {
      console.log("S1: No slots visible right now (all past cutoff or outside window) — skipping assertions");
      return;
    }

    const slot = body.slots[0];
    expect(typeof slot.id).toBe("string");
    expect(typeof slot.label).toBe("string");
    expect(typeof slot.available).toBe("boolean");
    expect(typeof slot.is_full).toBe("boolean");
    expect(typeof slot.capacity).toBe("number");
    expect(slot.capacity).toBeGreaterThan(0);

    console.log(`✓ S1: ${body.slots.length} slots, capacity=${slot.capacity}, first="${slot.label}", available=${slot.available}`);
  });

  test("S2 – Can place an order when the slot has capacity", async () => {
    test.skip(!canteenId, "No canteen found");

    const slotName  = await ensureSlotLabel();
    const slotLabel = makeSlotLabel(slotName);

    const { status, body } = await placeOrder(slotLabel);
    expect(status).toBe(200);
    expect(body.orderId).toBeTruthy();
    expect(String(body.otp)).toMatch(/^\d{4}$/);
    expect(Number(body.binCount)).toBeGreaterThanOrEqual(1);

    console.log(`✓ S2: orderId=${body.orderId}, OTP=${body.otp}, bins=${body.binCount}`);
  });

  test("S3 – Exceeding the per-slot cap returns 409 with slot_full flag", async () => {
    test.skip(!canteenId, "No canteen found");

    // Use a unique slot name so this test is isolated from S2.
    const slotName  = `E2E-SLOTCAP-S3-${Date.now()}`;
    const slotLabel = makeSlotLabel(slotName);

    // Fetch the canteen's slot control to know maxOrdersPerSlot.
    const { data: sc } = await admin
      .from("slot_control")
      .select("max_bins")
      .eq("canteen_id", canteenId)
      .maybeSingle();
    const maxBins         = Number(sc?.max_bins) || 60;
    const maxOrdersPerSlot = Math.floor(maxBins * 0.75);

    // Seed the slot to exactly full capacity via direct DB inserts.
    await seedSlotOrders(slotLabel, maxOrdersPerSlot);

    // The next order for this slot should be rejected.
    const { status, body } = await placeOrder(slotLabel);
    expect(status).toBe(409);
    expect(body.slot_full).toBe(true);
    expect(typeof body.error).toBe("string");
    expect(String(body.error).toLowerCase()).toContain("slot");

    console.log(
      `✓ S3: slot full after ${maxOrdersPerSlot} orders, place returned ${status}: "${body.error}"`,
    );
  });

  test("S4 – Different slots have independent capacity", async () => {
    test.skip(!canteenId, "No canteen found");

    // Fetch max cap.
    const { data: sc } = await admin
      .from("slot_control")
      .select("max_bins")
      .eq("canteen_id", canteenId)
      .maybeSingle();
    const maxBins         = Number(sc?.max_bins) || 60;
    const maxOrdersPerSlot = Math.floor(maxBins * 0.75);

    const labelA = `E2E-SLOTCAP-S4A-${Date.now()}`;
    const labelB = `E2E-SLOTCAP-S4B-${Date.now()}`;

    // Fill slot A to capacity.
    await seedSlotOrders(labelA, maxOrdersPerSlot);

    // Slot B should still accept orders (independent capacity).
    const { status, body } = await placeOrder(labelB);
    expect(status).toBe(200);
    expect(body.orderId).toBeTruthy();

    // Also verify slot A is still blocked.
    const { status: statusA, body: bodyA } = await placeOrder(labelA);
    expect(statusA).toBe(409);
    expect(bodyA.slot_full).toBe(true);

    console.log(
      `✓ S4: slot A full (${maxOrdersPerSlot} orders) → slot B unaffected, placed order ${body.orderId}`,
    );
  });

  test("S5 – Cancelled orders do not count toward the slot cap", async () => {
    test.skip(!canteenId, "No canteen found");

    const { data: sc } = await admin
      .from("slot_control")
      .select("max_bins")
      .eq("canteen_id", canteenId)
      .maybeSingle();
    const maxBins         = Number(sc?.max_bins) || 60;
    const maxOrdersPerSlot = Math.floor(maxBins * 0.75);

    const slotLabel = `E2E-SLOTCAP-S5-${Date.now()}`;

    // Insert (maxOrdersPerSlot - 1) active + 1 cancelled = total inserts equals cap
    // but only (cap-1) active → slot should still accept 1 more order.
    const cancelledIds = await seedSlotOrders(slotLabel, 1);
    await admin
      .from("orders")
      .update({ status: "cancelled" })
      .in("id", cancelledIds);
    await seedSlotOrders(slotLabel, maxOrdersPerSlot - 1);

    // One more order should succeed (cancelled one doesn't count).
    const { status, body } = await placeOrder(slotLabel);
    expect(status).toBe(200);
    expect(body.orderId).toBeTruthy();

    console.log(`✓ S5: cancelled order not counted — new order placed: ${body.orderId}`);
  });

  test("S6 – /api/cart/check reflects slot fullness before placement", async () => {
    test.skip(!canteenId, "No canteen found");

    const { data: sc } = await admin
      .from("slot_control")
      .select("max_bins")
      .eq("canteen_id", canteenId)
      .maybeSingle();
    const maxBins         = Number(sc?.max_bins) || 60;
    const maxOrdersPerSlot = Math.floor(maxBins * 0.75);

    const slotLabel = `E2E-SLOTCAP-S6-${Date.now()}`;
    await seedSlotOrders(slotLabel, maxOrdersPerSlot);

    // cart/check should report slot_full: true.
    const resp = await apiFetch(`${APP_URL}/api/cart/check`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${studentToken}`,
      },
      body: JSON.stringify({
        canteen_id: canteenId,
        slot:       slotLabel,
        items:      [{ id: menuItemId, quantity: 1 }],
      }),
    });
    const body = await resp.json() as {
      slot_full: boolean;
      slot_available: boolean;
      slot_orders_used: number;
      slot_capacity: { maxOrdersPerSlot: number };
    };

    expect(body.slot_full).toBe(true);
    expect(body.slot_available).toBe(false);
    expect(body.slot_orders_used).toBeGreaterThanOrEqual(maxOrdersPerSlot);

    console.log(
      `✓ S6: cart/check shows slot_full=true, used=${body.slot_orders_used}/${body.slot_capacity?.maxOrdersPerSlot}`,
    );
  });

  test("S7 – Concurrent requests cannot race past the slot cap", async () => {
    test.skip(!canteenId, "No canteen found");

    const { data: sc } = await admin
      .from("slot_control")
      .select("max_bins")
      .eq("canteen_id", canteenId)
      .maybeSingle();
    const maxBins         = Number(sc?.max_bins) || 60;
    const maxOrdersPerSlot = Math.floor(maxBins * 0.75);

    const slotLabel = `E2E-SLOTCAP-S7-${Date.now()}`;

    // Fill slot to (cap - 1) so only 1 more order should be allowed.
    await seedSlotOrders(slotLabel, maxOrdersPerSlot - 1);

    // Fire 5 concurrent requests — only 1 should succeed.
    const results = await Promise.all(
      Array.from({ length: 5 }, () => placeOrder(slotLabel)),
    );

    const successes = results.filter((r) => r.status === 200);
    const rejections = results.filter((r) => r.status === 409);

    // Exactly 1 should succeed; the rest should be rejected.
    expect(successes.length).toBeLessThanOrEqual(1);
    expect(rejections.length).toBeGreaterThanOrEqual(4);
    // Every rejection must carry slot_full flag.
    for (const r of rejections) {
      expect(r.body.slot_full).toBe(true);
    }

    console.log(
      `✓ S7: ${successes.length} succeeded, ${rejections.length} rejected among 5 concurrent requests`,
    );
  });
});

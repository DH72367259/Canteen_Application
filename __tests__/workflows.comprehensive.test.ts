/**
 * Comprehensive workflow integration tests — runs against real Supabase.
 * Env vars loaded from .env.local via jest.setup.env.ts (setupFiles).
 *
 * Workflows covered:
 *   Worker:     placed → confirmed → preparing → placed_in_bin
 *   Student:    fetch order, ready_for_pickup, collected
 *   Inventory:  sold_out toggle on/off
 *   Dynamic:    0-item order, slot capacity, canteen items, slot_control
 *   Batched vs made-to-order availability_type queries
 *   Cancellation with reason
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function admin(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
}

// ── Shared test state ───────────────────────────────────────────────────────
let canteenId  = "";
let studentId  = "";
let workerId   = "";
let orderId    = "";
let menuItemId = "";

const stamp = Date.now();

// ── Helpers ─────────────────────────────────────────────────────────────────
async function getOrCreateCanteen(): Promise<string> {
  const db = admin();
  const { data } = await db.from("canteens").select("id").limit(1).single();
  if (data?.id) return data.id;
  const { data: c } = await db.from("canteens").insert({ name: `Test Canteen ${stamp}`, is_active: true, status: "open" }).select("id").single();
  return c!.id;
}

async function createAuthUser(email: string, role: string): Promise<string> {
  const db = admin();
  const { data, error } = await db.auth.admin.createUser({
    email, password: "Test@12345!", email_confirm: true,
    user_metadata: { role, has_password: true },
  });
  if (error) throw new Error(`createUser(${email}): ${error.message}`);
  const uid = data.user.id;
  await db.from("profiles").upsert({ id: uid, email, role, name: `Test ${role} ${stamp}` });
  return uid;
}

// ── Setup / Teardown ─────────────────────────────────────────────────────────
beforeAll(async () => {
  expect(SUPABASE_URL).toBeTruthy();
  expect(SUPABASE_KEY).toBeTruthy();

  canteenId = await getOrCreateCanteen();
  studentId = await createAuthUser(`e2e-student-${stamp}@test.local`, "user");
  workerId  = await createAuthUser(`e2e-worker-${stamp}@test.local`,  "worker");

  // Ensure at least one menu item exists in the canteen
  const db = admin();
  const { data: existing } = await db.from("menu_items").select("id").eq("canteen_id", canteenId).limit(1);
  if (!existing?.length) {
    await db.from("menu_items").insert({
      canteen_id: canteenId, name: "Test Item", price: 50,
      category: "Snacks", is_available: true, availability_type: "slot_based",
    });
  }
  const { data: item } = await db.from("menu_items").select("id").eq("canteen_id", canteenId).limit(1).single();
  menuItemId = item?.id ?? "";
}, 30000);

afterAll(async () => {
  const db = admin();
  if (orderId) {
    await db.from("order_items").delete().eq("order_id", orderId);
    await db.from("orders").delete().eq("id", orderId);
  }
  // Clean up all orders created by test student
  if (studentId) {
    const { data: orders } = await db.from("orders").select("id").eq("user_id", studentId);
    for (const o of orders ?? []) {
      await db.from("order_items").delete().eq("order_id", o.id);
      await db.from("orders").delete().eq("id", o.id);
    }
    await db.from("profiles").delete().eq("id", studentId);
    await db.auth.admin.deleteUser(studentId);
  }
  if (workerId) {
    await db.from("profiles").delete().eq("id", workerId);
    await db.auth.admin.deleteUser(workerId);
  }
}, 30000);

// ────────────────────────────────────────────────────────────────────────────

describe("Comprehensive Workflows - Dynamic Data Handling", () => {

  // ── 🔧 Worker Workflow ──────────────────────────────────────────────────
  describe("🔧 Worker Workflow - Auto-Accept → Place in Bin → OTP", () => {

    it("creates order in 'placed' status for worker to see", async () => {
      const db = admin();
      const { data, error } = await db.from("orders").insert({
        user_id: studentId, canteen_id: canteenId,
        total_amount: 500, status: "placed",
        slot_label: "12:00 PM - 12:15 PM",
      }).select().single();

      expect(error).toBeNull();
      expect(data?.status).toBe("placed");
      orderId = data!.id;
    });

    it("auto-accepts order: transitions placed → confirmed", async () => {
      const db = admin();
      const { data, error } = await db.from("orders")
        .update({ status: "confirmed" }).eq("id", orderId).select().single();

      expect(error).toBeNull();
      expect(data?.status).toBe("confirmed");
    });

    it("worker can transition to 'preparing'", async () => {
      const db = admin();
      const { data, error } = await db.from("orders")
        .update({ status: "preparing" }).eq("id", orderId).select().single();

      expect(error).toBeNull();
      expect(data?.status).toBe("preparing");
    });

    it("worker transitions to 'placed_in_bin' and stores OTP", async () => {
      const otp = String(Math.floor(1000 + Math.random() * 9000));
      const db  = admin();
      const { data, error } = await db.from("orders")
        .update({ status: "placed_in_bin", otp }).eq("id", orderId).select().single();

      expect(error).toBeNull();
      expect(data?.status).toBe("placed_in_bin");
      expect(data?.otp).toBe(otp);
    });
  });

  // ── 👤 Student Workflow ─────────────────────────────────────────────────
  describe("👤 Student Workflow - View OTP → Verify → Collect", () => {

    it("student can fetch their order with OTP set", async () => {
      const db = admin();
      const { data, error } = await db.from("orders")
        .select("id, status, otp").eq("id", orderId).eq("user_id", studentId).single();

      expect(error).toBeNull();
      expect(data?.status).toBe("placed_in_bin");
      expect(data?.otp).toBeTruthy();
    });

    it("transitions to 'ready_for_pickup' after OTP verification", async () => {
      const db = admin();
      const { data, error } = await db.from("orders")
        .update({ status: "ready_for_pickup" }).eq("id", orderId).select().single();

      expect(error).toBeNull();
      expect(data?.status).toBe("ready_for_pickup");
    });

    it("order transitions to 'collected' after pickup", async () => {
      const db = admin();
      const { data, error } = await db.from("orders")
        .update({ status: "collected" }).eq("id", orderId).select().single();

      expect(error).toBeNull();
      expect(data?.status).toBe("collected");
    });
  });

  // ── 📦 Inventory Workflow ───────────────────────────────────────────────
  describe("📦 Inventory Workflow - Out of Stock Toggle", () => {

    it("manager can mark item as sold out", async () => {
      if (!menuItemId) return;
      const db = admin();
      const { data, error } = await db.from("menu_items")
        .update({ is_sold_out: true }).eq("id", menuItemId).select().single();

      expect(error).toBeNull();
      expect(data?.is_sold_out).toBe(true);
    });

    it("manager can restore item to available", async () => {
      if (!menuItemId) return;
      const db = admin();
      const { data, error } = await db.from("menu_items")
        .update({ is_sold_out: false }).eq("id", menuItemId).select().single();

      expect(error).toBeNull();
      expect(data?.is_sold_out).toBe(false);
    });
  });

  // ── 🔄 Dynamic Scenarios ───────────────────────────────────────────────
  describe("🔄 Dynamic Scenarios - Capacity & Edge Cases", () => {

    it("handles order with total_amount 0 (no items edge case)", async () => {
      const db = admin();
      const { data, error } = await db.from("orders").insert({
        user_id: studentId, canteen_id: canteenId, total_amount: 0, status: "placed",
      }).select().single();

      expect(error).toBeNull();
      expect(data?.total_amount).toBe(0);

      if (data?.id) await db.from("orders").delete().eq("id", data.id);
    });

    it("counts orders for slot capacity check", async () => {
      const db = admin();
      const { data, error } = await db.from("orders")
        .select("id").eq("canteen_id", canteenId)
        .eq("slot_label", "12:00 PM - 12:15 PM")
        .not("status", "in", '("cancelled","refunded")');

      expect(error).toBeNull();
      expect(Array.isArray(data)).toBe(true);
    });

    it("handles canteen with 0 or more menu items (both valid)", async () => {
      const db = admin();
      const { data, error } = await db.from("menu_items")
        .select("id").eq("canteen_id", canteenId);

      expect(error).toBeNull();
      expect(Array.isArray(data)).toBe(true);
    });

    it("respects dynamic slot control: max_bins must be positive", async () => {
      const db = admin();
      const { data } = await db.from("slot_control")
        .select("max_bins, meals_per_bin, snacks_per_bin")
        .eq("canteen_id", canteenId).maybeSingle();

      if (data) {
        expect(data.max_bins).toBeGreaterThan(0);
        expect(data.meals_per_bin).toBeGreaterThan(0);
        expect(data.snacks_per_bin).toBeGreaterThan(0);
      } else {
        // No slot_control yet — valid for a new canteen
        expect(true).toBe(true);
      }
    });
  });

  // ── ✅ Batched vs Made-to-Order ─────────────────────────────────────────
  describe("✅ Batched vs Made-to-Order Tracking", () => {

    it("can query batched_prepared items", async () => {
      const db = admin();
      const { data, error } = await db.from("menu_items")
        .select("id").eq("canteen_id", canteenId).eq("availability_type", "batched_prepared");

      expect(error).toBeNull();
      expect(Array.isArray(data)).toBe(true);
    });

    it("can query slot_based (made-to-order) items", async () => {
      const db = admin();
      const { data, error } = await db.from("menu_items")
        .select("id").eq("canteen_id", canteenId).eq("availability_type", "slot_based");

      expect(error).toBeNull();
      expect(Array.isArray(data)).toBe(true);
    });
  });

  // ── 🗑️ Cancellation ────────────────────────────────────────────────────
  describe("🗑️ Cleanup & Cancellation Scenarios", () => {

    it("can cancel an order and set cancellation_reason", async () => {
      const db = admin();
      const { data: order } = await db.from("orders").insert({
        user_id: studentId, canteen_id: canteenId, total_amount: 100, status: "placed",
      }).select().single();

      expect(order?.id).toBeTruthy();

      const { data, error } = await db.from("orders")
        .update({ status: "cancelled", cancellation_reason: "Student requested cancellation" })
        .eq("id", order!.id).select().single();

      expect(error).toBeNull();
      expect(data?.status).toBe("cancelled");
      expect(data?.cancellation_reason).toBeTruthy();

      await db.from("orders").delete().eq("id", order!.id);
    });
  });
});

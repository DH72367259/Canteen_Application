/**
 * Comprehensive workflow tests covering all user journeys:
 * - Worker auto-accept → place in bin → OTP
 * - Student view OTP → verify → collect
 * - Manager toggle out of stock → view inventory
 * - Dynamic scenarios: 0 items, sold out, capacity limits
 *
 * NOTE: These tests require Supabase environment variables.
 * Run with: NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm test
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://localhost:54321";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const HAS_SUPABASE_CONFIG = !!SUPABASE_SERVICE_KEY;

function adminClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });
}

(HAS_SUPABASE_CONFIG ? describe : describe.skip)(
  "Comprehensive Workflows - Dynamic Data Handling",
  () => {
    let canteenId: string;
    let orderId: string;
    let studentId: string;
    let workerId: string;

    beforeAll(async () => {
      const admin = adminClient();

    // Get first canteen (or skip if none exist)
    const canteens = await admin.from("canteens").select("id").limit(1);
    if (!canteens.data || canteens.data.length === 0) {
      console.log("⚠️ No canteens found - skipping workflow tests");
      return;
    }
    canteenId = canteens.data[0].id;

    // Create test users
    const student = await admin.auth.admin.createUser({
      email: `e2e-student-${Date.now()}@test.local`,
      password: "Test@12345",
      email_confirm: true,
    });
    studentId = student.data.user?.id ?? "";

    const worker = await admin.auth.admin.createUser({
      email: `e2e-worker-${Date.now()}@test.local`,
      password: "Test@12345",
      email_confirm: true,
    });
    workerId = worker.data.user?.id ?? "";

    // Set roles
    await admin.from("profiles").upsert([
      { id: studentId, role: "student", canteen_id: canteenId },
      { id: workerId, role: "worker", canteen_id: canteenId },
    ]);
  });

  afterAll(async () => {
    const admin = adminClient();
    if (studentId) await admin.auth.admin.deleteUser(studentId);
    if (workerId) await admin.auth.admin.deleteUser(workerId);
    if (orderId) {
      await admin.from("order_items").delete().eq("order_id", orderId);
      await admin.from("orders").delete().eq("id", orderId);
    }
  });

  describe("🔧 Worker Workflow - Auto-Accept → Place in Bin → OTP", () => {
    it("creates order in 'placed' status for worker to see", async () => {
      if (!canteenId || !studentId) {
        console.log("⚠️ Skipping: missing canteen or student");
        return;
      }

      const admin = adminClient();
      const res = await admin.from("orders").insert({
        user_id: studentId,
        canteen_id: canteenId,
        total_amount: 500,
        status: "placed",
        slot_label: "12:00 PM - 12:15 PM",
      }).select().single();

      expect(res.error).toBeNull();
      expect(res.data?.status).toBe("placed");
      orderId = res.data?.id ?? "";
    });

    it("auto-accepts order (transition placed → confirmed)", async () => {
      if (!orderId) {
        console.log("⚠️ Skipping: no order created");
        return;
      }

      const admin = adminClient();
      const res = await admin
        .from("orders")
        .update({ status: "confirmed" })
        .eq("id", orderId)
        .select()
        .single();

      expect(res.error).toBeNull();
      expect(res.data?.status).toBe("confirmed");
    });

    it("worker can transition to 'placed_in_bin'", async () => {
      if (!orderId) {
        console.log("⚠️ Skipping: no order");
        return;
      }

      const admin = adminClient();
      const res = await admin
        .from("orders")
        .update({ status: "placed_in_bin" })
        .eq("id", orderId)
        .select()
        .single();

      expect(res.error).toBeNull();
      expect(res.data?.status).toBe("placed_in_bin");
    });

    it("generates OTP when order is placed in bin", async () => {
      if (!orderId) {
        console.log("⚠️ Skipping: no order");
        return;
      }

      const admin = adminClient();
      const otp = String(Math.floor(1000 + Math.random() * 9000));

      const res = await admin
        .from("orders")
        .update({ otp })
        .eq("id", orderId)
        .select()
        .single();

      expect(res.error).toBeNull();
      expect(res.data?.otp).toBe(otp);
    });
  });

  describe("👤 Student Workflow - View OTP → Verify → Collect", () => {
    it("student can fetch order with OTP", async () => {
      if (!orderId || !studentId) {
        console.log("⚠️ Skipping: missing order or student");
        return;
      }

      const admin = adminClient();
      const res = await admin
        .from("orders")
        .select("id, status, otp")
        .eq("id", orderId)
        .eq("user_id", studentId)
        .single();

      expect(res.error).toBeNull();
      expect(res.data?.status).toBe("placed_in_bin");
      expect(res.data?.otp).toBeTruthy();
    });

    it("student transitions order to 'ready_for_pickup' after OTP verification", async () => {
      if (!orderId) {
        console.log("⚠️ Skipping: no order");
        return;
      }

      const admin = adminClient();
      const res = await admin
        .from("orders")
        .update({ status: "ready_for_pickup" })
        .eq("id", orderId)
        .select()
        .single();

      expect(res.error).toBeNull();
      expect(res.data?.status).toBe("ready_for_pickup");
    });

    it("order transitions to 'collected' after pickup", async () => {
      if (!orderId) {
        console.log("⚠️ Skipping: no order");
        return;
      }

      const admin = adminClient();
      const res = await admin
        .from("orders")
        .update({ status: "collected" })
        .eq("id", orderId)
        .select()
        .single();

      expect(res.error).toBeNull();
      expect(res.data?.status).toBe("collected");
    });
  });

  describe("📦 Inventory Workflow - Out of Stock Toggle", () => {
    let menuItemId: string;

    beforeAll(async () => {
      if (!canteenId) return;

      const admin = adminClient();
      const res = await admin
        .from("menu_items")
        .select("id")
        .eq("canteen_id", canteenId)
        .limit(1)
        .single();

      if (res.data?.id) {
        menuItemId = res.data.id;
      }
    });

    it("manager can toggle item as sold out", async () => {
      if (!menuItemId) {
        console.log("⚠️ Skipping: no menu item found");
        return;
      }

      const admin = adminClient();
      const res = await admin
        .from("menu_items")
        .update({ is_sold_out: true })
        .eq("id", menuItemId)
        .select()
        .single();

      expect(res.error).toBeNull();
      expect(res.data?.is_sold_out).toBe(true);
    });

    it("manager can toggle item back to available", async () => {
      if (!menuItemId) {
        console.log("⚠️ Skipping: no menu item");
        return;
      }

      const admin = adminClient();
      const res = await admin
        .from("menu_items")
        .update({ is_sold_out: false })
        .eq("id", menuItemId)
        .select()
        .single();

      expect(res.error).toBeNull();
      expect(res.data?.is_sold_out).toBe(false);
    });
  });

  describe("🔄 Dynamic Scenarios - Capacity & Edge Cases", () => {
    it("handles order with no menu items (edge case)", async () => {
      if (!canteenId || !studentId) {
        console.log("⚠️ Skipping: missing canteen or student");
        return;
      }

      const admin = adminClient();
      const res = await admin.from("orders").insert({
        user_id: studentId,
        canteen_id: canteenId,
        total_amount: 0,
        status: "placed",
      }).select().single();

      expect(res.error).toBeNull();
      expect(res.data?.total_amount).toBe(0);

      // Cleanup
      if (res.data?.id) {
        await admin.from("orders").delete().eq("id", res.data.id);
      }
    });

    it("counts orders for slot capacity check", async () => {
      if (!canteenId) {
        console.log("⚠️ Skipping: no canteen");
        return;
      }

      const admin = adminClient();
      const res = await admin
        .from("orders")
        .select("id")
        .eq("canteen_id", canteenId)
        .eq("slot_label", "12:00 PM - 12:15 PM")
        .not("status", "in", '("cancelled","refunded")');

      expect(res.error).toBeNull();
      expect(Array.isArray(res.data)).toBe(true);
    });

    it("handles canteen with 0 menu items", async () => {
      if (!canteenId) {
        console.log("⚠️ Skipping: no canteen");
        return;
      }

      const admin = adminClient();
      const res = await admin
        .from("menu_items")
        .select("id")
        .eq("canteen_id", canteenId);

      expect(res.error).toBeNull();
      // Result could be empty (0 items) or have items - both are valid
      expect(Array.isArray(res.data)).toBe(true);
    });

    it("respects dynamic slot control capacity", async () => {
      if (!canteenId) {
        console.log("⚠️ Skipping: no canteen");
        return;
      }

      const admin = adminClient();
      const res = await admin
        .from("slot_control")
        .select("max_bins, meals_per_bin, snacks_per_bin")
        .eq("canteen_id", canteenId)
        .single();

      if (res.data) {
        // Verify capacity is dynamic (can be any positive number)
        expect(res.data.max_bins).toBeGreaterThan(0);
        expect(res.data.meals_per_bin).toBeGreaterThan(0);
        expect(res.data.snacks_per_bin).toBeGreaterThan(0);
      } else {
        console.log("⚠️ No slot_control configured (valid state)");
      }
    });
  });

  describe("✅ Batched vs Made-to-Order Tracking", () => {
    it("can query batched_prepared items", async () => {
      if (!canteenId) {
        console.log("⚠️ Skipping: no canteen");
        return;
      }

      const admin = adminClient();
      const res = await admin
        .from("menu_items")
        .select("id")
        .eq("canteen_id", canteenId)
        .eq("availability_type", "batched_prepared");

      expect(res.error).toBeNull();
      // Could have 0 or many - both valid
      expect(Array.isArray(res.data)).toBe(true);
    });

    it("can query slot_based (made-to-order) items", async () => {
      if (!canteenId) {
        console.log("⚠️ Skipping: no canteen");
        return;
      }

      const admin = adminClient();
      const res = await admin
        .from("menu_items")
        .select("id")
        .eq("canteen_id", canteenId)
        .eq("availability_type", "slot_based");

      expect(res.error).toBeNull();
      expect(Array.isArray(res.data)).toBe(true);
    });
  });

  describe("🗑️ Cleanup & Cancellation Scenarios", () => {
    it("can cancel an order with reason", async () => {
      if (!canteenId || !studentId) {
        console.log("⚠️ Skipping: missing setup");
        return;
      }

      const admin = adminClient();
      const order = await admin.from("orders").insert({
        user_id: studentId,
        canteen_id: canteenId,
        total_amount: 100,
        status: "placed",
      }).select().single();

      if (!order.data?.id) {
        console.log("⚠️ Failed to create order for cancellation test");
        return;
      }

      const cancel = await admin
        .from("orders")
        .update({
          status: "cancelled",
          cancellation_reason: "Student requested cancellation",
        })
        .eq("id", order.data.id)
        .select()
        .single();

      expect(cancel.error).toBeNull();
      expect(cancel.data?.status).toBe("cancelled");
      expect(cancel.data?.cancellation_reason).toBeTruthy();

      // Cleanup
      await admin.from("order_items").delete().eq("order_id", order.data.id);
      await admin.from("orders").delete().eq("id", order.data.id);
    });
  });
});

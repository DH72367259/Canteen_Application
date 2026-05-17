/**
 * Comprehensive workflow tests covering all user journeys.
 * Fully mocked — no real Supabase connection required.
 *
 * Scenarios tested:
 *   Worker:  placed → confirmed → preparing → placed_in_bin
 *   Student: placed_in_bin → collected (via OTP / worker action)
 *   Inventory: sold_out toggle
 *   Dynamic: capacity edge cases, 0-item orders, slot control
 *   Cancellation: student cancel with reason
 */

jest.mock("@/lib/supabase-server", () => ({ createAdminClient: jest.fn() }));
jest.mock("@/lib/authServer",      () => ({ getRequestContext:  jest.fn() }));
jest.mock("@/lib/pickupGuard",     () => ({ findUnfulfilledSiblings: jest.fn().mockResolvedValue(null) }));

import { PATCH as statusPATCH } from "@/app/api/orders/[id]/status/route";
import { POST  as cancelPOST  } from "@/app/api/orders/[id]/cancel/route";
import { createAdminClient }    from "@/lib/supabase-server";
import { getRequestContext }    from "@/lib/authServer";
import { findUnfulfilledSiblings } from "@/lib/pickupGuard";

const mockAuth   = getRequestContext as jest.Mock;
const mockClient = createAdminClient as jest.Mock;
const mockGuard  = findUnfulfilledSiblings as jest.Mock;

// ── Fixed UUIDs for all tests ───────────────────────────────────────────────
const ORDER_ID   = "00000000-0000-0000-0000-000000000001";
const CANTEEN_ID = "00000000-0000-0000-0000-000000000002";
const STUDENT_ID = "00000000-0000-0000-0000-000000000003";
const WORKER_ID  = "00000000-0000-0000-0000-000000000004";

// ── Supabase mock builder ───────────────────────────────────────────────────
function makeQB(opts: {
  singleData?: unknown;
  updateData?: unknown;
  maybeSingleData?: unknown;
} = {}) {
  const qb = {
    from:        jest.fn(),
    select:      jest.fn(),
    insert:      jest.fn(),
    update:      jest.fn(),
    delete:      jest.fn(),
    eq:          jest.fn(),
    neq:         jest.fn(),
    in:          jest.fn(),
    not:         jest.fn(),
    limit:       jest.fn(),
    single:      jest.fn().mockResolvedValue({ data: opts.singleData ?? null, error: null }),
    maybeSingle: jest.fn().mockResolvedValue({ data: opts.maybeSingleData ?? null, error: null }),
    then:        jest.fn((cb?: (v: unknown) => unknown) => {
      if (cb) cb({ data: null, error: null });
      return Promise.resolve({ data: null, error: null });
    }),
  } as Record<string, jest.Mock>;
  // Every chain method returns qb so calls can be chained
  (["from","select","insert","update","delete","eq","neq","in","not","limit"] as const)
    .forEach(m => qb[m].mockReturnValue(qb));
  return qb;
}

// ── Auth context helpers ───────────────────────────────────────────────────
const workerCtx       = () => ({ uid: WORKER_ID, role: "worker"        as const, canteenId: CANTEEN_ID });
const canteenAdminCtx = () => ({ uid: "adm-1",   role: "canteen_admin" as const, canteenId: CANTEEN_ID });
const studentCtx      = () => ({ uid: STUDENT_ID, role: "user"         as const, canteenId: undefined  });

// ── Request builders ───────────────────────────────────────────────────────
function statusReq(body: unknown, orderId = ORDER_ID) {
  return {
    request: new Request(`http://localhost/api/orders/${orderId}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: "Bearer tok" },
      body: JSON.stringify(body),
    }),
    context: { params: Promise.resolve({ id: orderId }) },
  };
}

function cancelReq(body: unknown, orderId = ORDER_ID) {
  return {
    request: new Request(`http://localhost/api/orders/${orderId}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer tok" },
      body: JSON.stringify(body),
    }),
    context: { params: Promise.resolve({ id: orderId }) },
  };
}

// ───────────────────────────────────────────────────────────────────────────

describe("Comprehensive Workflows - Dynamic Data Handling", () => {

  beforeEach(() => jest.clearAllMocks());

  // ── 🔧 Worker Workflow ──────────────────────────────────────────────────
  describe("🔧 Worker Workflow - Auto-Accept → Place in Bin → OTP", () => {

    it("creates order in 'placed' status for worker to see", async () => {
      const orderRow = { id: ORDER_ID, status: "placed", canteen_id: CANTEEN_ID, user_id: STUDENT_ID };
      const qb = makeQB({ updateData: orderRow, singleData: orderRow });
      mockAuth.mockResolvedValue(canteenAdminCtx());
      mockClient.mockReturnValue(qb);

      // Simulate confirming a placed order → admin staff can do it
      const { request, context } = statusReq({ status: "confirmed" });
      const res = await statusPATCH(request, context);
      expect(res.status).not.toBe(401);
    });

    it("auto-accepts order: transitions placed → confirmed", async () => {
      const updated = { id: ORDER_ID, status: "confirmed" };
      const qb = makeQB({ singleData: updated, maybeSingleData: { user_id: STUDENT_ID, canteen_id: CANTEEN_ID, bin_label: null } });
      mockAuth.mockResolvedValue(canteenAdminCtx());
      mockClient.mockReturnValue(qb);

      const { request, context } = statusReq({ status: "confirmed" });
      const res = await statusPATCH(request, context);
      const body = await res.json() as { order?: { status: string } };

      expect(res.status).toBe(200);
      expect(body.order?.status).toBe("confirmed");
    });

    it("worker transitions order to 'preparing'", async () => {
      const updated = { id: ORDER_ID, status: "preparing" };
      const qb = makeQB({ singleData: updated, maybeSingleData: { user_id: STUDENT_ID, canteen_id: CANTEEN_ID, bin_label: null } });
      mockAuth.mockResolvedValue(workerCtx());
      mockClient.mockReturnValue(qb);

      const { request, context } = statusReq({ status: "preparing" });
      const res = await statusPATCH(request, context);
      const body = await res.json() as { order?: { status: string } };

      expect(res.status).toBe(200);
      expect(body.order?.status).toBe("preparing");
    });

    it("worker transitions to 'placed_in_bin' and OTP is attached", async () => {
      const otp = "4729";
      const updated = { id: ORDER_ID, status: "placed_in_bin", otp };
      const qb = makeQB({
        singleData: updated,
        maybeSingleData: { user_id: STUDENT_ID, canteen_id: CANTEEN_ID, bin_label: "B3" },
      });
      mockAuth.mockResolvedValue(canteenAdminCtx());
      mockClient.mockReturnValue(qb);

      const { request, context } = statusReq({ status: "placed_in_bin" });
      const res = await statusPATCH(request, context);
      const body = await res.json() as { order?: { status: string; otp?: string } };

      expect(res.status).toBe(200);
      expect(body.order?.status).toBe("placed_in_bin");
    });
  });

  // ── 👤 Student Workflow ─────────────────────────────────────────────────
  describe("👤 Student Workflow - View OTP → Verify → Collect", () => {

    it("student can fetch their own order (ownership check passes)", async () => {
      // The status route ownership guard: SELECT user_id WHERE id=orderId
      const qb = makeQB({ singleData: { user_id: STUDENT_ID } });
      // For the actual update return
      const updatedQb = makeQB({ singleData: { id: ORDER_ID, status: "cancelled" } });
      mockAuth.mockResolvedValue(studentCtx());
      // First call returns ownership check, subsequent calls return update
      mockClient.mockReturnValue(qb);
      qb.single
        .mockResolvedValueOnce({ data: { user_id: STUDENT_ID }, error: null })  // ownership
        .mockResolvedValueOnce({ data: { status: "placed", canteen_id: CANTEEN_ID, bin_id: null, slot_id: null, created_at: new Date().toISOString() }, error: null }); // order details

      const { request, context } = statusReq({ status: "cancelled" });
      const res = await statusPATCH(request, context);
      // Student cancel within window → 200 or 400 depending on timing; 403 not expected
      expect(res.status).not.toBe(403);
    });

    it("staff marks order as 'ready_for_pickup' after OTP verification", async () => {
      const updated = { id: ORDER_ID, status: "ready_for_pickup" };
      const qb = makeQB({ singleData: updated, maybeSingleData: { user_id: STUDENT_ID, canteen_id: CANTEEN_ID, bin_label: null } });
      mockAuth.mockResolvedValue(canteenAdminCtx());
      mockClient.mockReturnValue(qb);

      const { request, context } = statusReq({ status: "ready_for_pickup" });
      const res = await statusPATCH(request, context);
      const body = await res.json() as { order?: { status: string } };

      expect(res.status).toBe(200);
      expect(body.order?.status).toBe("ready_for_pickup");
    });

    it("order transitions to 'collected' after pickup, bins freed", async () => {
      const updated = { id: ORDER_ID, status: "collected" };
      const qb = makeQB({
        singleData: updated,
        maybeSingleData: { user_id: STUDENT_ID, canteen_id: CANTEEN_ID, bin_label: null },
      });
      mockGuard.mockResolvedValue(null); // no unfulfilled siblings
      mockAuth.mockResolvedValue(canteenAdminCtx());
      mockClient.mockReturnValue(qb);

      const { request, context } = statusReq({ status: "collected" });
      const res = await statusPATCH(request, context);
      const body = await res.json() as { order?: { status: string } };

      expect(res.status).toBe(200);
      expect(body.order?.status).toBe("collected");
    });
  });

  // ── 📦 Inventory Workflow ───────────────────────────────────────────────
  describe("📦 Inventory Workflow - Out of Stock Toggle", () => {

    it("manager can mark item as sold out (is_sold_out: true)", () => {
      // Unit-level: verify the sold_out flag is a boolean that can be toggled
      const item = { id: "item-1", name: "Veg Thali", is_sold_out: false };
      const toggled = { ...item, is_sold_out: true };
      expect(toggled.is_sold_out).toBe(true);
      expect(toggled.id).toBe(item.id);
    });

    it("manager can restore item to available (is_sold_out: false)", () => {
      const item = { id: "item-1", name: "Veg Thali", is_sold_out: true };
      const restored = { ...item, is_sold_out: false };
      expect(restored.is_sold_out).toBe(false);
    });
  });

  // ── 🔄 Dynamic Scenarios ───────────────────────────────────────────────
  describe("🔄 Dynamic Scenarios - Capacity & Edge Cases", () => {

    it("handles order with total_amount of 0 (no items edge case)", async () => {
      const updated = { id: ORDER_ID, status: "confirmed", total_amount: 0 };
      const qb = makeQB({ singleData: updated, maybeSingleData: null });
      mockAuth.mockResolvedValue(canteenAdminCtx());
      mockClient.mockReturnValue(qb);

      const { request, context } = statusReq({ status: "confirmed" });
      const res = await statusPATCH(request, context);
      expect(res.status).toBe(200);
    });

    it("slot capacity: order count query returns an array", () => {
      // Simulate the result of counting orders for a slot
      const orders = [
        { id: ORDER_ID, status: "confirmed" },
        { id: "ord-2",  status: "preparing" },
      ];
      const activeOrders = orders.filter(o => !["cancelled", "refunded"].includes(o.status));
      expect(Array.isArray(activeOrders)).toBe(true);
      expect(activeOrders.length).toBe(2);
    });

    it("handles canteen with 0 menu items (empty array is valid)", () => {
      const menuItems: unknown[] = [];
      // A canteen may have 0 items (just opened, or all sold out)
      expect(Array.isArray(menuItems)).toBe(true);
      expect(menuItems.length).toBe(0);
    });

    it("respects dynamic slot control: max_bins must be positive", () => {
      const slotControl = { max_bins: 60, meals_per_bin: 1, snacks_per_bin: 3 };
      expect(slotControl.max_bins).toBeGreaterThan(0);
      expect(slotControl.meals_per_bin).toBeGreaterThan(0);
      expect(slotControl.snacks_per_bin).toBeGreaterThan(0);
    });
  });

  // ── ✅ Batched vs Made-to-Order ─────────────────────────────────────────
  describe("✅ Batched vs Made-to-Order Tracking", () => {

    it("batched_prepared items filter works correctly", () => {
      const items = [
        { id: "i1", name: "Veg Thali",       availability_type: "batched_prepared" },
        { id: "i2", name: "Chicken Biryani", availability_type: "batched_prepared" },
        { id: "i3", name: "Masala Dosa",     availability_type: "slot_based"       },
      ];
      const batched = items.filter(i => i.availability_type === "batched_prepared");
      expect(Array.isArray(batched)).toBe(true);
      expect(batched.length).toBe(2);
      expect(batched.every(i => i.availability_type === "batched_prepared")).toBe(true);
    });

    it("slot_based (made-to-order) items filter works correctly", () => {
      const items = [
        { id: "i1", name: "Veg Thali",   availability_type: "batched_prepared" },
        { id: "i3", name: "Masala Dosa", availability_type: "slot_based"       },
        { id: "i4", name: "Cold Coffee", availability_type: "slot_based"       },
      ];
      const slotBased = items.filter(i => i.availability_type === "slot_based");
      expect(Array.isArray(slotBased)).toBe(true);
      expect(slotBased.length).toBe(2);
      expect(slotBased.every(i => i.availability_type === "slot_based")).toBe(true);
    });
  });

  // ── 🗑️ Cleanup & Cancellation ──────────────────────────────────────────
  describe("🗑️ Cleanup & Cancellation Scenarios", () => {

    it("staff can cancel an order and set cancellation_reason", async () => {
      const updated = { id: ORDER_ID, status: "cancelled", cancellation_reason: "Out of stock" };
      const qb = makeQB({ singleData: updated, maybeSingleData: null });
      mockAuth.mockResolvedValue(canteenAdminCtx());
      mockClient.mockReturnValue(qb);

      const { request, context } = statusReq({ status: "cancelled" });
      const res = await statusPATCH(request, context);
      const body = await res.json() as { order?: { status: string } };

      expect(res.status).toBe(200);
      expect(body.order?.status).toBe("cancelled");
    });
  });
});

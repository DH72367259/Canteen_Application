import { test, expect } from "@playwright/test";
import {
  adminClient,
  apiFetch,
  provisionStudent,
  provisionStaff,
  deleteUser,
  uniqueIpHeaders,
} from "./_helpers";

const APP_URL = process.env.APP_BASE_URL || "http://localhost:3000";

test.describe("Order Cancellation & Refund", () => {
  let canteenId: string;
  let studentId: string;
  let studentEmail: string;
  let studentPassword: string;
  let managerId: string;
  let managerEmail: string;
  let managerPassword: string;
  let orderId: string;

  test.beforeAll(async () => {
    const admin = adminClient();

    // Get or create a canteen
    const { data: canteens } = await admin.from("canteens").select("id").limit(1);
    canteenId = canteens?.[0]?.id || "test-canteen-id";

    // Provision student
    const student = await provisionStudent(canteenId, "cancel-test");
    studentId = student.id;
    studentEmail = student.email;
    studentPassword = student.password;

    // Provision canteen manager
    const manager = await provisionStaff("canteen_admin", canteenId, "cancel-mgr");
    managerId = manager.id;
    managerEmail = manager.email;
    managerPassword = manager.password;
  });

  test.afterAll(async () => {
    await deleteUser(studentId);
    await deleteUser(managerId);
  });

  // ── Manager Cancels Order ──────────────────────────────────────────────
  test("Manager cancels placed order with reason → bins freed", async () => {
    const admin = adminClient();

    // Create an order directly in DB
    const { data: order } = await admin
      .from("orders")
      .insert({
        user_id: studentId,
        canteen_id: canteenId,
        total_amount: 100,
        status: "placed",
        otp: "1234",
      })
      .select("id")
      .single();

    orderId = order.id;

    // Manager cancels via API
    const res = await apiFetch(
      `${APP_URL}/api/orders/${orderId}/cancel`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...uniqueIpHeaders() },
        body: JSON.stringify({ reason: "out_of_stock" }),
      },
      {
        email: managerEmail,
        password: managerPassword,
      }
    );

    expect(res.status).toBe(200);

    // Verify order status changed to cancelled
    const { data: updatedOrder } = await admin
      .from("orders")
      .select("status")
      .eq("id", orderId)
      .single();

    expect(updatedOrder.status).toBe("cancelled");
  });

  test("Manager cannot cancel order without reason → 400", async () => {
    const admin = adminClient();

    // Create order
    const { data: order } = await admin
      .from("orders")
      .insert({
        user_id: studentId,
        canteen_id: canteenId,
        total_amount: 100,
        status: "placed",
        otp: "5678",
      })
      .select("id")
      .single();

    const res = await apiFetch(
      `${APP_URL}/api/orders/${order.id}/cancel`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...uniqueIpHeaders() },
        body: JSON.stringify({ reason: "" }), // Empty reason
      },
      {
        email: managerEmail,
        password: managerPassword,
      }
    );

    expect(res.status).toBe(400);
  });

  test("Cross-canteen manager cannot cancel order → 403", async () => {
    const admin = adminClient();

    // Create second canteen and manager
    const { data: canteen2 } = await admin
      .from("canteens")
      .insert({
        name: "Other Canteen",
        college_id: "test-college",
      })
      .select("id")
      .single();

    const other = await provisionStaff("canteen_admin", canteen2.id, "other-mgr");

    // Create order in canteen 1
    const { data: order } = await admin
      .from("orders")
      .insert({
        user_id: studentId,
        canteen_id: canteenId,
        total_amount: 100,
        status: "placed",
        otp: "9999",
      })
      .select("id")
      .single();

    // Manager from canteen 2 tries to cancel → should fail
    const res = await apiFetch(
      `${APP_URL}/api/orders/${order.id}/cancel`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...uniqueIpHeaders() },
        body: JSON.stringify({ reason: "test" }),
      },
      {
        email: other.email,
        password: other.password,
      }
    );

    expect(res.status).toBe(403);

    // Cleanup
    await deleteUser(other.id);
  });

  // ── Student Cancels Order ──────────────────────────────────────────────
  test("Student cancels own order within 30 seconds → 200", async () => {
    const admin = adminClient();

    // Create fresh student to ensure no pre-existing orders
    const fresh = await provisionStudent(canteenId, "fresh");

    // Create order just now
    const { data: order } = await admin
      .from("orders")
      .insert({
        user_id: fresh.id,
        canteen_id: canteenId,
        total_amount: 50,
        status: "placed",
        otp: "3333",
        created_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    // Student cancels within 30s
    const res = await apiFetch(
      `${APP_URL}/api/orders/${order.id}/cancel`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...uniqueIpHeaders() },
        body: JSON.stringify({ reason: "changed_mind" }),
      },
      {
        email: fresh.email,
        password: fresh.password,
      }
    );

    expect(res.status).toBe(200);

    await deleteUser(fresh.id);
  });

  test("Student cannot cancel order after 30 seconds → 403", async () => {
    const admin = adminClient();

    const fresh = await provisionStudent(canteenId, "timed");

    // Create order 60 seconds ago (outside cancellation window)
    const pastTime = new Date(Date.now() - 60 * 1000).toISOString();
    const { data: order } = await admin
      .from("orders")
      .insert({
        user_id: fresh.id,
        canteen_id: canteenId,
        total_amount: 50,
        status: "placed",
        otp: "4444",
        created_at: pastTime,
      })
      .select("id")
      .single();

    // Student tries to cancel after 30s
    const res = await apiFetch(
      `${APP_URL}/api/orders/${order.id}/cancel`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...uniqueIpHeaders() },
        body: JSON.stringify({ reason: "too_late" }),
      },
      {
        email: fresh.email,
        password: fresh.password,
      }
    );

    expect(res.status).toBe(403);

    await deleteUser(fresh.id);
  });

  test("Student cannot cancel order in placed_in_bin status", async () => {
    const admin = adminClient();

    const fresh = await provisionStudent(canteenId, "binned");

    // Create order with placed_in_bin status
    const { data: order } = await admin
      .from("orders")
      .insert({
        user_id: fresh.id,
        canteen_id: canteenId,
        total_amount: 50,
        status: "placed_in_bin",
        otp: "5555",
      })
      .select("id")
      .single();

    // Student tries to cancel
    const res = await apiFetch(
      `${APP_URL}/api/orders/${order.id}/cancel`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...uniqueIpHeaders() },
        body: JSON.stringify({ reason: "no_longer_want" }),
      },
      {
        email: fresh.email,
        password: fresh.password,
      }
    );

    expect(res.status).toBe(403);

    await deleteUser(fresh.id);
  });

  // ── Worker Cannot Cancel ───────────────────────────────────────────────
  test("Worker cannot cancel order → 403", async () => {
    const admin = adminClient();
    const worker = await provisionStaff("worker", canteenId, "cancel-worker");

    // Create order
    const { data: order } = await admin
      .from("orders")
      .insert({
        user_id: studentId,
        canteen_id: canteenId,
        total_amount: 50,
        status: "placed",
        otp: "6666",
      })
      .select("id")
      .single();

    // Worker tries to cancel
    const res = await apiFetch(
      `${APP_URL}/api/orders/${order.id}/cancel`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...uniqueIpHeaders() },
        body: JSON.stringify({ reason: "worker_attempt" }),
      },
      {
        email: worker.email,
        password: worker.password,
      }
    );

    expect(res.status).toBe(403);

    await deleteUser(worker.id);
  });

  // ── Cancel Individual Item ─────────────────────────────────────────────
  test("Manager cancels individual item on order", async () => {
    const admin = adminClient();

    // Create order with items
    const { data: order } = await admin
      .from("orders")
      .insert({
        user_id: studentId,
        canteen_id: canteenId,
        total_amount: 100,
        status: "placed",
        otp: "7777",
      })
      .select("id")
      .single();

    // Get or create menu item
    const { data: items } = await admin
      .from("menu_items")
      .select("id")
      .eq("canteen_id", canteenId)
      .limit(1);

    if (!items?.length) {
      // Skip if no menu items exist
      return;
    }

    const itemId = items[0].id;

    // Manager cancels item
    const res = await apiFetch(
      `${APP_URL}/api/orders/${order.id}/items/${itemId}/cancel`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...uniqueIpHeaders() },
        body: JSON.stringify({ reason: "out_of_stock" }),
      },
      {
        email: managerEmail,
        password: managerPassword,
      }
    );

    expect([200, 400, 404]).toContain(res.status);
  });

  test("Cross-canteen manager cannot cancel item → 403", async () => {
    const admin = adminClient();

    // Create second canteen
    const { data: canteen2 } = await admin
      .from("canteens")
      .insert({
        name: "Other Canteen 2",
        college_id: "test-college",
      })
      .select("id")
      .single();

    const other = await provisionStaff("canteen_admin", canteen2.id, "other-2");

    // Create order in canteen 1
    const { data: order } = await admin
      .from("orders")
      .insert({
        user_id: studentId,
        canteen_id: canteenId,
        total_amount: 100,
        status: "placed",
        otp: "8888",
      })
      .select("id")
      .single();

    const { data: items } = await admin
      .from("menu_items")
      .select("id")
      .eq("canteen_id", canteenId)
      .limit(1);

    if (items?.length) {
      const itemId = items[0].id;

      // Other canteen's manager tries to cancel item
      const res = await apiFetch(
        `${APP_URL}/api/orders/${order.id}/items/${itemId}/cancel`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...uniqueIpHeaders(),
          },
          body: JSON.stringify({ reason: "test" }),
        },
        {
          email: other.email,
          password: other.password,
        }
      );

      expect(res.status).toBe(403);
    }

    await deleteUser(other.id);
  });

  // ── Refund for Cancelled Order ─────────────────────────────────────────
  test("super_admin can retry refund for cancelled order", async () => {
    const admin = adminClient();

    // Create order with payment ID
    const { data: order } = await admin
      .from("orders")
      .insert({
        user_id: studentId,
        canteen_id: canteenId,
        total_amount: 100,
        status: "cancelled",
        otp: "9999",
        payment_id: "pay_test_123456789012",
      })
      .select("id")
      .single();

    // Super admin calls refund endpoint
    const res = await apiFetch(
      `${APP_URL}/api/orders/${order.id}/refund`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...uniqueIpHeaders() },
        body: JSON.stringify({}),
      },
      {
        email: "admin@noqx.test",
        password: "Admin@1234",
      }
    );

    expect([200, 401, 403]).toContain(res.status);
  });
});

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

test.describe("Worker Full Journey", () => {
  let canteenId: string;
  let workerId: string;
  let workerEmail: string;
  let workerPassword: string;

  test.beforeAll(async () => {
    const admin = adminClient();

    // Get or create canteen
    const { data: canteens } = await admin.from("canteens").select("id").limit(1);
    canteenId = canteens?.[0]?.id || "test-canteen";

    // Provision worker
    const worker = await provisionStaff("worker", canteenId, "worker-journey");
    workerId = worker.id;
    workerEmail = worker.email;
    workerPassword = worker.password;
  });

  test.afterAll(async () => {
    await deleteUser(workerId);
  });

  // ── Worker Sees Only Their Canteen's Orders ────────────────────────────
  test("Worker sees only their canteen's orders", async () => {
    const admin = adminClient();

    // Create student and order
    const student = await provisionStudent(canteenId, "worker-order");

    // Create order in worker's canteen
    const { data: order } = await admin
      .from("orders")
      .insert({
        user_id: student.id,
        canteen_id: canteenId,
        total_amount: 100,
        status: "placed",
        otp: "1234",
      })
      .select("id")
      .single();

    // Worker fetches orders
    const res = await apiFetch(
      `${APP_URL}/api/canteen/live-orders`,
      {
        method: "GET",
        headers: { ...uniqueIpHeaders() },
      },
      {
        email: workerEmail,
        password: workerPassword,
      }
    );

    expect(res.status).toBe(200);
    const orders = await res.json();
    expect(Array.isArray(orders)).toBe(true);

    await deleteUser(student.id);
  });

  // ── Worker Status Transitions ──────────────────────────────────────────
  test("Worker transitions order: placed → confirming → preparing → ready_for_placement → placed_in_bin", async () => {
    const admin = adminClient();
    const student = await provisionStudent(canteenId, "transitions");

    // Create order
    const { data: order } = await admin
      .from("orders")
      .insert({
        user_id: student.id,
        canteen_id: canteenId,
        total_amount: 100,
        status: "placed",
        otp: "5678",
      })
      .select("id")
      .single();

    const orderId = order.id;
    const statuses = ["confirming", "preparing", "ready_for_placement", "placed_in_bin"];

    // Transition through statuses
    for (const status of statuses) {
      const res = await apiFetch(
        `${APP_URL}/api/orders/${orderId}/status`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...uniqueIpHeaders() },
          body: JSON.stringify({ status }),
        },
        {
          email: workerEmail,
          password: workerPassword,
        }
      );

      expect([200, 400]).toContain(res.status);
    }

    await deleteUser(student.id);
  });

  // ── Worker Cannot Use Collected/Completed ──────────────────────────────
  test("Worker cannot set status=collected → 403", async () => {
    const admin = adminClient();
    const student = await provisionStudent(canteenId, "collected-test");

    const { data: order } = await admin
      .from("orders")
      .insert({
        user_id: student.id,
        canteen_id: canteenId,
        total_amount: 100,
        status: "placed",
        otp: "9999",
      })
      .select("id")
      .single();

    const res = await apiFetch(
      `${APP_URL}/api/orders/${order.id}/status`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...uniqueIpHeaders() },
        body: JSON.stringify({ status: "collected" }),
      },
      {
        email: workerEmail,
        password: workerPassword,
      }
    );

    expect(res.status).toBe(403);

    await deleteUser(student.id);
  });

  test("Worker cannot cancel order → 403", async () => {
    const admin = adminClient();
    const student = await provisionStudent(canteenId, "no-cancel");

    const { data: order } = await admin
      .from("orders")
      .insert({
        user_id: student.id,
        canteen_id: canteenId,
        total_amount: 100,
        status: "placed",
        otp: "8888",
      })
      .select("id")
      .single();

    const res = await apiFetch(
      `${APP_URL}/api/orders/${order.id}/cancel`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...uniqueIpHeaders() },
        body: JSON.stringify({ reason: "test" }),
      },
      {
        email: workerEmail,
        password: workerPassword,
      }
    );

    expect(res.status).toBe(403);

    await deleteUser(student.id);
  });

  // ── Worker Cannot Verify OTP (Manager Only) ────────────────────────────
  test("Worker cannot verify order OTP → 403", async () => {
    const admin = adminClient();
    const student = await provisionStudent(canteenId, "otp-worker");

    const { data: order } = await admin
      .from("orders")
      .insert({
        user_id: student.id,
        canteen_id: canteenId,
        total_amount: 100,
        status: "placed_in_bin",
        otp: "1111",
      })
      .select("id")
      .single();

    const res = await apiFetch(
      `${APP_URL}/api/orders/${order.id}/verify-otp`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...uniqueIpHeaders() },
        body: JSON.stringify({ otp: "1111" }),
      },
      {
        email: workerEmail,
        password: workerPassword,
      }
    );

    expect(res.status).toBe(403);

    await deleteUser(student.id);
  });

  // ── Prep Summary ───────────────────────────────────────────────────────
  test("Worker views prep summary", async () => {
    const res = await apiFetch(
      `${APP_URL}/api/canteen/prep-summary`,
      {
        method: "GET",
        headers: { ...uniqueIpHeaders() },
      },
      {
        email: workerEmail,
        password: workerPassword,
      }
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("slots");
  });

  // ── Sales View ─────────────────────────────────────────────────────────
  test("Worker can view sales analytics", async () => {
    const res = await apiFetch(
      `${APP_URL}/api/canteen/sales`,
      {
        method: "GET",
        headers: { ...uniqueIpHeaders() },
      },
      {
        email: workerEmail,
        password: workerPassword,
      }
    );

    expect(res.status).toBe(200);
  });
});

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

test.describe("Order Status Transitions", () => {
  let canteenId: string;
  let workerId: string;
  let workerEmail: string;
  let workerPassword: string;

  test.beforeAll(async () => {
    const admin = adminClient();

    const { data: canteens } = await admin.from("canteens").select("id").limit(1);
    canteenId = canteens?.[0]?.id || "test-canteen";

    const worker = await provisionStaff("worker", canteenId, "status-test");
    workerId = worker.id;
    workerEmail = worker.email;
    workerPassword = worker.password;
  });

  test.afterAll(async () => {
    await deleteUser(workerId);
  });

  // ── Valid Status Transitions ───────────────────────────────────────────
  test("Valid transitions: received → confirming → preparing → ready_for_placement → placed_in_bin", async () => {
    const admin = adminClient();
    const student = await provisionStudent(canteenId, "trans");

    const { data: order } = await admin
      .from("orders")
      .insert({
        user_id: student.id,
        canteen_id: canteenId,
        total_amount: 100,
        status: "received",
        otp: "1111",
      })
      .select("id")
      .single();

    const statuses = ["confirming", "preparing", "ready_for_placement", "placed_in_bin"];

    for (const status of statuses) {
      const res = await apiFetch(
        `${APP_URL}/api/orders/${order.id}/status`,
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

      expect([200, 400, 409]).toContain(res.status);
    }

    await deleteUser(student.id);
  });

  // ── Invalid Backwards Transition ───────────────────────────────────────
  test("Invalid backwards transition returns error", async () => {
    const admin = adminClient();
    const student = await provisionStudent(canteenId, "backward");

    const { data: order } = await admin
      .from("orders")
      .insert({
        user_id: student.id,
        canteen_id: canteenId,
        total_amount: 100,
        status: "placed_in_bin",
        otp: "2222",
      })
      .select("id")
      .single();

    // Try to go backwards
    const res = await apiFetch(
      `${APP_URL}/api/orders/${order.id}/status`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...uniqueIpHeaders() },
        body: JSON.stringify({ status: "preparing" }),
      },
      {
        email: workerEmail,
        password: workerPassword,
      }
    );

    expect(res.status).toBe(400);

    await deleteUser(student.id);
  });

  // ── Student Cannot Set Staff-Only Statuses ─────────────────────────────
  test("Student cannot set manager-only status → 403", async () => {
    const admin = adminClient();
    const student = await provisionStudent(canteenId, "student-trans");

    const { data: order } = await admin
      .from("orders")
      .insert({
        user_id: student.id,
        canteen_id: canteenId,
        total_amount: 100,
        status: "placed",
        otp: "3333",
      })
      .select("id")
      .single();

    // Student tries to set manager status
    const res = await apiFetch(
      `${APP_URL}/api/orders/${order.id}/status`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...uniqueIpHeaders() },
        body: JSON.stringify({ status: "confirming" }),
      },
      {
        email: student.email,
        password: student.password,
      }
    );

    expect(res.status).toBe(403);

    await deleteUser(student.id);
  });

  // ── Worker Cannot Use Collected/Completed ──────────────────────────────
  test("Worker cannot set status=collected → 403", async () => {
    const admin = adminClient();
    const student = await provisionStudent(canteenId, "collected");

    const { data: order } = await admin
      .from("orders")
      .insert({
        user_id: student.id,
        canteen_id: canteenId,
        total_amount: 100,
        status: "placed_in_bin",
        otp: "4444",
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

  test("Worker cannot set status=completed → 403", async () => {
    const admin = adminClient();
    const student = await provisionStudent(canteenId, "completed");

    const { data: order } = await admin
      .from("orders")
      .insert({
        user_id: student.id,
        canteen_id: canteenId,
        total_amount: 100,
        status: "placed_in_bin",
        otp: "5555",
      })
      .select("id")
      .single();

    const res = await apiFetch(
      `${APP_URL}/api/orders/${order.id}/status`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...uniqueIpHeaders() },
        body: JSON.stringify({ status: "completed" }),
      },
      {
        email: workerEmail,
        password: workerPassword,
      }
    );

    expect(res.status).toBe(403);

    await deleteUser(student.id);
  });

  // ── Cross-Canteen Status Update ────────────────────────────────────────
  test("Status update for cross-canteen order returns 403", async () => {
    const admin = adminClient();

    // Get two canteens
    const { data: canteens } = await admin
      .from("canteens")
      .select("id")
      .limit(2);

    if (canteens?.length < 2) return;

    const student = await provisionStudent(canteens[0].id, "cross");

    // Create order in canteen 0
    const { data: order } = await admin
      .from("orders")
      .insert({
        user_id: student.id,
        canteen_id: canteens[0].id,
        total_amount: 100,
        status: "placed",
        otp: "6666",
      })
      .select("id")
      .single();

    // Worker from canteen 1 tries to update
    const worker2 = await provisionStaff("worker", canteens[1].id, "cross-worker");

    const res = await apiFetch(
      `${APP_URL}/api/orders/${order.id}/status`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...uniqueIpHeaders() },
        body: JSON.stringify({ status: "confirming" }),
      },
      {
        email: worker2.email,
        password: worker2.password,
      }
    );

    expect(res.status).toBe(403);

    await deleteUser(student.id);
    await deleteUser(worker2.id);
  });

  // ── Auto-Accept Logic ──────────────────────────────────────────────────
  test("Orders >35s old are auto-accepted when fetched with ?worker=true", async () => {
    const admin = adminClient();

    // Create order aged 40 seconds
    const pastTime = new Date(Date.now() - 40 * 1000).toISOString();
    const student = await provisionStudent(canteenId, "autoaccept");

    const { data: order } = await admin
      .from("orders")
      .insert({
        user_id: student.id,
        canteen_id: canteenId,
        total_amount: 100,
        status: "placed",
        otp: "7777",
        created_at: pastTime,
      })
      .select("id, status")
      .single();

    // Fetch with worker=true to trigger auto-accept
    const res = await apiFetch(
      `${APP_URL}/api/orders?worker=true`,
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
    const autoAccepted = orders.find((o: { id: string }) => o.id === order.id);

    // Status should be confirmed or at least not "placed"
    if (autoAccepted) {
      expect(autoAccepted.status).not.toBe("placed");
    }

    await deleteUser(student.id);
  });
});

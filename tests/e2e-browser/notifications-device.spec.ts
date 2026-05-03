import { test, expect } from "@playwright/test";
import {
  apiFetch,
  provisionStudent,
  provisionStaff,
  deleteUser,
  adminClient,
  uniqueIpHeaders,
} from "./_helpers";

const APP_URL = process.env.APP_BASE_URL || "http://localhost:3000";

test.describe("Notifications & Device Tokens", () => {
  let canteenId: string;

  test.beforeAll(async () => {
    const admin = adminClient();

    const { data: canteens } = await admin.from("canteens").select("id").limit(1);
    canteenId = canteens?.[0]?.id || "test-canteen";
  });

  // ── Register Device Token ──────────────────────────────────────────────
  test("Student registers device token for push notifications", async () => {
    const student = await provisionStudent(canteenId, "device-student");

    const res = await apiFetch(
      `${APP_URL}/api/notifications/device-token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...uniqueIpHeaders() },
        body: JSON.stringify({
          token: `device_token_${Date.now()}`,
          platform: "web",
        }),
      },
      {
        email: student.email,
        password: student.password,
      }
    );

    expect(res.status).toBe(200);

    await deleteUser(student.id);
  });

  // ── Duplicate Token Registration is Idempotent ─────────────────────────
  test("Duplicate device token registration is idempotent", async () => {
    const student = await provisionStudent(canteenId, "device-dup");
    const token = `unique_token_${Date.now()}`;

    // First registration
    const res1 = await apiFetch(
      `${APP_URL}/api/notifications/device-token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...uniqueIpHeaders() },
        body: JSON.stringify({
          token,
          platform: "web",
        }),
      },
      {
        email: student.email,
        password: student.password,
      }
    );

    expect(res1.status).toBe(200);

    // Second registration with same token
    const res2 = await apiFetch(
      `${APP_URL}/api/notifications/device-token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...uniqueIpHeaders() },
        body: JSON.stringify({
          token,
          platform: "web",
        }),
      },
      {
        email: student.email,
        password: student.password,
      }
    );

    expect(res2.status).toBe(200);

    await deleteUser(student.id);
  });

  // ── Worker Registers Device Token ──────────────────────────────────────
  test("Worker registers device token", async () => {
    const worker = await provisionStaff("worker", canteenId, "device-worker");

    const res = await apiFetch(
      `${APP_URL}/api/notifications/device-token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...uniqueIpHeaders() },
        body: JSON.stringify({
          token: `worker_token_${Date.now()}`,
          platform: "mobile",
        }),
      },
      {
        email: worker.email,
        password: worker.password,
      }
    );

    expect(res.status).toBe(200);

    await deleteUser(worker.id);
  });

  // ── Get Notifications Returns Own Notifications ─────────────────────────
  test("GET /api/notifications returns student's own notifications", async () => {
    const student = await provisionStudent(canteenId, "notif-view");

    const res = await apiFetch(
      `${APP_URL}/api/notifications`,
      {
        method: "GET",
        headers: { ...uniqueIpHeaders() },
      },
      {
        email: student.email,
        password: student.password,
      }
    );

    expect(res.status).toBe(200);
    const notifs = await res.json();
    expect(Array.isArray(notifs)).toBe(true);

    await deleteUser(student.id);
  });

  // ── Role-Scoped Notifications ──────────────────────────────────────────
  test("Worker sees role-scoped notifications (not student notifications)", async () => {
    const worker = await provisionStaff("worker", canteenId, "notif-role");

    const res = await apiFetch(
      `${APP_URL}/api/notifications`,
      {
        method: "GET",
        headers: { ...uniqueIpHeaders() },
      },
      {
        email: worker.email,
        password: worker.password,
      }
    );

    expect(res.status).toBe(200);
    const notifs = await res.json();
    expect(Array.isArray(notifs)).toBe(true);

    // All notifications should be scoped to worker role
    for (const notif of notifs) {
      // If target_role exists, should be worker-related
      if (notif.target_role) {
        expect(["worker", "all", "staff"].includes(notif.target_role)).toBe(true);
      }
    }

    await deleteUser(worker.id);
  });

  // ── Notifications Require Authentication ───────────────────────────────
  test("GET /api/notifications without auth returns 401", async () => {
    const res = await apiFetch(`${APP_URL}/api/notifications`, {
      method: "GET",
      headers: { ...uniqueIpHeaders() },
    });

    expect(res.status).toBe(401);
  });

  // ── Device Token Registration Requires Authentication ──────────────────
  test("Register device token without auth returns 401", async () => {
    const res = await apiFetch(
      `${APP_URL}/api/notifications/device-token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...uniqueIpHeaders() },
        body: JSON.stringify({
          token: "test_token",
          platform: "web",
        }),
      }
      // No auth
    );

    expect(res.status).toBe(401);
  });
});

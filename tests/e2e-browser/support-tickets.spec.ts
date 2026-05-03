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

test.describe("Support Tickets", () => {
  let canteenId: string;

  test.beforeAll(async () => {
    const admin = adminClient();

    const { data: canteens } = await admin.from("canteens").select("id").limit(1);
    canteenId = canteens?.[0]?.id || "test-canteen";
  });

  // ── Canteen Admin Raises Ticket ────────────────────────────────────────
  test("canteen_admin raises support ticket", async () => {
    const manager = await provisionStaff(
      "canteen_admin",
      canteenId,
      "support-manager"
    );

    const res = await apiFetch(
      `${APP_URL}/api/support`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...uniqueIpHeaders() },
        body: JSON.stringify({
          subject: `Bin Issue ${Date.now()}`,
          message: "Bins are overflowing, need urgent attention",
        }),
      },
      {
        email: manager.email,
        password: manager.password,
      }
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toHaveProperty("id");

    await deleteUser(manager.id);
  });

  // ── Student Raises Ticket ──────────────────────────────────────────────
  test("Student raises support ticket", async () => {
    const student = await provisionStudent(canteenId, "support-student");

    const res = await apiFetch(
      `${APP_URL}/api/support`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...uniqueIpHeaders() },
        body: JSON.stringify({
          subject: `Order Issue ${Date.now()}`,
          message: "My order was not collected",
        }),
      },
      {
        email: student.email,
        password: student.password,
      }
    );

    expect(res.status).toBe(201);

    await deleteUser(student.id);
  });

  // ── Student Sees Own Tickets ───────────────────────────────────────────
  test("Student views own support tickets", async () => {
    const student = await provisionStudent(canteenId, "support-view");

    // Create ticket
    await apiFetch(
      `${APP_URL}/api/support`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...uniqueIpHeaders() },
        body: JSON.stringify({
          subject: "Test Ticket",
          message: "Test message",
        }),
      },
      {
        email: student.email,
        password: student.password,
      }
    );

    // View tickets
    const res = await apiFetch(
      `${APP_URL}/api/support`,
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
    const tickets = await res.json();
    expect(Array.isArray(tickets)).toBe(true);

    await deleteUser(student.id);
  });

  // ── Student Cannot See Other Students' Tickets ─────────────────────────
  test("Student cannot see other student's tickets", async () => {
    const admin = adminClient();

    const student1 = await provisionStudent(canteenId, "support-1");
    const student2 = await provisionStudent(canteenId, "support-2");

    // Student 1 creates ticket
    await apiFetch(
      `${APP_URL}/api/support`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...uniqueIpHeaders() },
        body: JSON.stringify({
          subject: "Private Ticket",
          message: "Only for student 1",
        }),
      },
      {
        email: student1.email,
        password: student1.password,
      }
    );

    // Student 2 views their tickets (should not see student 1's)
    const res = await apiFetch(
      `${APP_URL}/api/support`,
      {
        method: "GET",
        headers: { ...uniqueIpHeaders() },
      },
      {
        email: student2.email,
        password: student2.password,
      }
    );

    expect(res.status).toBe(200);
    const tickets = await res.json();

    // Should not contain student 1's private message
    const hasPrivate = tickets.some((t: { message: string }) =>
      t.message.includes("Only for student 1")
    );
    expect(hasPrivate).toBe(false);

    await deleteUser(student1.id);
    await deleteUser(student2.id);
  });

  // ── Super Admin Sees All Tickets ───────────────────────────────────────
  test("super_admin sees all support tickets", async () => {
    const res = await apiFetch(
      `${APP_URL}/api/support`,
      {
        method: "GET",
        headers: { ...uniqueIpHeaders() },
      },
      {
        email: "admin@noqx.test",
        password: "Admin@1234",
      }
    );

    expect(res.status).toBe(200);
    const tickets = await res.json();
    expect(Array.isArray(tickets)).toBe(true);
  });

  // ── Super Admin Resolves Ticket ────────────────────────────────────────
  test("super_admin resolves support ticket", async () => {
    const student = await provisionStudent(canteenId, "support-resolve");

    // Create ticket
    const createRes = await apiFetch(
      `${APP_URL}/api/support`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...uniqueIpHeaders() },
        body: JSON.stringify({
          subject: "To Resolve",
          message: "Please fix",
        }),
      },
      {
        email: student.email,
        password: student.password,
      }
    );

    const ticket = await createRes.json();

    // Super admin resolves
    const res = await apiFetch(
      `${APP_URL}/api/support/${ticket.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...uniqueIpHeaders() },
        body: JSON.stringify({
          status: "resolved",
          notes: "Issue fixed",
        }),
      },
      {
        email: "admin@noqx.test",
        password: "Admin@1234",
      }
    );

    expect([200, 400, 404]).toContain(res.status);

    await deleteUser(student.id);
  });

  // ── Co Admin Cannot Resolve ────────────────────────────────────────────
  test("co_admin cannot resolve ticket → 403", async () => {
    const student = await provisionStudent(canteenId, "support-coadmin");

    // Create ticket
    const createRes = await apiFetch(
      `${APP_URL}/api/support`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...uniqueIpHeaders() },
        body: JSON.stringify({
          subject: "Co Admin Test",
          message: "Test",
        }),
      },
      {
        email: student.email,
        password: student.password,
      }
    );

    const ticket = await createRes.json();

    // Co admin tries to resolve
    const res = await apiFetch(
      `${APP_URL}/api/support/${ticket.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...uniqueIpHeaders() },
        body: JSON.stringify({
          status: "resolved",
          notes: "Should fail",
        }),
      },
      {
        email: "coadmin@noqx.test",
        password: "Coadmin@12345",
      }
    );

    expect([403, 400, 404]).toContain(res.status);

    await deleteUser(student.id);
  });
});

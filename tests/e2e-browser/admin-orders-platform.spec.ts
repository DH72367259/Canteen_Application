import { test, expect } from "@playwright/test";
import { adminClient, apiFetch, uniqueIpHeaders } from "./_helpers";

const APP_URL = process.env.APP_BASE_URL || "http://localhost:3000";
const SUPER_ADMIN_EMAIL = "admin@noqx.test";
const SUPER_ADMIN_PASSWORD = "Admin@1234";
const CO_ADMIN_EMAIL = "coadmin@noqx.test";
const CO_ADMIN_PASSWORD = "Coadmin@12345";

test.describe("Admin Platform Orders & Stats", () => {
  // ── Super Admin Lists All Orders ───────────────────────────────────────
  test("super_admin lists all orders platform-wide", async () => {
    const res = await apiFetch(
      `${APP_URL}/api/orders`,
      {
        method: "GET",
        headers: { ...uniqueIpHeaders() },
      },
      {
        email: SUPER_ADMIN_EMAIL,
        password: SUPER_ADMIN_PASSWORD,
      }
    );

    expect(res.status).toBe(200);
    const orders = await res.json();
    expect(Array.isArray(orders)).toBe(true);
  });

  // ── Co Admin Lists All Orders ──────────────────────────────────────────
  test("co_admin lists all orders platform-wide", async () => {
    const res = await apiFetch(
      `${APP_URL}/api/orders`,
      {
        method: "GET",
        headers: { ...uniqueIpHeaders() },
      },
      {
        email: CO_ADMIN_EMAIL,
        password: CO_ADMIN_PASSWORD,
      }
    );

    expect(res.status).toBe(200);
    const orders = await res.json();
    expect(Array.isArray(orders)).toBe(true);
  });

  // ── Super Admin Cancels Any Order ──────────────────────────────────────
  test("super_admin can cancel any order on platform", async () => {
    const admin = adminClient();

    // Get first order
    const { data: orders } = await admin.from("orders").select("id").limit(1);

    if (!orders?.length) return;

    const res = await apiFetch(
      `${APP_URL}/api/orders/${orders[0].id}/cancel`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...uniqueIpHeaders() },
        body: JSON.stringify({ reason: "admin_cancellation" }),
      },
      {
        email: SUPER_ADMIN_EMAIL,
        password: SUPER_ADMIN_PASSWORD,
      }
    );

    expect([200, 400, 409]).toContain(res.status);
  });

  // ── Platform Stats ────────────────────────────────────────────────────
  test("super_admin views platform stats", async () => {
    const res = await apiFetch(
      `${APP_URL}/api/admin/stats`,
      {
        method: "GET",
        headers: { ...uniqueIpHeaders() },
      },
      {
        email: SUPER_ADMIN_EMAIL,
        password: SUPER_ADMIN_PASSWORD,
      }
    );

    expect(res.status).toBe(200);
    const stats = await res.json();
    expect(stats).toHaveProperty("total_canteens");
    expect(stats).toHaveProperty("total_users");
    expect(stats).toHaveProperty("todays_orders");
    expect(stats).toHaveProperty("todays_revenue");
  });

  test("co_admin views platform stats", async () => {
    const res = await apiFetch(
      `${APP_URL}/api/admin/stats`,
      {
        method: "GET",
        headers: { ...uniqueIpHeaders() },
      },
      {
        email: CO_ADMIN_EMAIL,
        password: CO_ADMIN_PASSWORD,
      }
    );

    expect(res.status).toBe(200);
    const stats = await res.json();
    expect(stats).toHaveProperty("total_canteens");
  });

  // ── 6-Month Chart Data ────────────────────────────────────────────────
  test("super_admin views 6-month chart data in stats", async () => {
    const res = await apiFetch(
      `${APP_URL}/api/admin/stats`,
      {
        method: "GET",
        headers: { ...uniqueIpHeaders() },
      },
      {
        email: SUPER_ADMIN_EMAIL,
        password: SUPER_ADMIN_PASSWORD,
      }
    );

    expect(res.status).toBe(200);
    const stats = await res.json();

    if (stats.monthly_data) {
      expect(Array.isArray(stats.monthly_data)).toBe(true);
    }
  });

  // ── Recent Activity Feed ───────────────────────────────────────────────
  test("super_admin views recent activity feed in stats", async () => {
    const res = await apiFetch(
      `${APP_URL}/api/admin/stats`,
      {
        method: "GET",
        headers: { ...uniqueIpHeaders() },
      },
      {
        email: SUPER_ADMIN_EMAIL,
        password: SUPER_ADMIN_PASSWORD,
      }
    );

    expect(res.status).toBe(200);
    const stats = await res.json();

    if (stats.recent_orders) {
      expect(Array.isArray(stats.recent_orders)).toBe(true);
    }
  });

  // ── Super Admin Manages All Canteen Menus ──────────────────────────────
  test("super_admin manages menu for any canteen", async () => {
    const admin = adminClient();

    const { data: canteens } = await admin.from("canteens").select("id").limit(1);
    if (!canteens?.length) return;

    const res = await apiFetch(
      `${APP_URL}/api/canteen/menu`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...uniqueIpHeaders() },
        body: JSON.stringify({
          name: `Admin Menu ${Date.now()}`,
          price: 200,
          is_meal: true,
          availability_type: "batched_prepared",
        }),
      },
      {
        email: SUPER_ADMIN_EMAIL,
        password: SUPER_ADMIN_PASSWORD,
      }
    );

    expect([200, 201, 400]).toContain(res.status);
  });

  // ── Super Admin Password Reset ─────────────────────────────────────────
  test("super_admin sends password reset email", async () => {
    const admin = adminClient();

    // Get first user
    const { data: users } = await admin
      .from("profiles")
      .select("id")
      .neq("role", "super_admin")
      .limit(1);

    if (!users?.length) return;

    const res = await apiFetch(
      `${APP_URL}/api/admin/users/reset-password`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...uniqueIpHeaders() },
        body: JSON.stringify({
          user_id: users[0].id,
        }),
      },
      {
        email: SUPER_ADMIN_EMAIL,
        password: SUPER_ADMIN_PASSWORD,
      }
    );

    expect([200, 201, 400, 404]).toContain(res.status);
  });

  // ── Co Admin Cannot Send Password Reset ─────────────────────────────────
  test("co_admin cannot send password reset → 403", async () => {
    const admin = adminClient();

    const { data: users } = await admin
      .from("profiles")
      .select("id")
      .neq("role", "super_admin")
      .limit(1);

    if (!users?.length) return;

    const res = await apiFetch(
      `${APP_URL}/api/admin/users/reset-password`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...uniqueIpHeaders() },
        body: JSON.stringify({
          user_id: users[0].id,
        }),
      },
      {
        email: CO_ADMIN_EMAIL,
        password: CO_ADMIN_PASSWORD,
      }
    );

    expect(res.status).toBe(403);
  });

  // ── Platform Stats Requires Auth ───────────────────────────────────────
  test("unauthenticated access to stats returns 401", async () => {
    const res = await apiFetch(`${APP_URL}/api/admin/stats`, {
      method: "GET",
      headers: { ...uniqueIpHeaders() },
    });

    expect(res.status).toBe(401);
  });
});

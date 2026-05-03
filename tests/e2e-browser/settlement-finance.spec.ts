import { test, expect } from "@playwright/test";
import { adminClient, apiFetch, uniqueIpHeaders } from "./_helpers";

const APP_URL = process.env.APP_BASE_URL || "http://localhost:3000";
const SUPER_ADMIN_EMAIL = "admin@noqx.test";
const SUPER_ADMIN_PASSWORD = "Admin@1234";
const CO_ADMIN_EMAIL = "coadmin@noqx.test";
const CO_ADMIN_PASSWORD = "Coadmin@12345";

test.describe("Settlement & Finance", () => {
  // ── Get Settlement Summary ─────────────────────────────────────────────
  test("super_admin gets settlement summary for date range", async () => {
    const today = new Date().toISOString().split("T")[0];
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];

    const res = await apiFetch(
      `${APP_URL}/api/admin/settlements?period_start=${weekAgo}&period_end=${today}`,
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
    const body = await res.json();
    expect(body).toHaveProperty("canteen_settlements");
    expect(body).toHaveProperty("total_gross");
    expect(body).toHaveProperty("total_platform_fee");
  });

  test("co_admin gets settlement summary (read-only)", async () => {
    const today = new Date().toISOString().split("T")[0];
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];

    const res = await apiFetch(
      `${APP_URL}/api/admin/settlements?period_start=${weekAgo}&period_end=${today}`,
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
    const body = await res.json();
    expect(body).toHaveProperty("canteen_settlements");
  });

  // ── Record Manual Settlement Payment ───────────────────────────────────
  test("super_admin records manual settlement payment", async () => {
    const admin = adminClient();

    // Get first canteen
    const { data: canteens } = await admin.from("canteens").select("id").limit(1);
    if (!canteens?.length) return;

    const canteenId = canteens[0].id;

    const res = await apiFetch(
      `${APP_URL}/api/admin/settlements/pay`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...uniqueIpHeaders() },
        body: JSON.stringify({
          canteen_id: canteenId,
          amount: 5000,
          payment_mode: "upi",
          transaction_ref: `TXN-${Date.now()}`,
          period_start: "2024-01-01",
          period_end: "2024-01-31",
        }),
      },
      {
        email: SUPER_ADMIN_EMAIL,
        password: SUPER_ADMIN_PASSWORD,
      }
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toHaveProperty("payment_id");
  });

  test("co_admin cannot record settlement payment → 403", async () => {
    const admin = adminClient();

    const { data: canteens } = await admin.from("canteens").select("id").limit(1);
    if (!canteens?.length) return;

    const res = await apiFetch(
      `${APP_URL}/api/admin/settlements/pay`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...uniqueIpHeaders() },
        body: JSON.stringify({
          canteen_id: canteens[0].id,
          amount: 1000,
          payment_mode: "bank_transfer",
          transaction_ref: `FAIL-${Date.now()}`,
        }),
      },
      {
        email: CO_ADMIN_EMAIL,
        password: CO_ADMIN_PASSWORD,
      }
    );

    expect(res.status).toBe(403);
  });

  // ── Get Weekly Settlement Report ───────────────────────────────────────
  test("super_admin gets weekly settlement report", async () => {
    const res = await apiFetch(
      `${APP_URL}/api/admin/settlements/weekly-report?weeks=4`,
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
    const body = await res.json();
    expect(body).toHaveProperty("weeks");
    expect(Array.isArray(body.weeks)).toBe(true);
  });

  test("co_admin cannot get weekly settlement report → 403", async () => {
    const res = await apiFetch(
      `${APP_URL}/api/admin/settlements/weekly-report`,
      {
        method: "GET",
        headers: { ...uniqueIpHeaders() },
      },
      {
        email: CO_ADMIN_EMAIL,
        password: CO_ADMIN_PASSWORD,
      }
    );

    expect(res.status).toBe(403);
  });

  // ── Platform Charges Configuration ─────────────────────────────────────
  test("super_admin gets platform charges", async () => {
    const res = await apiFetch(
      `${APP_URL}/api/admin/platform-charges`,
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
    const body = await res.json();
    expect(body).toHaveProperty("charge_pct");
    expect(body).toHaveProperty("gst_pct");
  });

  test("super_admin updates platform charges", async () => {
    const res = await apiFetch(
      `${APP_URL}/api/admin/platform-charges`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...uniqueIpHeaders() },
        body: JSON.stringify({
          charge_pct: 2.5,
          flat_charge: 0,
          gst_pct: 18,
        }),
      },
      {
        email: SUPER_ADMIN_EMAIL,
        password: SUPER_ADMIN_PASSWORD,
      }
    );

    expect(res.status).toBe(200);
  });

  test("co_admin cannot update platform charges → 403", async () => {
    const res = await apiFetch(
      `${APP_URL}/api/admin/platform-charges`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...uniqueIpHeaders() },
        body: JSON.stringify({
          charge_pct: 3,
          flat_charge: 0,
          gst_pct: 18,
        }),
      },
      {
        email: CO_ADMIN_EMAIL,
        password: CO_ADMIN_PASSWORD,
      }
    );

    expect(res.status).toBe(403);
  });

  test("invalid platform charge values → 400", async () => {
    const res = await apiFetch(
      `${APP_URL}/api/admin/platform-charges`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...uniqueIpHeaders() },
        body: JSON.stringify({
          charge_pct: -5, // negative
          flat_charge: 0,
          gst_pct: 18,
        }),
      },
      {
        email: SUPER_ADMIN_EMAIL,
        password: SUPER_ADMIN_PASSWORD,
      }
    );

    expect([400, 422]).toContain(res.status);
  });

  // ── Canteen Bank Details ───────────────────────────────────────────────
  test("super_admin gets canteen bank details", async () => {
    const admin = adminClient();

    const { data: canteens } = await admin.from("canteens").select("id").limit(1);
    if (!canteens?.length) return;

    const res = await apiFetch(
      `${APP_URL}/api/admin/canteen-bank/${canteens[0].id}`,
      {
        method: "GET",
        headers: { ...uniqueIpHeaders() },
      },
      {
        email: SUPER_ADMIN_EMAIL,
        password: SUPER_ADMIN_PASSWORD,
      }
    );

    expect([200, 404]).toContain(res.status);
  });

  test("super_admin sets canteen bank details", async () => {
    const admin = adminClient();

    const { data: canteens } = await admin.from("canteens").select("id").limit(1);
    if (!canteens?.length) return;

    const res = await apiFetch(
      `${APP_URL}/api/admin/canteen-bank/${canteens[0].id}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...uniqueIpHeaders() },
        body: JSON.stringify({
          account_number: "1234567890123456",
          ifsc_code: "SBIN0001234",
          account_holder: "Test Canteen",
          payout_type: "bank_account",
        }),
      },
      {
        email: SUPER_ADMIN_EMAIL,
        password: SUPER_ADMIN_PASSWORD,
      }
    );

    expect([200, 201]).toContain(res.status);
  });

  // ── Unsupported Operations ─────────────────────────────────────────────
  test("co_admin cannot set bank details → 403", async () => {
    const admin = adminClient();

    const { data: canteens } = await admin.from("canteens").select("id").limit(1);
    if (!canteens?.length) return;

    const res = await apiFetch(
      `${APP_URL}/api/admin/canteen-bank/${canteens[0].id}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...uniqueIpHeaders() },
        body: JSON.stringify({
          account_number: "9999999999999999",
          ifsc_code: "TEST0000123",
          account_holder: "Fail",
          payout_type: "bank_account",
        }),
      },
      {
        email: CO_ADMIN_EMAIL,
        password: CO_ADMIN_PASSWORD,
      }
    );

    expect(res.status).toBe(403);
  });
});

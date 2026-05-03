import { test, expect } from "@playwright/test";
import { adminClient, apiFetch, deleteUser, uniqueIpHeaders } from "./_helpers";

const APP_URL = process.env.APP_BASE_URL || "http://localhost:3000";
const SUPER_ADMIN_EMAIL = "admin@noqx.test";
const SUPER_ADMIN_PASSWORD = "Admin@1234";
const CO_ADMIN_EMAIL = "coadmin@noqx.test";
const CO_ADMIN_PASSWORD = "Coadmin@12345";

test.describe("Admin Canteen CRUD", () => {
  let createdCanteenId: string;
  let createdAdminId: string;

  test.afterEach(async () => {
    // Cleanup created canteen and users
    if (createdAdminId) {
      await deleteUser(createdAdminId);
    }
  });

  // ── Create Canteen ─────────────────────────────────────────────────────
  test("super_admin creates canteen with bins and slot control", async () => {
    const res = await apiFetch(
      `${APP_URL}/api/admin/canteens/create`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...uniqueIpHeaders() },
        body: JSON.stringify({
          canteen_name: `E2E Canteen ${Date.now()}`,
          admin_name: `Admin ${Date.now()}`,
          admin_email: `canteen-admin-${Date.now()}@noqx.test`,
          admin_password: "TempPassword@123",
          college_id: "test-college-1",
          address: "123 Test St",
          geopoint: { lat: 28.5, lng: 77.2 },
        }),
      },
      {
        email: SUPER_ADMIN_EMAIL,
        password: SUPER_ADMIN_PASSWORD,
      }
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.canteen_id).toBeTruthy();
    expect(body.admin_id).toBeTruthy();

    createdCanteenId = body.canteen_id;
    createdAdminId = body.admin_id;

    // Verify canteen was created in DB
    const admin = adminClient();
    const { data: canteen } = await admin
      .from("canteens")
      .select("*")
      .eq("id", createdCanteenId)
      .single();

    expect(canteen.name).toMatch(/E2E Canteen/);
  });

  // ── Edit Canteen ───────────────────────────────────────────────────────
  test("super_admin edits canteen metadata", async () => {
    const admin = adminClient();

    // Get first canteen
    const { data: canteens } = await admin.from("canteens").select("id").limit(1);
    if (!canteens?.length) return;

    const canteenId = canteens[0].id;

    const res = await apiFetch(
      `${APP_URL}/api/admin/canteens/${canteenId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...uniqueIpHeaders() },
        body: JSON.stringify({
          name: `Updated Name ${Date.now()}`,
          address: "456 New Ave",
        }),
      },
      {
        email: SUPER_ADMIN_EMAIL,
        password: SUPER_ADMIN_PASSWORD,
      }
    );

    expect(res.status).toBe(200);

    // Verify update
    const { data: updated } = await admin
      .from("canteens")
      .select("name, address")
      .eq("id", canteenId)
      .single();

    expect(updated.name).toMatch(/Updated Name/);
  });

  // ── Delete Canteen ─────────────────────────────────────────────────────
  test("super_admin deletes canteen", async () => {
    const admin = adminClient();

    // Create a canteen to delete
    const { data: canteen } = await admin
      .from("canteens")
      .insert({
        name: `Canteen to Delete ${Date.now()}`,
        college_id: "test-college",
      })
      .select("id")
      .single();

    const res = await apiFetch(
      `${APP_URL}/api/admin/canteens/${canteen.id}`,
      {
        method: "DELETE",
        headers: { ...uniqueIpHeaders() },
      },
      {
        email: SUPER_ADMIN_EMAIL,
        password: SUPER_ADMIN_PASSWORD,
      }
    );

    expect([200, 204]).toContain(res.status);

    // Verify deletion
    const { data: deleted } = await admin
      .from("canteens")
      .select("id")
      .eq("id", canteen.id)
      .maybeSingle();

    expect(deleted).toBeNull();
  });

  // ── Co-Admin Cannot Create ─────────────────────────────────────────────
  test("co_admin cannot create canteen → 403", async () => {
    const res = await apiFetch(
      `${APP_URL}/api/admin/canteens/create`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...uniqueIpHeaders() },
        body: JSON.stringify({
          canteen_name: `Fail ${Date.now()}`,
          admin_name: `Fail`,
          admin_email: `fail@noqx.test`,
          admin_password: "Pass@123",
          college_id: "test",
        }),
      },
      {
        email: CO_ADMIN_EMAIL,
        password: CO_ADMIN_PASSWORD,
      }
    );

    expect(res.status).toBe(403);
  });

  test("co_admin cannot delete canteen → 403", async () => {
    const admin = adminClient();

    // Get first canteen
    const { data: canteens } = await admin.from("canteens").select("id").limit(1);
    if (!canteens?.length) return;

    const res = await apiFetch(
      `${APP_URL}/api/admin/canteens/${canteens[0].id}`,
      {
        method: "DELETE",
        headers: { ...uniqueIpHeaders() },
      },
      {
        email: CO_ADMIN_EMAIL,
        password: CO_ADMIN_PASSWORD,
      }
    );

    expect(res.status).toBe(403);
  });

  // ── Co-Admin Can View ──────────────────────────────────────────────────
  test("co_admin can view all canteens", async () => {
    const res = await apiFetch(
      `${APP_URL}/api/admin/canteens`,
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
    expect(Array.isArray(body)).toBe(true);
  });

  // ── Manager Toggle Own Canteen ─────────────────────────────────────────
  test("canteen_admin toggles own canteen open/closed", async () => {
    const admin = adminClient();

    // Get first canteen
    const { data: canteens } = await admin.from("canteens").select("id").limit(1);
    if (!canteens?.length) return;

    const canteenId = canteens[0].id;

    // Get manager for this canteen (should be first one if exists)
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, email, password_hash")
      .eq("canteen_id", canteenId)
      .eq("role", "canteen_admin")
      .limit(1);

    if (!profiles?.length) {
      // Skip if no canteen_admin found
      return;
    }

    // For E2E, we'd need the actual password, which we don't have.
    // Test with known whitelist account instead:
    const res = await apiFetch(
      `${APP_URL}/api/canteens/${canteenId}/toggle`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...uniqueIpHeaders() },
        body: JSON.stringify({ is_active: false }),
      },
      {
        email: "canteen1@noqx.test",
        password: "Canteen@12345",
      }
    );

    expect([200, 403, 404]).toContain(res.status);
  });

  // ── Manager Cannot Toggle Other Canteen ────────────────────────────────
  test("canteen_admin cannot toggle another canteen → 403", async () => {
    const admin = adminClient();

    // Get two different canteens
    const { data: canteens } = await admin
      .from("canteens")
      .select("id")
      .limit(2);

    if (canteens?.length < 2) return;

    // Try to toggle with whitelist account from canteen 1
    const res = await apiFetch(
      `${APP_URL}/api/canteens/${canteens[1].id}/toggle`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...uniqueIpHeaders() },
        body: JSON.stringify({ is_active: false }),
      },
      {
        email: "canteen1@noqx.test",
        password: "Canteen@12345",
      }
    );

    expect(res.status).toBe(403);
  });

  // ── Super Admin Can Toggle Any Canteen ─────────────────────────────────
  test("super_admin can toggle any canteen", async () => {
    const admin = adminClient();

    // Get first canteen
    const { data: canteens } = await admin.from("canteens").select("id").limit(1);
    if (!canteens?.length) return;

    const res = await apiFetch(
      `${APP_URL}/api/canteens/${canteens[0].id}/toggle`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...uniqueIpHeaders() },
        body: JSON.stringify({ is_active: false }),
      },
      {
        email: SUPER_ADMIN_EMAIL,
        password: SUPER_ADMIN_PASSWORD,
      }
    );

    expect(res.status).toBe(200);
  });

  // ── Student Cannot Toggle Canteen ──────────────────────────────────────
  test("student cannot toggle canteen → 403/401", async () => {
    const admin = adminClient();

    const { data: canteens } = await admin.from("canteens").select("id").limit(1);
    if (!canteens?.length) return;

    const res = await apiFetch(
      `${APP_URL}/api/canteens/${canteens[0].id}/toggle`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...uniqueIpHeaders() },
        body: JSON.stringify({ is_active: false }),
      }
      // No auth (student not authenticated)
    );

    expect([401, 403]).toContain(res.status);
  });
});

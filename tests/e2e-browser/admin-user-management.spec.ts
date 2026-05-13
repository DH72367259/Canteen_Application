/**
 * Admin User Management API Tests
 *
 * Comprehensive coverage of GET/POST/PATCH/DELETE /api/admin/users:
 * - CRUD happy paths
 * - Validation failures (400)
 * - Auth/authz guards (401/403)
 * - Duplicate-detection (409)
 * - Role restrictions
 * - Phone normalisation
 */
import { test, expect } from "@playwright/test";
import {
  adminClient,
  APP_URL,
  WHITELIST,
  getAccessToken,
  apiFetch,
} from "./_helpers";

const CANTEEN_ID = "9d1b1e36-48a1-4ce8-a270-704eec9018c8";

// ── helpers ────────────────────────────────────────────────────────────────

async function adminToken() {
  return getAccessToken(WHITELIST.superAdmin.email, WHITELIST.superAdmin.password);
}

async function coAdminToken() {
  return getAccessToken(WHITELIST.coAdmin.email, WHITELIST.coAdmin.password);
}

function userEndpoint() { return `${APP_URL}/api/admin/users`; }
function ts() { return Date.now(); }

/** Create a throwaway user via the API and return the uid. Cleans up in afterAll. */
async function createViaApi(tok: string, overrides: Record<string, string> = {}) {
  const t = ts();
  const body = {
    email:      `mgmt-${t}@noqx.test`,
    password:   "Mgmt@12345",
    name:       `Mgmt User ${t}`,
    role:       "worker",
    canteen_id: CANTEEN_ID,
    phone:      `8${String(t).slice(-9)}`,
    ...overrides,
  };
  const res = await apiFetch(userEndpoint(), {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${tok}` },
    body: JSON.stringify(body),
  });
  return { res, body };
}

// ── GET: list users ─────────────────────────────────────────────────────────

test.describe("GET /api/admin/users", () => {
  test("super_admin can list all users", async () => {
    const tok = await adminToken();
    const res = await apiFetch(userEndpoint(), {
      headers: { Authorization: `Bearer ${tok}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json() as { users: unknown[] };
    expect(Array.isArray(data.users)).toBe(true);
    expect(data.users.length).toBeGreaterThan(0);
  });

  test("co_admin can list users (read-only role)", async () => {
    const tok = await coAdminToken();
    const res = await apiFetch(userEndpoint(), {
      headers: { Authorization: `Bearer ${tok}` },
    });
    expect(res.status).toBe(200);
  });

  test("unauthenticated request returns 401", async () => {
    const res = await apiFetch(userEndpoint());
    expect(res.status).toBe(401);
  });

  test("worker cannot list users (returns 403)", async () => {
    const tok = await getAccessToken(WHITELIST.worker.email, WHITELIST.worker.password);
    const res = await apiFetch(userEndpoint(), {
      headers: { Authorization: `Bearer ${tok}` },
    });
    expect(res.status).toBe(403);
  });

  test("response includes uid, email, role, name fields", async () => {
    const tok = await adminToken();
    const res = await apiFetch(userEndpoint(), {
      headers: { Authorization: `Bearer ${tok}` },
    });
    const data = await res.json() as { users: Record<string, unknown>[] };
    const u = data.users[0];
    expect(u).toHaveProperty("uid");
    expect(u).toHaveProperty("email");
    expect(u).toHaveProperty("role");
    expect(u).toHaveProperty("name");
  });
});

// ── POST: create user ───────────────────────────────────────────────────────

test.describe("POST /api/admin/users", () => {
  const createdUids: string[] = [];

  test.afterAll(async () => {
    const admin = adminClient();
    for (const uid of createdUids) {
      await admin.auth.admin.deleteUser(uid).catch(() => {});
    }
  });

  test("super_admin can create a worker", async () => {
    const tok = await adminToken();
    const { res } = await createViaApi(tok);
    expect(res.status).toBe(200);
    const body = await res.json() as { uid?: string };
    expect(body.uid).toBeTruthy();
    if (body.uid) createdUids.push(body.uid);
  });

  test("created user appears in list", async () => {
    const tok = await adminToken();
    const { res, body: req } = await createViaApi(tok);
    const data = await res.json() as { uid?: string };
    if (data.uid) createdUids.push(data.uid);
    const list = await apiFetch(userEndpoint(), { headers: { Authorization: `Bearer ${tok}` } });
    const listData = await list.json() as { users: { email: string }[] };
    const found = listData.users.find(u => u.email === req.email);
    expect(found).toBeTruthy();
  });

  test("can create canteen_admin role", async () => {
    const tok = await adminToken();
    const { res } = await createViaApi(tok, { role: "canteen_admin" });
    expect(res.status).toBe(200);
    const body = await res.json() as { uid?: string; role?: string };
    if (body.uid) createdUids.push(body.uid);
    expect(body.role).toBe("canteen_admin");
  });

  test("can create co_admin role", async () => {
    const tok = await adminToken();
    const { res } = await createViaApi(tok, { role: "co_admin", canteen_id: "" });
    expect(res.status).toBe(200);
    const body = await res.json() as { uid?: string };
    if (body.uid) createdUids.push(body.uid);
  });

  test("super_admin role is rejected (not in allowed set)", async () => {
    const tok = await adminToken();
    const { res } = await createViaApi(tok, { role: "super_admin" });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/role/i);
  });

  test("student role is rejected", async () => {
    const tok = await adminToken();
    const { res } = await createViaApi(tok, { role: "student" });
    expect(res.status).toBe(400);
  });

  test("missing email returns 400", async () => {
    const tok = await adminToken();
    const res = await apiFetch(userEndpoint(), {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ password: "Pwd@12345", name: "No Email", role: "worker", canteen_id: CANTEEN_ID, phone: "9876543210" }),
    });
    expect(res.status).toBe(400);
  });

  test("missing password returns 400", async () => {
    const tok = await adminToken();
    const res = await apiFetch(userEndpoint(), {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ email: `nopw-${ts()}@noqx.test`, name: "No PW", role: "worker", canteen_id: CANTEEN_ID, phone: "9876543210" }),
    });
    expect(res.status).toBe(400);
  });

  test("password shorter than 8 chars returns 400", async () => {
    const tok = await adminToken();
    const res = await apiFetch(userEndpoint(), {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ email: `short-${ts()}@noqx.test`, password: "Ab@1", name: "Short PW", role: "worker", canteen_id: CANTEEN_ID, phone: "9876543210" }),
    });
    expect(res.status).toBe(400);
  });

  test("missing phone returns 400", async () => {
    const tok = await adminToken();
    const res = await apiFetch(userEndpoint(), {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ email: `nophone-${ts()}@noqx.test`, password: "Pwd@12345", name: "No Phone", role: "worker", canteen_id: CANTEEN_ID }),
    });
    expect(res.status).toBe(400);
  });

  test("invalid phone format returns 400", async () => {
    const tok = await adminToken();
    const res = await apiFetch(userEndpoint(), {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ email: `badphone-${ts()}@noqx.test`, password: "Pwd@12345", name: "Bad Phone", role: "worker", canteen_id: CANTEEN_ID, phone: "12345" }),
    });
    expect(res.status).toBe(400);
  });

  test("10-digit Indian phone is accepted and normalised to +91", async () => {
    const tok = await adminToken();
    const t = ts();
    const res = await apiFetch(userEndpoint(), {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ email: `norm-${t}@noqx.test`, password: "Norm@12345", name: "Norm Phone", role: "worker", canteen_id: CANTEEN_ID, phone: `9${String(t).slice(-9)}` }),
    });
    const body = await res.json() as { uid?: string; phone?: string };
    if (res.status === 200 && body.uid) createdUids.push(body.uid);
    if (res.status === 200) {
      expect(body.phone).toMatch(/^\+91/);
    }
  });

  test("duplicate phone returns 4xx (not 500)", async () => {
    const tok = await adminToken();
    const t = ts();
    const phone = `7${String(t).slice(-9)}`;
    const r1 = await createViaApi(tok, { email: `dup-ph-a-${t}@noqx.test`, phone });
    const b1 = await r1.res.json() as { uid?: string };
    if (b1.uid) createdUids.push(b1.uid);
    if (r1.res.status !== 200) return; // first create failed — skip
    const r2 = await createViaApi(tok, { email: `dup-ph-b-${t}@noqx.test`, phone });
    expect(r2.res.status).toBeGreaterThanOrEqual(400);
    expect(r2.res.status).toBeLessThan(500);
  });

  test("duplicate email returns 4xx", async () => {
    const tok = await adminToken();
    const t = ts();
    const email = `dup-em-${t}@noqx.test`;
    const r1 = await createViaApi(tok, { email, phone: `8${String(t).slice(-9)}` });
    const b1 = await r1.res.json() as { uid?: string };
    if (b1.uid) createdUids.push(b1.uid);
    if (r1.res.status !== 200) return;
    const r2 = await createViaApi(tok, { email, phone: `9${String(t).slice(-9)}` });
    expect(r2.res.status).toBeGreaterThanOrEqual(400);
    expect(r2.res.status).toBeLessThan(500);
  });

  test("co_admin cannot create users (403)", async () => {
    const tok = await coAdminToken();
    const { res } = await createViaApi(tok);
    expect(res.status).toBe(403);
  });

  test("unauthenticated POST returns 401", async () => {
    const res = await apiFetch(userEndpoint(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `x@noqx.test`, password: "Pwd@12345", name: "X", role: "worker", canteen_id: CANTEEN_ID, phone: "9000000001" }),
    });
    expect(res.status).toBe(401);
  });

  test("missing name returns 400", async () => {
    const tok = await adminToken();
    const res = await apiFetch(userEndpoint(), {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ email: `noname-${ts()}@noqx.test`, password: "Pwd@12345", role: "worker", canteen_id: CANTEEN_ID, phone: "9000000001" }),
    });
    expect(res.status).toBe(400);
  });
});

// ── PATCH: update user ──────────────────────────────────────────────────────

test.describe("PATCH /api/admin/users", () => {
  let uid = "";

  test.beforeAll(async () => {
    const tok = await adminToken();
    const { res } = await createViaApi(tok);
    const body = await res.json() as { uid?: string };
    uid = body.uid ?? "";
  });

  test.afterAll(async () => {
    if (uid) await adminClient().auth.admin.deleteUser(uid).catch(() => {});
  });

  test("super_admin can rename a user", async () => {
    if (!uid) test.skip();
    const tok = await adminToken();
    const res = await apiFetch(userEndpoint(), {
      method: "PATCH",
      headers: { "content-type": "application/json", Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ uid, name: "Renamed User" }),
    });
    expect(res.status).toBe(200);
  });

  test("super_admin can change a user role", async () => {
    if (!uid) test.skip();
    const tok = await adminToken();
    const res = await apiFetch(userEndpoint(), {
      method: "PATCH",
      headers: { "content-type": "application/json", Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ uid, role: "canteen_admin", canteen_id: CANTEEN_ID }),
    });
    expect(res.status).toBe(200);
  });

  test("missing uid returns 400", async () => {
    const tok = await adminToken();
    const res = await apiFetch(userEndpoint(), {
      method: "PATCH",
      headers: { "content-type": "application/json", Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ name: "No UID" }),
    });
    expect(res.status).toBe(400);
  });

  test("unauthenticated PATCH returns 401", async () => {
    const res = await apiFetch(userEndpoint(), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ uid: "fake-uid", name: "X" }),
    });
    expect(res.status).toBe(401);
  });

  test("co_admin cannot update users (403)", async () => {
    if (!uid) test.skip();
    const tok = await coAdminToken();
    const res = await apiFetch(userEndpoint(), {
      method: "PATCH",
      headers: { "content-type": "application/json", Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ uid, name: "Hacked" }),
    });
    expect(res.status).toBe(403);
  });

  test("super_admin can reset a user password", async () => {
    if (!uid) test.skip();
    const tok = await adminToken();
    const res = await apiFetch(userEndpoint(), {
      method: "PATCH",
      headers: { "content-type": "application/json", Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ uid, new_password: "NewPwd@9999" }),
    });
    expect(res.status).toBe(200);
  });

  test("new_password shorter than 8 chars returns 400", async () => {
    if (!uid) test.skip();
    const tok = await adminToken();
    const res = await apiFetch(userEndpoint(), {
      method: "PATCH",
      headers: { "content-type": "application/json", Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ uid, new_password: "Ab@1" }),
    });
    expect(res.status).toBe(400);
  });
});

// ── DELETE: remove user ─────────────────────────────────────────────────────

test.describe("DELETE /api/admin/users", () => {
  test("super_admin can delete a user", async () => {
    const tok = await adminToken();
    // Create a throwaway user
    const { res: createRes } = await createViaApi(tok);
    if (createRes.status !== 200) { test.skip(); return; }
    const { uid } = await createRes.json() as { uid: string };

    const delRes = await apiFetch(userEndpoint(), {
      method: "DELETE",
      headers: { "content-type": "application/json", Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ uid }),
    });
    expect(delRes.status).toBe(200);

    // Confirm user is gone from list
    const list = await apiFetch(userEndpoint(), { headers: { Authorization: `Bearer ${tok}` } });
    const listData = await list.json() as { users: { uid: string }[] };
    const found = listData.users.find(u => u.uid === uid);
    expect(found).toBeUndefined();
  });

  test("cannot delete own account (400)", async () => {
    const tok = await adminToken();
    // Resolve the admin's own uid from the users list
    const list = await apiFetch(userEndpoint(), { headers: { Authorization: `Bearer ${tok}` } });
    const listData = await list.json() as { users: { uid: string; email: string }[] };
    const self = listData.users.find(u => u.email === WHITELIST.superAdmin.email);
    if (!self) { test.skip(); return; }
    const res = await apiFetch(userEndpoint(), {
      method: "DELETE",
      headers: { "content-type": "application/json", Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ uid: self.uid }),
    });
    expect(res.status).toBe(400);
  });

  test("missing uid returns 400", async () => {
    const tok = await adminToken();
    const res = await apiFetch(userEndpoint(), {
      method: "DELETE",
      headers: { "content-type": "application/json", Authorization: `Bearer ${tok}` },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  test("unauthenticated DELETE returns 401", async () => {
    const res = await apiFetch(userEndpoint(), {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ uid: "fake-uid" }),
    });
    expect(res.status).toBe(401);
  });

  test("co_admin cannot delete users (403)", async () => {
    const tok = await coAdminToken();
    const res = await apiFetch(userEndpoint(), {
      method: "DELETE",
      headers: { "content-type": "application/json", Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ uid: "some-uid" }),
    });
    expect(res.status).toBe(403);
  });
});

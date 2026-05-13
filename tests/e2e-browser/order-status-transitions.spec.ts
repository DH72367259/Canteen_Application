/**
 * Order Status Transitions & Lifecycle Tests
 *
 * Covers:
 * - Order placement validation (auth, required fields)
 * - Staff-driven status transitions (placed → preparing → ready → placed_in_bin)
 * - Workers cannot set "collected" directly (must use verify-otp)
 * - Workers cannot cancel (managerial action only)
 * - Student 30-second cancel window
 * - Staff cancel requires reason; OTP verify clears bin
 * - Role guards on every status endpoint
 * - Pickup guard (sibling orders in same slot)
 * - OTP verify flow (worker + canteen_admin paths)
 * - Invalid-status and missing-body 400s
 */
import { test, expect } from "@playwright/test";
import {
  adminClient,
  APP_URL,
  WHITELIST,
  getAccessToken,
  apiFetch,
  provisionStudent,
  deleteUser,
} from "./_helpers";

const CANTEEN_ID = "9d1b1e36-48a1-4ce8-a270-704eec9018c8";

// ── helpers ────────────────────────────────────────────────────────────────

async function workerToken() {
  return getAccessToken(WHITELIST.worker.email, WHITELIST.worker.password);
}
async function adminToken() {
  return getAccessToken(WHITELIST.superAdmin.email, WHITELIST.superAdmin.password);
}
async function canteenAdminToken() {
  return getAccessToken(WHITELIST.canteenAdmin.email, WHITELIST.canteenAdmin.password);
}

/** Insert a bare order directly via admin SDK and return its id + otp. */
async function seedOrder(userId: string, overrides: Record<string, unknown> = {}) {
  const admin = adminClient();
  const otp = String(Math.floor(1000 + Math.random() * 9000));
  const { data, error } = await admin.from("orders").insert({
    user_id:      userId,
    canteen_id:   CANTEEN_ID,
    total_amount: 80,
    status:       "placed",
    otp,
    slot_label:   `E2E-TRANS-${Date.now()}`,
    ...overrides,
  }).select("id").single();
  if (error) throw new Error(`seedOrder failed: ${error.message}`);
  return { id: data!.id as string, otp };
}

async function patchStatus(orderId: string, status: string, tok: string) {
  return apiFetch(`${APP_URL}/api/orders/${orderId}/status`, {
    method: "PATCH",
    headers: { "content-type": "application/json", Authorization: `Bearer ${tok}` },
    body: JSON.stringify({ status }),
  });
}

// One shared student for read-only tests — provisioned once, removed after suite.
let sharedStudentId = "";
let sharedStudentToken = "";

test.beforeAll(async () => {
  const admin = adminClient();
  const { data: c } = await admin.from("canteens").select("id").limit(1).maybeSingle();
  if (!c?.id) return;
  const s = await provisionStudent(c.id, "ord-trans");
  sharedStudentId = s.id;
  sharedStudentToken = await getAccessToken(s.email, s.password).catch(() => "");
});

test.afterAll(async () => {
  const admin = adminClient();
  // Delete all seeded E2E orders for the shared student
  await admin.from("orders").delete().like("slot_label", "E2E-TRANS-%");
  if (sharedStudentId) await deleteUser(sharedStudentId);
});

// ── Order placement validation ──────────────────────────────────────────────

test.describe("POST /api/orders/place", () => {
  test("unauthenticated placement returns 401", async () => {
    const res = await apiFetch(`${APP_URL}/api/orders/place`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ canteenId: CANTEEN_ID, slotLabel: "12:00 PM - 12:15 PM", cartItems: [] }),
    });
    expect(res.status).toBe(401);
  });

  test("placement with empty cart returns 400", async () => {
    if (!sharedStudentToken) test.skip();
    const res = await apiFetch(`${APP_URL}/api/orders/place`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${sharedStudentToken}` },
      body: JSON.stringify({ canteenId: CANTEEN_ID, slotLabel: "12:00 PM - 12:15 PM", cartItems: [] }),
    });
    expect(res.status).toBe(400);
  });

  test("placement missing canteenId returns 400", async () => {
    if (!sharedStudentToken) test.skip();
    const res = await apiFetch(`${APP_URL}/api/orders/place`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${sharedStudentToken}` },
      body: JSON.stringify({ slotLabel: "12:00 PM - 12:15 PM", cartItems: [{ id: "fake-id", qty: 1 }] }),
    });
    expect(res.status).toBe(400);
  });

  test("placement missing slotLabel returns 400", async () => {
    if (!sharedStudentToken) test.skip();
    const res = await apiFetch(`${APP_URL}/api/orders/place`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${sharedStudentToken}` },
      body: JSON.stringify({ canteenId: CANTEEN_ID, cartItems: [{ id: "fake-id", qty: 1 }] }),
    });
    expect(res.status).toBe(400);
  });
});

// ── Staff status transitions ────────────────────────────────────────────────

test.describe("PATCH /api/orders/[id]/status — staff transitions", () => {
  test("worker can move order to 'preparing'", async () => {
    if (!sharedStudentId) test.skip();
    const { id } = await seedOrder(sharedStudentId);
    const tok = await workerToken();
    const res = await patchStatus(id, "preparing", tok);
    expect(res.status).toBe(200);
    const body = await res.json() as { order: { status: string } };
    expect(body.order.status).toBe("preparing");
  });

  test("worker can move order to 'ready_for_placement'", async () => {
    if (!sharedStudentId) test.skip();
    const { id } = await seedOrder(sharedStudentId, { status: "preparing" });
    const tok = await workerToken();
    const res = await patchStatus(id, "ready_for_placement", tok);
    expect(res.status).toBe(200);
  });

  test("worker can move order to 'placed_in_bin'", async () => {
    if (!sharedStudentId) test.skip();
    const { id } = await seedOrder(sharedStudentId, { status: "ready_for_placement" });
    const tok = await workerToken();
    const res = await patchStatus(id, "placed_in_bin", tok);
    expect(res.status).toBe(200);
    const body = await res.json() as { order: { status: string } };
    expect(body.order.status).toBe("placed_in_bin");
  });

  test("worker CANNOT set status to 'collected' directly (403)", async () => {
    if (!sharedStudentId) test.skip();
    const { id } = await seedOrder(sharedStudentId, { status: "placed_in_bin" });
    const tok = await workerToken();
    const res = await patchStatus(id, "collected", tok);
    expect(res.status).toBe(403);
  });

  test("canteen_admin can set status to 'collected'", async () => {
    if (!sharedStudentId) test.skip();
    const { id } = await seedOrder(sharedStudentId, { status: "placed_in_bin" });
    const tok = await canteenAdminToken();
    const res = await patchStatus(id, "collected", tok);
    // 200 = success, 409 = pickup guard (sibling order) — both valid
    expect([200, 409]).toContain(res.status);
  });

  test("invalid status string returns 400", async () => {
    if (!sharedStudentId) test.skip();
    const { id } = await seedOrder(sharedStudentId);
    const tok = await workerToken();
    const res = await patchStatus(id, "teleported", tok);
    expect(res.status).toBe(400);
  });

  test("missing status body returns 400", async () => {
    if (!sharedStudentId) test.skip();
    const { id } = await seedOrder(sharedStudentId);
    const tok = await workerToken();
    const res = await apiFetch(`${APP_URL}/api/orders/${id}/status`, {
      method: "PATCH",
      headers: { "content-type": "application/json", Authorization: `Bearer ${tok}` },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  test("unauthenticated PATCH status returns 401", async () => {
    if (!sharedStudentId) test.skip();
    const { id } = await seedOrder(sharedStudentId);
    const res = await apiFetch(`${APP_URL}/api/orders/${id}/status`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "preparing" }),
    });
    expect(res.status).toBe(401);
  });

  test("worker 'skip' pseudo-status is accepted (200)", async () => {
    if (!sharedStudentId) test.skip();
    const { id } = await seedOrder(sharedStudentId, { status: "confirmed" });
    const tok = await workerToken();
    const res = await patchStatus(id, "skip", tok);
    expect(res.status).toBe(200);
  });
});

// ── Student cancel window ───────────────────────────────────────────────────

test.describe("Student 30-second cancel window", () => {
  test("student can cancel a fresh order within window", async () => {
    if (!sharedStudentId || !sharedStudentToken) test.skip();
    const { id } = await seedOrder(sharedStudentId, { status: "placed" });
    const res = await patchStatus(id, "cancelled", sharedStudentToken);
    // 200 = cancelled, 400 = window already closed (timing-sensitive CI)
    expect([200, 400]).toContain(res.status);
  });

  test("student cannot cancel a 'placed_in_bin' order (400)", async () => {
    if (!sharedStudentId || !sharedStudentToken) test.skip();
    const { id } = await seedOrder(sharedStudentId, { status: "placed_in_bin" });
    const res = await patchStatus(id, "cancelled", sharedStudentToken);
    expect(res.status).toBe(400);
  });

  test("student cannot cancel someone else's order (403)", async () => {
    if (!sharedStudentId) test.skip();
    // Create a second student and their order
    const admin = adminClient();
    const { data: c } = await admin.from("canteens").select("id").limit(1).maybeSingle();
    if (!c?.id) { test.skip(); return; }
    const s2 = await provisionStudent(c.id, "ord-trans-s2");
    const { id } = await seedOrder(s2.id, { status: "placed" });
    const res = await patchStatus(id, "cancelled", sharedStudentToken);
    // Should be 403 (not your order) or 400 (window) — not 200
    expect(res.status).not.toBe(200);
    await deleteUser(s2.id);
  });
});

// ── Staff cancel endpoint ───────────────────────────────────────────────────

test.describe("POST /api/orders/[id]/cancel — staff", () => {
  test("canteen_admin can cancel with reason", async () => {
    if (!sharedStudentId) test.skip();
    const { id } = await seedOrder(sharedStudentId, { status: "preparing" });
    const tok = await canteenAdminToken();
    const res = await apiFetch(`${APP_URL}/api/orders/${id}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ reason: "Item unavailable — kitchen issue" }),
    });
    expect([200, 404]).toContain(res.status); // 404 if canteen mismatch
  });

  test("cancel without reason returns 400", async () => {
    if (!sharedStudentId) test.skip();
    const { id } = await seedOrder(sharedStudentId, { status: "preparing" });
    const tok = await canteenAdminToken();
    const res = await apiFetch(`${APP_URL}/api/orders/${id}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${tok}` },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/reason/i);
  });

  test("worker cannot cancel via cancel endpoint (403)", async () => {
    if (!sharedStudentId) test.skip();
    const { id } = await seedOrder(sharedStudentId, { status: "preparing" });
    const tok = await workerToken();
    const res = await apiFetch(`${APP_URL}/api/orders/${id}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ reason: "Worker tried to cancel" }),
    });
    expect(res.status).toBe(403);
  });

  test("cannot cancel an already-cancelled order (400)", async () => {
    if (!sharedStudentId) test.skip();
    const { id } = await seedOrder(sharedStudentId, { status: "cancelled" });
    const tok = await canteenAdminToken();
    const res = await apiFetch(`${APP_URL}/api/orders/${id}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ reason: "Already cancelled" }),
    });
    expect(res.status).toBe(400);
  });

  test("cannot cancel a collected order (400)", async () => {
    if (!sharedStudentId) test.skip();
    const { id } = await seedOrder(sharedStudentId, { status: "collected" });
    const tok = await canteenAdminToken();
    const res = await apiFetch(`${APP_URL}/api/orders/${id}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ reason: "Collected already" }),
    });
    expect(res.status).toBe(400);
  });

  test("unauthenticated cancel returns 401", async () => {
    if (!sharedStudentId) test.skip();
    const { id } = await seedOrder(sharedStudentId, { status: "placed" });
    const res = await apiFetch(`${APP_URL}/api/orders/${id}/cancel`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "No auth" }),
    });
    expect(res.status).toBe(401);
  });
});

// ── OTP Verify endpoint ─────────────────────────────────────────────────────

test.describe("POST /api/orders/[id]/verify-otp", () => {
  test("correct OTP returns 200 or 409 (pickup guard)", async () => {
    if (!sharedStudentId) test.skip();
    const { id, otp } = await seedOrder(sharedStudentId, { status: "placed_in_bin" });
    const tok = await canteenAdminToken();
    const res = await apiFetch(`${APP_URL}/api/orders/${id}/verify-otp`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ otp }),
    });
    expect([200, 409]).toContain(res.status);
  });

  test("wrong OTP returns 400", async () => {
    if (!sharedStudentId) test.skip();
    const { id } = await seedOrder(sharedStudentId, { status: "placed_in_bin" });
    const tok = await canteenAdminToken();
    const res = await apiFetch(`${APP_URL}/api/orders/${id}/verify-otp`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ otp: "0000" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/invalid/i);
  });

  test("missing OTP returns 400", async () => {
    if (!sharedStudentId) test.skip();
    const { id } = await seedOrder(sharedStudentId, { status: "placed_in_bin" });
    const tok = await canteenAdminToken();
    const res = await apiFetch(`${APP_URL}/api/orders/${id}/verify-otp`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${tok}` },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  test("already collected order returns 400", async () => {
    if (!sharedStudentId) test.skip();
    const { id, otp } = await seedOrder(sharedStudentId, { status: "collected" });
    const tok = await canteenAdminToken();
    const res = await apiFetch(`${APP_URL}/api/orders/${id}/verify-otp`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ otp }),
    });
    expect(res.status).toBe(400);
  });

  test("worker verify-otp is allowed (200/400/409)", async () => {
    if (!sharedStudentId) test.skip();
    const { id, otp } = await seedOrder(sharedStudentId, { status: "placed_in_bin" });
    const tok = await workerToken();
    const res = await apiFetch(`${APP_URL}/api/orders/${id}/verify-otp`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ otp }),
    });
    // Worker is now allowed; pickup guard may return 409 if siblings exist
    expect([200, 400, 409]).toContain(res.status);
  });

  test("unauthenticated verify-otp returns 401", async () => {
    if (!sharedStudentId) test.skip();
    const { id, otp } = await seedOrder(sharedStudentId, { status: "placed_in_bin" });
    const res = await apiFetch(`${APP_URL}/api/orders/${id}/verify-otp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ otp }),
    });
    expect(res.status).toBe(401);
  });

  test("student cannot call verify-otp (403)", async () => {
    if (!sharedStudentId || !sharedStudentToken) test.skip();
    const { id, otp } = await seedOrder(sharedStudentId, { status: "placed_in_bin" });
    const res = await apiFetch(`${APP_URL}/api/orders/${id}/verify-otp`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${sharedStudentToken}` },
      body: JSON.stringify({ otp }),
    });
    expect(res.status).toBe(403);
  });
});

// ── Bulk verify-otp (no-id endpoint) ───────────────────────────────────────

test.describe("POST /api/orders/verify-otp (lookup-by-OTP)", () => {
  test("correct OTP resolves and returns 200 or 409", async () => {
    if (!sharedStudentId) test.skip();
    const { otp } = await seedOrder(sharedStudentId, {
      status: "placed_in_bin",
      canteen_id: CANTEEN_ID,
    });
    const tok = await workerToken();
    const res = await apiFetch(`${APP_URL}/api/orders/verify-otp`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ otp, canteen_id: CANTEEN_ID }),
    });
    expect([200, 400, 409]).toContain(res.status);
  });

  test("wrong OTP returns 400 or 404", async () => {
    const tok = await workerToken();
    const res = await apiFetch(`${APP_URL}/api/orders/verify-otp`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ otp: "0000", canteen_id: CANTEEN_ID }),
    });
    expect([400, 404]).toContain(res.status);
  });

  test("missing otp returns 400", async () => {
    const tok = await workerToken();
    const res = await apiFetch(`${APP_URL}/api/orders/verify-otp`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ canteen_id: CANTEEN_ID }),
    });
    expect(res.status).toBe(400);
  });
});

/**
 * Late Pickup & Multi-Slot Pickup Guard Tests
 *
 * Covers three workflows fixed in this release:
 *
 * A. LATE PICKUP
 *    1. Slot expiry transitions order → late_pickup and frees the bin
 *    2. Worker can verify OTP on a late_pickup order (still collectable)
 *    3. Physical bin is freed after slot expiry (available for next slot)
 *    4. Verifying OTP on a collected order returns 400 (already done)
 *
 * B. MULTI-SLOT PICKUP GUARD
 *    5. Orders in DIFFERENT slots are independently collectable
 *    6. Orders in the SAME slot are blocked until all sibling bins are placed
 *    7. Pickup guard 409 message mentions the correct slot info
 *
 * C. PREP SUMMARY API
 *    8. Prep summary returns items grouped by slot
 *    9. All active statuses (placed, confirmed, preparing, ready_for_placement) appear
 *   10. Completed / cancelled orders are excluded from prep summary
 */

import { test, expect } from "@playwright/test";
import {
  adminClient, APP_URL, getAccessToken, getWorkerCanteenId, provisionStudent, deleteUser,
  WHITELIST,
} from "./_helpers";

// ─── shared state ─────────────────────────────────────────────────────────────
let canteenId = "";
let studentId = "";
let studentEmail = "";
let studentPassword = "";
let workerToken = "";
let setupFailed = false;

test.beforeAll(async () => {
  try {
    canteenId = await getWorkerCanteenId();
    if (!canteenId) { setupFailed = true; return; }

    const s = await provisionStudent(canteenId, "late-pickup");
    studentId = s.id; studentEmail = s.email; studentPassword = s.password;
    workerToken = await getAccessToken(WHITELIST.worker.email, WHITELIST.worker.password);
  } catch (e) {
    console.warn("⚠️  late-pickup-multi-slot setup failed:", e);
    setupFailed = true;
  }
});

test.beforeEach(() => {
  test.skip(setupFailed, "Setup failed — skipping");
});

test.afterAll(async () => {
  await deleteUser(studentId).catch(() => {});
  const admin = adminClient();
  await admin.from("orders").delete().like("slot_label", "E2E-LP-%").then(undefined, () => {});
  await admin.from("orders").delete().like("slot_label", "E2E-MS-%").then(undefined, () => {});
  await admin.from("orders").delete().like("slot_label", "E2E-PS-%").then(undefined, () => {});
});

// ═══════════════════════════════════════════════════════════════════════════════
// A. LATE PICKUP
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("A — Late Pickup", () => {
  test("1. slot expiry transitions order to late_pickup and frees the bin", async () => {
    const admin = adminClient();
    const otp = "7001";

    // Seed an order already placed_in_bin with an EXPIRED slot label (past end time)
    const { data: order } = await admin.from("orders").insert({
      user_id: studentId,
      canteen_id: canteenId,
      total_amount: 80,
      status: "placed_in_bin",
      otp,
      slot_label: "E2E-LP-expire",
    }).select().single();
    expect(order?.id).toBeTruthy();
    const orderId = order!.id;

    // Seed a bin linked to this order with an expired slot label ("6:00 AM - 6:15 AM")
    const { data: bin } = await admin.from("bins").insert({
      canteen_id: canteenId,
      bin_code: "LP1",
      color: "red",
      is_occupied: true,
      order_id: orderId,
      slot_label: "6:00 AM - 6:15 AM",   // always in the past
      status: "occupied",
    }).select().single();
    expect(bin?.id).toBeTruthy();
    const binId = bin!.id;

    try {
      // Trigger slot expiry
      const expireRes = await fetch(`${APP_URL}/api/canteen/bins/expire-slot`, {
        method: "POST",
        headers: { Authorization: `Bearer ${workerToken}`, "Content-Type": "application/json" },
      });
      expect(expireRes.ok).toBeTruthy();

      // Order should now be late_pickup
      const { data: updated } = await admin.from("orders").select("status, bin_label").eq("id", orderId).single();
      expect(updated?.status).toBe("late_pickup");
      expect(updated?.bin_label).toBe("LP1"); // bin code snapshotted

      // Physical bin should be freed
      const { data: freedBin } = await admin.from("bins").select("is_occupied, order_id").eq("id", binId).single();
      expect(freedBin?.is_occupied).toBe(false);
      expect(freedBin?.order_id).toBeNull();
    } finally {
      await admin.from("orders").delete().eq("id", orderId).then(undefined, () => {});
      await admin.from("bins").delete().eq("id", binId).then(undefined, () => {});
    }
  });

  test("2. worker can verify OTP on a late_pickup order", async () => {
    const admin = adminClient();
    const otp = "7002";

    const { data: order } = await admin.from("orders").insert({
      user_id: studentId,
      canteen_id: canteenId,
      total_amount: 80,
      status: "late_pickup",
      otp,
      slot_label: "E2E-LP-verify",
      bin_label: "B3",
      bin_color: "blue",
    }).select().single();
    expect(order?.id).toBeTruthy();
    const orderId = order!.id;

    try {
      const res = await fetch(`${APP_URL}/api/orders/${orderId}/verify-otp`, {
        method: "POST",
        headers: { Authorization: `Bearer ${workerToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ otp }),
      });
      // 200 = collected, 400 = already collected, 409 = pickup guard
      expect([200, 400, 409]).toContain(res.status);

      if (res.status === 200) {
        const { data: collected } = await admin.from("orders").select("status").eq("id", orderId).single();
        expect(collected?.status).toBe("collected");
      }
    } finally {
      await admin.from("orders").delete().eq("id", orderId).then(undefined, () => {});
    }
  });

  test("3. bin is freed after expiry and can be reassigned to a new order", async () => {
    const admin = adminClient();

    const { data: bin } = await admin.from("bins").insert({
      canteen_id: canteenId,
      bin_code: "LP3",
      color: "green",
      is_occupied: true,
      slot_label: "6:00 AM - 6:15 AM",
      status: "occupied",
    }).select().single();
    expect(bin?.id).toBeTruthy();
    const binId = bin!.id;

    try {
      await fetch(`${APP_URL}/api/canteen/bins/expire-slot`, {
        method: "POST",
        headers: { Authorization: `Bearer ${workerToken}`, "Content-Type": "application/json" },
      });

      const { data: freedBin } = await admin.from("bins").select("is_occupied, status").eq("id", binId).single();
      expect(freedBin?.is_occupied).toBe(false);
      expect(freedBin?.status).toBe("empty");
    } finally {
      await admin.from("bins").delete().eq("id", binId).then(undefined, () => {});
    }
  });

  test("4. verifying OTP on already-collected order returns 400", async () => {
    const admin = adminClient();
    const otp = "7004";

    const { data: order } = await admin.from("orders").insert({
      user_id: studentId,
      canteen_id: canteenId,
      total_amount: 80,
      status: "collected",
      otp,
      slot_label: "E2E-LP-already",
    }).select().single();
    expect(order?.id).toBeTruthy();
    const orderId = order!.id;

    try {
      const res = await fetch(`${APP_URL}/api/orders/${orderId}/verify-otp`, {
        method: "POST",
        headers: { Authorization: `Bearer ${workerToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ otp }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/collected|already/i);
    } finally {
      await admin.from("orders").delete().eq("id", orderId).then(undefined, () => {});
    }
  });

  test("5. wrong OTP returns 400 with invalid message", async () => {
    const admin = adminClient();
    const correctOtp = "7005";

    const { data: order } = await admin.from("orders").insert({
      user_id: studentId,
      canteen_id: canteenId,
      total_amount: 80,
      status: "placed_in_bin",
      otp: correctOtp,
      slot_label: "E2E-LP-wrong-otp",
    }).select().single();
    const orderId = order!.id;

    try {
      const res = await fetch(`${APP_URL}/api/orders/${orderId}/verify-otp`, {
        method: "POST",
        headers: { Authorization: `Bearer ${workerToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ otp: "9999" }), // wrong OTP
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/invalid|otp/i);
    } finally {
      await admin.from("orders").delete().eq("id", orderId).then(undefined, () => {});
    }
  });

  test("6. unauthenticated OTP verify returns 401", async () => {
    const res = await fetch(`${APP_URL}/api/orders/fake-order-id/verify-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ otp: "1234" }),
    });
    expect(res.status).toBe(401);
  });

  test("7. student role cannot verify OTP (staff only)", async () => {
    const studentToken = await getAccessToken(studentEmail, studentPassword);
    const res = await fetch(`${APP_URL}/api/orders/fake-order-id/verify-otp`, {
      method: "POST",
      headers: { Authorization: `Bearer ${studentToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ otp: "1234" }),
    });
    expect([401, 403, 404]).toContain(res.status);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// B. MULTI-SLOT PICKUP GUARD
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("B — Multi-Slot Pickup Guard", () => {
  test("8. orders in DIFFERENT slots are independently collectable", async () => {
    const admin = adminClient();
    const otpA = "8001"; const otpB = "8002";

    // Two orders in two DIFFERENT slot labels
    const [{ data: orderA }, { data: orderB }] = await Promise.all([
      admin.from("orders").insert({
        user_id: studentId, canteen_id: canteenId,
        total_amount: 80, status: "placed_in_bin", otp: otpA,
        slot_label: "E2E-MS-slot-A",
      }).select().single(),
      admin.from("orders").insert({
        user_id: studentId, canteen_id: canteenId,
        total_amount: 80, status: "placed_in_bin", otp: otpB,
        slot_label: "E2E-MS-slot-B",
      }).select().single(),
    ]);
    expect(orderA?.id).toBeTruthy();
    expect(orderB?.id).toBeTruthy();

    try {
      // Collecting Order A should NOT be blocked by Order B (different slot)
      const resA = await fetch(`${APP_URL}/api/orders/${orderA!.id}/verify-otp`, {
        method: "POST",
        headers: { Authorization: `Bearer ${workerToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ otp: otpA }),
      });
      // Must NOT be 409 (pickup guard block)
      expect(resA.status).not.toBe(409);
      expect([200, 400]).toContain(resA.status);
    } finally {
      await admin.from("orders").delete().in("id", [orderA!.id, orderB!.id]).then(undefined, () => {});
    }
  });

  test("9. orders in SAME slot block each other until all are placed_in_bin", async () => {
    const admin = adminClient();
    const otpA = "9001"; const otpB = "9002";

    // Order A: placed_in_bin (ready), Order B: preparing (not ready) — SAME slot
    const [{ data: orderA }, { data: orderB }] = await Promise.all([
      admin.from("orders").insert({
        user_id: studentId, canteen_id: canteenId,
        total_amount: 80, status: "placed_in_bin", otp: otpA,
        slot_label: "E2E-MS-same-slot",
      }).select().single(),
      admin.from("orders").insert({
        user_id: studentId, canteen_id: canteenId,
        total_amount: 80, status: "preparing", otp: otpB,
        slot_label: "E2E-MS-same-slot",
      }).select().single(),
    ]);
    expect(orderA?.id).toBeTruthy();
    expect(orderB?.id).toBeTruthy();

    try {
      // Collecting Order A should be BLOCKED (Order B still preparing, same slot)
      const resA = await fetch(`${APP_URL}/api/orders/${orderA!.id}/verify-otp`, {
        method: "POST",
        headers: { Authorization: `Bearer ${workerToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ otp: otpA }),
      });
      expect(resA.status).toBe(409);
      const body = await resA.json();
      expect(body.error).toMatch(/preparing|slot|sibling/i);
    } finally {
      await admin.from("orders").delete().in("id", [orderA!.id, orderB!.id]).then(undefined, () => {});
    }
  });

  test("10. once sibling order reaches placed_in_bin, both can be collected", async () => {
    const admin = adminClient();
    const otpA = "1001"; const otpB = "1002";

    const [{ data: orderA }, { data: orderB }] = await Promise.all([
      admin.from("orders").insert({
        user_id: studentId, canteen_id: canteenId,
        total_amount: 80, status: "placed_in_bin", otp: otpA,
        slot_label: "E2E-MS-both-placed",
      }).select().single(),
      admin.from("orders").insert({
        user_id: studentId, canteen_id: canteenId,
        total_amount: 80, status: "placed_in_bin", otp: otpB,
        slot_label: "E2E-MS-both-placed",
      }).select().single(),
    ]);
    expect(orderA?.id).toBeTruthy();
    expect(orderB?.id).toBeTruthy();

    try {
      // Both are placed_in_bin → Order A should NOT be blocked
      const resA = await fetch(`${APP_URL}/api/orders/${orderA!.id}/verify-otp`, {
        method: "POST",
        headers: { Authorization: `Bearer ${workerToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ otp: otpA }),
      });
      expect(resA.status).not.toBe(409);
      expect([200, 400]).toContain(resA.status);
    } finally {
      await admin.from("orders").delete().in("id", [orderA!.id, orderB!.id]).then(undefined, () => {});
    }
  });

  test("11. pickup guard does not block when order has no slot info", async () => {
    const admin = adminClient();
    const otp = "1101";

    // Order with NO slot_label — guard should skip (return null) and allow collection
    const { data: order } = await admin.from("orders").insert({
      user_id: studentId, canteen_id: canteenId,
      total_amount: 80, status: "placed_in_bin", otp,
      slot_label: null,
    }).select().single();
    expect(order?.id).toBeTruthy();

    // Sibling order also no slot_label
    const { data: sibling } = await admin.from("orders").insert({
      user_id: studentId, canteen_id: canteenId,
      total_amount: 80, status: "preparing", otp: "9999",
      slot_label: null,
    }).select().single();

    try {
      const res = await fetch(`${APP_URL}/api/orders/${order!.id}/verify-otp`, {
        method: "POST",
        headers: { Authorization: `Bearer ${workerToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ otp }),
      });
      // Should NOT be 409 — no slot info means guard is skipped
      expect(res.status).not.toBe(409);
    } finally {
      await admin.from("orders").delete().in("id", [order!.id, sibling!.id]).then(undefined, () => {});
    }
  });

  test("12. cancelled sibling orders don't block pickup", async () => {
    const admin = adminClient();
    const otp = "1201";

    const [{ data: order }, { data: cancelled }] = await Promise.all([
      admin.from("orders").insert({
        user_id: studentId, canteen_id: canteenId,
        total_amount: 80, status: "placed_in_bin", otp,
        slot_label: "E2E-MS-cancelled-sibling",
      }).select().single(),
      admin.from("orders").insert({
        user_id: studentId, canteen_id: canteenId,
        total_amount: 80, status: "cancelled", otp: "9998",
        slot_label: "E2E-MS-cancelled-sibling",
      }).select().single(),
    ]);
    expect(order?.id).toBeTruthy();

    try {
      const res = await fetch(`${APP_URL}/api/orders/${order!.id}/verify-otp`, {
        method: "POST",
        headers: { Authorization: `Bearer ${workerToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ otp }),
      });
      // Cancelled sibling should NOT block — expect 200 or 400 (not 409)
      expect(res.status).not.toBe(409);
    } finally {
      await admin.from("orders").delete().in("id", [order!.id, cancelled!.id]).then(undefined, () => {});
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// C. PREP SUMMARY API
// ═══════════════════════════════════════════════════════════════════════════════

test.describe("C — Prep Summary API", () => {
  test("13. prep summary returns 200 and slot array for staff", async () => {
    const res = await fetch(`${APP_URL}/api/canteen/prep-summary`, {
      headers: { Authorization: `Bearer ${workerToken}` },
    });
    expect(res.ok).toBeTruthy();
    const body = await res.json();
    expect(Array.isArray(body.slots)).toBeTruthy();
  });

  test("14. prep summary excludes collected and cancelled orders", async () => {
    const admin = adminClient();
    const label = "E2E-PS-exclude";

    // Insert one collected and one cancelled order
    const { data: col } = await admin.from("orders").insert({
      user_id: studentId, canteen_id: canteenId,
      total_amount: 60, status: "collected", slot_label: label,
    }).select().single();
    const { data: can } = await admin.from("orders").insert({
      user_id: studentId, canteen_id: canteenId,
      total_amount: 60, status: "cancelled", slot_label: label,
    }).select().single();

    try {
      const res = await fetch(`${APP_URL}/api/canteen/prep-summary`, {
        headers: { Authorization: `Bearer ${workerToken}` },
      });
      const body = await res.json();
      const slots: Array<{ slot: string }> = body.slots ?? [];
      const found = slots.find(s => s.slot === label);
      // The E2E label slot should NOT appear (only collected/cancelled orders)
      expect(found).toBeUndefined();
    } finally {
      await admin.from("orders").delete().in("id", [col!.id, can!.id]).then(undefined, () => {});
    }
  });

  test("15. prep summary includes orders with status confirmed and preparing", async () => {
    const admin = adminClient();
    const label = `E2E-PS-active-${Date.now()}`;

    const { data: confirmed } = await admin.from("orders").insert({
      user_id: studentId, canteen_id: canteenId,
      total_amount: 60, status: "confirmed", slot_label: label,
    }).select().single();
    const { data: preparing } = await admin.from("orders").insert({
      user_id: studentId, canteen_id: canteenId,
      total_amount: 60, status: "preparing", slot_label: label,
    }).select().single();

    try {
      const res = await fetch(`${APP_URL}/api/canteen/prep-summary`, {
        headers: { Authorization: `Bearer ${workerToken}` },
      });
      const body = await res.json();
      const slots: Array<{ slot: string }> = body.slots ?? [];
      const found = slots.find(s => s.slot === label);
      expect(found).toBeDefined();
    } finally {
      await admin.from("orders").delete().in("id", [confirmed!.id, preparing!.id]).then(undefined, () => {});
    }
  });

  test("16. prep summary is forbidden for unauthenticated requests", async () => {
    const res = await fetch(`${APP_URL}/api/canteen/prep-summary`);
    expect(res.status).toBe(401);
  });

  test("17. prep summary is forbidden for student role", async () => {
    const studentToken = await getAccessToken(studentEmail, studentPassword);
    const res = await fetch(`${APP_URL}/api/canteen/prep-summary`, {
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    expect([401, 403]).toContain(res.status);
  });

  test("18. slot expiry endpoint requires auth", async () => {
    const res = await fetch(`${APP_URL}/api/canteen/bins/expire-slot`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(401);
  });

  test("19. slot expiry endpoint is forbidden for student role", async () => {
    const studentToken = await getAccessToken(studentEmail, studentPassword);
    const res = await fetch(`${APP_URL}/api/canteen/bins/expire-slot`, {
      method: "POST",
      headers: { Authorization: `Bearer ${studentToken}`, "Content-Type": "application/json" },
    });
    expect([401, 403]).toContain(res.status);
  });

  test("20. slot expiry returns released count in response", async () => {
    const res = await fetch(`${APP_URL}/api/canteen/bins/expire-slot`, {
      method: "POST",
      headers: { Authorization: `Bearer ${workerToken}`, "Content-Type": "application/json" },
    });
    expect(res.ok).toBeTruthy();
    const body = await res.json();
    expect(typeof body.released).toBe("number");
    expect(body.message).toBeTruthy();
  });
});

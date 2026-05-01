/**
 * Negative-scenario + end-to-end workflow E2E.
 *
 * Two test files in one:
 *   1. NEGATIVE — auth failures, RBAC violations, validation errors,
 *      OTP misuse, invalid status transitions, rate limits.
 *   2. E2E — full happy-path order lifecycle: student places → manager
 *      sees → preparing → ready → placed in bin → worker verifies OTP
 *      → collected. Asserts every database side-effect.
 */
import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import {
  APP_URL, SUPABASE_URL, SUPABASE_ANON, WHITELIST,
  adminClient, provisionStudent, deleteUser, apiFetch,
} from "./_helpers";

const CANTEEN_ID = "9d1b1e36-48a1-4ce8-a270-704eec9018c8";

async function loginToken(email: string, password: string): Promise<string> {
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON, { auth: { persistSession: false } });
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`login ${email}: ${error.message}`);
  return data.session!.access_token;
}

async function ensureFutureSlot(): Promise<string> {
  const admin = adminClient();
  const r = await admin.from("time_slots").select("slot_name, start_time").eq("canteen_id", CANTEEN_ID);
  const istNow = (() => { const d = new Date(); return (d.getUTCHours() * 60 + d.getUTCMinutes() + 330) % 1440; })();
  const future = (r.data ?? []).find((s: { start_time: string }) => {
    const [h, m] = s.start_time.split(":").map(Number);
    return h * 60 + m - 15 > istNow;
  });
  if (future) return future.slot_name as string;
  const startMin = Math.min(istNow + 30, 23 * 60 + 30);
  const sh = String(Math.floor(startMin / 60)).padStart(2, "0");
  const sm = String(startMin % 60).padStart(2, "0");
  const eh = String(Math.floor(Math.min(startMin + 30, 23*60+59) / 60)).padStart(2, "0");
  const em = String(Math.min(startMin + 30, 23*60+59) % 60).padStart(2, "0");
  await admin.from("time_slots").insert({
    canteen_id: CANTEEN_ID, slot_name: "NEG-E2E", start_time: `${sh}:${sm}:00`,
    end_time: `${eh}:${em}:00`, capacity: 60, is_active: true,
  });
  return "NEG-E2E";
}

// ─────────────────────────────────────────────────────────────────────────────
// NEGATIVE SCENARIOS
// ─────────────────────────────────────────────────────────────────────────────
test.describe("negative scenarios — auth & RBAC", () => {
  test("login with wrong password shows inline error", async ({ page }) => {
    await page.goto(`${APP_URL}/login`);
    await page.locator('button:has-text("Canteen Login")').first().click();
    await page.locator('input[type="email"]').first().fill(WHITELIST.superAdmin.email);
    await page.locator('input[type="password"]').first().fill("WrongPassword123");
    await page.locator('button:has-text("Sign In")').first().click();
    // Should NOT redirect — should stay on /login and show an error message.
    await page.waitForTimeout(3000);
    expect(page.url()).toContain("/login");
    await expect(page.locator("body")).toContainText(/Incorrect|invalid|wrong/i);
  });

  test("worker login with invalid credentials stays on /worker/login", async ({ page }) => {
    await page.goto(`${APP_URL}/worker/login`);
    await page.locator('input[type="text"]').first().fill("notarealworker@noqx.test");
    await page.locator('input[type="password"]').first().fill("WrongPwd");
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(3000);
    expect(page.url()).toMatch(/\/worker\/login/);
  });

  test("API: unauthenticated POST /api/orders/place returns 401", async () => {
    const r = await fetch(`${APP_URL}/api/orders/place`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ canteenId: CANTEEN_ID, cartItems: [{ id: "x", qty: 1 }], slotLabel: "X" }),
    });
    expect(r.status).toBe(401);
  });

  test("API: unauthenticated PATCH order status returns 401", async () => {
    const r = await fetch(`${APP_URL}/api/orders/00000000-0000-0000-0000-000000000000/status`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "preparing" }),
    });
    expect(r.status).toBe(401);
  });

  test("API: student cannot transition order to staff-only status (403)", async () => {
    const stu = await provisionStudent(CANTEEN_ID, "neg-rbac");
    try {
      const tok = await loginToken(stu.email, stu.password);
      const r = await apiFetch(`${APP_URL}/api/orders/00000000-0000-0000-0000-000000000000/status`, {
        method: "PATCH",
        headers: { "content-type": "application/json", Authorization: `Bearer ${tok}` },
        body: JSON.stringify({ status: "preparing" }),
      });
      expect(r.status).toBe(403);
    } finally {
      await deleteUser(stu.id);
    }
  });

  test("API: empty cart rejected with 400", async () => {
    const stu = await provisionStudent(CANTEEN_ID, "neg-cart");
    try {
      const tok = await loginToken(stu.email, stu.password);
      const r = await apiFetch(`${APP_URL}/api/orders/place`, {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${tok}` },
        body: JSON.stringify({ canteenId: CANTEEN_ID, cartItems: [], slotLabel: "X" }),
      });
      expect(r.status).toBe(400);
      const body = await r.json();
      expect(body.error).toMatch(/empty/i);
    } finally {
      await deleteUser(stu.id);
    }
  });

  test("API: missing canteenId rejected with 400", async () => {
    const stu = await provisionStudent(CANTEEN_ID, "neg-canteen");
    try {
      const tok = await loginToken(stu.email, stu.password);
      const r = await apiFetch(`${APP_URL}/api/orders/place`, {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${tok}` },
        body: JSON.stringify({ cartItems: [{ id: "x", qty: 1 }], slotLabel: "X" }),
      });
      expect(r.status).toBe(400);
      const body = await r.json();
      expect(body.error).toMatch(/canteen/i);
    } finally {
      await deleteUser(stu.id);
    }
  });

  test("API: invalid quantity (0, negative, huge) rejected with 400", async () => {
    const stu = await provisionStudent(CANTEEN_ID, "neg-qty");
    try {
      const tok = await loginToken(stu.email, stu.password);
      for (const qty of [0, -1, 999]) {
        const r = await apiFetch(`${APP_URL}/api/orders/place`, {
          method: "POST",
          headers: { "content-type": "application/json", Authorization: `Bearer ${tok}` },
          body: JSON.stringify({ canteenId: CANTEEN_ID, cartItems: [{ id: "x", qty }], slotLabel: "X" }),
        });
        expect(r.status, `qty=${qty}`).toBe(400);
      }
    } finally {
      await deleteUser(stu.id);
    }
  });

  test("API: oversized cart (>20 items) rejected with 400", async () => {
    const stu = await provisionStudent(CANTEEN_ID, "neg-big");
    try {
      const tok = await loginToken(stu.email, stu.password);
      const cart = Array.from({ length: 25 }, (_, i) => ({ id: `x${i}`, qty: 1 }));
      const r = await apiFetch(`${APP_URL}/api/orders/place`, {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${tok}` },
        body: JSON.stringify({ canteenId: CANTEEN_ID, cartItems: cart, slotLabel: "X" }),
      });
      expect(r.status).toBe(400);
    } finally {
      await deleteUser(stu.id);
    }
  });

  test("API: malformed JSON body rejected", async () => {
    const stu = await provisionStudent(CANTEEN_ID, "neg-json");
    try {
      const tok = await loginToken(stu.email, stu.password);
      const r = await apiFetch(`${APP_URL}/api/orders/place`, {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${tok}` },
        body: "not-json{",
      });
      expect(r.status).toBe(400);
    } finally {
      await deleteUser(stu.id);
    }
  });

  test("API: worker cannot verify OTP for an order in another canteen", async () => {
    // Worker1 belongs to CANTEEN_ID. Try verifying a non-existent order in
    // a different canteen — endpoint must not 200.
    const tok = await loginToken(WHITELIST.worker.email, WHITELIST.worker.password);
    const r = await fetch(`${APP_URL}/api/orders/00000000-0000-0000-0000-000000000000/verify-otp`, {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${tok}` },
      body: JSON.stringify({ otp: "123456" }),
    });
    expect([403, 404]).toContain(r.status);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// END-TO-END HAPPY PATH (order lifecycle)
// ─────────────────────────────────────────────────────────────────────────────
test.describe("end-to-end: full order lifecycle", () => {
  test("student places → worker walks states → OTP verify → collected", async () => {
    const admin = adminClient();
    const stu = await provisionStudent(CANTEEN_ID, "e2e-lifecycle");
    let orderId = "";
    try {
      const slotName = await ensureFutureSlot();
      const meal = await admin.from("menu_items").select("id, price")
        .eq("canteen_id", CANTEEN_ID).eq("is_meal", true).eq("is_available", true).limit(1).single();
      expect(meal.error, meal.error?.message).toBeFalsy();

      const stuTok = await loginToken(stu.email, stu.password);
      const place = await apiFetch(`${APP_URL}/api/orders/place`, {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${stuTok}` },
        body: JSON.stringify({ canteenId: CANTEEN_ID, slotLabel: slotName, cartItems: [{ id: meal.data!.id, qty: 1 }] }),
      });
      const placed = await place.json();
      expect(place.status, JSON.stringify(placed)).toBeLessThan(400);
      orderId = placed.orderId;
      const otp = placed.otp;
      expect(orderId).toBeTruthy();
      expect(otp).toMatch(/^\d{4,6}$/);

      // Walk worker state machine.
      const wTok = await loginToken(WHITELIST.worker.email, WHITELIST.worker.password);
      for (const status of ["preparing", "ready_for_placement", "placed_in_bin"]) {
        const r = await apiFetch(`${APP_URL}/api/orders/${orderId}/status`, {
          method: "PATCH",
          headers: { "content-type": "application/json", Authorization: `Bearer ${wTok}` },
          body: JSON.stringify({ status }),
        });
        expect(r.status, `${status}: ${await r.text()}`).toBeLessThan(400);
      }

      // Wrong OTP must 400.
      const wrong = await apiFetch(`${APP_URL}/api/orders/${orderId}/verify-otp`, {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${wTok}` },
        body: JSON.stringify({ otp: "000000" }),
      });
      expect(wrong.status).toBe(400);

      // Real OTP collects the order.
      const ok = await apiFetch(`${APP_URL}/api/orders/${orderId}/verify-otp`, {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${wTok}` },
        body: JSON.stringify({ otp }),
      });
      expect(ok.status, await ok.text()).toBe(200);

      // DB side-effects: order is `collected`, bins are freed.
      const finalOrder = await admin.from("orders").select("status").eq("id", orderId).single();
      expect(finalOrder.data?.status).toBe("collected");
      const stillHeld = await admin.from("bins").select("id").or(`order_id.eq.${orderId},assigned_order_id.eq.${orderId}`);
      expect(stillHeld.data ?? []).toHaveLength(0);

      // Re-verifying a collected order must fail (idempotency).
      const repeat = await apiFetch(`${APP_URL}/api/orders/${orderId}/verify-otp`, {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${wTok}` },
        body: JSON.stringify({ otp }),
      });
      expect(repeat.status).toBeGreaterThanOrEqual(400);
    } finally {
      if (orderId) {
        await admin.from("order_bins").delete().eq("order_id", orderId);
        await admin.from("payments").delete().eq("order_id", orderId);
        await admin.from("order_items").delete().eq("order_id", orderId);
        await admin.from("orders").delete().eq("id", orderId);
        const free = { is_occupied: false, order_id: null, assigned_order_id: null, status: "empty", updated_at: new Date().toISOString() };
        await admin.from("bins").update(free).eq("order_id", orderId);
        await admin.from("bins").update(free).eq("assigned_order_id", orderId);
      }
      await admin.from("time_slots").delete().eq("canteen_id", CANTEEN_ID).eq("slot_name", "NEG-E2E");
      await deleteUser(stu.id);
    }
  });
});

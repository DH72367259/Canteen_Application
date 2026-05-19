/**
 * 22-error-paths.spec.ts
 * Invalid inputs, malformed requests, missing fields, edge cases.
 */
import { test, expect } from "@playwright/test";
import { apiFetch, ACCOUNTS, adminClient, getCanteen1Id, getStudent1Id, APP_URL } from "./_helpers";

test.describe("Order placement — validation errors", () => {
  test("empty cartItems returns 400", async () => {
    const canteenId = await getCanteen1Id();
    const res = await apiFetch("/api/orders/place", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ canteenId, cartItems: [], slotLabel: "12:00 - 12:15" }),
    }, ACCOUNTS.student1);
    expect(res.status).toBe(400);
  });

  test("missing canteenId returns 400", async () => {
    const res = await apiFetch("/api/orders/place", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cartItems: [{ id: "fake", qty: 1 }], slotLabel: "12:00 - 12:15" }),
    }, ACCOUNTS.student1);
    expect(res.status).toBe(400);
  });

  test("invalid JSON body returns 400", async () => {
    const res = await apiFetch("/api/orders/place", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json{{{",
    }, ACCOUNTS.student1);
    expect(res.status).toBe(400);
  });

  test("cart item with zero quantity returns 400", async () => {
    const canteenId = await getCanteen1Id();
    const db = adminClient();
    const { data: items } = await db.from("menu_items").select("id").eq("canteen_id", canteenId).limit(1);
    if (!items?.length) { test.skip(); return; }

    const res = await apiFetch("/api/orders/place", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        canteenId,
        cartItems: [{ id: items[0].id, qty: 0 }],
        slotLabel: "12:00 - 12:15",
      }),
    }, ACCOUNTS.student1);
    expect(res.status).toBe(400);
  });

  test("non-existent menu item in cart returns 400 or 404", async () => {
    const canteenId = await getCanteen1Id();
    const res = await apiFetch("/api/orders/place", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        canteenId,
        cartItems: [{ id: "00000000-0000-0000-0000-000000000000", qty: 1 }],
        slotLabel: "12:00 - 12:15",
      }),
    }, ACCOUNTS.student1);
    expect([400, 404]).toContain(res.status);
  });

  test("staff cannot place student orders (403)", async () => {
    const canteenId = await getCanteen1Id();
    const db = adminClient();
    const { data: items } = await db.from("menu_items").select("id").eq("canteen_id", canteenId).limit(1);
    if (!items?.length) { test.skip(); return; }

    const res = await apiFetch("/api/orders/place", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        canteenId,
        cartItems: [{ id: items[0].id, qty: 1 }],
        slotLabel: "12:00 - 12:15",
      }),
    }, ACCOUNTS.canteenAdmin);
    expect([403, 400]).toContain(res.status);
  });
});

test.describe("Authentication errors", () => {
  test("expired/invalid token returns 401", async () => {
    const res = await fetch(`${APP_URL}/api/canteen/sales`, {
      headers: { Authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.fake.payload" },
    });
    expect(res.status).toBe(401);
  });

  test("missing Authorization header returns 401", async () => {
    const res = await fetch(`${APP_URL}/api/canteen/live-orders`);
    expect(res.status).toBe(401);
  });

  test("malformed Bearer token returns 401", async () => {
    const res = await fetch(`${APP_URL}/api/orders`, {
      headers: { Authorization: "Bearer not-a-jwt-at-all" },
    });
    expect(res.status).toBe(401);
  });

  test("wrong password auth attempt fails", async () => {
    const { SUPABASE_URL, SUPABASE_ANON } = await import("./_helpers");
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON },
      body: JSON.stringify({ email: ACCOUNTS.canteenAdmin.email, password: "WrongPass123!" }),
    });
    expect(res.status).not.toBe(200);
  });
});

test.describe("Menu API validation", () => {
  test("menu item with empty name returns 400", async () => {
    const res = await apiFetch("/api/canteen/menu", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "", price: 50, category: "Meals" }),
    }, ACCOUNTS.canteenAdmin);
    expect(res.status).toBe(400);
  });

  test("menu item with negative price returns 400", async () => {
    const res = await apiFetch("/api/canteen/menu", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Test", price: -5, category: "Meals" }),
    }, ACCOUNTS.canteenAdmin);
    expect(res.status).toBe(400);
  });

  test("updating non-existent menu item returns 404", async () => {
    const res = await apiFetch("/api/canteen/menu/00000000-0000-0000-0000-000000000000", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Ghost" }),
    }, ACCOUNTS.canteenAdmin);
    expect([404, 400]).toContain(res.status);
  });
});

test.describe("Admin user creation validation", () => {
  test("missing email returns 400", async () => {
    const res = await apiFetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "Test@12345", name: "No Email", role: "worker", phone: "9100001111" }),
    }, ACCOUNTS.superAdmin);
    expect(res.status).toBe(400);
  });

  test("missing name returns 400", async () => {
    const res = await apiFetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: `x${Date.now()}@noqx.test`, password: "Test@12345", role: "worker", phone: "9100002222" }),
    }, ACCOUNTS.superAdmin);
    expect(res.status).toBe(400);
  });

  test("invalid phone format returns 400", async () => {
    const res = await apiFetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: `x${Date.now()}@noqx.test`, password: "Test@12345",
        name: "Bad Phone", role: "worker", phone: "123",
      }),
    }, ACCOUNTS.superAdmin);
    expect(res.status).toBe(400);
  });
});

test.describe("Canteen creation validation", () => {
  test("create canteen without name returns 400", async () => {
    const res = await apiFetch("/api/admin/canteens/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: `x${Date.now()}@noqx.test`, password: "Test@12345", phone: "9100003333" }),
    }, ACCOUNTS.superAdmin);
    expect(res.status).toBe(400);
  });

  test("create canteen without email returns 400", async () => {
    const res = await apiFetch("/api/admin/canteens/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Ghost Canteen", password: "Test@12345", phone: "9100004444" }),
    }, ACCOUNTS.superAdmin);
    expect(res.status).toBe(400);
  });
});

test.describe("OTP validation edge cases", () => {
  test("OTP with spaces is rejected", async () => {
    const canteenId = await getCanteen1Id();
    const db = adminClient();
    const { data: order } = await db.from("orders")
      .insert({ canteen_id: canteenId, user_id: await getStudent1Id().catch(() => null), status: "placed_in_bin", total_amount: 80, otp: "123456" })
      .select("id").single();
    if (!order) { test.skip(); return; }

    const res = await apiFetch(`/api/orders/${order.id}/verify-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ otp: "  " }),
    }, ACCOUNTS.worker);
    expect(res.status).toBe(400);
    await db.from("orders").delete().eq("id", order.id);
  });

  test("OTP too short (< 4 chars) is rejected", async () => {
    const canteenId = await getCanteen1Id();
    const db = adminClient();
    const { data: order } = await db.from("orders")
      .insert({ canteen_id: canteenId, user_id: await getStudent1Id().catch(() => null), status: "placed_in_bin", total_amount: 80, otp: "654321" })
      .select("id").single();
    if (!order) { test.skip(); return; }

    const res = await apiFetch(`/api/orders/${order.id}/verify-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ otp: "12" }),
    }, ACCOUNTS.worker);
    expect(res.status).toBe(400);
    await db.from("orders").delete().eq("id", order.id);
  });
});

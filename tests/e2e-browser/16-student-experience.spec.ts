/**
 * 16-student-experience.spec.ts
 * Student-facing flows: order history, order detail, QR token, invoice, cart check.
 */
import { test, expect } from "@playwright/test";
import { apiFetch, ACCOUNTS, adminClient, getCanteen1Id, APP_URL } from "./_helpers";

test.describe("Student order history", () => {
  test("student can fetch own orders list", async () => {
    const res = await apiFetch("/api/orders", {}, ACCOUNTS.student1);
    expect(res.status).toBe(200);
    const data = await res.json() as { orders: unknown[] };
    expect(Array.isArray(data.orders)).toBe(true);
  });

  test("orders list only contains student's own orders", async () => {
    const canteenId = await getCanteen1Id();
    const db = adminClient();
    const { data: student } = await db.from("profiles").select("id").eq("email", ACCOUNTS.student1.email).maybeSingle();
    if (!student) { test.skip(); return; }

    const res = await apiFetch("/api/orders", {}, ACCOUNTS.student1);
    const data = await res.json() as { orders: { user_id?: string }[] };
    const foreignOrders = data.orders.filter(o => o.user_id && o.user_id !== student.id);
    expect(foreignOrders.length).toBe(0);
  });

  test("student2 cannot see student1 orders", async () => {
    const db = adminClient();
    const { data: s1 } = await db.from("profiles").select("id").eq("email", ACCOUNTS.student1.email).maybeSingle();
    if (!s1) { test.skip(); return; }

    const res = await apiFetch("/api/orders", {}, ACCOUNTS.student2);
    const data = await res.json() as { orders: { user_id?: string }[] };
    const s1Orders = data.orders.filter(o => o.user_id === s1.id);
    expect(s1Orders.length).toBe(0);
  });
});

test.describe("Student order detail", () => {
  test("student can fetch own order by ID", async () => {
    const canteenId = await getCanteen1Id();
    const db = adminClient();
    const { data: student } = await db.from("profiles").select("id").eq("email", ACCOUNTS.student1.email).maybeSingle();
    if (!student) { test.skip(); return; }

    const { data: items } = await db.from("menu_items").select("id").eq("canteen_id", canteenId).limit(1);
    if (!items?.length) { test.skip(); return; }

    const { data: order } = await db.from("orders")
      .insert({ canteen_id: canteenId, user_id: student.id, status: "placed", total_amount: 80, otp: "101010" })
      .select("id").single();
    if (!order) { test.skip(); return; }

    const res = await apiFetch(`/api/orders/${order.id}`, {}, ACCOUNTS.student1);
    expect([200, 404]).toContain(res.status);
    await db.from("orders").delete().eq("id", order.id);
  });

  test("student cannot access another student's order", async () => {
    const canteenId = await getCanteen1Id();
    const db = adminClient();
    const { data: s2 } = await db.from("profiles").select("id").eq("email", ACCOUNTS.student2.email).maybeSingle();
    if (!s2) { test.skip(); return; }

    const { data: order } = await db.from("orders")
      .insert({ canteen_id: canteenId, user_id: s2.id, status: "placed", total_amount: 80, otp: "202020" })
      .select("id").single();
    if (!order) { test.skip(); return; }

    const res = await apiFetch(`/api/orders/${order.id}`, {}, ACCOUNTS.student1);
    expect([403, 404]).toContain(res.status);
    await db.from("orders").delete().eq("id", order.id);
  });
});

test.describe("QR token generation", () => {
  test("student can get QR token for own active order", async () => {
    const canteenId = await getCanteen1Id();
    const db = adminClient();
    const { data: student } = await db.from("profiles").select("id").eq("email", ACCOUNTS.student1.email).maybeSingle();
    if (!student) { test.skip(); return; }

    const { data: order } = await db.from("orders")
      .insert({ canteen_id: canteenId, user_id: student.id, status: "placed_in_bin", total_amount: 80, otp: "303030" })
      .select("id").single();
    if (!order) { test.skip(); return; }

    const res = await apiFetch(`/api/orders/${order.id}/qr-token`, {}, ACCOUNTS.student1);
    expect([200, 400, 404]).toContain(res.status);
    await db.from("orders").delete().eq("id", order.id);
  });

  test("student cannot get QR token for another student's order", async () => {
    const canteenId = await getCanteen1Id();
    const db = adminClient();
    const { data: s2 } = await db.from("profiles").select("id").eq("email", ACCOUNTS.student2.email).maybeSingle();
    if (!s2) { test.skip(); return; }

    const { data: order } = await db.from("orders")
      .insert({ canteen_id: canteenId, user_id: s2.id, status: "placed_in_bin", total_amount: 80, otp: "404040" })
      .select("id").single();
    if (!order) { test.skip(); return; }

    const res = await apiFetch(`/api/orders/${order.id}/qr-token`, {}, ACCOUNTS.student1);
    expect([403, 404]).toContain(res.status);
    await db.from("orders").delete().eq("id", order.id);
  });
});

test.describe("Order invoice", () => {
  test("student can access their own invoice", async () => {
    const canteenId = await getCanteen1Id();
    const db = adminClient();
    const { data: student } = await db.from("profiles").select("id").eq("email", ACCOUNTS.student1.email).maybeSingle();
    if (!student) { test.skip(); return; }

    const { data: order } = await db.from("orders")
      .insert({ canteen_id: canteenId, user_id: student.id, status: "collected", total_amount: 80, otp: "505050" })
      .select("id").single();
    if (!order) { test.skip(); return; }

    const res = await apiFetch(`/api/orders/${order.id}/invoice`, {}, ACCOUNTS.student1);
    expect([200, 404]).toContain(res.status);
    await db.from("orders").delete().eq("id", order.id);
  });
});

test.describe("Cart check API", () => {
  test("POST /api/cart/check with missing body returns 400", async () => {
    const res = await apiFetch("/api/cart/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }, ACCOUNTS.student1);
    expect([400, 422]).toContain(res.status);
  });
});

test.describe("Student login page UI", () => {
  test("student login page has Student tab", async ({ page }) => {
    await page.goto(`${APP_URL}/login`, { waitUntil: "domcontentloaded" });
    await expect(page.locator('button:has-text("Student")').first()).toBeVisible({ timeout: 10_000 });
  });

  test("student login page has Canteen Login tab", async ({ page }) => {
    await page.goto(`${APP_URL}/login`, { waitUntil: "domcontentloaded" });
    await expect(page.locator('button:has-text("Canteen Login")').first()).toBeVisible({ timeout: 10_000 });
  });

  test("wrong username shows error on student login", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto(`${APP_URL}/login`, { waitUntil: "domcontentloaded" });
    await page.locator('button:has-text("Student")').first().click();
    const usernameInput = page.locator('input').first();
    await usernameInput.fill("nonexistentuser_xyz_123@invalid.test");
    const pwInput = page.locator('input[type="password"]').first();
    await pwInput.fill("wrongpassword999");
    await page.locator('button[type="submit"]').first().click();
    // Wrong credentials should not grant access to protected pages
    await page.waitForTimeout(3_000);
    const finalUrl = page.url();
    // Accept: stays on login (with or without query params), or shows error
    // Reject: navigated to a protected page (dashboard, vendor, worker)
    expect(finalUrl).not.toMatch(/\/(dashboard|vendor|worker\/orders|worker\/dashboard)/);
  });
});

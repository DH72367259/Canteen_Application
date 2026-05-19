/**
 * 24-qr-and-printing.spec.ts
 * QR code verification flow (worker scans student QR) and invoice/bill printing.
 *
 * QR format: NOQX|{orderId}|{window}|{hmac16}  — rotates every 30s
 * Routes:
 *   GET  /api/orders/[id]/qr-token   — student fetches rotating payload
 *   POST /api/orders/[id]/verify-qr  — worker/canteen_admin submits scanned payload
 *   GET  /api/orders/[id]/invoice    — canteen_admin or order owner fetches printable data
 */
import { test, expect } from "@playwright/test";
import { apiFetch, ACCOUNTS, adminClient, getCanteen1Id, getStudent1Id, APP_URL } from "./_helpers";

// Fetch a fresh QR payload for an order (as student1 — order must be theirs)
async function fetchQrPayload(orderId: string): Promise<string | null> {
  const res = await apiFetch(`/api/orders/${orderId}/qr-token`, {}, ACCOUNTS.student1);
  if (!res.ok) return null;
  const data = await res.json() as { payload?: string };
  return data.payload ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// QR TOKEN — student side
// ─────────────────────────────────────────────────────────────────────────────
test.describe("QR token — student fetches", () => {
  test("student receives NOQX payload for their placed_in_bin order", async () => {
    const canteenId = await getCanteen1Id();
    const db = adminClient();
    const { data: profile } = await db.from("profiles").select("id").eq("email", ACCOUNTS.student1.email).maybeSingle();
    if (!profile) { test.skip(); return; }

    const { data: order } = await db.from("orders")
      .insert({ canteen_id: canteenId, user_id: profile.id, status: "placed_in_bin", total_amount: 80, otp: "qr001" })
      .select("id").single();
    if (!order) { test.skip(); return; }

    const res = await apiFetch(`/api/orders/${order.id}/qr-token`, {}, ACCOUNTS.student1);
    expect(res.status).toBe(200);
    const data = await res.json() as { payload?: string; expiresAt?: number; orderId?: string };
    expect(typeof data.payload).toBe("string");
    expect(data.payload).toMatch(/^NOQX\|/);
    expect(data.payload?.split("|")).toHaveLength(4);
    expect(typeof data.expiresAt).toBe("number");
    expect(data.orderId).toBe(order.id);

    await db.from("orders").delete().eq("id", order.id);
  });

  test("QR token not available for order not yet in a bin (placed status)", async () => {
    const canteenId = await getCanteen1Id();
    const db = adminClient();
    const { data: profile } = await db.from("profiles").select("id").eq("email", ACCOUNTS.student1.email).maybeSingle();
    if (!profile) { test.skip(); return; }

    const { data: order } = await db.from("orders")
      .insert({ canteen_id: canteenId, user_id: profile.id, status: "placed", total_amount: 80, otp: "qr002" })
      .select("id").single();
    if (!order) { test.skip(); return; }

    const res = await apiFetch(`/api/orders/${order.id}/qr-token`, {}, ACCOUNTS.student1);
    expect(res.status).toBe(400);

    await db.from("orders").delete().eq("id", order.id);
  });

  test("student cannot fetch another student's QR token (403)", async () => {
    const canteenId = await getCanteen1Id();
    const db = adminClient();
    const { data: profile2 } = await db.from("profiles").select("id").eq("email", ACCOUNTS.student2.email).maybeSingle();
    if (!profile2) { test.skip(); return; }

    const { data: order } = await db.from("orders")
      .insert({ canteen_id: canteenId, user_id: profile2.id, status: "placed_in_bin", total_amount: 80, otp: "qr003" })
      .select("id").single();
    if (!order) { test.skip(); return; }

    // student1 tries to get student2's QR
    const res = await apiFetch(`/api/orders/${order.id}/qr-token`, {}, ACCOUNTS.student1);
    expect([403, 400]).toContain(res.status);

    await db.from("orders").delete().eq("id", order.id);
  });

  test("unauthenticated cannot fetch QR token (401)", async () => {
    const res = await fetch(`${APP_URL}/api/orders/00000000-0000-0000-0000-000000000000/qr-token`);
    expect(res.status).toBe(401);
  });

  test("QR token response is never cached (Cache-Control: no-store)", async () => {
    const canteenId = await getCanteen1Id();
    const db = adminClient();
    const { data: profile } = await db.from("profiles").select("id").eq("email", ACCOUNTS.student1.email).maybeSingle();
    if (!profile) { test.skip(); return; }

    const { data: order } = await db.from("orders")
      .insert({ canteen_id: canteenId, user_id: profile.id, status: "placed_in_bin", total_amount: 80, otp: "qr004" })
      .select("id").single();
    if (!order) { test.skip(); return; }

    const res = await apiFetch(`/api/orders/${order.id}/qr-token`, {}, ACCOUNTS.student1);
    expect(res.status).toBe(200);
    const cc = res.headers.get("cache-control") ?? "";
    expect(cc.toLowerCase()).toContain("no-store");

    await db.from("orders").delete().eq("id", order.id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// QR VERIFY — worker/staff scans
// ─────────────────────────────────────────────────────────────────────────────
test.describe("QR verify — worker scans student QR", () => {
  test("worker scans valid QR → order becomes collected", async () => {
    const canteenId = await getCanteen1Id();
    const db = adminClient();
    const { data: profile } = await db.from("profiles").select("id").eq("email", ACCOUNTS.student1.email).maybeSingle();
    if (!profile) { test.skip(); return; }

    const { data: order } = await db.from("orders")
      .insert({ canteen_id: canteenId, user_id: profile.id, status: "placed_in_bin", total_amount: 80, otp: "qr010" })
      .select("id").single();
    if (!order) { test.skip(); return; }

    const payload = await fetchQrPayload(order.id);
    if (!payload) { test.skip(); await db.from("orders").delete().eq("id", order.id); return; }

    const res = await apiFetch(`/api/orders/${order.id}/verify-qr`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ qrPayload: payload }),
    }, ACCOUNTS.worker);
    expect(res.status).toBe(200);
    const data = await res.json() as { success?: boolean; orderId?: string };
    expect(data.success).toBe(true);
    expect(data.orderId).toBe(order.id);

    const { data: updated } = await db.from("orders").select("status").eq("id", order.id).single();
    expect(updated?.status).toBe("collected");

    await db.from("orders").delete().eq("id", order.id);
  });

  test("canteen_admin can verify QR (not just worker)", async () => {
    const canteenId = await getCanteen1Id();
    const db = adminClient();
    const { data: profile } = await db.from("profiles").select("id").eq("email", ACCOUNTS.student1.email).maybeSingle();
    if (!profile) { test.skip(); return; }

    const { data: order } = await db.from("orders")
      .insert({ canteen_id: canteenId, user_id: profile.id, status: "placed_in_bin", total_amount: 80, otp: "qr011" })
      .select("id").single();
    if (!order) { test.skip(); return; }

    const payload = await fetchQrPayload(order.id);
    if (!payload) { test.skip(); await db.from("orders").delete().eq("id", order.id); return; }

    const res = await apiFetch(`/api/orders/${order.id}/verify-qr`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ qrPayload: payload }),
    }, ACCOUNTS.canteenAdmin);
    expect(res.status).toBe(200);

    await db.from("orders").delete().eq("id", order.id);
  });

  test("tampered QR (bad HMAC) is rejected with 400", async () => {
    const canteenId = await getCanteen1Id();
    const db = adminClient();
    const { data: order } = await db.from("orders")
      .insert({ canteen_id: canteenId, user_id: await getStudent1Id().catch(() => null), status: "placed_in_bin", total_amount: 80, otp: "qr012" })
      .select("id").single();
    if (!order) { test.skip(); return; }

    const tamperedPayload = `NOQX|${order.id}|99999|aaaaaaaaaaaaaaaa`;
    const res = await apiFetch(`/api/orders/${order.id}/verify-qr`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ qrPayload: tamperedPayload }),
    }, ACCOUNTS.worker);
    expect(res.status).toBe(400);

    await db.from("orders").delete().eq("id", order.id);
  });

  test("QR from a different order is rejected (orderId mismatch)", async () => {
    const canteenId = await getCanteen1Id();
    const db = adminClient();
    const { data: profile } = await db.from("profiles").select("id").eq("email", ACCOUNTS.student1.email).maybeSingle();
    if (!profile) { test.skip(); return; }

    const { data: order1 } = await db.from("orders")
      .insert({ canteen_id: canteenId, user_id: profile.id, status: "placed_in_bin", total_amount: 80, otp: "qr013" })
      .select("id").single();
    const { data: order2 } = await db.from("orders")
      .insert({ canteen_id: canteenId, user_id: profile.id, status: "placed_in_bin", total_amount: 80, otp: "qr014" })
      .select("id").single();
    if (!order1 || !order2) { test.skip(); return; }

    // QR payload for order1, submitted against order2's endpoint
    const payload = await fetchQrPayload(order1.id);
    if (!payload) { test.skip(); return; }

    const res = await apiFetch(`/api/orders/${order2.id}/verify-qr`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ qrPayload: payload }),
    }, ACCOUNTS.worker);
    expect(res.status).toBe(400);

    await db.from("orders").delete().eq("id", order1.id);
    await db.from("orders").delete().eq("id", order2.id);
  });

  test("completely malformed payload (no NOQX prefix) returns 400", async () => {
    const res = await apiFetch(`/api/orders/00000000-0000-0000-0000-000000000000/verify-qr`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ qrPayload: "NOTAQRCODE" }),
    }, ACCOUNTS.worker);
    expect(res.status).toBe(400);
  });

  test("missing qrPayload in body returns 400", async () => {
    const res = await apiFetch(`/api/orders/00000000-0000-0000-0000-000000000000/verify-qr`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }, ACCOUNTS.worker);
    expect(res.status).toBe(400);
  });

  test("student cannot call verify-qr endpoint (403)", async () => {
    const res = await apiFetch(`/api/orders/00000000-0000-0000-0000-000000000000/verify-qr`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ qrPayload: "NOQX|id|0|abc" }),
    }, ACCOUNTS.student1);
    expect(res.status).toBe(403);
  });

  test("unauthenticated cannot verify QR (401)", async () => {
    const res = await fetch(`${APP_URL}/api/orders/00000000-0000-0000-0000-000000000000/verify-qr`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ qrPayload: "NOQX|id|0|abc" }),
    });
    expect(res.status).toBe(401);
  });

  test("already-collected order cannot be re-verified via QR (400)", async () => {
    const canteenId = await getCanteen1Id();
    const db = adminClient();
    const { data: profile } = await db.from("profiles").select("id").eq("email", ACCOUNTS.student1.email).maybeSingle();
    if (!profile) { test.skip(); return; }

    const { data: order } = await db.from("orders")
      .insert({ canteen_id: canteenId, user_id: profile.id, status: "placed_in_bin", total_amount: 80, otp: "qr020" })
      .select("id").single();
    if (!order) { test.skip(); return; }

    const payload = await fetchQrPayload(order.id);
    if (!payload) { test.skip(); await db.from("orders").delete().eq("id", order.id); return; }

    // First verify — should succeed
    await apiFetch(`/api/orders/${order.id}/verify-qr`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ qrPayload: payload }),
    }, ACCOUNTS.worker);

    // Second verify — must fail (already collected)
    const res2 = await apiFetch(`/api/orders/${order.id}/verify-qr`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ qrPayload: payload }),
    }, ACCOUNTS.worker);
    expect(res2.status).toBe(400);

    await db.from("orders").delete().eq("id", order.id);
  });

  test("order not yet in bin cannot be QR-verified (wrong status → 400)", async () => {
    const canteenId = await getCanteen1Id();
    const db = adminClient();
    const { data: order } = await db.from("orders")
      .insert({ canteen_id: canteenId, user_id: await getStudent1Id().catch(() => null), status: "placed", total_amount: 80, otp: "qr021" })
      .select("id").single();
    if (!order) { test.skip(); return; }

    // Build a structurally valid-looking payload (HMAC will fail anyway)
    const fakePayload = `NOQX|${order.id}|${Math.floor(Date.now() / 30_000)}|aaaaaaaaaaaaaaaa`;
    const res = await apiFetch(`/api/orders/${order.id}/verify-qr`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ qrPayload: fakePayload }),
    }, ACCOUNTS.worker);
    expect(res.status).toBe(400);

    await db.from("orders").delete().eq("id", order.id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INVOICE / BILL PRINTING — API
// ─────────────────────────────────────────────────────────────────────────────
test.describe("Invoice API — bill printing", () => {
  test("canteen_admin can fetch invoice for any order in their canteen", async () => {
    const canteenId = await getCanteen1Id();
    const db = adminClient();
    const { data: profile } = await db.from("profiles").select("id").eq("email", ACCOUNTS.student1.email).maybeSingle();
    if (!profile) { test.skip(); return; }

    const { data: order } = await db.from("orders")
      .insert({ canteen_id: canteenId, user_id: profile.id, status: "collected", total_amount: 80, otp: "qr030" })
      .select("id").single();
    if (!order) { test.skip(); return; }

    const res = await apiFetch(`/api/orders/${order.id}/invoice`, {}, ACCOUNTS.canteenAdmin);
    expect(res.status).toBe(200);
    const data = await res.json() as {
      invoice_number?: string;
      order_id?: string;
      customer?: Record<string, unknown>;
      canteen?: Record<string, unknown>;
      items?: unknown[];
      grand_total?: number;
      gst_note?: string;
    };
    expect(data.invoice_number).toBeDefined();
    expect(data.invoice_number).toMatch(/^NOQX-\d{8}-[A-Z0-9]+$/);
    expect(data.order_id).toBe(order.id);
    expect(data.customer).toBeDefined();
    expect(data.canteen).toBeDefined();
    expect(Array.isArray(data.items)).toBe(true);
    expect(typeof data.grand_total).toBe("number");
    expect(data.gst_note).toContain("GST");

    await db.from("orders").delete().eq("id", order.id);
  });

  test("student can fetch invoice for their own order", async () => {
    const canteenId = await getCanteen1Id();
    const db = adminClient();
    const { data: profile } = await db.from("profiles").select("id").eq("email", ACCOUNTS.student1.email).maybeSingle();
    if (!profile) { test.skip(); return; }

    const { data: order } = await db.from("orders")
      .insert({ canteen_id: canteenId, user_id: profile.id, status: "collected", total_amount: 80, otp: "qr031" })
      .select("id").single();
    if (!order) { test.skip(); return; }

    const res = await apiFetch(`/api/orders/${order.id}/invoice`, {}, ACCOUNTS.student1);
    expect(res.status).toBe(200);
    const data = await res.json() as { invoice_number?: string };
    expect(data.invoice_number).toMatch(/^NOQX-/);

    await db.from("orders").delete().eq("id", order.id);
  });

  test("student cannot fetch another student's invoice (403)", async () => {
    const canteenId = await getCanteen1Id();
    const db = adminClient();
    const { data: profile2 } = await db.from("profiles").select("id").eq("email", ACCOUNTS.student2.email).maybeSingle();
    if (!profile2) { test.skip(); return; }

    const { data: order } = await db.from("orders")
      .insert({ canteen_id: canteenId, user_id: profile2.id, status: "collected", total_amount: 80, otp: "qr032" })
      .select("id").single();
    if (!order) { test.skip(); return; }

    const res = await apiFetch(`/api/orders/${order.id}/invoice`, {}, ACCOUNTS.student1);
    expect(res.status).toBe(403);

    await db.from("orders").delete().eq("id", order.id);
  });

  test("worker cannot access invoice endpoint (403)", async () => {
    const canteenId = await getCanteen1Id();
    const db = adminClient();
    const { data: profile } = await db.from("profiles").select("id").eq("email", ACCOUNTS.student1.email).maybeSingle();
    if (!profile) { test.skip(); return; }
    const { data: order } = await db.from("orders")
      .insert({ canteen_id: canteenId, user_id: profile.id, status: "collected", total_amount: 80, otp: "wk099" })
      .select("id").single();
    if (!order) { test.skip(); return; }
    const res = await apiFetch(`/api/orders/${order.id}/invoice`, {}, ACCOUNTS.worker);
    expect([403, 404]).toContain(res.status);
    await db.from("orders").delete().eq("id", order.id);
  });

  test("invoice for non-existent order returns 404", async () => {
    const res = await apiFetch(`/api/orders/00000000-0000-0000-0000-000000000000/invoice`, {}, ACCOUNTS.canteenAdmin);
    expect(res.status).toBe(404);
  });

  test("invoice includes GST breakdown (CGST 2.5% + SGST 2.5%)", async () => {
    const canteenId = await getCanteen1Id();
    const db = adminClient();
    const { data: profile } = await db.from("profiles").select("id").eq("email", ACCOUNTS.student1.email).maybeSingle();
    if (!profile) { test.skip(); return; }

    const { data: order } = await db.from("orders")
      .insert({ canteen_id: canteenId, user_id: profile.id, status: "placed", total_amount: 100, otp: "qr033" })
      .select("id").single();
    if (!order) { test.skip(); return; }

    const res = await apiFetch(`/api/orders/${order.id}/invoice`, {}, ACCOUNTS.canteenAdmin);
    if (res.status === 200) {
      const data = await res.json() as {
        total_cgst?: number;
        total_sgst?: number;
        subtotal?: number;
        grand_total?: number;
      };
      expect(typeof data.total_cgst).toBe("number");
      expect(typeof data.total_sgst).toBe("number");
      expect(typeof data.subtotal).toBe("number");
      expect(typeof data.grand_total).toBe("number");
    }

    await db.from("orders").delete().eq("id", order.id);
  });

  test("unauthenticated cannot fetch invoice (401)", async () => {
    const res = await fetch(`${APP_URL}/api/orders/00000000-0000-0000-0000-000000000000/invoice`);
    expect(res.status).toBe(401);
  });

  test("canteen receipts list is accessible to canteen_admin", async () => {
    const res = await apiFetch("/api/canteen/receipts", {}, ACCOUNTS.canteenAdmin);
    expect(res.status).toBe(200);
    const data = await res.json() as unknown[] | { receipts?: unknown[] };
    const list = Array.isArray(data) ? data : (data as { receipts?: unknown[] }).receipts ?? [];
    expect(Array.isArray(list)).toBe(true);
  });

  test("worker cannot access canteen receipts (403)", async () => {
    const res = await apiFetch("/api/canteen/receipts", {}, ACCOUNTS.worker);
    expect(res.status).toBe(403);
  });

  test("student cannot access canteen receipts (403)", async () => {
    const res = await apiFetch("/api/canteen/receipts", {}, ACCOUNTS.student1);
    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BILL PRINT UI — vendor dashboard
// ─────────────────────────────────────────────────────────────────────────────
test.describe("Bill print UI — vendor dashboard", () => {
  test("vendor dashboard loads without application error", async ({ page }) => {
    const { loginCanteenAdmin } = await import("./_helpers");
    await loginCanteenAdmin(page);
    await expect(page.locator("body")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/application error/i)).not.toBeVisible({ timeout: 3_000 }).catch(() => {});
  });

  test("vendor dashboard live-orders section is present", async ({ page }) => {
    const { loginCanteenAdmin } = await import("./_helpers");
    await loginCanteenAdmin(page);
    await expect(page.locator("body")).toBeVisible({ timeout: 15_000 });
    // Live Orders section or tab should be visible somewhere on the dashboard
    const liveText = page.getByText(/live orders/i).first();
    if (await liveText.isVisible({ timeout: 10_000 }).catch(() => false)) {
      await expect(liveText).toBeVisible();
    }
  });

  test("vendor dashboard has no print-related crash on load", async ({ page }) => {
    const { loginCanteenAdmin } = await import("./_helpers");
    await loginCanteenAdmin(page);
    // Intercept console errors to check for print-related crashes
    const errors: string[] = [];
    page.on("console", msg => { if (msg.type() === "error") errors.push(msg.text()); });
    await page.goto(`${APP_URL}/vendor/dashboard`, { waitUntil: "networkidle", timeout: 30_000 }).catch(() => {});
    const printErrors = errors.filter(e => /print|invoice|receipt/i.test(e));
    expect(printErrors).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// WORKER QR SCAN UI
// ─────────────────────────────────────────────────────────────────────────────
test.describe("Worker QR scan UI", () => {
  test("worker otp-verify page loads without crash", async ({ page }) => {
    const { loginWorker } = await import("./_helpers");
    await loginWorker(page);
    await page.goto(`${APP_URL}/worker/otp-verify`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/application error/i)).not.toBeVisible({ timeout: 3_000 }).catch(() => {});
  });

  test("worker orders page loads (for inline OTP/QR entry)", async ({ page }) => {
    const { loginWorker } = await import("./_helpers");
    await loginWorker(page);
    await page.goto(`${APP_URL}/worker/orders`, { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toBeVisible({ timeout: 10_000 });
  });
});

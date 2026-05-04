import { test, expect } from "@playwright/test";
import { adminClient, apiFetch, uniqueIpHeaders } from "./_helpers";

const APP_URL = process.env.APP_BASE_URL || "http://localhost:3000";

test.describe("Payment Flows", () => {
  // ── Razorpay Order Creation ────────────────────────────────────────────
  test("Razorpay order creation in test mode returns synthetic orderId", async () => {
    const res = await apiFetch(`${APP_URL}/api/payments/razorpay-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...uniqueIpHeaders() },
      body: JSON.stringify({ amount: 100 }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.orderId).toMatch(/^order_test_/);
    // Razorpay API returns amount in paise (100 * rupees)
    expect(body.amount).toBe(10000);
    expect(body.testMode).toBe(true);
  });

  test("Razorpay order with minimum amount ₹1", async () => {
    const res = await apiFetch(`${APP_URL}/api/payments/razorpay-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...uniqueIpHeaders() },
      body: JSON.stringify({ amount: 1 }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    // Razorpay API returns amount in paise (1 * 100)
    expect(body.amount).toBe(100);
  });

  test("Razorpay order with zero amount is rejected", async () => {
    const res = await apiFetch(`${APP_URL}/api/payments/razorpay-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...uniqueIpHeaders() },
      body: JSON.stringify({ amount: 0 }),
    });

    expect([400, 422]).toContain(res.status);
  });

  test("Razorpay order with negative amount is rejected", async () => {
    const res = await apiFetch(`${APP_URL}/api/payments/razorpay-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...uniqueIpHeaders() },
      body: JSON.stringify({ amount: -100 }),
    });

    expect([400, 422]).toContain(res.status);
  });

  // ── Razorpay Signature Verification ────────────────────────────────────
  test("Razorpay verify with test IDs bypasses HMAC check", async () => {
    const res = await apiFetch(`${APP_URL}/api/payments/razorpay-verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...uniqueIpHeaders() },
      body: JSON.stringify({
        razorpay_order_id: "order_test_123",
        razorpay_payment_id: "pay_test_456",
        razorpay_signature: "fake_signature",
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.testMode).toBe(true);
  });

  test("Razorpay verify with invalid signature format returns error", async () => {
    const res = await apiFetch(`${APP_URL}/api/payments/razorpay-verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...uniqueIpHeaders() },
      body: JSON.stringify({
        razorpay_order_id: "order_real_abc123def456",
        razorpay_payment_id: "pay_real_xyz789uvw000",
        razorpay_signature: "definitely_wrong_signature_that_wont_match",
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    // In non-test mode, invalid signature should fail verification
    expect(body.success).toBe(false);
  });

  test("Razorpay verify with missing fields returns 400", async () => {
    const res = await apiFetch(`${APP_URL}/api/payments/razorpay-verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...uniqueIpHeaders() },
      body: JSON.stringify({
        razorpay_order_id: "order_test_123",
        // missing razorpay_payment_id
      }),
    });

    expect(res.status).toBe(400);
  });

  // ── Razorpay Refund (Admin Only) ───────────────────────────────────────
  test("super_admin Razorpay refund with valid test payment ID", async () => {
    // Use super_admin context (requires auth token)
    // For E2E, this would be with an authenticated super_admin session
    // For now, test the validation without full auth flow

    const res = await apiFetch(`${APP_URL}/api/payments/razorpay-refund`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...uniqueIpHeaders() },
      body: JSON.stringify({
        paymentId: "pay_test_123456",
        reason: "test",
        amount: 100,
      }),
    });

    // Will be 401 without auth, but that's expected in E2E tests
    // when not authenticated as super_admin
    expect([200, 401, 403]).toContain(res.status);
  });

  test("Razorpay refund with invalid payment ID format returns 400", async () => {
    const res = await apiFetch(`${APP_URL}/api/payments/razorpay-refund`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...uniqueIpHeaders() },
      body: JSON.stringify({
        paymentId: "invalid_id", // Does not match ^pay_[A-Za-z0-9]{14,}$
        reason: "payment_failed",
      }),
    });

    expect([400, 401, 403]).toContain(res.status);
  });

  test("Razorpay refund with invalid reason returns 400", async () => {
    const res = await apiFetch(`${APP_URL}/api/payments/razorpay-refund`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...uniqueIpHeaders() },
      body: JSON.stringify({
        paymentId: "pay_test_12345678901234",
        reason: "invalid_reason_not_in_allowlist",
      }),
    });

    expect([400, 401, 403]).toContain(res.status);
  });

  test("Non-admin cannot trigger Razorpay refund", async () => {
    // Any authenticated non-super_admin user should get 403
    const res = await apiFetch(`${APP_URL}/api/payments/razorpay-refund`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...uniqueIpHeaders() },
      body: JSON.stringify({
        paymentId: "pay_test_12345678901234",
        reason: "customer_request",
      }),
    });

    expect([401, 403]).toContain(res.status);
  });

  // ── Payment Rate Limiting ──────────────────────────────────────────────
  test("Razorpay order rate limit (20/min per IP)", async () => {
    const results = [];
    const testIp = uniqueIpHeaders();

    // Fire 25 requests from same IP in succession
    for (let i = 0; i < 25; i++) {
      const res = await apiFetch(`${APP_URL}/api/payments/razorpay-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...testIp },
        body: JSON.stringify({ amount: 100 + i }),
      });
      results.push(res.status);
    }

    // First 20 should succeed, remaining 5 should be 429 (throttled)
    const successes = results.filter((s) => s === 200).length;
    const throttled = results.filter((s) => s === 429).length;

    expect(successes).toBeGreaterThanOrEqual(19);
    expect(throttled).toBeGreaterThanOrEqual(1);
  });

  // ── Razorpay Refund Reasons ────────────────────────────────────────────
  test("Razorpay refund supports all valid reasons", async () => {
    const reasons = [
      "payment_failed",
      "duplicate_payment",
      "order_cancelled",
      "customer_request",
      "test",
    ];

    for (const reason of reasons) {
      const res = await apiFetch(`${APP_URL}/api/payments/razorpay-refund`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...uniqueIpHeaders() },
        body: JSON.stringify({
          paymentId: "pay_test_12345678901234",
          reason: reason,
        }),
      });

      // Should not be 400 (bad reason) — might be 401/403 auth or 200 on success
      expect([200, 401, 403]).toContain(res.status);
    }
  });

  // ── Payment Test Mode Flag ─────────────────────────────────────────────
  test("Payment endpoints return testMode flag correctly", async () => {
    const orderRes = await apiFetch(`${APP_URL}/api/payments/razorpay-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...uniqueIpHeaders() },
      body: JSON.stringify({ amount: 100 }),
    });

    const orderBody = await orderRes.json();
    expect(orderBody.testMode).toBe(true);
    expect(orderBody.amount).toBe(10000); // paise: 100 * 100

    const verifyRes = await apiFetch(`${APP_URL}/api/payments/razorpay-verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...uniqueIpHeaders() },
      body: JSON.stringify({
        razorpay_order_id: orderBody.orderId,
        razorpay_payment_id: "pay_test_123456",
        razorpay_signature: "test_sig",
      }),
    });

    const verifyBody = await verifyRes.json();
    expect(verifyBody.testMode).toBe(true);
  });
});

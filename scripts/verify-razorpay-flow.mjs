#!/usr/bin/env node
/**
 * Razorpay flow verifier — confirms the payment plumbing is intact
 * without placing a real order or moving real money.
 *
 * What it checks:
 *   1. /api/payments/razorpay-order responds 200 with a valid order
 *      structure (order_id, amount, currency, keyId, testMode flag)
 *   2. The testMode flag tells you whether live or test keys are
 *      deployed — this is the simplest way to confirm Razorpay
 *      "go-live" state from outside Railway.
 *   3. /api/payments/razorpay-webhook rejects unsigned requests with
 *      a 4xx (signature verification works)
 *   4. /api/payments/razorpay-refund requires auth (returns 401)
 *
 * Doesn't simulate a full purchase — that requires a Supabase auth
 * session + a real cart, which is brittle to script against prod.
 * For the full E2E, manually run through the order flow on a phone.
 *
 * Usage: node scripts/verify-razorpay-flow.mjs [https://your-prod-url]
 *   Defaults to https://noqx.co.in
 */
const BASE = (process.argv[2] || "https://noqx.co.in").replace(/\/$/, "");

console.log("");
console.log("┌──────────────────────────────────────────────────────────────────────");
console.log(`│  Razorpay flow verify : ${BASE}`);
console.log("└──────────────────────────────────────────────────────────────────────");
console.log("");

let passed = 0, failed = 0;

function ok(label, note = "") {
  console.log(`  ✓  ${label}${note ? "  — " + note : ""}`);
  passed++;
}
function fail(label, note = "") {
  console.log(`  ✘  ${label}${note ? "  — " + note : ""}`);
  failed++;
}

// ── 1. razorpay-order creates an order ──
{
  const r = await fetch(`${BASE}/api/payments/razorpay-order`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amount: 1 }),  // ₹1 = 100 paise
  });
  if (r.status === 200) {
    const data = await r.json();
    if (data.orderId && data.amount === 100 && data.currency === "INR" && data.keyId) {
      ok("razorpay-order returns valid structure");
      if (data.testMode === true) {
        ok("PAYMENT_TEST_MODE = true (test keys active)",
           "flip PAYMENT_TEST_MODE='false' + deploy live keys before launch");
      } else if (data.testMode === false || data.testMode === undefined) {
        if (data.keyId.startsWith("rzp_live_")) {
          ok("razorpay LIVE keys deployed", `keyId=${data.keyId.slice(0, 12)}...`);
        } else {
          fail("PAYMENT_TEST_MODE=false but keyId is NOT rzp_live_*",
               `keyId=${data.keyId} — env vars may be misconfigured`);
        }
      }
    } else {
      fail("razorpay-order returned unexpected shape", JSON.stringify(data));
    }
  } else {
    fail(`razorpay-order returned ${r.status}`, await r.text().catch(() => ""));
  }
}

// ── 2. Webhook rejects unsigned requests ──
{
  const r = await fetch(`${BASE}/api/payments/razorpay-webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ event: "payment.captured", payload: {} }),
  });
  if (r.status >= 400 && r.status < 500) {
    ok(`razorpay-webhook rejects unsigned (status ${r.status})`);
  } else {
    fail(`razorpay-webhook accepted unsigned request (status ${r.status})`,
         "CRITICAL — anyone can forge payment events");
  }
}

// ── 3. razorpay-refund requires auth ──
{
  const r = await fetch(`${BASE}/api/payments/razorpay-refund`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderId: "fake" }),
  });
  if (r.status === 401 || r.status === 403) {
    ok(`razorpay-refund requires auth (status ${r.status})`);
  } else {
    fail(`razorpay-refund did not gate on auth (status ${r.status})`,
         "expected 401 — refunds must require admin auth");
  }
}

// ── 4. Rate limit on order creation ──
// Fire 25 requests rapidly. Limit is 20/min per IP, so requests 21+ should 429.
{
  const promises = [];
  for (let i = 0; i < 25; i++) {
    promises.push(
      fetch(`${BASE}/api/payments/razorpay-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: 1 }),
      }).then(r => r.status)
    );
  }
  const statuses = await Promise.all(promises);
  const has429 = statuses.includes(429);
  if (has429) {
    const count429 = statuses.filter(s => s === 429).length;
    ok(`razorpay-order rate limit active (${count429}/${statuses.length} blocked)`);
  } else {
    fail("razorpay-order rate limit NOT enforced",
         "expected ≥1 of 25 burst requests to return 429");
  }
}

console.log("");
console.log(`Total ${passed + failed} checks · ${passed} passed · ${failed} failed`);
if (failed > 0) process.exit(1);
console.log("");
console.log("✅ Razorpay flow is healthy.");

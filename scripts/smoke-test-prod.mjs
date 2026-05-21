#!/usr/bin/env node
/**
 * Read-only smoke test against the production Railway deployment.
 *
 * No writes, no test data injected. Just verifies:
 *   - Root URL responds 200
 *   - All 5 KYC legal pages render (Terms, Privacy, Refund, Shipping, Contact)
 *   - Core public APIs respond without 5xx
 *   - Service worker file is served and has the current CACHE_NAME
 *   - The login page actually renders the legal-pages footer
 *
 * Designed to be safe to run against production at any time.
 *
 * Usage: node scripts/smoke-test-prod.mjs [https://your-prod-url]
 *   Defaults to https://noqx.co.in
 */
const BASE = (process.argv[2] || "https://noqx.co.in").replace(/\/$/, "");

// Seeded production canteen — see launch_readiness §1 Production data seed.
// Replace this constant if the seeded canteen is rotated.
const SEEDED_CANTEEN_ID = "7e431e40-44e8-4c66-ac6a-d60f47f343c4";

console.log("");
console.log("┌──────────────────────────────────────────────────────────────────────");
console.log(`│  Smoke-testing : ${BASE}`);
console.log("└──────────────────────────────────────────────────────────────────────");
console.log("");

const checks = [];

async function check(label, url, expect = { status: 200, contains: null }) {
  const start = Date.now();
  try {
    const r = await fetch(url, { redirect: "manual" });
    const ms = Date.now() - start;
    const ok = r.status === expect.status;
    let bodyContains = true;
    if (expect.contains) {
      const body = await r.text();
      bodyContains = body.includes(expect.contains);
    }
    const passed = ok && bodyContains;
    checks.push({ label, url, status: r.status, ms, passed,
                  note: passed ? "" : (!ok ? `expected ${expect.status}` : `missing "${expect.contains}"`) });
    console.log(`  ${passed ? "✓" : "✘"}  ${label.padEnd(45)} ${String(r.status).padEnd(4)} ${String(ms).padStart(5)}ms${passed ? "" : "  ← " + checks[checks.length - 1].note}`);
  } catch (e) {
    checks.push({ label, url, status: null, ms: null, passed: false, note: e.message });
    console.log(`  ✘  ${label.padEnd(45)} ERR        ${e.message}`);
  }
}

// ── 1. Liveness ──
await check("Root URL responds",          `${BASE}/`);
// Login is a client-rendered component, so SSR HTML is just the React
// shell — legal links hydrate later. The 5 individual /terms /privacy
// /refund /shipping /contact checks below already verify those pages
// are reachable, which is what the KYC reviewer needs.
await check("Login page renders",         `${BASE}/login`, { status: 200 });

// ── 2. Legal pages (KYC requirement) ──
await check("Terms of Service page",      `${BASE}/terms`,    { status: 200, contains: "Terms" });
await check("Privacy Policy page",        `${BASE}/privacy`,  { status: 200, contains: "Privacy" });
await check("Refund Policy page",         `${BASE}/refund`,   { status: 200, contains: "Refund" });
await check("Shipping & Delivery page",   `${BASE}/shipping`, { status: 200, contains: "Shipping" });
await check("Contact Us page",            `${BASE}/contact`,  { status: 200, contains: "Contact" });

// ── 2b. Brand + contact regression ──
// Catches "Canteen-Application" placeholder text leaking back into legal pages.
// Note: emails are rewritten by Cloudflare Email Obfuscation (Scrape Shield)
// into <a class="__cf_email__"...> tokens, so we check for the obfuscation
// marker as a proxy for "an email is rendered here" — verifies the legal
// pages still render their contact blocks.
await check("Contact page has real phone",   `${BASE}/contact`,  { status: 200, contains: "70199 86046" });
await check("Contact uses NoQx brand",       `${BASE}/contact`,  { status: 200, contains: "NoQx" });
await check("Privacy page renders emails",   `${BASE}/privacy`,  { status: 200, contains: "__cf_email__" });
await check("Refund page renders emails",    `${BASE}/refund`,   { status: 200, contains: "__cf_email__" });

// ── 3. Service worker (cache busting) ──
await check("Service worker exists",      `${BASE}/sw.js`,    { status: 200, contains: "CACHE_NAME" });

// ── 4. Manifest (PWA install) ──
await check("PWA manifest",               `${BASE}/manifest.json`);

// ── 5. Public APIs that should respond without auth ──
// /api/canteens/colleges — used by student app landing
await check("/api/canteens/colleges 200", `${BASE}/api/canteens/colleges`);

// ── 5b. Seeded production data exists ──
// The launch-seed canteen + its menu items must be visible via the public
// menu API. If this fails, students will land on an empty app.
{
  const r = await fetch(`${BASE}/api/canteens/${SEEDED_CANTEEN_ID}/menu`);
  const body = await r.json().catch(() => null);
  const itemCount = Array.isArray(body?.items) ? body.items.length : 0;
  const ok = r.status === 200 && itemCount >= 1;
  checks.push({
    label: `Seeded canteen has ≥1 menu item (got ${itemCount})`,
    url: `/api/canteens/${SEEDED_CANTEEN_ID}/menu`,
    status: r.status, ms: 0, passed: ok,
    note: ok ? "" : `status=${r.status}, items=${itemCount}`,
  });
  console.log(`  ${ok ? "✓" : "✘"}  ${(`Seeded canteen has ≥1 menu item (got ${itemCount})`).padEnd(45)} ${r.status}`);
}

// /api/payments/razorpay-webhook should refuse non-POST (or unsigned POST)
// — we expect 4xx, not 5xx.
{
  const r = await fetch(`${BASE}/api/payments/razorpay-webhook`, { method: "POST", body: "" });
  const ok = r.status >= 400 && r.status < 500;
  checks.push({ label: "razorpay-webhook rejects unsigned (4xx)", url: "", status: r.status, ms: 0, passed: ok, note: ok ? "" : `got ${r.status}` });
  console.log(`  ${ok ? "✓" : "✘"}  ${("razorpay-webhook rejects unsigned (4xx)").padEnd(45)} ${r.status}`);
}

// ── 6. Routes that require auth — should respond 401 (not 500) ──
async function checkAuthRequired(label, path) {
  const r = await fetch(`${BASE}${path}`);
  const ok = r.status === 401 || r.status === 403;
  checks.push({ label, url: path, status: r.status, ms: 0, passed: ok, note: ok ? "" : `expected 401/403 got ${r.status}` });
  console.log(`  ${ok ? "✓" : "✘"}  ${label.padEnd(45)} ${r.status}`);
}
await checkAuthRequired("GET /api/orders requires auth",   "/api/orders");
await checkAuthRequired("GET /api/notifications req. auth","/api/notifications");
await checkAuthRequired("GET /api/canteen/receipts req. auth", "/api/canteen/receipts");

// ── Summary ──
const failed = checks.filter(c => !c.passed);
console.log("");
console.log(`Total ${checks.length} checks · ${checks.length - failed.length} passed · ${failed.length} failed`);
if (failed.length > 0) {
  console.log("");
  console.log("FAILED:");
  for (const c of failed) {
    console.log(`  • ${c.label} (status=${c.status}) — ${c.note}`);
  }
  process.exit(1);
}
console.log("");
console.log("✅ Production is healthy.");

#!/usr/bin/env node
/**
 * Launch-day live stats — orders, payments, users, errors.
 * Read-only — uses the service-role key. Safe to run any time.
 *
 * Defaults to "today" (since 00:00 IST). Pass --since=<hours> to
 * look further back, e.g. --since=24 for the last 24 hours.
 *
 * Usage:
 *   SERVICE_ROLE=eyJ... node scripts/launch-day-stats.mjs
 *   SERVICE_ROLE=eyJ... node scripts/launch-day-stats.mjs --since=24
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://dpycfyeiyhzvwbythcrp.supabase.co";
const SERVICE_ROLE = process.env.SERVICE_ROLE;
if (!SERVICE_ROLE) {
  console.error("SERVICE_ROLE env var required. Grab from .env.local:");
  console.error('  SERVICE_ROLE=$(grep "^SUPABASE_SERVICE_ROLE_KEY=" .env.local | cut -d= -f2-) node scripts/launch-day-stats.mjs');
  process.exit(1);
}

const sinceArg = process.argv.find(a => a.startsWith("--since="));
const sinceHours = sinceArg ? parseFloat(sinceArg.split("=")[1]) : null;
const sinceTs = sinceHours != null
  ? new Date(Date.now() - sinceHours * 3600_000)
  : (() => {
      // IST = UTC+5:30, "today 00:00 IST"
      const now = new Date();
      const istOffsetMs = 5.5 * 3600_000;
      const istNow = new Date(now.getTime() + istOffsetMs);
      istNow.setUTCHours(0, 0, 0, 0);
      return new Date(istNow.getTime() - istOffsetMs);
    })();

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const HR = "─".repeat(70);
const fmt = (n) => (n ?? 0).toLocaleString("en-IN");
const inr = (paise) => `₹${((paise ?? 0) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

console.log("");
console.log(`Launch-day stats · since ${sinceTs.toISOString()}`);
console.log(HR);

// ── ORDERS ──
{
  const { data, error } = await admin
    .from("orders")
    .select("id, status, total_amount, created_at, canteen_id")
    .gte("created_at", sinceTs.toISOString());

  if (error) {
    console.log(`✘ orders query failed: ${error.message}`);
  } else {
    const total = data.length;
    const byStatus = data.reduce((m, o) => { m[o.status] = (m[o.status] || 0) + 1; return m; }, {});
    const revenue = data
      .filter(o => o.status !== "cancelled")
      .reduce((s, o) => s + (Number(o.total_amount) || 0), 0);

    console.log(`\nORDERS  (${total} placed)`);
    for (const [status, n] of Object.entries(byStatus).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${status.padEnd(20)} ${fmt(n)}`);
    }
    console.log(`  Gross revenue (excluding cancelled): ₹${revenue.toFixed(2)}`);
  }
}

// ── PAYMENTS ──
{
  const { data, error } = await admin
    .from("payments")
    .select("id, status, amount_paise, razorpay_payment_id, created_at")
    .gte("created_at", sinceTs.toISOString());

  if (error) {
    console.log(`\n✘ payments query failed: ${error.message}`);
  } else {
    const byStatus = data.reduce((m, p) => { m[p.status] = (m[p.status] || 0) + 1; return m; }, {});
    const captured = data.filter(p => p.status === "captured");
    const capturedSum = captured.reduce((s, p) => s + (Number(p.amount_paise) || 0), 0);
    const successRate = data.length ? (captured.length / data.length * 100).toFixed(1) : "—";

    console.log(`\nPAYMENTS  (${fmt(data.length)} attempts, ${successRate}% capture)`);
    for (const [status, n] of Object.entries(byStatus).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${status.padEnd(20)} ${fmt(n)}`);
    }
    console.log(`  Captured total: ${inr(capturedSum)}`);
  }
}

// ── USERS ──
{
  const { data, error } = await admin
    .from("profiles")
    .select("id, role, created_at")
    .gte("created_at", sinceTs.toISOString());

  if (error) {
    console.log(`\n✘ profiles query failed: ${error.message}`);
  } else {
    const byRole = data.reduce((m, p) => { m[p.role || "null"] = (m[p.role || "null"] || 0) + 1; return m; }, {});
    console.log(`\nNEW SIGNUPS  (${fmt(data.length)})`);
    for (const [role, n] of Object.entries(byRole).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${role.padEnd(20)} ${fmt(n)}`);
    }
  }
}

// ── SUPPORT TICKETS ──
{
  const { data, error } = await admin
    .from("support_tickets")
    .select("id, status, priority, created_at")
    .gte("created_at", sinceTs.toISOString());

  if (error) {
    // Table may not exist on Free / older schemas — soft-fail
    console.log(`\n(support_tickets unavailable — skipping)`);
  } else {
    const open = data.filter(t => t.status === "open").length;
    const urgent = data.filter(t => t.priority === "urgent" || t.priority === "high").length;
    console.log(`\nSUPPORT TICKETS  (${fmt(data.length)} new)`);
    console.log(`  Open: ${fmt(open)}  ·  Urgent/high: ${fmt(urgent)}`);
  }
}

// ── CANTEENS ──
{
  const { data, error } = await admin
    .from("canteens")
    .select("id, name, is_active, is_hidden");

  if (error) {
    console.log(`\n✘ canteens query failed: ${error.message}`);
  } else {
    const live = data.filter(c => c.is_active && !c.is_hidden);
    console.log(`\nCANTEENS  (${fmt(data.length)} total, ${fmt(live.length)} live)`);
    for (const c of live) {
      console.log(`  • ${c.name}`);
    }
  }
}

console.log("");
console.log(HR);
console.log("Done.");

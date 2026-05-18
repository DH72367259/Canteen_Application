#!/usr/bin/env node
/**
 * Conservative DB cleanup — wipes only TRANSACTIONAL data, leaves every
 * user / canteen / menu item / slot config intact.
 *
 * Deletes:
 *   - order_bins (FK → orders)
 *   - order_items (FK → orders, menu_items)
 *   - payment_ledger rows whose order_id is being deleted (FK)
 *   - payments
 *   - orders
 *   - notification_reads
 *   - notifications
 *   - cart_items
 * Then resets:
 *   - bins → free (is_occupied=false, status='empty', no order ids)
 *
 * KEEPS:
 *   - auth.users + profiles
 *   - canteens
 *   - menu_items + time_slots + slot_control + platform_charges
 *   - canteen_bank_details + subscriptions + reward_transactions
 *
 * Usage:
 *   node scripts/cleanup-transactional.mjs --env=staging
 *   node scripts/cleanup-transactional.mjs --env=staging --execute
 *   node scripts/cleanup-transactional.mjs --env=production --execute
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const envArg = (args.find((a) => a.startsWith("--env="))?.split("=")[1] ?? "staging").toLowerCase();
const execute = args.includes("--execute");
if (!["staging", "production"].includes(envArg)) {
  console.error(`❌ --env must be staging or production`);
  process.exit(1);
}
const envFile = envArg === "production" ? ".env.local" : ".env.staging";
const raw = readFileSync(envFile, "utf8");
for (const line of raw.split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

console.log("");
console.log("┌──────────────────────────────────────────────────────────────────────");
console.log(`│  Target env       : ${envArg.toUpperCase()}`);
console.log(`│  Supabase project : ${process.env.NEXT_PUBLIC_SUPABASE_URL}`);
console.log(`│  Mode             : ${execute ? "🚨 EXECUTE" : "📋 DRY-RUN"}`);
console.log(`│  Scope            : transactional only (orders + notifications + carts)`);
console.log(`│  Will KEEP        : users, profiles, canteens, menu_items, time_slots,`);
console.log(`│                     slot_control, bins (freed), platform_charges`);
console.log("└──────────────────────────────────────────────────────────────────────");
console.log("");

// ── Count + plan ─────────────────────────────────────────────────────────────
async function count(t, filter) {
  const q = db.from(t).select("*", { count: "exact", head: true });
  const { count: c, error } = filter ? await filter(q) : await q;
  if (error) return { count: null, error: error.code ?? error.message };
  return { count: c };
}

const plan = [];
plan.push(["orders",              await count("orders")]);
plan.push(["order_items",         await count("order_items")]);
plan.push(["order_bins",          await count("order_bins")]);
plan.push(["payments",            await count("payments")]);
plan.push(["payment_ledger",      await count("payment_ledger")]);
plan.push(["notifications",       await count("notifications")]);
plan.push(["notification_reads",  await count("notification_reads")]);
plan.push(["cart_items",          await count("cart_items")]);
const { count: occBins } = await count("bins", (q) => q.eq("is_occupied", true));
plan.push(["bins (occupied → free)", { count: occBins ?? 0 }]);

console.log("📋 Will delete / reset:");
for (const [t, r] of plan) {
  if (r.error) {
    console.log(`   ${t.padEnd(28)} : (skipped — ${r.error})`);
  } else {
    console.log(`   ${t.padEnd(28)} : ${r.count} row(s)`);
  }
}
console.log("");

if (!execute) {
  console.log("📋 Dry-run complete. Re-run with --execute to actually clean.");
  process.exit(0);
}

// ── Execute in FK-safe order ────────────────────────────────────────────────
async function safe(label, fn) {
  try {
    const { error } = await fn();
    if (error) console.warn(`   ⚠️  ${label} failed: ${error.message}`);
    else       console.log(`   ✓ ${label}`);
  } catch (e) {
    console.warn(`   ⚠️  ${label} threw: ${e.message}`);
  }
}

console.log("🧹 Executing cleanup...");

// 1. Fetch order IDs (needed for payment_ledger FK)
const { data: allOrders } = await db.from("orders").select("id");
const orderIds = (allOrders ?? []).map((o) => o.id);

// 2. Free every bin FIRST — bins.order_id / current_order_id / assigned_order_id
//    all FK to orders.id, so orders can't be deleted while bins point at them.
//    Schema-aware: prod's bins table doesn't have current_order_id, so we
//    try the full update first, fall back to the prod-shape update.
{
  const fullUpdate = {
    is_occupied: false,
    current_order_id: null,
    assigned_order_id: null,
    order_id: null,
    status: "empty",
    updated_at: new Date().toISOString(),
  };
  const { error } = await db.from("bins").update(fullUpdate).not("id", "is", null);
  if (error && /current_order_id/i.test(error.message)) {
    // Prod schema — retry without the missing column.
    const slim = { ...fullUpdate };
    delete slim.current_order_id;
    const retry = await db.from("bins").update(slim).not("id", "is", null);
    if (retry.error) console.warn(`   ⚠️  free bins fallback failed: ${retry.error.message}`);
    else             console.log(`   ✓ free all bins (slim schema)`);
  } else if (error) {
    console.warn(`   ⚠️  free bins failed: ${error.message}`);
  } else {
    console.log(`   ✓ free all bins (full schema)`);
  }
}

// 3. payment_ledger references orders by order_id
if (orderIds.length > 0) {
  await safe(`payment_ledger rows for ${orderIds.length} orders`,
    () => db.from("payment_ledger").delete().in("order_id", orderIds));
}

// 4. Order children
if (orderIds.length > 0) {
  await safe(`order_bins for ${orderIds.length} orders`,
    () => db.from("order_bins").delete().in("order_id", orderIds));
  await safe(`order_items for ${orderIds.length} orders`,
    () => db.from("order_items").delete().in("order_id", orderIds));
  await safe(`payments for ${orderIds.length} orders`,
    () => db.from("payments").delete().in("order_id", orderIds));
}

// 5. Orders themselves — use a tautology filter so .delete() doesn't refuse
//    (PostgREST blocks bulk delete without a filter)
await safe("all orders", () => db.from("orders").delete().not("id", "is", null));

// 6. Notifications: reads first (composite PK), then rows
await safe("all notification_reads", () => db.from("notification_reads").delete().not("user_id", "is", null));
await safe("all notifications",      () => db.from("notifications").delete().not("id", "is", null));

// 7. Carts
await safe("all cart_items", () => db.from("cart_items").delete().not("user_id", "is", null));

console.log("");
console.log("✅ Cleanup complete.");

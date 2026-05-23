#!/usr/bin/env node
/**
 * Scorched-earth DB wipe — keeps super_admin profile(s) and their auth row,
 * deletes EVERYTHING else.
 *
 * Usage:
 *   node scripts/wipe-keep-superadmin.mjs staging
 *   node scripts/wipe-keep-superadmin.mjs production
 *
 * Safety:
 *   - Requires explicit `staging` or `production` arg
 *   - Refuses to run if no super_admin rows exist (would lock you out)
 *   - Refuses if more than 2 super_admins (sanity)
 *   - Prints a confirmation summary before deletion (no interactive prompt —
 *     caller has already confirmed)
 *
 * Deletion order respects foreign keys.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = process.argv[2];
if (env !== "staging" && env !== "production") {
  console.error("Usage: node scripts/wipe-keep-superadmin.mjs <staging|production>");
  process.exit(1);
}

const envFile = env === "production" ? ".env.local" : ".env.staging";
const raw = readFileSync(envFile, "utf8");
for (const line of raw.split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SVC          = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SVC) {
  console.error("Missing env vars in", envFile);
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SVC, { auth: { persistSession: false } });

console.log(`\n┌─ WIPE (${env.toUpperCase()}) ─────────────────────────────────────`);
console.log(`│  supabase: ${SUPABASE_URL}`);
console.log(`└─────────────────────────────────────────────────────────────────\n`);

// 1. Identify super_admin(s) to KEEP
const { data: admins, error: adminErr } = await sb
  .from("profiles").select("id, email").eq("role", "super_admin");
if (adminErr) { console.error("Could not query super_admins:", adminErr.message); process.exit(1); }
if (!admins || admins.length === 0) {
  console.error("✘ No super_admin found — refusing to wipe (would lock you out).");
  process.exit(1);
}
if (admins.length > 2) {
  console.error(`✘ ${admins.length} super_admins found — unusually many, aborting for safety.`);
  process.exit(1);
}
const keepIds = new Set(admins.map(a => a.id));
console.log("Keeping super_admin(s):");
for (const a of admins) console.log(`  ✓ ${a.email}  (id=${a.id.slice(0,8)})`);
console.log();

// 2. Inventory BEFORE
const tables = [
  "notification_reads", "notifications", "support_tickets",
  "order_items", "payments", "orders",
  "bins", "time_slots", "slot_control", "menu_items",
  "device_tokens", "cart_items",
  "noqx_pro_subscriptions", "settlement_payments", "waste_reports", "campaigns",
  "canteens",
];
console.log("BEFORE wipe:");
const before = {};
for (const t of tables) {
  const { count, error } = await sb.from(t).select("*", { count: "exact", head: true });
  before[t] = error ? `err: ${error.message.slice(0, 30)}` : count;
  if (typeof before[t] === "number") console.log(`  ${t.padEnd(28)} ${before[t]} rows`);
}
const { count: profilesBefore } = await sb.from("profiles").select("*", { count: "exact", head: true });
console.log(`  ${"profiles".padEnd(28)} ${profilesBefore} rows`);
console.log();

// 3. Delete in FK-safe order — using a universal `.not("created_at","is",null)`
// filter that works on every table regardless of whether it has an `id`
// column (e.g. slot_control, notification_reads use composite PKs).
console.log("Deleting...");
async function nuke(table, columnHint = null) {
  // Try each likely filter column until one succeeds
  const filterCols = columnHint ? [columnHint] : ["id", "created_at", "updated_at"];
  let result = null;
  for (const col of filterCols) {
    result = await sb.from(table).delete().not(col, "is", null);
    if (!result.error || /relation .* does not exist/i.test(result.error.message)) break;
    if (!/column .* does not exist/i.test(result.error.message ?? "")) break;
  }
  if (result.error && !/relation .* does not exist/i.test(result.error.message)) {
    console.log(`  ✘ ${table.padEnd(28)} ${result.error.message.slice(0, 70)}`);
    return false;
  }
  console.log(`  ✓ ${table.padEnd(28)} wiped`);
  return true;
}

// Order respects FK relationships — children first
await nuke("notification_reads");
await nuke("notifications");
await nuke("support_tickets");
await nuke("order_items");
await nuke("payments");
await nuke("order_bins");
await nuke("bins");
await nuke("orders");
await nuke("time_slots");
await nuke("slot_control");
await nuke("menu_items");
await nuke("device_tokens");
await nuke("cart_items");
await nuke("noqx_pro_subscriptions");
await nuke("settlement_payments");
await nuke("waste_reports");
await nuke("campaigns");
await nuke("canteens");

// 4. Delete non-super_admin profiles
const { error: profDelErr } = await sb.from("profiles").delete().neq("role", "super_admin");
if (profDelErr) console.log(`  ✘ profiles: ${profDelErr.message.slice(0, 70)}`);
else console.log(`  ✓ profiles                    wiped (kept super_admins)`);

// 5. Delete non-super_admin auth.users
const { data: authList, error: authListErr } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
if (authListErr) console.log(`  ✘ auth.users list: ${authListErr.message}`);
else {
  let deleted = 0;
  for (const u of authList?.users ?? []) {
    if (keepIds.has(u.id)) continue;
    const { error } = await sb.auth.admin.deleteUser(u.id);
    if (!error) deleted++;
  }
  console.log(`  ✓ auth.users                    deleted ${deleted} (kept ${keepIds.size})`);
}

// 6. Inventory AFTER
console.log();
console.log("AFTER wipe:");
for (const t of tables) {
  const { count, error } = await sb.from(t).select("*", { count: "exact", head: true });
  if (!error) console.log(`  ${t.padEnd(28)} ${count} rows`);
}
const { count: profilesAfter } = await sb.from("profiles").select("*", { count: "exact", head: true });
console.log(`  ${"profiles".padEnd(28)} ${profilesAfter} rows`);
console.log(`\n✅ ${env.toUpperCase()} wiped. Super-admin login still works.`);

#!/usr/bin/env node
/**
 * Deletes every profile + auth.user from production EXCEPT the explicitly
 * preserved super_admin email. Designed to be the FINAL step in a
 * production reset.
 *
 * One-shot script — guards heavily:
 *   - --env=production must be passed explicitly (no staging default)
 *   - Refuses to run if more than one super_admin matches the keep email
 *   - Refuses to run if the keep email is not present
 *   - Dry-run by default; --execute required to actually delete
 *
 * FK-aware deletion order:
 *   1. notification_reads of doomed users
 *   2. cart_items of doomed users
 *   3. notifications where recipient is a doomed user
 *   4. orders where user_id is a doomed user (already 0 after deep cleanup)
 *   5. profiles row
 *   6. auth.users row
 *
 * Usage:
 *   node scripts/cleanup-users-keep-superadmin.mjs --env=production
 *   node scripts/cleanup-users-keep-superadmin.mjs --env=production --execute
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const envArg = (args.find((a) => a.startsWith("--env="))?.split("=")[1] ?? "").toLowerCase();
const execute = args.includes("--execute");
const KEEP_EMAIL = (args.find((a) => a.startsWith("--keep="))?.split("=")[1] ?? "admin@noqx.co.in").toLowerCase();

if (envArg !== "production" && envArg !== "staging") {
  console.error("❌ Must pass --env=production or --env=staging");
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
console.log(`│  Keep             : ${KEEP_EMAIL}`);
console.log("└──────────────────────────────────────────────────────────────────────");
console.log("");

// 1. Fetch every profile + every auth user; resolve the keep target
const { data: profiles, error: profErr } = await db
  .from("profiles")
  .select("id, email, username, role, name");
if (profErr) {
  console.error("❌ Failed to read profiles:", profErr.message);
  process.exit(1);
}

const keepProfiles = (profiles ?? []).filter(p => (p.email ?? "").toLowerCase() === KEEP_EMAIL);
if (keepProfiles.length === 0) {
  console.error(`❌ No profile matches keep email "${KEEP_EMAIL}". Aborting — refuse to leave the DB user-less.`);
  process.exit(1);
}
if (keepProfiles.length > 1) {
  console.error(`❌ Multiple profiles match keep email "${KEEP_EMAIL}" (${keepProfiles.length}). Aborting — too ambiguous.`);
  for (const p of keepProfiles) console.error(`   - id=${p.id} role=${p.role} username=${p.username}`);
  process.exit(1);
}
const keeper = keepProfiles[0];
if (keeper.role !== "super_admin") {
  console.error(`❌ Keep target ${KEEP_EMAIL} has role '${keeper.role}', NOT super_admin. Aborting — refuse to leave prod without a super_admin.`);
  process.exit(1);
}

const doomed = (profiles ?? []).filter(p => p.id !== keeper.id);

console.log(`✅ Will keep    : ${keeper.email} (id=${keeper.id.slice(0,8)}…, role=${keeper.role}, username=${keeper.username})`);
console.log(`🗑️  Will delete : ${doomed.length} user(s):\n`);
for (const p of doomed) {
  console.log(`     - ${(p.role ?? "?").padEnd(15)} ${(p.email ?? "—").padEnd(38)} ${(p.username ?? "—").padEnd(20)} id=${p.id.slice(0,8)}…`);
}
console.log("");

if (!execute) {
  console.log("📋 Dry-run complete. Re-run with --execute to actually delete.");
  process.exit(0);
}

async function safe(label, fn) {
  try { const { error } = await fn(); if (error) console.warn(`   ⚠️  ${label}: ${error.message}`); else console.log(`   ✓ ${label}`); }
  catch (e) { console.warn(`   ⚠️  ${label} threw: ${e.message}`); }
}

const doomedIds = doomed.map(p => p.id);
console.log("🧹 Executing...");

// 1. notification_reads (composite PK with user_id)
await safe(`notification_reads of doomed users`,
  () => db.from("notification_reads").delete().in("user_id", doomedIds));

// 2. cart_items
await safe(`cart_items of doomed users`,
  () => db.from("cart_items").delete().in("user_id", doomedIds));

// 3. notifications addressed TO doomed users
await safe(`notifications addressed to doomed users`,
  () => db.from("notifications").delete().in("recipient_id", doomedIds));

// 4. orders whose user_id matches (should be 0 after deep cleanup, defensive)
await safe(`orders by doomed users`,
  () => db.from("orders").delete().in("user_id", doomedIds));

// 5. Delete profiles
await safe(`profiles rows (${doomedIds.length})`,
  () => db.from("profiles").delete().in("id", doomedIds));

// 6. Delete auth.users — one by one (admin API doesn't batch)
let deletedAuth = 0;
let failedAuth = [];
for (const id of doomedIds) {
  const { error } = await db.auth.admin.deleteUser(id);
  if (error) { failedAuth.push({ id, message: error.message }); }
  else       { deletedAuth++; }
}
console.log(`   ${failedAuth.length === 0 ? "✓" : "⚠️"} auth.users: ${deletedAuth} deleted${failedAuth.length ? `, ${failedAuth.length} failed` : ""}`);
for (const f of failedAuth) {
  console.warn(`       - ${f.id.slice(0,8)}…: ${f.message}`);
}

console.log("");
console.log(`✅ Done. Production should now have exactly 1 user (${KEEP_EMAIL}).`);

// Verify
const { data: post } = await db.from("profiles").select("email, role");
console.log(`Verification: ${post?.length ?? 0} profile(s) remain:`);
for (const p of post ?? []) console.log(`   - ${p.email} (${p.role})`);

// Surface orphaned canteens for the operator's awareness
const { data: canteens } = await db.from("canteens").select("id, name");
if (canteens && canteens.length > 0) {
  console.log("");
  console.log(`⚠️  ${canteens.length} canteen(s) are now orphaned (no canteen_admin to manage them):`);
  for (const c of canteens) console.log(`     - ${c.name} (id=${c.id.slice(0,8)}…)`);
  console.log(`   Use the super_admin dashboard to delete or reassign them.`);
}

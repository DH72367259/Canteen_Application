#!/usr/bin/env node
/**
 * Final production scorched-earth cleanup. Deletes:
 *   - All bins (every canteen's pickup bins)
 *   - All slot_control rows (canteen window config)
 *   - All canteens
 *
 * KEEPS:
 *   - admin@noqx.co.in profile + auth row
 *   - platform_charges row (global config; app needs this to compute fees)
 *
 * Designed to be run AFTER cleanup-users-keep-superadmin.mjs has already
 * removed all non-super-admin profiles.
 *
 * Usage:
 *   node scripts/cleanup-canteens-final.mjs --env=production
 *   node scripts/cleanup-canteens-final.mjs --env=production --execute
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const envArg = (args.find((a) => a.startsWith("--env="))?.split("=")[1] ?? "").toLowerCase();
const execute = args.includes("--execute");
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
console.log(`│  Scope            : final nuke — bins + slot_control + canteens`);
console.log(`│  Will KEEP        : admin@noqx.co.in + platform_charges`);
console.log("└──────────────────────────────────────────────────────────────────────");
console.log("");

async function count(t) {
  const { count: c, error } = await db.from(t).select("*", { count: "exact", head: true });
  return error ? { count: null, error } : { count: c };
}

const [bins, sc, canteens] = await Promise.all([count("bins"), count("slot_control"), count("canteens")]);
console.log(`📋 Will delete:`);
console.log(`   bins         : ${bins.count}`);
console.log(`   slot_control : ${sc.count}`);
console.log(`   canteens     : ${canteens.count}`);
console.log("");

const { data: canteenList } = await db.from("canteens").select("id, name");
if (canteenList && canteenList.length > 0) {
  console.log(`   Canteens to drop:`);
  for (const c of canteenList) console.log(`     - ${c.name} (id=${c.id.slice(0,8)}…)`);
  console.log("");
}

if (!execute) {
  console.log("📋 Dry-run complete. Re-run with --execute to actually delete.");
  process.exit(0);
}

async function safe(label, fn) {
  try { const { error } = await fn(); if (error) console.warn(`   ⚠️  ${label}: ${error.message}`); else console.log(`   ✓ ${label}`); }
  catch (e) { console.warn(`   ⚠️  ${label} threw: ${e.message}`); }
}

console.log("🧹 Executing FINAL cleanup...");

// 1. Bins first — they FK canteen_id. If FK is ON DELETE CASCADE this isn't
//    strictly required, but doing it explicitly avoids relying on schema.
await safe(`all bins`,         () => db.from("bins").delete().not("id", "is", null));
// 2. slot_control rows
await safe(`all slot_control`, () => db.from("slot_control").delete().not("canteen_id", "is", null));
// 3. Canteens themselves
await safe(`all canteens`,     () => db.from("canteens").delete().not("id", "is", null));

console.log("");

// Retry the soft-deleted auth row (admin@noqx.test) one more time
const { data: { users } } = await db.auth.admin.listUsers({ perPage: 1000 });
const stragglers = users.filter(u => (u.email ?? "").toLowerCase() !== "admin@noqx.co.in");
if (stragglers.length > 0) {
  console.log(`🧹 Retrying ${stragglers.length} soft-deleted auth row(s) with hard-delete...`);
  for (const u of stragglers) {
    const { error } = await db.auth.admin.deleteUser(u.id, false);
    console.log(error ? `   ⚠️  ${u.id.slice(0,8)}…: ${error.message}` : `   ✓ hard-deleted ${u.id.slice(0,8)}…`);
  }
}

console.log("");
console.log("✅ Final cleanup complete. Verifying...");

const [b2, sc2, c2] = await Promise.all([count("bins"), count("slot_control"), count("canteens")]);
const { data: { users: u2 } } = await db.auth.admin.listUsers({ perPage: 1000 });
const { data: profs } = await db.from("profiles").select("email");
const { data: pc } = await db.from("platform_charges").select("id");

console.log(`   profiles         : ${profs?.length ?? 0}  →  ${(profs ?? []).map(p => p.email).join(", ")}`);
console.log(`   auth.users       : ${u2.length}  →  ${u2.map(u => u.email || "(anonymised)").join(", ")}`);
console.log(`   canteens         : ${c2.count}`);
console.log(`   slot_control     : ${sc2.count}`);
console.log(`   bins             : ${b2.count}`);
console.log(`   platform_charges : ${pc?.length ?? 0}  (kept — global config)`);

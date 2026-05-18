#!/usr/bin/env node
/**
 * scripts/cleanup-e2e-menu-items.mjs
 *
 * Removes E2E-generated menu items (names matching "E2E %" or "E2E_%")
 * from a Supabase project. Dry-run by default — pass --execute to actually
 * delete. Targets staging (--env=staging, default) or production (--env=production).
 *
 * Safety rules:
 *  1. Only deletes rows whose `name` starts with "E2E " or "E2E_" (regex
 *     `^E2E[_ ]`). Real items ("Veg Thali", "Paneer Roll", custom vendor
 *     items) are never touched.
 *  2. Before any delete, the script checks order_items.menu_item_id refs.
 *     Menu items referenced by past orders are LEFT ALONE and reported,
 *     not deleted. That preserves order history.
 *  3. --execute must be passed explicitly. Without it, nothing is mutated.
 *  4. Logs the target Supabase project URL up-front so you can verify
 *     before agreeing to run.
 *
 * Usage:
 *   node scripts/cleanup-e2e-menu-items.mjs --env=staging                 # dry-run
 *   node scripts/cleanup-e2e-menu-items.mjs --env=staging --execute       # delete
 *   node scripts/cleanup-e2e-menu-items.mjs --env=production              # dry-run
 *   node scripts/cleanup-e2e-menu-items.mjs --env=production --execute    # delete
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

// ── Parse args ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const envArg = (args.find((a) => a.startsWith("--env="))?.split("=")[1] ?? "staging").toLowerCase();
const execute = args.includes("--execute");
if (!["staging", "production"].includes(envArg)) {
  console.error(`❌ --env must be 'staging' or 'production' (got '${envArg}')`);
  process.exit(1);
}

// ── Load env from the right file ─────────────────────────────────────────────
// staging   → .env.staging
// production → .env.local (this repo's local file points at the prod project)
const envFile = envArg === "production" ? ".env.local" : ".env.staging";
try {
  const raw = readFileSync(envFile, "utf8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch (e) {
  console.error(`❌ Could not read ${envFile}: ${e.message}`);
  process.exit(1);
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SVC = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SVC) {
  console.error(`❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in ${envFile}`);
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SUPABASE_SVC, { auth: { persistSession: false } });

const E2E_NAME_RE = /^E2E[_ ]/i;

// ── Header ───────────────────────────────────────────────────────────────────
console.log("");
console.log("┌──────────────────────────────────────────────────────────────────────");
console.log(`│  Target env       : ${envArg.toUpperCase()}`);
console.log(`│  Supabase project : ${SUPABASE_URL}`);
console.log(`│  Mode             : ${execute ? "🚨 EXECUTE (will delete)" : "📋 DRY-RUN (no changes)"}`);
console.log("└──────────────────────────────────────────────────────────────────────");
console.log("");

async function main() {
  // 1. Fetch every menu item whose name looks like an E2E artefact.
  const { data: candidates, error: fetchErr } = await db
    .from("menu_items")
    .select("id, name, canteen_id, created_at")
    .or("name.ilike.E2E %,name.ilike.E2E_%")
    .order("created_at", { ascending: false });

  if (fetchErr) {
    console.error("❌ Failed to fetch menu_items:", fetchErr.message);
    process.exit(1);
  }

  // Defence-in-depth: re-filter in JS too, so an .ilike pattern bug can't
  // accidentally widen the deletion to real items.
  const e2eItems = (candidates ?? []).filter((m) => E2E_NAME_RE.test(m.name ?? ""));
  console.log(`Found ${e2eItems.length} candidate menu_items matching ^E2E[_ ]`);
  if (e2eItems.length === 0) {
    console.log("✅ Nothing to clean. Done.");
    return;
  }

  // 2. For each candidate, check if any order_items references it.
  const ids = e2eItems.map((m) => m.id);
  const { data: refs, error: refErr } = await db
    .from("order_items")
    .select("menu_item_id")
    .in("menu_item_id", ids);
  if (refErr) {
    console.error("❌ Failed to query order_items:", refErr.message);
    process.exit(1);
  }
  const referenced = new Set((refs ?? []).map((r) => r.menu_item_id));

  const safeToDelete = e2eItems.filter((m) => !referenced.has(m.id));
  const keepBecauseReferenced = e2eItems.filter((m) => referenced.has(m.id));

  // 3. Print the plan.
  console.log("");
  console.log(`📋 Plan:`);
  console.log(`   • Will delete         : ${safeToDelete.length} item(s)`);
  console.log(`   • Will keep (in use)  : ${keepBecauseReferenced.length} item(s) — referenced by past orders`);
  console.log("");

  if (safeToDelete.length > 0) {
    console.log("   Will DELETE:");
    for (const m of safeToDelete.slice(0, 20)) {
      console.log(`     - ${m.name} (id=${m.id.slice(0, 8)}…, canteen=${(m.canteen_id ?? "—").slice(0, 8)}…)`);
    }
    if (safeToDelete.length > 20) console.log(`     … and ${safeToDelete.length - 20} more`);
    console.log("");
  }
  if (keepBecauseReferenced.length > 0) {
    console.log("   Will KEEP (referenced by past orders — manual call if you want them gone):");
    for (const m of keepBecauseReferenced.slice(0, 10)) {
      console.log(`     - ${m.name} (id=${m.id.slice(0, 8)}…)`);
    }
    if (keepBecauseReferenced.length > 10) console.log(`     … and ${keepBecauseReferenced.length - 10} more`);
    console.log("");
  }

  if (!execute) {
    console.log("📋 Dry-run complete. Re-run with --execute to actually delete.");
    return;
  }

  // 4. Execute. We delete in batches to stay under URL-length limits.
  const BATCH = 100;
  let deleted = 0;
  let failed = 0;
  for (let i = 0; i < safeToDelete.length; i += BATCH) {
    const chunk = safeToDelete.slice(i, i + BATCH).map((m) => m.id);
    const { error: delErr } = await db.from("menu_items").delete().in("id", chunk);
    if (delErr) {
      console.error(`❌ Batch ${i / BATCH + 1} failed:`, delErr.message);
      failed += chunk.length;
    } else {
      deleted += chunk.length;
      console.log(`   ✓ Deleted batch ${i / BATCH + 1} (${chunk.length} rows)`);
    }
  }

  console.log("");
  console.log(`✅ Done. Deleted ${deleted}, failed ${failed}, kept ${keepBecauseReferenced.length}.`);
}

main().catch((e) => {
  console.error("💥 Unhandled error:", e);
  process.exit(1);
});

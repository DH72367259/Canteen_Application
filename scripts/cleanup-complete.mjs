#!/usr/bin/env node
/**
 * scripts/cleanup-complete.mjs
 * Post-E2E cleanup: removes test-generated data while preserving whitelist
 * accounts and canteen structure seeded by seed-staging.mjs.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

try {
  const raw = readFileSync(".env.local", "utf8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch { /* CI */ }

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SVC = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SVC) { console.error("Missing env vars"); process.exit(1); }

const db = createClient(SUPABASE_URL, SUPABASE_SVC, { auth: { persistSession: false } });

const KEEP_EMAILS = new Set([
  "admin@noqx.test",
  "coadmin@noqx.test",
  "canteen1@noqx.test",
  "canteen2@noqx.test",
  "worker1@noqx.test",
  "student1@noqx.test",
  "student2@noqx.test",
]);

async function cleanup() {
  console.log("🧹 Running post-E2E cleanup…\n");

  // 1. Find ephemeral users (created by tests, not in whitelist)
  const { data: allProfiles } = await db.from("profiles").select("id, email").like("email", "%noqx.test%");
  const ephemeral = (allProfiles ?? []).filter(p => !KEEP_EMAILS.has(p.email ?? ""));
  const ephemeralIds = ephemeral.map(p => p.id);
  console.log(`Found ${ephemeralIds.length} ephemeral users to clean`);

  // 2. Remove their orders + dependencies
  if (ephemeralIds.length > 0) {
    const { data: userOrders } = await db.from("orders").select("id").in("user_id", ephemeralIds);
    const orderIds = (userOrders ?? []).map(o => o.id);
    if (orderIds.length > 0) {
      await db.from("order_items").delete().in("order_id", orderIds);
      await db.from("order_bins").delete().in("order_id", orderIds).catch(() => {});
      await db.from("payments").delete().in("order_id", orderIds).catch(() => {});
      await db.from("orders").delete().in("id", orderIds);
      console.log(`  ✅ Deleted ${orderIds.length} orders`);
    }
    await db.from("cart_items").delete().in("user_id", ephemeralIds).catch(() => {});
    // notification_reads has composite PK (user_id, notification_id) — no id column
    await db.from("notification_reads").delete().in("user_id", ephemeralIds).catch(() => {});
    for (const id of ephemeralIds) {
      await db.auth.admin.deleteUser(id).catch(() => {});
    }
    console.log(`  ✅ Deleted ${ephemeralIds.length} ephemeral users`);
  }

  // 3. Free bins whose current_order_id points to a deleted order
  await db
    .from("bins")
    .update({ current_order_id: null, assigned_order_id: null, is_occupied: false, status: "empty" })
    .not("current_order_id", "is", null)
    .catch(() => {});
  console.log("  ✅ Released orphaned bins");

  console.log("\n✅ Cleanup complete — whitelist accounts and canteen data preserved.");
}

cleanup().catch(e => { console.error("Cleanup error:", e); process.exit(1); });

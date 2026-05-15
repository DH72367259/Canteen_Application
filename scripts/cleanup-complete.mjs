#!/usr/bin/env node
/**
 * scripts/cleanup-complete.mjs — Complete database wipe with 5 whitelisted users.
 *
 * This script:
 * 1. Deletes ALL transactional data (orders, payments, subscriptions, etc.)
 * 2. Deletes ALL users EXCEPT the 5 whitelisted accounts
 * 3. Resets whitelist passwords to canonical values
 * 4. Clears all bin allocations
 * 5. Clears all logs and notifications
 *
 * Result: Clean database with only 5 users ready for fresh E2E testing
 *
 * Run: `node scripts/cleanup-complete.mjs`
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

// Load .env.local
const envText = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const line of envText.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.+)$/);
  if (m) process.env[m[1]] = m[2];
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const sb = createClient(url, serviceKey, { auth: { persistSession: false } });

const WHITELIST = [
  { email: "admin@noqx.test",     password: "Admin@12345",   role: "super_admin" },
  { email: "canteen1@noqx.test",  password: "Canteen@12345", role: "canteen_admin" },
  { email: "canteen2@noqx.test",  password: "Canteen@12345", role: "canteen_admin" },
  { email: "worker1@noqx.test",   password: "Worker@12345",  role: "worker" },
  { email: "coadmin@noqx.test",   password: "Coadmin@12345", role: "co_admin" },
];

const log = (...a) => console.log("  📝", ...a);
const ok = (...a) => console.log("  ✅", ...a);
const warn = (...a) => console.log("  ⚠️ ", ...a);
const section = (title) => console.log(`\n═══ ${title} ═══`);

async function nuke(table, label = table, filter = (q) => q.not("id", "is", null)) {
  try {
    const { error, count } = await filter(sb.from(table).delete({ count: "exact" }));
    if (error) {
      if (/relation .* does not exist|table .* does not exist/i.test(error.message ?? "")) {
        warn(`${label} table doesn't exist`);
        return 0;
      }
      warn(`${label} delete failed: ${error.message}`);
      return 0;
    }
    ok(`${label}: cleared ${count ?? "?"} rows`);
    return count ?? 0;
  } catch (e) {
    warn(`${label}: ${e.message}`);
    return 0;
  }
}

async function main() {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║     COMPLETE DATABASE CLEANUP - CANTEEN APPLICATION        ║
║     Keeping only 5 whitelisted users, wiping all data      ║
╚════════════════════════════════════════════════════════════╝
`);

  section("STEP 1: Delete All Transactional Data");
  // Order matters due to foreign keys
  await nuke("cart_items", "cart_items");
  await nuke("order_bins", "order_bins (bins linked to orders)");
  await nuke("payments", "payments");
  await nuke("order_items", "order_items");
  await nuke("noqx_pro_subscriptions", "Pro subscriptions");
  await nuke("reward_transactions", "reward_transactions");
  await nuke("rewards", "rewards");
  await nuke("support_tickets", "support_tickets");
  await nuke("notification_reads", "notification_reads", (q) => q.gte("read_at", "1970-01-01"));
  await nuke("notifications", "notifications");
  await nuke("device_tokens", "device_tokens");
  await nuke("logs", "activity logs");
  await nuke("slots_override", "slots_override");
  await nuke("campaigns", "campaigns");
  await nuke("orders", "orders");

  section("STEP 2: Reset Bin Allocations");
  try {
    const { error: binErr, count: binCount } = await sb
      .from("bins")
      .update(
        { is_occupied: false, current_order_id: null, assigned_order_id: null, status: "empty" },
        { count: "exact" }
      )
      .not("id", "is", null);
    if (binErr) warn(`Bin reset failed: ${binErr.message}`);
    else ok(`Bins reset to empty: ${binCount ?? "?"} rows updated`);
  } catch (e) {
    warn(`Bin reset error: ${e.message}`);
  }

  section("STEP 3: Identify Users to Keep/Delete");
  const allAuthUsers = [];
  let pageNum = 1;
  while (true) {
    try {
      const { data, error } = await sb.auth.admin.listUsers({ page: pageNum, perPage: 200 });
      if (error) throw error;
      if (!data?.users?.length) break;
      allAuthUsers.push(...data.users);
      if (data.users.length < 200) break;
      pageNum++;
    } catch (e) {
      warn(`Failed to fetch auth users: ${e.message}`);
      break;
    }
  }

  log(`Total auth users found: ${allAuthUsers.length}`);
  const whitelistEmails = new Set(WHITELIST.map(w => w.email.toLowerCase()));
  const keepers = allAuthUsers.filter(u => whitelistEmails.has((u.email ?? "").toLowerCase()));
  const victims = allAuthUsers.filter(u => !whitelistEmails.has((u.email ?? "").toLowerCase()));

  ok(`Keeping: ${keepers.length} users`);
  for (const k of keepers) log(`  └─ ${k.email} (${k.id})`);

  warn(`Deleting: ${victims.length} users`);
  for (const v of victims) log(`  └─ ${v.email} (${v.id})`);

  section("STEP 4: Delete Non-Whitelisted Users");
  let deleted = 0,
    failed = 0;
  for (const v of victims) {
    try {
      const { error } = await sb.auth.admin.deleteUser(v.id);
      if (error) {
        warn(`Failed to delete ${v.email}: ${error.message}`);
        failed++;
      } else {
        log(`Deleted: ${v.email}`);
        deleted++;
      }
    } catch (e) {
      warn(`Error deleting ${v.email}: ${e.message}`);
      failed++;
    }
  }
  ok(`Deleted: ${deleted} users (${failed} failed)`);

  section("STEP 5: Delete Non-Whitelisted Profiles");
  try {
    const { error: profErr, count: profCount } = await sb
      .from("profiles")
      .delete({ count: "exact" })
      .not("id", "is", null)
      .notIn(
        "id",
        keepers.map(k => k.id)
      );
    if (profErr) warn(`Profile cleanup failed: ${profErr.message}`);
    else ok(`Deleted ${profCount ?? "?"} non-whitelisted profiles`);
  } catch (e) {
    warn(`Profile cleanup error: ${e.message}`);
  }

  section("STEP 6: Reset Whitelist User Passwords");
  for (const w of WHITELIST) {
    try {
      const match = keepers.find(k => (k.email ?? "").toLowerCase() === w.email.toLowerCase());
      if (!match) {
        warn(`Whitelist user not found: ${w.email}`);
        continue;
      }

      const { error } = await sb.auth.admin.updateUserById(match.id, {
        password: w.password,
        email_confirm: true,
        user_metadata: {
          has_password: true,
          password_changed_at: new Date().toISOString(),
          must_change_password: false,
        },
      });

      if (error) {
        warn(`Password reset failed for ${w.email}: ${error.message}`);
      } else {
        ok(`Password reset: ${w.email} → ${w.password}`);
      }
    } catch (e) {
      warn(`Password reset error for ${w.email}: ${e.message}`);
    }
  }

  section("STEP 7: Verify Final State");
  try {
    const tables = [
      "orders",
      "cart_items",
      "payments",
      "profiles",
      "noqx_pro_subscriptions",
      "order_bins",
      "device_tokens",
      "notifications",
    ];

    const counts = {};
    for (const table of tables) {
      try {
        const { count } = await sb.from(table).select("id", { count: "exact", head: true });
        counts[table] = count ?? 0;
      } catch {
        counts[table] = "N/A";
      }
    }

    console.log("\n  Final Data State:");
    console.log(`    • orders: ${counts.orders}`);
    console.log(`    • payments: ${counts.payments}`);
    console.log(`    • cart_items: ${counts.cart_items}`);
    console.log(`    • Pro subscriptions: ${counts.noqx_pro_subscriptions}`);
    console.log(`    • order_bins: ${counts.order_bins}`);
    console.log(`    • device_tokens: ${counts.device_tokens}`);
    console.log(`    • notifications: ${counts.notifications}`);
    console.log(`    • profiles (should be 5): ${counts.profiles}`);
  } catch (e) {
    warn(`Final verification failed: ${e.message}`);
  }

  console.log(`
╔════════════════════════════════════════════════════════════╗
║                    ✅ CLEANUP COMPLETE                     ║
║                                                            ║
║  Database is now clean with only 5 whitelisted users:     ║
║    • admin@noqx.test (super_admin)                        ║
║    • canteen1@noqx.test (canteen_admin)                   ║
║    • canteen2@noqx.test (canteen_admin)                   ║
║    • worker1@noqx.test (worker)                           ║
║    • coadmin@noqx.test (co_admin)                         ║
║                                                            ║
║  Ready for fresh E2E testing!                             ║
╚════════════════════════════════════════════════════════════╝
`);
}

main().catch((e) => {
  console.error("\n❌ FATAL ERROR:", e);
  process.exit(1);
});

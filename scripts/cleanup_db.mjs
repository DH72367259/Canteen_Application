/**
 * scripts/cleanup_db.mjs — Wipe all dummy/test data from Supabase.
 *
 * Behaviour:
 *  - Deletes ALL: cart_items, payments, order_items, orders, reward_transactions,
 *    rewards, support_tickets, campaigns, notification_reads, notifications,
 *    device_tokens, slots_override, logs.
 *  - Deletes ALL Auth users + profiles EXCEPT the whitelist below.
 *  - Resets each whitelisted user's password to the canonical value.
 *  - Resets bin allocations: any bin currently `current_order_id` set → cleared,
 *    state → 'free' (best-effort; adjusts to actual schema).
 *
 * Run: `node scripts/cleanup_db.mjs`
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

// Load .env.local manually
const envText = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const line of envText.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.+)$/);
  if (m) process.env[m[1]] = m[2];
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const sb = createClient(url, serviceKey, { auth: { persistSession: false } });

const WHITELIST = [
  { email: "admin@noqx.test",    password: "Admin@12345",   role: "super_admin"  },
  { email: "canteen1@noqx.test", password: "Canteen@12345", role: "canteen_admin" },
  { email: "canteen2@noqx.test", password: "Canteen@12345", role: "canteen_admin" },
  { email: "worker1@noqx.test",  password: "Worker@12345",  role: "worker"        },
  { email: "coadmin@noqx.test",  password: "Coadmin@12345", role: "co_admin"      },
];

const log = (...a) => console.log("•", ...a);
const ok  = (...a) => console.log("✓", ...a);
const warn = (...a) => console.warn("!", ...a);

async function nuke(table, label = table) {
  // Use a guaranteed-true filter: id is not null (every row has a PK).
  const { error, count } = await sb.from(table).delete({ count: "exact" }).not("id", "is", null);
  if (error) {
    if (/relation .* does not exist|table .* does not exist/i.test(error.message ?? "")) {
      warn(`skip ${label} (table absent)`);
      return 0;
    }
    warn(`delete ${label} failed: ${error.message}`);
    return 0;
  }
  ok(`cleared ${label} (${count ?? "?"} rows)`);
  return count ?? 0;
}

async function nukeBy(table, column, label) {
  const { error, count } = await sb.from(table).delete({ count: "exact" }).not(column, "is", null);
  if (error) {
    if (/relation .* does not exist/i.test(error.message ?? "")) { warn(`skip ${label}`); return 0; }
    warn(`delete ${label} failed: ${error.message}`);
    return 0;
  }
  ok(`cleared ${label} (${count ?? "?"} rows)`);
  return count ?? 0;
}

async function main() {
  log("=== STEP 1: Wipe transactional data ===");
  // Order matters because of FKs.
  await nuke("cart_items");
  await nuke("payments");
  await nuke("order_items");
  await nuke("reward_transactions");
  await nuke("rewards");
  await nuke("support_tickets");
  await nuke("notification_reads");
  await nuke("notifications");
  await nuke("device_tokens");
  await nuke("logs");
  await nuke("slots_override");
  await nuke("campaigns");
  await nuke("orders");

  log("=== STEP 2: Reset all bin allocations ===");
  const { error: binErr, count: binCount } = await sb
    .from("bins")
    .update({ is_occupied: false, order_id: null, assigned_order_id: null, status: "empty" }, { count: "exact" })
    .not("id", "is", null);
  if (binErr) warn(`bin reset failed: ${binErr.message}`);
  else ok(`bins reset to empty (${binCount ?? "?"} rows)`);

  log("=== STEP 3: Identify users to keep ===");
  // Page through all auth users
  const allAuthUsers = [];
  let pageNum = 1;
  while (true) {
    const { data, error } = await sb.auth.admin.listUsers({ page: pageNum, perPage: 200 });
    if (error) { console.error(error); process.exit(2); }
    if (!data.users.length) break;
    allAuthUsers.push(...data.users);
    if (data.users.length < 200) break;
    pageNum++;
  }
  log(`found ${allAuthUsers.length} auth users total`);

  const whitelistEmails = new Set(WHITELIST.map(w => w.email.toLowerCase()));
  const keepers = allAuthUsers.filter(u => whitelistEmails.has((u.email ?? "").toLowerCase()));
  const victims = allAuthUsers.filter(u => !whitelistEmails.has((u.email ?? "").toLowerCase()));
  ok(`keeping ${keepers.length}, deleting ${victims.length}`);
  for (const k of keepers) console.log(`   keep: ${k.email}`);
  for (const v of victims) console.log(`   drop: ${v.email}`);

  log("=== STEP 4: Delete non-whitelisted users ===");
  let deleted = 0, failed = 0;
  for (const v of victims) {
    const { error } = await sb.auth.admin.deleteUser(v.id);
    if (error) { warn(`failed ${v.email}: ${error.message}`); failed++; }
    else deleted++;
  }
  ok(`deleted ${deleted} users (${failed} failed)`);

  log("=== STEP 5: Reset whitelist passwords ===");
  for (const w of WHITELIST) {
    const match = keepers.find(k => (k.email ?? "").toLowerCase() === w.email);
    if (!match) { warn(`whitelist user missing: ${w.email}`); continue; }
    const { error } = await sb.auth.admin.updateUserById(match.id, {
      password: w.password,
      email_confirm: true,
      user_metadata: { has_password: true, password_changed_at: new Date().toISOString(), must_change_password: false },
    });
    if (error) warn(`pw reset ${w.email}: ${error.message}`);
    else ok(`reset password: ${w.email} → ${w.password}`);
  }

  log("=== STEP 6: Verify final state ===");
  const { count: orderCount } = await sb.from("orders").select("*", { count: "exact", head: true });
  const { count: cartCount }  = await sb.from("cart_items").select("*", { count: "exact", head: true });
  const { count: payCount }   = await sb.from("payments").select("*", { count: "exact", head: true });
  const { count: profileCount } = await sb.from("profiles").select("*", { count: "exact", head: true });
  ok(`orders: ${orderCount}, cart_items: ${cartCount}, payments: ${payCount}, profiles: ${profileCount}`);

  console.log("\nDONE.");
}

main().catch((e) => { console.error(e); process.exit(1); });

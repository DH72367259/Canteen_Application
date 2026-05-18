#!/usr/bin/env node
/**
 * Read-only: show row counts for every table on the chosen env, so we know
 * exactly what would be affected before a cleanup.
 *
 * Usage:
 *   node scripts/inspect-db-counts.mjs --env=staging
 *   node scripts/inspect-db-counts.mjs --env=production
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const envArg = (args.find((a) => a.startsWith("--env="))?.split("=")[1] ?? "staging").toLowerCase();
const envFile = envArg === "production" ? ".env.local" : ".env.staging";
const raw = readFileSync(envFile, "utf8");
for (const line of raw.split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

console.log(`\n${envArg.toUpperCase()}  →  ${process.env.NEXT_PUBLIC_SUPABASE_URL}\n`);

const tables = [
  "profiles", "canteens", "menu_items", "time_slots", "slot_control", "bins",
  "orders", "order_items", "order_bins", "payments", "payment_ledger",
  "notifications", "notification_reads", "platform_charges",
  "canteen_bank_details", "subscriptions", "wallet_transactions",
  "reward_transactions", "campaigns", "audit_log", "cart_items",
];

for (const t of tables) {
  const { count, error } = await db.from(t).select("*", { count: "exact", head: true });
  if (error) {
    console.log(`  ${t.padEnd(25)} : (missing or error: ${error.code ?? error.message})`);
  } else {
    console.log(`  ${t.padEnd(25)} : ${count}`);
  }
}

// Auth users (separate API)
const { data: { users = [] } = {} } = await db.auth.admin.listUsers({ perPage: 1000 });
console.log(`  ${"auth.users".padEnd(25)} : ${users.length}`);

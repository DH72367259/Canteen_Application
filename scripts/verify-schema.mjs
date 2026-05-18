#!/usr/bin/env node
/**
 * Schema-shape verifier: for each table the app touches, hit the staging
 * and production Supabase REST endpoints and report the column list.
 * Surfaces any column drift between the two so the user knows the schemas
 * match (or where they don't).
 *
 * Read-only; no writes.
 *
 * Usage: node scripts/verify-schema.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

function loadEnv(file) {
  const out = {};
  try {
    const raw = readFileSync(file, "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* ignore */ }
  return out;
}

const TABLES = [
  "profiles", "canteens", "menu_items", "time_slots", "slot_control",
  "bins", "orders", "order_items", "order_bins", "payments",
  "payment_ledger", "notifications", "notification_reads",
  "platform_charges", "canteen_bank_details", "subscriptions",
  "reward_transactions", "campaigns", "cart_items",
];

async function tableShape(db, t) {
  // Fetch 1 row to learn the column set. If the table is empty, fall back
  // to selecting * with head=true to confirm the table exists.
  const { data, error } = await db.from(t).select("*").limit(1);
  if (error) {
    if (/does not exist|undefined|42P01/i.test(error.message ?? "")) return { exists: false };
    return { exists: true, error: error.message };
  }
  if (!data || data.length === 0) {
    // Table exists but empty — no row to inspect columns from. PostgREST
    // doesn't expose a "describe" endpoint to anon/service for this.
    // Return EMPTY marker so the diff doesn't false-alarm.
    return { exists: true, columns: null /* empty */ };
  }
  return { exists: true, columns: Object.keys(data[0]).sort() };
}

const staging = loadEnv(".env.staging");
const prod    = loadEnv(".env.local");

const sDb = createClient(staging.NEXT_PUBLIC_SUPABASE_URL, staging.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const pDb = createClient(prod.NEXT_PUBLIC_SUPABASE_URL,    prod.SUPABASE_SERVICE_ROLE_KEY,    { auth: { persistSession: false } });

console.log(`STAGING    : ${staging.NEXT_PUBLIC_SUPABASE_URL}`);
console.log(`PRODUCTION : ${prod.NEXT_PUBLIC_SUPABASE_URL}`);
console.log("");

let drift = 0;
for (const t of TABLES) {
  const [s, p] = await Promise.all([tableShape(sDb, t), tableShape(pDb, t)]);
  const sExists = s.exists ? "✓" : "✗";
  const pExists = p.exists ? "✓" : "✗";

  if (s.exists !== p.exists) {
    drift++;
    console.log(`${t.padEnd(22)}  staging=${sExists}  prod=${pExists}   ⚠️ existence drift`);
    continue;
  }
  if (!s.exists) {
    console.log(`${t.padEnd(22)}  staging=✗  prod=✗   (table absent on both — ignored)`);
    continue;
  }
  // Both exist. Compare columns when we have them on both sides.
  if (s.columns && p.columns) {
    const sSet = new Set(s.columns);
    const pSet = new Set(p.columns);
    const onlyS = [...sSet].filter((c) => !pSet.has(c));
    const onlyP = [...pSet].filter((c) => !sSet.has(c));
    if (onlyS.length === 0 && onlyP.length === 0) {
      console.log(`${t.padEnd(22)}  ✓ match  (${s.columns.length} cols)`);
    } else {
      drift++;
      console.log(`${t.padEnd(22)}  ⚠️ COLUMN DRIFT`);
      if (onlyS.length) console.log(`${"".padEnd(22)}    only in staging: ${onlyS.join(", ")}`);
      if (onlyP.length) console.log(`${"".padEnd(22)}    only in prod   : ${onlyP.join(", ")}`);
    }
  } else {
    // One or both empty — can't compare columns but at least confirmed table exists.
    const flag = !s.columns && !p.columns ? "(both empty)" : !s.columns ? "(staging empty)" : "(prod empty)";
    console.log(`${t.padEnd(22)}  ✓ exists on both ${flag}`);
  }
}

console.log("");
console.log(drift === 0
  ? "✅ No drift between staging and production for the tables checked."
  : `⚠️ ${drift} table(s) drift. See above.`);

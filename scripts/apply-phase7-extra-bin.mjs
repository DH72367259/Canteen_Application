#!/usr/bin/env node
/**
 * apply-phase7-extra-bin.mjs
 *
 * Runner for the Phase-7 extra-bin workflow migration.
 * Mirrors apply-phase6-indexes.mjs.
 *
 *   SUPABASE_DB_URL=postgres://... node scripts/apply-phase7-extra-bin.mjs
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sqlPath = resolve(here, "../supabase/migrations/phase7_extra_bin_workflow.sql");

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error("\u274c SUPABASE_DB_URL is not set.");
  process.exit(1);
}

let pg;
try {
  pg = await import("pg");
} catch {
  console.error("\u274c The 'pg' package is not installed. Run: npm install --no-save pg");
  process.exit(1);
}
const { Client } = pg.default ?? pg;

const sql = readFileSync(sqlPath, "utf8");

const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  console.log("\u25b6 Applying phase7_extra_bin_workflow.sql\n");
  const start = Date.now();
  await client.query(sql);
  console.log(`  \u2705 applied in ${Date.now() - start} ms`);
} catch (err) {
  console.log(`  \u274c ${err.message}`);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}

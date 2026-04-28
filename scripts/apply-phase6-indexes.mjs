#!/usr/bin/env node
/**
 * apply-phase6-indexes.mjs
 *
 * One-shot runner for the phase6 scaling-index migration.
 *
 * Usage:
 *   1. Make sure your local .env file has SUPABASE_DB_URL set, e.g.:
 *        SUPABASE_DB_URL=postgresql://postgres.<ref>:<pwd>@aws-0-<region>.pooler.supabase.com:5432/postgres
 *      You'll find this in: Supabase Dashboard -> Project Settings -> Database -> Connection string -> URI
 *      (use the SESSION mode, port 5432 — NOT the transaction pooler)
 *
 *   2. Run:
 *        node scripts/apply-phase6-indexes.mjs
 *
 * Why a script (not just SQL editor)?
 *   CREATE INDEX CONCURRENTLY cannot run inside a transaction. The Supabase
 *   SQL editor wraps every batch in BEGIN/COMMIT, so the only sane path is
 *   to run each statement on its own connection — which is exactly what
 *   this script does.
 *
 * Safe to re-run: every index is `IF NOT EXISTS`. Failures don't roll back
 * other indexes — the script reports per-statement status at the end.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sqlPath = resolve(here, "../supabase/migrations/phase6_scaling_indexes.sql");

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error("\u274c SUPABASE_DB_URL is not set. See header of this file for instructions.");
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

// Strip comments + blank lines, then split on `;` so each CREATE INDEX
// runs in its own implicit transaction (CONCURRENTLY requires this).
const statements = sql
  .split("\n")
  .filter(line => !line.trim().startsWith("--"))
  .join("\n")
  .split(";")
  .map(s => s.trim())
  .filter(s => s.length > 0);

console.log(`\u25b6 Applying ${statements.length} statement(s) from phase6_scaling_indexes.sql\n`);

const results = [];
for (const stmt of statements) {
  const summary = stmt.replace(/\s+/g, " ").slice(0, 90) + (stmt.length > 90 ? "..." : "");
  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    const start = Date.now();
    await client.query(stmt);
    const ms = Date.now() - start;
    console.log(`  \u2705 (${ms} ms) ${summary}`);
    results.push({ ok: true, summary });
  } catch (err) {
    console.log(`  \u274c ${summary}\n     -> ${err.message}`);
    results.push({ ok: false, summary, error: err.message });
  } finally {
    await client.end().catch(() => {});
  }
}

const ok = results.filter(r => r.ok).length;
const failed = results.length - ok;
console.log(`\n${ok}/${results.length} succeeded${failed > 0 ? `, ${failed} failed` : ""}.`);
process.exit(failed > 0 ? 1 : 0);

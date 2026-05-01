#!/usr/bin/env node
/**
 * scripts/backup_to_s3.mjs — nightly off-site backup for NoQx.
 *
 * Why this exists: Supabase Pro retains backups for 7 days. For multi-year
 * retention (DPDPA/GST/audit) we need our own copy in our own bucket. This
 * runs nightly via the GitHub Action at .github/workflows/nightly-backup.yml
 * and uploads a gzipped pg_dump to S3-compatible storage.
 *
 * Required env:
 *   DATABASE_URL                 - Supabase pooler URL (postgres://...)
 *   S3_ENDPOINT                  - e.g. https://s3.amazonaws.com  or  https://<account>.r2.cloudflarestorage.com
 *   S3_REGION                    - e.g. us-east-1  (use 'auto' for R2)
 *   S3_BUCKET                    - destination bucket
 *   S3_ACCESS_KEY_ID             - IAM access key
 *   S3_SECRET_ACCESS_KEY         - IAM secret key
 *   BACKUP_RETENTION_DAYS=400    - how many days of backups to keep (default 400)
 *
 * Usage:
 *   node scripts/backup_to_s3.mjs            # dump + upload
 *   node scripts/backup_to_s3.mjs --dry-run  # dump locally only
 *
 * This script is intentionally dependency-free at runtime except for `pg_dump`
 * and `aws` CLI, both of which the GitHub Action installs.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REQUIRED = ["DATABASE_URL", "S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"];
const dryRun = process.argv.includes("--dry-run");
if (!dryRun) {
  const missing = REQUIRED.filter(k => !process.env[k]);
  if (missing.length) { console.error("Missing env:", missing.join(", ")); process.exit(2); }
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").replace("Z", "");
const work = mkdtempSync(join(tmpdir(), "noqx-backup-"));
const dumpFile = join(work, `noqx-${stamp}.sql.gz`);

console.log(`[backup] starting ${stamp}`);
console.log(`[backup] dump target: ${dumpFile}`);

try {
  // pg_dump | gzip > file. We use --no-owner / --no-privileges so the dump
  // can be restored into any Postgres without role mismatches, and -Fp (plain)
  // so we can grep / inspect / partial-restore later without the custom format.
  const dump = spawnSync("bash", ["-lc",
    `pg_dump --no-owner --no-privileges --no-acl -Fp "$DATABASE_URL" | gzip -9 > "${dumpFile}"`,
  ], { stdio: ["ignore", "inherit", "inherit"] });
  if (dump.status !== 0) throw new Error(`pg_dump exited ${dump.status}`);

  const size = statSync(dumpFile).size;
  console.log(`[backup] dump complete: ${(size / 1024 / 1024).toFixed(2)} MiB`);
  if (size < 4096) throw new Error("dump is suspiciously small (<4 KiB) — refusing to upload");

  if (dryRun) {
    console.log(`[backup] --dry-run set; skipping upload. File at: ${dumpFile}`);
    process.exit(0);
  }

  // Upload via aws CLI (works with S3, R2, Backblaze B2, MinIO).
  const key = `noqx/${stamp.slice(0, 10)}/noqx-${stamp}.sql.gz`;
  console.log(`[backup] uploading -> s3://${process.env.S3_BUCKET}/${key}`);
  execFileSync("aws", [
    "s3", "cp", dumpFile, `s3://${process.env.S3_BUCKET}/${key}`,
    "--endpoint-url", process.env.S3_ENDPOINT,
    "--region", process.env.S3_REGION,
    // Server-side encryption when supported; harmless if the provider ignores it.
    "--sse", "AES256",
  ], { stdio: "inherit", env: {
    ...process.env,
    AWS_ACCESS_KEY_ID:     process.env.S3_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
  }});

  // Retention prune: list keys older than N days and delete. Conservative
  // default 400 days = ~13 months so monthly archives always survive.
  const retentionDays = Number(process.env.BACKUP_RETENTION_DAYS ?? 400);
  const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  const cutoffPrefix = cutoffDate.toISOString().slice(0, 10);
  console.log(`[backup] pruning keys older than ${cutoffPrefix} (retention ${retentionDays} days)`);
  const listed = execFileSync("aws", [
    "s3api", "list-objects-v2",
    "--bucket", process.env.S3_BUCKET,
    "--prefix", "noqx/",
    "--endpoint-url", process.env.S3_ENDPOINT,
    "--region", process.env.S3_REGION,
    "--output", "json",
    "--query", "Contents[].Key",
  ], { env: {
    ...process.env,
    AWS_ACCESS_KEY_ID:     process.env.S3_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
  }}).toString();
  const keys = (JSON.parse(listed) || []).filter(Boolean);
  const toDelete = keys.filter(k => {
    const m = k.match(/noqx\/(\d{4}-\d{2}-\d{2})\//);
    return m && m[1] < cutoffPrefix;
  });
  console.log(`[backup] ${keys.length} total objects, ${toDelete.length} eligible for prune`);
  for (const k of toDelete) {
    execFileSync("aws", [
      "s3", "rm", `s3://${process.env.S3_BUCKET}/${k}`,
      "--endpoint-url", process.env.S3_ENDPOINT,
      "--region", process.env.S3_REGION,
    ], { stdio: "inherit", env: {
      ...process.env,
      AWS_ACCESS_KEY_ID:     process.env.S3_ACCESS_KEY_ID,
      AWS_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
    }});
  }

  console.log(`[backup] OK — ${stamp}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}

#!/usr/bin/env bash
# ------------------------------------------------------------------
# scripts/setup_backup_secrets.sh
#
# Interactively loads the 6 GitHub Actions secrets required by
# .github/workflows/nightly-backup.yml so the daily off-site backup
# job (scripts/backup_to_s3.mjs) can run.
#
# Prerequisites:
#   - GitHub CLI installed:  brew install gh
#   - Logged in:             gh auth login
#   - You are inside the repo (this script auto-detects via gh).
#
# Run:    bash scripts/setup_backup_secrets.sh
#
# What it does: prompts for each value (hides input for the secret
# ones), then calls `gh secret set` for each. Re-running overwrites.
# ------------------------------------------------------------------

set -euo pipefail

if ! command -v gh >/dev/null 2>&1; then
  echo "ERROR: GitHub CLI ('gh') is not installed."
  echo "       Install with: brew install gh"
  echo "       Then run:     gh auth login"
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "ERROR: gh is not authenticated. Run: gh auth login"
  exit 1
fi

echo "============================================================"
echo " NoQx — Off-site Backup Secrets Setup"
echo "============================================================"
echo
echo "You will be prompted for 6 values. Press Ctrl-C to abort."
echo "Tip: secret-looking values are read with hidden input."
echo

# ----- 1. BACKUP_DATABASE_URL ------------------------------------
echo "1/6  BACKUP_DATABASE_URL"
echo "     Supabase → Project Settings → Database → Connection string"
echo "     Use the 'Session pooler' / direct connection URI (port 5432),"
echo "     NOT the transaction pooler. Format:"
echo "       postgresql://postgres:<PASSWORD>@db.<ref>.supabase.co:5432/postgres"
read -r -s -p "     Paste value: " BACKUP_DATABASE_URL; echo
[[ -z "$BACKUP_DATABASE_URL" ]] && { echo "Empty value — aborting."; exit 1; }

# ----- 2. BACKUP_S3_ENDPOINT --------------------------------------
echo
echo "2/6  BACKUP_S3_ENDPOINT"
echo "     Cloudflare R2:  https://<account-id>.r2.cloudflarestorage.com"
echo "     Backblaze B2:   https://s3.<region>.backblazeb2.com"
echo "     AWS S3:         https://s3.<region>.amazonaws.com  (or leave blank for default)"
read -r -p "     Paste value: " BACKUP_S3_ENDPOINT
[[ -z "$BACKUP_S3_ENDPOINT" ]] && { echo "Empty value — aborting."; exit 1; }

# ----- 3. BACKUP_S3_REGION ----------------------------------------
echo
echo "3/6  BACKUP_S3_REGION"
echo "     R2:  auto"
echo "     B2:  e.g. us-west-002"
echo "     AWS: e.g. ap-south-1"
read -r -p "     Paste value: " BACKUP_S3_REGION
[[ -z "$BACKUP_S3_REGION" ]] && { echo "Empty value — aborting."; exit 1; }

# ----- 4. BACKUP_S3_BUCKET ----------------------------------------
echo
echo "4/6  BACKUP_S3_BUCKET"
echo "     Bucket name only, e.g. noqx-prod-backups"
read -r -p "     Paste value: " BACKUP_S3_BUCKET
[[ -z "$BACKUP_S3_BUCKET" ]] && { echo "Empty value — aborting."; exit 1; }

# ----- 5. BACKUP_S3_ACCESS_KEY_ID ---------------------------------
echo
echo "5/6  BACKUP_S3_ACCESS_KEY_ID"
read -r -s -p "     Paste value: " BACKUP_S3_ACCESS_KEY_ID; echo
[[ -z "$BACKUP_S3_ACCESS_KEY_ID" ]] && { echo "Empty value — aborting."; exit 1; }

# ----- 6. BACKUP_S3_SECRET_ACCESS_KEY -----------------------------
echo
echo "6/6  BACKUP_S3_SECRET_ACCESS_KEY"
read -r -s -p "     Paste value: " BACKUP_S3_SECRET_ACCESS_KEY; echo
[[ -z "$BACKUP_S3_SECRET_ACCESS_KEY" ]] && { echo "Empty value — aborting."; exit 1; }

echo
echo "------------------------------------------------------------"
echo " Pushing 6 secrets to GitHub..."
echo "------------------------------------------------------------"

set_secret() {
  local name="$1" value="$2"
  printf '%s' "$value" | gh secret set "$name" --body -
  echo "  ✅  $name"
}

set_secret BACKUP_DATABASE_URL          "$BACKUP_DATABASE_URL"
set_secret BACKUP_S3_ENDPOINT           "$BACKUP_S3_ENDPOINT"
set_secret BACKUP_S3_REGION             "$BACKUP_S3_REGION"
set_secret BACKUP_S3_BUCKET             "$BACKUP_S3_BUCKET"
set_secret BACKUP_S3_ACCESS_KEY_ID      "$BACKUP_S3_ACCESS_KEY_ID"
set_secret BACKUP_S3_SECRET_ACCESS_KEY  "$BACKUP_S3_SECRET_ACCESS_KEY"

echo
echo "============================================================"
echo " ✅  All 6 secrets set."
echo
echo " Trigger a one-off run to verify (no need to wait for 02:30 UTC):"
echo "   gh workflow run nightly-backup.yml"
echo
echo " Then watch it:"
echo "   gh run watch"
echo
echo " On success, list objects in the bucket to confirm the dump landed:"
echo "   aws s3 ls s3://$BACKUP_S3_BUCKET/ --endpoint-url $BACKUP_S3_ENDPOINT"
echo "============================================================"

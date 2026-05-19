#!/usr/bin/env bash
# Generate upload keystores for the NoQx Student and NoQx Worker Android apps.
#
# Output: ~/noqx-keystores/
#   ├── student.jks             — bind into android-internal.yml secrets
#   ├── student.base64
#   ├── student.env             — copy/paste-friendly secret name=value pairs
#   ├── worker.jks              — bind into android-worker-internal.yml secrets
#   ├── worker.base64
#   ├── worker.env
#   └── README.txt              — backup + secret-paste instructions
#
# CRITICAL: Back up ~/noqx-keystores/ to a secure offsite location (1Password,
# iCloud Drive in a folder you control, encrypted USB). If you lose the .jks
# files you cannot update your apps on Play Store — ever. Google will not
# help you recover them.
#
# Re-runnable: refuses to overwrite an existing keystore so you can't
# accidentally destroy your shipping signing keys.

set -euo pipefail

OUT="${HOME}/noqx-keystores"
mkdir -p "$OUT"
cd "$OUT"

gen_keystore() {
  local label="$1"           # student or worker
  local alias="$2"           # key alias inside the keystore
  local dname="$3"           # X.500 dname for the cert

  local jks="${label}.jks"
  if [ -f "$jks" ]; then
    echo "⚠️  $jks already exists — skipping. Delete it manually if you really want to regenerate."
    return
  fi

  # openssl gives clean 32-char base64-ish random strings without the
  # SIGPIPE issues of `tr < /dev/urandom | head` under `set -o pipefail`.
  local store_pw
  local key_pw
  store_pw="$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-32)"
  key_pw="$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-32)"

  keytool -genkeypair \
    -alias "$alias" \
    -keyalg RSA -keysize 2048 -validity 10950 \
    -keystore "$jks" \
    -storepass "$store_pw" \
    -keypass "$key_pw" \
    -dname "$dname" \
    -storetype JKS 2>/dev/null

  base64 -i "$jks" > "${label}.base64"

  local prefix
  if [ "$label" = "student" ]; then
    prefix="ANDROID"
  else
    prefix="WORKER_ANDROID"
  fi

  cat > "${label}.env" <<EOF
# GitHub Secrets for the ${label} Android app.
# Repo → Settings → Secrets and variables → Actions → New repository secret.
# Paste each variable below as a separate secret with the exact NAME shown.

${prefix}_KEYSTORE_BASE64=$(cat "${label}.base64")

${prefix}_KEYSTORE_PASSWORD=${store_pw}

${prefix}_KEY_ALIAS=${alias}

${prefix}_KEY_PASSWORD=${key_pw}
EOF

  chmod 600 "$jks" "${label}.base64" "${label}.env"
  echo "✓ Generated ${label}.jks + ${label}.env (read perms restricted to you)"
}

gen_keystore "student" "upload" \
  "CN=NoQx Student Upload, OU=Mobile, O=NoQx, L=Bengaluru, ST=Karnataka, C=IN"

gen_keystore "worker"  "upload" \
  "CN=NoQx Worker Upload, OU=Mobile, O=NoQx, L=Bengaluru, ST=Karnataka, C=IN"

cat > README.txt <<'EOF'
NoQx Android Signing Keystores
==============================

Files in this folder:
  student.jks       — sign the NoQx Student Android app (com.noqx.student)
  student.base64    — base64 of student.jks (paste as ANDROID_KEYSTORE_BASE64 secret)
  student.env       — all 4 GitHub Secret name=value pairs for the student app
  worker.jks        — sign the NoQx Worker Android app (com.noqx.worker)
  worker.base64     — base64 of worker.jks
  worker.env        — all 4 GitHub Secret name=value pairs for the worker app

How to use
----------
1. Open student.env. Open GitHub → repo Settings → Secrets and variables →
   Actions → New repository secret. Create one secret per non-blank line,
   using the NAME on the left and the VALUE on the right of the = sign.

2. Repeat for worker.env.

3. Both Android CI workflows (android-internal.yml and android-worker-internal.yml)
   will start producing SIGNED .aab files immediately. The next workflow run
   will also push to Play Store internal track IF you've also populated
   PLAY_STORE_JSON_KEY (student) and WORKER_PLAY_STORE_JSON_KEY (worker).

Back this folder up
-------------------
LOSING THESE FILES = YOU CANNOT UPDATE YOUR APPS ON PLAY STORE — EVER.
Google's signing key rotation does not help here for the upload key.

Recommended backup:
  - Copy this entire folder to 1Password as a "Document" attachment
  - Copy to an encrypted USB stick stored separately
  - Do NOT push to git, do NOT email, do NOT Slack
EOF

chmod 600 README.txt

echo ""
echo "═══════════════════════════════════════════════════════════════════════"
echo "  ✓ Keystores generated at: $OUT"
echo "═══════════════════════════════════════════════════════════════════════"
echo ""
echo "  Next steps:"
echo "    1. open '$OUT'         # see all files"
echo "    2. cat student.env     # copy each line into GitHub Secrets"
echo "    3. cat worker.env      # same for worker"
echo "    4. BACK UP THE FOLDER — losing the .jks files breaks all future updates"
echo ""

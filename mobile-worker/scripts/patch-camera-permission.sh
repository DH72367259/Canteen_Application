#!/usr/bin/env bash
# Adds CAMERA permission to the worker app's AndroidManifest.
#
# Worker scans QRs from inside the WebView via getUserMedia(). On Android,
# Capacitor's BridgeWebChromeClient only grants WebView camera access if
# the host AndroidManifest declares CAMERA. Without this, QR scan fails
# silently with "permission denied".
#
# Idempotent — skips if already patched.
# Run after every `npx cap add android` (which regenerates the manifest).

set -euo pipefail

cd "$(dirname "$0")/.."
MANIFEST="android/app/src/main/AndroidManifest.xml"

if [ ! -f "$MANIFEST" ]; then
  echo "❌ $MANIFEST not found. Run 'npx cap add android' first."
  exit 1
fi

if grep -q "android.permission.CAMERA" "$MANIFEST"; then
  echo "✓ CAMERA permission already present in $MANIFEST"
  exit 0
fi

python3 - <<EOF
import re
path = "$MANIFEST"
text = open(path).read()
inject = '    <uses-permission android:name="android.permission.CAMERA" />\n    <uses-feature android:name="android.hardware.camera" android:required="false" />\n'
text = re.sub(r'(\s*</manifest>)', inject + r'\1', text, count=1)
open(path, 'w').write(text)
EOF

echo "✓ Added CAMERA permission to $MANIFEST"

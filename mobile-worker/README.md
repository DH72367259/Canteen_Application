# NoQx Worker — Android App

A Capacitor shell that wraps the live Next.js `/worker` routes from
`https://noqx.co.in` into an installable Android app for canteen staff.

The app does NOT contain its own UI — it loads the production web app
inside a WebView. Updating the web app (push to dev → Railway redeploy)
also updates the app. No store re-submission required for routine
changes; only re-submit when the Android shell itself changes
(plugins, native config, signing).

## Initial setup (run once on your laptop)

```bash
cd mobile-worker
npm install
npx cap add android        # generates the android/ directory
npx cap sync android

# REQUIRED: grant WebView camera access for QR scanning. CI does this
# automatically; for local builds, run once after every `cap add android`:
./scripts/patch-camera-permission.sh
```

## Build a debug APK locally

```bash
cd mobile-worker/android
./gradlew assembleDebug
# APK lands at android/app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

## Build a signed release AAB (for Play Store)

Done by CI — see `.github/workflows/android-worker-internal.yml`.
Local equivalent:

```bash
cd mobile-worker/android
./gradlew bundleRelease \
  -Pandroid.injected.signing.store.file=app/upload.jks \
  -Pandroid.injected.signing.store.password=<password> \
  -Pandroid.injected.signing.key.alias=upload \
  -Pandroid.injected.signing.key.password=<password>
# AAB lands at android/app/build/outputs/bundle/release/app-release.aab
```

## Role enforcement

When this app launches, it loads `/worker/login`. After login,
`NativeWorkerGuard` (in the shared codebase at `components/NativeWorkerGuard.tsx`)
detects `appId === 'com.noqx.worker'` and signs out anyone whose role
is not `worker`. Students and admins get a "Worker app only" screen
directing them to the appropriate app or web portal.

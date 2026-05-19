# NoQx Mobile App — Release Checklist

Three apps, two stores:

| App | Platform | Workflow | Package ID |
|-----|----------|----------|------------|
| NoQx Student | iOS (App Store) | [ios-testflight.yml](.github/workflows/ios-testflight.yml) | com.noqx.student |
| NoQx Student | Android (Play Store) | [android-internal.yml](.github/workflows/android-internal.yml) | com.noqx.student |
| NoQx Worker | Android only (Play Store) | [android-worker-internal.yml](.github/workflows/android-worker-internal.yml) | com.noqx.worker |

Both apps wrap the existing Next.js codebase served from `https://noqx.up.railway.app`
inside a native WebView (Capacitor). **No duplicate code.** Update the web app → app
behavior updates automatically. Only re-submit to stores when the native shell
itself changes (plugins, signing, icons, splash, native config).

---

## What's already done

- Student capacitor config + iOS + Android dirs — committed at repo root
- Worker capacitor config + scaffold — `mobile-worker/`
- NativeStudentGuard / NativeWorkerGuard — role-based sign-out (per appId)
- Capacitor bootstrap: status-bar styling + push-notification registration
- All 3 CI workflows tolerate missing secrets — they build artifacts (AAB + debug APK)
  and skip the store upload. Once secrets are populated, the same workflow auto-uploads.

---

## What's pending from your end (one-time setup)

### 1. Android keystores — DONE locally, just paste into GitHub Secrets

Both keystores already generated at `~/noqx-keystores/` (outside the repo).

```bash
cat ~/noqx-keystores/student.env
cat ~/noqx-keystores/worker.env
```

For each file, paste the 4 `NAME=VALUE` pairs into:
**GitHub → Settings → Secrets and variables → Actions → New repository secret**

Student secrets (4):
- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

Worker secrets (4):
- `WORKER_ANDROID_KEYSTORE_BASE64`
- `WORKER_ANDROID_KEYSTORE_PASSWORD`
- `WORKER_ANDROID_KEY_ALIAS`
- `WORKER_ANDROID_KEY_PASSWORD`

**CRITICAL:** Back up `~/noqx-keystores/` (1Password "Document", encrypted USB, iCloud
folder you control). Losing those .jks files = you can never update either app on
Play Store. Google does not help recover lost upload keystores.

### 2. Google Play Console ($25 one-time, lifetime)

1. Sign up at https://play.google.com/console — pay $25
2. **App → Create app:**
   - First app: package `com.noqx.student`, name "NoQx Student"
   - Second app: package `com.noqx.worker`, name "NoQx Worker"
3. Fill: privacy policy URL (link to your `/privacy` page on noqx.up.railway.app),
   content rating, target audience, data safety, app category (Food & Drink),
   icon (512×512), feature graphic (1024×500), 2-8 phone screenshots per app.
4. **Internal testing track → Testers → add tester emails.** Internal track is
   private and has no review delay, so you can dogfood before going public.
5. **Setup → API access → Create new service account → grant "Release manager" role.**
   Download the JSON key. Paste its contents into GitHub Secrets:
   - `PLAY_STORE_JSON_KEY` (student)
   - `WORKER_PLAY_STORE_JSON_KEY` (worker)

After secrets are populated, the CI workflow uploads to the internal track
automatically on each `release/1.0` push (student) or `release/worker-1.0` push (worker).

### 3. Apple Developer Program ($99/year)

iOS-only — skip if you decide not to ship the student app on App Store.

1. Enroll at https://developer.apple.com/programs (individual or organization,
   organization needs D-U-N-S number → adds 1-2 weeks).
2. **App Store Connect → My Apps → New App:** bundle ID `com.noqx.student`,
   name "NoQx Student", primary language English.
3. **Certificates, IDs & Profiles:**
   - Create an "iOS Distribution" certificate. Export from Keychain Access as
     `.p12` with a password. Base64-encode: `base64 -i dist.p12 -o dist.p12.b64`.
   - Create an "App Store" provisioning profile for `com.noqx.student`. Download
     `.mobileprovision`. Base64-encode it too.
4. **Users and Access → Keys → App Store Connect API → Generate API Key:**
   - Role: App Manager
   - Download the `.p8` file (one-time download — back it up).
   - Note the Key ID and Issuer ID.
   - Base64-encode the `.p8`: `base64 -i AuthKey_XXXX.p8 -o key.p8.b64`.
5. Paste into GitHub Secrets:
   - `IOS_DIST_CERT_P12_BASE64`         — contents of dist.p12.b64
   - `IOS_DIST_CERT_PASSWORD`           — the password you set for the .p12 export
   - `IOS_PROVISIONING_PROFILE_BASE64`  — contents of the .mobileprovision base64
   - `APP_STORE_CONNECT_API_KEY_ID`     — from step 4
   - `APP_STORE_CONNECT_ISSUER_ID`      — from step 4
   - `APP_STORE_CONNECT_API_KEY`        — contents of key.p8.b64

### 4. Store listing assets (both stores need these)

Per app: icon (512×512 Play, 1024×1024 App Store), feature graphic (1024×500 Play),
2-8 phone screenshots, app description (short + full), keywords, support URL,
privacy policy URL, marketing URL (optional), what's new (release notes).

Store these in `distribution/student/` and `distribution/worker/` — neither
folder exists yet; create them when you have the assets ready.

---

## Triggering a build manually

After at least the Android keystore secrets are populated:

```bash
# Student Android (produces signed AAB; uploads to Play if PLAY_STORE_JSON_KEY set)
gh workflow run android-internal.yml --ref dev

# Worker Android
gh workflow run android-worker-internal.yml --ref dev

# Student iOS (requires all 6 iOS secrets)
gh workflow run ios-testflight.yml --ref dev
```

Or via the GitHub web UI: **Actions tab → pick workflow → Run workflow**.

Each run also uploads the binary as a downloadable artifact (14-day retention)
so you can sideload it on a test device even before the store is configured.

---

## Triggering on tag (recommended for actual releases)

```bash
# Student v1.0
git tag v1.0.0 && git push origin v1.0.0
# → fires both android-internal.yml and ios-testflight.yml

# Worker v1.0
git tag worker-v1.0.0 && git push origin worker-v1.0.0
# → fires android-worker-internal.yml only
```

---

## Local sanity checks (before pushing a build)

```bash
# Student (existing setup)
npx cap sync android
cd android && ./gradlew assembleDebug
# APK at android/app/build/outputs/apk/debug/app-debug.apk

# Worker (first time only)
cd mobile-worker
npm install
npx cap add android        # one-time; generates mobile-worker/android/
npx cap sync android
cd android && ./gradlew assembleDebug
# APK at mobile-worker/android/app/build/outputs/apk/debug/app-debug.apk
```

Then `adb install -r path/to/app-debug.apk` to a real device.

---

## What this checklist deliberately does NOT cover

- App Store review (manual; Apple gates this — typical 1-3 day turnaround)
- Play Store review (~few hours for internal track, ~1-3 days for production)
- Crash reporting / analytics (Sentry, Firebase Crashlytics — not wired up yet)
- Deep links / universal links (not configured — orders are seen in-app via the
  web routes that the WebView already loads, so no deep links needed for v1)
- App updates strategy (over-the-air for web content happens automatically because
  the WebView reloads `noqx.up.railway.app` on each launch; only re-submit to
  stores when the native shell changes)

# Capacitor Production Flip — Checklist

The exact procedure for cutting both mobile apps from **staging** to
**production**. Do this once, when ready to submit to app stores or
distribute production APKs to the client.

**Reversible** — flip back to staging by re-running the same workflow
with `environment: staging`.

---

## How the flip works (key insight)

`capacitor.config.ts` reads `process.env.CAPACITOR_SERVER_URL` at sync
time. The GitHub Actions workflows already pass the right URL based on
the `environment` input:

```yaml
# .github/workflows/android-internal.yml line 47
CAPACITOR_SERVER_URL: ${{ (inputs.environment == 'production' || github.event_name == 'push') && 'https://noqx.co.in' || 'https://canteenapplication-staging.up.railway.app' }}
```

So the flip is **NOT a code change** — it's a workflow trigger choice.
This doc is the checklist to make sure nothing else breaks when you
make that choice.

---

## Pre-flip prerequisites (verify all green)

- [ ] Production web app is live and stable at https://noqx.co.in
      (run `node scripts/smoke-test-prod.mjs https://noqx.co.in` → 14/14)
- [ ] **Razorpay LIVE keys** deployed to Railway production env vars
      (or operator has explicitly chosen to ship with test keys for soft launch)
- [ ] Supabase production schema is current (no pending migrations)
- [ ] No active code freeze (operator confirms green to ship)
- [ ] `noqx.co.in` returns HTTP 200 for: `/`, `/login`, `/privacy`,
      `/terms`, `/refund`, `/contact`
- [ ] APK version bumped — see §3 below
- [ ] (Optional but recommended) Drained staging order queue so no
      test-state is visible to first real students

---

## Step 1 — Defensive: add noqx.co.in to allowNavigation

Both Capacitor configs whitelist hosts the WebView can navigate to.
Currently they list the Railway URLs but NOT `noqx.co.in`. Same-host
navigations work without it (the initial `server.url` establishes host
context), but adding it explicitly is defensive against Capacitor SDK
version drift.

**File:** `capacitor.config.ts`

```diff
 allowNavigation: [
   'canteenapplication-staging.up.railway.app',
   'canteenapplication-production.up.railway.app',
+  'noqx.co.in',
+  'www.noqx.co.in',
   '*.supabase.co',
   'api.razorpay.com',
   'checkout.razorpay.com',
   'lumberjack.razorpay.com',
 ],
```

**File:** `mobile-worker/capacitor.config.ts` — identical diff.

Commit + push (this is a real code change, not just a workflow trigger):
```bash
git commit -m "fix(mobile): whitelist noqx.co.in in Capacitor allowNavigation"
git push origin dev
```

---

## Step 2 — Bump APK version codes

Stores (and the in-app UpdateGate) reject builds with the same
`versionCode` as a previously-shipped one. Bump BEFORE building the
production APKs.

**File:** `android/app/build.gradle` (student)
```diff
-        versionCode 1
-        versionName "1.0.0"
+        versionCode 2
+        versionName "1.0.0"
```

**File:** `mobile-worker/android/app/build.gradle` (worker) — same.

The `versionName` can stay "1.0.0" for the first production release.
Bump it (e.g. "1.0.1") for subsequent hotfix builds.

Commit + push.

---

## Step 3 — Trigger production builds

```bash
TOKEN=$(security find-internet-password -s github.com -w)

# Student
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/DH72367259/Canteen_Application/actions/workflows/android-internal.yml/dispatches \
  -d '{"ref":"main","inputs":{"environment":"production"}}'

# Worker
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/DH72367259/Canteen_Application/actions/workflows/android-worker-internal.yml/dispatches \
  -d '{"ref":"main","inputs":{"environment":"production"}}'
```

Or via GitHub UI: Actions → "android-internal" → "Run workflow" →
branch `main`, environment `production`. Same for worker.

⚠️ **Use `ref: main` for production builds** — main is the branch app
stores download release candidates from. Using `dev` works but is sloppy
provenance.

Build time: ~6-8 min each.

---

## Step 4 — Download + sanity-check the APKs

When both workflows go green:

1. Open each workflow run page → Artifacts section at the bottom
2. Download `noqx-student-production.apk` and `noqx-worker-production.apk`
3. Install on a real Android device: `adb install -r noqx-student-production.apk`
4. Open app — verify on first launch:
   - Splash screen shows NoQx purple (#7c3aed)
   - Login page shows NoQx logo + purple branding (not orange)
   - Address-bar test: try to peek at `chrome://inspect/#devices` — server
     URL should be `https://noqx.co.in` (not staging Railway URL)
   - Login → place a test order (use Razorpay test card if live keys not
     yet deployed)

Do the same for worker app — install, log in as a test worker, see
"NoQx Worker · Staff Login" header.

---

## Step 5 — Bundle for stores

The `.apk` is for direct install + testing. For Play Store you need the
`.aab`:

1. Same workflow runs → look for the `.aab` artifact (built alongside .apk)
2. Upload via Play Console → Internal testing track first → graduate to
   Production track after smoke test

Apple TestFlight is a separate iOS workflow (`ios-testflight.yml`) — only
runs once iOS signing material is in place (operator-blocked).

---

## Rollback

If a production APK shows a critical bug:

1. **Immediate mitigation:** force-update via UpdateGate
   - Bump `MIN_REQUIRED_APP_VERSION` env var in Railway to FORCE users
     onto the older (working) version, OR push a hotfix APK with a
     higher version code
2. **Stop the bleeding:** halt the Play Store rollout (Play Console →
   Production track → Halt rollout)
3. **Rebuild + redeploy:** fix the bug in code, bump versionCode AGAIN,
   re-run the workflow with `environment: production`

Quick rollback to staging-pointing APK (for hotfix-test cycle):
```bash
# Trigger build pointing at staging again
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/DH72367259/Canteen_Application/actions/workflows/android-internal.yml/dispatches \
  -d '{"ref":"dev","inputs":{"environment":"staging"}}'
```

Then `adb install -r` the staging APK on the test phone to debug against
staging without disturbing production users.

---

## Post-flip verification checklist

- [ ] Test student install: install production APK, log in, place order
- [ ] Test worker install: install production APK, log in, verify OTP
- [ ] Browser-side smoke: `curl -I https://noqx.co.in/` → 200
- [ ] Razorpay payment test (test card OR real ₹1 if live keys deployed)
- [ ] Order shows up in canteen worker queue
- [ ] OTP collection completes
- [ ] No staging URLs visible in any UI element (search HTML body via DevTools)
- [ ] No "Canteen-Application" placeholder text anywhere

---

## After flip — do these once, never again

- [ ] Tag the production release in git: `git tag -a v1.0.0 -m "First production APK"`
      then `git push origin v1.0.0`
- [ ] Save the APK + AAB files to a permanent backup
      (~/noqx-keystores/ + OneDrive backup folder)
- [ ] Update launch_readiness.md to check off "Capacitor SERVER_URL flip"
- [ ] Take the production APK screenshots for App Store / Play Store
      listings using SCREENSHOT_GUIDE.md

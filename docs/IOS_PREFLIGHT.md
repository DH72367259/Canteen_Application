# iOS Pre-Flight Checklist

State of the iOS build pipeline as of 2026-05-21, and what's left to do
on the day Apple Developer enrolment completes.

> The plan: when Apple Dev access activates, you should be able to drop
> in 3 secrets and click "Run workflow" to ship to TestFlight. This doc
> verifies everything else is already correct.

---

## Current state

| Check | Status |
|---|---|
| `capacitor.config.ts` — `appId` = `com.noqx.student` | ✅ |
| `capacitor.config.ts` — `appName` = `NoQx Student` | ✅ |
| `mobile-worker/capacitor.config.ts` — `appId` = `com.noqx.worker` | ✅ |
| `mobile-worker/capacitor.config.ts` — `appName` = `NoQx Worker` | ✅ |
| iOS deployment target ≥ 15.0 (pinned in workflow via PlistBuddy + sed) | ✅ |
| App Icon assets (13 sizes) in `ios-overrides/AppIcon.appiconset/` | ✅ |
| icon-1024 flattened (no transparency, Apple's hard rule) | ✅ |
| `AppIcon.appiconset/Contents.json` references all 13 sizes correctly | ✅ |
| Workflow .github/workflows/ios-testflight.yml compiles unsigned on push | ✅ (gated by HAS_CERT — falls back to compile-check) |
| Capacitor plugins only require non-sensitive permissions | ✅ (network, status-bar, preferences, app) |

---

## What's NOT in place yet (operator action needed)

1. **Apple Developer Program enrolment** ($99/yr)
   - Sign up at https://developer.apple.com/programs/
   - 24-48 hours review
2. **App ID registered** in Apple Developer portal
   - Identifiers → "+ "  → App IDs → bundle ID `com.noqx.student`
   - (Repeat for `com.noqx.worker` if shipping worker iOS, deferred per scope)
3. **Distribution certificate** (.p12 file)
   - Certificates → "+" → Apple Distribution → follow CSR upload flow
   - Export `.p12` from Keychain Access with a password
   - Base64 encode: `base64 -i dist.p12 -o dist.p12.b64`
   - Paste into GitHub secret `IOS_DIST_CERT_P12_BASE64`
   - Password into `IOS_DIST_CERT_PASSWORD`
4. **Provisioning profile** (.mobileprovision)
   - Profiles → "+" → App Store → pick the App ID + cert
   - Download → base64 encode → `IOS_PROVISIONING_PROFILE_BASE64`
5. **App Store Connect API key** (.p8) for TestFlight upload
   - App Store Connect → Users and Access → Integrations → API Keys
   - "+" → Admin role → Download the .p8
   - Base64 encode → `APP_STORE_CONNECT_API_KEY`
   - Note the Key ID + Issuer ID → secrets:
     `APP_STORE_CONNECT_API_KEY_ID` and `APP_STORE_CONNECT_ISSUER_ID`
6. **Team ID** (10-char string visible at top-right of dev portal)
   - GitHub secret `IOS_TEAM_ID`

When ALL 6 secrets are set, the workflow's signed-build branch
activates automatically — no code changes needed.

---

## Info.plist — current and future

**Current state**: Capacitor auto-generates a minimal Info.plist from
`appId` + `appName` during `npx cap add ios`. The workflow does NOT
inject any privacy usage descriptions.

This is correct as of today because installed plugins don't access:
- Camera (no `@capacitor/camera`)
- Photos (no `@capacitor/photos`)
- Location (no `@capacitor/geolocation`)
- Microphone (none)
- Contacts (none)
- Bluetooth (none)
- Health (none)

So Apple review won't flag missing usage strings.

**If a future plugin (e.g. push notifications, QR scanner) is added**,
add the corresponding usage string to `ios-overrides/` and a workflow
step that PlistBuddy-merges it into the auto-generated Info.plist.
Template:

```bash
# Add this step BEFORE `npx cap sync ios` in ios-testflight.yml:
- name: Inject privacy usage descriptions
  working-directory: ios/App/App
  run: |
    /usr/libexec/PlistBuddy -c "Add :NSCameraUsageDescription string 'NoQx uses the camera to scan QR codes for pickup verification.'" Info.plist
    /usr/libexec/PlistBuddy -c "Add :NSUserTrackingUsageDescription string 'NoQx does not track you.'" Info.plist
```

---

## App Privacy / Data Safety (App Store Connect)

When you create the app listing in App Store Connect, the **App Privacy**
questionnaire asks what data the app collects. The truthful answers
based on the current codebase:

- **Data Linked to You**: Name, Email, Phone, Purchase History, User Content (order notes), User ID
- **Data Not Linked to You**: none
- **Data Used to Track You**: **NONE** — this is the critical one;
  app does not have any third-party trackers (verified via grep —
  no google-analytics, gtag, fbq, hotjar, mixpanel, posthog, segment,
  amplitude, clarity.ms)

Selecting "None" for "Data Used to Track You" exempts you from the ATT
prompt entirely. Don't add any tracking SDK casually after launch —
that decision is binding for the app version.

All the matching detail is already in `store-listing/STORE_LISTING_COPY.md`
under "App Store — App Privacy summary".

---

## First-build sanity check (do this in the FIRST signed build)

1. Workflow run goes green
2. Open the `.ipa` artifact OR check TestFlight build status
3. Install on a physical iPhone via TestFlight beta link
4. Confirm:
   - Splash purple (`#7c3aed`)
   - App icon shows NoQx logo with glittering visible (no white square)
   - Status bar text is dark / readable
   - Login page renders correctly
   - Can sign up + receive OTP via email (tests Resend → APNs not yet
     wired since FCM/APNs are disabled per `docs/FCM_REENABLEMENT.md`)
5. Tap a `https://noqx.co.in/dashboard/order-status` link in Mail or
   Safari → should it open in the app? **iOS Universal Links are
   NOT yet configured** (separate from Android App Links). To enable,
   add an `apple-app-site-association` file to `public/.well-known/`
   with the team ID + bundle ID — defer to a follow-up.

---

## Known limitations on first iOS ship

- **No push notifications** — FCM was removed entirely (see
  `docs/FCM_REENABLEMENT.md`). iOS push needs Apple Dev → APNs key
  → separate Firebase registration → re-enable per that doc.
- **No Universal Links** — Android has them; iOS doesn't yet. Order
  receipt links open in Safari, not the app.
- **No In-App Purchases** — Razorpay handles all payments in a web
  view. Apple may push back ("must use IAP for digital goods") but
  for food orders + physical pickup, the web payment is allowed per
  App Store Review Guideline 3.1.5(a).
- **No StoreKit** — same as above.

These are accepted v1 trade-offs; revisit for v1.1.

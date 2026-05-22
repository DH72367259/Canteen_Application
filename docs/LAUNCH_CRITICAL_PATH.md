# Launch Critical Path — From Code-Ready to In-the-Stores

The minimum sequence of operator actions to get NoQx live on both the
Play Store and the App Store, starting from today's state (code-ready,
no store accounts).

> **Current state (2026-05-22)**: web live at noqx.co.in · APKs build
> and run on device · iOS compile-checks succeed · all legal pages live
> · NO store accounts, NO live payment keys, NO database backups.
>
> **Target state**: both apps live in their respective stores, payments
> working, backups running, real canteen operational.
>
> **Realistic timeline**: ~10-14 days from start. The critical path is
> Apple Dev → 24-48h activation, Razorpay KYC → 3-7 day review.

---

## Cost summary (one-time + recurring at launch)

| Item | Cost | When |
|---|---|---|
| Apple Developer Program | **$99/yr** | Once, renew annually |
| Google Play Console | **$25 one-time** | Once forever |
| Supabase Pro (DB backups) | **$25/mo** | Recurring |
| Resend Pro (50k emails) | **$20/mo** | Recurring |
| Razorpay | Free signup + 2% per transaction | No upfront |
| Railway Pro | $20/mo (already paying) | Recurring |
| **Total upfront**: **$124** | | |
| **Total monthly at launch (~1k DAU)**: **~$65/mo** + Razorpay 2% | | |

---

## Scaling plan — what to upgrade as DAU grows

You don't need to over-provision on day 1. Watch usage dashboards and
upgrade as you cross these thresholds.

### Railway (compute hosting)

| DAU | Plan | Monthly est. | Trigger to upgrade |
|---|---|---|---|
| 0-1k | Pro $20 base | $20-40 | Default |
| 1k-5k | Pro + overage | $40-80 | Railway dashboard shows >$30 usage credit consumed |
| 5k-15k | Pro + overage OR Team | $80-150 | p95 response time degrades OR >$80/mo usage |
| 15k-50k | Team plan + multiple replicas | $150-400 | CPU consistently >70% during peak |

**At 15k DAU**: stay on Pro plan, expect bill ~$80-120/mo. Cloudflare in
front absorbs ~70% of requests at the edge, so Railway sees ~5-7M of
the ~15-20M monthly request total.

### Supabase (database + auth)

| DAU | Plan | Monthly est. | Trigger to upgrade |
|---|---|---|---|
| 0-1k | Pro $25 base | $25 | Default — Pro = backups + 8GB DB included |
| 1k-5k | Pro + Small Compute | $35 ($25 + $10) | Connection pool exhaustion warnings |
| 5k-15k | Pro + Medium Compute | $85 ($25 + $60) | p95 query time >100ms during peak |
| 15k-50k | Pro + Large Compute | $135 ($25 + $110) | OR migrate to dedicated instance |

**At 15k DAU**: expect $35-85/mo. The 8GB DB included in Pro covers
roughly 1-2 years of order data at this scale. After year 1 watch DB
size in Settings → Usage; budget $0.125 per GB over 8.

### Resend (transactional email)

Current send volume drivers (excluding push notifications which are disabled):
- Password reset OTPs (low — only on forgot password)
- Welcome email on signup (one-time per student)
- Order confirmation (per order)
- Refund notification (per cancellation, low %)

Estimate: ~2 emails per active student per day average.

| DAU | Plan | Monthly emails | Cost |
|---|---|---|---|
| 0-500 | Free | <3k | $0 |
| 500-2.5k | Pro $20 | <50k | $20 |
| 2.5k-10k | Business $99 | <200k | $99 |
| 10k-50k | Scale $399 | <1M | $399 |

**At 15k DAU**: ~900k emails/mo → **Scale plan $399/mo** OR aggressively
re-enable FCM push (see `docs/FCM_REENABLEMENT.md`) to cut email
volume by ~70% (push the order-ready notifications, keep email for
receipts + password reset only). Push-first strategy keeps you on
Business plan ($99/mo).

### Cloudflare (DNS + CDN proxy)

Free plan is sufficient up to ~50k DAU. Cloudflare has no bandwidth
billing on Free tier. Only upgrade if you need:
- WAF custom rules ($20/mo Pro)
- Advanced bot protection ($200/mo Business)
- Image optimization (separate billing)

**Not needed at 15k DAU.**

### Twilio SMS (OTP delivery)

For India: ~$0.05-0.10 per SMS through Twilio. Alternative: Fast2SMS
(Indian provider) at ~₹0.20/SMS (~$0.003).

At 15k DAU: ~500 new signups/mo + ~200 password resets = ~700 SMS/mo.
- Twilio: ~$50/mo
- Fast2SMS: ~$2/mo (already integrated in `lib/fast2sms.ts`)

**Recommendation**: use Fast2SMS for OTPs, Twilio only for WhatsApp.

### Total monthly burn at common DAU tiers

| DAU | Railway | Supabase | Resend | Cloudflare | SMS | **Total** |
|---|---|---|---|---|---|---|
| 1k | $20 | $25 | $20 | $0 | $5 | **~$70/mo** |
| 5k | $50 | $35 | $99 | $0 | $20 | **~$200/mo** |
| 15k | $100 | $85 | $399 (or $99 with FCM) | $0 | $50 | **~$630/mo (or $330 with FCM)** |
| 50k | $300 | $135 | enterprise | $20 | $150 | **~$1000+/mo** |

**Plus Razorpay 2% transaction fee** on every order — not in the above.
At 15k DAU × ₹80 avg order = ₹1.2L/day = ₹36L/month gross revenue.
Razorpay 2% = ₹72k/month payment processing.

---

## Dependency graph (what unblocks what)

```
START (today)
  │
  ├─→ Apple Developer enrolment ($99) ──[24-48h wait]──┐
  ├─→ Razorpay KYC submission       ──[3-7 day wait]──┤
  ├─→ Play Console signup ($25)     ──[same day]──────┤
  ├─→ Supabase Pro upgrade ($25/mo) ──[immediate]─────┤
  │                                                    │
  └─→ Create real canteen + seed (you can do anytime) ─┤
                                                       │
                                                       ▼
                                       [All accounts active + KYC done]
                                                       │
                                       ┌───────────────┴───────────────┐
                                       ▼                               ▼
                              [Build production APKs +              [Build signed iOS IPA +
                               upload to Play Console               upload to App Store
                               Internal track]                       Connect TestFlight]
                                       │                               │
                                       ▼                               ▼
                              [Capture screenshots, paste copy, submit for review]
                                       │                               │
                                       ▼                               ▼
                                  [Play Production            [App Store Production
                                   approval: 1-3 days]         approval: 24-48h typical]
                                       │                               │
                                       └────────────┬──────────────────┘
                                                    ▼
                                              🟢 LIVE 🟢
```

---

## TODAY — Start all 4 parallel clocks (90 min total)

These four sign-ups have nothing dependent on each other. Do all four
the same morning so the activation clocks run in parallel.

### 1. Apple Developer Program ($99/yr) — 24-48h activation

- [ ] Go to https://developer.apple.com/programs/enroll
- [ ] Sign in with your Apple ID (or create one)
- [ ] Choose **Individual** (sole proprietor) OR **Organization** (DUNS required)
  - For NoQx Technologies launching: pick whichever matches your legal entity
- [ ] Pay $99 (credit card or net banking)
- [ ] You'll get a "verification in progress" email — Apple manually reviews,
      typically 24-48 hours
- [ ] **Once activated**: you'll get a "Welcome to the Developer Program" email
      with login URL

### 2. Razorpay KYC submission — 3-7 day review

If your Razorpay account exists but is in test mode:
- [ ] Log in to https://dashboard.razorpay.com
- [ ] Settings → KYC → Submit
- [ ] Upload: PAN, GSTIN (if registered) OR PAN-only declaration, bank
      proof, address proof, business registration certificate, director
      KYC (if applicable)
- [ ] Razorpay manually reviews — typically 3-7 business days

If you don't yet have a Razorpay account:
- [ ] Sign up at https://dashboard.razorpay.com/signup
- [ ] Complete KYC as above

### 3. Google Play Console ($25 one-time) — same-day activation

- [ ] Go to https://play.google.com/console/signup
- [ ] Sign in with Google account (use the operator's primary Google
      account — this becomes the publisher account)
- [ ] Choose **Personal** or **Organization** (org needs DUNS for verified
      identity)
- [ ] Pay $25 via card
- [ ] Activated within minutes — you can immediately start setting up the
      app listings

### 4. Supabase Pro upgrade ($25/mo) — immediate

- [ ] Log in to https://supabase.com/dashboard
- [ ] Select project `dpycfyeiyhzvwbythcrp`
- [ ] Settings → Billing → Upgrade to Pro
- [ ] Pay with card → effective immediately
- [ ] Verify: Database → Backups tab should appear within 24h with first
      backup scheduled

⚠️ **This is a hard launch-blocker.** Per launch_readiness.md, you should
NOT take real customer money without DB backups.

---

## Day 2-3 — Apple Dev activates, set up iOS signing

(Skip this section until you get the Apple Developer welcome email.)

### Generate the iOS signing material

Follow `docs/IOS_PREFLIGHT.md` section "What's NOT in place yet" — it has
the click-by-click steps. Summary:

- [ ] Apple Developer portal → Identifiers → "+" → App IDs → register
      `com.noqx.student` (capabilities: Push Notifications optional)
- [ ] Certificates → "+" → Apple Distribution → upload CSR (instructions
      in IOS_PREFLIGHT.md) → download `.cer` → install in Keychain →
      export as `.p12` with a password
- [ ] Profiles → "+" → App Store → select the App ID + the new cert →
      download the `.mobileprovision`
- [ ] App Store Connect → Users and Access → Integrations → API Keys →
      "+" → Admin role → download the `.p8`
- [ ] Note: Key ID, Issuer ID, Team ID (top-right of developer portal)

### Paste 6 secrets into GitHub

- [ ] Repo settings → Secrets and variables → Actions → New repository secret
- [ ] `IOS_DIST_CERT_P12_BASE64` = `base64 -i dist.p12 -o - | pbcopy`
- [ ] `IOS_DIST_CERT_PASSWORD` = the .p12 password
- [ ] `IOS_PROVISIONING_PROFILE_BASE64` = `base64 -i noqx_student.mobileprovision -o - | pbcopy`
- [ ] `APP_STORE_CONNECT_API_KEY_ID` = the Key ID string
- [ ] `APP_STORE_CONNECT_ISSUER_ID` = the Issuer ID string
- [ ] `APP_STORE_CONNECT_API_KEY` = `base64 -i AuthKey_XXXX.p8 -o - | pbcopy`
- [ ] `IOS_TEAM_ID` = the 10-char team ID

### First signed iOS build

- [ ] GitHub → Actions → "ios-testflight" → Run workflow → branch `main`
- [ ] Wait ~30 min (macOS runners are slow)
- [ ] Build artifact uploads to TestFlight automatically
- [ ] App Store Connect → TestFlight → wait ~15 min for "Processing" to finish
- [ ] Install on YOUR iPhone via TestFlight beta link (no review needed
      for internal testers)
- [ ] Confirm: app launches, login works, can place order with Razorpay test card

---

## Day 3-5 — Razorpay activates, deploy live keys

(Skip until you get the Razorpay "KYC approved" email.)

### Deploy live keys to Railway

- [ ] Razorpay dashboard → Settings → API Keys → switch to LIVE mode
- [ ] Generate live key ID + secret (copy both, you won't see the secret
      again)
- [ ] Razorpay → Webhooks → Add webhook:
      - URL: `https://noqx.co.in/api/payments/razorpay-webhook`
      - Generate a webhook secret (any random 32-char hex)
      - Subscribe to: `payment.captured`, `payment.failed`, `refund.processed`
- [ ] Railway dashboard → project → production → Variables:
      - `RAZORPAY_KEY_ID` → `rzp_live_XXXX`
      - `RAZORPAY_KEY_SECRET` → live secret
      - `RAZORPAY_WEBHOOK_SECRET` → the webhook secret you generated
      - `PAYMENT_TEST_MODE` → `false`
- [ ] Click "Deploy" — wait 90 sec
- [ ] Verify: `node scripts/verify-razorpay-flow.mjs` should report
      "razorpay LIVE keys deployed" with keyId starting `rzp_live_`

### ₹1 end-to-end live test

- [ ] On a real phone, log in as a real student account
- [ ] Place a ₹1 test order (real UPI / card payment)
- [ ] Confirm in Razorpay dashboard: payment captured
- [ ] Cancel the order from vendor dashboard
- [ ] Confirm refund hits Razorpay dashboard within 60 sec

### Set GST flag

- [ ] Read `docs/GST_FLAG_AUDIT.md` decision matrix
- [ ] If NOT yet GST-registered: Railway Variables → set
      `DISABLE_GST=true` AND `NEXT_PUBLIC_DISABLE_GST=true`
- [ ] If GST-registered: leave both unset (defaults to GST applied)
- [ ] Update legal pages with GSTIN if charging GST

---

## Day 5-7 — Store listings + screenshots + final assets

### Capture screenshots (after Razorpay live so payment shot is real)

Follow `store-listing/SCREENSHOT_GUIDE.md` for exact paths. Quick list:

**Student app (6 shots minimum):**
- [ ] Canteen list / home (`/dashboard`)
- [ ] Menu with live availability (`/dashboard/menu/[canteenId]`)
- [ ] Cart + slot picker (after adding an item)
- [ ] Razorpay payment screen (use real card)
- [ ] Order status — Preparing
- [ ] Bin OTP / pickup screen

**Worker app (4 shots minimum):**
- [ ] Live queue (worker login → Orders tab)
- [ ] Prep summary
- [ ] OTP verify screen
- [ ] Bin assignment view

Aspect: 1080×1920 for Play Store, 1290×2796 for App Store (iPhone 16 Pro Max).

### Create app listings

**Play Console** (Android — both student + worker):
- [ ] Play Console → Create app → fill in: name, default language English,
      app/game = App, free/paid = Free
- [ ] App content → fill out: privacy policy URL
      (https://noqx.co.in/privacy), ads = No, content rating
      (questionnaire), target audience, data safety (paste answers from
      `store-listing/STORE_LISTING_COPY.md`)
- [ ] Main store listing → paste copy from STORE_LISTING_COPY.md:
      - App name, short description, full description
      - Upload feature graphic 1024×500 (`store-listing/feature-graphic/`)
      - Upload icon 512×512 (`store-listing/android/`)
      - Upload screenshots (4-8)
- [ ] Repeat for `com.noqx.worker` (separate Play Console app)

**App Store Connect** (iOS — student only for v1):
- [ ] App Store Connect → My Apps → "+" → New app
- [ ] Bundle ID = com.noqx.student, name "NoQx — Canteen Pickup"
- [ ] App Information: paste subtitle, keywords, privacy URL, support URL
- [ ] App Privacy: paste answers from STORE_LISTING_COPY.md
- [ ] Prepare for Submission: paste description + promotional text,
      upload screenshots

### Replace placeholder canteen

- [ ] Super-admin → Canteens → set "NoQx Demo Canteen" `is_hidden = true`
      (don't delete — orders reference it)
- [ ] Add the real first partner canteen with real menu items
- [ ] Set `is_open = false` until launch moment
- [ ] Add canteen managers + workers per `docs/OPERATOR_CHEAT_SHEET.md`

### Flip Capacitor to production

Follow `docs/CAPACITOR_PRODUCTION_FLIP.md`. Summary:

- [ ] Bump `versionCode` to 2 in both:
      - `android/app/build.gradle`
      - `mobile-worker/android/app/build.gradle`
- [ ] (Defensive) Add `noqx.co.in` to `allowNavigation` in both Capacitor
      configs
- [ ] Commit + push
- [ ] Trigger Android workflows with `environment: production` (or push
      to `main` directly which auto-builds production)

---

## Day 7-10 — Upload to internal/TestFlight tracks, verify, submit

### Internal testing first (NOT public yet)

**Play Internal track:**
- [ ] Play Console → app → Testing → Internal testing → Create new release
- [ ] Upload the production AAB from GitHub Actions artifacts
- [ ] Add operator + the test client as internal testers (email list)
- [ ] Send the opt-in link → install via Play Store
- [ ] Verify on real device: app icon, login, order flow end-to-end

**TestFlight:**
- [ ] Should already be there from Day 2-3 step (auto-uploaded on signed build)
- [ ] App Store Connect → TestFlight → add internal testers (operator's
      Apple ID)
- [ ] Same verification on iOS

### Submit for production review

Only after internal testing passes:

**Play Store:**
- [ ] Production → Create new release → promote from Internal track
- [ ] Add release notes ("Initial launch")
- [ ] Roll out — Play review takes 1-3 days

**App Store:**
- [ ] App Store Connect → Prepare for Submission → Submit for Review
- [ ] Answer the metadata questions (export compliance — usually "No"
      for standard HTTPS, IDFA — "No" since no tracking)
- [ ] Review takes 24-48h typically

---

## Day 10-14 — Approved, public launch

When reviews approve:

- [ ] **Play**: set rollout to 100% (or staged: 10% → 50% → 100% over 2-3
      days if cautious)
- [ ] **App Store**: app goes live within 1h of approval
- [ ] **Verify**: install from public store, full smoke test on a fresh
      phone (no test data, no cached install)
- [ ] **Flip the canteen `is_open = true`**
- [ ] Run through `docs/LAUNCH_DAY_RUNBOOK.md` T-0 → T+1h sequence

---

## What can go wrong + how to handle

### Apple rejects the first submission

Most common reasons:
- "Privacy policy URL not accessible" → verify https://noqx.co.in/privacy
  returns 200 (it does as of today)
- "App uses In-App Purchase but isn't approved" → respond explaining
  you sell physical goods (food), point to Guideline 3.1.5(a)
- "Sign-in required but no demo account provided" → create a demo
  student account and put credentials in the Review Notes field
- "Bug in payment flow" → reviewer hit a test/live keys mismatch.
  Confirm live keys deployed.

Resubmit takes 24-48h again — plan for one round-trip.

### Play rejects the first submission

Most common reasons:
- "Data safety form doesn't match what app does" → audit each declaration
- "Privacy policy missing" → verify URL and content
- "Permissions you don't justify" → we don't request sensitive permissions,
  this shouldn't trigger
- "Designed for Children policy mismatch" → ensure target audience is
  13+ (which the privacy policy already states)

### Razorpay won't approve

- Bank account mismatch with PAN → ensure matching names
- Address proof not clear → re-upload high-res scan
- Missing director DIN (if you're an LLP or company) → add

### Apple Dev "in review" stuck

Sometimes Apple's manual verification takes >48h. Contact via developer
portal support — usually resolves within 24h after a follow-up.

---

## Verification scripts (run after each milestone)

```bash
# Should pass 19/19 throughout launch
node scripts/smoke-test-prod.mjs

# After Razorpay live keys deployed
node scripts/verify-razorpay-flow.mjs

# Daily metrics post-launch
SERVICE_ROLE=$(grep '^SUPABASE_SERVICE_ROLE_KEY=' .env.local | cut -d= -f2-) \
  node scripts/launch-day-stats.mjs
```

---

## Day 14+ — Post-launch

- [ ] Monitor UptimeRobot for 7 days
- [ ] Daily check of Razorpay dashboard for failed payments
- [ ] Watch Resend dashboard for email bounce rate
- [ ] Re-enable push notifications (`docs/FCM_REENABLEMENT.md`)
- [ ] First-week retro: what surprised you, what to fix in v1.1

---

## TL;DR cheat sheet

| Day | Action | Cost | Wait |
|---|---|---|---|
| 0 | Apple Dev + Razorpay KYC + Play Console + Supabase Pro | $149 + $25/mo | 24-48h (Apple), 3-7d (Razorpay) |
| 2-3 | iOS signing material → 6 GitHub secrets → first TestFlight build | $0 | 30 min build |
| 3-5 | Razorpay live keys → Railway → ₹1 live test | $0 (₹1 in fees) | <1 hour |
| 5-7 | Screenshots + store listings + real canteen seed + Capacitor flip | $0 | 4-6 hours of clicking |
| 7-10 | Upload to Internal/TestFlight, verify, submit for prod review | $0 | 1-3 days (Play), 24-48h (Apple) |
| 10-14 | Approved → roll out → 🟢 LIVE | $0 | — |

**Total operator time investment**: ~8-10 hours of focused work over 2 weeks.
**Total wait time**: ~10-14 days (mostly waiting on external reviews).

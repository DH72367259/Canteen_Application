# NoQx Operator Cheat Sheet

The 1-page everything-you-need-to-remember reference. Bookmark this.

> Last updated: 2026-05-21. Production live at https://noqx.co.in

---

## Logging in as super admin

URL: **https://noqx.co.in/login** → "Canteen Login" tab
- Email: `admin@noqx.co.in`
- Password: (stored in your password manager / OneDrive)

After login you land at `/admin/dashboard`. From there you can:
- Create canteens
- Invite canteen managers
- Edit platform commission (`platform_charges` table — see §6 of admin dashboard)
- View settlement reports
- Approve refunds

If you forget the password: there is no in-app reset for super admin
(by design). Reset via Supabase Auth dashboard → Users → find
admin@noqx.co.in → "Send password reset email" — it'll route through
Cloudflare Email Routing to joshuajoejj11@gmail.com.

---

## Every URL you'll need

### Production
| Surface | URL |
|---|---|
| Student app | https://noqx.co.in |
| Login | https://noqx.co.in/login |
| Admin dashboard | https://noqx.co.in/admin/dashboard |
| Vendor (canteen) dashboard | https://noqx.co.in/vendor/dashboard |
| Worker portal | https://noqx.co.in/worker/login |
| Legal pages | /privacy /terms /refund /shipping /contact |

### Infrastructure consoles (bookmark these)
| Service | URL | What for |
|---|---|---|
| Railway | https://railway.com/dashboard | App deploys, env vars, logs |
| Supabase | https://supabase.com/dashboard/project/dpycfyeiyhzvwbythcrp | DB + Auth |
| Cloudflare | https://dash.cloudflare.com/.../noqx.co.in | DNS + Email Routing + SSL |
| Razorpay | https://dashboard.razorpay.com | Payments + refunds |
| Resend | https://resend.com/emails | Transactional email logs |
| UptimeRobot | https://uptimerobot.com/dashboard | Uptime + alerts |
| GitHub Actions | https://github.com/DH72367259/Canteen_Application/actions | CI builds |

### Staging
Web: https://canteenapplication-staging.up.railway.app
Used for: client preview before pushing to prod. Same Supabase project
under a different schema — DO NOT confuse the two.

---

## Common operator tasks

### Seed a new canteen
1. Log in as super admin
2. Admin dashboard → "Canteens" tab → "Add canteen"
3. Fill: name, college, address, contact phone, image URL
4. After save, click "Configure" → set slot duration, max_bins, open hours
5. Click "Generate slots" — creates time_slots rows automatically
6. Add menu items: Canteens → click row → "Menu" tab → "Add item"
7. Toggle the canteen `is_open = true` to make visible to students

### Invite a canteen manager (vendor)
Admin dashboard → "Users" tab → "Invite" → role: vendor, canteen: pick.
They get an email; click → set password → land on /vendor/dashboard.

### Invite a worker
Vendor dashboard (logged in as the canteen's vendor) → "Staff" tab →
"Add worker" → enter their email + username. They get the credentials
via screen.

### Refund an order
Admin dashboard → "Orders" tab → filter by order ID → "Refund" button.
Calls Razorpay API. Confirmation lands in Razorpay dashboard within
60 sec.

### Stop accepting orders (emergency)
Two options:
1. Admin dashboard → Canteens → toggle `is_open` to false for each
2. Faster: Supabase SQL Editor → `UPDATE canteens SET is_open = false;`

### Roll back a bad deploy
See `docs/ROLLBACK_RUNBOOK.md`. TL;DR: Railway → Deployments → previous
green → Redeploy. 45 seconds.

---

## Every env var (Railway production)

### Required for app to boot
| Var | Where to get it | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase dashboard → Settings → API | https://dpycfyeiyhzvwbythcrp.supabase.co |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Same as above | Public — safe to expose |
| `SUPABASE_SERVICE_ROLE_KEY` | Same as above | **SECRET — never expose** |
| `NEXT_PUBLIC_APP_URL` | Your call | Currently https://noqx.co.in |

### Required for payments
| Var | Where | Status |
|---|---|---|
| `RAZORPAY_KEY_ID` | Razorpay dashboard → API Keys | Currently test keys (`rzp_test_*`) |
| `RAZORPAY_KEY_SECRET` | Same | Same |
| `RAZORPAY_WEBHOOK_SECRET` | Razorpay → Webhooks → details | Currently test |

### Required for email (already set)
| Var | Where | Status |
|---|---|---|
| `RESEND_API_KEY` | resend.com → API Keys | ✅ Live |
| `OTP_FROM_EMAIL` | Your decision | `noreply@noqx.co.in` |

### Required for SMS/WhatsApp OTP
| Var | Where | Status |
|---|---|---|
| `TWILIO_ACCOUNT_SID` | console.twilio.com → main page | Set per operator's account |
| `TWILIO_AUTH_TOKEN` | Same | **SECRET** |
| `TWILIO_VERIFY_SID` | Twilio Verify service ID | |
| `TWILIO_WHATSAPP_ENABLED` | `true` / `false` | Toggle for prod |

### Optional / launch decisions
| Var | What | Recommendation |
|---|---|---|
| `DISABLE_GST` | Skip 5% food GST | `true` until you have GSTIN; see [GST_FLAG_AUDIT](GST_FLAG_AUDIT.md) |
| `NEXT_PUBLIC_DISABLE_GST` | Same on client receipts | **Must match** `DISABLE_GST` |
| `CRON_SECRET` | Protects cron endpoints | Set to a random 32-char hex |
| `QR_HMAC_SECRET` | Signs QR pickup codes | Set to a random 32-char hex |
| `MIN_REQUIRED_APP_VERSION` | UpdateGate force-update | Leave unset until you ship v1.0.0 |

---

## Day-of launch sequence

Detailed timeline in `docs/LAUNCH_DAY_RUNBOOK.md`. Highlights:

| Time | Do |
|---|---|
| T-24h | Run `node scripts/smoke-test-prod.mjs` → must be 19/19 |
| T-2h | Confirm Razorpay live keys deployed; run a ₹1 test order |
| T-1h | Verify all dashboards bookmarked; UptimeRobot armed |
| T-0 | Toggle first real canteen `is_open = true` |
| T+1h | Check Resend dashboard for any delivery failures |
| T+1d | Run `node scripts/launch-day-stats.mjs` for the daily metrics |

---

## When something breaks

| Symptom | First step |
|---|---|
| Site is 5xx / down | `docs/ON_CALL_RUNBOOK.md` |
| Bad deploy needs reverting | `docs/ROLLBACK_RUNBOOK.md` |
| DB schema looks wrong | `docs/SCHEMA_DRIFT_2026-05-20.md` |
| Payments failing | Check Razorpay dashboard + Railway logs for /api/payments |
| Emails not arriving | resend.com/emails → check delivery + bounces |

---

## Compliance / legal touchpoints

- Privacy policy lists you (NoQx Technologies, Bengaluru) as data controller
- DPDPA grievance email: `grievance@noqx.co.in` → forwards to joshuajoejj11@gmail.com
- Privacy email: `privacy@noqx.co.in` → same
- Support: `support@noqx.co.in` + `+91 70199 86046`
- Address shown on contact page: "NoQx Technologies, Bengaluru, Karnataka, India" — update if your registered address changes
- FSSAI license: **NOT yet displayed** on canteen pages — required by law for food. Add when you have it.

---

## Backups + disaster recovery

⚠️ **You are currently on Supabase Free tier — no automatic backups.**
This is a known launch-blocker. Upgrade to Pro ($25/mo) before any real
customer takes any real action.

Until upgraded: every ₹ that comes in is recoverable from Razorpay
ledger alone. Lost data = lost orders. Customer phone numbers + names
are lost too.

Mobile keystores backed up to: `~/noqx-keystores/` (local) + OneDrive
zip (2FA-protected). Without these, you cannot ship app updates.

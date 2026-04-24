# NoQx — Smart Institutional Dining

> **Live URL** → https://canteenapplication-production.up.railway.app

Cashless, queue-free canteen ordering for universities and colleges.
Students order on their phone, pay via Razorpay (UPI / Card / Wallet), and pick up at an
assigned **bin** using a 4-digit OTP displayed in-app. No cash, no queue, no wasted food.

A **NoQx Pro** monthly subscription (₹49/month) lets students skip the ₹4 per-order
convenience fee and get priority pickup — every order, every day.

---

## Table of Contents

1. [Live URLs](#live-urls)
2. [Login Credentials](#login-credentials)
3. [Architecture](#architecture)
4. [Security](#security)
5. [NoQx Pro Subscription](#noqx-pro-subscription)
6. [Order Tracking Flow](#order-tracking-flow)
7. [Wallet (NoQx Cash)](#wallet-noqx-cash)
8. [Settlement & Finance](#settlement--finance)
9. [Supabase Setup](#supabase-setup)
10. [Razorpay Setup](#razorpay-setup)
11. [Twilio Setup (SMS & WhatsApp OTP)](#twilio-setup-sms--whatsapp-otp)
12. [Environment Variables](#environment-variables)
13. [Deploy to Railway (Cloud)](#deploy-to-railway-cloud)
14. [iOS and Android Deployment](#ios-and-android-deployment)
15. [Location-Based Canteen Discovery](#location-based-canteen-discovery)
16. [Canteen Toggle](#canteen-toggle)
17. [Full Workflow](#full-workflow)
18. [API Reference](#api-reference)
19. [Database Schema](#database-schema)
20. [Troubleshooting](#troubleshooting)
21. [Recent Changelog](#recent-changelog)

---

## Live URLs

| Surface | URL |
|---------|-----|
| Web App (Production) | https://canteenapplication-production.up.railway.app |
| GitHub Repository | https://github.com/DH72367259/Canteen_Application |
| Railway Dashboard | https://railway.com/project/9ecacfbc-a63e-4962-b2e7-69565b15b131 |

Every `git push origin main` triggers a new production build on Railway within ~2 minutes.

---

## Login Credentials

| Role | Method | Access |
|------|--------|--------|
| Student | Phone OTP via SMS / WhatsApp | Browse, order, pay, track, NoQx Pro |
| Student (email) | Email OTP (passwordless) | Same as above |
| Canteen / Vendor | Email + password at **Canteen Login** tab | Live orders, menu, slots, toggle |
| Super Admin | Email + password at **Canteen Login** tab | Full system — canteens, users, analytics, settlements |

All users are created via the Supabase Auth dashboard.
No default credentials are pre-filled in the login form.

---

## Architecture

```
Student / Vendor / Admin browsers
          |
          v
   Next.js 14 (Railway)          ← single deployable monorepo
     App Router + API Routes
          |                |
          v                v
  Supabase PostgreSQL    Razorpay API
  (database + auth)      (payments + refunds + webhooks)
  Row Level Security     HMAC-SHA256 signature verification
          |
          v
      Twilio Verify
      (SMS + WhatsApp OTP)
```

**Stack:**

- Frontend/Backend: Next.js 14 App Router, React 18, TypeScript
- Styling: Custom CSS design tokens
- Database: Supabase (PostgreSQL 15) with Row Level Security
- Auth: Supabase Auth — phone OTP via Twilio Verify (SMS + WhatsApp), email OTP, email+password for staff
- Payments: Razorpay (UPI, GPay, PhonePe, Cards, Net Banking, Wallets)
- Subscriptions: Razorpay — ₹49/month NoQx Pro
- SMS/WhatsApp: Twilio Verify (OTP delivery, multi-channel)
- Hosting: Railway (auto-deploy from GitHub, standalone Docker build)
- PWA: Web App Manifest (installable on iOS and Android home screen)

---

## Security

Every layer of the stack has security controls already in place:

| Layer | Control |
|-------|---------|
| HTTPS | Railway enforces TLS. HSTS header: max-age=63072000 (2 years) |
| Content-Security-Policy | Strict CSP in next.config.ts - only Razorpay + Supabase domains allowed |
| Rate Limiting | middleware.ts: payments 10/min, admin 30/min, general 120/min per IP |
| Payment Verification | HMAC-SHA256 on every Razorpay callback - mismatch triggers auto-refund |
| Webhook Security | X-Razorpay-Signature verified before processing any webhook event |
| Auto-Refund | Signature verification failure -> refund triggered automatically |
| JWT Auth | Canteen toggle API and admin APIs validate Supabase JWT server-side |
| RBAC | `super_admin`, `canteen_admin`, `vendor`, `worker`, `student` — enforced in every route |
| Secrets never in browser | `RAZORPAY_KEY_SECRET` and `SUPABASE_SERVICE_ROLE_KEY` are server-only |
| Input Validation | All API bodies validated with strict type checks, `400` on invalid input |
| XSS Prevention | No `dangerouslySetInnerHTML`. React escapes all output |
| SQL Injection | Supabase parameterised queries only — no raw string concatenation |
| Session Enforcement | Concurrent sessions detected; duplicate login logs out older device |
| X-Frame-Options | `SAMEORIGIN` — prevents clickjacking |
| X-Content-Type-Options | `nosniff` — prevents MIME sniffing |

---

## NoQx Pro Subscription

NoQx Pro is a **₹49/month** subscription that removes the ₹4 per-order convenience fee.
Students who order 13+ times per month break even; heavy users save ₹200+/month.

### Home screen awareness (soft, non-aggressive)

A small banner below the canteen grid:
```
⚡ Skip queues every day
With 0/- convenience fee
Try Priority Pickup, Every Time →          ₹49/mo →
```

### Checkout page — main conversion point

- Non-Pro users see:
  ```
  ⚡ Convenience fee   ₹4
     Pro users pay ₹0
  ```
- A highlighted **Pro card** appears below the bill summary:
  ```
  💎 NoQx Pro
  Skip queues all month · Pay ₹0 per order · Just ₹49/month
  💡 You'll save ₹40+ this month
  [ Get Pro & Save → ]   [ Continue without · ₹4 convenience fee ]
  ```
- Pro users see `₹0 (Pro — free)` and no Pro card

### Pro page (`/dashboard/pro`)

- Hero card: 💎 NoQx Pro, ₹49/month
- 4 features: Priority Pickup, Zero Convenience Fee, Instant Notifications, Pro Badge
- Savings calculator: "Break-even in 13 orders"
- Subscribe button → Razorpay ₹49 → `/api/subscriptions` POST → status saved
- Active badge shows if already subscribed

### Technical

- `noqx_pro_subscriptions` table — `user_id`, `payment_id`, `active_until`, `status`
- `GET /api/subscriptions` — check current user's Pro status
- `POST /api/subscriptions` — upsert active subscription with 30-day expiry
- Pro status cached in `localStorage("noqx_pro_active")` for instant UI
- Bottom nav: NoQx Cash tab replaced with **Pro ⭐**
- `/dashboard/rewards` redirects to `/dashboard/pro`

---

## Order Tracking Flow

After payment, students land on `/dashboard/order-status` — a 3-phase tracking page.

### Phase 1 — Preparing (navigable)

- Order placed ✓ → **Preparing your order… (active)** → Ready for pickup
- Shows estimated ready time and "Bin will appear when ready"
- Full bottom nav accessible — student can browse freely
- A **floating green button** appears on the home screen:
  ```
  🍽️ Order in progress
     12:30 PM · Bin 2          Track →
  ```
  Tapping returns to order-status. Also reachable from **My Orders**.

### Phase 2 — Ready for Pickup (navigation locked)

No back button, no bottom nav. Shows:
- **"Your order is ready 🎉"** heading
- **"Collect Your Order and tell OTP if asked"**
- Large **coloured bin square** (RED / BLU / GRN / YEL)
  - Colour derived from bin code prefix: `#RED002` → red, `#BLU001` → blue, etc.
- **4 OTP digit boxes** showing the code
- Items list
- **"✅ Mark as Collected"** button

> If a canteen has multiple bins the OTP is the same for all orders from that student.
> Staff verify by checking the app screen or asking OTP verbally.

### Phase 3 — Collected (3-second splash)

```
✅
Order collected
Hope you enjoyed your meal.

Returning home in 3s…
```
Auto-redirects to `/dashboard` and clears the active order from storage.

---

## Wallet (NoQx Cash)

> The "NoQx Cash" bottom-nav tab has been removed per the pricing plan.
> The wallet feature still works; `/dashboard/rewards` redirects to `/dashboard/pro`.

### Top-up

- Minimum: ₹100
- Via Razorpay (UPI / Card / Net Banking / Wallet)
- Balance credited to `wallet_transactions` on success

### Withdrawal

- Minimum: ₹100, only to the same payment method used for the last top-up
- Processed via Razorpay refund API

### Concurrent Session Enforcement

Only one active session per student is permitted. A second login from a new device
triggers `/api/auth/session` which invalidates the older session — the first device
sees "You have been signed in from another device."

---

## Settlement & Finance

Super Admin settlement dashboard: `/system/settlements`

### Per-canteen breakdown

| Column | Description |
|--------|-------------|
| Canteen | Name + order count |
| Gross Revenue | Sum of all order totals |
| Platform Fee | `charge_pct` × revenue + 18% GST |
| Net Payable | Gross minus platform fee |
| Status | Pending / Paid |

### Recording a payment

1. Click **Pay** on a canteen row
2. Enter transaction ref, amount, date, mode (NEFT / RTGS / UPI / Cheque)
3. Saved to `settlement_payments` — history visible in a collapsible modal

### Platform charges

`GET/PATCH /api/admin/platform-charges` — adjust `charge_pct`, `flat_charge`, `gst_pct` live.
Default seed: 2% + ₹0 flat + 18% GST = 2.36% effective.

### Canteen bank details

`GET/POST /api/admin/canteen-bank` — store account number, IFSC, UPI ID per canteen.
Visible in the **Bank Details** modal on the settlements page.

### GST Invoices

Students download a GST invoice from My Orders:
- CGST (9%) + SGST (9%) breakdown
- `GET /api/orders/[id]/invoice`

**PCI DSS note**: Card data is never stored or processed by our servers.
Razorpay (PCI DSS Level 1 certified) handles all card data in their secure iframe.

---

## Supabase Setup

### Step 1 - Create a Supabase project

1. Go to https://supabase.com -> click "Start your project" (free tier available)
2. Choose region: **ap-south-1 (Mumbai)** for lowest latency in India
3. Set a strong database password - save it somewhere secure
4. Wait ~2 minutes for the project to be provisioned

### Step 2 - Copy API keys

1. In your Supabase project: go to **Settings -> API**
2. Copy three values:

```
Project URL            ->  NEXT_PUBLIC_SUPABASE_URL
anon public key        ->  NEXT_PUBLIC_SUPABASE_ANON_KEY
service_role key       ->  SUPABASE_SERVICE_ROLE_KEY  (keep this SECRET - never expose to browser)
```

### Step 3 — Run the database schema

Open **SQL Editor** and run `supabase-setup.sql` from the root of this repository.
It creates all tables, RLS policies, and triggers in one shot.

Key tables created:
```
profiles               -- user roles + canteen assignment
canteens               -- canteen list, lat/lng, address, is_active
menu_items             -- items per canteen, price, enabled flag
orders                 -- order records with OTP, bin, payment, status
wallet_transactions    -- top-up / withdrawal / earned / redeemed
canteen_bank_details   -- bank account per canteen for settlements
platform_charges       -- commission %, flat charge, GST % (single row)
settlement_payments    -- history of payments to canteens
noqx_pro_subscriptions -- Pro subscribers with start/expiry dates
```

To bootstrap from scratch, you can also run this core SQL manually:

```sql
-- User profiles (extends Supabase auth.users)
create table if not exists profiles (
  id            uuid primary key references auth.users on delete cascade,
  role          text not null check (role in ('super_admin','canteen_admin','vendor','worker','student')),
  name          text,
  phone         text,
  canteen_id    uuid,
  created_at    timestamptz default now()
);

-- Canteens
create table if not exists canteens (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  college       text,
  city          text,
  is_active     boolean default true,
  status        text default 'open' check (status in ('open','busy','closed')),
  updated_at    timestamptz default now(),
  updated_by    uuid references auth.users
);

-- Menu items
create table if not exists menu_items (
  id            uuid primary key default gen_random_uuid(),
  canteen_id    uuid references canteens on delete cascade,
  name          text not null,
  price         integer not null,
  category      text,
  enabled       boolean default true,
  created_at    timestamptz default now()
);

-- Orders
create table if not exists orders (
  id                  uuid primary key default gen_random_uuid(),
  canteen_id          uuid references canteens,
  student_id          uuid references auth.users,
  items               jsonb not null,
  total               integer not null,
  slot                text,
  bin                 text,
  otp                 text,
  status              text default 'pending'
                      check (status in ('pending','preparing','ready','completed','cancelled')),
  payment_id          text,
  razorpay_order_id   text,
  refund_status       text,
  created_at          timestamptz default now()
);

-- Enable Row Level Security
alter table profiles    enable row level security;
alter table canteens    enable row level security;
alter table menu_items  enable row level security;
alter table orders      enable row level security;

-- Students can read all canteens
create policy "canteens_public_read" on canteens
  for select using (true);

-- Students can read enabled menu items
create policy "menu_public_read" on menu_items
  for select using (enabled = true);

-- Students can read and create their own orders
create policy "orders_own_read"   on orders for select using (auth.uid() = student_id);
create policy "orders_own_insert" on orders for insert with check (auth.uid() = student_id);

-- Staff can read orders for their canteen
create policy "orders_staff_read" on orders for select
  using (
    exists (
      select 1 from profiles
      where id = auth.uid()
      and role in ('super_admin', 'canteen_admin', 'vendor', 'worker')
    )
  );
```

### Step 4 — Seed platform charges

```sql
insert into platform_charges (charge_pct, flat_charge, gst_pct)
values (2.00, 0.00, 18.00);
```

### Step 5 — Configure Auth

1. **Authentication → Providers → Phone**: enable and link Twilio Verify credentials
2. **Authentication → URL Configuration**:
   - Site URL: `https://canteenapplication-production.up.railway.app`
   - Redirect URLs: `https://canteenapplication-production.up.railway.app/**`

### Step 6 — Create the first Super Admin

After creating the user via Supabase Auth dashboard → Users → Invite User:

```sql
-- Replace <USER_UUID> with the actual UUID shown in the Auth dashboard
insert into profiles (id, role, name) values ('<USER_UUID>', 'super_admin', 'Super Admin');
```

---

## Twilio Setup (SMS & WhatsApp OTP)

Students verify their phone number via a 6-digit OTP. The app uses **Twilio Verify** to deliver
OTPs over SMS. WhatsApp delivery is also supported as a secondary channel (feature-flagged).

### Step 1 - Create a Twilio account

1. Go to https://twilio.com -> Sign Up (free trial available)
2. Verify your own phone number during sign-up
3. Skip the guided setup wizard

### Step 2 - Create a Verify Service

1. Twilio Console -> **Verify -> Services -> Create new Service**
2. Name it (e.g., `Canteen-App OTP`)
3. Copy the **Service SID** (starts with `VA...`) -> `TWILIO_VERIFY_SERVICE_SID`

### Step 3 - Copy account credentials

1. Twilio Console -> **Account -> API keys & tokens**
2. Copy:
   - **Account SID** (starts with `AC...`) -> `TWILIO_ACCOUNT_SID`
   - **Auth Token** -> `TWILIO_AUTH_TOKEN`

### Step 4 - Upgrade from Trial (important)

> **Trial accounts can only send OTPs to phone numbers you have explicitly verified in the
> Twilio console.** To send OTPs to all students, upgrade to a paid account.

1. Twilio Console -> **Account -> Upgrade Account**
2. Add a credit card and top up with the minimum amount (~$15-20)
3. All phone numbers globally will receive OTPs immediately after upgrade

While on trial: students who haven't verified their number in Twilio will see
`"SMS could not be delivered. Please use Email OTP login instead."` — a graceful
fallback that guides them to the email OTP option.

### WhatsApp OTP (optional, feature-flagged)

A secondary WhatsApp channel is implemented but disabled by default.

To enable it:
1. Apply for a **WhatsApp Business** account via Twilio Console -> Messaging -> Senders
2. Once approved, in Railway Variables add: `TWILIO_WHATSAPP_ENABLED=true`
3. No code changes needed — the `/api/auth/phone/whatsapp` route handles delivery automatically

When enabled, the auth flow tries WhatsApp first, then falls back to SMS.

---

## Location-Based Canteen Discovery

Students see only canteens within **10 km** of their current location. This is always-on
when the device provides GPS coordinates, and overrides the manual area picker.

### How it works

1. On first visit, the app shows a **location picker bottom sheet** with:
   - **🎯 Use My Location** — requests GPS from the browser; maps coordinates to the
     nearest campus area via Haversine distance calculation
   - **Text search** — live-filters the area buttons as you type
   - **Area buttons** — manually pick a campus zone (Main Building, North Block, etc.)
2. The chosen location (and GPS coordinates) are saved to `localStorage` so the picker
   only appears once per device
3. **10 km radius is enforced as the default baseline** — canteens beyond 10 km are
   hidden from all views regardless of area selection
4. Canteens are sorted **nearest-first** when GPS coordinates are available
5. Each canteen card shows a **distance chip** (e.g. `📍 0.3 km away`) when GPS is active
6. **"See all"** (shown when an area filter is active) clears the area filter but keeps the
   10 km radius — it shows every canteen within 10 km sorted by distance

### Section header behaviour

| Condition | Header shows |
|-----------|-------------|
| GPS active, no area filter | `Within 10 km` + `📡 10 km radius` badge |
| GPS active, area selected | `Canteens · Main Building` + `📡 10 km radius` badge |
| No GPS, area selected | `Canteens · Main Building` |
| No GPS, no filter | `All Canteens` |

### Empty state

When GPS is active but no canteens exist within 10 km, the student sees:
> "No canteens found within 10 km of your location" — with a "Change location" CTA.

### Admin — onboarding canteens with location

When adding or editing a canteen in the **Admin Dashboard -> Manage Canteens**:

| Field | Notes |
|-------|-------|
| Full Address | Street address for display |
| Google Maps Link | Paste any Google Maps URL — latitude and longitude are auto-parsed |
| Latitude / Longitude | Required; auto-filled from a Google Maps link, or enter manually |
| Preview on Google Maps | Live link opens the entered coords in Google Maps for verification |

The admin table shows a `📍 lat, lng` chip for each canteen that links to Google Maps.

> **How to get coordinates**: Search for the canteen on Google Maps -> right-click on
> the exact location -> the lat/lng appears at the top of the context menu.
> Or paste the full Google Maps URL into the link field and the app parses it automatically.

---

## Razorpay Setup

### Step 1 - Create account

1. Go to https://razorpay.com -> click "Sign Up"
2. Enter mobile number and verify OTP
3. Fill in business details: business name, business type, PAN card
4. Add bank account for settlements
5. Complete KYC (1-2 business days for full activation)
6. Test mode is available immediately without KYC

### Step 2 - Get API Keys

1. In Razorpay Dashboard: **Settings -> API Keys**
2. Click "Generate Test Key" for testing (or "Generate Live Key" after KYC)
3. Copy:
   - Key ID (starts with `rzp_test_` or `rzp_live_`) -> `RAZORPAY_KEY_ID`
   - Key Secret -> `RAZORPAY_KEY_SECRET`

### Step 3 - Set up Webhook

1. **Settings -> Webhooks -> Add New Webhook**
2. Webhook URL: `https://canteenapplication-production.up.railway.app/api/payments/razorpay-webhook`
3. Secret: generate a strong random string (e.g. `openssl rand -hex 32`) -> `RAZORPAY_WEBHOOK_SECRET`
4. Enable these events:
   - payment.captured
   - payment.failed
   - refund.processed
5. Click Save

### Step 4 - Test Payments (Test Mode)

```
Visa success:    4111 1111 1111 1111  |  CVV: any 3 digits  |  Expiry: any future date
Mastercard fail: 5105 1051 0510 5100  |  CVV: any           |  Expiry: any future date
Test UPI:        success@razorpay     (always succeeds)
Test UPI fail:   failure@razorpay     (always fails)
```

### Step 5 - Go Live

Switch `RAZORPAY_KEY_ID` from `rzp_test_` to `rzp_live_` key in Railway variables.
Update webhook URL if needed. That's it - no code changes required.

---

## Environment Variables

Add these in Railway -> your project -> Variables:

```
# Supabase (get from Supabase Dashboard -> Settings -> API)
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Razorpay (get from Razorpay Dashboard -> Settings -> API Keys + Webhooks)
RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxx
RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxx
RAZORPAY_WEBHOOK_SECRET=your-webhook-secret

# Twilio Verify (SMS OTP + optional WhatsApp OTP)
# Get from Twilio Console -> Account SID + Auth Token + Verify -> Services
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_VERIFY_SERVICE_SID=VAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# WhatsApp OTP channel (set to true only after WhatsApp Business approval)
TWILIO_WHATSAPP_ENABLED=false

# App URL (used for auth redirects - must match your Railway domain)
NEXT_PUBLIC_APP_URL=https://canteenapplication-production.up.railway.app
```

Never commit `.env.local` to Git. The `.env.example` file in this repo shows all keys with inline setup instructions.

### Current Railway Variables (10 active)

| Variable | Source |
|----------|--------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Dashboard -> Settings -> API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase Dashboard -> Settings -> API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Dashboard -> Settings -> API |
| `RAZORPAY_KEY_ID` | Razorpay Dashboard -> Settings -> API Keys |
| `RAZORPAY_KEY_SECRET` | Razorpay Dashboard -> Settings -> API Keys |
| `RAZORPAY_WEBHOOK_SECRET` | Razorpay Dashboard -> Settings -> Webhooks |
| `TWILIO_ACCOUNT_SID` | Twilio Console -> Account Info |
| `TWILIO_AUTH_TOKEN` | Twilio Console -> Account Info |
| `TWILIO_VERIFY_SERVICE_SID` | Twilio Console -> Verify -> Services |
| `NEXT_PUBLIC_APP_URL` | Your Railway domain |

---

## Deploy to Railway (Cloud)

The app is already live on Railway and auto-deploys on every push to `main`.

### Auto-deploy (already configured - just push code)

```bash
git add -A
git commit -m "your changes"
git push origin main
# Railway detects the push, builds a Docker image, and deploys in ~2 minutes
```

### Set environment variables via CLI

```bash
npm install -g @railway/cli
railway login
railway link  # link to project 9ecacfbc-a63e-4962-b2e7-69565b15b131

railway variables set RAZORPAY_KEY_ID=rzp_test_xxx
railway variables set RAZORPAY_KEY_SECRET=xxx
railway variables set RAZORPAY_WEBHOOK_SECRET=xxx
railway variables set NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
railway variables set NEXT_PUBLIC_SUPABASE_ANON_KEY=xxx
railway variables set SUPABASE_SERVICE_ROLE_KEY=xxx
railway variables set NEXT_PUBLIC_APP_URL=https://canteenapplication-production.up.railway.app
```

### Custom domain

In Railway -> your service -> Settings -> Domains -> Add Custom Domain:
1. Enter your domain: `app.canteen-application.in`
2. Add a CNAME DNS record: `app.canteen-application.in -> your-app.up.railway.app`
3. Railway provisions a free TLS certificate automatically

---

## iOS and Android Deployment

Canteen-Application is a **Progressive Web App (PWA)**. It installs on home screens and runs
like a native app - no App Store approval needed for internal/college deployment.

### Install on iOS (Safari)

1. Open https://canteenapplication-production.up.railway.app in **Safari** (not Chrome)
2. Tap the **Share** button (square with arrow pointing up)
3. Scroll down and tap **Add to Home Screen**
4. Tap **Add** - the Canteen-Application icon appears on the home screen
5. Tap it to launch fullscreen, just like a native app

### Install on Android (Chrome)

1. Open https://canteenapplication-production.up.railway.app in **Chrome**
2. Tap the three-dot menu (top right)
3. Tap **Add to Home Screen** or **Install App**
4. Tap **Install** - Canteen-Application icon appears on home screen
5. Opens in standalone mode (no browser chrome visible)

### Distribute to students at scale

The simplest deployment for 110,000 students:
1. Send a WhatsApp/SMS message with the link
2. Include a short guide: "Open in Safari/Chrome -> Share -> Add to Home Screen"
3. Students get the full app experience with zero app store friction

### Publish to Google Play Store

Use PWABuilder (free, no native code needed):
1. Go to https://www.pwabuilder.com
2. Enter: `https://canteenapplication-production.up.railway.app`
3. Click Build -> Android -> Download APK/AAB
4. Sign the bundle using Android Studio or `jarsigner`
5. Upload to https://play.google.com/console
6. Fill store listing, add screenshots, submit for review (~3-7 days)
7. Cost: one-time $25 Google Play developer fee

### Publish to Apple App Store

1. Go to https://www.pwabuilder.com
2. Enter: `https://canteenapplication-production.up.railway.app`
3. Choose iOS -> download the Xcode project
4. Open in Xcode, set your Apple Developer Team ID
5. Build -> Archive -> Upload to App Store Connect (https://appstoreconnect.apple.com)
6. Submit for review (~1-3 days)
7. Cost: $99/year Apple Developer Program membership

---

## Canteen Toggle

Both **Super Admin** and **Vendor/Canteen Admin** can turn a canteen on or off.
When a canteen is closed:
- Students see a red "Canteen is closed" banner on the menu page
- All "Add" buttons are disabled
- The cart bar is hidden
- No orders can be placed

### From Vendor Dashboard

1. Log in at `/vendor/dashboard`
2. In the top header, there is a green OPEN toggle switch
3. Click it -> canteen immediately goes CLOSED (optimistic update + API call)
4. Click again -> canteen goes OPEN
5. On API error, the toggle reverts automatically

### From Super Admin Dashboard

1. Log in at `/admin/dashboard`
2. Go to the **Manage Canteens** section
3. Each canteen row has a status badge - click **Deactivate** or **Activate**

### API (PATCH /api/canteens/[id]/toggle)

```
PATCH /api/canteens/{canteen_id}/toggle
Authorization: Bearer <Supabase session JWT>
Content-Type: application/json

{ "is_active": false }
```

Response:
```json
{ "canteen": { "id": "...", "name": "Main Canteen", "is_active": false, "status": "closed" } }
```

Access control:
- `super_admin` can toggle any canteen
- `vendor` and `canteen_admin` can only toggle their own canteen (matched via `profiles.canteen_id`)
- All other roles get `403 Forbidden`
- When Supabase is not configured, returns success with a `note` field (demo mode)

---

## Full Workflow

### Student Orders Food

```
1.  Open app at https://canteenapplication-production.up.railway.app
2.  Tap "Login" -> enter phone -> receive OTP via SMS (or WhatsApp if enabled)
    -> enter OTP to sign in
3.  On first visit: choose your campus area or tap "Use My Location" for GPS
4.  Browse canteen list — only canteens within 10 km of your location are shown
    Each card shows distance (e.g. 📍 0.3 km away) when GPS is active
5.  Select a canteen (only OPEN canteens show add buttons)
6.  Add items to cart - cart bar appears at bottom showing total
7.  Tap cart bar -> Checkout page loads with items pre-filled
8.  Choose a pickup time slot
9.  (Optional) toggle on Canteen Cash wallet balance
10. Tap "Pay Rs X via Razorpay" -> Razorpay popup opens
11. Pay via UPI / Card / Net Banking / Wallet
12. Razorpay calls our webhook -> we verify HMAC-SHA256 signature
13. On verified: order finalised -> student sees OTP + bin number
14. Student goes to canteen, shows OTP to vendor
15. Vendor enters OTP, confirms -> order completed, bin freed
```

### Payment Security Chain

```
Razorpay popup completes
  -> handler receives { payment_id, order_id, signature }
  -> POST /api/payments/razorpay-verify
     -> HMAC-SHA256(order_id + "|" + payment_id, KEY_SECRET)
     -> if match: order finalised, OTP generated
     -> if mismatch: POST /api/payments/razorpay-refund triggered immediately
                     student shown error with refund timeline
Razorpay webhook (payment.failed)
  -> X-Razorpay-Signature verified
  -> auto-refund triggered via Razorpay REST API
```

### Vendor Processes an Order

```
1. Login -> Vendor Dashboard -> Live Orders tab
2. See bin cards: Preparing / Completed / Delayed / Empty
3. Student arrives -> vendor taps bin card
4. Enter 6-digit OTP from student's screen
5. OTP matches -> tap "Mark Complete" -> bin freed for next order
6. (Optional) toggle canteen closed when shutting down for the day
```

### Super Admin Manages System

```
1. Login -> Admin Dashboard
2. Canteens tab: add/edit/activate/deactivate canteens, assign vendors
3. Users tab: view all registered students, assign staff roles
4. Analytics tab: orders per day, revenue, popular items by canteen
5. Payments tab: transaction list, refund requests, dispute management
6. Support tab: student complaints and resolution
```

---

## API Reference

### Payments

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/payments/razorpay-order` | Create Razorpay order |
| POST | `/api/payments/razorpay-verify` | Verify HMAC-SHA256 signature |
| POST | `/api/payments/razorpay-refund` | Initiate refund |
| POST | `/api/payments/razorpay-webhook` | Handle Razorpay events (auto-refund on failure) |

### Orders

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/orders` | List orders |
| POST | `/api/orders` | Create order |
| GET | `/api/orders/[id]` | Get single order |
| PATCH | `/api/orders/[id]/status` | Update status |
| GET | `/api/orders/[id]/invoice` | GST invoice (CGST + SGST) |

### NoQx Pro

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/subscriptions` | Check current user's Pro status |
| POST | `/api/subscriptions` | Activate Pro after Razorpay payment |

### Wallet

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/wallet` | Get balance + transactions |
| POST | `/api/wallet/topup` | Create top-up Razorpay order |
| POST | `/api/wallet/topup/verify` | Verify top-up payment |
| POST | `/api/wallet/withdraw` | Initiate withdrawal |

### Admin — Settlements & Finance

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/admin/settlements` | Per-canteen settlement breakdown |
| POST | `/api/admin/settlements/pay` | Record settlement payment |
| GET/POST | `/api/admin/canteen-bank` | Get / update canteen bank details |
| GET/PATCH | `/api/admin/platform-charges` | Get / update commission config |
| GET | `/api/admin/users` | List all users (super_admin only) |

### General

| Method | Path | Description |
|--------|------|-------------|
| PATCH | `/api/canteens/[id]/toggle` | Toggle canteen open/closed |
| GET | `/api/menu` | Menu items |
| GET | `/api/slots` | Pickup slots |
| GET | `/api/bins` | Bin status |
| POST | `/api/waste-reports` | Submit waste report |
| POST | `/api/auth/phone/whatsapp` | WhatsApp OTP (feature-flagged) |
| GET | `/api/auth/session` | Concurrent session check |
| GET | `/api/version` | App version |

**Rate limits (per IP):**
- `/api/payments/*` → 10 req/min
- `/api/admin/*` → 30 req/min
- `/api/canteens/*` → 20 req/min
- All others → 120 req/min

---

## Database Schema

| Table | Purpose |
|-------|--------|
| `profiles` | User roles + canteen assignment (extends `auth.users`) |
| `canteens` | Canteen list, `lat`/`lng`, address, `is_active`, status |
| `menu_items` | Items per canteen, price, `enabled` flag |
| `orders` | Order records — OTP, bin, `payment_id`, `status`, `razorpay_order_id` |
| `wallet_transactions` | Top-up / withdrawal / earned / redeemed / expired |
| `canteen_bank_details` | Bank account per canteen (account no, IFSC, UPI) |
| `platform_charges` | Commission %, flat charge, GST % — single configurable row |
| `settlement_payments` | History of NEFT/RTGS/UPI payments to canteens |
| `noqx_pro_subscriptions` | Pro subscribers — `user_id`, `payment_id`, `active_until` |

Full schema SQL is in `supabase-setup.sql` at the root of this repo.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Cart shows empty on checkout | Menu page encodes cart in URL: ?cart=id:name:price:qty,... Check that the cart bar link includes this query string |
| Razorpay popup does not open | Browser may be blocking popups. Also verify RAZORPAY_KEY_ID is set in Railway variables |
| "key not found" error from Razorpay | The RAZORPAY_KEY_ID environment variable is not set in Railway (it is not inherited from .env.local) |
| Canteen toggle does not persist after refresh | Add Supabase env vars in Railway. Without them, toggle works in UI state only (demo mode) |
| Webhook events not received | Verify the webhook URL exact matches what is in Razorpay Dashboard. Check RAZORPAY_WEBHOOK_SECRET matches |
| Railway build fails | Run npm run build locally first and fix all TypeScript errors before pushing |
| Auth redirects to wrong URL | Set NEXT_PUBLIC_APP_URL in Railway variables to your actual Railway domain |
| iOS PWA: auth lost after minimising app | Auth state is persisted to localStorage - this is already implemented |
| 429 Too Many Requests | Rate limiter triggered. Wait 60 seconds. For payment routes, the limit is 10/minute - this is intentional |
| "SMS could not be delivered" / Twilio trial error | Twilio trial accounts only send to verified numbers. Upgrade your Twilio account, or use Email OTP as a fallback |
| Student OTP never arrives | Check that TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_VERIFY_SERVICE_SID are all set in Railway |
| WhatsApp OTP not sending | TWILIO_WHATSAPP_ENABLED is false by default. Set it to true in Railway after WhatsApp Business approval |
| Canteens not showing | Canteens need `lat`/`lng` set in Admin → Canteens — required for distance ranking |
| All canteens filtered out (10 km) | Student's GPS is > 10 km from all canteens — use the manual area picker |
| Location picker on every visit | `localStorage` blocked/cleared — check browser site settings |
| Convenience fee not at checkout | Check `isPro` reads from `localStorage("noqx_pro_active")` and `noqx_pro_subscriptions` |
| Pro card not visible at checkout | `showProCard` is `true` for non-Pro users — check `isPro` state loads correctly |
| Order-status page redirects away | No `canteen_active_order` in localStorage — order must be placed first |
| Floating track button missing | `canteen_active_order` not set; created by `finaliseOrder()` in cart after payment |
| Settlement page blank | `platform_charges` table needs a seed row — run: `insert into platform_charges (charge_pct, flat_charge, gst_pct) values (2.00, 0.00, 18.00);` |

---

## Development Commands

```bash
npm run dev     # Local dev server at http://localhost:3000
npm run build   # Production build (run this before every push to check for errors)
npm run lint    # ESLint + TypeScript checks

git push origin main   # Deploy to Railway (triggers auto-build)
```

---

## Links

| Resource | URL |
|----------|-----|
| Web App | https://canteenapplication-production.up.railway.app |
| GitHub | https://github.com/DH72367259/Canteen_Application |
| Railway Dashboard | https://railway.com/project/9ecacfbc-a63e-4962-b2e7-69565b15b131 |
| Supabase | https://supabase.com (create your project here) |
| Razorpay | https://razorpay.com (create your account here) |
| Twilio | https://twilio.com (SMS & WhatsApp OTP) |
| PWABuilder (app stores) | https://www.pwabuilder.com |

---

## Recent Changelog

| Commit | Description |
|--------|-------------|
| `57cf7eb` | fix: PDF spec — banner 3-line copy, "Pro users pay ₹0" in cart, "Your order is ready" heading |
| `2dc3e05` | fix: remove dead placedOrder state, redirect /rewards to /pro |
| `85610a1` | fix: remove staff placeholder from canteen login email field |
| `8eb01ea` | feat: NoQx Pro subscription + full order tracking flow (preparing → ready → collected) |
| `7f4ea39` | feat: settlement dashboard, GST invoices, reorder, canteen bank details, login UI cleanup |
| `508311b` | feat: wallet top-up/withdraw (₹100 min), same-gateway withdrawal, concurrent session enforcement |
| `11689e2` | fix: auth guard, Zomato-style location header, GPS error inline, search fallback |
| `6d6f9b1` | fix: enforce 10 km radius as always-on baseline canteen filter |
| `7eec070` | feat: distance display on canteen cards, 10 km radius filter, admin location onboarding |
| `28b9025` | feat: GPS auto-detect + text search in location picker, fix See All button |
| `f7d17f8` | feat: location-based canteen filter + hero card layout |
| `faed93f` | feat: WhatsApp OTP channel (feature-flagged), Twilio docs |
| `23ffdf0` | feat: Twilio Verify SMS OTP, dual phone + email verification |

---

**Last updated**: 24 April 2026  
**Build status**: Passing — 0 TypeScript errors  
**Deployed**: Railway — auto-deploy from `main` (latest: `57cf7eb`)

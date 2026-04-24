# Canteen-Application - Smart Institutional Dining

> **Live URL** - https://canteenapplication-production.up.railway.app

Cashless, queue-free canteen ordering for universities and colleges.
Students order on their phone, pay via Razorpay (UPI/Card/Wallet), and pick up
at an assigned bin using a 6-digit OTP. No cash, no queue, no wasted food.

---

## Table of Contents

1. [Live URLs](#live-urls)
2. [Login Credentials](#login-credentials)
3. [Architecture](#architecture)
4. [Security](#security)
5. [Supabase Setup](#supabase-setup)
6. [Razorpay Setup](#razorpay-setup)
7. [Twilio Setup (SMS & WhatsApp OTP)](#twilio-setup-sms--whatsapp-otp)
8. [Environment Variables](#environment-variables)
9. [Deploy to Railway (Cloud)](#deploy-to-railway-cloud)
10. [iOS and Android Deployment](#ios-and-android-deployment)
11. [Canteen Toggle](#canteen-toggle)
12. [Location-Based Canteen Discovery](#location-based-canteen-discovery)
13. [Full Workflow](#full-workflow)
14. [API Reference](#api-reference)
15. [Database Schema](#database-schema)
16. [Troubleshooting](#troubleshooting)

---

## Live URLs

| Surface | URL |
|---------|-----|
| Web App (Production) | https://canteenapplication-production.up.railway.app |
| GitHub Repository | https://github.com/DH72367259/Canteen_Application |
| Railway Dashboard | https://railway.com/project/9ecacfbc-a63e-4962-b2e7-69565b15b131 |

The app auto-deploys from the `main` branch via Railway's GitHub integration.
Every `git push origin main` triggers a new production build within ~2 minutes.

> **Note on the URL**: Railway assigns a subdomain like `canteenapplication-production.up.railway.app`.
> Check your exact URL at Railway Dashboard -> your service -> Settings -> Domains.
> You can also set a custom domain (e.g. `app.canteen-application.in`) from that same page.

---

## Login Credentials

| Role | Email | Password | Access |
|------|-------|----------|--------|
| Super Admin | admin@canteen-application.in | admin123 | Full system - canteens, users, analytics, payments |
| Vendor / Canteen Admin | vendor@canteen-application.in | vendor123 | Their canteen - live orders, menu, slots, toggle |
| Worker | worker@canteen-application.in | worker123 | Bin management, OTP verify, waste tracking |
| Student | any phone number | OTP: 1234 | Browse, order, pay, track |

When Supabase is connected, replace demo credentials with real users created
via the Supabase Auth dashboard.

---

## Architecture

```
Student / Vendor / Admin browsers
          |
          v
   Next.js 16 (Railway)         <- single deployable app
     App Router + API Routes
          |               |
          v               v
  Supabase PostgreSQL   Razorpay API
  (database + auth)     (payments + refunds + webhooks)
  Row Level Security    HMAC-SHA256 signature verification
```

**Stack:**

- Frontend/Backend: Next.js 16 App Router, React 19, TypeScript
- Styling: Tailwind CSS v4 + custom CSS design tokens
- Database: Supabase (PostgreSQL 15) with Row Level Security
- Auth: Supabase Auth — phone OTP via Twilio Verify (SMS + WhatsApp), email OTP, email+password for staff
- Payments: Razorpay (UPI, GPay, PhonePe, Cards, Net Banking, Wallets)
- SMS/WhatsApp: Twilio Verify (OTP delivery, multi-channel)
- Hosting: Railway (auto-deploy from GitHub, Docker standalone build)
- PWA: Web App Manifest + Service Worker (installable on iOS and Android)

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
| RBAC | super_admin, canteen_admin, vendor, worker, student - enforced in every API route |
| Secrets never in browser | RAZORPAY_KEY_SECRET and SUPABASE_SERVICE_ROLE_KEY are server-only |
| Input Validation | All API bodies validated with strict type checks, 400 on invalid input |
| XSS Prevention | No dangerouslySetInnerHTML. React escapes all output automatically |
| SQL Injection | Supabase parameterised queries only. No raw SQL string concatenation |
| X-Frame-Options | SAMEORIGIN - prevents clickjacking |
| X-Content-Type-Options | nosniff - prevents MIME sniffing attacks |

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

### Step 3 - Run the database schema

Open **SQL Editor** in Supabase dashboard and run this SQL:

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

### Step 4 - Configure Auth

1. **Authentication -> Providers -> Email**: enable "Email OTP" (passwordless for students)
2. **Authentication -> URL Configuration**:
   - Site URL: `https://canteenapplication-production.up.railway.app`
   - Redirect URLs: `https://canteenapplication-production.up.railway.app/**`

### Step 5 - Create the first Super Admin

After creating a user via the Supabase Auth dashboard (Authentication -> Users -> Invite User):

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

| Method | Path | Auth Required | Description |
|--------|------|---------------|-------------|
| POST | /api/payments/razorpay-order | None | Create Razorpay order, returns order ID |
| POST | /api/payments/razorpay-verify | None | Verify HMAC-SHA256 payment signature |
| POST | /api/payments/razorpay-refund | None | Initiate refund for a payment |
| POST | /api/payments/razorpay-webhook | Razorpay signature | Handle payment events (auto-refund on failure) |
| PATCH | /api/canteens/[id]/toggle | Bearer JWT | Toggle canteen open or closed |
| POST | /api/auth/phone/whatsapp | None | Send OTP via WhatsApp (feature-flagged; returns `{ whatsapp: false }` unless `TWILIO_WHATSAPP_ENABLED=true`) |
| GET | /api/menu | None | Get menu items |
| GET | /api/orders | None | Get orders |
| POST | /api/orders | None | Create a new order |
| PATCH | /api/orders/[id]/status | None | Update order status |
| GET | /api/slots | None | Get available time slots |
| GET | /api/bins | None | Get bin status |
| POST | /api/waste-reports | None | Submit worker waste report |
| GET | /api/admin/users | Bearer JWT | List all users (super_admin only) |

Rate limits (per IP, enforced in middleware.ts):
- /api/payments/* -> 10 requests per minute
- /api/admin/* -> 30 requests per minute
- /api/canteens/* -> 20 requests per minute
- /api/* (all others) -> 120 requests per minute

---

## Database Schema

```
profiles      -> user roles, canteen assignment (extends auth.users)
canteens      -> canteen list, location coords (lat/lng), address, is_active flag, status
menu_items    -> items per canteen, price, enabled flag
orders        -> order record with OTP, bin, payment_id, refund_status
```

Key canteens columns added for location:

| Column | Type | Notes |
|--------|------|-------|
| `address` | text | Full street address |
| `lat` | float8 | Latitude (required for distance filtering) |
| `lng` | float8 | Longitude (required for distance filtering) |

Full schema SQL (including RLS policies, triggers, and all tables) is in `supabase-setup.sql`
at the root of this repository. Run it in the Supabase SQL Editor to bootstrap a fresh project.

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
| Canteens not showing on student dashboard | Canteens need lat/lng set in the Admin -> Canteens form. Without coordinates they cannot be distance-ranked |
| All canteens filtered out (10 km) | The student's GPS location is more than 10 km from all canteens. Ask them to use the manual area picker or update canteen coordinates in admin |
| Location picker appears on every visit | localStorage may be cleared or blocked. Check browser settings for the site |

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
| `6d6f9b1` | fix: enforce 10 km radius as always-on baseline canteen filter |
| `7eec070` | feat: distance display on cards, 10 km radius filter, admin location onboarding |
| `28b9025` | feat: GPS detection + text search in location picker, fix See All button |
| `f7d17f8` | feat: location-based canteen filter + hero card layout fix |
| `faed93f` | feat: WhatsApp OTP channel (feature-flagged) + Twilio env docs + supabase-setup.sql |
| `dffcc74` | fix: graceful SMS failure message with Email OTP fallback hint |
| `23ffdf0` | feat: Twilio Verify SMS OTP + dual phone + email verification |

---

**Last updated**: 24 April 2026
**Build status**: Passing (0 TypeScript errors)
**Deployed**: Railway — auto-deploy from `main` branch (latest: `6d6f9b1`)

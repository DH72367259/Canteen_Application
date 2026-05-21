# NoQx — Store Listing Copy

Ready-to-paste copy + asset references for Play Store + App Store submission.
Last updated: 2026-05-21.

Two apps to list:
- **NoQx Student** (com.noqx.student) — both stores
- **NoQx Worker** (com.noqx.worker) — Play Store only (worker-side iOS not planned for v1)

---

## NoQx Student — Play Store (Google Play Console)

### Basic info
| Field | Value | Limit |
|---|---|---|
| App name | `NoQx — Skip the Canteen Queue` | 30 chars (29 ✓) |
| Short description | `Pre-order canteen meals. Pick up when ready. No queues, no waiting.` | 80 chars (67 ✓) |
| Application type | App | — |
| Category | Food & Drink | — |
| Tags (up to 5) | `food ordering`, `canteen`, `meal pickup`, `college food`, `cafeteria` | — |
| Contact email | support@noqx.co.in | — |
| Website URL | https://noqx.co.in | — |
| Privacy policy URL | https://noqx.co.in/privacy | required |

### Full description (paste verbatim, 4000 char limit — currently ~1300)

```
NoQx turns your campus canteen into a pre-order pickup window.

Browse the menu, place an order, choose your 15-minute pickup slot, pay
through Razorpay (UPI / Cards / NetBanking), and walk straight to the
counter when the kitchen is ready. No more standing in line, no more
"sold out" surprises at the front of the queue.

WHY STUDENTS LOVE NOQX
• Live menu with real-time availability — if it's grey, it's sold out
• Pick your slot — order at 11:30 AM for a 1:00 PM pickup
• One-tap reorder of your favourite meals
• Pickup OTP — only you can collect your order
• Real-time order status: Placed → Preparing → Ready → Collected
• Push notifications when your meal is ready
• Auto-refund if the canteen cancels (e.g. an item runs out)
• Full order history with downloadable receipts

PAYMENT, SAFELY
Powered by Razorpay (PCI-DSS Level 1). UPI, cards, net banking and
wallets supported. Your card numbers and UPI PINs never touch NoQx
servers — we only receive a payment confirmation.

PRIVACY-FIRST
• No third-party trackers, no advertising cookies
• IP addresses stored only as one-way hashes
• Account deletion in one tap from Profile
• Fully DPDPA-2023 compliant — see https://noqx.co.in/privacy

WORKS WITH YOUR CAMPUS
NoQx is available at participating canteens. If your canteen isn't on
NoQx yet, ask your operations team — onboarding takes one afternoon.

SUPPORT
support@noqx.co.in (responses within 48 hours)
```

### Screenshots needed (2-8 phone, see SCREENSHOT_GUIDE.md)

### Feature graphic
`store-listing/feature-graphic/feature-1024x500.png` ✅ generated

### App icon
`store-listing/android/ic_launcher-512.png` ✅ generated

---

## NoQx Student — App Store (App Store Connect)

### Basic info
| Field | Value | Limit |
|---|---|---|
| App Name | `NoQx — Canteen Pickup` | 30 chars (22 ✓) |
| Subtitle | `Skip the queue. Pre-order.` | 30 chars (26 ✓) |
| Primary category | Food & Drink | — |
| Secondary category | Lifestyle | — |
| Bundle ID | com.noqx.student | — |
| SKU | NOQX-STUDENT-001 | — |
| Support URL | https://noqx.co.in/contact | — |
| Marketing URL | https://noqx.co.in | optional |
| Privacy policy URL | https://noqx.co.in/privacy | required |

### Promotional text (170 chars — appears at top, updatable without review)

```
Now live at participating campuses. Pre-order your canteen meal, pick a 15-min slot, and walk past the queue. UPI / Cards / NetBanking supported.
```

### Description (paste verbatim, 4000 char limit — currently ~1300)

```
NoQx is the smarter way to eat at your campus canteen.

Browse the live menu, place your order, pick a 15-minute pickup slot,
pay through Razorpay (UPI, cards, net banking, wallets) and walk
straight to the counter when your food is ready.

NO MORE QUEUES
Order between classes. Pickup OTP guarantees only you collect.
Real-time status: Placed → Preparing → Ready → Collected.

LIVE AVAILABILITY
Items that are sold out are greyed out instantly — no "sold out at
the counter" surprise after a 10-minute wait.

PUSH NOTIFICATIONS
We ping you the moment your meal is ready. Show the bin number and
OTP at the counter — no awkward "is this mine?" moments.

AUTO-REFUNDS
If a canteen cancels an order (item out of stock, equipment failure),
your money is refunded automatically through Razorpay. No paperwork.

PRIVACY YOU CAN ACTUALLY VERIFY
• No advertising trackers, no analytics SDKs, no behavioural profiling
• IP addresses never stored — only one-way SHA-256 hashes
• Payment details handled by Razorpay (PCI-DSS Level 1); we never see
  card numbers, CVVs, or UPI PINs
• Account deletion in one tap from your Profile
• DPDPA-2023 compliant — full policy at https://noqx.co.in/privacy

WORKS WITH YOUR CAMPUS
NoQx partners with canteens at colleges and corporate campuses.
If yours isn't listed yet, ask your campus operations team.

SUPPORT
Email support@noqx.co.in — we respond within 48 hours.
```

### Keywords (100 char limit — currently 89, comma-separated, no spaces after commas)

```
canteen,food,pickup,preorder,college,cafeteria,meal,queue,upi,razorpay,campus,mensa,foodorder
```

### App icon
`store-listing/ios/AppIcon-1024.png` ✅ generated

---

## NoQx Worker — Play Store (Google Play Console)

### Basic info
| Field | Value | Limit |
|---|---|---|
| App name | `NoQx Worker — Canteen Staff` | 30 chars (28 ✓) |
| Short description | `Manage NoQx canteen orders, verify pickup OTPs, mark items sold out.` | 80 chars (68 ✓) |
| Category | Food & Drink | — |
| Privacy policy URL | https://noqx.co.in/privacy | required |
| Distribution | **Restricted** (only canteen staff use this) | — |

### Full description

```
NoQx Worker is the staff-side companion to NoQx — the canteen pre-order
pickup platform. This app is for canteen workers, kitchen staff and
canteen managers. Students should download "NoQx" instead.

WHAT WORKERS DO IN THIS APP
• See the live queue of incoming orders, sorted by pickup slot
• Mark items as prepared, ready, or sold-out in one tap
• Verify pickup OTPs at the counter
• View daily prep-summary aggregates (e.g. "20 dosas across 1-2 PM slot")
• See bin assignments and slot capacity in real time

CANTEEN STAFF ONLY
Account creation is restricted — your canteen manager invites you via
the NoQx admin dashboard. Public sign-up is disabled.

PRIVACY
Worker accounts only see data for their own canteen. NoQx never shares
worker data with students or other canteens. Full policy at
https://noqx.co.in/privacy.

SUPPORT
support@noqx.co.in
```

### Feature graphic + icon
Same generated assets as Student app (worker uses the same brand mark).

---

## Data Safety / App Privacy answers (BOTH apps, BOTH stores)

The two stores ask similar questions in different formats. Same underlying
truth, just paste the right cell.

### Data collected

| Data | Collected | Reason | Encrypted in transit | Encrypted at rest | Shared with 3rd party | Optional |
|---|---|---|---|---|---|---|
| Name | Yes | Account, order display | Yes | Yes | No | No |
| Email | Yes | Account, transactional email | Yes | Yes | No (Resend processes, doesn't store) | No |
| Phone number | Yes | Pickup contact, SMS OTP | Yes | Yes | Twilio (delivery only) | No |
| Password | Yes | Auth (bcrypt-hashed by Supabase) | Yes | Yes | No | No |
| Order history | Yes | Service function, support disputes | Yes | Yes | No | No |
| Approximate location | No | — | — | — | — | — |
| Precise location | No | — | — | — | — | — |
| Photos / videos | No | — | — | — | — | — |
| Contacts | No | — | — | — | — | — |
| Calendar | No | — | — | — | — | — |
| Device ID | No (we use FCM/APNs token only) | Push delivery | Yes | Yes | Google/Apple push services | Yes |
| Crash logs | No (no Crashlytics, no Sentry) | — | — | — | — | — |
| Advertising ID | No | — | — | — | — | — |
| Browsing history | No | — | — | — | — | — |
| In-app actions | No (no product analytics) | — | — | — | — | — |
| Payment info | **Indirectly** — handled entirely by Razorpay; NoQx receives payment_id + amount only | Order fulfilment | Yes (Razorpay HTTPS) | Yes (Razorpay vault) | Razorpay (PCI-DSS Level 1) | No |

### Standard answers
- **Are you the only data controller?** Yes (NoQx Technologies).
- **Do you sell data?** No — never.
- **Can users delete their account?** Yes, in-app via Profile → Delete Account.
- **Are children under 13 supported?** No — app intended 13+, accounts of suspected minors deleted within 7 days on report.
- **Do you encrypt in transit?** Yes (TLS 1.3 enforced by HSTS preload).
- **Do you have a way to handle deletion requests?** Yes (privacy@noqx.co.in, 7-day response under DPDPA §14).

### Play Store — Data safety summary (paste in Play Console wizard)
1. Does your app collect or share any of the required user data types? → **Yes**
2. Is all of the user data collected by your app encrypted in transit? → **Yes**
3. Do you provide a way for users to request that their data is deleted? → **Yes**
4. Data types collected (check all): Name, Email, Phone, User-generated content (order notes), Purchase history. NO advertising ID, NO precise location, NO contacts, NO photos.
5. Data is collected (not just processed transiently).
6. Data is **NOT** shared with third parties (Razorpay/Twilio/Resend are processors, not third-party recipients in Play's sense).

### App Store — App Privacy summary (paste in App Store Connect)
- **Data Linked to You:** Name, Email, Phone, Purchase History, User Content (order notes), User ID
- **Data Not Linked to You:** none
- **Data Used to Track You:** **none** (this is the critical one — we do not track)

---

## Submission checklist

### Before clicking "Submit for review" on either store

- [ ] App tested end-to-end on a real device against PRODUCTION URL (not staging)
- [ ] All 5 contact-page placeholders replaced (SUPPORT_EMAIL etc — see launch_readiness)
- [ ] Privacy policy URL returns HTTP 200 (verify https://noqx.co.in/privacy)
- [ ] Support URL returns HTTP 200 (verify https://noqx.co.in/contact)
- [ ] Feature graphic looks correct (open store-listing/feature-graphic/feature-1024x500.png)
- [ ] All screenshots captured (see SCREENSHOT_GUIDE.md)
- [ ] Razorpay LIVE keys deployed (NOT test keys) — payment screen will be reviewed
- [ ] Capacitor SERVER_URL flipped from staging → production in both app configs
- [ ] Built and signed release AABs from production workflow (not staging artifacts)

### Asset inventory (what's in this folder)

```
store-listing/
├── STORE_LISTING_COPY.md        ← this file
├── SCREENSHOT_GUIDE.md           ← operator-side capture instructions
├── android/
│   └── ic_launcher-512.png       ✅ Play Store icon
├── ios/
│   └── AppIcon-1024.png          ✅ App Store icon
└── feature-graphic/
    ├── feature-1024x500.png      ✅ Play Store feature graphic
    └── promo-1080x1920.png       ✅ Optional 9:16 promo banner
```

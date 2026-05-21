# Launch Day Runbook

A minute-by-minute sequence for the day you flip the switch from "demo
canteen" to "real customers can place orders". Print this. Keep your
phone on you. Have your laptop charged.

> Reads top-to-bottom. Do not skip steps. Each block has a verification
> check — if it fails, STOP and fix before proceeding.

---

## T-7 days (one week before)

- [ ] Razorpay KYC submitted (PAN, GST or PAN-only declaration, bank
      account, director ID). Wait 3-7 days for approval.
- [ ] Apple Developer Program purchased ($99/yr) — gives you ~24h before
      access activates.
- [ ] Play Console account created ($25 one-time) + service-account JSON
      generated.
- [ ] Inform the operations team / canteen partners of launch date.
- [ ] Schedule on-call: who's reachable at launch time + first 4 hours.

## T-3 days

- [ ] **Razorpay**: confirm KYC approved + live keys generated. Copy to
      a sticky note (you'll paste them in T-1 day).
- [ ] **Supabase**: upgrade to Pro ($25/mo) → enables 7-day automated
      backups. Verify a backup runs the first night.
- [ ] **DB**: place 3 fully-end-to-end test orders against staging using
      Razorpay TEST mode (test card `4111 1111 1111 1111`). Watch each
      transition: placed → preparing → ready → collected.
- [ ] **Smoke test**: `node scripts/smoke-test-prod.mjs https://noqx.co.in`
      → 19/19 must pass.
- [ ] **Razorpay flow verify**: `node scripts/verify-razorpay-flow.mjs`
      → 5/5 must pass (will report PAYMENT_TEST_MODE=true until T-1d).
- [ ] **Real canteen seeding**: replace the placeholder "NoQx Demo
      Canteen" with the actual first partner. Admin dashboard →
      Canteens → Edit. Set `is_open = false` until launch moment.

## T-1 day

- [ ] **Razorpay live keys** to Railway:
      1. Railway production → Variables
      2. Edit: `RAZORPAY_KEY_ID` → `rzp_live_XXXX`
      3. Edit: `RAZORPAY_KEY_SECRET` → live secret
      4. Edit: `RAZORPAY_WEBHOOK_SECRET` → live webhook secret
      5. Edit: `PAYMENT_TEST_MODE` → `false`
      6. Click "Deploy" to redeploy with the new vars
      7. Wait 90 sec
      8. `node scripts/verify-razorpay-flow.mjs` → "razorpay LIVE keys
         deployed" must be ✓
- [ ] **Razorpay webhook URL** in Razorpay dashboard:
      Razorpay → Webhooks → Add: `https://noqx.co.in/api/payments/razorpay-webhook`
      Sign secret = whatever you put in `RAZORPAY_WEBHOOK_SECRET`.
      Subscribe to: `payment.captured`, `payment.failed`, `refund.processed`.
- [ ] **Real ₹1 order test**: from your phone, sign in as a real student
      account, add a ₹1 item, place order with a real UPI / card.
      Confirm:
        - Razorpay dashboard shows the payment captured
        - Order shows in vendor dashboard for the canteen
        - OTP works
        - Order completes (vendor marks ready → student OTP collects)
- [ ] **₹1 refund test**: cancel the order from vendor dashboard. Confirm
      refund hits Razorpay dashboard within 60 sec.
- [ ] **Mobile build**: trigger PRODUCTION-environment build of both
      Student + Worker APKs. See `docs/CAPACITOR_PRODUCTION_FLIP.md`.
- [ ] **App store submission** to Internal / TestFlight only — full
      production track on launch day after first-hour smoke.

## Launch day — minute-by-minute

### T-2h
- [ ] **Open all dashboard tabs in browser**:
      Railway, Supabase, Cloudflare, Razorpay, Resend, UptimeRobot
- [ ] **Re-run smoke test**: 19/19 + 5/5 Razorpay flow
- [ ] **Confirm tomorrow's slots exist**: super-admin → Canteens →
      <real canteen> → Slots tab → at least 5 hours of slots visible
- [ ] **Pre-position on-call**: confirm operator is on standby phone +
      laptop, not in transit
- [ ] **Quiet your inbox**: pause newsletters / non-urgent notifications;
      Razorpay + UptimeRobot emails must stand out

### T-1h
- [ ] **Last code freeze**: any deploy after this requires a full
      rollback rehearsal first
- [ ] **UptimeRobot armed**: monitor `noqx.co.in` is ACTIVE, alert to
      darshan849696@gmail.com
- [ ] **Mobile keystore backup**: confirm `~/noqx-keystores/` zipped
      backup still in OneDrive (check timestamp)
- [ ] **Print this runbook** (or have a phone with it open)

### T-15min
- [ ] **Final smoke test** + **Razorpay verify**
- [ ] **Tell the canteen**: "We're flipping live in 15 minutes — no
      orders accepted until I confirm"
- [ ] **Have a test student account ready** on your personal phone

### T-0 (launch)
- [ ] Super-admin dashboard → Canteens → real canteen → toggle
      `is_open = true` → Save
- [ ] **Verify**: open noqx.co.in/login in a clean incognito → log in as
      test student → confirm the canteen appears in the list with
      "OPEN" indicator
- [ ] **Place a real ₹X order** (yourself, real money) → confirm it
      flows through the full lifecycle
- [ ] **Tell the canteen + ops team**: "We are live."

### T+15min
- [ ] **Watch Razorpay dashboard**: any failed payments? (Failed/Created
      ratio under 5% is normal; over 20% means something is wrong)
- [ ] **Watch Railway logs**: any 5xx errors? Tail with the Railway CLI
      or dashboard
- [ ] **Watch Supabase**: live queries showing reasonable load

### T+1h
- [ ] **Customer pulse**: WhatsApp/call one or two real customers — was
      the experience smooth? Any confusion?
- [ ] **Resend dashboard**: confirm transactional emails (welcome,
      order confirmation) actually delivered. Bounce rate under 2%
- [ ] **First metrics**: `node scripts/launch-day-stats.mjs` (next
      todo) → orders placed, revenue, errors, signup count

### T+4h
- [ ] **Step down to "passive monitoring"**: dashboards stay open but
      you can step away from the laptop. UptimeRobot will email if
      anything dies.

### T+24h
- [ ] **Daily summary**: gather the stats. Share with stakeholders.
- [ ] **Triage any complaints** before they become refund disputes
- [ ] **Database backup verify**: Supabase Pro should have run a backup
      overnight — confirm in dashboard

---

## Rollback triggers (any of these → execute ROLLBACK_RUNBOOK)

- Site returning 5xx for >2 minutes on any production route
- Payment failure rate >20% over a 5-minute window
- Multiple customers report "order placed but no confirmation"
- DB queries taking >10 seconds (look in Supabase → Reports)
- Razorpay flagged for fraud (rare but possible)

When in doubt, **rollback first, diagnose second**.

---

## Communication templates

### "We're live"
> 🎉 NoQx is officially live at https://noqx.co.in. Students can now
> place orders for pickup. First canteen: <name>. If you spot any issues,
> ping @joshuajoejj11 immediately.

### "Bumpy moment"
> Quick heads-up — we're seeing <symptom> on production. Investigating
> now. Expected fix within <X> minutes. Orders may be delayed but no
> data has been lost.

### "Rollback"
> ⚠️ Rolled production back to the previous version due to <reason>.
> Root cause being investigated. Service is restored. Please re-place
> any orders that failed in the last <X> minutes; refunds for
> already-paid orders are in-flight.

### "All good — closing the watch"
> 🟢 24-hour launch window complete. <X> orders, <Y> students,
> <Z>% payment success rate. Stepping out of active monitoring. The
> on-call rotation kicks in normally from tomorrow.

---

## Things you'll forget

- The `apk` you ship can NEVER be downgraded. Pick the version code
  carefully (see `docs/CAPACITOR_PRODUCTION_FLIP.md`).
- Razorpay settlement is T+2 for cards, T+3 for net banking. Don't
  expect bank balance to move on day 1.
- Push notifications are still disabled (FCM not configured). Customers
  WILL ask "why didn't I get notified" — they have to refresh the app.
  Re-enable via `docs/FCM_REENABLEMENT.md` post-launch.
- The "Demo Canteen" entry is still in the DB at id
  `7e431e40-44e8-4c66-ac6a-d60f47f343c4`. Set `is_hidden = true` so
  students don't see it.

---

## Post-launch retro (T+7d)

Schedule a 30-min self-retro:
1. What went smoothly?
2. What surprised you (good or bad)?
3. Which step in this runbook was unclear or missing?
4. Update this doc and `OPERATOR_CHEAT_SHEET.md` with the learnings.

The runbook gets better with each launch. Treat it as living.

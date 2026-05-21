# Resend email — dry-run / template verification

5-minute pre-launch check that email actually delivers to real inboxes
with correct rendering. Run once now + once on launch morning.

## Templates to test

| Template | How to trigger | What to check |
|---|---|---|
| **Password reset (OTP)** | https://noqx.co.in/login → "Forgot password" → enter your real email | OTP displays as 6-digit code (not URL) — verified template in Resend dashboard 2026-05-20 |
| **Welcome / signup confirmation** | Sign up a new student via student app or web | Renders correctly, no broken `{{ }}` placeholders |
| **Order confirmation** | Place a test order (needs Razorpay test mode OR mock — currently deferred until live keys) | Order ID, amount, slot, OTP all populated |
| **Cancellation + refund** | Cancel an order from staff dashboard | Refund amount, reason, ETA wording correct |

## Step-by-step (Password reset — most important, also tests deliverability)

1. **Pick a real email you can read.** Your own gmail (`darshan849696@gmail.com`)
   works. The admin@noqx.co.in account is registered but not a real mailbox —
   you can't read it.
2. **Need a test student profile with that email.** Production currently only
   has `admin@noqx.co.in` (super_admin). Two options:
   a. Sign up a fresh student via https://noqx.co.in/login using darshan849696@gmail.com
   b. Or have me create a profile + auth row via Supabase admin API for that email
3. **Trigger password reset.** https://noqx.co.in/login → "Forgot password" tab →
   enter `darshan849696@gmail.com` → submit
4. **Check inbox.** Email should arrive within 30 seconds. Look at:
   - **From** = `NoQx <noreply@noqx.co.in>` (not `onboarding@resend.dev` or similar)
   - **Subject** = `Reset Your Password`
   - **Body** renders cleanly (no broken HTML, no `{{ .placeholder }}` strings)
   - **6-digit code** is large and readable
5. **Cross-check in Resend dashboard.** https://resend.com/emails → confirm
   the send shows status **Delivered** (not just "Sent"). Bounce/complaint
   notifications also surface here.

## What to look for (red flags)

| Symptom | What it means | Fix |
|---|---|---|
| Email lands in Spam | DKIM/SPF/DMARC not aligned | Check Cloudflare DNS records match what Resend dashboard expects under "Domains" |
| Email never arrives | Either Resend rejected (bad domain auth) or recipient inbox blocked | Resend dashboard → Logs → look for the attempt |
| Body shows raw `{{ .Token }}` or similar | Email template variables not substituting | Supabase Auth → Email Templates → confirm the template uses Supabase's `{{ .Token }}` format (mustache-style) |
| From shows `onboarding@resend.dev` | Default sender not overridden | Supabase Auth → Settings → SMTP Settings → confirm sender = `noreply@noqx.co.in` |
| Wrong domain in reset link | Site URL is stale | Already fixed 2026-05-20 — Supabase Site URL = `https://noqx.co.in` |

## Other templates (test alongside)

Same path for each — trigger the action, check inbox, cross-check in Resend dashboard:

- **Order confirmation** — needs Razorpay live keys to test fully; defer until those are set up
- **Refund email** — same
- **Welcome / signup** — test by creating a new student account end-to-end

## Domain authentication status (already verified)

Cloudflare DNS as of 2026-05-21 has:
- MX `send` → Resend (for inbound, mostly unused)
- TXT `resend._domainkey` (DKIM)
- TXT `send` (SPF v=spf1 include:...)
- TXT `_dmarc` (DMARC policy)

These were imported automatically when we moved nameservers to Cloudflare.
Verify with Resend dashboard → Domains → `noqx.co.in` should show all green.
If any record is red/yellow, surface to me and I'll fix.

## Quick check from CLI (no email actually sent — just verifies auth path works)

```bash
node scripts/smoke-test-prod.mjs https://noqx.co.in
# 14/14 should pass; the Resend pipeline isn't directly tested but the
# legal-page footer links (which reference noqx.co.in) all return 200.
```

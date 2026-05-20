# NoQx On-Call Runbook — 1-Page Quick Reference

**When the app is down or misbehaving, work top→bottom. Stop at the step that fixes it.**

---

## 0. First 30 seconds — confirm scope

Open https://noqx.co.in/ in incognito on your phone (mobile data, not Wi-Fi).

| What you see | Likely cause | Skip to |
|---|---|---|
| Site loads, looks fine | False alarm (UptimeRobot blip / your network) | Done |
| `502 Bad Gateway` or timeout | Your app/container crashed | §2 |
| `523/525` Cloudflare error | Cloudflare → origin handshake broken | §3 |
| Cloudflare "Origin Unreachable" | Railway is down | §4 |
| Loads but shows error after login / payment | Code bug or DB issue | §5 |

**Trigger:** UptimeRobot email + own observation. Acknowledge ASAP — silence breeds panic.

---

## 1. Tell the world (within 2 min, in parallel with everything else)

- WhatsApp group / Slack: "We're seeing issues at noqx.co.in — investigating, ETA <X> min."
- If outage > 15 min: stop accepting orders in vendor dashboard (toggle canteen `is_open = false`).
- If payments captured but orders broken: log into Razorpay → start refund-on-demand for affected `pay_*` IDs to avoid chargebacks (₹500/dispute).

---

## 2. Your app/container crashed (502 from Cloudflare)

Open Railway dashboard → production → service:
1. **Deployments tab** → look at the latest deployment status.
   - **Failed?** → click previous green deployment → **Redeploy**.
   - **Active but crashing?** → **Logs** tab → look for stack trace.
2. **Common crashes & fixes:**
   - `OOMKilled` → bump Memory in Settings (current default is fine for low traffic; bump if needed)
   - `ENV not defined` → Variables tab → confirm all required vars set (compare against [[launch-readiness]] §1)
   - JS exception in route → revert the latest commit: `git revert HEAD && git push origin dev:dev && git push origin dev:main`
3. **No clear cause?** → Settings → **Restart** the service. Solves ~30% of mystery crashes.

---

## 3. Cloudflare 5xx (523 / 525 / 526)

These mean Cloudflare can't talk to Railway (or SSL handshake broke).

1. Cloudflare dashboard → **SSL/TLS** → confirm mode is **Full** (not Flexible — Flexible breaks Railway).
2. Cloudflare → **Overview** → check for any "Origin Unreachable" alert.
3. Try the Railway-direct URL: `curl -I https://canteenapplication-production.up.railway.app/`
   - **Returns 200** → Cloudflare-side issue, wait 5-15 min or open Cloudflare ticket
   - **Returns 5xx** → it's the origin (Railway). Go to §2 or §4.

---

## 4. Railway is wholly down (rare, ~1% case)

1. Check https://status.railway.com — is the incident acknowledged?
2. If yes and ETA > 1 hour: execute the cold-recovery procedure in [docs/RAILWAY_DISASTER_RECOVERY.md](RAILWAY_DISASTER_RECOVERY.md):
   - Spin up Hetzner CX22 (€4.51/mo, 10 min)
   - Install Coolify on it (10 min)
   - Deploy from this repo with prod env vars (15 min)
   - Cloudflare → DNS → change `@` CNAME to point at Hetzner IP (5 min)
3. If yes and ETA < 1 hour: just wait. Customers won't notice if you've told them already (§1).

---

## 5. App loads but features break

| Symptom | Likely cause | Fix |
|---|---|---|
| Login fails for everyone | Supabase down | Check https://status.supabase.com — wait it out |
| Payment "captured but order not saved" | Webhook timeout or DB write failed | Razorpay dashboard → refund the `pay_*` manually; log issue for code fix later |
| QR scan camera doesn't open (mobile) | Camera permission denied | User → app settings → enable camera. Or send `~/Canteen_Application/mobile-worker/scripts/patch-camera-permission.sh` reminder |
| OTP not arriving by email | Resend down or Site URL wrong | Check Resend dashboard → Logs. Verify Supabase Site URL = `https://noqx.co.in` |
| "Item just sold out" on every order | Inventory cap stuck | Vendor → Inventory tab → reset `quantity_per_slot` or `total_per_day` on the affected items |

---

## 6. Key dashboards (bookmark these on your phone)

| Service | URL | What to check |
|---|---|---|
| Railway prod | https://railway.com/project/9ecacfbc-a63e-4962-b2e7-69565b15b131 | Service health, logs, env vars, redeploy |
| Cloudflare | https://dash.cloudflare.com → noqx.co.in | DNS, SSL, proxy status |
| Supabase prod | https://supabase.com/dashboard/project/dpycfyeiyhzvwbythcrp | DB, auth users, query editor |
| Resend | https://resend.com → Emails | Email delivery logs |
| Razorpay | https://dashboard.razorpay.com → Payments | Refunds, webhook status, disputes |
| UptimeRobot | https://dashboard.uptimerobot.com | Monitor history, incident list |
| GitHub Actions | https://github.com/DH72367259/Canteen_Application/actions | CI status, redeploy via workflow |
| Status pages | https://status.railway.com, https://status.supabase.com, https://status.razorpay.com | Vendor incidents |

---

## 7. Escalation

- **You can't fix it within 30 minutes** → activate DR cold-recovery (§4) regardless of cause
- **Cause is unknown after 60 minutes** → post in vendor Slack, ask any technical contact for help
- **Multiple vendors are down simultaneously** → almost certainly a platform (Railway / Supabase / Cloudflare) issue, not yours; wait + communicate
- **You're not sure if it's safe to revert** → revert. A revert is reversible; a customer-facing outage is not.

---

## 8. Post-incident (within 24 hours)

Write 4-5 lines in a free-form doc:
- What broke
- What you saw
- What you did
- What worked / didn't
- What you'd change

This compounds — over time it becomes the playbook.

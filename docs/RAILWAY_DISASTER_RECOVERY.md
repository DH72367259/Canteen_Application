# Railway Disaster Recovery — NoQx Canteen Application

Strategy chosen 2026-05-20: **Stay Railway-only + monitor + cold Coolify recovery**.

Why: running a parallel "warm" backup on Coolify doubles the operational burden
(VPS upkeep, env-var drift, DB sync, etc.) for a single-operator team. Railway's
SLA + a tested recovery path is the right cost/risk trade for the launch phase.
Reevaluate at scale.

---

## 1. Real-time monitoring (set up before launch)

### UptimeRobot — free, 5-minute setup

1. Sign up at https://uptimerobot.com (free tier = 50 monitors, 5-min intervals)
2. **Add New Monitor:**
   - Type: HTTP(s)
   - URL: `https://canteenapplication-production.up.railway.app/`
   - Friendly Name: `NoQx Production`
   - Monitoring Interval: 5 minutes (free tier)
3. **Alert Contacts** → add operator phone (SMS) + email
4. Repeat for `https://canteenapplication-staging.up.railway.app/` (lower priority)
5. Optional: add monitors for `/api/health` (if/when we add a healthcheck endpoint)

Result: operator gets SMS within 5-10 min if the production URL goes down.

### Better Stack (paid alternative, $25/mo+)
Better Stack adds 30-second intervals, on-call rotations, and incident management.
Worth it once you have multiple operators sharing on-call.

### Railway's own dashboard alerts
Railway sends email alerts on deploy failures + crash loops. Enable in
Railway dashboard → Project Settings → Notifications. Free.

---

## 2. Pre-incident preparation (do once, never touch)

### a. Build a known-good Docker image that runs anywhere

Add a `Dockerfile` to the repo root (does NOT replace Railway — runs alongside):

```dockerfile
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps

FROM node:20-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
EXPOSE 3000
CMD ["npm", "start"]
```

That single Dockerfile is the recovery contract. Railway builds it; Coolify can
build it; your laptop can build it; any container host can run it.

### b. Snapshot critical env vars to a sealed file

Once. Don't commit it. Store in 1Password as "NoQx — Production Env Vars":

```
NEXT_PUBLIC_SUPABASE_URL=https://...
NEXT_PUBLIC_SUPABASE_ANON_KEY=ey...
SUPABASE_SERVICE_ROLE_KEY=ey...
RAZORPAY_KEY_ID=rzp_live_...
RAZORPAY_KEY_SECRET=...
RAZORPAY_WEBHOOK_SECRET=...
APP_BASE_URL=https://canteenapplication-production.up.railway.app
DISABLE_GST=false
```

If Railway dies, you paste these into Coolify and you're 80% of the way there.

### c. DNS pre-positioning

If/when you move to your real domain (noqx.co.in), point it at Cloudflare. That
gives you 5-minute DNS TTLs and the option to flip the origin to Coolify in
seconds when needed. **While you're on `*.up.railway.app`, you can't fail over
DNS — Railway owns that subdomain.**

So: the cold-recovery procedure below assumes you've moved to a custom domain
on Cloudflare. Otherwise step 4 below means re-distributing a new URL to
clients, which is much slower.

---

## 3. The 2-hour recovery runbook (Railway is down, customers are angry)

**Trigger:** UptimeRobot says production has been down >15 min AND Railway
status page (https://status.railway.com) confirms a regional/global incident.

### Step 1: Confirm it's actually Railway (5 min)
- `curl -I https://canteenapplication-production.up.railway.app/` — confirm
  it's the host, not your code (a 5xx from the URL = your code; timeout =
  Railway).
- Check https://status.railway.com — if green, it's likely your service
  specifically (failed deploy, OOM, hit a limit) and you don't need to
  fail over. Restart from Railway dashboard.

### Step 2: Spin up Hetzner VPS + Coolify (30 min)
- Sign up at https://hetzner.com → Cloud → New Project → "noqx-recovery"
- Create CX22 server (€4.51/mo, 2 vCPU, 4 GB RAM, Frankfurt or Singapore)
- SSH in: `ssh root@<ip>`
- Install Coolify (one command, official):
  ```bash
  curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
  ```
  Takes ~10 min. Open `http://<ip>:8000` in browser → set admin password.

### Step 3: Deploy your app on Coolify (45 min)
In Coolify UI:
- **Sources → Add → GitHub** → connect via OAuth, select `Canteen_Application`
- **Resources → New → Application → Public Repository**
- Repository: `https://github.com/DH72367259/Canteen_Application`
- Branch: `main`
- Build Pack: Dockerfile (Coolify detects the one you committed)
- **Environment Variables**: paste from your 1Password sealed env file
- Deploy → wait ~5-10 min for first build

### Step 4: Flip DNS (10 min)
If you're on a custom domain via Cloudflare:
- Cloudflare dashboard → DNS → edit A record for `noqx.co.in`
- Change to Hetzner VPS IP
- 5-min TTL means propagation in <10 min

If you're still on `canteenapplication-production.up.railway.app`:
- You can't fail over the URL. Either:
  - Wait for Railway to come back (usually <2 hr)
  - Stand up Coolify on a new URL (e.g., `recovery.yourdomain.com`) and tell
    customers manually
- This is why getting on a custom domain BEFORE launch matters.

### Step 5: Verify (15 min)
- Open new URL in incognito → can place test order?
- Check `/api/canteens/colleges` returns data
- Razorpay webhook (in Razorpay dashboard, update the webhook URL temporarily)
- Notify clients via WhatsApp / Slack: "We hit a hosting incident, we're back."

### Step 6: Failback (when Railway recovers)
- Railway comes back → DNS flip back to Railway IP
- Tear down Hetzner VPS (or keep at €4.51/mo as cold standby for next time)
- Post-mortem: what failed, what worked, what to improve.

---

## 4. What this strategy explicitly does NOT protect against

- **Supabase outage.** If Supabase goes down, neither Railway nor Coolify saves
  you — your DB is unreachable. Mitigation: monitor https://status.supabase.com
  and have Supabase Pro tier (better SLA + read-replica options).
- **Razorpay outage.** Same: payments pause, orders can't be placed. Mitigation:
  set up COD as a manual fallback before launch.
- **DNS outage (Cloudflare).** Cloudflare's SLA is better than Railway's, so
  this isn't worth a backup plan.
- **First-time Coolify users:** the runbook assumes you've done the setup once
  in calm conditions, not under incident pressure. **Practice it once before
  going live** — spin up a throwaway VPS, run the recovery, tear it down.

---

## 5. Annual review checklist

Once a year (or after a real incident):
- [ ] Test the runbook end-to-end on a throwaway VPS
- [ ] Update the 1Password env vars file if anything changed
- [ ] Update the Dockerfile if Node/Next versions changed
- [ ] Reassess: at what scale does a warm-standby Coolify become worth it?
      (Usually around the point you'd hire a part-time devops, or >5k DAU.)

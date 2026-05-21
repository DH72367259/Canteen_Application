# NoQx Rollback Runbook

**When a deploy breaks production, work top→bottom. Stop at the step that
restores service.** Pair with ON_CALL_RUNBOOK.md for full incident response.

> **Default response on launch day: rollback first, diagnose second.**
> A 2-minute revert beats a 20-minute fix attempt under stress.

---

## 0. Decide: rollback or fix-forward?

| Symptom | Default action |
|---|---|
| Site returning 500/502 on most routes | **Rollback** |
| Login broken, payments broken, or order placement broken | **Rollback** |
| One non-critical page broken (e.g. /shipping renders ugly) | **Fix-forward** (Edit + push) |
| Mobile app crashes on launch | **Rollback web** + push native hotfix |
| DB migration applied that broke a column | **STOP — see §3** (different procedure) |

Rule of thumb: if the issue blocks **placing or paying for orders**, rollback.

---

## 1. Rollback the web app (Railway)

This is the fastest path. ~60 seconds end-to-end.

### Option A: Railway dashboard (preferred — no git knowledge needed)

1. Open https://railway.com → project → **production** environment → app service
2. Click the **Deployments** tab
3. Find the most recent **green** deployment BEFORE the bad one (date/time column)
4. Click the `⋮` menu → **Redeploy**
5. Wait ~45 sec → Cloudflare will see the origin again

Verify: `curl -I https://noqx.co.in/` returns `200`.

### Option B: Git revert (if you also want to remove the bad commit from history)

```bash
# From a local checkout of the repo:
git fetch origin
git checkout main
git revert HEAD --no-edit            # creates a revert commit
git push origin main                  # Railway auto-redeploys
git push origin main:dev              # keep dev in sync
```

If the bad change spans multiple commits:
```bash
git revert <oldest-bad-commit>..HEAD --no-edit
```

⚠️ Do **NOT** `git push --force` or `git reset --hard` on main. Always use
`git revert` so the bad commit stays in history (needed for post-mortem).

---

## 2. Rollback the mobile apps

Mobile apps are downloaded once, so a "rollback" means **pushing a fixed
version through the same store** AND using the in-app UpdateGate to force
users onto it.

1. Fix the underlying issue in the codebase (or revert via §1).
2. Bump version in BOTH:
   - `package.json` → `version` field
   - `android/app/build.gradle` → `versionCode` + `versionName`
   - `ios/App/App.xcodeproj` → MARKETING_VERSION + CURRENT_PROJECT_VERSION
3. Build + sign (via existing GitHub Actions workflows: `android-internal.yml`,
   `android-worker-internal.yml`, `ios-testflight.yml` — pick `production`
   environment).
4. Upload AAB to Play Console internal track, IPA to TestFlight.
5. **Force the rollout** — UpdateGate is configured via env var
   `MIN_REQUIRED_APP_VERSION`. Bump this in Railway env vars to the new
   version. Existing apps on the broken version will see the forced
   update screen on next launch.

Time: ~30 min (build) + 1-4 hours (store review for production track).
For TestFlight + Play Internal, much faster — ~30 min total.

---

## 3. Rollback a database migration

⚠️ **The hardest case.** Production currently has NO automated backups
(Supabase Free tier). Treat DB rollback as a manual surgical procedure
until [[launch-readiness]] §1 backups is resolved.

### Step-by-step

1. **STOP all writes immediately.** Toggle each canteen `is_open = false`
   via the super-admin dashboard OR via SQL in Supabase SQL Editor:
   ```sql
   UPDATE public.canteens SET is_open = false WHERE id IS NOT NULL;
   ```
   This stops new orders from arriving while you fix the schema.

2. **Identify the bad migration.** Open `supabase/migrations/` — the
   most recent file is usually the culprit.

3. **Write the reverse SQL manually.**
   - If the bad migration was `ADD COLUMN x`, reverse is `DROP COLUMN x`
     (but this is data-destructive if anything wrote to it).
   - If it was `DROP COLUMN y`, you cannot reverse without backup data.
     → Restore latest snapshot (see §3.5).
   - If it was a constraint change, drop the constraint:
     `ALTER TABLE ... DROP CONSTRAINT ...`

4. **Apply the reverse** in Supabase SQL Editor:
   - https://supabase.com/dashboard/project/dpycfyeiyhzvwbythcrp/sql/new
   - Paste reverse SQL, hit Run.

5. **Revert the migration file** in git so the next deploy doesn't
   re-apply the bad migration: `git revert <migration-commit>`.

6. **Re-open canteens:** `UPDATE public.canteens SET is_open = true ...`

### §3.5 Restoring from backup

- **If on Supabase Pro:** Dashboard → Database → Backups → Restore from
  most recent. ~5-10 min restore time. ⚠️ This is destructive — overwrites
  current state. Communicate clearly that all orders/data since the
  backup snapshot are LOST.
- **If still on Free tier:** No backups exist. Recovery options:
  (a) write the data back from Razorpay payment ledger
  (b) accept data loss and notify customers

**This is why [[launch-readiness]] §1 marks "Backups" as a launch-blocker.**
Do not launch with real customer money without resolving this first.

---

## 4. Rollback an env var change

Common cause: someone updated `RAZORPAY_KEY_SECRET` or `NEXT_PUBLIC_*`
and now things break.

1. Railway dashboard → production → **Variables** tab
2. Click the changed variable → **Edit** → revert to previous value
3. Click **Deploy** to restart (env changes need a redeploy to take effect)
4. Verify: trigger the broken flow + watch Railway logs

⚠️ Cloudflare proxies the env-stale state briefly. Wait 60 sec or
purge Cloudflare cache from Caching tab.

---

## 5. Communication template

After rolling back, immediately:

**WhatsApp / Slack to operator group:**
```
✅ Production rolled back. Issue: <one-line description>.
   Reverted to: <Railway deployment ID> / <git commit SHA>.
   Verified working: <noqx.co.in/login + place test order>.
   Root cause TBD — post-mortem to follow.
```

**If customer-facing (orders affected):**
- Direct WhatsApp to affected customers (use orders.user_id → profiles.phone)
- Apologize + confirm refund initiated in Razorpay (if applicable)

---

## 6. Post-rollback checklist (within 24 hours)

- [ ] Write post-mortem in docs/POSTMORTEM_<date>.md (root cause, timeline,
      what we learned, what to change to prevent recurrence)
- [ ] Add a regression test for the failure mode
- [ ] Re-attempt the original change with the fix included
- [ ] Update this runbook if the rollback procedure was unclear/missing
      a step

---

## Quick reference card

| Action | Time | Where |
|---|---|---|
| Railway redeploy previous | 45 sec | Railway dashboard → Deployments |
| Git revert + push | 90 sec | Local terminal |
| Env var rollback | 60 sec | Railway → Variables |
| DB schema rollback | 5-15 min | Supabase SQL Editor (manual) |
| DB data restore from backup | 10 min | Supabase → Backups (Pro only) |
| Mobile force-update | 30 min build + 1-4h review | GitHub Actions + stores |

**Bookmark these:**
- Railway prod: https://railway.com/dashboard
- Supabase SQL: https://supabase.com/dashboard/project/dpycfyeiyhzvwbythcrp/sql/new
- Cloudflare: https://dash.cloudflare.com/.../noqx.co.in
- UptimeRobot: https://uptimerobot.com/dashboard

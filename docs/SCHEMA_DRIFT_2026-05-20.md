# Schema-drift report — staging vs production Supabase

**Generated:** 2026-05-20 via `node scripts/verify-schema.mjs`

**Staging:** `https://uerocbtzgpmtckskzmyj.supabase.co`
**Production:** `https://dpycfyeiyhzvwbythcrp.supabase.co`

## Summary

| Table | Status |
|---|---|
| profiles | ⚠️ drift |
| canteens | ⚠️ drift |
| menu_items | ⚠️ drift |
| 17 other tables | ✅ match |

## Details

### `profiles`
- **Only in staging:** `avatar_url`, `updated_at`
- **Only in production:** `password_notified_at`

**Impact:**
- `avatar_url` — student avatar feature works staging-only. Reads will return `null` in prod silently.
- `updated_at` — audit timestamps for profile changes track only in staging.
- `password_notified_at` — password expiry cron tracks notification only in prod (the cron's source-of-truth column).

### `canteens`
- **Only in staging:** `location`

**Impact:** any location-based feature (distance sort, nearest canteen) works staging-only.

### `menu_items`
- **Only in staging:** `cancelled_quantity`, `production_type`, `updated_at`

**Impact:**
- `cancelled_quantity` — used by the partial item-cancel flow in `app/api/orders/[id]/items/[itemId]/cancel/route.ts`. Code has a graceful-degradation fallback (`lib/menuItemCapacity.ts` retries query without the column on error), so the flow works in prod but won't accurately track partial cancellations against inventory caps.
- `production_type` — purpose unknown without further investigation. Likely a flag for batched-prepared vs made-to-order categorization.
- `updated_at` — same as profiles; audit timestamps.

## Recommended migration to unify

Bring **production up to staging's schema** for everything except `password_notified_at` (which should stay in prod and be added to staging):

```sql
-- Run against PRODUCTION (dpycfyeiyhzvwbythcrp):
ALTER TABLE public.profiles    ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE public.profiles    ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
ALTER TABLE public.canteens    ADD COLUMN IF NOT EXISTS location  text;
ALTER TABLE public.menu_items  ADD COLUMN IF NOT EXISTS cancelled_quantity int DEFAULT 0;
ALTER TABLE public.menu_items  ADD COLUMN IF NOT EXISTS production_type    text;
ALTER TABLE public.menu_items  ADD COLUMN IF NOT EXISTS updated_at         timestamptz DEFAULT now();

-- Run against STAGING (uerocbtzgpmtckskzmyj):
ALTER TABLE public.profiles    ADD COLUMN IF NOT EXISTS password_notified_at timestamptz;
```

All non-destructive (`ADD COLUMN IF NOT EXISTS` + `DEFAULT`s where helpful). Safe to apply to a live production DB — no table rewrites, no locks beyond the metadata change.

## How to apply

Supabase dashboard → SQL Editor → paste the production block → Run. Repeat for staging with the staging block. Then re-run `node scripts/verify-schema.mjs` and confirm 0 drift.

## Why this wasn't caught earlier

Migrations were applied piecemeal across sessions. There's no single `supabase/migrations/` source of truth that both environments must match — each env was migrated through manual SQL editor runs. Once both envs are aligned, consider:
- Adopting Supabase CLI migrations (`supabase migration new ...`) so future drift is impossible
- Running `node scripts/verify-schema.mjs` as a CI step on every PR

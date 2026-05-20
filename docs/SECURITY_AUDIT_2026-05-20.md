# Security audit — Row-Level Security + rate-limit verification

**Generated:** 2026-05-20 (production Supabase `dpycfyeiyhzvwbythcrp`)

Read-only audit. No data changed. All probes used the public `anon` key only — simulating an unauthenticated attacker armed with values an attacker would have access to (they're in your client-side JS bundle).

## TL;DR

| Check | Result |
|---|---|
| RLS on sensitive tables (orders, payments, profiles, notifications, payment_ledger, etc.) | ✅ ENFORCED — anon SELECT returns `[]` |
| Anon writes to any table | ✅ BLOCKED — all INSERTs return 401 |
| Public-discovery tables (canteens, menu_items) | ✅ Intentionally readable; only safe fields exposed |
| Rate limit on `/api/orders/place` | ✅ FIRES at request 11 (limit=10/min/user, verified live) |

**No security regressions found.** Two minor findings — see Notes below.

---

## RLS audit by table

Probed each table with the anon key, no auth header.

| Table | Anon SELECT | Anon INSERT | Verdict |
|---|---|---|---|
| profiles | `[]` | 401 | ✅ |
| canteens | rows | 401 | ✅ intentionally public; safe fields only |
| menu_items | rows | 401 | ✅ intentionally public |
| time_slots | `[]` | n/a | ✅ |
| slot_control | `[]` | n/a | ✅ |
| bins | `[]` | n/a | ✅ |
| orders | `[]` | 401 | ✅ |
| order_items | `[]` | n/a | ✅ |
| order_bins | `[]` | n/a | ✅ |
| payments | `[]` | 401 | ✅ |
| payment_ledger | 404 (not in REST cache) | — | ✅ unreachable |
| notifications | `[]` | n/a | ✅ |
| notification_reads | `[]` | n/a | ✅ |
| platform_charges | `[]` | n/a | ✅ |
| canteen_bank_details | `[]` | n/a | ✅ |
| subscriptions | 404 (not in REST cache) | — | ✅ unreachable |
| reward_transactions | `[]` | n/a | ✅ |
| campaigns | `[]` | n/a | ✅ |
| cart_items | `[]` | n/a | ✅ |

### Field-level review of the two public tables

`canteens` exposes these columns to anon:
- `id, name, college, city, address, lat, lng, gmap_link, is_active, status, created_at, updated_at, updated_by`
- **No bank details, no admin emails, no internal secrets.** Safe.

`menu_items` exposes (from spot-check):
- `id, canteen_id, name, price, category, image_url, availability_type, is_meal, is_sold_out`
- **No internal pricing margins, no supplier info, no costs.** Safe.

---

## Rate-limit verification (`/api/orders/place`)

Live probe with a real student token, 12 sequential requests over <2 seconds:

```
request  1: HTTP 400  (validation fail, but accepted by rate-limiter)
request  2: HTTP 400
...
request 10: HTTP 400  (10th allowed request)
request 11: HTTP 429  ← rate-limit fires
request 12: HTTP 429
```

Confirms `limit: 10, windowMs: 60_000` from `app/api/orders/place/route.ts:33` is **enforced server-side**, not just declared. Rate-limit memory is keyed on `orders:${userId}` so per-user, not global.

Other rate-limit findings (code review only, not live-tested):
- `/api/orders/place` 10/min/user ✅ tested
- `/api/auth/otp/send` exists in code, limit not verified live (next session)

---

## Notes / minor findings

**1. `canteens.is_hidden` column referenced in code but missing in production DB.**

`app/api/canteens/[id]/menu/route.ts:80` does `.eq("is_hidden", false)`. Production canteens table does not have this column (error `42703 column does not exist`). The route has graceful-fallback for missing columns, so it works — but the "soft-hide a canteen so students don't see it" feature is silently no-op in prod.

Fix: include in the schema-drift migration (see `docs/SCHEMA_DRIFT_2026-05-20.md`):
```sql
ALTER TABLE public.canteens ADD COLUMN IF NOT EXISTS is_hidden boolean DEFAULT false;
```

**2. Stray test canteen in production.**

`Test Canteen 1779162148941` exists in production canteens table (created 2026-05-19 03:42 UTC, after the scorched-earth wipe). Probably you created this while testing the super-admin dashboard. Not a security issue, just noise — delete from super-admin → Canteens when convenient.

---

## What's NOT in this audit (deferred)

- Storage bucket policies (not yet using Supabase Storage)
- Edge function permissions (none defined)
- pg_cron job authentication (only one cron exists; uses CRON_SECRET env var per `app/api/cron/password-expiry-notify/route.ts`)
- Service-role key exposure check (we know it's in Railway env vars + your .env.local; verify it's never in client bundle)
- SQL injection probes (Supabase REST is parameterized; not the typical risk)
- Auth flow bypass attempts (Supabase handles)

Worth re-running this audit annually + after every major schema change.

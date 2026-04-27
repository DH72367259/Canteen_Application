-- =====================================================================
-- NoQx — Wipe all transactional + content data (KEEPS schema + super_admin)
-- Run this once in Supabase SQL Editor when you want a truly clean slate.
-- =====================================================================
-- Order matters: child tables first, parents last.
-- Auth users are kept; only the `profiles` rows for non-admins are removed.
-- The single super_admin row is preserved so you can still log in.
-- =====================================================================

begin;

-- ── Transactional data ──────────────────────────────────────────────
truncate table
  wallet_transactions,
  settlement_payments,
  noqx_pro_subscriptions,
  waste_reports,
  notifications,
  bins,
  orders
restart identity cascade;

-- ── Content / catalog ───────────────────────────────────────────────
truncate table
  menu_items,
  slot_control,
  canteen_bank_details,
  canteens
restart identity cascade;

-- ── Profiles: keep only super_admin row(s) ──────────────────────────
delete from profiles where role <> 'super_admin';

-- ── Auth users: keep only those whose profile remains (super_admin) ─
delete from auth.users
where id not in (select id from profiles);

-- ── Reset the platform_charges to a single safe default row ─────────
delete from platform_charges;
insert into platform_charges (charge_pct, flat_charge, gst_pct)
values (2.00, 0.00, 18.00);

commit;

-- =====================================================================
-- Verify: every count below should be 0 except `profiles` and
-- `platform_charges` (each = 1).
-- =====================================================================
select 'canteens'                as t, count(*) from canteens
union all select 'menu_items',           count(*) from menu_items
union all select 'orders',               count(*) from orders
union all select 'bins',                 count(*) from bins
union all select 'notifications',        count(*) from notifications
union all select 'wallet_transactions',  count(*) from wallet_transactions
union all select 'settlement_payments',  count(*) from settlement_payments
union all select 'noqx_pro_subscriptions', count(*) from noqx_pro_subscriptions
union all select 'waste_reports',        count(*) from waste_reports
union all select 'slot_control',         count(*) from slot_control
union all select 'canteen_bank_details', count(*) from canteen_bank_details
union all select 'profiles',             count(*) from profiles
union all select 'platform_charges',     count(*) from platform_charges;

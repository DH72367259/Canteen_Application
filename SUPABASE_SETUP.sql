-- ============================================================
-- SUPABASE SETUP SCRIPT
-- Run this in your Supabase SQL Editor to complete all migrations
--
-- Project: https://dpycfyeiyhzvwbythcrp.supabase.co
-- ============================================================

-- ============================================================
-- PHASE 10: Add username field for worker/staff login
-- ============================================================
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS username text UNIQUE;

CREATE INDEX IF NOT EXISTS idx_profiles_username
  ON public.profiles(username)
  WHERE username IS NOT NULL;

-- Grant permissions for auth lookups
GRANT SELECT (username, email) ON public.profiles TO anon;

-- ============================================================
-- SEED TEST ACCOUNTS with usernames
-- ============================================================
-- Helper: insert an auth user + matching profile in one transaction.
-- Idempotent — re-running is safe (uses ON CONFLICT)
do $$
declare
  v_users  jsonb := '[
    {"email":"admin@noqx.test",    "pwd":"Admin@12345",   "name":"Super Admin",    "role":"super_admin", "username":"admin_user"},
    {"email":"canteen1@noqx.test", "pwd":"Canteen@12345", "name":"Canteen One",    "role":"canteen_admin", "username":"canteen_admin_1"},
    {"email":"canteen2@noqx.test", "pwd":"Canteen@12345", "name":"Canteen Two",    "role":"canteen_admin", "username":"canteen_admin_2"},
    {"email":"worker1@noqx.test",  "pwd":"Worker@12345",  "name":"Worker One",     "role":"worker", "username":"worker_1"},
    {"email":"coadmin@noqx.test",  "pwd":"Coadmin@12345", "name":"Co Administrator","role":"co_admin", "username":"coadmin_user"}
  ]'::jsonb;
  v_row   jsonb;
  v_uid   uuid;
  v_email text;
  v_pwd   text;
  v_name  text;
  v_role  text;
  v_username text;
begin
  for v_row in select * from jsonb_array_elements(v_users) loop
    v_email := v_row->>'email';
    v_pwd   := v_row->>'pwd';
    v_name  := v_row->>'name';
    v_role  := v_row->>'role';
    v_username := v_row->>'username';

    -- Skip if already exists
    select id into v_uid from auth.users where email = v_email;
    if v_uid is not null then
      -- Update existing user's profile with username
      update public.profiles
      set username = v_username, name = v_name, role = v_role
      where id = v_uid;
      raise notice 'Updated % with username %', v_email, v_username;
      continue;
    end if;

    v_uid := gen_random_uuid();

    insert into auth.users (
      id, instance_id, aud, role,
      email, encrypted_password,
      email_confirmed_at, confirmation_sent_at,
      raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at,
      is_sso_user, is_anonymous
    ) values (
      v_uid,
      '00000000-0000-0000-0000-000000000000',
      'authenticated', 'authenticated',
      v_email,
      crypt(v_pwd, gen_salt('bf')),
      now(), now(),
      jsonb_build_object('provider','email','providers',jsonb_build_array('email')),
      jsonb_build_object('name', v_name, 'has_password', true),
      now(), now(),
      false, false
    );

    -- Identity row (required for email/password login)
    insert into auth.identities (
      id, user_id, identity_data, provider, provider_id,
      last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(), v_uid,
      jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true),
      'email', v_email,
      now(), now(), now()
    );

    -- Profile row with username
    insert into public.profiles (id, name, email, role, username, created_at)
    values (v_uid, v_name, v_email, v_role, v_username, now())
    on conflict (id) do update
    set name = excluded.name,
        role = excluded.role,
        email = excluded.email,
        username = excluded.username;

    raise notice 'Created % as % with username % (uid=%)', v_email, v_role, v_username, v_uid;
  end loop;
end $$;

-- ============================================================
-- PHASE 11: Remove 75/25 Slot Capacity Split
-- All bins are now available for each slot (100% capacity)
-- ============================================================
ALTER TABLE public.slot_control
  DROP COLUMN IF EXISTS max_orders_per_slot,
  DROP COLUMN IF EXISTS batched_prepared_cap,
  DROP COLUMN IF EXISTS made_to_order_cap;

ALTER TABLE public.slot_control
  ADD COLUMN max_orders_per_slot int GENERATED ALWAYS AS (max_bins) STORED,
  ADD COLUMN batched_prepared_cap int GENERATED ALWAYS AS (FLOOR(max_bins * 0.60)::int) STORED,
  ADD COLUMN made_to_order_cap int GENERATED ALWAYS AS (max_bins - FLOOR(max_bins * 0.60)::int) STORED;

-- ============================================================
-- PHASE 12: Add slot_label to bins table
-- CRITICAL: Without this column every bin claim and release silently
-- fails because PostgREST rejects UPDATEs with unknown columns.
-- This causes all orders to fall back to the synthetic bin and
-- leaves bins permanently stuck in Reserved state.
-- ============================================================
ALTER TABLE public.bins
  ADD COLUMN IF NOT EXISTS slot_label text;

CREATE INDEX IF NOT EXISTS idx_bins_slot_label
  ON public.bins(canteen_id, slot_label)
  WHERE slot_label IS NOT NULL;

-- ============================================================
-- VERIFY SETUP
-- ============================================================
select p.email, p.role, p.name, p.username, u.email_confirmed_at is not null as confirmed
from public.profiles p
join auth.users u on u.id = p.id
where p.email like '%@noqx.test'
order by p.role, p.email;

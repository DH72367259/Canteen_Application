-- ─────────────────────────────────────────────────────────────────────────────
-- NoQx — Seed Test Users
-- ─────────────────────────────────────────────────────────────────────────────
-- Paste this whole file into Supabase Dashboard → SQL Editor → Run.
-- Creates 5 test accounts. Safe to re-run (uses ON CONFLICT DO NOTHING).
--
-- After testing, wipe everything with: supabase-wipe-data.sql
--
-- TEST CREDENTIALS (all passwords use the pattern <Role>@12345):
--   admin@noqx.test     / Admin@12345     → super_admin
--   canteen1@noqx.test  / Canteen@12345   → canteen_admin
--   canteen2@noqx.test  / Canteen@12345   → canteen_admin
--   worker1@noqx.test   / Worker@12345    → worker
--   coadmin@noqx.test   / Coadmin@12345   → co_admin
--
-- Note: Students should self-signup via /login (Email OTP). After they sign
-- up, an admin can reset their password from Admin → All Users → 🔑 Reset PW.
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists pgcrypto;

-- Ensure the role check constraint includes 'co_admin' (older schemas may omit it)
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role = any (array['user','canteen_admin','vendor','worker','super_admin','co_admin']));

-- Helper: insert an auth user + matching profile in one transaction.
-- Idempotent — re-running this script on existing emails is a no-op.
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
      raise notice 'Skipping % (already exists, uid=%)', v_email, v_uid;
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

    -- Identity row (required for email/password login on newer Supabase)
    insert into auth.identities (
      id, user_id, identity_data, provider, provider_id,
      last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(), v_uid,
      jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true),
      'email', v_email,
      now(), now(), now()
    );

    -- Profile row (matches the public.profiles schema in supabase-setup.sql)
    insert into public.profiles (id, name, email, role, username, created_at)
    values (v_uid, v_name, v_email, v_role, v_username, now())
    on conflict (id) do update set name = excluded.name, role = excluded.role, email = excluded.email, username = excluded.username;

    raise notice 'Created % as % (uid=%)', v_email, v_role, v_uid;
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Verify
-- ─────────────────────────────────────────────────────────────────────────────
select p.email, p.role, p.name, u.email_confirmed_at is not null as confirmed
from public.profiles p
join auth.users u on u.id = p.id
where p.email like '%@noqx.test'
order by p.role, p.email;

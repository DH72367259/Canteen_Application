-- ============================================================
-- CANTEEN APPLICATION — Supabase Database Setup
-- Run this entire file in: Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- 1. PROFILES
-- Linked 1:1 to auth.users (created automatically on signup via trigger below)
create table if not exists profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  name            text,
  email           text,
  phone           text,
  role            text not null default 'user'
                    check (role in ('user','canteen_admin','vendor','worker','super_admin')),
  canteen_id      uuid,                   -- set for canteen_admin / vendor / worker
  wallet_balance  numeric(10,2) not null default 0,
  created_at      timestamptz not null default now()
);
alter table profiles enable row level security;

-- Users can read/update their own profile
create policy "own profile read"   on profiles for select using (auth.uid() = id);
create policy "own profile update" on profiles for update using (auth.uid() = id);
-- Service role (backend) can do everything
create policy "service full access" on profiles for all using (auth.role() = 'service_role');

-- Auto-create profile on signup
create or replace function handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into profiles (id, email, name, phone)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', new.email),
    new.phone
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();


-- 2. CANTEENS
create table if not exists canteens (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  college     text,
  city        text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
alter table canteens enable row level security;
create policy "anyone read" on canteens for select using (true);
create policy "service full" on canteens for all using (auth.role() = 'service_role');

-- Seed one canteen so orders can be placed immediately
insert into canteens (id, name, college, city)
values ('00000000-0000-0000-0000-000000000001', 'Main Canteen', 'Demo College', 'Demo City')
on conflict do nothing;


-- 3. MENU ITEMS
create table if not exists menu_items (
  id           uuid primary key default gen_random_uuid(),
  canteen_id   uuid not null references canteens(id) on delete cascade,
  name         text not null,
  description  text,
  price        numeric(8,2) not null,
  category     text,
  image_url    text,
  is_available boolean not null default true,
  created_at   timestamptz not null default now()
);
alter table menu_items enable row level security;
create policy "anyone read menu" on menu_items for select using (true);
create policy "service full menu" on menu_items for all using (auth.role() = 'service_role');

-- Seed sample menu items
insert into menu_items (canteen_id, name, price, category, is_available) values
  ('00000000-0000-0000-0000-000000000001', 'Veg Thali',     80,  'Meals',   true),
  ('00000000-0000-0000-0000-000000000001', 'Chicken Curry', 120, 'Meals',   true),
  ('00000000-0000-0000-0000-000000000001', 'Masala Dosa',   50,  'Snacks',  true),
  ('00000000-0000-0000-0000-000000000001', 'Cold Coffee',   60,  'Drinks',  true),
  ('00000000-0000-0000-0000-000000000001', 'Samosa',        20,  'Snacks',  true)
on conflict do nothing;


-- 4. TIME SLOTS
create table if not exists time_slots (
  id          uuid primary key default gen_random_uuid(),
  canteen_id  uuid not null references canteens(id) on delete cascade,
  slot_name   text not null,
  start_time  time not null,
  end_time    time not null,
  capacity    int  not null default 50,
  is_active   boolean not null default true
);
alter table time_slots enable row level security;
create policy "anyone read slots" on time_slots for select using (true);
create policy "service full slots" on time_slots for all using (auth.role() = 'service_role');

insert into time_slots (canteen_id, slot_name, start_time, end_time, capacity) values
  ('00000000-0000-0000-0000-000000000001', 'Breakfast', '08:00', '09:30', 40),
  ('00000000-0000-0000-0000-000000000001', 'Lunch',     '12:00', '14:00', 100),
  ('00000000-0000-0000-0000-000000000001', 'Snacks',    '16:00', '17:00', 30),
  ('00000000-0000-0000-0000-000000000001', 'Dinner',    '19:00', '21:00', 60)
on conflict do nothing;


-- 5. BINS (pickup bins)
create table if not exists bins (
  id          uuid primary key default gen_random_uuid(),
  canteen_id  uuid not null references canteens(id) on delete cascade,
  bin_code    text not null,
  color       text,
  is_occupied boolean not null default false,
  order_id    uuid,
  updated_at  timestamptz not null default now()
);
alter table bins enable row level security;
create policy "anyone read bins" on bins for select using (true);
create policy "service full bins" on bins for all using (auth.role() = 'service_role');

insert into bins (canteen_id, bin_code, color) values
  ('00000000-0000-0000-0000-000000000001', 'A1', 'red'),
  ('00000000-0000-0000-0000-000000000001', 'A2', 'blue'),
  ('00000000-0000-0000-0000-000000000001', 'A3', 'green'),
  ('00000000-0000-0000-0000-000000000001', 'B1', 'yellow'),
  ('00000000-0000-0000-0000-000000000001', 'B2', 'orange')
on conflict do nothing;


-- 6. ORDERS
create table if not exists orders (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references profiles(id),
  canteen_id    uuid not null references canteens(id),
  slot_id       uuid references time_slots(id),
  bin_id        uuid references bins(id),
  total_amount  numeric(10,2) not null,
  status        text not null default 'placed'
                  check (status in ('placed','confirmed','preparing',
                    'ready_for_placement','placed_in_bin',
                    'ready_for_pickup','collected','cancelled')),
  otp           text,
  notes         text,
  payment_id    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table orders enable row level security;
create policy "own orders" on orders for select using (auth.uid() = user_id);
create policy "service full orders" on orders for all using (auth.role() = 'service_role');


-- 7. ORDER ITEMS
create table if not exists order_items (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references orders(id) on delete cascade,
  menu_item_id  uuid not null references menu_items(id),
  quantity      int  not null,
  unit_price    numeric(8,2) not null
);
alter table order_items enable row level security;
create policy "service full oi" on order_items for all using (auth.role() = 'service_role');
create policy "own order items" on order_items for select
  using (exists (select 1 from orders where orders.id = order_items.order_id and orders.user_id = auth.uid()));


-- 8. REWARD TRANSACTIONS
create table if not exists reward_transactions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(id) on delete cascade,
  type       text not null check (type in ('earned','redeemed','expired')),
  points     numeric(10,2) not null,
  order_id   uuid references orders(id),
  reason     text,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
alter table reward_transactions enable row level security;
create policy "own rewards" on reward_transactions for select using (auth.uid() = user_id);
create policy "service full rewards" on reward_transactions for all using (auth.role() = 'service_role');

-- RPC: atomically increment wallet_balance
create or replace function increment_wallet_balance(p_user_id uuid, p_delta numeric)
returns void language plpgsql security definer as $$
begin
  update profiles set wallet_balance = wallet_balance + p_delta where id = p_user_id;
end;
$$;


-- 9. WASTE REPORTS
create table if not exists waste_reports (
  id          uuid primary key default gen_random_uuid(),
  canteen_id  uuid references canteens(id),
  reported_by uuid references profiles(id),
  item_name   text,
  quantity_kg numeric(6,2),
  notes       text,
  created_at  timestamptz not null default now()
);
alter table waste_reports enable row level security;
create policy "service full waste" on waste_reports for all using (auth.role() = 'service_role');


-- 10. RPC: verify_order_otp (worker scans OTP to collect order)
create or replace function verify_order_otp(p_otp text, p_canteen_id uuid)
returns uuid language plpgsql security definer as $$
declare
  v_order_id uuid;
begin
  select id into v_order_id
  from orders
  where otp = p_otp
    and canteen_id = p_canteen_id
    and status = 'ready_for_pickup'
  limit 1;

  if v_order_id is null then
    raise exception 'Invalid or expired OTP';
  end if;

  update orders set status = 'collected', updated_at = now() where id = v_order_id;
  return v_order_id;
end;
$$;


-- ============================================================
-- Wallet transactions (top-up / withdrawal / earned / redeemed)
-- ============================================================
create table if not exists wallet_transactions (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid references auth.users on delete cascade,
  type              text not null check (type in ('topup','withdrawal','earned','redeemed','expired')),
  amount            numeric(10,2) not null,
  payment_id        text,
  razorpay_order_id text,
  payment_method    text default 'unknown',
  status            text default 'completed' check (status in ('completed','processing','failed')),
  description       text,
  created_at        timestamptz default now()
);
alter table wallet_transactions enable row level security;
create policy "wallet_own_select" on wallet_transactions
  for select using (auth.uid() = user_id);

-- ============================================================
-- Active sessions (concurrent-session enforcement)
-- SHA-256 hash of IP is stored, never raw IP. Only service role accesses this.
-- ============================================================
create table if not exists active_sessions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users on delete cascade,
  device_info text,
  ip_hash     text,
  is_active   boolean default true,
  last_seen   timestamptz default now(),
  created_at  timestamptz default now()
);
alter table active_sessions enable row level security;
-- No user-facing policies — all access via service role in API routes only.

-- ============================================================
-- DONE. Now create your admin user:
--   1. Go to Authentication → Users → Add user
--   2. Email: admin@canteen.app  Password: admin123  (or any)
--   3. After it appears, run this (replace the UUID with the real one):
--
--   update profiles set role = 'super_admin', name = 'Admin' 
--   where email = 'admin@canteen.app';
--
-- For canteen admin:
--   update profiles set role = 'canteen_admin', canteen_id = '00000000-0000-0000-0000-000000000001', name = 'Canteen Manager'
--   where email = 'canteen@canteen.app';
-- ============================================================

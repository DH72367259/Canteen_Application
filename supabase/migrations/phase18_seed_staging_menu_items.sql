-- ============================================================
-- Phase 18: Seed staging test data for E2E tests
-- Creates 2nd canteen, bins for both canteens, and menu items.
-- Idempotent — all statements use IF NOT EXISTS / ON CONFLICT DO NOTHING.
-- ============================================================

-- ──────────────────────────────────────────────────────────────
-- 1. Ensure second canteen exists (for canteen2@noqx.test)
-- ──────────────────────────────────────────────────────────────
INSERT INTO public.canteens (id, name, location, is_active)
VALUES (
  'cccccccc-0002-0002-0002-000000000002',
  'NoQx Test Canteen 2',
  'Block B, Test Campus',
  true
)
ON CONFLICT (id) DO NOTHING;

-- ──────────────────────────────────────────────────────────────
-- 2. Link whitelist profiles to their canteens
-- ──────────────────────────────────────────────────────────────
UPDATE public.profiles
SET canteen_id = 'b8eaef34-6734-497f-b7ec-b058f33833f2'
WHERE email IN ('canteen1@noqx.test', 'worker1@noqx.test')
  AND (canteen_id IS NULL OR canteen_id != 'b8eaef34-6734-497f-b7ec-b058f33833f2');

UPDATE public.profiles
SET canteen_id = 'cccccccc-0002-0002-0002-000000000002'
WHERE email = 'canteen2@noqx.test'
  AND (canteen_id IS NULL OR canteen_id != 'cccccccc-0002-0002-0002-000000000002');

-- ──────────────────────────────────────────────────────────────
-- 3. Ensure slot_control row exists for both canteens
-- ──────────────────────────────────────────────────────────────
INSERT INTO public.slot_control (canteen_id, max_bins)
VALUES
  ('b8eaef34-6734-497f-b7ec-b058f33833f2', 60),
  ('cccccccc-0002-0002-0002-000000000002', 60)
ON CONFLICT (canteen_id) DO NOTHING;

-- ──────────────────────────────────────────────────────────────
-- 4. Provision bins for both canteens (6 zones × 10 bins = 60)
-- ──────────────────────────────────────────────────────────────

-- Helper: insert bins for a given canteen + zone prefix + color
-- Canteen 1: b8eaef34-6734-497f-b7ec-b058f33833f2
INSERT INTO public.bins (canteen_id, bin_code, color, zone_color, bin_number, is_occupied, status)
SELECT
  'b8eaef34-6734-497f-b7ec-b058f33833f2',
  '#' || abbr || LPAD(n::text, 3, '0'),
  color,
  color,
  n,
  false,
  'empty'
FROM
  (VALUES
    ('RED', 'red'),    ('YEL', 'yellow'), ('GRE', 'green'),
    ('BLU', 'blue'),   ('PUR', 'purple'), ('ORA', 'orange')
  ) AS z(abbr, color),
  generate_series(1, 10) AS n
ON CONFLICT (canteen_id, bin_code) DO NOTHING;

-- Canteen 2: cccccccc-0002-0002-0002-000000000002
INSERT INTO public.bins (canteen_id, bin_code, color, zone_color, bin_number, is_occupied, status)
SELECT
  'cccccccc-0002-0002-0002-000000000002',
  '#' || abbr || LPAD(n::text, 3, '0'),
  color,
  color,
  n,
  false,
  'empty'
FROM
  (VALUES
    ('RED', 'red'),    ('YEL', 'yellow'), ('GRE', 'green'),
    ('BLU', 'blue'),   ('PUR', 'purple'), ('ORA', 'orange')
  ) AS z(abbr, color),
  generate_series(1, 10) AS n
ON CONFLICT (canteen_id, bin_code) DO NOTHING;

-- ──────────────────────────────────────────────────────────────
-- 5. Seed menu items for canteen 1 (b8eaef34-...)
-- ──────────────────────────────────────────────────────────────
INSERT INTO public.menu_items
  (id, canteen_id, name, description, price, category, production_type,
   is_available, is_meal, availability_type, quantity_per_slot, total_per_day,
   is_sold_out)
VALUES
  -- Meal items (is_meal = true)
  (
    'aaaaaaaa-0001-0001-0001-000000000001',
    'b8eaef34-6734-497f-b7ec-b058f33833f2',
    'Paneer Rice', 'Paneer fried rice combo', 80.00, 'Meals',
    'batched_prepared', true, true, 'batched_prepared', 30, 150, false
  ),
  (
    'aaaaaaaa-0001-0001-0001-000000000002',
    'b8eaef34-6734-497f-b7ec-b058f33833f2',
    'Dal Roti Combo', 'Dal with 3 rotis and salad', 60.00, 'Meals',
    'batched_prepared', true, true, 'batched_prepared', 25, 100, false
  ),
  (
    'aaaaaaaa-0001-0001-0001-000000000003',
    'b8eaef34-6734-497f-b7ec-b058f33833f2',
    'Chicken Biryani', 'Full plate chicken biryani', 120.00, 'Meals',
    'made_to_order', true, true, 'made_to_order', null, null, false
  ),
  (
    'aaaaaaaa-0001-0001-0001-000000000004',
    'b8eaef34-6734-497f-b7ec-b058f33833f2',
    'Veg Thali', 'Complete veg meal with rice dal sabzi roti', 70.00, 'Meals',
    'batched_prepared', true, true, 'slot_based', 20, null, false
  ),
  -- Snack items (is_meal = false)
  (
    'aaaaaaaa-0001-0001-0001-000000000005',
    'b8eaef34-6734-497f-b7ec-b058f33833f2',
    'Samosa', 'Crispy potato samosa (2 pcs)', 20.00, 'Snacks',
    'batched_prepared', true, false, 'batched_prepared', 50, 200, false
  ),
  (
    'aaaaaaaa-0001-0001-0001-000000000006',
    'b8eaef34-6734-497f-b7ec-b058f33833f2',
    'Chai', 'Masala tea', 10.00, 'Beverages',
    'made_to_order', true, false, 'made_to_order', null, null, false
  ),
  (
    'aaaaaaaa-0001-0001-0001-000000000007',
    'b8eaef34-6734-497f-b7ec-b058f33833f2',
    'Cold Coffee', 'Chilled coffee with milk', 40.00, 'Beverages',
    'made_to_order', true, false, 'made_to_order', null, null, false
  ),
  (
    'aaaaaaaa-0001-0001-0001-000000000008',
    'b8eaef34-6734-497f-b7ec-b058f33833f2',
    'Bread Omelette', 'Egg omelette with bread slices', 35.00, 'Snacks',
    'made_to_order', true, false, 'made_to_order', null, null, false
  ),
  (
    'aaaaaaaa-0001-0001-0001-000000000009',
    'b8eaef34-6734-497f-b7ec-b058f33833f2',
    'Poha', 'Flattened rice snack', 25.00, 'Snacks',
    'batched_prepared', true, false, 'slot_based', 40, 160, false
  ),
  (
    'aaaaaaaa-0001-0001-0001-000000000010',
    'b8eaef34-6734-497f-b7ec-b058f33833f2',
    'Sandwich', 'Veg grilled sandwich', 45.00, 'Snacks',
    'made_to_order', true, false, 'made_to_order', null, null, false
  )
ON CONFLICT (id) DO NOTHING;

-- ──────────────────────────────────────────────────────────────
-- 6. Seed menu items for canteen 2 (cccccccc-...)
-- ──────────────────────────────────────────────────────────────
INSERT INTO public.menu_items
  (id, canteen_id, name, description, price, category, production_type,
   is_available, is_meal, availability_type, quantity_per_slot, total_per_day,
   is_sold_out)
VALUES
  (
    'bbbbbbbb-0002-0002-0002-000000000001',
    'cccccccc-0002-0002-0002-000000000002',
    'Rajma Rice', 'Rajma chawal comfort meal', 65.00, 'Meals',
    'batched_prepared', true, true, 'batched_prepared', 25, 120, false
  ),
  (
    'bbbbbbbb-0002-0002-0002-000000000002',
    'cccccccc-0002-0002-0002-000000000002',
    'Egg Curry Rice', 'Egg curry with steamed rice', 75.00, 'Meals',
    'made_to_order', true, true, 'made_to_order', null, null, false
  ),
  (
    'bbbbbbbb-0002-0002-0002-000000000003',
    'cccccccc-0002-0002-0002-000000000002',
    'Idli Sambar', 'Soft idlis with sambar and chutney', 30.00, 'Snacks',
    'batched_prepared', true, false, 'batched_prepared', 60, 200, false
  ),
  (
    'bbbbbbbb-0002-0002-0002-000000000004',
    'cccccccc-0002-0002-0002-000000000002',
    'Coffee', 'Hot filter coffee', 15.00, 'Beverages',
    'made_to_order', true, false, 'made_to_order', null, null, false
  ),
  (
    'bbbbbbbb-0002-0002-0002-000000000005',
    'cccccccc-0002-0002-0002-000000000002',
    'Vada Pav', 'Mumbai style vada pav', 25.00, 'Snacks',
    'batched_prepared', true, false, 'slot_based', 45, 180, false
  )
ON CONFLICT (id) DO NOTHING;

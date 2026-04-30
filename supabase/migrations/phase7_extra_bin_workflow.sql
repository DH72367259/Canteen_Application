-- ============================================================
-- Phase 7: Extra-Bin Workflow (multi-bin orders)
-- ============================================================
-- Implements the "Work Flow of Extra bin" client requirement:
--   * Orders that exceed one standard bin (per slot_control caps) are
--     assigned multiple physical bins; the cart UI warns the student and
--     adds an extra-bin fee (default ₹2/extra bin).
--   * Each placed order may now occupy 1..N bins. We retain the existing
--     orders.bin_id (= first bin) for back-compat with all existing
--     queries, and store the full per-bin breakdown in `order_bins`.
--   * Workers see "Place Meal 1 & 2 → Bin 8, Place Meal 3 → Bin 9".
--   * Students see the same per-bin list on the order-status screen.

-- 1) Per-order bin assignments
CREATE TABLE IF NOT EXISTS public.order_bins (
  id              uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        uuid           NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  bin_id          uuid           REFERENCES public.bins(id) ON DELETE SET NULL,
  bin_index       int            NOT NULL CHECK (bin_index >= 1),
  bin_code        text,
  bin_color       text,
  -- jsonb shape: [{ "name": "Biryani", "quantity": 2, "isMeal": true }, …]
  items           jsonb          NOT NULL DEFAULT '[]'::jsonb,
  created_at      timestamptz    NOT NULL DEFAULT now(),
  UNIQUE (order_id, bin_index)
);

CREATE INDEX IF NOT EXISTS idx_order_bins_order_id ON public.order_bins(order_id);
CREATE INDEX IF NOT EXISTS idx_order_bins_bin_id   ON public.order_bins(bin_id);

-- 2) Order-level rollups (denormalised so dashboards don't need a join)
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS extra_bin_fee_paise int NOT NULL DEFAULT 0
    CHECK (extra_bin_fee_paise >= 0),
  ADD COLUMN IF NOT EXISTS bin_count           int NOT NULL DEFAULT 1
    CHECK (bin_count >= 1);

-- 3) RLS — allow service role + the order's owner to read its bin breakdown
ALTER TABLE public.order_bins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS order_bins_owner_select ON public.order_bins;
CREATE POLICY order_bins_owner_select ON public.order_bins
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_bins.order_id
        AND (
          o.user_id = auth.uid()
          OR EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = auth.uid()
              AND p.role IN ('canteen_admin', 'vendor', 'worker', 'super_admin', 'co_admin')
          )
        )
    )
  );

-- Service role bypasses RLS automatically; no insert/update/delete policy
-- needed because the API uses the admin client to write rows.

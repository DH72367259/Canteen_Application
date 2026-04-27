-- ============================================================
-- Phase 2: Worker app — skip/grace order tracking + bin sync
-- - orders.skipped_at  (push back to end of pending queue)
-- - orders.grace_collected_at  (audit trail)
-- - getBins enriched view: orders_in_bin count
-- Idempotent.
-- ============================================================

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS skipped_at         timestamptz,
  ADD COLUMN IF NOT EXISTS skipped_count      int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS grace_collected_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_orders_skipped_at ON public.orders(skipped_at);

-- Sync bins.status whenever an order's status changes
CREATE OR REPLACE FUNCTION public.sync_bin_on_order_change()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_bin_id uuid;
BEGIN
  v_bin_id := NEW.bin_id;
  IF v_bin_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.status::text = 'preparing' THEN
    UPDATE public.bins SET status = 'preparing', is_occupied = true,
           current_order_id = NEW.id, updated_at = now()
     WHERE id = v_bin_id;
  ELSIF NEW.status::text = 'placed_in_bin' OR NEW.status::text = 'ready_for_pickup' THEN
    UPDATE public.bins SET status = 'placed', is_occupied = true,
           current_order_id = NEW.id, updated_at = now()
     WHERE id = v_bin_id;
  ELSIF NEW.status::text = 'collected' THEN
    UPDATE public.bins SET status = 'picked', is_occupied = false,
           current_order_id = NULL, updated_at = now()
     WHERE id = v_bin_id;
    -- After a brief moment of "picked", the dashboard will reset to 'empty'
    -- via worker mark-picked or background job. For now, set empty directly:
    UPDATE public.bins SET status = 'empty', updated_at = now()
     WHERE id = v_bin_id;
  ELSIF NEW.status::text = 'cancelled' AND NEW.grace_collected_at IS NOT NULL THEN
    UPDATE public.bins SET status = 'grace_bin', updated_at = now()
     WHERE id = v_bin_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_bin_on_order_change ON public.orders;
CREATE TRIGGER trg_sync_bin_on_order_change
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.sync_bin_on_order_change();

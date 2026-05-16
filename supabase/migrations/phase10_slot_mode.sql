-- Phase 10: Add slot_mode to slot_control
-- 'both'         (default) — 60% batched-prepared + 40% made-to-order split
-- 'batched_only' — 100% batched-prepared; no made-to-order orders accepted

ALTER TABLE public.slot_control
  ADD COLUMN IF NOT EXISTS slot_mode text NOT NULL DEFAULT 'both'
    CHECK (slot_mode IN ('both', 'batched_only'));

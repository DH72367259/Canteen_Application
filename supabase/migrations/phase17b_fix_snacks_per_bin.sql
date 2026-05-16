-- Phase 17b: Correct snacks_per_bin from 4 → 3 across all canteens.
-- Business rule: 1 bin holds 1 meal + up to 3 snacks (or up to 5 snacks only).
-- The old default of 4 was incorrect — existing rows need to be updated.

UPDATE public.slot_control
   SET snacks_per_bin = 3
 WHERE snacks_per_bin = 4;

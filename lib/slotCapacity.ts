/**
 * Phase 1 helpers: slot capacity, time slot generation, and extra-bin logic.
 *
 * All functions are pure and used by both the canteen dashboard (slot control
 * panel) and the user app (cart extra-bin popup, slot picker).
 */

export interface SlotCapacity {
  maxBins: number;
  /** 100% of maxBins — total orders accepted per slot */
  maxOrdersPerSlot: number;
  /** 60% of maxBins — reserved for batched/prepared items */
  batchedPreparedCap: number;
  /** Remaining 40% — reserved for made-to-order items */
  madeToOrderCap: number;
  /** No buffer bins (100% capacity per slot) */
  bufferBins: number;
}

export type SlotMode = 'both' | 'batched_only';

export function computeSlotCapacity(maxBins: number, mode: SlotMode = 'both'): SlotCapacity {
  if (!Number.isFinite(maxBins) || maxBins <= 0) {
    throw new Error('maxBins must be a positive number');
  }
  const maxOrdersPerSlot = maxBins;
  let batchedPreparedCap: number;
  let madeToOrderCap: number;
  if (mode === 'batched_only') {
    // All bins reserved for batched-prepared items; no made-to-order accepted
    batchedPreparedCap = maxBins;
    madeToOrderCap = 0;
  } else {
    // Default: 60% batched-prepared, 40% made-to-order
    batchedPreparedCap = Math.floor(maxBins * 0.6);
    madeToOrderCap = maxBins - batchedPreparedCap;
  }
  return {
    maxBins,
    maxOrdersPerSlot,
    batchedPreparedCap,
    madeToOrderCap,
    bufferBins: 0,
  };
}

export interface TimeSlot {
  start: string; // "HH:MM"
  end: string;   // "HH:MM"
}

// Accept HH:MM (canonical) or HH:MM:SS (PostgreSQL `time` columns serialize
// with seconds — slot_control rows in prod come back as e.g. "07:00:00").
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;

function toMinutes(hhmm: string): number {
  const m = HHMM.exec(hhmm);
  if (!m) throw new Error(`Invalid time '${hhmm}', expected HH:MM`);
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function toHHMM(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Slice a window (e.g. 07:00-11:00) into discrete slots of `durationMins`.
 * Returns an empty array if end <= start.
 */
export function generateTimeSlots(
  start: string,
  end: string,
  durationMins: number
): TimeSlot[] {
  if (!Number.isInteger(durationMins) || durationMins <= 0) {
    throw new Error('durationMins must be a positive integer');
  }
  const startM = toMinutes(start);
  const endM = toMinutes(end);
  if (endM <= startM) return [];
  const slots: TimeSlot[] = [];
  for (let t = startM; t + durationMins <= endM; t += durationMins) {
    slots.push({ start: toHHMM(t), end: toHHMM(t + durationMins) });
  }
  return slots;
}

export interface ExtraBinResult {
  /** True when the user requires more than one pickup bin */
  required: boolean;
  /** Number of bins this order will occupy */
  binCount: number;
  /** Extra fee in paise (0 if not required) */
  extraFeePaise: number;
}

/**
 * Decide whether an order needs an extra pickup bin based on meal count.
 * Default: 2 meals per bin → a 3rd meal triggers a 2nd bin and ₹2 fee.
 */
export function requiresExtraBin(
  mealsCount: number,
  mealsPerBin = 2,
  extraBinFeePaise = 200
): ExtraBinResult {
  if (mealsCount <= 0) {
    return { required: false, binCount: 0, extraFeePaise: 0 };
  }
  const binCount = Math.ceil(mealsCount / mealsPerBin);
  const required = binCount > 1;
  return {
    required,
    binCount,
    extraFeePaise: required ? extraBinFeePaise * (binCount - 1) : 0,
  };
}

export interface CartLine {
  itemId: string;
  name: string;
  quantity: number;
  isMeal: boolean;
}

export interface BinAssignment {
  binIndex: number;            // 1-based index for display ("Bin 1", "Bin 2")
  meals: { itemId: string; name: string; quantity: number }[];
  snacks: { itemId: string; name: string; quantity: number }[];
}

export interface BinPlan {
  bins: BinAssignment[];
  totalMeals: number;
  totalSnacks: number;
  extraFeePaise: number;
}

/**
 * Distribute cart lines into bins using MEAL-SNACK PAIRING:
 *  - 1 meal + up to `snacksPerBin` snacks per bin (e.g., 1 meal + 3 snacks = 1 bin)
 *  - Meals-only: 1 meal per bin
 *  - Snacks-only: 5 snacks per bin
 *  - Extra snacks beyond the pairing capacity go to additional 5-per-bin snack bins
 *
 * Example (mealsPerBin=1, snacksPerBin=3):
 *  - 2 meals + 5 snacks → Bin1: meal+3snacks, Bin2: meal+2snacks → 2 bins (no extra)
 *  - 1 meal + 5 snacks → Bin1: meal+3snacks, Bin2: 2snacks → 2 bins (1 extra)
 *  - 3 snacks only → Bin1: 3snacks → 1 bin
 *  - 6 snacks only → Bin1: 5snacks, Bin2: 1snack → 2 bins
 */
export function assignBins(
  items: CartLine[],
  mealsPerBin = 1,
  snacksPerBin = 3,
  extraBinFeePaise = 200
): BinPlan {
  if (mealsPerBin <= 0 || snacksPerBin <= 0) {
    throw new Error('per-bin caps must be positive');
  }

  const mealItems = items.filter((i) => i.isMeal);
  const snackItems = items.filter((i) => !i.isMeal);

  const totalMeals = mealItems.reduce((s, i) => s + i.quantity, 0);
  const totalSnacks = snackItems.reduce((s, i) => s + i.quantity, 0);

  // Calculate bins needed
  let binCount = 0;
  if (totalMeals === 0 && totalSnacks === 0) {
    binCount = 1;  // Empty order = 1 synthetic bin
  } else if (totalMeals > 0 && totalSnacks === 0) {
    binCount = totalMeals;  // Meals only: 1 per bin
  } else if (totalMeals === 0 && totalSnacks > 0) {
    binCount = Math.ceil(totalSnacks / 5);  // Snacks only: 5 per bin
  } else {
    // Mixed: pair meals with snacks, remaining snacks in 5-per-bin bins
    const snacksWithMeals = Math.min(totalSnacks, totalMeals * snacksPerBin);
    const remainingSnacks = totalSnacks - snacksWithMeals;
    const extraSnackBins = Math.ceil(remainingSnacks / 5);
    binCount = totalMeals + extraSnackBins;
  }

  const bins: BinAssignment[] = Array.from({ length: binCount }, (_, i) => ({
    binIndex: i + 1,
    meals: [],
    snacks: [],
  }));

  if (totalMeals === 0 && totalSnacks === 0) {
    // Empty order
    return { bins, totalMeals, totalSnacks, extraFeePaise: 0 };
  }

  if (totalMeals > 0 && totalSnacks === 0) {
    // Meals only: 1 per bin
    let binIdx = 0;
    for (const line of mealItems) {
      let remaining = line.quantity;
      while (remaining > 0 && binIdx < bins.length) {
        bins[binIdx].meals.push({ itemId: line.itemId, name: line.name, quantity: 1 });
        remaining--;
        binIdx++;
      }
    }
    const extraFeePaise = binCount > 1 ? extraBinFeePaise * (binCount - 1) : 0;
    return { bins, totalMeals, totalSnacks, extraFeePaise };
  }

  if (totalMeals === 0 && totalSnacks > 0) {
    // Snacks only: 5 per bin
    let binIdx = 0;
    for (const line of snackItems) {
      let remaining = line.quantity;
      while (remaining > 0 && binIdx < bins.length) {
        const used = bins[binIdx].snacks.reduce((s, x) => s + x.quantity, 0);
        const room = 5 - used;
        if (room <= 0) {
          binIdx++;
          continue;
        }
        const take = Math.min(remaining, room);
        bins[binIdx].snacks.push({ itemId: line.itemId, name: line.name, quantity: take });
        remaining -= take;
        if (take === room) binIdx++;
      }
    }
    const extraFeePaise = binCount > 1 ? extraBinFeePaise * (binCount - 1) : 0;
    return { bins, totalMeals, totalSnacks, extraFeePaise };
  }

  // Mixed: meals + snacks
  let snackIdx = 0;
  let binIdx = 0;

  // Step 1: Pair meals with snacks (up to snacksPerBin per meal)
  for (const mealLine of mealItems) {
    let mealsRemaining = mealLine.quantity;
    while (mealsRemaining > 0 && binIdx < totalMeals) {
      bins[binIdx].meals.push({ itemId: mealLine.itemId, name: mealLine.name, quantity: 1 });
      mealsRemaining--;

      // Add snacks to this bin
      let snacksInBin = 0;
      for (const snackLine of snackItems) {
        if (snackIdx >= totalSnacks) break;

        let snacksRemaining = snackLine.quantity;
        while (snacksRemaining > 0 && snacksInBin < snacksPerBin) {
          bins[binIdx].snacks.push({ itemId: snackLine.itemId, name: snackLine.name, quantity: 1 });
          snacksRemaining--;
          snackIdx++;
          snacksInBin++;
        }
        if (snacksInBin >= snacksPerBin) break;
      }

      binIdx++;
    }
  }

  // Step 2: Pack remaining snacks in 5-per-bin format
  if (snackIdx < totalSnacks) {
    for (const snackLine of snackItems) {
      let snacksRemaining = snackLine.quantity;
      let skipped = 0;

      // Skip already-packed snacks
      for (const bin of bins.slice(0, totalMeals)) {
        for (const s of bin.snacks) {
          if (s.itemId === snackLine.itemId) {
            skipped += s.quantity;
          }
        }
      }
      snacksRemaining -= skipped;

      while (snacksRemaining > 0 && binIdx < bins.length) {
        const used = bins[binIdx].snacks.reduce((s, x) => s + x.quantity, 0);
        const room = 5 - used;
        if (room <= 0) {
          binIdx++;
          continue;
        }
        const take = Math.min(snacksRemaining, room);
        bins[binIdx].snacks.push({ itemId: snackLine.itemId, name: snackLine.name, quantity: take });
        snacksRemaining -= take;
        if (take === room) binIdx++;
      }
    }
  }

  const extraFeePaise = binCount > 1 ? extraBinFeePaise * (binCount - 1) : 0;
  return { bins, totalMeals, totalSnacks, extraFeePaise };
}

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
 * Distribute cart lines into physical pickup bins.
 *
 * Rules (confirmed business logic):
 *  - 1 meal per bin; paired with up to `snacksPerBin` (default 3) snacks
 *  - Snacks-only orders: up to 5 snacks per bin
 *  - Overflow snacks beyond the meal-pairing cap go into additional 5-per-bin bins
 *  - Extra fee = (totalBins - 1) × extraBinFeePaise
 *
 * Examples (mealsPerBin=1, snacksPerBin=3, fee=₹2):
 *  - 1 meal              → 1 bin,  ₹0 fee
 *  - 2 meals             → 2 bins, ₹2 fee
 *  - 5 snacks            → 1 bin,  ₹0 fee
 *  - 6 snacks            → 2 bins (5+1), ₹2 fee
 *  - 1 meal + 3 snacks   → 1 bin,  ₹0 fee
 *  - 1 meal + 4 snacks   → 2 bins (meal+3snacks | 1snack), ₹2 fee
 *  - 2 meals + 5 snacks  → 2 bins (meal+3snacks | meal+2snacks), ₹2 fee
 *  - 2 meals + 7 snacks  → 3 bins (meal+3snacks | meal+3snacks | 1snack), ₹4 fee
 *
 * Algorithm: build flat unit pools so each snack unit is allocated exactly once
 * (avoids the per-item quantity-reset bug that occurred with the previous
 * index-based loop when multiple meal bins shared one snack item type).
 */
export function assignBins(
  items: CartLine[],
  mealsPerBin = 1,
  snacksPerBin = 3,
  extraBinFeePaise = 200,
): BinPlan {
  if (mealsPerBin <= 0 || snacksPerBin <= 0) {
    throw new Error('per-bin caps must be positive');
  }

  const mealItems  = items.filter((i) => i.isMeal);
  const snackItems = items.filter((i) => !i.isMeal);
  const totalMeals  = mealItems.reduce((s, i) => s + i.quantity, 0);
  const totalSnacks = snackItems.reduce((s, i) => s + i.quantity, 0);

  if (totalMeals === 0 && totalSnacks === 0) {
    return { bins: [{ binIndex: 1, meals: [], snacks: [] }], totalMeals, totalSnacks, extraFeePaise: 0 };
  }

  // Build flat unit pools — one entry per physical item unit.
  // This guarantees each unit is allocated to exactly one bin regardless of
  // how many different snack/meal types are in the cart.
  type Unit = { itemId: string; name: string };
  const mealPool: Unit[] = [];
  for (const line of mealItems) {
    for (let i = 0; i < line.quantity; i++) mealPool.push({ itemId: line.itemId, name: line.name });
  }
  const snackPool: Unit[] = [];
  for (const line of snackItems) {
    for (let i = 0; i < line.quantity; i++) snackPool.push({ itemId: line.itemId, name: line.name });
  }

  const bins: BinAssignment[] = [];
  let snackCursor = 0;

  if (totalMeals === 0) {
    // Snacks-only: up to 5 per bin
    for (let s = 0; s < snackPool.length; s += 5) {
      bins.push({ binIndex: bins.length + 1, meals: [], snacks: groupUnits(snackPool.slice(s, s + 5)) });
    }
  } else {
    // One bin per meal unit, paired with up to snacksPerBin snacks
    for (const meal of mealPool) {
      const snackChunk = snackPool.slice(snackCursor, snackCursor + snacksPerBin);
      snackCursor += snackChunk.length;
      bins.push({
        binIndex: bins.length + 1,
        meals: [{ itemId: meal.itemId, name: meal.name, quantity: 1 }],
        snacks: groupUnits(snackChunk),
      });
    }
    // Overflow snacks: up to 5 per overflow bin
    while (snackCursor < snackPool.length) {
      const chunk = snackPool.slice(snackCursor, snackCursor + 5);
      snackCursor += chunk.length;
      bins.push({ binIndex: bins.length + 1, meals: [], snacks: groupUnits(chunk) });
    }
  }

  const binCount = bins.length;
  return {
    bins,
    totalMeals,
    totalSnacks,
    extraFeePaise: binCount > 1 ? extraBinFeePaise * (binCount - 1) : 0,
  };
}

/** Collapse a flat unit array into grouped {itemId, name, quantity} entries. */
function groupUnits(
  units: { itemId: string; name: string }[],
): { itemId: string; name: string; quantity: number }[] {
  const map = new Map<string, { itemId: string; name: string; quantity: number }>();
  for (const u of units) {
    const ex = map.get(u.itemId);
    if (ex) ex.quantity++;
    else map.set(u.itemId, { itemId: u.itemId, name: u.name, quantity: 1 });
  }
  return Array.from(map.values());
}

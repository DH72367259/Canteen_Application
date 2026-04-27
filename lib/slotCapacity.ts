/**
 * Phase 1 helpers: slot capacity, time slot generation, and extra-bin logic.
 *
 * All functions are pure and used by both the canteen dashboard (slot control
 * panel) and the user app (cart extra-bin popup, slot picker).
 */

export interface SlotCapacity {
  maxBins: number;
  /** 75% of maxBins — total orders accepted per slot */
  maxOrdersPerSlot: number;
  /** 70% of maxOrdersPerSlot — reserved for batched/prepared items */
  batchedPreparedCap: number;
  /** Remaining 30% — reserved for made-to-order items */
  madeToOrderCap: number;
  /** 25% buffer kept empty for late pickups / grace bins */
  bufferBins: number;
}

export function computeSlotCapacity(maxBins: number): SlotCapacity {
  if (!Number.isFinite(maxBins) || maxBins <= 0) {
    throw new Error('maxBins must be a positive number');
  }
  const maxOrdersPerSlot = Math.floor(maxBins * 0.75);
  const batchedPreparedCap = Math.floor(maxOrdersPerSlot * 0.7);
  const madeToOrderCap = maxOrdersPerSlot - batchedPreparedCap;
  const bufferBins = maxBins - maxOrdersPerSlot;
  return {
    maxBins,
    maxOrdersPerSlot,
    batchedPreparedCap,
    madeToOrderCap,
    bufferBins,
  };
}

export interface TimeSlot {
  start: string; // "HH:MM"
  end: string;   // "HH:MM"
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

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
 * Distribute cart lines into bins using:
 *  - meals: at most `mealsPerBin` meal-units per bin (default 2)
 *  - snacks: at most `snacksPerBin` snack-units per bin (default 5)
 * A "unit" = 1 quantity of an item. Items split across bins as needed.
 */
export function assignBins(
  items: CartLine[],
  mealsPerBin = 2,
  snacksPerBin = 5,
  extraBinFeePaise = 200
): BinPlan {
  if (mealsPerBin <= 0 || snacksPerBin <= 0) {
    throw new Error('per-bin caps must be positive');
  }
  const totalMeals = items
    .filter((i) => i.isMeal)
    .reduce((s, i) => s + i.quantity, 0);
  const totalSnacks = items
    .filter((i) => !i.isMeal)
    .reduce((s, i) => s + i.quantity, 0);

  const mealBinsNeeded = Math.ceil(totalMeals / mealsPerBin);
  const snackBinsNeeded = Math.ceil(totalSnacks / snacksPerBin);
  const binCount = Math.max(1, mealBinsNeeded, snackBinsNeeded);

  const bins: BinAssignment[] = Array.from({ length: binCount }, (_, i) => ({
    binIndex: i + 1,
    meals: [],
    snacks: [],
  }));

  // Pack meals
  let cursor = 0;
  for (const line of items.filter((i) => i.isMeal)) {
    let remaining = line.quantity;
    while (remaining > 0 && cursor < bins.length) {
      const used = bins[cursor].meals.reduce((s, m) => s + m.quantity, 0);
      const room = mealsPerBin - used;
      if (room <= 0) {
        cursor += 1;
        continue;
      }
      const take = Math.min(remaining, room);
      bins[cursor].meals.push({ itemId: line.itemId, name: line.name, quantity: take });
      remaining -= take;
      if (take === room) cursor += 1;
    }
  }

  // Pack snacks (independent cursor)
  cursor = 0;
  for (const line of items.filter((i) => !i.isMeal)) {
    let remaining = line.quantity;
    while (remaining > 0 && cursor < bins.length) {
      const used = bins[cursor].snacks.reduce((s, m) => s + m.quantity, 0);
      const room = snacksPerBin - used;
      if (room <= 0) {
        cursor += 1;
        continue;
      }
      const take = Math.min(remaining, room);
      bins[cursor].snacks.push({ itemId: line.itemId, name: line.name, quantity: take });
      remaining -= take;
      if (take === room) cursor += 1;
    }
  }

  const extraFeePaise = binCount > 1 ? extraBinFeePaise * (binCount - 1) : 0;
  return { bins, totalMeals, totalSnacks, extraFeePaise };
}

import {
  computeSlotCapacity,
  generateTimeSlots,
  requiresExtraBin,
  assignBins,
} from '../lib/slotCapacity';

describe('computeSlotCapacity', () => {
  it('60 bins → 45 orders, 31 batched, 14 made-to-order, 15 buffer', () => {
    const c = computeSlotCapacity(60);
    expect(c.maxOrdersPerSlot).toBe(45);
    expect(c.batchedPreparedCap).toBe(31); // floor(45 * 0.7)
    expect(c.madeToOrderCap).toBe(14);     // 45 - 31
    expect(c.bufferBins).toBe(15);
  });

  it('100 bins → 75 / 52 / 23 / 25 buffer', () => {
    const c = computeSlotCapacity(100);
    expect(c.maxOrdersPerSlot).toBe(75);
    expect(c.batchedPreparedCap).toBe(52);
    expect(c.madeToOrderCap).toBe(23);
    expect(c.bufferBins).toBe(25);
  });

  it('rejects non-positive', () => {
    expect(() => computeSlotCapacity(0)).toThrow();
    expect(() => computeSlotCapacity(-5)).toThrow();
  });
});

describe('generateTimeSlots', () => {
  it('07:00-11:00 / 15min → 16 slots starting at 07:00 ending at 11:00', () => {
    const slots = generateTimeSlots('07:00', '11:00', 15);
    expect(slots).toHaveLength(16);
    expect(slots[0]).toEqual({ start: '07:00', end: '07:15' });
    expect(slots[15]).toEqual({ start: '10:45', end: '11:00' });
  });

  it('11:30-17:00 / 20min → 16 slots', () => {
    const slots = generateTimeSlots('11:30', '17:00', 20);
    expect(slots).toHaveLength(16);
    expect(slots[0].start).toBe('11:30');
    expect(slots[slots.length - 1].end).toBe('16:50');
  });

  it('end before start returns empty', () => {
    expect(generateTimeSlots('11:00', '07:00', 15)).toEqual([]);
  });

  it('rejects bad times', () => {
    expect(() => generateTimeSlots('25:00', '11:00', 15)).toThrow();
    expect(() => generateTimeSlots('07:00', '11:00', 0)).toThrow();
  });
});

describe('requiresExtraBin', () => {
  it('2 meals → no extra bin', () => {
    expect(requiresExtraBin(2)).toEqual({ required: false, binCount: 1, extraFeePaise: 0 });
  });

  it('3 meals → extra bin, ₹2 fee', () => {
    expect(requiresExtraBin(3)).toEqual({ required: true, binCount: 2, extraFeePaise: 200 });
  });

  it('5 meals → 3 bins, ₹4 fee', () => {
    expect(requiresExtraBin(5)).toEqual({ required: true, binCount: 3, extraFeePaise: 400 });
  });

  it('0 meals → nothing', () => {
    expect(requiresExtraBin(0)).toEqual({ required: false, binCount: 0, extraFeePaise: 0 });
  });
});

describe('assignBins', () => {
  it('3 meals (1+1+1) → Bin1: 2 meals, Bin2: 1 meal, ₹2 fee', () => {
    const plan = assignBins([
      { itemId: 'a', name: 'Thali',   quantity: 1, isMeal: true },
      { itemId: 'b', name: 'Biryani', quantity: 1, isMeal: true },
      { itemId: 'c', name: 'Curry',   quantity: 1, isMeal: true },
    ]);
    expect(plan.bins).toHaveLength(2);
    expect(plan.totalMeals).toBe(3);
    expect(plan.extraFeePaise).toBe(200);
    const bin1Meals = plan.bins[0].meals.reduce((s, m) => s + m.quantity, 0);
    const bin2Meals = plan.bins[1].meals.reduce((s, m) => s + m.quantity, 0);
    expect(bin1Meals).toBe(2);
    expect(bin2Meals).toBe(1);
  });

  it('6 samosas (snacks) → 2 bins (5+1), ₹2 fee', () => {
    const plan = assignBins([
      { itemId: 's', name: 'Samosa', quantity: 6, isMeal: false },
    ]);
    expect(plan.bins).toHaveLength(2);
    expect(plan.totalSnacks).toBe(6);
    expect(plan.bins[0].snacks[0].quantity).toBe(5);
    expect(plan.bins[1].snacks[0].quantity).toBe(1);
    expect(plan.extraFeePaise).toBe(200);
  });

  it('2 meals + 5 snacks → 1 bin, no fee', () => {
    const plan = assignBins([
      { itemId: 'm', name: 'Thali',  quantity: 2, isMeal: true },
      { itemId: 's', name: 'Samosa', quantity: 5, isMeal: false },
    ]);
    expect(plan.bins).toHaveLength(1);
    expect(plan.extraFeePaise).toBe(0);
  });

  it('empty cart → 1 empty bin, no fee', () => {
    const plan = assignBins([]);
    expect(plan.bins).toHaveLength(1);
    expect(plan.totalMeals).toBe(0);
    expect(plan.totalSnacks).toBe(0);
    expect(plan.extraFeePaise).toBe(0);
  });
});

import {
  computeSlotCapacity,
  generateTimeSlots,
  requiresExtraBin,
  assignBins,
} from '../lib/slotCapacity';

describe('computeSlotCapacity', () => {
  it('60 bins → 60 orders, 36 batched, 24 made-to-order, 0 buffer', () => {
    const c = computeSlotCapacity(60);
    expect(c.maxOrdersPerSlot).toBe(60);   // 100% capacity
    expect(c.batchedPreparedCap).toBe(36); // 60% of 60
    expect(c.madeToOrderCap).toBe(24);     // 40% of 60
    expect(c.bufferBins).toBe(0);          // no buffer
  });

  it('100 bins → 100 orders, 60 batched, 40 made-to-order, 0 buffer', () => {
    const c = computeSlotCapacity(100);
    expect(c.maxOrdersPerSlot).toBe(100);  // 100% capacity
    expect(c.batchedPreparedCap).toBe(60); // 60% of 100
    expect(c.madeToOrderCap).toBe(40);     // 40% of 100
    expect(c.bufferBins).toBe(0);          // no buffer
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

// Fee model: every order pays per-bin (binCount × extraBinFeePaise).
// First bin is NOT free — every bin reservation is charged.
describe('requiresExtraBin', () => {
  it('2 meals → 1 bin, ₹2 fee (bin fee applies to all bins)', () => {
    expect(requiresExtraBin(2)).toEqual({ required: true, binCount: 1, extraFeePaise: 200 });
  });

  it('3 meals → 2 bins, ₹4 fee', () => {
    expect(requiresExtraBin(3)).toEqual({ required: true, binCount: 2, extraFeePaise: 400 });
  });

  it('5 meals → 3 bins, ₹6 fee', () => {
    expect(requiresExtraBin(5)).toEqual({ required: true, binCount: 3, extraFeePaise: 600 });
  });

  it('0 meals → nothing', () => {
    expect(requiresExtraBin(0)).toEqual({ required: false, binCount: 0, extraFeePaise: 0 });
  });
});

describe('assignBins', () => {
  // ── Meals only ────────────────────────────────────────────────────────────
  it('1 meal → 1 bin, ₹2 fee', () => {
    const plan = assignBins([{ itemId: 'a', name: 'Thali', quantity: 1, isMeal: true }]);
    expect(plan.bins).toHaveLength(1);
    expect(plan.extraFeePaise).toBe(200);
    expect(plan.bins[0].meals[0].quantity).toBe(1);
  });

  it('2 meals → 2 bins, ₹4 fee', () => {
    const plan = assignBins([{ itemId: 'a', name: 'Thali', quantity: 2, isMeal: true }]);
    expect(plan.bins).toHaveLength(2);
    expect(plan.extraFeePaise).toBe(400);
    // Each bin gets exactly 1 meal
    expect(plan.bins[0].meals[0].quantity).toBe(1);
    expect(plan.bins[1].meals[0].quantity).toBe(1);
  });

  it('3 meals (3 different items) → 3 bins, ₹6 fee', () => {
    const plan = assignBins([
      { itemId: 'a', name: 'Thali',   quantity: 1, isMeal: true },
      { itemId: 'b', name: 'Biryani', quantity: 1, isMeal: true },
      { itemId: 'c', name: 'Curry',   quantity: 1, isMeal: true },
    ]);
    expect(plan.bins).toHaveLength(3);
    expect(plan.totalMeals).toBe(3);
    expect(plan.extraFeePaise).toBe(600);
    expect(plan.bins[0].meals[0].quantity).toBe(1);
    expect(plan.bins[1].meals[0].quantity).toBe(1);
    expect(plan.bins[2].meals[0].quantity).toBe(1);
  });

  // ── Snacks only ───────────────────────────────────────────────────────────
  it('5 snacks → 1 bin, ₹2 fee', () => {
    const plan = assignBins([{ itemId: 's', name: 'Samosa', quantity: 5, isMeal: false }]);
    expect(plan.bins).toHaveLength(1);
    expect(plan.extraFeePaise).toBe(200);
    expect(plan.bins[0].snacks[0].quantity).toBe(5);
  });

  it('6 snacks → 2 bins (5+1), ₹4 fee', () => {
    const plan = assignBins([{ itemId: 's', name: 'Samosa', quantity: 6, isMeal: false }]);
    expect(plan.bins).toHaveLength(2);
    expect(plan.totalSnacks).toBe(6);
    expect(plan.bins[0].snacks[0].quantity).toBe(5);
    expect(plan.bins[1].snacks[0].quantity).toBe(1);
    expect(plan.extraFeePaise).toBe(400);
  });

  it('11 snacks → 3 bins (5+5+1), ₹6 fee', () => {
    const plan = assignBins([{ itemId: 's', name: 'Samosa', quantity: 11, isMeal: false }]);
    expect(plan.bins).toHaveLength(3);
    expect(plan.extraFeePaise).toBe(600);
  });

  it('snacks split across 2 item types, 6 total → 2 bins (5+1)', () => {
    const plan = assignBins([
      { itemId: 'a', name: 'Samosa', quantity: 3, isMeal: false },
      { itemId: 'b', name: 'Chai',   quantity: 3, isMeal: false },
    ]);
    expect(plan.bins).toHaveLength(2);
    expect(plan.extraFeePaise).toBe(400);
    const bin1Total = plan.bins[0].snacks.reduce((s, x) => s + x.quantity, 0);
    const bin2Total = plan.bins[1].snacks.reduce((s, x) => s + x.quantity, 0);
    expect(bin1Total).toBe(5);
    expect(bin2Total).toBe(1);
  });

  // ── Mixed meal + snacks ───────────────────────────────────────────────────
  it('1 meal + 3 snacks → 1 bin, ₹2 fee', () => {
    const plan = assignBins([
      { itemId: 'm', name: 'Thali',  quantity: 1, isMeal: true  },
      { itemId: 's', name: 'Samosa', quantity: 3, isMeal: false },
    ]);
    expect(plan.bins).toHaveLength(1);
    expect(plan.extraFeePaise).toBe(200);
    expect(plan.bins[0].meals[0].quantity).toBe(1);
    expect(plan.bins[0].snacks[0].quantity).toBe(3);
  });

  it('1 meal + 4 snacks → 2 bins (meal+3snacks | 1snack), ₹4 fee', () => {
    const plan = assignBins([
      { itemId: 'm', name: 'Thali',  quantity: 1, isMeal: true  },
      { itemId: 's', name: 'Samosa', quantity: 4, isMeal: false },
    ]);
    expect(plan.bins).toHaveLength(2);
    expect(plan.extraFeePaise).toBe(400);
    const bin1Snacks = plan.bins[0].snacks.reduce((s, x) => s + x.quantity, 0);
    const bin2Snacks = plan.bins[1].snacks.reduce((s, x) => s + x.quantity, 0);
    expect(plan.bins[0].meals[0].quantity).toBe(1);
    expect(bin1Snacks).toBe(3);
    expect(bin2Snacks).toBe(1);
  });

  it('2 meals + 3 snacks → 2 bins (meal+3snacks | meal+0), ₹4 fee', () => {
    const plan = assignBins([
      { itemId: 'm', name: 'Thali',  quantity: 2, isMeal: true },
      { itemId: 's', name: 'Samosa', quantity: 3, isMeal: false },
    ]);
    expect(plan.bins).toHaveLength(2);
    expect(plan.extraFeePaise).toBe(400);
    expect(plan.bins[0].meals[0].quantity).toBe(1);
    const bin1Snacks = plan.bins[0].snacks.reduce((s, x) => s + x.quantity, 0);
    expect(bin1Snacks).toBe(3);
  });

  it('2 meals + 5 snacks → 2 bins (meal+3snacks | meal+2snacks), ₹4 fee', () => {
    const plan = assignBins([
      { itemId: 'm', name: 'Thali',  quantity: 2, isMeal: true  },
      { itemId: 's', name: 'Samosa', quantity: 5, isMeal: false },
    ]);
    expect(plan.bins).toHaveLength(2);
    expect(plan.extraFeePaise).toBe(400);
    const b1s = plan.bins[0].snacks.reduce((s, x) => s + x.quantity, 0);
    const b2s = plan.bins[1].snacks.reduce((s, x) => s + x.quantity, 0);
    expect(b1s).toBe(3);
    expect(b2s).toBe(2);
  });

  it('2 meals + 7 snacks → 3 bins (meal+3snacks | meal+3snacks | 1snack), ₹6 fee', () => {
    const plan = assignBins([
      { itemId: 'm', name: 'Thali',  quantity: 2, isMeal: true  },
      { itemId: 's', name: 'Samosa', quantity: 7, isMeal: false },
    ]);
    expect(plan.bins).toHaveLength(3);
    expect(plan.extraFeePaise).toBe(600);
    const b1s = plan.bins[0].snacks.reduce((s, x) => s + x.quantity, 0);
    const b2s = plan.bins[1].snacks.reduce((s, x) => s + x.quantity, 0);
    const b3s = plan.bins[2].snacks.reduce((s, x) => s + x.quantity, 0);
    expect(b1s).toBe(3);
    expect(b2s).toBe(3);
    expect(b3s).toBe(1);
  });

  it('snacks correctly allocated across 2 item types with 2 meals (regression: no double-pack)', () => {
    // Bug scenario: 2 meals, 4 snacks (3 Samosa + 1 Chai)
    // Old code would duplicate Samosa into Bin2; new flat-pool prevents this
    const plan = assignBins([
      { itemId: 'm',  name: 'Thali',  quantity: 2, isMeal: true  },
      { itemId: 's1', name: 'Samosa', quantity: 3, isMeal: false },
      { itemId: 's2', name: 'Chai',   quantity: 1, isMeal: false },
    ]);
    expect(plan.bins).toHaveLength(2);
    const totalSnackUnits = plan.bins.flatMap(b => b.snacks).reduce((s, x) => s + x.quantity, 0);
    expect(totalSnackUnits).toBe(4); // exactly 4, not duplicated
  });

  it('empty cart → 1 empty bin, ₹0 fee', () => {
    const plan = assignBins([]);
    expect(plan.bins).toHaveLength(1);
    expect(plan.totalMeals).toBe(0);
    expect(plan.totalSnacks).toBe(0);
    expect(plan.extraFeePaise).toBe(0);
  });

  it('custom fee: 2 meals → 2 bins, ₹10 fee (2 bins × ₹5)', () => {
    const plan = assignBins(
      [{ itemId: 'a', name: 'Thali', quantity: 2, isMeal: true }],
      1, 3, 500  // ₹5 per bin
    );
    expect(plan.bins).toHaveLength(2);
    expect(plan.extraFeePaise).toBe(1000);
  });
});

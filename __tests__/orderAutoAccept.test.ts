import { autoAcceptPlacedOrders } from "@/lib/orderAutoAccept";

// ── Helpers ────────────────────────────────────────────────────────────────

const IST_MS = 5.5 * 60 * 60 * 1000;

/** 60 s ago — always old enough for the 35 s synthetic-label fallback. */
function oldEnough(): string {
  return new Date(Date.now() - 60_000).toISOString();
}

/** Returns a slot label string whose start is `offsetMs` ms from now in IST. */
function slotLabelOffset(offsetMs: number): string {
  const utcMs = Date.now() + offsetMs;
  const istMs = utcMs + IST_MS;
  const ist   = new Date(istMs);
  const h     = ist.getUTCHours();
  const m     = ist.getUTCMinutes();
  const ampm  = h >= 12 ? "PM" : "AM";
  const h12   = h % 12 || 12;
  const mm    = String(m).padStart(2, "0");
  return `${h12}:${mm} ${ampm} - end`;
}

// ── Mock factory ───────────────────────────────────────────────────────────
//
// The Supabase query builder is thenable: `await q` works at any point in the
// chain. We reproduce that by adding `.then` to every builder object returned
// after `.select()`, so `await q` resolves to { data, error: null } whether
// the chain ends at one `.eq()` or several.
//
// Chain built by the implementation:
//   from("orders").select(...).eq("status","placed")[.eq(...)...]   → await → data
//   from("orders").update({...}).in("id",[...]).eq("status","placed").select("id") → await → data

function createMock(
  placedOrders: Array<{ id: string; slot_label: string; created_at: string }>,
  updateReturns: Array<{ id: string }> = [],
) {
  const selectData = { data: placedOrders, error: null as null };

  // Each .eq() call returns a thenable builder so `await q` works at any depth
  function makeEq(): jest.Mock {
    return jest.fn(() => ({
      eq: makeEq(),
      then: (resolve: (v: typeof selectData) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(selectData).then(resolve, reject),
    }));
  }

  const selectFn = jest.fn((_cols: string) => ({ eq: makeEq() }));

  // update chain
  const updateSelect  = jest.fn().mockResolvedValue({ data: updateReturns, error: null });
  const updateEqStat  = jest.fn(() => ({ select: updateSelect }));
  const updateIn      = jest.fn(() => ({ eq: updateEqStat }));
  const updateFn      = jest.fn(() => ({ in: updateIn }));

  const from = jest.fn(() => ({ select: selectFn, update: updateFn }));

  return {
    client: { from },
    spies: { from, selectFn, updateFn, updateIn, updateEqStat, updateSelect },
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("autoAcceptPlacedOrders", () => {
  it("accepts orders whose slot start time has already passed in IST", async () => {
    const orders = [{ id: "o-1", slot_label: slotLabelOffset(-60_000), created_at: oldEnough() }];
    const mock   = createMock(orders, [{ id: "o-1" }]);

    const result = await autoAcceptPlacedOrders({ supabase: mock.client as never });

    expect(result.updatedCount).toBe(1);
    expect(mock.spies.updateFn).toHaveBeenCalledWith(expect.objectContaining({ status: "confirmed" }));
    expect(mock.spies.updateIn).toHaveBeenCalledWith("id", ["o-1"]);
  });

  it("does NOT accept orders whose slot has not started yet", async () => {
    const orders = [{ id: "o-2", slot_label: slotLabelOffset(2 * 60 * 60_000), created_at: new Date().toISOString() }];
    const mock   = createMock(orders);

    const result = await autoAcceptPlacedOrders({ supabase: mock.client as never });

    expect(result.updatedCount).toBe(0);
    expect(mock.spies.updateFn).not.toHaveBeenCalled();
  });

  it("falls back to 35 s age guard for synthetic (non-parseable) slot labels", async () => {
    const orders = [{ id: "o-3", slot_label: "E2E-MOV-12345678", created_at: oldEnough() }];
    const mock   = createMock(orders, [{ id: "o-3" }]);

    const result = await autoAcceptPlacedOrders({ supabase: mock.client as never });

    expect(result.updatedCount).toBe(1);
    expect(mock.spies.updateIn).toHaveBeenCalledWith("id", ["o-3"]);
  });

  it("does NOT accept synthetic orders newer than 35 s", async () => {
    const orders = [{ id: "o-4", slot_label: "E2E-LABEL", created_at: new Date().toISOString() }];
    const mock   = createMock(orders);

    const result = await autoAcceptPlacedOrders({ supabase: mock.client as never });

    expect(result.updatedCount).toBe(0);
    expect(mock.spies.updateFn).not.toHaveBeenCalled();
  });

  it("returns updatedCount 0 when no placed orders exist", async () => {
    const mock   = createMock([]);
    const result = await autoAcceptPlacedOrders({ supabase: mock.client as never });

    expect(result.updatedCount).toBe(0);
    expect(mock.spies.updateFn).not.toHaveBeenCalled();
  });

  it("queries by canteenId when provided", async () => {
    const mock = createMock([], []);

    await autoAcceptPlacedOrders({ supabase: mock.client as never, canteenId: "c-1" });

    expect(mock.spies.selectFn).toHaveBeenCalledWith("id, slot_label, created_at");
  });

  it("queries by userId when provided", async () => {
    const mock = createMock([], []);

    await autoAcceptPlacedOrders({ supabase: mock.client as never, userId: "u-1" });

    expect(mock.spies.selectFn).toHaveBeenCalledWith("id, slot_label, created_at");
  });
});

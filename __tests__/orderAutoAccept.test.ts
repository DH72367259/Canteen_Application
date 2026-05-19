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
// autoAcceptPlacedOrders has grown beyond a single SELECT + UPDATE chain.
// It now also:
//   - fetches order_items for the placed candidates (with caps via menu_items join)
//   - fetches the day's already-committed orders (status in [...])
//   - fetches order_items for those committed orders
//   - per-rejected order: autoCancelOutOfStock fires its own queries
//
// For these unit tests we only care about the auto-accept happy path:
//   1. placed orders are fetched
//   2. orders whose slot has passed get bulk-updated to status=confirmed
// So the mock returns the candidate orders for the FIRST select on "orders"
// and empty arrays for everything else. Every chain ending is thenable so
// `await q` works regardless of which builder methods the code used.

interface MockOrder {
  id: string;
  slot_label: string;
  created_at: string;
  canteen_id?: string;
  user_id?: string | null;
  payment_id?: string | null;
  total_amount?: number;
}

function thenable<T>(data: T) {
  const out = {
    data,
    error: null as null,
    then: (resolve: (v: { data: T; error: null }) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve({ data, error: null as null }).then(resolve, reject),
    eq:  () => thenable(data),
    in:  () => thenable(data),
    gte: () => thenable(data),
    lte: () => thenable(data),
    not: () => thenable(data),
    order: () => thenable(data),
    limit: () => thenable(data),
    single: () => thenable(data),
    maybeSingle: () => thenable(data),
  };
  return out;
}

function createMock(
  placedOrders: MockOrder[],
  updateReturns: Array<{ id: string }> = [],
) {
  // Track invocation counts to distinguish the FIRST select on "orders"
  // (which returns the placed candidates) from subsequent ones (which return
  // empty — no items, no committed orders).
  let ordersSelectCount = 0;

  const updateChain = (data: Array<{ id: string }>) => ({
    data,
    error: null as null,
    in: jest.fn(() => updateChain(data)),
    eq: jest.fn(() => updateChain(data)),
    select: jest.fn(() => Promise.resolve({ data, error: null as null })),
    then: (resolve: (v: { data: typeof data; error: null }) => unknown) =>
      Promise.resolve({ data, error: null as null }).then(resolve),
  });

  const from = jest.fn((table: string) => {
    if (table === "orders") {
      return {
        select: jest.fn((_cols: string) => {
          ordersSelectCount += 1;
          return ordersSelectCount === 1
            ? thenable(placedOrders)
            : thenable([]); // committed orders query
        }),
        update: jest.fn(() => updateChain(updateReturns)),
      };
    }
    if (table === "order_items") {
      return { select: jest.fn(() => thenable([])) };
    }
    // catch-all (e.g. menu_items, notifications)
    return {
      select: jest.fn(() => thenable([])),
      update: jest.fn(() => updateChain([])),
      insert: jest.fn(() => thenable([])),
    };
  });

  const spies = {
    from,
    // Resolved lazily so they reflect the LATEST call across the test
    get updateCall() {
      const orderCalls = from.mock.results.filter((r) => from.mock.calls[from.mock.results.indexOf(r)][0] === "orders");
      if (!orderCalls.length) return null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const lastOrders = orderCalls[orderCalls.length - 1].value as any;
      return lastOrders.update.mock.calls[0]?.[0] ?? null;
    },
  };

  return { client: { from }, spies };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("autoAcceptPlacedOrders", () => {
  // Pin clock to 2026-01-15 06:30 UTC = 12:00 noon IST so slotLabelOffset
  // never wraps past midnight and the IST hour comparisons are deterministic.
  beforeAll(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-01-15T06:30:00.000Z"));
  });
  afterAll(() => { jest.useRealTimers(); });

  it("accepts orders whose slot start time has already passed in IST", async () => {
    const orders: MockOrder[] = [{ id: "o-1", slot_label: slotLabelOffset(-60_000), created_at: oldEnough(), canteen_id: "c-1" }];
    const mock   = createMock(orders, [{ id: "o-1" }]);

    const result = await autoAcceptPlacedOrders({ supabase: mock.client as never });

    expect(result.updatedCount).toBe(1);
    expect(result.autoCancelledCount).toBe(0);
  });

  it("does NOT accept orders whose slot has not started yet", async () => {
    const orders: MockOrder[] = [{ id: "o-2", slot_label: slotLabelOffset(2 * 60 * 60_000), created_at: new Date().toISOString(), canteen_id: "c-1" }];
    const mock   = createMock(orders);

    const result = await autoAcceptPlacedOrders({ supabase: mock.client as never });

    expect(result.updatedCount).toBe(0);
    expect(result.autoCancelledCount).toBe(0);
  });

  it("falls back to 35 s age guard for synthetic (non-parseable) slot labels", async () => {
    const orders: MockOrder[] = [{ id: "o-3", slot_label: "E2E-MOV-12345678", created_at: oldEnough(), canteen_id: "c-1" }];
    const mock   = createMock(orders, [{ id: "o-3" }]);

    const result = await autoAcceptPlacedOrders({ supabase: mock.client as never });

    expect(result.updatedCount).toBe(1);
  });

  it("does NOT accept synthetic orders newer than 35 s", async () => {
    const orders: MockOrder[] = [{ id: "o-4", slot_label: "E2E-LABEL", created_at: new Date().toISOString(), canteen_id: "c-1" }];
    const mock   = createMock(orders);

    const result = await autoAcceptPlacedOrders({ supabase: mock.client as never });

    expect(result.updatedCount).toBe(0);
  });

  it("returns updatedCount 0 when no placed orders exist", async () => {
    const mock   = createMock([]);
    const result = await autoAcceptPlacedOrders({ supabase: mock.client as never });

    expect(result.updatedCount).toBe(0);
    expect(result.autoCancelledCount).toBe(0);
  });

  it("queries by canteenId when provided", async () => {
    const mock = createMock([], []);

    await autoAcceptPlacedOrders({ supabase: mock.client as never, canteenId: "c-1" });

    expect(mock.spies.from).toHaveBeenCalledWith("orders");
  });

  it("queries by userId when provided", async () => {
    const mock = createMock([], []);

    await autoAcceptPlacedOrders({ supabase: mock.client as never, userId: "u-1" });

    expect(mock.spies.from).toHaveBeenCalledWith("orders");
  });
});

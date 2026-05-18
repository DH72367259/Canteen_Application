/**
 * Tests for Phase 4 user-app discovery + cart APIs:
 *   - GET  /api/canteens
 *   - GET  /api/canteens/colleges
 *   - POST /api/cart/check
 */

const mockGetRequestContext = jest.fn();
jest.mock("@/lib/authServer", () => ({
  getRequestContext: (...args: unknown[]) => mockGetRequestContext(...args),
}));

interface QB {
  select: jest.Mock; insert: jest.Mock; update: jest.Mock; delete: jest.Mock;
  eq: jest.Mock; in: jest.Mock; or: jest.Mock; ilike: jest.Mock; not: jest.Mock; gte: jest.Mock;
  order: jest.Mock; limit: jest.Mock; single: jest.Mock; maybeSingle: jest.Mock;
}
function makeQB(): QB {
  const qb: Partial<QB> = {};
  qb.select = jest.fn(() => qb as QB);
  qb.insert = jest.fn(() => qb as QB);
  qb.update = jest.fn(() => qb as QB);
  qb.delete = jest.fn(() => qb as QB);
  qb.eq = jest.fn(() => qb as QB);
  qb.in = jest.fn(() => qb as QB);
  qb.or = jest.fn(() => qb as QB);
  qb.ilike = jest.fn(() => qb as QB);
  qb.not = jest.fn(() => qb as QB);
  qb.gte = jest.fn(() => qb as QB);
  qb.order = jest.fn().mockResolvedValue({ data: [], error: null });
  qb.limit = jest.fn(() => qb as QB);
  qb.single = jest.fn().mockResolvedValue({ data: null, error: null });
  qb.maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
  return qb as QB;
}

let canteensQB: QB;
let scQB: QB;
let menuQB: QB;
let ordersQB: QB;

jest.mock("@/lib/supabase-server", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "canteens")     return canteensQB;
      if (table === "slot_control") return scQB;
      if (table === "menu_items")   return menuQB;
      if (table === "orders")       return ordersQB;
      return makeQB();
    },
  }),
}));

import { GET as canteensGET } from "@/app/api/canteens/route";
import { GET as collegesGET } from "@/app/api/canteens/colleges/route";
import { POST as cartCheckPOST } from "@/app/api/cart/check/route";

const USER = { uid: "u-1", role: "user" as const, canteenId: undefined };

beforeEach(() => {
  jest.clearAllMocks();
  canteensQB = makeQB();
  scQB       = makeQB();
  menuQB     = makeQB();
  ordersQB   = makeQB();
});

// ── canteens list ────────────────────────────────────────────────────
describe("GET /api/canteens", () => {
  it("returns active canteens, sorted by distance when coords provided", async () => {
    canteensQB.order.mockResolvedValueOnce({
      data: [
        { id: "c1", name: "Far Cafe",  college: "ABC", city: "X", address: null, lat: 12.99, lng: 77.59, status: "open", is_active: true },
        { id: "c2", name: "Near Cafe", college: "ABC", city: "X", address: null, lat: 12.97, lng: 77.59, status: "open", is_active: true },
      ],
      error: null,
    });
    const res = await canteensGET(new Request("http://l/api/canteens?lat=12.97&lng=77.59&radius_km=10"));
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.canteens).toHaveLength(2);
    expect(j.canteens[0].id).toBe("c2"); // nearer first
    expect(j.canteens[0].distance_km).toBeLessThan(j.canteens[1].distance_km);
  });

  it("filters by college (ilike)", async () => {
    canteensQB.order.mockResolvedValueOnce({ data: [], error: null });
    await canteensGET(new Request("http://l/api/canteens?college=IIT%20Delhi"));
    expect(canteensQB.ilike).toHaveBeenCalledWith("college", "IIT Delhi");
  });

  it("applies search across multiple columns via .or()", async () => {
    canteensQB.order.mockResolvedValueOnce({ data: [], error: null });
    await canteensGET(new Request("http://l/api/canteens?search=mess"));
    expect(canteensQB.or).toHaveBeenCalled();
    const arg = (canteensQB.or.mock.calls[0][0] as string);
    expect(arg).toContain("name.ilike.%mess%");
    expect(arg).toContain("college.ilike.%mess%");
  });

  it("excludes canteens outside radius_km", async () => {
    canteensQB.order.mockResolvedValueOnce({
      data: [
        { id: "near", name: "A", college: null, city: null, address: null, lat: 12.97, lng: 77.59, status: "open", is_active: true },
        { id: "far",  name: "B", college: null, city: null, address: null, lat: 13.50, lng: 78.50, status: "open", is_active: true }, // ~120 km away
      ],
      error: null,
    });
    const res = await canteensGET(new Request("http://l/api/canteens?lat=12.97&lng=77.59&radius_km=10"));
    const j = await res.json();
    expect(j.canteens.map((c: { id: string }) => c.id)).toEqual(["near"]);
  });
});

// ── colleges dropdown ────────────────────────────────────────────────
describe("GET /api/canteens/colleges", () => {
  it("returns sorted distinct college names", async () => {
    // Replace the chain so the .not() call resolves directly
    canteensQB.not = jest.fn().mockResolvedValueOnce({
      data: [
        { college: "BITS Pilani" },
        { college: "IIT Delhi" },
        { college: "BITS Pilani" }, // duplicate
        { college: "  IIT Bombay  " }, // whitespace
        { college: null },
      ],
      error: null,
    });
    const res = await collegesGET();
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.colleges).toEqual(["BITS Pilani", "IIT Bombay", "IIT Delhi"]);
  });
});

// ── cart check ───────────────────────────────────────────────────────
describe("POST /api/cart/check", () => {
  function reqBody(body: unknown) {
    return new Request("http://l/api/cart/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  beforeEach(() => mockGetRequestContext.mockResolvedValue(USER));

  it("rejects unauthenticated requests", async () => {
    mockGetRequestContext.mockResolvedValueOnce(null);
    const res = await cartCheckPOST(reqBody({ canteen_id: "11111111-1111-1111-1111-111111111111", slot: "12:30 PM", items: [{ id: "22222222-2222-2222-2222-222222222222", quantity: 1 }] }));
    expect(res.status).toBe(401);
  });

  it("rejects empty items", async () => {
    const res = await cartCheckPOST(reqBody({ canteen_id: "11111111-1111-1111-1111-111111111111", slot: "12:30 PM", items: [] }));
    expect(res.status).toBe(400);
  });

  it("auto-creates default slot_control when missing (self-healing for legacy canteens)", async () => {
    // Older canteens lacked a slot_control row; cart/check now lazily inserts
    // sane defaults via lib/slotControlEnsure rather than 404'ing.
    scQB.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    scQB.single.mockResolvedValueOnce({
      data: { canteen_id: "11111111-1111-1111-1111-111111111111", max_bins: 60, slot_duration_mins: 15, meals_per_bin: 1, snacks_per_bin: 4, extra_bin_fee_paise: 0 },
      error: null,
    });
    // Cart item lookup returns one item that matches the canteen so the rest
    // of the handler can complete successfully.
    menuQB.in = jest.fn().mockResolvedValueOnce({
      data: [{ id: "22222222-2222-2222-2222-222222222222", name: "Thali", is_meal: true, canteen_id: "11111111-1111-1111-1111-111111111111" }], error: null,
    });
    ordersQB.not.mockResolvedValueOnce({ data: [], error: null });

    const res = await cartCheckPOST(reqBody({ canteen_id: "11111111-1111-1111-1111-111111111111", slot: "12:30 PM", items: [{ id: "22222222-2222-2222-2222-222222222222", quantity: 1 }] }));
    expect(res.status).toBe(200);
    // The lazy insert was attempted on the slot_control table.
    expect(scQB.insert).toHaveBeenCalled();
  });

  it("rejects items not belonging to the canteen", async () => {
    scQB.maybeSingle.mockResolvedValueOnce({
      data: { max_bins: 60, meals_per_bin: 2, snacks_per_bin: 5, extra_bin_fee_paise: 200 }, error: null,
    });
    menuQB.in = jest.fn().mockResolvedValueOnce({
      data: [{ id: "22222222-2222-2222-2222-222222222222", name: "Thali", is_meal: true, canteen_id: "33333333-3333-3333-3333-333333333333" }], error: null,
    });
    const res = await cartCheckPOST(reqBody({ canteen_id: "11111111-1111-1111-1111-111111111111", slot: "12:30 PM", items: [{ id: "22222222-2222-2222-2222-222222222222", quantity: 1 }] }));
    const j = await res.json();
    expect(res.status).toBe(400);
    expect(j.error).toMatch(/does not belong/);
  });

  it("computes bin plan and flags requires_extra_bin when meals exceed mealsPerBin", async () => {
    scQB.maybeSingle.mockResolvedValueOnce({
      data: { max_bins: 60, meals_per_bin: 2, snacks_per_bin: 5, extra_bin_fee_paise: 200 }, error: null,
    });
    menuQB.in = jest.fn().mockResolvedValueOnce({
      data: [{ id: "22222222-2222-2222-2222-222222222222", name: "Thali", is_meal: true, canteen_id: "11111111-1111-1111-1111-111111111111" }], error: null,
    });
    // No existing orders for this slot (called twice: once in getMenuItemUsageForToday, once in getSlotAvailabilityUsage)
    ordersQB.not = jest.fn()
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [], error: null });

    const res = await cartCheckPOST(reqBody({
      canteen_id: "11111111-1111-1111-1111-111111111111", slot: "12:30 PM",
      items: [{ id: "22222222-2222-2222-2222-222222222222", quantity: 5 }], // 5 meals → 5 bins (1 per bin)
    }));
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.slot_available).toBe(true);
    expect(j.requires_extra_bin).toBe(true);
    expect(j.bin_plan.bins).toHaveLength(5); // 1 meal per bin = 5 bins
    expect(j.extra_fee_paise).toBe(800); // 4 extra bins × ₹2 (first bin free)
    expect(j.slot_capacity.maxOrdersPerSlot).toBe(60); // 100% capacity
  });

  it("flags slot_full when existing orders >= maxOrdersPerSlot", async () => {
    scQB.maybeSingle.mockResolvedValueOnce({
      data: { max_bins: 60, meals_per_bin: 2, snacks_per_bin: 5, extra_bin_fee_paise: 200 }, error: null,
    });
    menuQB.in = jest.fn().mockResolvedValueOnce({
      data: [{ id: "22222222-2222-2222-2222-222222222222", name: "Samosa", is_meal: false, canteen_id: "11111111-1111-1111-1111-111111111111" }], error: null,
    });
    // 60 existing orders → at cap (called twice: once in getMenuItemUsageForToday, once in getSlotAvailabilityUsage)
    const existingOrders = Array.from({ length: 60 }, (_, i) => ({ id: `o${i}` }));
    ordersQB.not = jest.fn()
      .mockResolvedValueOnce({ data: existingOrders, error: null })
      .mockResolvedValueOnce({ data: existingOrders, error: null });

    const res = await cartCheckPOST(reqBody({
      canteen_id: "11111111-1111-1111-1111-111111111111", slot: "12:30 PM",
      items: [{ id: "22222222-2222-2222-2222-222222222222", quantity: 2 }],
    }));
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.slot_full).toBe(true);
    expect(j.slot_available).toBe(false);
    expect(j.slot_orders_used).toBe(60); // 100% capacity
  });
});

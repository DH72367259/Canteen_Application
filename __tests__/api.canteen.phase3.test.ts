/**
 * Tests for canteen-admin Phase 3 APIs:
 *   - GET/PATCH /api/canteen/slot-control
 *   - GET       /api/canteen/prep-summary
 *   - POST/PATCH/DELETE /api/canteen/menu
 */

const mockGetRequestContext = jest.fn();
jest.mock("@/lib/authServer", () => ({
  getRequestContext: (...args: unknown[]) => mockGetRequestContext(...args),
}));

interface QB {
  select: jest.Mock; insert: jest.Mock; update: jest.Mock; delete: jest.Mock;
  eq: jest.Mock; in: jest.Mock; order: jest.Mock; limit: jest.Mock;
  single: jest.Mock; maybeSingle: jest.Mock;
}
function makeQB(): QB {
  const qb: Partial<QB> = {};
  qb.select = jest.fn(() => qb as QB);
  qb.insert = jest.fn(() => qb as QB);
  qb.update = jest.fn(() => qb as QB);
  qb.delete = jest.fn(() => qb as QB);
  qb.eq = jest.fn(() => qb as QB);
  qb.in = jest.fn(() => qb as QB);
  qb.order = jest.fn(() => qb as QB);
  qb.limit = jest.fn(() => qb as QB);
  qb.single = jest.fn().mockResolvedValue({ data: null, error: null });
  qb.maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
  return qb as QB;
}

let scQB: QB;       // slot_control
let menuQB: QB;     // menu_items
let ordersQB: QB;   // orders
let binsQB: QB;     // bins

jest.mock("@/lib/supabase-server", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "slot_control") return scQB;
      if (table === "menu_items") return menuQB;
      if (table === "orders") return ordersQB;
      if (table === "bins") return binsQB;
      return makeQB();
    },
  }),
}));

import { GET as scGET, PATCH as scPATCH } from "@/app/api/canteen/slot-control/route";
import { GET as prepGET } from "@/app/api/canteen/prep-summary/route";
import { POST as menuPOST } from "@/app/api/canteen/menu/route";
import { PATCH as menuPATCH, DELETE as menuDELETE } from "@/app/api/canteen/menu/[id]/route";

const ADMIN = { uid: "ca-1", role: "canteen_admin" as const, canteenId: "c-1" };
const USER  = { uid: "u-1",  role: "user" as const, canteenId: undefined };

beforeEach(() => {
  jest.clearAllMocks();
  scQB = makeQB(); menuQB = makeQB(); ordersQB = makeQB(); binsQB = makeQB();
});

// ── slot-control ──────────────────────────────────────────────────────
describe("GET /api/canteen/slot-control", () => {
  it("returns slot_control + computed capacity + windows", async () => {
    mockGetRequestContext.mockResolvedValue(ADMIN);
    scQB.single.mockResolvedValueOnce({
      data: {
        canteen_id: "c-1", max_bins: 60, slot_duration_mins: 15,
        morning_start: "07:00:00", morning_end: "11:00:00",
        afternoon_start: "11:30:00", afternoon_end: "17:00:00",
        evening_start: "18:00:00", evening_end: "21:30:00",
        grace_period_mins: 10, extra_bin_fee_paise: 200,
        meals_per_bin: 2, snacks_per_bin: 5,
        max_orders_per_slot: 45, batched_prepared_cap: 31, made_to_order_cap: 14,
      },
      error: null,
    });
    const res = await scGET(new Request("http://l/api/canteen/slot-control"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.capacity).toEqual({
      maxBins: 60, maxOrdersPerSlot: 45, batchedPreparedCap: 31, madeToOrderCap: 14, bufferBins: 15,
    });
    expect(json.windows.morning.length).toBe(16);
  });

  it("forbids regular users", async () => {
    mockGetRequestContext.mockResolvedValue(USER);
    const res = await scGET(new Request("http://l/api/canteen/slot-control"));
    expect(res.status).toBe(403);
  });
});

describe("PATCH /api/canteen/slot-control", () => {
  it("updates max_bins and returns recomputed capacity", async () => {
    mockGetRequestContext.mockResolvedValue(ADMIN);
    scQB.single.mockResolvedValueOnce({
      data: {
        canteen_id: "c-1", max_bins: 100, slot_duration_mins: 15,
        morning_start: "07:00:00", morning_end: "11:00:00",
        afternoon_start: "11:30:00", afternoon_end: "17:00:00",
        evening_start: "18:00:00", evening_end: "21:30:00",
        grace_period_mins: 10, extra_bin_fee_paise: 200,
        meals_per_bin: 2, snacks_per_bin: 5,
        max_orders_per_slot: 75, batched_prepared_cap: 52, made_to_order_cap: 23,
      },
      error: null,
    });
    const res = await scPATCH(new Request("http://l/api/canteen/slot-control", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ max_bins: 100 }),
    }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.capacity.maxOrdersPerSlot).toBe(75);
    expect(scQB.update).toHaveBeenCalled();
    const updateArg = (scQB.update as jest.Mock).mock.calls[0][0];
    expect(updateArg.max_bins).toBe(100);
  });

  it("rejects invalid slot_duration_mins", async () => {
    mockGetRequestContext.mockResolvedValue(ADMIN);
    const res = await scPATCH(new Request("http://l/api/canteen/slot-control", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slot_duration_mins: 7 }),
    }));
    expect(res.status).toBe(400);
  });

  it("rejects empty body", async () => {
    mockGetRequestContext.mockResolvedValue(ADMIN);
    const res = await scPATCH(new Request("http://l/api/canteen/slot-control", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }));
    expect(res.status).toBe(400);
  });
});

// ── prep-summary ──────────────────────────────────────────────────────
describe("GET /api/canteen/prep-summary", () => {
  it("groups by slot and splits batched vs made_to_order", async () => {
    mockGetRequestContext.mockResolvedValue(ADMIN);
    // Override the order chain to resolve with our orders
    ordersQB.limit = jest.fn().mockResolvedValue({
      data: [
        {
          id: "o1", status: "preparing", pickup_slot: "12:00",
          time_slots: { slot_name: "12:00" },
          order_items: [
            { quantity: 2, menu_items: { name: "Thali", availability_type: "batched_prepared", is_meal: true } },
            { quantity: 1, menu_items: { name: "Dosa", availability_type: "slot_based", is_meal: true } },
          ],
        },
        {
          id: "o2", status: "confirmed", pickup_slot: "12:00",
          time_slots: { slot_name: "12:00" },
          order_items: [
            { quantity: 3, menu_items: { name: "Thali", availability_type: "batched_prepared", is_meal: true } },
          ],
        },
      ],
      error: null,
    });
    scQB.maybeSingle.mockResolvedValueOnce({
      data: { batched_prepared_cap: 31, made_to_order_cap: 14, max_orders_per_slot: 45, max_bins: 60 },
      error: null,
    });
    const res = await prepGET(new Request("http://l/api/canteen/prep-summary"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.slots).toHaveLength(1);
    expect(json.slots[0].batched.find((x: { name: string }) => x.name === "Thali").quantity).toBe(5);
    expect(json.slots[0].made_to_order.find((x: { name: string }) => x.name === "Dosa").quantity).toBe(1);
    expect(json.caps.max_orders_per_slot).toBe(45);
  });
});

// ── menu CRUD ─────────────────────────────────────────────────────────
describe("POST /api/canteen/menu", () => {
  it("creates item with Phase 1 fields (is_meal, availability_type)", async () => {
    mockGetRequestContext.mockResolvedValue(ADMIN);
    menuQB.single.mockResolvedValueOnce({ data: { id: "i-1", name: "Thali", is_meal: true }, error: null });

    const res = await menuPOST(new Request("http://l/api/canteen/menu", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Thali", price: 120, is_meal: true,
        availability_type: "batched_prepared",
      }),
    }));
    expect(res.status).toBe(201);
    const arg = (menuQB.insert as jest.Mock).mock.calls[0][0];
    expect(arg.is_meal).toBe(true);
    expect(arg.availability_type).toBe("batched_prepared");
    expect(arg.canteen_id).toBe("c-1");
  });

  it("rejects bad availability_type", async () => {
    mockGetRequestContext.mockResolvedValue(ADMIN);
    const res = await menuPOST(new Request("http://l/api/canteen/menu", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "X", price: 10, availability_type: "bogus" }),
    }));
    expect(res.status).toBe(400);
  });

  it("requires name + valid price", async () => {
    mockGetRequestContext.mockResolvedValue(ADMIN);
    const res = await menuPOST(new Request("http://l/api/canteen/menu", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "", price: -5 }),
    }));
    expect(res.status).toBe(400);
  });

  it("forbids regular user", async () => {
    mockGetRequestContext.mockResolvedValue(USER);
    const res = await menuPOST(new Request("http://l/api/canteen/menu", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "X", price: 10 }),
    }));
    expect(res.status).toBe(403);
  });
});

describe("PATCH /api/canteen/menu/[id]", () => {
  it("updates is_sold_out / is_hidden flags", async () => {
    mockGetRequestContext.mockResolvedValue(ADMIN);
    // First single() = scope check → returns canteen match
    menuQB.single
      .mockResolvedValueOnce({ data: { canteen_id: "c-1" }, error: null })  // scope check
      .mockResolvedValueOnce({ data: { id: "i-1", is_sold_out: true }, error: null });

    const res = await menuPATCH(
      new Request("http://l/api/canteen/menu/i-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_sold_out: true, is_hidden: false }),
      }),
      { params: Promise.resolve({ id: "i-1" }) },
    );
    expect(res.status).toBe(200);
    const arg = (menuQB.update as jest.Mock).mock.calls[0][0];
    expect(arg.is_sold_out).toBe(true);
    expect(arg.is_hidden).toBe(false);
  });

  it("blocks cross-canteen edit", async () => {
    mockGetRequestContext.mockResolvedValue(ADMIN);
    menuQB.single.mockResolvedValueOnce({ data: { canteen_id: "OTHER" }, error: null });
    const res = await menuPATCH(
      new Request("http://l/api/canteen/menu/i-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_sold_out: true }),
      }),
      { params: Promise.resolve({ id: "i-1" }) },
    );
    expect(res.status).toBe(403);
  });
});

describe("DELETE /api/canteen/menu/[id]", () => {
  it("deletes own canteen item", async () => {
    mockGetRequestContext.mockResolvedValue(ADMIN);
    // scope check (select.eq.single)
    menuQB.single.mockResolvedValueOnce({ data: { canteen_id: "c-1" }, error: null });
    // delete().eq() must resolve to {error:null}
    const deleteEq = jest.fn().mockResolvedValue({ error: null });
    menuQB.delete = jest.fn().mockReturnValue({ eq: deleteEq });

    const res = await menuDELETE(
      new Request("http://l/api/canteen/menu/i-1", { method: "DELETE" }),
      { params: Promise.resolve({ id: "i-1" }) },
    );
    expect(res.status).toBe(200);
    expect(deleteEq).toHaveBeenCalledWith("id", "i-1");
  });
});

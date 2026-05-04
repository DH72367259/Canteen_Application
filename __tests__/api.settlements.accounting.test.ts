const mockGetRequestContext = jest.fn();
jest.mock("@/lib/authServer", () => ({
  getRequestContext: (...args: unknown[]) => mockGetRequestContext(...args),
}));

interface QB {
  select: jest.Mock;
  eq: jest.Mock;
  gte: jest.Mock;
  lte: jest.Mock;
  order: jest.Mock;
  limit: jest.Mock;
  in: jest.Mock;
  single: jest.Mock;
  maybeSingle: jest.Mock;
  then: jest.Mock;
}

function makeQB(defaultResult: { data: unknown; error: unknown } = { data: [], error: null }): QB {
  const qb: Partial<QB> = {};
  const result = defaultResult;
  qb.select = jest.fn(() => qb as QB);
  qb.eq = jest.fn(() => qb as QB);
  qb.gte = jest.fn(() => qb as QB);
  qb.lte = jest.fn(() => qb as QB);
  qb.order = jest.fn(() => qb as QB);
  qb.limit = jest.fn(() => qb as QB);
  qb.in = jest.fn(() => qb as QB);
  qb.single = jest.fn().mockImplementation(() => Promise.resolve(result));
  qb.maybeSingle = jest.fn().mockImplementation(() => Promise.resolve(result));
  qb.then = jest.fn((onFulfilled?: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(onFulfilled, onRejected)
  );
  return qb as QB;
}

let profilesQB: QB;
let canteensQB: QB;
let ordersQB: QB;
let platformChargesQB: QB;
let paymentsQB: QB;
let settlementPaymentsQB: QB;
let bankQB: QB;
let orderItemsQB: QB;
let subscriptionsQB: QB;

jest.mock("@/lib/supabase-server", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "profiles") return profilesQB;
      if (table === "canteens") return canteensQB;
      if (table === "orders") return ordersQB;
      if (table === "platform_charges") return platformChargesQB;
      if (table === "payments") return paymentsQB;
      if (table === "settlement_payments") return settlementPaymentsQB;
      if (table === "canteen_bank_details") return bankQB;
      if (table === "order_items") return orderItemsQB;
      if (table === "noqx_pro_subscriptions") return subscriptionsQB;
      return makeQB();
    },
  }),
}));

import { GET as settlementsGET } from "@/app/api/admin/settlements/route";
import { GET as weeklyReportGET } from "@/app/api/admin/settlements/weekly-report/route";
import { GET as canteenEarningsGET } from "@/app/api/canteen/earnings/route";

beforeEach(() => {
  jest.clearAllMocks();
  profilesQB = makeQB({ data: { canteen_id: "c-1" }, error: null });
  canteensQB = makeQB({ data: [{ id: "c-1", name: "Canteen 1", city: "Bangalore", college: "Uni" }], error: null });
  ordersQB = makeQB({ data: [], error: null });
  platformChargesQB = makeQB({ data: [{ charge_pct: 2, flat_charge: 0, gst_pct: 18, id: "pc-1" }], error: null });
  paymentsQB = makeQB({ data: [], error: null });
  settlementPaymentsQB = makeQB({ data: [], error: null });
  bankQB = makeQB({ data: [], error: null });
  orderItemsQB = makeQB({ data: [], error: null });
  subscriptionsQB = makeQB({ data: [], error: null });
});

describe("settlement accounting regressions", () => {
  it("admin settlements rejects malformed or reversed date ranges", async () => {
    mockGetRequestContext.mockResolvedValue({ uid: "sa-1", role: "super_admin" });

    const malformed = await settlementsGET(new Request("http://localhost/api/admin/settlements?period_start=bad&period_end=2026-05-02"));
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toMatchObject({
      error: expect.stringMatching(/period_start|period_end/i),
    });

    const reversed = await settlementsGET(new Request("http://localhost/api/admin/settlements?period_start=2026-05-03&period_end=2026-05-02"));
    expect(reversed.status).toBe(400);
    await expect(reversed.json()).resolves.toMatchObject({
      error: expect.stringMatching(/on or before/i),
    });
  });

  it("admin settlements pays canteen from food-only gross and separates extra-bin, convenience, and pro buckets", async () => {
    mockGetRequestContext.mockResolvedValue({ uid: "sa-1", role: "super_admin" });

    ordersQB = makeQB({
      data: [
        {
          id: "o-1",
          canteen_id: "c-1",
          user_id: "u-1",
          total_amount: 106,
          status: "collected",
          created_at: "2026-05-01T10:00:00Z",
          payment_id: "pay_food_1",
          extra_bin_fee_paise: 200,
        },
        {
          id: "o-2",
          canteen_id: "c-1",
          user_id: "u-2",
          total_amount: 171,
          status: "collected",
          created_at: "2026-05-01T11:00:00Z",
          payment_id: "pay_pro_1",
          extra_bin_fee_paise: 0,
        },
      ],
      error: null,
    });
    orderItemsQB = makeQB({
      data: [
        { order_id: "o-1", quantity: 2, unit_price: 50 },
        { order_id: "o-2", quantity: 1, unit_price: 98 },
      ],
      error: null,
    });
    paymentsQB = makeQB({
      data: [
        { order_id: "o-1", canteen_id: "c-1", charge_pct_snapshot: 2, flat_charge_snapshot: 0, gst_pct_snapshot: 18, status: "captured" },
        { order_id: "o-2", canteen_id: "c-1", charge_pct_snapshot: 2, flat_charge_snapshot: 0, gst_pct_snapshot: 18, status: "captured" },
      ],
      error: null,
    });
    subscriptionsQB = makeQB({
      data: [
        { user_id: "u-2", payment_id: "pay_pro_1", amount_paid: 69, started_at: "2026-05-01T11:00:00Z", expires_at: "2026-06-01T11:00:00Z", status: "active" },
      ],
      error: null,
    });

    const res = await settlementsGET(new Request("http://localhost/api/admin/settlements?period_start=2026-05-01&period_end=2026-05-02"));
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.summary_stats.total_collected).toBe(198);
    expect(json.summary_stats.total_platform_fees).toBe(3.96);
    expect(json.summary_stats.total_gst_on_fees).toBe(0.71);
    expect(json.summary_stats.total_extra_bin_charges).toBe(2);
    expect(json.summary_stats.total_convenience_and_other_charges).toBe(4);
    expect(json.summary_stats.total_pro_revenue).toBe(69);
    expect(json.summary_stats.total_admin_earnings).toBe(79.67);
    expect(json.summary_stats.total_net_payable).toBe(193.33);

    expect(json.canteens[0].gross_amount).toBe(198);
    expect(json.canteens[0].net_payable).toBe(193.33);
    expect(json.canteens[0].convenience_charge_amount).toBe(4);
    expect(json.canteens[0].extra_bin_charge_amount).toBe(2);
  });

  it("weekly report rejects invalid week counts", async () => {
    mockGetRequestContext.mockResolvedValue({ uid: "sa-1", role: "super_admin" });

    const malformed = await weeklyReportGET(new Request("http://localhost/api/admin/settlements/weekly-report?weeks=abc"));
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toMatchObject({
      error: expect.stringMatching(/weeks/i),
    });

    const outOfRange = await weeklyReportGET(new Request("http://localhost/api/admin/settlements/weekly-report?weeks=0"));
    expect(outOfRange.status).toBe(400);
  });

  it("weekly report preserves historical charge snapshots instead of current platform settings", async () => {
    mockGetRequestContext.mockResolvedValue({ uid: "sa-1", role: "super_admin" });

    ordersQB = makeQB({
      data: [
        {
          id: "o-legacy",
          canteen_id: "c-1",
          user_id: "u-1",
          payment_id: "pay_old_1",
          total_amount: 100,
          status: "collected",
          created_at: "2026-05-04T10:00:00Z",
          extra_bin_fee_paise: 0,
        },
      ],
      error: null,
    });
    orderItemsQB = makeQB({ data: [{ order_id: "o-legacy", quantity: 1, unit_price: 100 }], error: null });
    platformChargesQB = makeQB({ data: [{ charge_pct: 0, flat_charge: 0, gst_pct: 18, id: "pc-2" }], error: null });
    paymentsQB = makeQB({
      data: [
        { order_id: "o-legacy", charge_pct_snapshot: 2, flat_charge_snapshot: 0, gst_pct_snapshot: 18, status: "captured" },
      ],
      error: null,
    });

    const res = await weeklyReportGET(new Request("http://localhost/api/admin/settlements/weekly-report?weeks=1"));
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.totals.platform_fee).toBe(2);
    expect(json.totals.gst_on_fee).toBe(0.36);
    expect(json.totals.total_platform_earnings).toBe(2.36);
    expect(json.totals.net_payable).toBe(97.64);
  });

  it("canteen earnings rejects malformed or reversed date ranges", async () => {
    mockGetRequestContext.mockResolvedValue({ uid: "vendor-1", role: "vendor", canteenId: "c-1" });

    const malformed = await canteenEarningsGET(new Request("http://localhost/api/canteen/earnings?period_start=bad&period_end=2026-05-02"));
    expect(malformed.status).toBe(400);
    await expect(malformed.json()).resolves.toMatchObject({
      error: expect.stringMatching(/period_start|period_end/i),
    });

    const reversed = await canteenEarningsGET(new Request("http://localhost/api/canteen/earnings?period_start=2026-05-03&period_end=2026-05-02"));
    expect(reversed.status).toBe(400);
  });

  it("canteen earnings shows food-only gross and excludes admin-only charges from net earnings", async () => {
    mockGetRequestContext.mockResolvedValue({ uid: "vendor-1", role: "vendor", canteenId: "c-1" });
    profilesQB = makeQB({ data: { canteen_id: "c-1" }, error: null });
    canteensQB = makeQB({ data: { id: "c-1", name: "Canteen 1", city: "Bangalore", college: "Uni" }, error: null });
    ordersQB = makeQB({
      data: [
        {
          id: "o-1",
          user_id: "u-1",
          total_amount: 106,
          status: "collected",
          created_at: "2026-05-01T10:00:00Z",
          payment_id: "pay_food_1",
          extra_bin_fee_paise: 200,
        },
      ],
      error: null,
    });
    orderItemsQB = makeQB({ data: [{ order_id: "o-1", quantity: 2, unit_price: 50 }], error: null });
    paymentsQB = makeQB({
      data: [
        { order_id: "o-1", charge_pct_snapshot: 2, flat_charge_snapshot: 0, gst_pct_snapshot: 18, status: "captured" },
      ],
      error: null,
    });
    subscriptionsQB = makeQB({ data: [], error: null });

    const res = await canteenEarningsGET(new Request("http://localhost/api/canteen/earnings?period_start=2026-05-01&period_end=2026-05-02"));
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.summary.gross_collected).toBe(100);
    expect(json.summary.total_platform_fee).toBe(2);
    expect(json.summary.total_gst).toBe(0.36);
    expect(json.summary.total_extra_bin_charges).toBe(2);
    expect(json.summary.total_convenience_and_other_charges).toBe(4);
    expect(json.summary.net_earnings).toBe(97.64);
    expect(json.orders[0].gross_amount).toBe(100);
    expect(json.orders[0].net_earnings).toBe(97.64);
  });
});
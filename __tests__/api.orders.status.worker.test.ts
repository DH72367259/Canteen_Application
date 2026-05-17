/**
 * Tests for PATCH /api/orders/[id]/status focusing on Phase 2 worker pseudo-statuses:
 *   - skip      → push to back of queue (skipped_at, skipped_count, status='confirmed')
 *   - grace_bin → status='cancelled' + grace_collected_at + free bin
 */

const mockGetRequestContext = jest.fn();
jest.mock("@/lib/authServer", () => ({
  getRequestContext: (...args: unknown[]) => mockGetRequestContext(...args),
}));

interface QB {
  update: jest.Mock;
  insert: jest.Mock;
  select: jest.Mock;
  eq: jest.Mock;
  single: jest.Mock;
  maybeSingle: jest.Mock;
  then: jest.Mock;
}

let ordersQB: QB;
let binsQB: QB;
let notificationsQB: QB;

function makeQB(opts: Partial<{ singleData: unknown; updateReturnData: unknown }> = {}): QB {
  const qb: Partial<QB> = {};
  qb.update = jest.fn(() => qb as QB);
  qb.insert = jest.fn(() => qb as QB);
  qb.select = jest.fn(() => qb as QB);
  qb.eq = jest.fn(() => qb as QB);
  qb.single = jest.fn().mockResolvedValue({
    data: opts.updateReturnData ?? opts.singleData ?? null,
    error: null,
  });
  qb.maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
  // Fire-and-forget insert chain returns a thenable
  qb.then = jest.fn((onFulfilled?: (v: unknown) => unknown) => {
    if (onFulfilled) onFulfilled({ data: null, error: null });
    return Promise.resolve();
  });
  return qb as QB;
}

jest.mock("@/lib/supabase-server", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "orders") return ordersQB;
      if (table === "bins") return binsQB;
      if (table === "notifications") return notificationsQB;
      return {};
    },
  }),
}));

import { PATCH } from "@/app/api/orders/[id]/status/route";

const WORKER_CTX = { uid: "w-uid", role: "worker" as const, canteenId: "c-1" };

function makeReq(body: Record<string, unknown>, orderId = "ord-1") {
  return {
    req: new Request(`http://localhost/api/orders/${orderId}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: "Bearer t" },
      body: JSON.stringify(body),
    }),
    ctx: { params: Promise.resolve({ id: orderId }) },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  ordersQB = makeQB();
  binsQB = makeQB();
  notificationsQB = makeQB();
});

describe("PATCH /api/orders/[id]/status — pseudo-status: skip", () => {
  it("worker can skip; sets status=confirmed, stamps skipped_at, increments skipped_count", async () => {
    mockGetRequestContext.mockResolvedValue(WORKER_CTX);
    // First .single() call: read current row (skipped_count, canteen_id)
    // Second .single() call: return updated row
    ordersQB.single = jest.fn()
      .mockResolvedValueOnce({ data: { skipped_count: 1, canteen_id: "c-1" }, error: null })
      .mockResolvedValueOnce({ data: { id: "ord-1", status: "confirmed", skipped_count: 2 }, error: null });

    const { req, ctx } = makeReq({ status: "skip" });
    const res = await PATCH(req, ctx);
    expect(res.status).toBe(200);

    // update called with status=confirmed and skipped_count=2
    const updateArg = (ordersQB.update as jest.Mock).mock.calls[0][0];
    expect(updateArg.status).toBe("confirmed");
    expect(updateArg.skipped_count).toBe(2);
    expect(typeof updateArg.skipped_at).toBe("string");

    // Notification queued for canteen admin
    expect(notificationsQB.insert).toHaveBeenCalled();
    const notif = (notificationsQB.insert as jest.Mock).mock.calls[0][0];
    expect(notif.target_role).toBe("canteen_admin");
  });

  it("non-staff cannot use skip", async () => {
    mockGetRequestContext.mockResolvedValue({ uid: "u", role: "user", canteenId: undefined });
    const { req, ctx } = makeReq({ status: "skip" });
    const res = await PATCH(req, ctx);
    expect(res.status).toBe(403);
  });
});

describe("PATCH /api/orders/[id]/status — pseudo-status: grace_bin", () => {
  it("worker grace_bin → status=cancelled + grace_collected_at + frees bin", async () => {
    mockGetRequestContext.mockResolvedValue(WORKER_CTX);
    ordersQB.single = jest.fn()
      .mockResolvedValueOnce({ data: { bin_id: "bin-9", canteen_id: "c-1" }, error: null })
      .mockResolvedValueOnce({ data: { id: "ord-1", status: "cancelled" }, error: null });

    const { req, ctx } = makeReq({ status: "grace_bin" });
    const res = await PATCH(req, ctx);
    expect(res.status).toBe(200);

    const updateArg = (ordersQB.update as jest.Mock).mock.calls[0][0];
    expect(updateArg.status).toBe("cancelled");
    expect(typeof updateArg.grace_collected_at).toBe("string");

    // Bin freed
    expect(binsQB.update).toHaveBeenCalled();
    const binArg = (binsQB.update as jest.Mock).mock.calls[0][0];
    expect(binArg.is_occupied).toBe(false);
    expect(binArg.assigned_order_id).toBeNull();

    // Notification queued
    expect(notificationsQB.insert).toHaveBeenCalled();
  });
});

describe("PATCH /api/orders/[id]/status — standard", () => {
  it("worker preparing → clears skipped_at", async () => {
    mockGetRequestContext.mockResolvedValue(WORKER_CTX);
    ordersQB.single = jest.fn().mockResolvedValueOnce({
      data: { id: "ord-1", status: "preparing" },
      error: null,
    });

    const { req, ctx } = makeReq({ status: "preparing" });
    const res = await PATCH(req, ctx);
    expect(res.status).toBe(200);
    const updateArg = (ordersQB.update as jest.Mock).mock.calls[0][0];
    expect(updateArg.skipped_at).toBeNull();
  });

  it("rejects unknown pseudo status", async () => {
    mockGetRequestContext.mockResolvedValue(WORKER_CTX);
    const { req, ctx } = makeReq({ status: "weird-action" });
    const res = await PATCH(req, ctx);
    expect(res.status).toBe(400);
  });

  it("worker cannot set collected directly", async () => {
    mockGetRequestContext.mockResolvedValue(WORKER_CTX);
    const { req, ctx } = makeReq({ status: "collected" });
    const res = await PATCH(req, ctx);
    expect(res.status).toBe(403);
  });

  it("worker cannot set completed directly", async () => {
    mockGetRequestContext.mockResolvedValue(WORKER_CTX);
    const { req, ctx } = makeReq({ status: "completed" });
    const res = await PATCH(req, ctx);
    expect(res.status).toBe(403);
  });
});

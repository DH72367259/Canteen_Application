/**
 * Tests for POST /api/orders/[id]/cancel — staff-initiated order cancellation.
 *
 * RBAC matrix verified:
 *   - super_admin / co_admin / canteen_admin / vendor → allowed
 *   - worker / user / unauthenticated                → 401/403
 *   - canteen_admin from a different canteen          → 403
 *
 * Behaviour verified:
 *   - missing reason → 400
 *   - already cancelled / collected / completed → 400
 *   - frees bin via bin_id, assigned_order_id, order_id (best-effort)
 *   - notification inserted for student + canteen
 *   - schema-drift fallback: retries with slim update if cancellation columns missing
 *   - refund is "not_required" when payment_id is missing/non-Razorpay
 */

const mockGetRequestContext = jest.fn();
jest.mock("@/lib/authServer", () => ({
  getRequestContext: (...args: unknown[]) => mockGetRequestContext(...args),
}));

interface QB {
  select: jest.Mock; update: jest.Mock; insert: jest.Mock;
  eq: jest.Mock; single: jest.Mock; then: jest.Mock;
}

let ordersQB: QB;
let binsQB: QB;
let notificationsQB: QB;

function makeQB(): QB {
  const qb: Partial<QB> = {};
  qb.select = jest.fn(() => qb as QB);
  qb.update = jest.fn(() => qb as QB);
  qb.insert = jest.fn(() => qb as QB);
  qb.eq     = jest.fn(() => qb as QB);
  qb.single = jest.fn().mockResolvedValue({ data: null, error: null });
  qb.then   = jest.fn((onFulfilled?: (v: unknown) => unknown) => {
    if (onFulfilled) onFulfilled({ data: null, error: null });
    return Promise.resolve();
  });
  return qb as QB;
}

jest.mock("@/lib/supabase-server", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "orders")        return ordersQB;
      if (table === "bins")          return binsQB;
      if (table === "notifications") return notificationsQB;
      return {};
    },
  }),
}));

import { POST } from "@/app/api/orders/[id]/cancel/route";

const SUPER_ADMIN_CTX    = { uid: "sa",   role: "super_admin"   as const, canteenId: undefined };
const CO_ADMIN_CTX       = { uid: "co",   role: "co_admin"      as const, canteenId: undefined };
const CANTEEN_ADMIN_CTX  = { uid: "ca",   role: "canteen_admin" as const, canteenId: "c-1" };
const VENDOR_CTX         = { uid: "vd",   role: "vendor"        as const, canteenId: "c-1" };
const WORKER_CTX         = { uid: "wk",   role: "worker"        as const, canteenId: "c-1" };
const USER_CTX           = { uid: "u",    role: "user"          as const, canteenId: undefined };

function req(body: unknown, orderId = "ord-1") {
  return {
    request: new Request(`http://localhost/api/orders/${orderId}/cancel`, {
      method: "POST",
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
  // ensure RAZORPAY creds are NOT present so the refund path stays inert
  delete process.env.RAZORPAY_KEY_ID;
  delete process.env.RAZORPAY_KEY_SECRET;
});

describe("POST /api/orders/[id]/cancel — RBAC", () => {
  it("returns 401 when unauthenticated", async () => {
    mockGetRequestContext.mockResolvedValue(null);
    const { request, ctx } = req({ reason: "test" });
    const res = await POST(request, ctx);
    expect(res.status).toBe(401);
  });

  it("returns 403 for worker", async () => {
    mockGetRequestContext.mockResolvedValue(WORKER_CTX);
    const { request, ctx } = req({ reason: "test" });
    const res = await POST(request, ctx);
    expect(res.status).toBe(403);
  });

  it("returns 403 for student/user", async () => {
    mockGetRequestContext.mockResolvedValue(USER_CTX);
    const { request, ctx } = req({ reason: "test" });
    const res = await POST(request, ctx);
    expect(res.status).toBe(403);
  });

  for (const [name, ctxObj] of [
    ["super_admin", SUPER_ADMIN_CTX], ["co_admin", CO_ADMIN_CTX],
    ["canteen_admin", CANTEEN_ADMIN_CTX], ["vendor", VENDOR_CTX],
  ] as const) {
    it(`allows ${name} to cancel`, async () => {
      mockGetRequestContext.mockResolvedValue(ctxObj);
      ordersQB.single = jest.fn()
        .mockResolvedValueOnce({ data: { id: "ord-1", status: "placed", canteen_id: "c-1", bin_id: "b-1", user_id: "u-1", total_amount: 99, payment_id: null, cancelled_at: null }, error: null })
        .mockResolvedValueOnce({ data: { id: "ord-1", status: "cancelled", cancellation_reason: "out of stock", cancelled_at: "now", refund_status: "not_required", refund_id: null }, error: null });
      const { request, ctx } = req({ reason: "out of stock" });
      const res = await POST(request, ctx);
      expect(res.status).toBe(200);
      const updateArg = (ordersQB.update as jest.Mock).mock.calls[0][0];
      expect(updateArg.status).toBe("cancelled");
      expect(updateArg.cancellation_reason).toBe("out of stock");
      expect(updateArg.cancelled_by).toBe(ctxObj.uid);
      expect(updateArg.cancelled_by_role).toBe(ctxObj.role);
    });
  }

  it("403 when canteen_admin tries to cancel another canteen's order", async () => {
    mockGetRequestContext.mockResolvedValue(CANTEEN_ADMIN_CTX);
    ordersQB.single = jest.fn().mockResolvedValueOnce({
      data: { id: "ord-1", status: "placed", canteen_id: "c-OTHER", bin_id: null, user_id: "u-1", total_amount: 99, payment_id: null, cancelled_at: null },
      error: null,
    });
    const { request, ctx } = req({ reason: "test" });
    const res = await POST(request, ctx);
    expect(res.status).toBe(403);
  });
});

describe("POST /api/orders/[id]/cancel — validation", () => {
  it("400 when reason is missing/empty", async () => {
    mockGetRequestContext.mockResolvedValue(SUPER_ADMIN_CTX);
    const { request, ctx } = req({ reason: "   " });
    const res = await POST(request, ctx);
    expect(res.status).toBe(400);
  });

  it("400 when reason exceeds 280 chars", async () => {
    mockGetRequestContext.mockResolvedValue(SUPER_ADMIN_CTX);
    const { request, ctx } = req({ reason: "x".repeat(281) });
    const res = await POST(request, ctx);
    expect(res.status).toBe(400);
  });

  it("404 when order not found", async () => {
    mockGetRequestContext.mockResolvedValue(SUPER_ADMIN_CTX);
    ordersQB.single = jest.fn().mockResolvedValueOnce({ data: null, error: { message: "no row" } });
    const { request, ctx } = req({ reason: "x" });
    const res = await POST(request, ctx);
    expect(res.status).toBe(404);
  });

  it("400 when already cancelled", async () => {
    mockGetRequestContext.mockResolvedValue(SUPER_ADMIN_CTX);
    ordersQB.single = jest.fn().mockResolvedValueOnce({
      data: { id: "ord-1", status: "cancelled", canteen_id: "c-1", bin_id: null, user_id: "u-1", total_amount: 99, payment_id: null, cancelled_at: "yesterday" },
      error: null,
    });
    const { request, ctx } = req({ reason: "x" });
    const res = await POST(request, ctx);
    expect(res.status).toBe(400);
  });

  it("400 when already collected/completed", async () => {
    mockGetRequestContext.mockResolvedValue(SUPER_ADMIN_CTX);
    ordersQB.single = jest.fn().mockResolvedValueOnce({
      data: { id: "ord-1", status: "collected", canteen_id: "c-1", bin_id: null, user_id: "u-1", total_amount: 99, payment_id: null, cancelled_at: null },
      error: null,
    });
    const { request, ctx } = req({ reason: "x" });
    const res = await POST(request, ctx);
    expect(res.status).toBe(400);
  });
});

describe("POST /api/orders/[id]/cancel — side effects", () => {
  it("frees bin via bin_id, assigned_order_id, order_id and notifies student + canteen", async () => {
    mockGetRequestContext.mockResolvedValue(SUPER_ADMIN_CTX);
    ordersQB.single = jest.fn()
      .mockResolvedValueOnce({ data: { id: "ord-1", status: "placed", canteen_id: "c-1", bin_id: "b-9", user_id: "u-1", total_amount: 99, payment_id: null, cancelled_at: null }, error: null })
      .mockResolvedValueOnce({ data: { id: "ord-1", status: "cancelled", cancellation_reason: "x", cancelled_at: "now", refund_status: "not_required", refund_id: null }, error: null });
    const { request, ctx } = req({ reason: "x" });
    const res = await POST(request, ctx);
    expect(res.status).toBe(200);

    // bins.update was called at least 3 times (bin_id + assigned_order_id + order_id)
    expect((binsQB.update as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(3);
    const freeArg = (binsQB.update as jest.Mock).mock.calls[0][0];
    expect(freeArg.is_occupied).toBe(false);
    expect(freeArg.assigned_order_id).toBeNull();
    expect(freeArg.status).toBe("empty");

    // notifications.insert called twice (student + canteen)
    expect((notificationsQB.insert as jest.Mock).mock.calls.length).toBe(2);
    const studentNotif = (notificationsQB.insert as jest.Mock).mock.calls[0][0];
    expect(studentNotif.recipient_type).toBe("user");
    expect(studentNotif.recipient_id).toBe("u-1");
    const canteenNotif = (notificationsQB.insert as jest.Mock).mock.calls[1][0];
    expect(canteenNotif.recipient_type).toBe("canteen");
  });

  it("schema-drift fallback retries with slim update when cancellation columns missing", async () => {
    mockGetRequestContext.mockResolvedValue(SUPER_ADMIN_CTX);
    ordersQB.single = jest.fn()
      .mockResolvedValueOnce({ data: { id: "ord-1", status: "placed", canteen_id: "c-1", bin_id: null, user_id: null, total_amount: 99, payment_id: null, cancelled_at: null }, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'column "cancellation_reason" does not exist' } })
      .mockResolvedValueOnce({ data: { id: "ord-1", status: "cancelled" }, error: null });
    const { request, ctx } = req({ reason: "x" });
    const res = await POST(request, ctx);
    expect(res.status).toBe(200);
    // update called twice — the rich one then the slim retry
    expect((ordersQB.update as jest.Mock).mock.calls.length).toBe(2);
    const slimArg = (ordersQB.update as jest.Mock).mock.calls[1][0];
    expect(slimArg.status).toBe("cancelled");
    expect(slimArg.cancellation_reason).toBeUndefined();
  });

  it("refund.status is 'not_required' when no payment_id", async () => {
    mockGetRequestContext.mockResolvedValue(SUPER_ADMIN_CTX);
    ordersQB.single = jest.fn()
      .mockResolvedValueOnce({ data: { id: "ord-1", status: "placed", canteen_id: "c-1", bin_id: null, user_id: null, total_amount: 0, payment_id: null, cancelled_at: null }, error: null })
      .mockResolvedValueOnce({ data: { id: "ord-1", status: "cancelled" }, error: null });
    const { request, ctx } = req({ reason: "free order" });
    const res = await POST(request, ctx);
    const body = await res.json();
    expect(body.refund.status).toBe("not_required");
  });
});

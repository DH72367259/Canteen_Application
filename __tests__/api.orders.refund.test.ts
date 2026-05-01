/**
 * Tests for POST /api/orders/[id]/refund — admin-only manual refund retry.
 *
 * RBAC matrix:
 *   - super_admin                            → allowed
 *   - co_admin / canteen_admin / vendor / worker / user → 403
 *
 * Behaviour:
 *   - 401 unauthenticated
 *   - 404 order not found
 *   - 400 if order is not cancelled
 *   - 400 if already refunded (refund_status='processed' + refund_id)
 *   - 400 if no Razorpay payment_id
 *   - 500 if Razorpay creds missing
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
let notificationsQB: QB;

function makeQB(): QB {
  const qb: Partial<QB> = {};
  qb.select = jest.fn(() => qb as QB);
  qb.update = jest.fn(() => qb as QB);
  qb.insert = jest.fn(() => qb as QB);
  qb.eq = jest.fn(() => qb as QB);
  qb.single = jest.fn().mockResolvedValue({ data: null, error: null });
  qb.then = jest.fn((onF?: (v: unknown) => unknown) => { if (onF) onF({ data: null, error: null }); return Promise.resolve(); });
  return qb as QB;
}

jest.mock("@/lib/supabase-server", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "orders")        return ordersQB;
      if (table === "notifications") return notificationsQB;
      return {};
    },
  }),
}));

import { POST } from "@/app/api/orders/[id]/refund/route";

function req(orderId = "ord-1") {
  return {
    request: new Request(`http://localhost/api/orders/${orderId}/refund`, {
      method: "POST",
      headers: { Authorization: "Bearer t" },
    }),
    ctx: { params: Promise.resolve({ id: orderId }) },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  ordersQB = makeQB();
  notificationsQB = makeQB();
  delete process.env.RAZORPAY_KEY_ID;
  delete process.env.RAZORPAY_KEY_SECRET;
});

describe("POST /api/orders/[id]/refund — RBAC", () => {
  it("401 when unauthenticated", async () => {
    mockGetRequestContext.mockResolvedValue(null);
    const { request, ctx } = req();
    const res = await POST(request, ctx);
    expect(res.status).toBe(401);
  });

  for (const role of ["co_admin", "canteen_admin", "vendor", "worker", "user"] as const) {
    it(`403 when role is ${role}`, async () => {
      mockGetRequestContext.mockResolvedValue({ uid: "x", role, canteenId: "c-1" });
      const { request, ctx } = req();
      const res = await POST(request, ctx);
      expect(res.status).toBe(403);
    });
  }
});

describe("POST /api/orders/[id]/refund — preconditions (super_admin)", () => {
  const ADMIN = { uid: "sa", role: "super_admin" as const, canteenId: undefined };

  it("404 when order not found", async () => {
    mockGetRequestContext.mockResolvedValue(ADMIN);
    ordersQB.single = jest.fn().mockResolvedValueOnce({ data: null, error: { message: "no row" } });
    const { request, ctx } = req();
    const res = await POST(request, ctx);
    expect(res.status).toBe(404);
  });

  it("400 when order status is not 'cancelled'", async () => {
    mockGetRequestContext.mockResolvedValue(ADMIN);
    ordersQB.single = jest.fn().mockResolvedValueOnce({
      data: { id: "ord-1", status: "placed", payment_id: "pay_ABCDEFGHIJKLMN1", total_amount: 99, user_id: "u", refund_status: null, refund_id: null },
      error: null,
    });
    const { request, ctx } = req();
    const res = await POST(request, ctx);
    expect(res.status).toBe(400);
  });

  it("400 when already refunded", async () => {
    mockGetRequestContext.mockResolvedValue(ADMIN);
    ordersQB.single = jest.fn().mockResolvedValueOnce({
      data: { id: "ord-1", status: "cancelled", payment_id: "pay_ABCDEFGHIJKLMN1", total_amount: 99, user_id: "u", refund_status: "processed", refund_id: "rfnd_xxx" },
      error: null,
    });
    const { request, ctx } = req();
    const res = await POST(request, ctx);
    expect(res.status).toBe(400);
  });

  it("400 when no valid Razorpay payment_id", async () => {
    mockGetRequestContext.mockResolvedValue(ADMIN);
    ordersQB.single = jest.fn().mockResolvedValueOnce({
      data: { id: "ord-1", status: "cancelled", payment_id: null, total_amount: 99, user_id: "u", refund_status: "failed", refund_id: null },
      error: null,
    });
    const { request, ctx } = req();
    const res = await POST(request, ctx);
    expect(res.status).toBe(400);
  });

  it("500 when Razorpay creds missing", async () => {
    mockGetRequestContext.mockResolvedValue(ADMIN);
    ordersQB.single = jest.fn().mockResolvedValueOnce({
      data: { id: "ord-1", status: "cancelled", payment_id: "pay_ABCDEFGHIJKLMN1", total_amount: 99, user_id: "u", refund_status: "failed", refund_id: null },
      error: null,
    });
    const { request, ctx } = req();
    const res = await POST(request, ctx);
    expect(res.status).toBe(500);
  });
});

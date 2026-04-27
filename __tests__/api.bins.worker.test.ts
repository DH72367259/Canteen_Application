/**
 * Unit tests for worker workflow:
 *  - POST /api/bins/[id]/mark-picked
 */

// ─── mocks ───────────────────────────────────────────────────────────────────
const mockGetRequestContext = jest.fn();
jest.mock("@/lib/authServer", () => ({
  getRequestContext: (...args: unknown[]) => mockGetRequestContext(...args),
}));

let mockFromBins    = jest.fn();
let mockFromOrders  = jest.fn();

jest.mock("@/lib/supabase-server", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "bins")   return mockFromBins();
      if (table === "orders") return mockFromOrders();
      return {};
    },
  }),
}));

import { POST as markPicked } from "@/app/api/bins/[id]/mark-picked/route";

function makeRequest(binId = "bin-123") {
  return {
    req: new Request(`http://localhost/api/bins/${binId}/mark-picked`, {
      method: "POST",
      headers: { Authorization: "Bearer token" },
    }),
    ctx: { params: Promise.resolve({ id: binId }) },
  };
}

const WORKER_CTX = { uid: "w-uid", role: "worker" as const, canteenId: "canteen-1" };
const ADMIN_CTX  = { uid: "a-uid", role: "super_admin" as const, canteenId: undefined };
const USER_CTX   = { uid: "u-uid", role: "user" as const, canteenId: undefined };

// ─── tests ───────────────────────────────────────────────────────────────────
describe("POST /api/bins/[id]/mark-picked", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFromBins  = jest.fn();
    mockFromOrders = jest.fn();
  });

  it("returns 401 if no auth", async () => {
    mockGetRequestContext.mockResolvedValue(null);
    const { req, ctx } = makeRequest();
    const res = await markPicked(req, ctx);
    expect(res.status).toBe(401);
  });

  it("returns 403 for regular user", async () => {
    mockGetRequestContext.mockResolvedValue(USER_CTX);
    mockFromBins.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
    });
    const { req, ctx } = makeRequest();
    const res = await markPicked(req, ctx);
    expect(res.status).toBe(403);
  });

  it("returns 404 if bin not found", async () => {
    mockGetRequestContext.mockResolvedValue(WORKER_CTX);
    mockFromBins.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: { message: "not found" } }),
    });
    const { req, ctx } = makeRequest("non-existent-bin");
    const res = await markPicked(req, ctx);
    expect(res.status).toBe(404);
  });

  it("returns 403 if worker accesses bin from different canteen", async () => {
    mockGetRequestContext.mockResolvedValue({ ...WORKER_CTX, canteenId: "canteen-A" });
    mockFromBins.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: { id: "bin-123", order_id: "ord-1", canteen_id: "canteen-B", is_occupied: true },
        error: null,
      }),
    });
    const { req, ctx } = makeRequest();
    const res = await markPicked(req, ctx);
    expect(res.status).toBe(403);
  });

  it("returns 400 if bin is already empty", async () => {
    mockGetRequestContext.mockResolvedValue(WORKER_CTX);
    mockFromBins.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: { id: "bin-123", order_id: null, canteen_id: "canteen-1", is_occupied: false },
        error: null,
      }),
    });
    const { req, ctx } = makeRequest();
    const res = await markPicked(req, ctx);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/empty/i);
  });

  it("marks bin as picked successfully", async () => {
    mockGetRequestContext.mockResolvedValue(WORKER_CTX);
    mockFromBins.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: { id: "bin-123", order_id: "order-456", canteen_id: "canteen-1", is_occupied: true },
        error: null,
      }),
      update: jest.fn().mockReturnThis(),
    });

    // For the update calls, we need separate mocks for each from("bins") and from("orders")
    let callCount = 0;
    mockFromBins = jest.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // First call: fetch
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({
            data: { id: "bin-123", order_id: "order-456", canteen_id: "canteen-1", is_occupied: true },
            error: null,
          }),
        };
      }
      // Second call: update bins
      return {
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockResolvedValue({ error: null }),
      };
    });

    mockFromOrders.mockReturnValue({
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: { id: "order-456" },
        error: null,
      }),
    });

    const { req, ctx } = makeRequest();
    const res = await markPicked(req, ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.orderId).toBe("order-456");
  });

  it("super_admin can access any bin regardless of canteen", async () => {
    mockGetRequestContext.mockResolvedValue(ADMIN_CTX);
    mockFromBins.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: { id: "bin-123", order_id: "order-789", canteen_id: "any-canteen", is_occupied: true },
        error: null,
      }),
    });
    mockFromOrders.mockReturnValue({
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: { id: "order-789" }, error: null }),
    });
    mockFromBins = jest.fn()
      .mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({
          data: { id: "bin-123", order_id: "order-789", canteen_id: "any-canteen", is_occupied: true },
          error: null,
        }),
      })
      .mockReturnValueOnce({
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockResolvedValue({ error: null }),
      });

    const { req, ctx } = makeRequest();
    const res = await markPicked(req, ctx);
    // Should not be blocked by canteen restriction (ADMIN_CTX has no canteenId)
    expect(res.status).not.toBe(403);
  });
});

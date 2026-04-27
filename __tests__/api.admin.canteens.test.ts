/**
 * Unit tests for Admin Canteens API — GET
 */

const mockGetRequestContext = jest.fn();
jest.mock("@/lib/authServer", () => ({
  getRequestContext: (...args: unknown[]) => mockGetRequestContext(...args),
}));

const mockFromCanteens = jest.fn();
jest.mock("@/lib/supabase-server", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "canteens") return mockFromCanteens();
      return {};
    },
  }),
}));

import { GET } from "@/app/api/admin/canteens/route";

function makeRequest() {
  return new Request("http://localhost/api/admin/canteens", {
    headers: { Authorization: "Bearer test-token" },
  });
}

const SUPER_ADMIN_CTX = { uid: "admin-uid", role: "super_admin" as const };
const CO_ADMIN_CTX    = { uid: "co-uid",    role: "co_admin"    as const };
const WORKER_CTX      = { uid: "w-uid",     role: "worker"      as const };

describe("GET /api/admin/canteens", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 401 if no auth", async () => {
    mockGetRequestContext.mockResolvedValue(null);
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it("returns 403 for worker role", async () => {
    mockGetRequestContext.mockResolvedValue(WORKER_CTX);
    const res = await GET(makeRequest());
    expect(res.status).toBe(403);
  });

  it("returns canteens for super_admin", async () => {
    mockGetRequestContext.mockResolvedValue(SUPER_ADMIN_CTX);
    const mockChain = {
      select: jest.fn().mockReturnThis(),
      order:  jest.fn().mockResolvedValue({
        data: [
          { id: "c1", name: "Alpha Canteen", city: "Delhi", college: "IIT", is_active: true },
        ],
        error: null,
      }),
    };
    mockFromCanteens.mockReturnValue(mockChain);

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.canteens).toHaveLength(1);
    expect(body.canteens[0].name).toBe("Alpha Canteen");
  });

  it("returns canteens for co_admin", async () => {
    mockGetRequestContext.mockResolvedValue(CO_ADMIN_CTX);
    const mockChain = {
      select: jest.fn().mockReturnThis(),
      order:  jest.fn().mockResolvedValue({ data: [], error: null }),
    };
    mockFromCanteens.mockReturnValue(mockChain);

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.canteens).toEqual([]);
  });

  it("returns 500 on DB error", async () => {
    mockGetRequestContext.mockResolvedValue(SUPER_ADMIN_CTX);
    const mockChain = {
      select: jest.fn().mockReturnThis(),
      order:  jest.fn().mockResolvedValue({ data: null, error: { message: "connection error" } }),
    };
    mockFromCanteens.mockReturnValue(mockChain);

    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/fetch canteens/i);
  });
});

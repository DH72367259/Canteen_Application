/**
 * Tests for DELETE /api/auth/account — DPDPA 2023 right-to-erasure flow.
 */

const mockGetRequestContext = jest.fn();
jest.mock("@/lib/authServer", () => ({
  getRequestContext: (...args: unknown[]) => mockGetRequestContext(...args),
}));

const profileUpdate = jest.fn();
const profileEq = jest.fn();
const updateUserById = jest.fn();
jest.mock("@/lib/supabase-server", () => ({
  createAdminClient: () => ({
    from: () => ({
      update: (...args: unknown[]) => {
        profileUpdate(...args);
        return { eq: (col: string, val: string) => profileEq(col, val) };
      },
    }),
    auth: {
      admin: {
        updateUserById: (...args: unknown[]) => updateUserById(...args),
      },
    },
  }),
}));

// Reset the rateLimit module between tests so the limiter doesn't leak.
jest.mock("@/lib/rateLimit", () => {
  const real = jest.requireActual("@/lib/rateLimit");
  return real;
});

import { DELETE } from "@/app/api/auth/account/route";

function makeReq(): Request {
  return new Request("http://localhost/api/auth/account", { method: "DELETE" });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.resetModules();
  profileEq.mockResolvedValue({ error: null });
  updateUserById.mockResolvedValue({ data: null, error: null });
  // re-import after resetModules so rateLimit's in-memory bucket is fresh
});

describe("DELETE /api/auth/account", () => {
  test("rejects unauthenticated requests", async () => {
    mockGetRequestContext.mockResolvedValue(null);
    const res = await DELETE(makeReq() as never);
    expect(res.status).toBe(401);
  });

  test("rejects staff roles (super_admin, canteen_admin, worker, vendor, co_admin)", async () => {
    for (const role of ["super_admin", "canteen_admin", "worker", "vendor", "co_admin"]) {
      mockGetRequestContext.mockResolvedValue({ uid: `id-${role}`, role });
      const res = await DELETE(makeReq() as never);
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toMatch(/staff/i);
    }
  });

  test("anonymises profile + revokes login for a student", async () => {
    mockGetRequestContext.mockResolvedValue({ uid: "stud-ok", role: "user" });
    const res = await DELETE(makeReq() as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.deletedAt).toMatch(/\d{4}-\d{2}-\d{2}T/);

    // Profile was updated with anonymised fields
    expect(profileUpdate).toHaveBeenCalledWith(expect.objectContaining({
      name: "Deleted User",
      role: "deleted",
    }));
    // Auth password rotated to a long random value
    expect(updateUserById).toHaveBeenCalledTimes(1);
    const [uid, payload] = updateUserById.mock.calls[0] as [string, { password: string; user_metadata: Record<string, unknown> }];
    expect(uid).toBe("stud-ok");
    expect(typeof payload.password).toBe("string");
    expect(payload.password.length).toBeGreaterThanOrEqual(32);
    expect(payload.user_metadata.account_status).toBe("deleted");
  });

  test("falls back to minimal anonymisation when extended columns are missing", async () => {
    mockGetRequestContext.mockResolvedValue({ uid: "legacy-stud", role: "user" });
    // First call (full update) errors with column-missing; second call (name-only) succeeds.
    profileEq
      .mockResolvedValueOnce({ error: { message: 'column "deleted_at" does not exist' } })
      .mockResolvedValueOnce({ error: null });
    const res = await DELETE(makeReq() as never);
    expect(res.status).toBe(200);
    expect(profileUpdate).toHaveBeenCalledTimes(2);
    expect(profileUpdate.mock.calls[1][0]).toEqual({ name: "Deleted User" });
  });

  test("returns 500 if anonymisation fully fails", async () => {
    mockGetRequestContext.mockResolvedValue({ uid: "broken-stud", role: "user" });
    profileEq.mockResolvedValue({ error: { message: "db is down" } });
    const res = await DELETE(makeReq() as never);
    expect(res.status).toBe(500);
    expect(updateUserById).not.toHaveBeenCalled();
  });
});

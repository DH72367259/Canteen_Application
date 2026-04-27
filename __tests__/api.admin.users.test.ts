/**
 * Unit tests for Admin Users API — POST (create), PATCH (update), DELETE
 * All Supabase and auth dependencies are mocked.
 */

// ─── mocks ───────────────────────────────────────────────────────────────────

// Mock getRequestContext before importing the route
const mockGetRequestContext = jest.fn();
jest.mock("@/lib/authServer", () => ({
  getRequestContext: (...args: unknown[]) => mockGetRequestContext(...args),
}));

// Mock createAdminClient
const mockAdminUsersCreate  = jest.fn();
const mockAdminUsersDelete  = jest.fn();
const mockAdminUsersUpdate  = jest.fn();
const mockFromProfiles      = jest.fn();

jest.mock("@/lib/supabase-server", () => ({
  createAdminClient: () => ({
    auth: {
      admin: {
        createUser: (...a: unknown[]) => mockAdminUsersCreate(...a),
        deleteUser: (...a: unknown[]) => mockAdminUsersDelete(...a),
        updateUserById: (...a: unknown[]) => mockAdminUsersUpdate(...a),
      },
    },
    from: (table: string) => {
      if (table === "profiles") return mockFromProfiles();
      return { select: jest.fn().mockReturnThis(), order: jest.fn().mockReturnThis(), limit: jest.fn().mockResolvedValue({ data: [], error: null }) };
    },
  }),
}));

// ─── imports ─────────────────────────────────────────────────────────────────
import { POST, PATCH, DELETE } from "@/app/api/admin/users/route";

// ─── helpers ─────────────────────────────────────────────────────────────────
function makeRequest(body: unknown, method = "POST"): Request {
  return new Request("http://localhost/api/admin/users", {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer test-token",
    },
    body: JSON.stringify(body),
  });
}

const SUPER_ADMIN_CTX = { uid: "admin-uid", role: "super_admin" as const };
const CO_ADMIN_CTX    = { uid: "co-uid",    role: "co_admin"    as const };
const CANTEEN_CTX     = { uid: "ca-uid",    role: "canteen_admin" as const };

// ─── POST — create user ───────────────────────────────────────────────────────
describe("POST /api/admin/users", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 401 if no auth context", async () => {
    mockGetRequestContext.mockResolvedValue(null);
    const res = await POST(makeRequest({ email: "a@b.com", password: "Abcd1234!", name: "A", role: "worker" }));
    expect(res.status).toBe(401);
  });

  it("returns 403 if not super_admin", async () => {
    mockGetRequestContext.mockResolvedValue(CO_ADMIN_CTX);
    const res = await POST(makeRequest({ email: "a@b.com", password: "Abcd1234!", name: "A", role: "worker" }));
    expect(res.status).toBe(403);
  });

  it("returns 400 if email missing", async () => {
    mockGetRequestContext.mockResolvedValue(SUPER_ADMIN_CTX);
    const res = await POST(makeRequest({ password: "Abcd1234!", name: "A", role: "worker" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/email/i);
  });

  it("returns 400 if password missing", async () => {
    mockGetRequestContext.mockResolvedValue(SUPER_ADMIN_CTX);
    const res = await POST(makeRequest({ email: "a@b.com", name: "A", role: "worker" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/password/i);
  });

  it("returns 400 if password < 8 chars", async () => {
    mockGetRequestContext.mockResolvedValue(SUPER_ADMIN_CTX);
    const res = await POST(makeRequest({ email: "a@b.com", password: "short", name: "A", role: "worker" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/8 characters/i);
  });

  it("returns 400 if role is invalid", async () => {
    mockGetRequestContext.mockResolvedValue(SUPER_ADMIN_CTX);
    const res = await POST(makeRequest({ email: "a@b.com", password: "Abcd1234!", name: "A", role: "user" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/role/i);
  });

  it("creates a worker user successfully", async () => {
    mockGetRequestContext.mockResolvedValue(SUPER_ADMIN_CTX);
    mockAdminUsersCreate.mockResolvedValue({
      data: { user: { id: "new-uid" } },
      error: null,
    });
    const mockUpsert = jest.fn().mockResolvedValue({ error: null });
    mockFromProfiles.mockReturnValue({ upsert: mockUpsert });

    const res = await POST(makeRequest({
      email: "worker@test.com",
      password: "Abcd1234!",
      name: "Worker Test",
      role: "worker",
      canteen_id: "canteen-uuid",
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.role).toBe("worker");
    expect(mockAdminUsersCreate).toHaveBeenCalledWith(
      expect.objectContaining({ email_confirm: true })
    );
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ role: "worker", canteen_id: "canteen-uuid" })
    );
  });

  it("rolls back auth user if profile creation fails", async () => {
    mockGetRequestContext.mockResolvedValue(SUPER_ADMIN_CTX);
    mockAdminUsersCreate.mockResolvedValue({
      data: { user: { id: "new-uid-2" } },
      error: null,
    });
    mockFromProfiles.mockReturnValue({
      upsert: jest.fn().mockResolvedValue({ error: { message: "DB error" } }),
    });
    mockAdminUsersDelete.mockResolvedValue({ error: null });

    const res = await POST(makeRequest({
      email: "fail@test.com",
      password: "Abcd1234!",
      name: "Fail",
      role: "worker",
    }));

    expect(res.status).toBe(500);
    expect(mockAdminUsersDelete).toHaveBeenCalledWith("new-uid-2");
  });

  it("returns 400 if Supabase auth says user already registered", async () => {
    mockGetRequestContext.mockResolvedValue(SUPER_ADMIN_CTX);
    mockAdminUsersCreate.mockResolvedValue({
      data: null,
      error: { message: "User already registered" },
    });

    const res = await POST(makeRequest({
      email: "existing@test.com",
      password: "Abcd1234!",
      name: "Existing",
      role: "worker",
    }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/already exists/i);
  });

  it("allows all valid roles: co_admin, canteen_admin, vendor, worker", async () => {
    for (const role of ["co_admin", "canteen_admin", "vendor", "worker"]) {
      jest.clearAllMocks();
      mockGetRequestContext.mockResolvedValue(SUPER_ADMIN_CTX);
      mockAdminUsersCreate.mockResolvedValue({
        data: { user: { id: `uid-${role}` } },
        error: null,
      });
      mockFromProfiles.mockReturnValue({
        upsert: jest.fn().mockResolvedValue({ error: null }),
      });

      const res = await POST(makeRequest({
        email: `${role}@test.com`,
        password: "Abcd1234!",
        name: role,
        role,
      }));
      expect(res.status).toBe(200);
    }
  });
});

// ─── PATCH — update user ──────────────────────────────────────────────────────
describe("PATCH /api/admin/users", () => {
  function makePatchRequest(body: unknown) {
    return new Request("http://localhost/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify(body),
    });
  }

  beforeEach(() => jest.clearAllMocks());

  it("returns 401 if no auth", async () => {
    mockGetRequestContext.mockResolvedValue(null);
    const res = await PATCH(makePatchRequest({ uid: "x" }));
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-super_admin", async () => {
    mockGetRequestContext.mockResolvedValue(CANTEEN_CTX);
    const res = await PATCH(makePatchRequest({ uid: "x" }));
    expect(res.status).toBe(403);
  });

  it("returns 400 if uid missing", async () => {
    mockGetRequestContext.mockResolvedValue(SUPER_ADMIN_CTX);
    const res = await PATCH(makePatchRequest({ name: "Test" }));
    expect(res.status).toBe(400);
  });

  it("resets password when new_password provided", async () => {
    mockGetRequestContext.mockResolvedValue(SUPER_ADMIN_CTX);
    mockAdminUsersUpdate.mockResolvedValue({ error: null });
    mockFromProfiles.mockReturnValue({
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockResolvedValue({ error: null }),
    });

    const res = await PATCH(makePatchRequest({ uid: "user-uid", new_password: "NewPass123!" }));
    expect(res.status).toBe(200);
    expect(mockAdminUsersUpdate).toHaveBeenCalledWith("user-uid", { password: "NewPass123!" });
  });

  it("updates canteen_id", async () => {
    mockGetRequestContext.mockResolvedValue(SUPER_ADMIN_CTX);
    const mockUpdate = jest.fn().mockReturnThis();
    const mockEq     = jest.fn().mockResolvedValue({ error: null });
    mockFromProfiles.mockReturnValue({ update: mockUpdate, eq: mockEq });

    const res = await PATCH(makePatchRequest({
      uid: "user-uid",
      canteen_id: "new-canteen-uuid",
    }));
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ canteen_id: "new-canteen-uuid" })
    );
  });
});

// ─── DELETE — remove user ─────────────────────────────────────────────────────
describe("DELETE /api/admin/users", () => {
  function makeDeleteRequest(body: unknown) {
    return new Request("http://localhost/api/admin/users", {
      method: "DELETE",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify(body),
    });
  }

  beforeEach(() => jest.clearAllMocks());

  it("returns 401 if no auth", async () => {
    mockGetRequestContext.mockResolvedValue(null);
    const res = await DELETE(makeDeleteRequest({ uid: "x" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 if uid missing", async () => {
    mockGetRequestContext.mockResolvedValue(SUPER_ADMIN_CTX);
    const res = await DELETE(makeDeleteRequest({}));
    expect(res.status).toBe(400);
  });

  it("prevents self-deletion", async () => {
    mockGetRequestContext.mockResolvedValue({ uid: "self-uid", role: "super_admin" as const });
    const res = await DELETE(makeDeleteRequest({ uid: "self-uid" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/own account/i);
  });

  it("deletes user successfully", async () => {
    mockGetRequestContext.mockResolvedValue(SUPER_ADMIN_CTX);
    mockAdminUsersDelete.mockResolvedValue({ error: null });

    const res = await DELETE(makeDeleteRequest({ uid: "other-uid" }));
    expect(res.status).toBe(200);
    expect(mockAdminUsersDelete).toHaveBeenCalledWith("other-uid");
  });
});

/**
 * Unit tests for auth API routes:
 *  - POST /api/auth/resolve-username
 *  - POST /api/notifications (create)
 *  - GET  /api/notifications (list)
 */

// ─── mocks ───────────────────────────────────────────────────────────────────
const mockFromProfiles = jest.fn();
const mockFromNotifications = jest.fn();
const mockFromNotifReads = jest.fn();

jest.mock("@/lib/supabase-server", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "profiles")              return mockFromProfiles();
      if (table === "notifications")         return mockFromNotifications();
      if (table === "notification_reads")    return mockFromNotifReads();
      return {};
    },
  }),
}));

const mockGetRequestContext = jest.fn();
jest.mock("@/lib/authServer", () => ({
  getRequestContext: (...args: unknown[]) => mockGetRequestContext(...args),
}));

import { POST as resolveUsername } from "@/app/api/auth/resolve-username/route";
import { GET as notificationsGet, POST as notificationsPost } from "@/app/api/notifications/route";

// ─── resolve-username ─────────────────────────────────────────────────────────
describe("POST /api/auth/resolve-username", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 400 for invalid JSON", async () => {
    const req = new Request("http://localhost/api/auth/resolve-username", {
      method: "POST",
      body: "not-json",
      headers: { "Content-Type": "application/json" },
    });
    const res = await resolveUsername(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 for missing username", async () => {
    const req = new Request("http://localhost/api/auth/resolve-username", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "Content-Type": "application/json" },
    });
    const res = await resolveUsername(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/required/i);
  });

  it("returns 400 for too-short username", async () => {
    const req = new Request("http://localhost/api/auth/resolve-username", {
      method: "POST",
      body: JSON.stringify({ username: "ab" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await resolveUsername(req);
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid format (has spaces)", async () => {
    const req = new Request("http://localhost/api/auth/resolve-username", {
      method: "POST",
      body: JSON.stringify({ username: "john doe" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await resolveUsername(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/invalid username format/i);
  });

  it("returns 404 if username not found", async () => {
    mockFromProfiles.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
    });

    const req = new Request("http://localhost/api/auth/resolve-username", {
      method: "POST",
      body: JSON.stringify({ username: "notfound" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await resolveUsername(req);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/no account/i);
  });

  it("returns email for valid username", async () => {
    mockFromProfiles.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({
        data: { email: "student@test.com" },
        error: null,
      }),
    });

    const req = new Request("http://localhost/api/auth/resolve-username", {
      method: "POST",
      body: JSON.stringify({ username: "johndoe" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await resolveUsername(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.email).toBe("student@test.com");
  });

  it("strips @ prefix from username", async () => {
    let captured: string | null = null;
    mockFromProfiles.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockImplementation((_col: string, val: string) => {
        captured = val;
        return { maybeSingle: jest.fn().mockResolvedValue({ data: { email: "a@b.com" }, error: null }) };
      }),
    });

    const req = new Request("http://localhost/api/auth/resolve-username", {
      method: "POST",
      body: JSON.stringify({ username: "@johndoe" }),
      headers: { "Content-Type": "application/json" },
    });
    await resolveUsername(req);
    expect(captured).toBe("johndoe");
  });

  it("returns 500 on DB error", async () => {
    mockFromProfiles.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: { message: "db error" } }),
    });

    const req = new Request("http://localhost/api/auth/resolve-username", {
      method: "POST",
      body: JSON.stringify({ username: "validusr" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await resolveUsername(req);
    expect(res.status).toBe(500);
  });
});

// ─── notifications GET ────────────────────────────────────────────────────────
describe("GET /api/notifications", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 401 if unauthenticated", async () => {
    mockGetRequestContext.mockResolvedValue(null);
    const req = new Request("http://localhost/api/notifications", {
      headers: { Authorization: "Bearer invalid" },
    });
    const res = await notificationsGet(req);
    expect(res.status).toBe(401);
  });

  it("returns notifications list for super_admin", async () => {
    mockGetRequestContext.mockResolvedValue({
      uid: "admin-uid",
      role: "super_admin",
      canteenId: null,
    });

    const mockNotifChain = {
      select: jest.fn().mockReturnThis(),
      order:  jest.fn().mockReturnThis(),
      limit:  jest.fn().mockResolvedValue({
        data: [
          { id: "n1", title: "Test", body: "Body", type: "info", recipient_type: "all", recipient_id: null, created_at: new Date().toISOString() },
        ],
        error: null,
      }),
    };
    mockFromNotifications.mockReturnValue(mockNotifChain);

    mockFromNotifReads.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq:     jest.fn().mockReturnThis(),
      in:     jest.fn().mockResolvedValue({ data: [], error: null }),
    });

    const req = new Request("http://localhost/api/notifications", {
      headers: { Authorization: "Bearer token" },
    });
    const res = await notificationsGet(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.notifications).toHaveLength(1);
    expect(body.unread_count).toBe(1);
  });
});

// ─── notifications POST ───────────────────────────────────────────────────────
describe("POST /api/notifications", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 403 for non-admin roles", async () => {
    mockGetRequestContext.mockResolvedValue({ uid: "u", role: "user", canteenId: null });
    const req = new Request("http://localhost/api/notifications", {
      method: "POST",
      body: JSON.stringify({ title: "Hi", body: "msg", recipient_type: "all" }),
      headers: { "Content-Type": "application/json", Authorization: "Bearer token" },
    });
    const res = await notificationsPost(req);
    expect(res.status).toBe(403);
  });

  it("returns 400 for missing title", async () => {
    mockGetRequestContext.mockResolvedValue({ uid: "admin", role: "super_admin", canteenId: null });
    const req = new Request("http://localhost/api/notifications", {
      method: "POST",
      body: JSON.stringify({ message: "msg", recipient_type: "all" }),
      headers: { "Content-Type": "application/json", Authorization: "Bearer token" },
    });
    const res = await notificationsPost(req);
    expect(res.status).toBe(400);
    const b = await res.json();
    expect(b.error).toMatch(/title/i);
  });
});

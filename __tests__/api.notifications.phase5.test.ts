/**
 * Phase 5: admin push-notification creation with target_role.
 * Verifies POST /api/notifications accepts target_role and rejects invalid values.
 */

const mockGetRequestContext = jest.fn();
jest.mock("@/lib/authServer", () => ({
  getRequestContext: (...args: unknown[]) => mockGetRequestContext(...args),
}));

interface QB {
  insert: jest.Mock; select: jest.Mock; single: jest.Mock;
}
function makeQB(): QB {
  const qb: Partial<QB> = {};
  qb.insert = jest.fn(() => qb as QB);
  qb.select = jest.fn(() => qb as QB);
  qb.single = jest.fn().mockResolvedValue({ data: { id: "n-1" }, error: null });
  return qb as QB;
}

let notifQB: QB;
jest.mock("@/lib/supabase-server", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "notifications") return notifQB;
      return makeQB();
    },
  }),
}));

import { POST } from "@/app/api/notifications/route";

const ADMIN = { uid: "sa-1", role: "super_admin" as const, canteenId: undefined };
const USER  = { uid: "u-1", role: "user" as const, canteenId: undefined };

beforeEach(() => {
  jest.clearAllMocks();
  notifQB = makeQB();
});

function reqBody(body: unknown) {
  return new Request("http://l/api/notifications", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/notifications (Phase 5 target_role)", () => {
  it("rejects non-admin callers with 403", async () => {
    mockGetRequestContext.mockResolvedValue(USER);
    const res = await POST(reqBody({ title: "x", message: "y", recipient_type: "all" }));
    expect(res.status).toBe(403);
  });

  it("accepts target_role=worker and persists it", async () => {
    mockGetRequestContext.mockResolvedValue(ADMIN);
    const res = await POST(reqBody({
      title: "Pickup ready", message: "Bin 12", recipient_type: "all", target_role: "worker",
    }));
    expect(res.status).toBe(200);
    const insertArg = notifQB.insert.mock.calls[0][0] as Record<string, unknown>;
    expect(insertArg.target_role).toBe("worker");
    expect(insertArg.recipient_type).toBe("all");
  });

  it("accepts target_role=all_staff", async () => {
    mockGetRequestContext.mockResolvedValue(ADMIN);
    const res = await POST(reqBody({
      title: "Shift change", message: "Now", recipient_type: "all", target_role: "all_staff",
    }));
    expect(res.status).toBe(200);
    expect((notifQB.insert.mock.calls[0][0] as Record<string, unknown>).target_role).toBe("all_staff");
  });

  it("rejects invalid target_role with 400", async () => {
    mockGetRequestContext.mockResolvedValue(ADMIN);
    const res = await POST(reqBody({
      title: "x", message: "y", recipient_type: "all", target_role: "ceo",
    }));
    const j = await res.json();
    expect(res.status).toBe(400);
    expect(j.error).toMatch(/target_role/);
  });

  it("persists null target_role when omitted (legacy path)", async () => {
    mockGetRequestContext.mockResolvedValue(ADMIN);
    const res = await POST(reqBody({ title: "x", message: "y", recipient_type: "all" }));
    expect(res.status).toBe(200);
    expect((notifQB.insert.mock.calls[0][0] as Record<string, unknown>).target_role).toBeNull();
  });
});

import { checkRateLimit, clientKey } from "@/lib/rateLimit";

describe("rateLimit", () => {
  it("allows requests under the limit", () => {
    const key = `test:under:${Date.now()}`;
    for (let i = 0; i < 5; i++) {
      const r = checkRateLimit(key, { limit: 5, windowMs: 1000 });
      expect(r.allowed).toBe(true);
      expect(r.remaining).toBe(5 - i - 1);
    }
  });

  it("blocks requests over the limit", () => {
    const key = `test:over:${Date.now()}`;
    for (let i = 0; i < 3; i++) {
      checkRateLimit(key, { limit: 3, windowMs: 1000 });
    }
    const blocked = checkRateLimit(key, { limit: 3, windowMs: 1000 });
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.message).toMatch(/retry/i);
  });

  it("resets after the window expires", async () => {
    const key = `test:reset:${Date.now()}`;
    checkRateLimit(key, { limit: 1, windowMs: 50 });
    expect(checkRateLimit(key, { limit: 1, windowMs: 50 }).allowed).toBe(false);
    await new Promise(r => setTimeout(r, 70));
    expect(checkRateLimit(key, { limit: 1, windowMs: 50 }).allowed).toBe(true);
  });

  it("isolates buckets per key", () => {
    const a = `test:iso:a:${Date.now()}`;
    const b = `test:iso:b:${Date.now()}`;
    checkRateLimit(a, { limit: 1, windowMs: 1000 });
    expect(checkRateLimit(a, { limit: 1, windowMs: 1000 }).allowed).toBe(false);
    expect(checkRateLimit(b, { limit: 1, windowMs: 1000 }).allowed).toBe(true);
  });

  describe("clientKey", () => {
    function mkReq(headers: Record<string, string>): Request {
      return new Request("https://example.com", { headers });
    }

    it("prefers uid when provided", () => {
      expect(clientKey(mkReq({}), "user-123")).toBe("u:user-123");
    });

    it("falls back to first x-forwarded-for IP", () => {
      const req = mkReq({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" });
      expect(clientKey(req)).toBe("ip:203.0.113.5");
    });

    it("uses 'unknown' when no IP header is present", () => {
      expect(clientKey(mkReq({}))).toBe("ip:unknown");
    });
  });
});

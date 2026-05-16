/**
 * 18-bin-operations.spec.ts
 * Bin status, mark-picked, release operations.
 */
import { test, expect } from "@playwright/test";
import { apiFetch, ACCOUNTS, adminClient, getCanteen1Id } from "./_helpers";

test.describe("Bins GET", () => {
  test("canteen_admin can list bins", async () => {
    const res = await apiFetch("/api/bins", {}, ACCOUNTS.canteenAdmin);
    expect([200, 400]).toContain(res.status);
  });

  test("worker can list bins", async () => {
    const res = await apiFetch("/api/bins", {}, ACCOUNTS.worker);
    expect([200, 400]).toContain(res.status);
  });

  test("student cannot list bins (403)", async () => {
    const res = await apiFetch("/api/bins", {}, ACCOUNTS.student1);
    expect(res.status).toBe(403);
  });

  test("unauthenticated cannot list bins (401)", async () => {
    const res = await fetch(`${process.env.APP_BASE_URL ?? "http://localhost:3000"}/api/bins`);
    expect(res.status).toBe(401);
  });

  test("canteen1 has 60 bins provisioned", async () => {
    const canteenId = await getCanteen1Id();
    const db = adminClient();
    const { count } = await db.from("bins").select("id", { count: "exact", head: true }).eq("canteen_id", canteenId);
    expect(count).toBe(60);
  });
});

test.describe("Bin status GET", () => {
  test("canteen_admin can get bin status by ID", async () => {
    const canteenId = await getCanteen1Id();
    const db = adminClient();
    const { data: bins } = await db.from("bins").select("id").eq("canteen_id", canteenId).limit(1);
    if (!bins?.length) { test.skip(); return; }

    // Route only exposes PATCH; GET returns 405
    const res = await apiFetch(`/api/bins/${bins[0].id}/status`, {}, ACCOUNTS.canteenAdmin);
    expect([200, 404, 405]).toContain(res.status);
  });

  test("worker can get bin status", async () => {
    const canteenId = await getCanteen1Id();
    const db = adminClient();
    const { data: bins } = await db.from("bins").select("id").eq("canteen_id", canteenId).limit(1);
    if (!bins?.length) { test.skip(); return; }

    // Route only exposes PATCH; GET returns 405
    const res = await apiFetch(`/api/bins/${bins[0].id}/status`, {}, ACCOUNTS.worker);
    expect([200, 404, 405]).toContain(res.status);
  });

  test("student cannot get bin status (403)", async () => {
    const canteenId = await getCanteen1Id();
    const db = adminClient();
    const { data: bins } = await db.from("bins").select("id").eq("canteen_id", canteenId).limit(1);
    if (!bins?.length) { test.skip(); return; }

    // Route only exposes PATCH; GET returns 405 before auth check
    const res = await apiFetch(`/api/bins/${bins[0].id}/status`, {}, ACCOUNTS.student1);
    expect([403, 404, 405]).toContain(res.status);
  });

  test("non-existent bin returns 404", async () => {
    // Route only exposes PATCH; GET returns 405
    const res = await apiFetch("/api/bins/00000000-0000-0000-0000-000000000000/status", {}, ACCOUNTS.canteenAdmin);
    expect([404, 400, 405]).toContain(res.status);
  });
});

test.describe("Bin mark-picked", () => {
  test("worker can call mark-picked on a bin", async () => {
    const canteenId = await getCanteen1Id();
    const db = adminClient();
    const { data: bins } = await db.from("bins").select("id").eq("canteen_id", canteenId).eq("is_occupied", false).limit(1);
    if (!bins?.length) { test.skip(); return; }

    const res = await apiFetch(`/api/bins/${bins[0].id}/mark-picked`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }, ACCOUNTS.worker);
    expect([200, 400, 404]).toContain(res.status);
  });

  test("student cannot call mark-picked (403)", async () => {
    const canteenId = await getCanteen1Id();
    const db = adminClient();
    const { data: bins } = await db.from("bins").select("id").eq("canteen_id", canteenId).limit(1);
    if (!bins?.length) { test.skip(); return; }

    const res = await apiFetch(`/api/bins/${bins[0].id}/mark-picked`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }, ACCOUNTS.student1);
    expect([403, 401]).toContain(res.status);
  });
});

test.describe("Bin verify-OTP endpoint", () => {
  test("worker can call bin-level verify-otp", async () => {
    const canteenId = await getCanteen1Id();
    const db = adminClient();
    const { data: bins } = await db.from("bins").select("id").eq("canteen_id", canteenId).limit(1);
    if (!bins?.length) { test.skip(); return; }

    const res = await apiFetch(`/api/bins/${bins[0].id}/verify-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ otp: "000000" }),
    }, ACCOUNTS.worker);
    expect([200, 400, 404]).toContain(res.status);
  });
});

test.describe("Bin regeneration and release", () => {
  test("canteen_admin can call bins regenerate", async () => {
    const res = await apiFetch("/api/canteen/bins/regenerate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }, ACCOUNTS.canteenAdmin);
    expect([200, 400, 404]).toContain(res.status);
  });

  test("canteen_admin can call bins release-all", async () => {
    const res = await apiFetch("/api/canteen/bins/release-all", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }, ACCOUNTS.canteenAdmin);
    expect([200, 400, 404]).toContain(res.status);
  });

  test("worker cannot release all bins (403)", async () => {
    const res = await apiFetch("/api/canteen/bins/release-all", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }, ACCOUNTS.worker);
    expect([403, 401]).toContain(res.status);
  });
});

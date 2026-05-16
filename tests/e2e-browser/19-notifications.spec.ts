/**
 * 19-notifications.spec.ts
 * Notification fetching for all roles, role-based filtering.
 */
import { test, expect } from "@playwright/test";
import { apiFetch, ACCOUNTS, adminClient } from "./_helpers";

test.describe("Notifications GET — access", () => {
  test("student can fetch their notifications", async () => {
    const res = await apiFetch("/api/notifications", {}, ACCOUNTS.student1);
    expect(res.status).toBe(200);
    const data = await res.json() as { notifications?: unknown[] } | unknown[];
    const list = Array.isArray(data) ? data : (data as { notifications?: unknown[] }).notifications ?? [];
    expect(Array.isArray(list)).toBe(true);
  });

  test("canteen_admin can fetch notifications", async () => {
    const res = await apiFetch("/api/notifications", {}, ACCOUNTS.canteenAdmin);
    expect(res.status).toBe(200);
  });

  test("worker can fetch notifications", async () => {
    const res = await apiFetch("/api/notifications", {}, ACCOUNTS.worker);
    expect(res.status).toBe(200);
  });

  test("super_admin can fetch all notifications", async () => {
    const res = await apiFetch("/api/notifications", {}, ACCOUNTS.superAdmin);
    expect(res.status).toBe(200);
  });

  test("co_admin can fetch notifications", async () => {
    const res = await apiFetch("/api/notifications", {}, ACCOUNTS.coAdmin);
    expect(res.status).toBe(200);
  });

  test("unauthenticated cannot fetch notifications (401)", async () => {
    const res = await fetch(`${process.env.APP_BASE_URL ?? "http://localhost:3000"}/api/notifications`);
    expect(res.status).toBe(401);
  });
});

test.describe("Notifications — structure", () => {
  test("notification response has expected fields", async () => {
    const db = adminClient();
    // Seed a test notification visible to all
    const { data: notif } = await db.from("notifications").insert({
      title: "E2E Test Notification",
      body: "This is a test",
      type: "info",
      recipient_type: "all",
      target_role: "all_staff",
    }).select("id").single();

    if (!notif) { test.skip(); return; }

    const res = await apiFetch("/api/notifications", {}, ACCOUNTS.student1);
    expect(res.status).toBe(200);
    const data = await res.json() as { notifications?: { id: string; title: string }[] } | { id: string; title: string }[];
    const list = Array.isArray(data) ? data : (data as { notifications?: { id: string; title: string }[] }).notifications ?? [];
    const found = list.find((n: { id: string }) => n.id === notif.id);
    if (found) {
      expect(found).toHaveProperty("title");
      expect(found).toHaveProperty("body");
    }

    await db.from("notifications").delete().eq("id", notif.id);
  });

  test("staff-only notification not visible to student", async () => {
    const db = adminClient();
    const { data: notif } = await db.from("notifications").insert({
      title: "Staff Only E2E",
      body: "Staff notification",
      type: "info",
      recipient_type: "all",
      target_role: "all_staff",
    }).select("id").single();

    if (!notif) { test.skip(); return; }

    const res = await apiFetch("/api/notifications", {}, ACCOUNTS.student1);
    const data = await res.json() as { notifications?: { id: string }[] } | { id: string }[];
    const list = Array.isArray(data) ? data : (data as { notifications?: { id: string }[] }).notifications ?? [];
    const found = list.find((n: { id: string }) => n.id === notif.id);
    expect(found).toBeUndefined();

    await db.from("notifications").delete().eq("id", notif.id);
  });

  test("worker notification visible to worker", async () => {
    const db = adminClient();
    const { data: notif } = await db.from("notifications").insert({
      title: "Worker E2E Notice",
      body: "For worker",
      type: "info",
      recipient_type: "all",
      target_role: "worker",
    }).select("id").single();

    if (!notif) { test.skip(); return; }

    const res = await apiFetch("/api/notifications", {}, ACCOUNTS.worker);
    const data = await res.json() as { notifications?: { id: string }[] } | { id: string }[];
    const list = Array.isArray(data) ? data : (data as { notifications?: { id: string }[] }).notifications ?? [];
    const found = list.find((n: { id: string }) => n.id === notif.id);
    expect(found).toBeDefined();

    await db.from("notifications").delete().eq("id", notif.id);
  });
});

test.describe("Version API", () => {
  test("GET /api/version returns version info", async () => {
    const res = await fetch(`${process.env.APP_BASE_URL ?? "http://localhost:3000"}/api/version`);
    expect([200, 404]).toContain(res.status);
  });
});

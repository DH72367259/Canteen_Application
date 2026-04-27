/**
 * Unit tests for lib/roleChecks.ts
 * Pure functions — no mocking required.
 */

import {
  isAdminRole,
  canManageOrders,
  canManageMenu,
  canViewAllUsers,
  canMutateUsers,
} from "@/lib/roleChecks";
import type { UserRole } from "@/types/canteen";

// All valid roles
const ALL_ROLES: UserRole[] = [
  "user",
  "canteen_admin",
  "vendor",
  "worker",
  "super_admin",
  "co_admin",
];

// ─── isAdminRole ──────────────────────────────────────────────────────────────
describe("isAdminRole", () => {
  test.each([
    ["super_admin",   true],
    ["co_admin",      true],
    ["canteen_admin", true],
    ["vendor",        true],
    ["worker",        true],
    ["user",          false],
  ] as [UserRole, boolean][])(
    "role=%s → %s",
    (role, expected) => {
      expect(isAdminRole(role)).toBe(expected);
    }
  );

  it("returns false for null", () => {
    expect(isAdminRole(null)).toBe(false);
  });
});

// ─── canManageOrders ──────────────────────────────────────────────────────────
describe("canManageOrders", () => {
  const canManage: UserRole[] = ["super_admin", "co_admin", "canteen_admin", "vendor", "worker"];
  const cannotManage: UserRole[] = ["user"];

  test.each(canManage)("allows %s", (role) => {
    expect(canManageOrders(role)).toBe(true);
  });

  test.each(cannotManage)("denies %s", (role) => {
    expect(canManageOrders(role)).toBe(false);
  });

  it("returns false for null", () => {
    expect(canManageOrders(null)).toBe(false);
  });
});

// ─── canManageMenu ────────────────────────────────────────────────────────────
describe("canManageMenu", () => {
  const canManage: UserRole[] = ["vendor", "super_admin", "co_admin"];
  const cannotManage: UserRole[] = ["user", "canteen_admin", "worker"];

  test.each(canManage)("allows %s", (role) => {
    expect(canManageMenu(role)).toBe(true);
  });

  test.each(cannotManage)("denies %s", (role) => {
    expect(canManageMenu(role)).toBe(false);
  });

  it("returns false for null", () => {
    expect(canManageMenu(null)).toBe(false);
  });
});

// ─── canViewAllUsers ──────────────────────────────────────────────────────────
describe("canViewAllUsers", () => {
  const canView: UserRole[] = ["super_admin", "co_admin"];
  const cannotView: UserRole[] = ["user", "canteen_admin", "vendor", "worker"];

  test.each(canView)("allows %s", (role) => {
    expect(canViewAllUsers(role)).toBe(true);
  });

  test.each(cannotView)("denies %s", (role) => {
    expect(canViewAllUsers(role)).toBe(false);
  });

  it("returns false for null", () => {
    expect(canViewAllUsers(null)).toBe(false);
  });
});

// ─── canMutateUsers ───────────────────────────────────────────────────────────
describe("canMutateUsers", () => {
  it("only super_admin can mutate users", () => {
    expect(canMutateUsers("super_admin")).toBe(true);
  });

  const cannotMutate: UserRole[] = ["co_admin", "canteen_admin", "vendor", "worker", "user"];
  test.each(cannotMutate)("denies %s", (role) => {
    expect(canMutateUsers(role)).toBe(false);
  });

  it("returns false for null", () => {
    expect(canMutateUsers(null)).toBe(false);
  });
});

// ─── Completeness check ───────────────────────────────────────────────────────
describe("role coverage", () => {
  it("all roles are handled by isAdminRole", () => {
    // Just calling it with every role should not throw
    ALL_ROLES.forEach(role => {
      expect(() => isAdminRole(role)).not.toThrow();
    });
  });
});

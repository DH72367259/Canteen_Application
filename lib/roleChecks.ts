import type { UserRole } from "@/types/canteen";

/**
 * Check if a role has admin privileges
 */
export function isAdminRole(role: UserRole | null): boolean {
  return role === "super_admin" || role === "co_admin" || role === "canteen_admin" || role === "vendor" || role === "worker";
}

export function canManageOrders(role: UserRole | null): boolean {
  return role === "super_admin" || role === "co_admin" || role === "canteen_admin" || role === "vendor" || role === "worker";
}

export function canManageMenu(role: UserRole | null): boolean {
  return role === "vendor" || role === "super_admin" || role === "co_admin";
}

export function canViewAllUsers(role: UserRole | null): boolean {
  return role === "super_admin" || role === "co_admin";
}

/** Only pure super_admin may create / delete / reset-password for users. co_admin cannot. */
export function canMutateUsers(role: UserRole | null): boolean {
  return role === "super_admin";
}

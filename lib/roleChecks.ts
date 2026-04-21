import type { UserRole } from "@/types/canteen";

/**
 * Check if a role has admin privileges
 */
export function isAdminRole(role: UserRole | null): boolean {
  return role === "super-admin" || role === "canteen-admin" || role === "vendor" || role === "worker";
}

/**
 * Check if a role can manage orders
 */
export function canManageOrders(role: UserRole | null): boolean {
  return role === "super-admin" || role === "canteen-admin";
}

/**
 * Check if a role can manage menu
 */
export function canManageMenu(role: UserRole | null): boolean {
  return role === "vendor" || role === "super-admin";
}

/**
 * Check if a role can view all users
 */
export function canViewAllUsers(role: UserRole | null): boolean {
  return role === "super-admin";
}

import { useAuth } from "./auth-context";
import type { UserRole } from "@/types/canteen";

/**
 * Hook to get current user's role and metadata — backed by Supabase auth.
 */
export function useUserRole() {
  const { user, loading } = useAuth();
  const role = (user?.role as UserRole) ?? null;
  const uid = user?.uid ?? null;
  const email = user?.email ?? null;

  return { role, uid, email, loading };
}

/**
 * Get the dashboard URL for a given role
 */
export function getDashboardUrl(role: UserRole): string {
  switch (role) {
    case "super_admin":
      return "/admin/dashboard";
    case "canteen_admin":
      return "/vendor/dashboard";
    case "vendor":
      return "/vendor/dashboard";
    case "worker":
      return "/worker/orders";
    case "user":
    default:
      return "/dashboard";
  }
}

export function isAdminRole(role: UserRole | null): boolean {
  return role === "super_admin" || role === "canteen_admin" || role === "vendor" || role === "worker";
}

import { useEffect, useState } from "react";
import { getClientAuth } from "./firebaseClient";
import type { UserRole } from "@/types/canteen";

/**
 * Hook to get current user's role and metadata
 */
export function useUserRole() {
  const [role, setRole] = useState<UserRole | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = getClientAuth().onAuthStateChanged(async (user) => {
      if (user) {
        setUid(user.uid);
        setEmail(user.email || null);
        
        // Get custom claims from ID token
        const claims = await user.getIdTokenResult();
        const customRole = claims.claims.role as UserRole | undefined;
        
        if (customRole) {
          setRole(customRole);
        } else if (user.isAnonymous) {
          setRole("customer");
        } else {
          // Default to "customer" if no role set
          setRole("customer");
        }
      } else {
        setRole(null);
        setUid(null);
        setEmail(null);
      }
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  return { role, uid, email, loading };
}

/**
 * Get the dashboard URL for a given role
 */
export function getDashboardUrl(role: UserRole): string {
  switch (role) {
    case "super-admin":
      return "/system/dashboard";
    case "canteen-admin":
      return "/admin/dashboard";
    case "vendor":
      return "/vendor/dashboard";
    case "worker":
      return "/worker/dashboard";
    case "customer":
    default:
      return "/dashboard";
  }
}

/**
 * Check if user has admin privileges
 */
export function isAdminRole(role: UserRole | null): boolean {
  return role === "super-admin" || role === "canteen-admin" || role === "vendor" || role === "worker";
}

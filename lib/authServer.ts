import { getAdminAuth } from "@/lib/firebaseAdmin";
import type { UserRole } from "@/types/canteen";

export type RequestContext = {
  uid: string;
  email?: string;
  role: UserRole;
  canteenId?: string;
};

function parseAdminAllowList(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function parseRoleFromEmail(email: string): UserRole {
  const lowerEmail = email.toLowerCase();
  
  // Check for role prefixes in email (super-admin@, canteen-admin@, vendor@, worker@)
  if (lowerEmail.startsWith("super-admin@")) return "super-admin";
  if (lowerEmail.startsWith("canteen-admin@")) return "canteen-admin";
  if (lowerEmail.startsWith("vendor@")) return "vendor";
  if (lowerEmail.startsWith("worker@")) return "worker";
  
  // Default allowlist emails are admins (for backward compatibility)
  return "canteen-admin";
}

export async function getRequestContext(request: Request): Promise<RequestContext> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) {
    throw new Error("Missing bearer token.");
  }

  const decoded = await getAdminAuth().verifyIdToken(token);
  const email = decoded.email?.toLowerCase();
  const allowList = parseAdminAllowList();
  
  let role: UserRole = "customer";
  let canteenId: string | undefined;
  
  // Check if user is in admin allowlist (legacy support)
  if (email && allowList.includes(email)) {
    role = parseRoleFromEmail(email);
  }
  
  // Also check custom claims for role (recommended way)
  if (decoded.role) {
    role = decoded.role as UserRole;
  }
  
  // Extract canteen ID from custom claims if present
  if (decoded.canteenId) {
    canteenId = decoded.canteenId as string;
  }

  return {
    uid: decoded.uid,
    email: decoded.email,
    role,
    canteenId,
  };
}

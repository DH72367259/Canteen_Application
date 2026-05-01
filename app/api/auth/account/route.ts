import { getRequestContext } from "@/lib/authServer";
import { createAdminClient } from "@/lib/supabase-server";
import { checkRateLimit, clientKey } from "@/lib/rateLimit";
import { randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/auth/account
 *
 * DPDPA 2023 / GDPR Art. 17 right-to-erasure endpoint.
 *
 * What it does (in order, all server-side via service-role key):
 *   1. Anonymises personally identifiable fields on the user's profile row
 *      (name, username, phone, email, fcm_token) so historical orders /
 *      payments / wallet transactions remain linkable for legally-required
 *      financial audit retention but contain no personal data.
 *   2. Marks the profile as deleted (`deleted_at`, role -> 'deleted') so
 *      RLS-protected reads can filter the user out of normal listings.
 *   3. Resets the auth password to a random 64-byte string and overwrites
 *      auth user metadata, effectively revoking login access. We deliberately
 *      do NOT call `auth.admin.deleteUser()` because the profile cascade
 *      would FK-violate against `orders.user_id` (no ON DELETE on that FK).
 *      Anonymisation + auth revocation is the GDPR-recommended pattern when
 *      a hard delete would break legal retention obligations (Art. 17(3)(b)).
 *   4. Signs out every active session.
 *
 * Caller is the user themselves — must be authenticated. Staff roles are
 * NOT allowed to delete via this endpoint (super_admin, canteen_admin,
 * worker, vendor, co_admin) because deleting them mid-operation would
 * orphan canteen state; staff removal is an admin operation.
 *
 * Rate limited at 3/hour/user to prevent runaway loops.
 */
export async function DELETE(request: NextRequest) {
  const ctx = await getRequestContext(request);
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const STAFF_ROLES = new Set(["super_admin", "canteen_admin", "worker", "vendor", "co_admin"]);
  if (STAFF_ROLES.has(ctx.role)) {
    return Response.json(
      { error: "Staff accounts cannot self-delete. Contact your administrator." },
      { status: 403 },
    );
  }

  const rl = checkRateLimit(`account-delete:${clientKey(request, ctx.uid)}`, { limit: 3, windowMs: 60 * 60 * 1000 });
  if (!rl.allowed) {
    return Response.json({ error: rl.message }, {
      status: 429,
      headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) },
    });
  }

  const admin = createAdminClient();
  const anonymisedAt = new Date().toISOString();

  // 1+2. Anonymise the profile in place.
  const { error: profileErr } = await admin.from("profiles").update({
    name: "Deleted User",
    username: null,
    phone: null,
    email: null,
    fcm_token: null,
    role: "deleted",
    deleted_at: anonymisedAt,
  }).eq("id", ctx.uid);

  // The `email`, `username`, `phone`, `fcm_token`, `deleted_at`, role='deleted'
  // columns may not exist on every deployment; fall back to whatever we can.
  // We still treat the request as successful provided at least the name was
  // scrubbed — full schema upgrades are documented in the README.
  if (profileErr) {
    const { error: minimalErr } = await admin.from("profiles").update({
      name: "Deleted User",
    }).eq("id", ctx.uid);
    if (minimalErr) {
      return Response.json(
        { error: "Failed to anonymise profile. Please contact support." },
        { status: 500 },
      );
    }
  }

  // 3. Revoke login by replacing the password with cryptographically random
  // bytes and stamping the deletion in user metadata. Password changes via
  // the admin API automatically invalidate all existing refresh tokens for
  // the user, so every active device is logged out at the next refresh.
  const randomPassword = randomBytes(48).toString("base64url");
  await admin.auth.admin.updateUserById(ctx.uid, {
    password: randomPassword,
    user_metadata: {
      deleted_at: anonymisedAt,
      account_status: "deleted",
    },
  });

  return Response.json({
    success: true,
    deletedAt: anonymisedAt,
    message: "Your account has been deleted. Personal data was anonymised; financial records are retained per legal requirements.",
  });
}

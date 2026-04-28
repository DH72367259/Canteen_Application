import { NextRequest } from "next/server";
import { getRequestContext } from "@/lib/authServer";
import { createAdminClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

const PLATFORMS = new Set(["ios", "android", "web"]);

/**
 * Save a Capacitor push-notification device token for the authenticated user
 * so the backend can target this specific device for order-ready / refund
 * notifications. Tokens are upserted on (user_id, token) so re-launches and
 * re-registrations don't create duplicates.
 *
 * The device_tokens table is created lazily via a migration in a follow-up
 * push. Until then this endpoint accepts the call and returns 202 so the
 * mobile shell never errors on first launch.
 */
export async function POST(req: NextRequest) {
  const context = await getRequestContext(req);
  if (!context) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return Response.json({ error: "Invalid body" }, { status: 400 });

  const token    = typeof body.token    === "string" ? body.token.slice(0, 500) : "";
  const platform = typeof body.platform === "string" ? body.platform.toLowerCase() : "";
  if (!token || !PLATFORMS.has(platform)) {
    return Response.json({ error: "Invalid token or platform" }, { status: 400 });
  }

  const supabase = createAdminClient();
  // Try to upsert; if the table does not exist yet, swallow the error so the
  // mobile shell never sees a hard failure on first launch.
  const { error } = await supabase
    .from("device_tokens")
    .upsert(
      { user_id: context.uid, token, platform, last_seen_at: new Date().toISOString() },
      { onConflict: "user_id,token" }
    );

  if (error) {
    // Table missing — accept silently. Real failures are still logged.
    if (!/relation .* does not exist/i.test(error.message)) {
      console.error("[device-token] upsert failed:", error);
    }
    return Response.json({ accepted: true, persisted: false }, { status: 202 });
  }

  return Response.json({ accepted: true, persisted: true });
}

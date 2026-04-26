/**
 * /api/auth/session
 *
 * POST — register an active session (called on every successful login)
 *         Returns { alreadyActive: true, deviceInfo } if another session exists.
 *
 * DELETE — force-logout all sessions for the current user (called when user confirms
 *          "yes, log me out everywhere").
 */
import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

function getDeviceInfo(req: NextRequest): string {
  const ua = req.headers.get("user-agent") ?? "Unknown";
  // Truncate to 120 chars max — no sensitive data stored
  return ua.slice(0, 120);
}

function getIpHash(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for") ?? "";
  const ip = forwarded.split(",")[0].trim() || "unknown";
  // Never store raw IPs — store a one-way SHA-256 hash
  return crypto.createHash("sha256").update(ip + (SUPABASE_URL || "salt")).digest("hex").slice(0, 16);
}

async function getAuthedUser(req: NextRequest) {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.replace("Bearer ", "").trim();
  if (!token) return null;
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;
  // Return the client so callers can reuse it instead of creating a second connection.
  return { user, token, supabase };
}

// POST — register session, detect concurrent login
export async function POST(req: NextRequest) {
  const authed = await getAuthedUser(req);
  if (!authed) return Response.json({ error: "Unauthorised" }, { status: 401 });

  const { user, supabase } = authed;
  const deviceInfo = getDeviceInfo(req);
  const ipHash = getIpHash(req);
  const now = new Date().toISOString();

  // Check for an existing active session in the last 30 minutes
  const windowMs = 30 * 60 * 1000;
  const cutoff = new Date(Date.now() - windowMs).toISOString();

  const { data: existing } = await supabase
    .from("active_sessions")
    .select("id, device_info, created_at")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .gt("last_seen", cutoff)
    .order("last_seen", { ascending: false })
    .limit(1)
    .single();

  if (existing) {
    // Another active session exists — ask user if they want to log out everywhere
    return Response.json({
      alreadyActive: true,
      existingDevice: existing.device_info,
      sessionId: existing.id,
    });
  }

  // Register this new session
  const { data: newSession } = await supabase
    .from("active_sessions")
    .insert({
      user_id: user.id,
      device_info: deviceInfo,
      ip_hash: ipHash,
      is_active: true,
      last_seen: now,
    })
    .select("id")
    .single();

  return Response.json({ alreadyActive: false, sessionId: newSession?.id });
}

// PATCH — heartbeat: keep session alive, or mark inactive on logout
export async function PATCH(req: NextRequest) {
  const authed = await getAuthedUser(req);
  if (!authed) return Response.json({ error: "Unauthorised" }, { status: 401 });

  const { user, supabase } = authed;
  const body = await req.json().catch(() => ({}));
  const sessionId = body.sessionId as string | undefined;
  const markInactive = body.markInactive === true;

  const update = markInactive
    ? { is_active: false }
    : { last_seen: new Date().toISOString() };

  const query = supabase
    .from("active_sessions")
    .update(update)
    .eq("user_id", user.id);

  if (sessionId) {
    await query.eq("id", sessionId);
  } else {
    await query.eq("is_active", true);
  }

  return Response.json({ ok: true });
}

// DELETE — force-logout all sessions for this user, then re-register this device
export async function DELETE(req: NextRequest) {
  const authed = await getAuthedUser(req);
  if (!authed) return Response.json({ error: "Unauthorised" }, { status: 401 });

  const { user, supabase } = authed;

  // Mark all existing sessions as inactive
  await supabase
    .from("active_sessions")
    .update({ is_active: false })
    .eq("user_id", user.id);

  // Register fresh session for this device
  const deviceInfo = getDeviceInfo(req);
  const ipHash = getIpHash(req);

  const { data: newSession } = await supabase
    .from("active_sessions")
    .insert({
      user_id: user.id,
      device_info: deviceInfo,
      ip_hash: ipHash,
      is_active: true,
      last_seen: new Date().toISOString(),
    })
    .select("id")
    .single();

  return Response.json({ ok: true, sessionId: newSession?.id });
}

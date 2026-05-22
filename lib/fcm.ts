/**
 * FCM (Firebase Cloud Messaging) push-notification sender.
 *
 * Sends to every device_token row registered for the given user. Used
 * alongside insertNotification() in app/api/orders/[id]/status/route.ts
 * (and anywhere else we surface a status change to a student) so the
 * in-app bell AND the OS-level push fire from the same code path.
 *
 * GRACEFUL DEGRADATION: if FIREBASE_ADMIN_SDK_JSON is not set, the
 * sender is a no-op. This keeps the codebase shippable during the
 * pre-FCM window (before the operator creates the Firebase project
 * and pastes the service-account JSON into Railway). Once the env
 * var is set, push delivery activates automatically — no redeploy of
 * the API layer needed beyond Railway picking up the new env.
 *
 * Operator setup (one-time):
 *   1. Firebase console → Project Settings → Service accounts →
 *      "Generate new private key" → downloads a JSON file
 *   2. Railway → production env → Variables → add
 *      FIREBASE_ADMIN_SDK_JSON = <paste the entire JSON contents as
 *      a SINGLE LINE> (Railway env vars don't support newlines)
 *   3. Click Deploy to restart with the new env
 */
import type { ServiceAccount } from "firebase-admin";
import admin from "firebase-admin";
import { createAdminClient } from "@/lib/supabase-server";

let _initAttempted = false;
let _initOk = false;

function init(): boolean {
  if (_initAttempted) return _initOk;
  _initAttempted = true;
  const raw = process.env.FIREBASE_ADMIN_SDK_JSON;
  if (!raw) return false;  // graceful no-op
  try {
    if (admin.apps.length === 0) {
      const credential = JSON.parse(raw) as ServiceAccount;
      admin.initializeApp({ credential: admin.credential.cert(credential) });
    }
    _initOk = true;
    return true;
  } catch (e) {
    console.warn("[fcm] init failed — FIREBASE_ADMIN_SDK_JSON is malformed:", (e as Error).message);
    return false;
  }
}

export type PushPayload = {
  title: string;
  body: string;
  /** Optional deep-link path, e.g. "/dashboard/order-status?id=xxx". App
   *  routes this via the Capacitor pushNotificationActionPerformed listener. */
  data?: Record<string, string>;
};

/**
 * Send a push to every registered device token for a user. Best-effort:
 *   - Silent no-op if FCM isn't configured
 *   - Silent no-op if user has no registered tokens
 *   - Auto-prunes tokens FCM reports as invalid (uninstalled, expired)
 *   - Logs but does NOT throw on partial failures — push is a UX
 *     enhancement, not a critical path. Status updates must succeed
 *     even if push fails.
 */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
  if (!userId) return;
  if (!init()) return;

  const db = createAdminClient();
  const { data: tokens, error } = await db
    .from("device_tokens")
    .select("token, platform")
    .eq("user_id", userId);

  if (error) {
    console.warn("[fcm] device_tokens lookup failed:", error.message);
    return;
  }
  if (!tokens || tokens.length === 0) return;

  const message = {
    tokens: tokens.map(t => t.token),
    notification: { title: payload.title, body: payload.body },
    data: payload.data ?? {},
    android: { priority: "high" as const },
    apns: {
      payload: {
        aps: { sound: "default", "content-available": 1 },
      },
    },
  };

  try {
    const result = await admin.messaging().sendEachForMulticast(message);
    // Prune tokens FCM tells us are dead so we don't keep sending to them
    const dead: string[] = [];
    result.responses.forEach((r, i) => {
      if (!r.success) {
        const code = r.error?.code ?? "";
        if (
          code === "messaging/invalid-registration-token" ||
          code === "messaging/registration-token-not-registered"
        ) {
          dead.push(tokens[i].token);
        }
      }
    });
    if (dead.length > 0) {
      await db.from("device_tokens").delete().in("token", dead);
    }
  } catch (e) {
    // Don't throw — push is best-effort
    console.warn("[fcm] sendEachForMulticast failed:", (e as Error).message);
  }
}

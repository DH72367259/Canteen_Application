import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Insert a notification with a target_role-missing fallback.
 *
 * Newer schemas (post phase1_data_foundation migration) have a target_role
 * column on `notifications`. STAGING_FULL_SETUP.sql does NOT — so an insert
 * with target_role set will fail with PGRST204 / 42703 ("column does not
 * exist") on those deployments. Every place that previously did
 *
 *   await supabase.from("notifications").insert({ ..., target_role: "user" })
 *     .then(() => {}, () => {});
 *
 * silently dropped the notification on those deployments, leaving the
 * student bell empty. This helper retries the insert without target_role
 * when the column is missing, so the bell stays accurate everywhere.
 *
 * Failures are logged to the server console so silent drops are visible
 * in logs instead of disappearing into a swallowed promise.
 */
export interface NotifyPayload {
  title: string;
  body: string;
  type: string;
  recipient_type: "all" | "canteen" | "user";
  recipient_id: string | null;
  created_by: string | null;
  target_role?: "user" | "worker" | "canteen_admin" | "super_admin" | "all_staff" | null;
}

export async function insertNotification(
  supabase: SupabaseClient,
  payload: NotifyPayload,
  callerTag = "notify",
): Promise<{ ok: boolean; error?: string }> {
  const { target_role, ...base } = payload;
  // First try with target_role set.
  const first = await supabase.from("notifications").insert({ ...base, ...(target_role ? { target_role } : {}) });
  if (!first.error) return { ok: true };

  const msg = first.error.message ?? "";
  const isColumnMissing =
    /target_role/i.test(msg) ||
    first.error.code === "42703" ||
    first.error.code === "PGRST204";

  if (isColumnMissing) {
    const retry = await supabase.from("notifications").insert(base);
    if (!retry.error) return { ok: true };
    console.warn(`[${callerTag}] notification retry (no target_role) failed:`, retry.error.message);
    return { ok: false, error: retry.error.message };
  }
  console.warn(`[${callerTag}] notification insert failed:`, msg);
  return { ok: false, error: msg };
}

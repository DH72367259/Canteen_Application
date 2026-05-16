/**
 * 08-cleanup.spec.ts
 * Cleans up any E2E-generated test data (orders, one-shot users).
 * Runs last. Preserves all whitelist accounts and seeded canteen structure.
 * Whitelist: admin@noqx.test, coadmin@noqx.test, canteen1@noqx.test,
 *            canteen2@noqx.test, worker1@noqx.test, student1@noqx.test,
 *            student2@noqx.test
 */
import { test } from "@playwright/test";
import { adminClient } from "./_helpers";

const KEEP_EMAILS = new Set([
  "admin@noqx.test",
  "coadmin@noqx.test",
  "canteen1@noqx.test",
  "canteen2@noqx.test",
  "worker1@noqx.test",
  "student1@noqx.test",
  "student2@noqx.test",
]);

test("cleanup: remove E2E-generated orders and one-shot users", async () => {
  const db = adminClient();

  // 1. Delete orders created by e2e test students (emails contain @noqx.test but not in whitelist)
  const { data: ephemeralProfiles } = await db
    .from("profiles")
    .select("id, email")
    .like("email", "%e2e-%@noqx.test");

  const ephemeralIds = (ephemeralProfiles ?? [])
    .filter(p => !KEEP_EMAILS.has(p.email))
    .map(p => p.id);

  if (ephemeralIds.length > 0) {
    // Delete order_items → orders for ephemeral users
    const { data: userOrders } = await db.from("orders").select("id").in("user_id", ephemeralIds);
    const orderIds = (userOrders ?? []).map(o => o.id);
    if (orderIds.length > 0) {
      await db.from("order_items").delete().in("order_id", orderIds);
      await db.from("order_bins").delete().in("order_id", orderIds);
      await db.from("orders").delete().in("id", orderIds);
    }
    await db.from("cart_items").delete().in("user_id", ephemeralIds);

    // Delete ephemeral auth users
    for (const id of ephemeralIds) {
      await db.auth.admin.deleteUser(id).catch(() => {});
    }
    console.log(`Cleaned up ${ephemeralIds.length} ephemeral users`);
  }

  // 2. Free any bins that are occupied but have no order (ghost state).
  // Use is_occupied filter only — current_order_id may not exist in all schema versions.
  const { data: ghostBins } = await db.from("bins").select("id").eq("is_occupied", true);
  const ghostIds = (ghostBins ?? []).map((b: { id: string }) => b.id);
  if (ghostIds.length > 0) {
    const upd = await db.from("bins")
      .update({ current_order_id: null, assigned_order_id: null, is_occupied: false, status: "empty" })
      .in("id", ghostIds);
    if (upd.error && /column .* does not exist/i.test(upd.error.message)) {
      await db.from("bins")
        .update({ assigned_order_id: null, is_occupied: false, status: "empty" })
        .in("id", ghostIds);
    }
  }

  console.log("✅ Cleanup complete — whitelist accounts and canteen structure preserved");
});

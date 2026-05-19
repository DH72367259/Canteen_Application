/**
 * 23-cross-canteen-isolation.spec.ts
 * Data isolation between canteen 1 and canteen 2 — no cross-canteen data leaks.
 */
import { test, expect } from "@playwright/test";
import { apiFetch, ACCOUNTS, adminClient, getCanteen1Id, getStudent1Id } from "./_helpers";

async function getCanteen2Id(): Promise<string> {
  const db = adminClient();
  const { data } = await db.from("profiles").select("canteen_id").eq("email", ACCOUNTS.canteen2Admin.email).maybeSingle();
  const id = (data as { canteen_id?: string } | null)?.canteen_id;
  if (!id) throw new Error("canteen2Id not found");
  return id;
}

test.describe("Menu isolation", () => {
  test("canteen1_admin cannot create menu items for canteen2", async () => {
    // Unique per-run name + try/finally cleanup — without these, a failed
    // assertion below would leak a "Cross Item" row into staging (we shipped
    // with 4 such leaked rows on 2026-05-19; see commit 2eb1f for the cleanup).
    const uniqueName = `Cross Item ${Date.now()}`;
    let createdId: string | null = null;
    const db = adminClient();
    try {
      const res = await apiFetch("/api/canteen/menu", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: uniqueName, price: 50, category: "Meals", availability_type: "batched_prepared" }),
      }, ACCOUNTS.canteenAdmin);
      if (res.status === 200) {
        const data = await res.json() as { item?: { id: string } };
        if (data.item?.id) {
          createdId = data.item.id;
          const { data: item } = await db.from("menu_items").select("canteen_id").eq("id", createdId).single();
          const canteen1Id = await getCanteen1Id();
          expect(item?.canteen_id).toBe(canteen1Id); // Must belong to canteen1, not canteen2
        }
      }
    } finally {
      if (createdId) await db.from("menu_items").delete().eq("id", createdId);
    }
  });

  test("canteen2_admin cannot update canteen1 menu items", async () => {
    const canteenId = await getCanteen1Id();
    const db = adminClient();
    const { data: items } = await db.from("menu_items").select("id").eq("canteen_id", canteenId).limit(1);
    if (!items?.length) { test.skip(); return; }

    const res = await apiFetch(`/api/canteen/menu/${items[0].id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Hijacked Item" }),
    }, ACCOUNTS.canteen2Admin);
    expect([403, 404]).toContain(res.status);
  });

  test("canteen2_admin cannot delete canteen1 menu items", async () => {
    const canteenId = await getCanteen1Id();
    const db = adminClient();
    const { data: items } = await db.from("menu_items").select("id").eq("canteen_id", canteenId).limit(1);
    if (!items?.length) { test.skip(); return; }

    const res = await apiFetch(`/api/canteen/menu/${items[0].id}`, {
      method: "DELETE",
    }, ACCOUNTS.canteen2Admin);
    expect([403, 404]).toContain(res.status);
  });
});

test.describe("Order isolation", () => {
  test("canteen1_admin cannot cancel canteen2 orders", async () => {
    let canteen2Id: string;
    try { canteen2Id = await getCanteen2Id(); } catch { test.skip(); return; }

    const db = adminClient();
    const { data: order } = await db.from("orders")
      .insert({ canteen_id: canteen2Id, user_id: await getStudent1Id().catch(() => null), status: "placed", total_amount: 80, otp: "c2c1c3" })
      .select("id").single();
    if (!order) { test.skip(); return; }

    const res = await apiFetch(`/api/orders/${order.id}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "Cross-canteen cancel attempt" }),
    }, ACCOUNTS.canteenAdmin);
    expect([403, 404]).toContain(res.status);

    await db.from("orders").delete().eq("id", order.id);
  });

  test("canteen2_admin live-orders does not contain canteen1 orders", async () => {
    const canteenId = await getCanteen1Id();
    const db = adminClient();

    const { data: order } = await db.from("orders")
      .insert({ canteen_id: canteenId, user_id: await getStudent1Id().catch(() => null), status: "placed_in_bin", total_amount: 80, otp: "iso001", slot_label: "12:00 - 12:15" })
      .select("id").single();
    if (!order) { test.skip(); return; }

    const res = await apiFetch("/api/canteen/live-orders", {}, ACCOUNTS.canteen2Admin);
    expect(res.status).toBe(200);
    const data = await res.json() as { bins: { order_id?: string }[] };
    const leaked = data.bins.find(b => b.order_id === order.id);
    expect(leaked).toBeUndefined();

    await db.from("orders").delete().eq("id", order.id);
  });

  test("canteen1 OTP verify rejected for canteen2 order", async () => {
    let canteen2Id: string;
    try { canteen2Id = await getCanteen2Id(); } catch { test.skip(); return; }

    const db = adminClient();
    const { data: order } = await db.from("orders")
      .insert({ canteen_id: canteen2Id, user_id: await getStudent1Id().catch(() => null), status: "placed_in_bin", total_amount: 80, otp: "iso002" })
      .select("id").single();
    if (!order) { test.skip(); return; }

    const res = await apiFetch(`/api/orders/${order.id}/verify-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ otp: "iso002" }),
    }, ACCOUNTS.canteenAdmin);
    expect([403, 400]).toContain(res.status);

    await db.from("orders").delete().eq("id", order.id);
  });
});

test.describe("Slot control isolation", () => {
  test("canteen2_admin can only update their own slot-control", async () => {
    const res = await apiFetch("/api/canteen/slot-control", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grace_period_mins: 10 }),
    }, ACCOUNTS.canteen2Admin);
    if (res.status === 200) {
      const data = await res.json() as { canteen_id?: string };
      let canteen2Id: string;
      try { canteen2Id = await getCanteen2Id(); } catch { return; }
      if (data.canteen_id) expect(data.canteen_id).toBe(canteen2Id);
    }
    expect([200, 400]).toContain(res.status);
  });

  test("canteen1_admin slot-control does not affect canteen2", async () => {
    const canteen1Id = await getCanteen1Id();
    const db = adminClient();

    // Read canteen2 slot_control before
    let canteen2Id: string;
    try { canteen2Id = await getCanteen2Id(); } catch { test.skip(); return; }
    const { data: before } = await db.from("slot_control").select("grace_period_mins").eq("canteen_id", canteen2Id).maybeSingle();

    // Update canteen1
    await apiFetch("/api/canteen/slot-control", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grace_period_mins: 7 }),
    }, ACCOUNTS.canteenAdmin);

    // Verify canteen2 unchanged
    const { data: after } = await db.from("slot_control").select("grace_period_mins").eq("canteen_id", canteen2Id).maybeSingle();
    expect(after?.grace_period_mins).toBe(before?.grace_period_mins);

    // Restore canteen1
    await apiFetch("/api/canteen/slot-control", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grace_period_mins: 10 }),
    }, ACCOUNTS.canteenAdmin);
  });
});

test.describe("Bins isolation", () => {
  test("canteen2 bins are separate from canteen1 bins", async () => {
    const canteen1Id = await getCanteen1Id();
    let canteen2Id: string;
    try { canteen2Id = await getCanteen2Id(); } catch { test.skip(); return; }

    const db = adminClient();
    const { data: c1bins } = await db.from("bins").select("id").eq("canteen_id", canteen1Id);
    const { data: c2bins } = await db.from("bins").select("id").eq("canteen_id", canteen2Id);

    const c1ids = new Set((c1bins ?? []).map(b => b.id));
    const c2ids = new Set((c2bins ?? []).map(b => b.id));
    const overlap = [...c1ids].filter(id => c2ids.has(id));
    expect(overlap.length).toBe(0);
  });
});

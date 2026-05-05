import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import {
  APP_URL, SUPABASE_URL, SUPABASE_ANON, WHITELIST,
  adminClient, provisionStudent, deleteUser, apiFetch,
} from "./_helpers";

const CANTEEN_ID = "9d1b1e36-48a1-4ce8-a270-704eec9018c8";

async function loginToken(email: string, password: string): Promise<string> {
  const sb = createClient(SUPABASE_URL, SUPABASE_ANON, { auth: { persistSession: false } });
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`login ${email}: ${error.message}`);
  return data.session!.access_token;
}

async function ensureFutureSlot(): Promise<string> {
  const admin = adminClient();
  const r = await admin.from("time_slots").select("slot_name, start_time").eq("canteen_id", CANTEEN_ID);
  const istNow = (() => { const d = new Date(); return (d.getUTCHours() * 60 + d.getUTCMinutes() + 330) % 1440; })();
  const future = (r.data ?? []).find((s: { start_time: string }) => {
    const [h, m] = s.start_time.split(":").map(Number);
    return h * 60 + m - 15 > istNow;
  });
  if (future) return future.slot_name as string;

  const startMin = Math.min(istNow + 30, 23 * 60 + 30);
  const sh = String(Math.floor(startMin / 60)).padStart(2, "0");
  const sm = String(startMin % 60).padStart(2, "0");
  const eh = String(Math.floor(Math.min(startMin + 30, 23 * 60 + 59) / 60)).padStart(2, "0");
  const em = String(Math.min(startMin + 30, 23 * 60 + 59) % 60).padStart(2, "0");

  // Fetch slot_control to get dynamic max_orders_per_slot
  const { data: sc } = await admin
    .from("slot_control")
    .select("max_orders_per_slot")
    .eq("canteen_id", CANTEEN_ID)
    .single();
  const maxOrders = Number(sc?.max_orders_per_slot) || 45;

  await admin.from("time_slots").insert({
    canteen_id: CANTEEN_ID,
    slot_name: "CAP-E2E",
    start_time: `${sh}:${sm}:00`,
    end_time: `${eh}:${em}:00`,
    max_orders: maxOrders,
    is_active: true,
  });
  return "CAP-E2E";
}

test.describe("menu metadata and cap enforcement", () => {
  test("added item retains meal and capacity metadata", async () => {
    const adminToken = await loginToken(WHITELIST.canteenAdmin.email, WHITELIST.canteenAdmin.password);
    const uniqueName = `Curd Rice Meta ${Date.now()}`;
    let itemId = "";

    try {
      const createRes = await apiFetch(`${APP_URL}/api/canteen/menu`, {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({
          name: uniqueName,
          price: 30,
          category: "Breakfast",
          availability_type: "batched_prepared",
          total_per_day: 10,
          quantity_per_slot: null,
          is_meal: true,
          is_available: true,
        }),
      });
      const created = await createRes.json();
      expect(createRes.status, JSON.stringify(created)).toBe(201);
      itemId = created.item.id;

      const listRes = await apiFetch(`${APP_URL}/api/canteen/menu`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const listed = await listRes.json();
      expect(listRes.status).toBe(200);
      const row = (listed.items as Array<Record<string, unknown>>).find((i) => i.id === itemId);
      expect(row).toBeTruthy();
      expect(row?.availability_type).toBe("batched_prepared");
      expect(row?.total_per_day).toBe(10);
      expect(row?.is_meal).toBe(true);
    } finally {
      if (itemId) {
        await apiFetch(`${APP_URL}/api/canteen/menu/${itemId}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${adminToken}` },
        });
      }
    }
  });

  test("slot cap hides item and blocks over-cap order", async () => {
    const admin = adminClient();
    const adminToken = await loginToken(WHITELIST.canteenAdmin.email, WHITELIST.canteenAdmin.password);
    const slotName = await ensureFutureSlot();
    const uniqueName = `Cap Item ${Date.now()}`;

    const stuA = await provisionStudent(CANTEEN_ID, "cap-a");
    const stuB = await provisionStudent(CANTEEN_ID, "cap-b");

    let itemId = "";
    let orderId = "";

    try {
      const createRes = await apiFetch(`${APP_URL}/api/canteen/menu`, {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({
          name: uniqueName,
          price: 35,
          category: "Breakfast",
          availability_type: "slot_based",
          quantity_per_slot: 2,
          total_per_day: null,
          is_meal: false,
          is_available: true,
        }),
      });
      const created = await createRes.json();
      expect(createRes.status, JSON.stringify(created)).toBe(201);
      itemId = created.item.id;

      const tokA = await loginToken(stuA.email, stuA.password);
      const first = await apiFetch(`${APP_URL}/api/orders/place`, {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${tokA}` },
        body: JSON.stringify({
          canteenId: CANTEEN_ID,
          slotLabel: slotName,
          cartItems: [{ id: itemId, qty: 2 }],
        }),
      });
      const firstBody = await first.json();
      expect(first.status, JSON.stringify(firstBody)).toBeLessThan(400);
      orderId = firstBody.orderId as string;

      const menuRes = await apiFetch(`${APP_URL}/api/canteens/${CANTEEN_ID}/menu`);
      const menuBody = await menuRes.json();
      expect(menuRes.status).toBe(200);
      const stillVisible = (menuBody.items as Array<{ id: string }>).some((it) => it.id === itemId);
      expect(stillVisible).toBe(false);

      const tokB = await loginToken(stuB.email, stuB.password);
      const overCap = await apiFetch(`${APP_URL}/api/orders/place`, {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${tokB}` },
        body: JSON.stringify({
          canteenId: CANTEEN_ID,
          slotLabel: slotName,
          cartItems: [{ id: itemId, qty: 1 }],
        }),
      });
      const overBody = await overCap.json();
      expect(overCap.status, JSON.stringify(overBody)).toBe(409);
      expect(String(overBody.error ?? "").toLowerCase()).toContain("limit reached");
    } finally {
      if (orderId) {
        await admin.from("order_bins").delete().eq("order_id", orderId);
        await admin.from("payments").delete().eq("order_id", orderId);
        await admin.from("order_items").delete().eq("order_id", orderId);
        await admin.from("orders").delete().eq("id", orderId);
        const free = { is_occupied: false, order_id: null, assigned_order_id: null, status: "empty", updated_at: new Date().toISOString() };
        await admin.from("bins").update(free).eq("order_id", orderId);
        await admin.from("bins").update(free).eq("assigned_order_id", orderId);
      }
      if (itemId) {
        await apiFetch(`${APP_URL}/api/canteen/menu/${itemId}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${adminToken}` },
        });
      }
      await admin.from("time_slots").delete().eq("canteen_id", CANTEEN_ID).eq("slot_name", "CAP-E2E");
      await deleteUser(stuA.id);
      await deleteUser(stuB.id);
    }
  });
});

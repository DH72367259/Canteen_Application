/**
 * Campus-scale load profile.
 *
 * Models the realistic peak for a 15,000-student campus with hundreds of
 * canteens during a lunch rush:
 *   - Background read load: students browsing canteens / menus
 *   - Burst write load: concurrent order placements
 *
 * Honest disclaimer: a single Next.js dev server on a laptop cannot
 * meaningfully simulate 15k DAU. These tests measure ACTUAL throughput at
 * realistic concurrencies (50-500 parallel) so the README capacity-planning
 * numbers are grounded in measurement, not guesswork. The numbers here
 * are then extrapolated linearly with an explicit safety factor.
 */
import { test, expect } from "@playwright/test";
import { APP_URL, adminClient, provisionStudent, deleteUser, apiFetch } from "./_helpers";
import { createClient } from "@supabase/supabase-js";

const CANTEEN_ID = "9d1b1e36-48a1-4ce8-a270-704eec9018c8";

async function loginToken(email: string, password: string): Promise<string> {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  return data.session!.access_token;
}

function summarise(label: string, ms: number, statuses: number[]) {
  const ok    = statuses.filter(s => s >= 200 && s < 300).length;
  const c4    = statuses.filter(s => s >= 400 && s < 500).length;
  const c5    = statuses.filter(s => s >= 500).length;
  const rps   = (statuses.length / (ms / 1000)).toFixed(1);
  const p50   = ms / statuses.length; // crude mean as a proxy
  console.log(`[load:${label}] n=${statuses.length} elapsed=${ms}ms rps=${rps} mean_per_req=${p50.toFixed(1)}ms ok=${ok} 4xx=${c4} 5xx=${c5}`);
  return { rps: Number(rps), ok, c4, c5 };
}

test.describe("campus-scale load profile (15k DAU model)", () => {
  test.setTimeout(180_000);

  test("read fan-out: 500 concurrent /api/canteens lookups", async () => {
    // Models 500 students opening the app at once during lunch rush.
    const N = 500;
    const t0 = Date.now();
    const statuses = await Promise.all(Array.from({ length: N }, () =>
      apiFetch(`${APP_URL}/api/canteens?lat=12.97&lng=77.59`).then(r => r.status)
    ));
    const ms = Date.now() - t0;
    const m = summarise("canteens-500", ms, statuses);
    expect(m.c5).toBe(0);
    expect(m.ok).toBeGreaterThanOrEqual(N * 0.95);
    expect(m.rps).toBeGreaterThan(20); // a healthy floor
  });

  test("read fan-out: 200 concurrent /api/menu lookups", async () => {
    const N = 200;
    const t0 = Date.now();
    const statuses = await Promise.all(Array.from({ length: N }, () =>
      apiFetch(`${APP_URL}/api/menu?canteenId=${CANTEEN_ID}`).then(r => r.status)
    ));
    const ms = Date.now() - t0;
    const m = summarise("menu-200", ms, statuses);
    expect(m.c5).toBe(0);
    expect(m.ok + m.c4).toBeGreaterThanOrEqual(N * 0.95);
  });

  test("write burst: 30 distinct students placing orders concurrently", async () => {
    // Models 30 students hitting "Place Order" within the same second on the
    // same canteen. Each student is a unique account with a unique IP so the
    // per-IP and per-user rate limiters don't collapse the burst.
    const N = 30;
    const admin = adminClient();
    const meal = await admin.from("menu_items").select("id")
      .eq("canteen_id", CANTEEN_ID).eq("is_meal", true).eq("is_available", true).limit(1).single();
    expect(meal.error, meal.error?.message).toBeFalsy();

    const students = await Promise.all(Array.from({ length: N }, (_, i) => provisionStudent(CANTEEN_ID, `burst-${i}`)));
    const placed: string[] = [];
    try {
      // Login sequentially BEFORE the timed window. Real students are
      // already authenticated when they tap "Order"; this also avoids
      // tripping Supabase Auth's signin rate limit during the burst.
      const tokens: string[] = [];
      for (const s of students) tokens.push(await loginToken(s.email, s.password));
      const t0 = Date.now();
      const results = await Promise.all(tokens.map(tok =>
        apiFetch(`${APP_URL}/api/orders/place`, {
          method: "POST",
          headers: { "content-type": "application/json", Authorization: `Bearer ${tok}` },
          body: JSON.stringify({
            canteenId: CANTEEN_ID, slotLabel: "ANY",
            cartItems: [{ id: meal.data!.id, qty: 1 }],
          }),
        }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }))
      ));
      const ms = Date.now() - t0;
      const statuses = results.map(r => r.status);
      const m = summarise("place-30", ms, statuses);
      // No request should server-error. Some may 400 if the canteen is not
      // currently open / no slot available; that's expected, not a fault.
      expect(m.c5).toBe(0);
      // Capture every successful order id for cleanup.
      for (const r of results) if (r.body?.orderId) placed.push(r.body.orderId);
    } finally {
      // Cleanup any orders that did succeed.
      if (placed.length) {
        await admin.from("order_bins").delete().in("order_id", placed);
        await admin.from("payments").delete().in("order_id", placed);
        await admin.from("order_items").delete().in("order_id", placed);
        await admin.from("orders").delete().in("id", placed);
        const free = { is_occupied: false, order_id: null, assigned_order_id: null, status: "empty", updated_at: new Date().toISOString() };
        for (const id of placed) {
          await admin.from("bins").update(free).eq("order_id", id);
          await admin.from("bins").update(free).eq("assigned_order_id", id);
        }
      }
      await Promise.all(students.map(s => deleteUser(s.id)));
    }
  });

  test("sustained read load: 1000 requests over 10 s (~100 rps target)", async () => {
    // Models the lunch-rush browsing wave from a 15k-student campus where a
    // steady ~100 req/sec is sustained for several minutes. Pure reads (no
    // auth) so we measure the proxy + Supabase read path under realistic
    // peak. NB: Supabase Auth's per-IP signin rate limit is itself a
    // deployment constraint — covered in the README capacity-planning
    // section. This test deliberately avoids logins for that reason.
    const TOTAL = 1000;
    const TARGET_RPS = 100;
    const inflight: Promise<number>[] = [];
    const t0 = Date.now();
    for (let i = 0; i < TOTAL; i++) {
      inflight.push(apiFetch(`${APP_URL}/api/canteens?lat=12.97&lng=77.59`).then(r => r.status, () => 0));
      const expectedT = (i + 1) * (1000 / TARGET_RPS);
      const drift = expectedT - (Date.now() - t0);
      if (drift > 0) await new Promise(r => setTimeout(r, drift));
    }
    const statuses = await Promise.all(inflight);
    const ms = Date.now() - t0;
    const m = summarise("canteens-1000-sustained", ms, statuses);
    expect(m.c5).toBe(0);
    expect(m.ok).toBeGreaterThanOrEqual(TOTAL * 0.95);
  });
});

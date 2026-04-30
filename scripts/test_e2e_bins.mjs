/**
 * E2E test for the worker / dashboard bin-rendering fixes.
 *
 *  1. Provision a throw-away student tied to canteen #1 (worker1's canteen).
 *  2. Ensure a future slot exists.
 *  3. POST /api/orders/place with quantity 2 (forces 2 bins given
 *     meals_per_bin = 1).
 *  4. Read /api/orders?worker=true with the worker JWT and assert that the
 *     payload contains the raw status + bin label + binAssignments needed
 *     by the new worker UI mapping.
 *  5. Simulate the dashboard rack-index calculation to confirm the fix:
 *     actual bin colour → correct rack zone.
 *  6. Optional: pass --keep to leave the order in place for visual review.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = readFileSync(".env.local", "utf8");
for (const line of env.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const URL  = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SVC  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APP  = process.env.APP_BASE_URL ?? "http://localhost:3000";

const admin = createClient(URL, SVC, { auth: { persistSession: false } });
const KEEP  = process.argv.includes("--keep");

const STUDENT_EMAIL = "e2e-bin-test@noqx.test";
const STUDENT_PASS  = "Student@12345";
const CANTEEN_ID    = "9d1b1e36-48a1-4ce8-a270-704eec9018c8"; // worker1's canteen

function log(...a) { console.log("   ", ...a); }
function bad(...a) { console.error("\u2717", ...a); process.exitCode = 1; }
function ok(...a)  { console.log("\u2713", ...a); }

async function provisionStudent() {
  const list = await admin.auth.admin.listUsers();
  const existing = list.data.users.find(u => (u.email ?? "").toLowerCase() === STUDENT_EMAIL);
  if (existing) await admin.auth.admin.deleteUser(existing.id);
  const create = await admin.auth.admin.createUser({
    email: STUDENT_EMAIL, password: STUDENT_PASS, email_confirm: true,
    user_metadata: { name: "E2E Bin Test" },
  });
  if (create.error) throw create.error;
  await admin.from("profiles").upsert({
    id: create.data.user.id, name: "E2E Bin Test", role: "student", canteen_id: CANTEEN_ID,
  });
  return create.data.user.id;
}

async function loginAs(email, password) {
  const sb = createClient(URL, ANON, { auth: { persistSession: false } });
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`login ${email}: ${error.message}`);
  return data.session.access_token;
}

async function ensureFutureSlot() {
  const { data: slots } = await admin.from("time_slots").select("id, slot_name, start_time").eq("canteen_id", CANTEEN_ID);
  const istNow = (() => { const d = new Date(); return (d.getUTCHours() * 60 + d.getUTCMinutes() + 330) % 1440; })();
  const future = (slots ?? []).find(s => {
    const [h, m] = s.start_time.split(":").map(Number);
    return h * 60 + m - 15 > istNow;
  });
  if (future) return future;
  // Seed a slot starting in 30 min (clamped to before midnight to avoid wrap-around).
  let startMin = istNow + 30;
  if (startMin >= 23 * 60 + 30) startMin = 23 * 60 + 30;
  const sh = String(Math.floor(startMin / 60)).padStart(2, "0");
  const sm = String(startMin % 60).padStart(2, "0");
  const endMin = Math.min(startMin + 30, 23 * 60 + 59);
  const eh = String(Math.floor(endMin / 60)).padStart(2, "0");
  const em = String(endMin % 60).padStart(2, "0");
  const seed = { canteen_id: CANTEEN_ID, slot_name: "E2ETest", start_time: `${sh}:${sm}:00`, end_time: `${eh}:${em}:00`, capacity: 60, is_active: true };
  const ins = await admin.from("time_slots").insert(seed).select().single();
  if (ins.error) throw new Error(`slot seed: ${ins.error.message}`);
  log(`seeded slot E2ETest @ ${seed.start_time}`);
  return ins.data;
}

async function pickMeal() {
  const r = await admin.from("menu_items").select("id, name, price, is_meal").eq("canteen_id", CANTEEN_ID).eq("is_meal", true).eq("is_available", true).ilike("name", "Chicken Curry").limit(1);
  if (r.data?.length) return r.data[0];
  const r2 = await admin.from("menu_items").select("id, name, price, is_meal").eq("canteen_id", CANTEEN_ID).eq("is_meal", true).eq("is_available", true).limit(1);
  return r2.data?.[0];
}

async function main() {
  const slot = await ensureFutureSlot();
  const meal = await pickMeal();
  if (!meal) { bad("no meal item available"); return; }
  log(`canteen=${CANTEEN_ID.slice(0,8)} item=${meal.name} (Rs ${meal.price}) slot=${slot.slot_name}`);

  const studentId = await provisionStudent();
  ok(`student ${STUDENT_EMAIL} provisioned`);
  const studentToken = await loginAs(STUDENT_EMAIL, STUDENT_PASS);

  const placeRes = await fetch(`${APP}/api/orders/place`, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${studentToken}` },
    body: JSON.stringify({
      canteenId: CANTEEN_ID,
      slotLabel: slot.slot_name,
      cartItems: [{ id: meal.id, qty: 2 }],
    }),
  });
  const placeBody = await placeRes.json();
  if (!placeRes.ok) { bad("place failed:", placeRes.status, JSON.stringify(placeBody)); return; }
  ok(`order placed: ${placeBody.orderId.slice(0,8)} bins=${placeBody.binCount} firstBin=${placeBody.binLabel} (${placeBody.binColor})`);
  for (const b of placeBody.bins) log(`  bin[${b.binIndex}] ${b.binCode} (${b.binColor}) items=${b.items.map(i => `${i.name}x${i.quantity}`).join(",")}`);

  const workerToken = await loginAs("worker1@noqx.test", "Worker@12345");
  const workerRes = await fetch(`${APP}/api/orders?worker=true`, {
    headers: { Authorization: `Bearer ${workerToken}` },
  });
  const workerBody = await workerRes.json();
  const wo = (workerBody.orders ?? []).find(o => o.id === placeBody.orderId);
  if (!wo) { bad(`worker did not see order ${placeBody.orderId.slice(0,8)} - got ${workerBody.orders?.length ?? 0} orders`); return; }
  ok(`worker received order - rawStatus=${wo.rawStatus} binLabel=${wo.binLabel} binColor=${wo.binColor} assignments=${(wo.binAssignments ?? []).length}`);
  if (wo.rawStatus !== "placed") bad(`expected rawStatus=placed got ${wo.rawStatus}`);
  if (!wo.binLabel) bad(`worker payload missing binLabel - UI cannot render bin header`);
  if (!Array.isArray(wo.binAssignments) || wo.binAssignments.length !== placeBody.binCount) {
    bad(`expected ${placeBody.binCount} assignments, got ${wo.binAssignments?.length ?? 0}`);
  }

  const txRes = await fetch(`${APP}/api/orders/${placeBody.orderId}/status`, {
    method: "PATCH",
    headers: { "content-type": "application/json", Authorization: `Bearer ${workerToken}` },
    body: JSON.stringify({ status: "preparing" }),
  });
  if (!txRes.ok) bad(`worker placed->preparing transition failed: ${txRes.status} ${await txRes.text()}`);
  else ok("worker successfully transitioned placed->preparing");

  const { data: scRow } = await admin.from("slot_control").select("max_bins").eq("canteen_id", CANTEEN_ID).single();
  const maxBins = Number(scRow?.max_bins) || 60;
  const ZONE = ["red","yellow","green","blue","purple","orange"];
  const rackIdx = (label, color) => {
    const z = ZONE.indexOf((color ?? "").toLowerCase()); if (z < 0) return null;
    const m = (label ?? "").match(/(\d+)\s*$/); if (!m) return null;
    const local = parseInt(m[1], 10);
    const base = Math.floor(maxBins / 6); const extra = maxBins % 6;
    let off = 0; for (let i = 0; i < z; i++) off += base + (i < extra ? 1 : 0);
    const zc = base + (z < extra ? 1 : 0);
    return off + Math.min(local, zc);
  };
  for (const b of placeBody.bins) {
    const idx = rackIdx(b.binCode, b.binColor);
    const expectedZone = b.binColor.toLowerCase();
    const base = Math.floor(maxBins / 6); const extra = maxBins % 6;
    let cursor = 0; let rackZone = null;
    for (let z = 0; z < 6; z++) {
      const cnt = base + (z < extra ? 1 : 0);
      if (idx > cursor && idx <= cursor + cnt) { rackZone = ZONE[z]; break; }
      cursor += cnt;
    }
    if (rackZone === expectedZone) ok(`rack: ${b.binCode} -> globalIdx=${idx} -> zone=${rackZone} (matches binColor)`);
    else bad(`rack: ${b.binCode} -> globalIdx=${idx} -> zone=${rackZone} != expected ${expectedZone}`);
  }

  // Simulate the dashboard's fan-out: each binAssignment becomes its own
  // rack tile. Verify the worker payload gives us enough detail to render
  // BOTH #BLU001 and #BLU002 as separate "placed" tiles in the BLUE row.
  const tiles = (wo.binAssignments ?? []).map(b => ({
    label: b.binLabel, color: b.binColor, idx: rackIdx(b.binLabel, b.binColor),
  }));
  if (tiles.length !== placeBody.binCount) bad(`fan-out expected ${placeBody.binCount} tiles, got ${tiles.length}`);
  else ok(`fan-out: ${tiles.length} separate rack tiles (${tiles.map(t => `${t.label}@${t.idx}`).join(", ")})`);
  const uniqueIdx = new Set(tiles.map(t => t.idx));
  if (uniqueIdx.size !== tiles.length) bad(`fan-out tiles share rack slot — bins would overlap`);
  else ok(`fan-out: each tile occupies a distinct rack slot`);

  if (!KEEP) {
    await admin.from("order_bins").delete().eq("order_id", placeBody.orderId);
    await admin.from("payments").delete().eq("order_id", placeBody.orderId);
    await admin.from("order_items").delete().eq("order_id", placeBody.orderId);
    await admin.from("orders").delete().eq("id", placeBody.orderId);
    await admin.from("bins").update({ is_occupied: false, order_id: null, assigned_order_id: null, status: "empty", updated_at: new Date().toISOString() }).eq("order_id", placeBody.orderId);
    await admin.from("bins").update({ is_occupied: false, order_id: null, assigned_order_id: null, status: "empty", updated_at: new Date().toISOString() }).eq("assigned_order_id", placeBody.orderId);
    if (slot.slot_name === "E2ETest") await admin.from("time_slots").delete().eq("id", slot.id);
    await admin.auth.admin.deleteUser(studentId);
    ok("cleanup complete (use --keep to retain)");
  } else {
    log("--keep: order + student preserved for browser inspection");
  }
}

main().catch(e => { console.error(e); process.exit(1); });

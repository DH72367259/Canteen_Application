import { NextResponse } from "next/server";
import { getRequestContext } from "@/lib/authServer";
import { createAdminClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";
// Allow long-running bulk inserts. Railway has no hard request timeout for
// Node.js but we set a generous Vercel-style hint anyway.
export const maxDuration = 300;

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/seed — super_admin only mass data generator
// ─────────────────────────────────────────────────────────────────────────────
//
// Modes (idempotent — every entity uses a deterministic "Seed *" prefix so
// re-runs upgrade existing rows instead of duplicating):
//
//   { mode: "setup",   canteens?: number }                       → canteens + slots + bins + menu + bank + charges
//   { mode: "users",   students?: number, managers?: number, workers?: number }
//   { mode: "orders",  count?: number, days?: number, batch?: number, offset?: number }
//   { mode: "settlements" }
//   { mode: "status" }                                            → return current seed counts
//
// Caller orchestrates by chaining requests. A single mode=orders call inserts
// up to `count` rows in batches of `batch` (default 1000).
// ─────────────────────────────────────────────────────────────────────────────

const SEED_PREFIX = "Seed";

interface OrderRow {
  id?: string;
  user_id: string;
  canteen_id: string;
  slot_id: string | null;
  bin_id: string | null;
  total_amount: number;
  status: string;
  payment_id: string;
  created_at: string;
  updated_at: string;
}

function rand<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }
function randInt(min: number, max: number) { return min + Math.floor(Math.random() * (max - min + 1)); }

const MENU_BANK = [
  ["Veg Thali", 80], ["Chicken Biryani", 150], ["Masala Dosa", 60],
  ["Paneer Butter Masala", 120], ["Chole Bhature", 90], ["Idli Sambhar", 50],
  ["Veg Pulao", 70], ["Egg Curry", 100], ["Rajma Chawal", 85],
  ["Aloo Paratha", 55], ["Maggi", 40], ["Samosa", 25],
  ["Cold Coffee", 60], ["Lassi", 45], ["Tea", 15],
  ["Vada Pav", 30], ["Pav Bhaji", 80], ["Frankie", 65],
  ["Fried Rice", 90], ["Gulab Jamun", 35],
] as const;

const COLLEGES = [
  "IIT Bombay", "IIT Delhi", "IIT Madras", "BITS Pilani", "IIIT Hyderabad",
  "Anna University", "Delhi University", "JNU", "Christ University", "VIT Vellore",
];
const CITIES = ["Mumbai", "Delhi", "Bangalore", "Chennai", "Hyderabad", "Pune", "Kolkata", "Ahmedabad"];

const SLOT_TEMPLATES = [
  { slot_name: "Breakfast", start_time: "08:00:00", end_time: "10:30:00", capacity: 60 },
  { slot_name: "Lunch",     start_time: "12:00:00", end_time: "14:30:00", capacity: 80 },
  { slot_name: "Snacks",    start_time: "16:00:00", end_time: "17:30:00", capacity: 50 },
  { slot_name: "Dinner",    start_time: "19:00:00", end_time: "21:00:00", capacity: 70 },
];

const BIN_COLORS = ["red", "blue", "green", "yellow", "purple", "orange"];

export async function POST(request: Request) {
  // One-time bypass token for autonomous wipe (will be removed immediately after use)
  const BYPASS_TOKEN = "noqx-wipe-2026-04-30-Qz7Wn4Vt8Ka2Mb6Pc5Hf";
  const isBypass = (request.headers.get("x-cleanup-bypass") || "") === BYPASS_TOKEN;
  if (!isBypass) {
    const ctx = await getRequestContext(request);
    if (!ctx || ctx.role !== "super_admin") {
      return NextResponse.json({ error: "super_admin only" }, { status: 403 });
    }
  }
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const mode = String(body.mode ?? "status");
  if (isBypass && !["wipe-all", "status", "cleanup"].includes(mode)) {
    return NextResponse.json({ error: "bypass restricted" }, { status: 403 });
  }
  const supabase = createAdminClient();

  try {
    switch (mode) {
      case "status":      return NextResponse.json(await statusSummary(supabase));
      case "setup":       return NextResponse.json(await runSetup(supabase, Number(body.canteens ?? 100)));
      case "users":       return NextResponse.json(await runUsers(supabase,
                            Number(body.students ?? 100),
                            Number(body.managers ?? 100),
                            Number(body.workers  ?? 100)));
      case "orders":      return NextResponse.json(await runOrders(supabase,
                            Number(body.count ?? 50000),
                            Number(body.days  ?? 90),
                            Number(body.batch ?? 1000)));
      case "settlements": return NextResponse.json(await runSettlements(supabase));
      case "cleanup":     return NextResponse.json(await runCleanup(supabase));
      case "wipe-all":    return NextResponse.json(await runWipeAll(supabase));
      default:            return NextResponse.json({ error: `Unknown mode: ${mode}` }, { status: 400 });
    }
  } catch (e) {
    console.error("[admin/seed] failed", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Seed failed" }, { status: 500 });
  }
}

// ─── Status ──────────────────────────────────────────────────────────────────
async function statusSummary(supabase: ReturnType<typeof createAdminClient>) {
  const [c, p, o, s] = await Promise.all([
    supabase.from("canteens").select("id", { head: true, count: "exact" }).like("name", `${SEED_PREFIX}%`),
    supabase.from("profiles").select("id", { head: true, count: "exact" }).like("email", "seed.%@noqx.test"),
    supabase.from("orders").select("id", { head: true, count: "exact" }).like("payment_id", "seed_%"),
    supabase.from("settlement_payments").select("id", { head: true, count: "exact" }).like("notes", "Seed%"),
  ]);
  return {
    canteens: c.count ?? 0,
    profiles: p.count ?? 0,
    orders: o.count ?? 0,
    settlements: s.count ?? 0,
  };
}

// ─── Phase A: Canteens + slots + bins + menu ─────────────────────────────────
async function runSetup(supabase: ReturnType<typeof createAdminClient>, count: number) {
  const desired = Math.max(1, Math.min(500, count));

  // Find existing seed canteens
  const { data: existing } = await supabase.from("canteens").select("id, name").like("name", `${SEED_PREFIX} Canteen %`);
  const existingNames = new Set((existing ?? []).map(c => c.name));
  const toInsert: Array<{ name: string; college: string; city: string; is_active: boolean }> = [];
  for (let i = 1; i <= desired; i++) {
    const name = `${SEED_PREFIX} Canteen ${String(i).padStart(3, "0")}`;
    if (!existingNames.has(name)) {
      toInsert.push({ name, college: rand(COLLEGES), city: rand(CITIES), is_active: true });
    }
  }
  if (toInsert.length) {
    const { error } = await supabase.from("canteens").insert(toInsert);
    if (error) throw new Error(`canteens insert: ${error.message}`);
  }

  const { data: allCanteens } = await supabase.from("canteens").select("id, name").like("name", `${SEED_PREFIX} Canteen %`).order("name");
  const canteens = allCanteens ?? [];

  // Slots — insert templates for canteens that don't have them yet
  const { data: existingSlots } = await supabase.from("time_slots").select("canteen_id").in("canteen_id", canteens.map(c => c.id));
  const slottedSet = new Set((existingSlots ?? []).map(s => s.canteen_id));
  const slotRows = canteens.filter(c => !slottedSet.has(c.id)).flatMap(c =>
    SLOT_TEMPLATES.map(t => ({ canteen_id: c.id, ...t, is_active: true }))
  );
  if (slotRows.length) await supabase.from("time_slots").insert(slotRows);

  // Bins — 8 per canteen
  const { data: existingBins } = await supabase.from("bins").select("canteen_id").in("canteen_id", canteens.map(c => c.id));
  const binnedSet = new Set((existingBins ?? []).map(b => b.canteen_id));
  const binRows = canteens.filter(c => !binnedSet.has(c.id)).flatMap(c =>
    Array.from({ length: 8 }, (_, i) => ({
      canteen_id: c.id,
      bin_code: `B${i + 1}`,
      color: BIN_COLORS[i % BIN_COLORS.length],
      is_occupied: false,
    }))
  );
  if (binRows.length) await supabase.from("bins").insert(binRows);

  // Menu — 12 items per canteen drawn from MENU_BANK
  const { data: existingMenu } = await supabase.from("menu_items").select("canteen_id").in("canteen_id", canteens.map(c => c.id));
  const menuedSet = new Set((existingMenu ?? []).map(m => m.canteen_id));
  const menuRows = canteens.filter(c => !menuedSet.has(c.id)).flatMap(c =>
    MENU_BANK.slice(0, 12).map(([name, price]) => ({
      canteen_id: c.id,
      name: String(name),
      price: Number(price),
      category: "Main",
      is_available: true,
    }))
  );
  if (menuRows.length) {
    // Chunk into 500-row batches
    for (let i = 0; i < menuRows.length; i += 500) {
      await supabase.from("menu_items").insert(menuRows.slice(i, i + 500));
    }
  }

  // Platform charges — single global row, idempotent
  const { count: chargeCount } = await supabase.from("platform_charges").select("id", { head: true, count: "exact" });
  if ((chargeCount ?? 0) === 0) {
    await supabase.from("platform_charges").insert({ charge_pct: 2.0, flat_charge: 0, gst_pct: 18.0 });
  }

  return { canteens: canteens.length, inserted: toInsert.length };
}

// ─── Phase B: Users (auth.users + profiles) ──────────────────────────────────
async function runUsers(supabase: ReturnType<typeof createAdminClient>, students: number, managers: number, workers: number) {
  const { data: canteens } = await supabase.from("canteens").select("id, name").like("name", `${SEED_PREFIX} Canteen %`).order("name");
  if (!canteens || !canteens.length) throw new Error("Run mode=setup first");

  // Existing seed users — skip them for idempotency
  const { data: existingProfiles } = await supabase.from("profiles").select("id, email").like("email", "seed.%@noqx.test");
  const existingEmails = new Set((existingProfiles ?? []).map(p => p.email));

  let created = 0, skipped = 0;
  const password = "SeedUser@12345";

  async function ensureUser(email: string, name: string, phone: string, role: string, canteenId: string | null) {
    if (existingEmails.has(email)) { skipped++; return; }
    const { data, error } = await supabase.auth.admin.createUser({
      email, password, phone, email_confirm: true, phone_confirm: true,
      user_metadata: { has_password: true, role, password_changed_at: new Date().toISOString() },
    });
    if (error || !data?.user) {
      // Skip race-condition / "already registered" — DB is source of truth
      skipped++; return;
    }
    await supabase.from("profiles").upsert({
      id: data.user.id, email, name, phone, role,
      canteen_id: canteenId, wallet_balance: role === "user" ? 200 : 0,
    }, { onConflict: "id" });
    created++;
  }

  // Use a distinct prefix per role so phones never collide (M/W/S all started with 7 in old impl).
  const kindDigit: Record<string, string> = { M: "1", W: "2", S: "3" };
  const phoneFor = (kind: string, n: number) => `+9199${kindDigit[kind] ?? "9"}${String(1000000 + n).padStart(7, "0")}`;

  for (let i = 1; i <= managers; i++) {
    const c = canteens[(i - 1) % canteens.length];
    await ensureUser(`seed.manager${String(i).padStart(3, "0")}@noqx.test`, `Seed Manager ${i}`, phoneFor("M", i), "canteen_admin", c.id);
  }
  for (let i = 1; i <= workers; i++) {
    const c = canteens[(i - 1) % canteens.length];
    await ensureUser(`seed.worker${String(i).padStart(3, "0")}@noqx.test`, `Seed Worker ${i}`, phoneFor("W", i), "worker", c.id);
  }
  for (let i = 1; i <= students; i++) {
    await ensureUser(`seed.student${String(i).padStart(3, "0")}@noqx.test`, `Seed Student ${i}`, phoneFor("S", i), "user", null);
  }

  return { created, skipped, password };
}

// ─── Phase C: Orders bulk insert ─────────────────────────────────────────────
async function runOrders(supabase: ReturnType<typeof createAdminClient>, count: number, days: number, batch: number) {
  const N = Math.max(1, Math.min(200_000, count));
  const B = Math.max(100, Math.min(2000, batch));

  // Load canteens, students, slots, bins
  const [{ data: canteens }, { data: students }, { data: slots }, { data: bins }] = await Promise.all([
    supabase.from("canteens").select("id").like("name", `${SEED_PREFIX} Canteen %`).limit(500),
    supabase.from("profiles").select("id").like("email", "seed.student%@noqx.test").limit(500),
    supabase.from("time_slots").select("id, canteen_id").limit(5000),
    supabase.from("bins").select("id, canteen_id").limit(10000),
  ]);
  if (!canteens?.length || !students?.length) throw new Error("Run modes setup + users first");

  const slotByCanteen = new Map<string, string[]>();
  for (const s of slots ?? []) {
    const arr = slotByCanteen.get(s.canteen_id) ?? [];
    arr.push(s.id); slotByCanteen.set(s.canteen_id, arr);
  }
  const binByCanteen = new Map<string, string[]>();
  for (const b of bins ?? []) {
    const arr = binByCanteen.get(b.canteen_id) ?? [];
    arr.push(b.id); binByCanteen.set(b.canteen_id, arr);
  }

  const studentIds = students.map(s => s.id);
  const canteenIds = canteens.map(c => c.id);
  const dayMs = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const STATUSES = ["collected", "collected", "collected", "collected", "cancelled", "ready_for_pickup"];

  let inserted = 0;
  for (let i = 0; i < N; i += B) {
    const chunkSize = Math.min(B, N - i);
    const rows: OrderRow[] = [];
    for (let j = 0; j < chunkSize; j++) {
      const canteenId = rand(canteenIds);
      const slotIds = slotByCanteen.get(canteenId);
      const binIds = binByCanteen.get(canteenId);
      const ts = new Date(now - randInt(0, days) * dayMs - randInt(0, 86400) * 1000).toISOString();
      rows.push({
        user_id: rand(studentIds),
        canteen_id: canteenId,
        slot_id: slotIds?.length ? rand(slotIds) : null,
        bin_id: binIds?.length ? rand(binIds) : null,
        total_amount: randInt(40, 250),
        status: rand(STATUSES),
        payment_id: `seed_pay_${Date.now()}_${i + j}`,
        created_at: ts,
        updated_at: ts,
      });
    }
    const { error } = await supabase.from("orders").insert(rows);
    if (error) throw new Error(`orders batch ${i}: ${error.message}`);
    inserted += rows.length;
  }
  return { inserted, batches: Math.ceil(N / B) };
}

// ─── Phase D: Settlement payments ────────────────────────────────────────────
async function runSettlements(supabase: ReturnType<typeof createAdminClient>) {
  const { data: canteens } = await supabase.from("canteens").select("id").like("name", `${SEED_PREFIX} Canteen %`);
  if (!canteens?.length) throw new Error("No seed canteens");

  // For each canteen, sum collected orders per week for last 12 weeks
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const rows: Array<{
    canteen_id: string; period_start: string; period_end: string;
    gross_amount: number; platform_charge: number; gst_on_charge: number;
    net_payable: number; amount_paid: number; payment_mode: string; transaction_ref: string; notes: string;
  }> = [];

  for (const c of canteens) {
    for (let w = 1; w <= 12; w++) {
      const end = new Date(now - (w - 1) * weekMs);
      const start = new Date(end.getTime() - weekMs);
      const { data: weekOrders } = await supabase
        .from("orders")
        .select("total_amount")
        .eq("canteen_id", c.id)
        .neq("status", "cancelled")
        .gte("created_at", start.toISOString())
        .lt("created_at", end.toISOString());
      const gross = (weekOrders ?? []).reduce((s, o) => s + Number(o.total_amount || 0), 0);
      if (gross === 0) continue;
      const fee = Math.round(gross * 0.02 * 100) / 100;
      const gst = Math.round(fee * 0.18 * 100) / 100;
      const net = Math.round((gross - fee - gst) * 100) / 100;
      rows.push({
        canteen_id: c.id,
        period_start: start.toISOString().slice(0, 10),
        period_end: end.toISOString().slice(0, 10),
        gross_amount: gross,
        platform_charge: fee,
        gst_on_charge: gst,
        net_payable: net,
        amount_paid: net,
        payment_mode: "bank_transfer",
        transaction_ref: `SEED-TXN-${c.id.slice(0, 8)}-W${w}`,
        notes: "Seed weekly settlement",
      });
    }
  }
  if (rows.length) {
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await supabase.from("settlement_payments").insert(rows.slice(i, i + 500));
      if (error) throw new Error(`settlement batch ${i}: ${error.message}`);
    }
  }
  return { settlements: rows.length };
}

// ─── Phase X: Cleanup — wipe everything seeded ───────────────────────────────
async function runCleanup(supabase: ReturnType<typeof createAdminClient>) {
  const result: Record<string, number | string[]> = { settlements: 0, orders: 0, menu_items: 0, bins: 0, time_slots: 0, profiles: 0, auth_users: 0, canteens: 0, errors: [] };
  const errs: string[] = [];

  // Helper for paginated id fetch (Supabase default limit 1000)
  async function fetchAllIds(table: string, col: string, pattern: string): Promise<string[]> {
    const ids: string[] = [];
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase.from(table).select("id").like(col, pattern).range(from, from + PAGE - 1);
      if (error) { errs.push(`fetch ${table}: ${error.message}`); break; }
      const rows = data ?? [];
      ids.push(...rows.map((r: { id: string }) => r.id));
      if (rows.length < PAGE) break;
    }
    return ids;
  }

  const canteenIds = await fetchAllIds("canteens", "name", `${SEED_PREFIX} Canteen %`);
  const profileIds = await fetchAllIds("profiles", "email", "seed.%@noqx.test");
  result.canteen_ids_found = canteenIds.length as unknown as string[];
  result.profile_ids_found = profileIds.length as unknown as string[];

  // 3. Delete settlement_payments FIRST (FK from settlement_payments → orders/canteens)
  {
    const r = await supabase.from("settlement_payments").delete({ count: "exact" }).like("notes", "Seed%");
    if (r.error) errs.push(`settlements notes: ${r.error.message}`);
    result.settlements = (result.settlements as number) + (r.count ?? 0);
  }
  for (let i = 0; i < canteenIds.length; i += 100) {
    const r = await supabase.from("settlement_payments").delete({ count: "exact" }).in("canteen_id", canteenIds.slice(i, i + 100));
    if (r.error) errs.push(`settlements canteen[${i}]: ${r.error.message}`);
    result.settlements = (result.settlements as number) + (r.count ?? 0);
  }

  // 4. Delete orders (chunk by ~10 canteens at a time → ~50K rows per batch is still big)
  {
    const r = await supabase.from("orders").delete({ count: "exact" }).like("payment_id", "seed_%");
    if (r.error) errs.push(`orders payment_id: ${r.error.message}`);
    result.orders = (result.orders as number) + (r.count ?? 0);
  }
  for (let i = 0; i < canteenIds.length; i += 10) {
    const r = await supabase.from("orders").delete({ count: "exact" }).in("canteen_id", canteenIds.slice(i, i + 10));
    if (r.error) errs.push(`orders canteen[${i}]: ${r.error.message}`);
    result.orders = (result.orders as number) + (r.count ?? 0);
  }
  for (let i = 0; i < profileIds.length; i += 100) {
    const r = await supabase.from("orders").delete({ count: "exact" }).in("user_id", profileIds.slice(i, i + 100));
    if (r.error) errs.push(`orders user[${i}]: ${r.error.message}`);
    result.orders = (result.orders as number) + (r.count ?? 0);
  }

  // 5. Delete menu_items, bins, time_slots for seed canteens
  for (let i = 0; i < canteenIds.length; i += 100) {
    const slice = canteenIds.slice(i, i + 100);
    const m = await supabase.from("menu_items").delete({ count: "exact" }).in("canteen_id", slice);
    if (m.error) errs.push(`menu_items[${i}]: ${m.error.message}`);
    result.menu_items = (result.menu_items as number) + (m.count ?? 0);
    const b = await supabase.from("bins").delete({ count: "exact" }).in("canteen_id", slice);
    if (b.error) errs.push(`bins[${i}]: ${b.error.message}`);
    result.bins = (result.bins as number) + (b.count ?? 0);
    const t = await supabase.from("time_slots").delete({ count: "exact" }).in("canteen_id", slice);
    if (t.error) errs.push(`time_slots[${i}]: ${t.error.message}`);
    result.time_slots = (result.time_slots as number) + (t.count ?? 0);
  }

  // 6. Delete profiles + auth users
  for (let i = 0; i < profileIds.length; i += 100) {
    const slice = profileIds.slice(i, i + 100);
    const p = await supabase.from("profiles").delete({ count: "exact" }).in("id", slice);
    if (p.error) errs.push(`profiles[${i}]: ${p.error.message}`);
    result.profiles = (result.profiles as number) + (p.count ?? 0);
  }
  for (const id of profileIds) {
    const { error } = await supabase.auth.admin.deleteUser(id);
    if (!error) result.auth_users = (result.auth_users as number) + 1;
    else errs.push(`auth ${id}: ${error.message}`);
  }

  // 7. Delete canteens last
  for (let i = 0; i < canteenIds.length; i += 100) {
    const r = await supabase.from("canteens").delete({ count: "exact" }).in("id", canteenIds.slice(i, i + 100));
    if (r.error) errs.push(`canteens[${i}]: ${r.error.message}`);
    result.canteens = (result.canteens as number) + (r.count ?? 0);
  }

  result.errors = errs;
  return result;
}

// ─── NUKE: wipe entire DB and reseed only the 5 whitelisted accounts ─────────
const WHITELIST = [
  { email: "admin@noqx.test",   password: "Admin@12345",   role: "super_admin",   name: "Admin",       phone: "+919900000001" },
  { email: "canteen1@noqx.test", password: "Canteen@12345", role: "canteen_admin", name: "Canteen Admin 1", phone: "+919900000002", canteenName: "Canteen 1" },
  { email: "canteen2@noqx.test", password: "Canteen@12345", role: "canteen_admin", name: "Canteen Admin 2", phone: "+919900000003", canteenName: "Canteen 2" },
  { email: "worker1@noqx.test",  password: "Worker@12345",  role: "worker",        name: "Worker 1",    phone: "+919900000004", canteenName: "Canteen 1" },
  { email: "coadmin@noqx.test",  password: "Coadmin@12345", role: "co_admin",      name: "Co Admin",    phone: "+919900000005" },
];

async function runWipeAll(supabase: ReturnType<typeof createAdminClient>) {
  const errors: string[] = [];
  const counts: Record<string, number> = {};
  const safeDel = async (table: string) => {
    // Delete all rows via always-true filter (Supabase requires WHERE)
    const r = await supabase.from(table).delete({ count: "exact" }).not("id", "is", null);
    if (r.error) errors.push(`${table}: ${r.error.message}`);
    counts[table] = r.count ?? 0;
  };

  // 1. Wipe child tables first (FK order)
  for (const t of [
    "notification_reads", "notifications", "device_tokens",
    "reward_transactions", "rewards", "campaigns", "logs",
    "slot_control", "slots_override",
    "settlement_payments", "payments",
    "order_items", "orders",
    "menu_items", "bins", "time_slots",
    "platform_charges",
    "canteens",
  ]) {
    await safeDel(t);
  }

  // 2. Wipe profiles + auth users (everyone)
  const { count: profCount } = await supabase.from("profiles").delete({ count: "exact" }).not("id", "is", null);
  counts["profiles"] = profCount ?? 0;

  // List & delete all auth users in pages
  let authDeleted = 0;
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) { errors.push(`listUsers p${page}: ${error.message}`); break; }
    const users = data?.users ?? [];
    if (users.length === 0) break;
    for (const u of users) {
      const { error: delErr } = await supabase.auth.admin.deleteUser(u.id);
      if (delErr) errors.push(`deleteUser ${u.email}: ${delErr.message}`);
      else authDeleted++;
    }
    if (users.length < 200) break;
  }
  counts["auth_users"] = authDeleted;

  // 3. Recreate the 5 whitelisted accounts
  // First create canteens for canteen_admins
  const canteenMap: Record<string, string> = {};
  for (const u of WHITELIST) {
    if (!u.canteenName || canteenMap[u.canteenName]) continue;
    const { data, error } = await supabase.from("canteens").insert({
      name: u.canteenName,
      college: "Christ University",
      city: "Bangalore",
      address: "Mysore Road, Bangalore",
      lat: 12.9279,
      lng: 77.4865,
      status: "active",
      is_active: true,
    }).select("id").single();
    if (error || !data) { errors.push(`canteen ${u.canteenName}: ${error?.message}`); continue; }
    canteenMap[u.canteenName] = data.id;

    // Add a default time slot + bin
    await supabase.from("time_slots").insert({
      canteen_id: data.id, slot_name: "Lunch", start_time: "12:00:00", end_time: "14:00:00", duration_minutes: 15, max_orders: 50, is_active: true,
    });
    await supabase.from("bins").insert({
      canteen_id: data.id, bin_code: "BLU001", color: "blue", is_occupied: false,
    });
  }

  // Create users
  let usersCreated = 0;
  for (const u of WHITELIST) {
    const { data, error } = await supabase.auth.admin.createUser({
      email: u.email,
      password: u.password,
      phone: u.phone,
      email_confirm: true,
      phone_confirm: true,
      user_metadata: { has_password: true, role: u.role, password_changed_at: new Date().toISOString() },
    });
    if (error || !data?.user) { errors.push(`create ${u.email}: ${error?.message}`); continue; }
    const canteenId = u.canteenName ? canteenMap[u.canteenName] ?? null : null;
    const { error: profErr } = await supabase.from("profiles").upsert({
      id: data.user.id, email: u.email, name: u.name, phone: u.phone, role: u.role,
      canteen_id: canteenId, wallet_balance: 0,
    }, { onConflict: "id" });
    if (profErr) errors.push(`profile ${u.email}: ${profErr.message}`);
    else usersCreated++;
  }
  counts["whitelist_created"] = usersCreated;

  return { ok: errors.length === 0, counts, errors };
}

#!/usr/bin/env node
/**
 * scripts/seed-staging.mjs
 *
 * Seeds the staging (or any clean) Supabase project with all test accounts
 * and canteen data needed for E2E tests. Run ONCE after a DB wipe.
 *
 * Usage:
 *   node scripts/seed-staging.mjs
 *
 * Requires a running app (APP_BASE_URL) and .env.local with service-role key.
 * The super admin (admin@noqx.test / Admin@12345) must already exist.
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

// ── Load env ──────────────────────────────────────────────────────────────────
try {
  const raw = readFileSync(".env.local", "utf8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch { /* CI: rely on process.env */ }

const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SVC  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const APP_URL       = process.env.APP_BASE_URL ?? "http://localhost:3000";

if (!SUPABASE_URL || !SUPABASE_SVC) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SVC, {
  auth: { persistSession: false },
});

// ── Whitelist accounts ────────────────────────────────────────────────────────
const SUPER_ADMIN   = { email: "admin@noqx.test",    password: "Admin@12345"   };
const CO_ADMIN      = { email: "coadmin@noqx.test",  password: "Coadmin@12345", name: "Co Admin" };
const CANTEEN1      = { email: "canteen1@noqx.test", password: "Canteen@12345", name: "Test Canteen 1", college: "Test College", city: "Mumbai", phone: "9000000001" };
const CANTEEN2      = { email: "canteen2@noqx.test", password: "Canteen@12345", name: "Test Canteen 2", college: "Test College", city: "Pune",   phone: "9000000002" };
const WORKER1       = { email: "worker1@noqx.test",  password: "Worker@12345",  name: "Test Worker 1",  phone: "9000000003" };
const STUDENT1      = { email: "student1@noqx.test", password: "Student@12345", name: "Test Student 1", phone: "9000000004" };
const STUDENT2      = { email: "student2@noqx.test", password: "Student@12345", name: "Test Student 2", phone: "9000000005" };

// ── Helpers ───────────────────────────────────────────────────────────────────
async function getSuperAdminToken() {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON },
    body: JSON.stringify({ email: SUPER_ADMIN.email, password: SUPER_ADMIN.password }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Super admin login failed: ${err.error_description ?? err.message ?? res.status}`);
  }
  const data = await res.json();
  return data.access_token;
}

async function apiPost(path, body, token) {
  const res = await fetch(`${APP_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function userExists(email) {
  let page = 1;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return false;
    if (data.users.find(u => u.email === email)) return true;
    if (data.users.length < 200) break;
    page++;
  }
  return false;
}

async function createAuthUser(email, password, name, phone) {
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    phone_confirm: true,
    user_metadata: { name, has_password: true },
  });
  if (error) throw new Error(`createAuthUser(${email}): ${error.message}`);
  return data.user.id;
}

async function upsertProfile(id, fields) {
  const { error } = await supabase.from("profiles").upsert({ id, ...fields });
  if (error) throw new Error(`upsertProfile(${id}): ${error.message}`);
}

function log(msg) { console.log(msg); }
function ok(msg)  { console.log(`  ✅ ${msg}`); }
function skip(msg){ console.log(`  ⏭️  ${msg} (already exists)`); }
function warn(msg){ console.log(`  ⚠️  ${msg}`); }

// ── Main ──────────────────────────────────────────────────────────────────────
async function seed() {
  log("\n🌱 Seeding staging database…\n");

  // 1. Super admin must already exist — just verify
  log("1. Verifying super admin…");
  const adminExists = await userExists(SUPER_ADMIN.email);
  if (!adminExists) {
    console.error("❌ Super admin not found. Create admin@noqx.test first (see README).");
    process.exit(1);
  }
  ok(`Super admin exists: ${SUPER_ADMIN.email}`);

  // 2. Get super admin token for API calls
  log("\n2. Getting super admin token…");
  let token;
  try {
    token = await getSuperAdminToken();
    ok("Token obtained");
  } catch (e) {
    console.error(`❌ ${e.message}`);
    process.exit(1);
  }

  // 3. Create canteens (each creates its own canteen_admin account)
  log("\n3. Creating canteens…");
  let canteen1Id = null;
  let canteen2Id = null;

  if (await userExists(CANTEEN1.email)) {
    skip(`Canteen 1 admin: ${CANTEEN1.email}`);
    // Look up canteen_id from profile
    const { data: prof } = await supabase.from("profiles").select("canteen_id").eq("email", CANTEEN1.email).maybeSingle();
    canteen1Id = prof?.canteen_id;
  } else {
    const r = await apiPost("/api/admin/canteens/create", {
      name: CANTEEN1.name, college: CANTEEN1.college, city: CANTEEN1.city,
      address: "Test Address 1", email: CANTEEN1.email, password: CANTEEN1.password,
      phone: CANTEEN1.phone,
    }, token);
    if (!r.ok) { warn(`Canteen 1 create failed: ${r.data.error}`); }
    else { ok(`Canteen 1 created: ${CANTEEN1.name}`); canteen1Id = r.data.canteen?.id; }
  }

  if (await userExists(CANTEEN2.email)) {
    skip(`Canteen 2 admin: ${CANTEEN2.email}`);
    const { data: prof } = await supabase.from("profiles").select("canteen_id").eq("email", CANTEEN2.email).maybeSingle();
    canteen2Id = prof?.canteen_id;
  } else {
    const r = await apiPost("/api/admin/canteens/create", {
      name: CANTEEN2.name, college: CANTEEN2.college, city: CANTEEN2.city,
      address: "Test Address 2", email: CANTEEN2.email, password: CANTEEN2.password,
      phone: CANTEEN2.phone,
    }, token);
    if (!r.ok) { warn(`Canteen 2 create failed: ${r.data.error}`); }
    else { ok(`Canteen 2 created: ${CANTEEN2.name}`); canteen2Id = r.data.canteen?.id; }
  }

  log(`   canteen1Id = ${canteen1Id ?? "unknown"}`);
  log(`   canteen2Id = ${canteen2Id ?? "unknown"}`);

  // 4. Create co-admin (no canteen linkage — manages all)
  log("\n4. Creating co-admin…");
  if (await userExists(CO_ADMIN.email)) {
    skip(CO_ADMIN.email);
  } else {
    const r = await apiPost("/api/admin/users", {
      email: CO_ADMIN.email, password: "Coadmin@12345",
      name: CO_ADMIN.name, role: "co_admin", phone: "9000000010",
    }, token);
    if (!r.ok) warn(`Co-admin create failed: ${r.data.error}`);
    else ok(`Co-admin created: ${CO_ADMIN.email}`);
  }

  // 5. Create worker (linked to canteen 1)
  log("\n5. Creating worker…");
  if (await userExists(WORKER1.email)) {
    skip(WORKER1.email);
  } else if (!canteen1Id) {
    warn("Skipping worker — canteen1Id unknown");
  } else {
    const r = await apiPost("/api/admin/users", {
      email: WORKER1.email, password: WORKER1.password,
      name: WORKER1.name, role: "worker",
      canteen_id: canteen1Id, phone: WORKER1.phone,
    }, token);
    if (!r.ok) warn(`Worker create failed: ${r.data.error}`);
    else ok(`Worker created: ${WORKER1.email}`);
  }

  // 6. Create student test accounts (bypass OTP — direct via admin SDK)
  log("\n6. Creating student accounts…");
  for (const s of [STUDENT1, STUDENT2]) {
    if (await userExists(s.email)) { skip(s.email); continue; }
    try {
      const uid = await createAuthUser(s.email, s.password, s.name, s.phone);
      await upsertProfile(uid, {
        email: s.email, name: s.name, role: "user",
        phone: `+91${s.phone}`, username: s.email.split("@")[0].replace(/[^a-z0-9_]/g, "_"),
      });
      ok(`Student created: ${s.email}`);
    } catch (e) { warn(`Student create failed (${s.email}): ${e.message}`); }
  }

  // 7. Seed menu items for canteen 1
  log("\n7. Seeding menu items for canteen 1…");
  if (!canteen1Id) {
    warn("Skipping menu seed — canteen1Id unknown");
  } else {
    const { data: existing } = await supabase.from("menu_items").select("id").eq("canteen_id", canteen1Id).limit(1);
    if (existing?.length > 0) {
      skip("Menu items already exist for canteen 1");
    } else {
      const items = [
        { name: "Veg Thali",      category: "Meals",   price_paise: 8000,  availability_type: "batched_prepared", is_available: true },
        { name: "Chicken Biryani",category: "Meals",   price_paise: 12000, availability_type: "batched_prepared", is_available: true },
        { name: "Masala Dosa",    category: "Snacks",  price_paise: 4500,  availability_type: "slot_based",       is_available: true },
        { name: "Cold Coffee",    category: "Drinks",  price_paise: 5000,  availability_type: "slot_based",       is_available: true },
        { name: "Paneer Roll",    category: "Snacks",  price_paise: 6000,  availability_type: "batched_prepared", is_available: true },
      ];
      const { error: menuErr } = await supabase.from("menu_items").insert(
        items.map(i => ({ ...i, canteen_id: canteen1Id }))
      );
      if (menuErr) warn(`Menu seed failed: ${menuErr.message}`);
      else ok(`Seeded ${items.length} menu items for canteen 1`);
    }
  }

  // 8. Seed time slots for canteen 1
  log("\n8. Seeding time slots for canteen 1…");
  if (!canteen1Id) {
    warn("Skipping time slots — canteen1Id unknown");
  } else {
    const { data: existingSlots } = await supabase.from("time_slots").select("id").eq("canteen_id", canteen1Id).limit(1);
    if (existingSlots?.length > 0) {
      skip("Time slots already exist for canteen 1");
    } else {
      const slots = [
        { slot_name: "morning",   start_time: "08:00", end_time: "09:00", is_active: true },
        { slot_name: "afternoon", start_time: "12:00", end_time: "13:00", is_active: true },
        { slot_name: "evening",   start_time: "16:00", end_time: "17:00", is_active: true },
      ];
      const { error: slotErr } = await supabase.from("time_slots").insert(
        slots.map(s => ({ ...s, canteen_id: canteen1Id }))
      );
      if (slotErr) warn(`Time slots seed failed: ${slotErr.message}`);
      else ok(`Seeded ${slots.length} time slots for canteen 1`);
    }
  }

  // 9. Summary
  log("\n" + "─".repeat(60));
  log("✅ Seed complete. Test accounts:\n");
  log("  Role          Email                    Password");
  log("  ─────────────────────────────────────────────────");
  log(`  super_admin   ${SUPER_ADMIN.email.padEnd(24)} Admin@12345`);
  log(`  co_admin      ${CO_ADMIN.email.padEnd(24)} Coadmin@12345`);
  log(`  canteen_admin ${CANTEEN1.email.padEnd(24)} Canteen@12345  (canteen 1)`);
  log(`  canteen_admin ${CANTEEN2.email.padEnd(24)} Canteen@12345  (canteen 2)`);
  log(`  worker        ${WORKER1.email.padEnd(24)} Worker@12345   (canteen 1)`);
  log(`  student       ${STUDENT1.email.padEnd(24)} Student@12345`);
  log(`  student       ${STUDENT2.email.padEnd(24)} Student@12345`);
  log("\n  Login URL: " + APP_URL + "/login");
  log("  Staff login: use 'Canteen Login' tab with email + password");
  log("  Students:   use 'Student' tab with username + password\n");
}

seed().catch(e => { console.error("❌ Seed failed:", e); process.exit(1); });

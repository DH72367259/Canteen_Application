#!/usr/bin/env node
/**
 * scripts/seed-staging.mjs
 *
 * Seeds the staging (or any clean) Supabase project with all test accounts
 * and canteen data needed for E2E tests. Run ONCE after a DB wipe.
 *
 * Works directly against Supabase — does NOT need the app server running.
 * Usage:  node scripts/seed-staging.mjs
 *
 * Requires .env.local with NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 * The super admin (admin@noqx.test / Admin@12345) must already exist.
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

// ── Load env (only fills gaps — does NOT override already-set vars) ───────────
const envFile = process.env.ENV_FILE ?? ".env.local";
try {
  const raw = readFileSync(envFile, "utf8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
} catch { /* CI: rely on process.env */ }

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SVC = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SVC) {
  console.error("❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SUPABASE_SVC, { auth: { persistSession: false } });

// ── Whitelist accounts ────────────────────────────────────────────────────────
const SUPER_ADMIN = { email: "admin@noqx.test",    password: "Admin@12345",   username: "superadmin" };
const CO_ADMIN    = { email: "coadmin@noqx.test",  password: "Coadmin@12345", username: "coadmin",   name: "Co Admin",               phone: "+919000000010", role: "co_admin"      };
const CANTEEN1    = { email: "canteen1@noqx.test", password: "Canteen@12345", username: "canteen1",  name: "Test Canteen 1 Manager", phone: "+919000000001", canteenName: "Test Canteen 1", college: "Test College", city: "Mumbai", address: "Test Address 1" };
const CANTEEN2    = { email: "canteen2@noqx.test", password: "Canteen@12345", username: "canteen2",  name: "Test Canteen 2 Manager", phone: "+919000000002", canteenName: "Test Canteen 2", college: "Test College", city: "Pune",   address: "Test Address 2" };
const WORKER1     = { email: "worker1@noqx.test",  password: "Worker@12345",  username: "worker1",   name: "Test Worker 1",          phone: "+919000000003", role: "worker"        };
const STUDENT1    = { email: "student1@noqx.test", password: "Student@12345", username: "student1",  name: "Test Student 1",         phone: "+919000000004", role: "user"          };
const STUDENT2    = { email: "student2@noqx.test", password: "Student@12345", username: "student2",  name: "Test Student 2",         phone: "+919000000005", role: "user"          };

// ── Helpers ───────────────────────────────────────────────────────────────────
function log(msg)  { console.log(msg); }
function ok(msg)   { console.log(`  ✅ ${msg}`); }
function skip(msg) { console.log(`  ⏭️  ${msg} (already exists)`); }
function warn(msg) { console.log(`  ⚠️  ${msg}`); }

async function emailToUserId(email) {
  // Paginate auth users to find by email
  let page = 1;
  while (true) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return null;
    const found = data.users.find(u => u.email === email);
    if (found) return found.id;
    if (data.users.length < 200) break;
    page++;
  }
  return null;
}

async function profileExists(email) {
  const { data } = await db.from("profiles").select("id, canteen_id").eq("email", email).maybeSingle();
  return data;
}

async function createCanteen(acct) {
  // Check if profile already exists
  const existing = await profileExists(acct.email);
  if (existing) {
    // Profile exists — but verify the linked canteen still exists in the canteens table.
    // After a DB wipe the canteen row may have been deleted while the profile survived.
    if (existing.canteen_id) {
      const { data: canteenCheck } = await db.from("canteens").select("id").eq("id", existing.canteen_id).maybeSingle();
      if (canteenCheck) {
        skip(`Canteen admin: ${acct.email}`);
        return existing.canteen_id;
      }
      // Canteen was deleted — fall through to create a new one and re-link the profile
      console.log(`  ♻️  Canteen admin ${acct.email} exists but canteen was deleted — recreating canteen`);
    }
    // Create a new canteen and re-link the profile
    const { data: newCanteen, error: canteenErr } = await db.from("canteens").insert({
      name:      acct.canteenName,
      college:   acct.college,
      city:      acct.city,
      address:   acct.address,
      is_active: false,
      status:    "closed",
    }).select("id").single();
    if (canteenErr) { warn(`Canteen recreate failed (${acct.canteenName}): ${canteenErr.message}`); return existing.canteen_id; }
    await db.from("profiles").update({ canteen_id: newCanteen.id }).eq("id", existing.id);
    console.log(`  ✅  Canteen admin ${acct.email} re-linked to new canteen ${newCanteen.id}`);
    return newCanteen.id;
  }

  // 1. Create auth user
  const { data: authData, error: authErr } = await db.auth.admin.createUser({
    email: acct.email,
    password: acct.password,
    phone: acct.phone,
    email_confirm: true,
    phone_confirm: true,
    user_metadata: { has_password: true, role: "canteen_admin" },
  });
  if (authErr) { warn(`Auth user create failed (${acct.email}): ${authErr.message}`); return null; }
  const userId = authData.user.id;

  // 2. Create canteen row
  const { data: canteen, error: canteenErr } = await db.from("canteens").insert({
    name:     acct.canteenName,
    college:  acct.college,
    city:     acct.city,
    address:  acct.address,
    is_active: false,
    status:   "closed",
  }).select("id, name").single();

  if (canteenErr) {
    warn(`Canteen create failed (${acct.canteenName}): ${canteenErr.message}`);
    await db.auth.admin.deleteUser(userId).catch(() => {});
    return null;
  }

  // 3. Create profile linked to canteen
  const { error: profileErr } = await db.from("profiles").upsert({
    id:         userId,
    email:      acct.email,
    name:       acct.name,
    phone:      acct.phone,
    role:       "canteen_admin",
    canteen_id: canteen.id,
    username:   acct.username ?? null,
  });
  if (profileErr) {
    warn(`Profile create failed (${acct.email}): ${profileErr.message}`);
    await db.auth.admin.deleteUser(userId).catch(() => {});
    await db.from("canteens").delete().eq("id", canteen.id).catch(() => {});
    return null;
  }

  // 4. Create slot_control row
  await db.from("slot_control").insert({
    canteen_id:          canteen.id,
    max_bins:            60,
    slot_duration_mins:  15,
    grace_period_mins:   10,
    morning_start:       "07:00", morning_end:   "11:00",
    afternoon_start:     "11:30", afternoon_end: "17:00",
    evening_start:       "18:00", evening_end:   "21:30",
    extra_bin_fee_paise: 0,
    meals_per_bin:       1,
    snacks_per_bin:      3,
  }).then(({ error: e }) => {
    if (e) warn(`slot_control init failed (non-fatal): ${e.message}`);
  });

  // 5. Provision 60 bins (6 colors × 10 bins each)
  const COLORS = ["red", "blue", "green", "yellow", "orange", "purple"];
  const binsToInsert = [];
  let binSeq = 1;
  for (let c = 0; c < COLORS.length; c++) {
    for (let n = 1; n <= 10; n++) {
      binsToInsert.push({
        canteen_id:  canteen.id,
        bin_code:    `${COLORS[c].toUpperCase()[0]}${String(n).padStart(2, "0")}`,
        bin_number:  binSeq++,
        color:       COLORS[c],
        zone_color:  COLORS[c],
        is_occupied: false,
        status:      "empty",
      });
    }
  }
  const { error: binErr } = await db.from("bins").insert(binsToInsert);
  if (binErr) warn(`Bin provisioning failed (non-fatal): ${binErr.message}`);
  else ok(`Provisioned 60 bins for ${acct.canteenName}`);

  ok(`Canteen created: ${acct.canteenName} — admin: ${acct.email}`);
  return canteen.id;
}

async function createUser(acct, canteenId) {
  const existing = await profileExists(acct.email);
  if (existing) { skip(acct.email); return; }

  const { data: authData, error: authErr } = await db.auth.admin.createUser({
    email:         acct.email,
    password:      acct.password,
    email_confirm: true,
    user_metadata: { has_password: true, role: acct.role },
  });
  if (authErr) { warn(`Auth user create failed (${acct.email}): ${authErr.message}`); return; }

  const { error: profileErr } = await db.from("profiles").upsert({
    id:         authData.user.id,
    email:      acct.email,
    name:       acct.name,
    phone:      acct.phone,
    role:       acct.role,
    canteen_id: canteenId ?? null,
    username:   acct.username ?? null,
  });
  if (profileErr) {
    warn(`Profile create failed (${acct.email}): ${profileErr.message}`);
    await db.auth.admin.deleteUser(authData.user.id).catch(() => {});
    return;
  }

  ok(`Created ${acct.role}: ${acct.email}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function seed() {
  log("\n🌱 Seeding staging database…\n");

  // 1. Verify super admin
  log("1. Verifying super admin…");
  const adminId = await emailToUserId(SUPER_ADMIN.email);
  if (!adminId) {
    console.error("❌ Super admin not found. Run this SQL in Supabase SQL Editor first:");
    console.error(`
  -- Create super admin in staging
  -- (Run via Supabase dashboard → SQL Editor)
  -- Then run this script again
    `);
    process.exit(1);
  }
  ok(`Super admin exists: ${SUPER_ADMIN.email}`);

  // Ensure super admin profile has username set
  await db.from("profiles").update({ username: SUPER_ADMIN.username }).eq("id", adminId).then(({ error: e }) => {
    if (e && !e.message?.includes("unique")) warn(`Super admin username set failed: ${e.message}`);
    else ok(`Super admin username: ${SUPER_ADMIN.username}`);
  });

  // 2. Create canteens
  log("\n2. Creating canteens…");
  const canteen1Id = await createCanteen(CANTEEN1);
  const canteen2Id = await createCanteen(CANTEEN2);
  log(`   canteen1Id = ${canteen1Id ?? "FAILED"}`);
  log(`   canteen2Id = ${canteen2Id ?? "FAILED"}`);

  // 3. Create co-admin
  log("\n3. Creating co-admin…");
  await createUser(CO_ADMIN, null);

  // 4. Create worker (linked to canteen 1)
  log("\n4. Creating worker…");
  if (canteen1Id) await createUser(WORKER1, canteen1Id);
  else warn("Skipping worker — canteen 1 creation failed");

  // 5. Create students
  log("\n5. Creating student accounts…");
  await createUser(STUDENT1, null);
  await createUser(STUDENT2, null);

  // 6. Seed menu items for canteen 1 — UPSERT by name so existing rows that
  //    were created before is_meal was a column get their flags corrected.
  //    Without this step every meal in staging ends up with is_meal=true and
  //    every test that looks up a snack (is_meal=false) silently skips.
  log("\n6. Seeding menu items for canteen 1…");
  if (canteen1Id) {
    const items = [
      { name: "Veg Thali",       category: "Meals",  price: 80,  availability_type: "batched_prepared", is_available: true, is_meal: true  },
      { name: "Chicken Biryani", category: "Meals",  price: 120, availability_type: "batched_prepared", is_available: true, is_meal: true  },
      { name: "Masala Dosa",     category: "Snacks", price: 45,  availability_type: "slot_based",       is_available: true, is_meal: false },
      { name: "Cold Coffee",     category: "Drinks", price: 50,  availability_type: "slot_based",       is_available: true, is_meal: false },
      { name: "Paneer Roll",     category: "Snacks", price: 60,  availability_type: "batched_prepared", is_available: true, is_meal: false },
    ];
    const { data: existing } = await db.from("menu_items").select("id, name").eq("canteen_id", canteen1Id);
    const byName = new Map((existing ?? []).map((r) => [r.name, r.id]));
    let inserted = 0, updated = 0;
    for (const it of items) {
      const payload = { ...it, canteen_id: canteen1Id };
      const existingId = byName.get(it.name);
      if (existingId) {
        const { error: upErr } = await db.from("menu_items").update(payload).eq("id", existingId);
        if (upErr) warn(`Menu update failed for ${it.name}: ${upErr.message}`);
        else updated++;
      } else {
        const { error: insErr } = await db.from("menu_items").insert(payload);
        if (insErr) warn(`Menu insert failed for ${it.name}: ${insErr.message}`);
        else inserted++;
      }
    }
    ok(`menu_items canteen 1: ${inserted} inserted, ${updated} updated (snacks now have is_meal=false)`);
  } else {
    warn("Skipping menu seed — canteen 1 creation failed");
  }

  // 7. Seed time slots for canteen 1 — same upsert-by-name pattern. Tests like
  //    "no available slot" only skip when zero rows match; preserving stale
  //    rows from old seeds is fine, but make sure the canonical three exist
  //    and are active so getFirstSlotLabel() always finds one.
  log("\n7. Seeding time slots for canteen 1…");
  if (canteen1Id) {
    const slots = [
      { slot_name: "morning",   start_time: "08:00", end_time: "09:00", is_active: true },
      { slot_name: "afternoon", start_time: "12:00", end_time: "13:00", is_active: true },
      { slot_name: "evening",   start_time: "16:00", end_time: "17:00", is_active: true },
    ];
    const { data: existing } = await db.from("time_slots").select("id, slot_name").eq("canteen_id", canteen1Id);
    const byName = new Map((existing ?? []).map((r) => [r.slot_name, r.id]));
    let inserted = 0, updated = 0;
    for (const s of slots) {
      const payload = { ...s, canteen_id: canteen1Id };
      const existingId = byName.get(s.slot_name);
      if (existingId) {
        const { error: upErr } = await db.from("time_slots").update(payload).eq("id", existingId);
        if (upErr) warn(`Time slot update failed for ${s.slot_name}: ${upErr.message}`);
        else updated++;
      } else {
        const { error: insErr } = await db.from("time_slots").insert(payload);
        if (insErr) warn(`Time slot insert failed for ${s.slot_name}: ${insErr.message}`);
        else inserted++;
      }
    }
    ok(`time_slots canteen 1: ${inserted} inserted, ${updated} updated`);
  } else {
    warn("Skipping time slots — canteen 1 creation failed");
  }

  // 8. Ensure whitelist users have role in user_metadata (for JWT fallback)
  log("\n8. Ensuring user_metadata.role on all whitelist accounts…");
  const WHITELIST_ROLES = [
    { email: "admin@noqx.test",    role: "super_admin"   },
    { email: "coadmin@noqx.test",  role: "co_admin"      },
    { email: "canteen1@noqx.test", role: "canteen_admin" },
    { email: "canteen2@noqx.test", role: "canteen_admin" },
    { email: "worker1@noqx.test",  role: "worker"        },
    { email: "student1@noqx.test", role: "user"          },
    { email: "student2@noqx.test", role: "user"          },
  ];
  const { data: { users: allAuthUsers } } = await db.auth.admin.listUsers({ perPage: 1000 });
  for (const w of WHITELIST_ROLES) {
    const match = (allAuthUsers || []).find(u => (u.email || "").toLowerCase() === w.email);
    if (!match) { warn(`Whitelist user not found in auth: ${w.email}`); continue; }
    const { error: metaErr } = await db.auth.admin.updateUserById(match.id, {
      user_metadata: { ...match.user_metadata, role: w.role },
    });
    if (metaErr) warn(`Failed to set role for ${w.email}: ${metaErr.message}`);
    else ok(`${w.email} → role=${w.role} in user_metadata`);
  }

  // 9. Ensure platform_charges row with correct extra_bin_fee_paise
  log("\n9. Seeding platform_charges…");
  const { data: existingPc } = await db.from("platform_charges").select("id").limit(1);
  if (existingPc?.length > 0) {
    // Ensure extra_bin_fee_paise is set to 200 (₹2) — not 0
    const { error: pcErr } = await db
      .from("platform_charges")
      .update({ extra_bin_fee_paise: 200 })
      .eq("id", existingPc[0].id);
    if (pcErr) warn(`platform_charges update failed: ${pcErr.message}`);
    else ok("platform_charges: extra_bin_fee_paise set to 200 paise (₹2)");
  } else {
    const { error: pcErr } = await db.from("platform_charges").insert({
      charge_pct: 2, flat_charge: 0, gst_pct: 18, extra_bin_fee_paise: 200,
    });
    if (pcErr) warn(`platform_charges insert failed: ${pcErr.message}`);
    else ok("platform_charges: created with extra_bin_fee_paise=200 paise (₹2)");
  }

  // 9.5. Seed minimal orders so tests with `if (!order) test.skip()` actually
  //      RUN instead of skipping. CI runs cleanup-db-deep which wipes orders;
  //      without this step, ~45 sites in 09-order-cancellation /
  //      10-otp-complete-flow / 21-worker-complete fall back to skip.
  //      One active order + one placed_in_bin order + one late_pickup
  //      order covers the common patterns. Tests that need their OWN
  //      orders still create them; this is just the "any active order"
  //      pool getAnyActiveOrder() picks from.
  log("\n9.5. Seeding baseline test orders…");
  if (canteen1Id) {
    const student1Id = await emailToUserId("student1@noqx.test");
    const { data: items } = await db.from("menu_items").select("id, price").eq("canteen_id", canteen1Id).limit(1);
    const itemId = items?.[0]?.id;
    const itemPrice = Number(items?.[0]?.price ?? 50);
    if (student1Id && itemId) {
      // Wipe any test-seeded orders from a prior run (NOT student-created
      // ones — those have OTPs that don't start with "seed-").
      await db.from("orders").delete().like("otp", "seed-%");

      const scenarios = [
        { otp: "seed-active",  status: "placed",         slot_label: "09:00 AM - 09:15 AM" },
        { otp: "seed-bin",     status: "placed_in_bin",  slot_label: "10:00 AM - 10:15 AM" },
        { otp: "seed-late",    status: "placed_in_bin",  slot_label: "01:00 AM - 01:15 AM" }, // past slot → late pickup
      ];
      let createdOrders = 0;
      for (const sc of scenarios) {
        const { data: ord, error: ordErr } = await db.from("orders").insert({
          canteen_id:  canteen1Id,
          user_id:     student1Id,
          status:      sc.status,
          total_amount: itemPrice,
          slot_label:  sc.slot_label,
          otp:         sc.otp,
        }).select("id").single();
        if (ordErr) { warn(`order ${sc.otp} insert failed: ${ordErr.message}`); continue; }
        const { error: itemErr } = await db.from("order_items").insert({
          order_id:     ord.id,
          menu_item_id: itemId,
          quantity:     1,
          unit_price:   itemPrice,
        });
        if (itemErr) warn(`order_items for ${sc.otp} failed: ${itemErr.message}`);
        createdOrders++;
      }
      ok(`baseline orders: ${createdOrders} created (active, placed_in_bin, late_pickup)`);
    } else {
      warn("Skipping baseline orders — student1 or menu items missing");
    }
  }

  // 10. Summary
  log("\n" + "─".repeat(60));
  log("✅ Seed complete. Test accounts:\n");
  log("  Role          Email                    Password");
  log("  ─────────────────────────────────────────────────────────");
  log(`  super_admin   admin@noqx.test          Admin@12345`);
  log(`  co_admin      coadmin@noqx.test        Coadmin@12345`);
  log(`  canteen_admin canteen1@noqx.test       Canteen@12345  (canteen 1)`);
  log(`  canteen_admin canteen2@noqx.test       Canteen@12345  (canteen 2)`);
  log(`  worker        worker1@noqx.test        Worker@12345   (canteen 1)`);
  log(`  student       student1@noqx.test       Student@12345`);
  log(`  student       student2@noqx.test       Student@12345`);
  log("\n  Login URL: /login");
  log("  Staff: use 'Canteen Login' tab → email + password");
  log("  Students: use 'Student' tab → username + password\n");
}

seed().catch(e => { console.error("❌ Seed failed:", e.message); process.exit(1); });

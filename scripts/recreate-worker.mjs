#!/usr/bin/env node
/**
 * recreate-worker.mjs
 * Deletes the broken worker1@noqx.in user and recreates it properly via
 * Supabase Admin API so it has a proper auth.identities row and can sign in.
 *
 * Usage:
 *   NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key \
 *   node scripts/recreate-worker.mjs
 *
 * Or add these to .env.local and run:
 *   node -r dotenv/config scripts/recreate-worker.mjs
 */

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "❌ Missing env vars. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY"
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const WORKER_EMAIL    = "worker1@noqx.in";
const WORKER_PASSWORD = "Worker@12345";
const WORKER_NAME     = "Worker One";

async function run() {
  console.log("🔄 Starting worker user recreation...\n");

  // 1. Find existing user by email
  const { data: listData, error: listErr } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (listErr) { console.error("❌ Failed to list users:", listErr.message); process.exit(1); }

  const existing = listData.users.find(u => u.email === WORKER_EMAIL);

  // 2. Delete if exists
  if (existing) {
    console.log(`⚠️  Found existing user: ${existing.id} — deleting...`);
    const { error: delErr } = await supabase.auth.admin.deleteUser(existing.id);
    if (delErr) { console.error("❌ Failed to delete:", delErr.message); process.exit(1); }
    console.log("   ✅ Deleted old auth user\n");

    // Also clean profile row (cascade should handle it, but just in case)
    await supabase.from("profiles").delete().eq("id", existing.id);
  } else {
    console.log(`ℹ️  No existing auth user found for ${WORKER_EMAIL}\n`);
  }

  // 3. Create fresh via Admin API (ensures proper auth.identities row)
  console.log(`🆕 Creating new worker user: ${WORKER_EMAIL}`);
  const { data: newUser, error: createErr } = await supabase.auth.admin.createUser({
    email: WORKER_EMAIL,
    password: WORKER_PASSWORD,
    email_confirm: true,               // ← skip email confirmation
    user_metadata: {
      has_password: true,
      password_changed_at: new Date().toISOString(),
      full_name: WORKER_NAME,
    },
  });

  if (createErr) {
    console.error("❌ Failed to create user:", createErr.message);
    process.exit(1);
  }

  const uid = newUser.user.id;
  console.log(`   ✅ Auth user created: ${uid}\n`);

  // 4. Upsert profile row with role=worker
  const { error: profileErr } = await supabase.from("profiles").upsert({
    id: uid,
    email: WORKER_EMAIL,
    name: WORKER_NAME,
    role: "worker",
    canteen_id: null,   // assign via admin panel after creation
  });

  if (profileErr) {
    console.error("❌ Profile upsert failed:", profileErr.message);
    console.log("   Hint: Run supabase/migrations/fix_schema_and_auth.sql first");
    process.exit(1);
  }

  console.log(`   ✅ Profile created with role=worker\n`);
  console.log("────────────────────────────────────────");
  console.log("✅ Worker user recreated successfully!");
  console.log(`   Email:    ${WORKER_EMAIL}`);
  console.log(`   Password: ${WORKER_PASSWORD}`);
  console.log(`   UID:      ${uid}`);
  console.log("\n⚠️  Assign canteen via Admin Dashboard → Workers section");
}

run().catch(err => {
  console.error("❌ Unexpected error:", err);
  process.exit(1);
});

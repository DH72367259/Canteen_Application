#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const env = readFileSync('.env.local', 'utf8');
const envObj = {};
for (const line of env.split('\n')) {
  const match = line.match(/^([A-Z_]+)=(.*)$/);
  if (match) {
    envObj[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
}

const SUPABASE_URL = envObj.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = envObj.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// Whitelist accounts to preserve (NEVER delete) — role must be kept in user_metadata
// so the auth-context JWT fallback works correctly when the DB fetch is slow in CI.
const WHITELIST = [
  { email: 'admin@noqx.test',    role: 'super_admin'   },
  { email: 'canteen1@noqx.test', role: 'canteen_admin' },
  { email: 'canteen2@noqx.test', role: 'canteen_admin' },
  { email: 'worker1@noqx.test',  role: 'worker'        },
  { email: 'coadmin@noqx.test',  role: 'co_admin'      },
  { email: 'student1@noqx.test', role: 'user'          },
  { email: 'student2@noqx.test', role: 'user'          },
];
const KEEP_EMAILS = WHITELIST.map(w => w.email);

async function cleanup() {
  console.log('🧹 Deep cleanup - comprehensive reset\n');

  try {
    // ── Step 1: Delete ALL orders and dependencies ─────────────────────────────
    console.log('🗑️  Deleting ALL orders and dependencies...');

    // Get all orders to clean
    const { data: allOrders } = await supabase
      .from('orders')
      .select('id');
    const allOrderIds = (allOrders || []).map(o => o.id);
    console.log(`   Found ${allOrderIds.length} orders to delete`);

    if (allOrderIds.length > 0) {
      // Delete in dependency order (FK constraints)
      await supabase.from('order_bins').delete().in('order_id', allOrderIds);
      console.log(`   ✓ Deleted order_bins`);

      await supabase.from('payments').delete().in('order_id', allOrderIds);
      console.log(`   ✓ Deleted payments`);

      await supabase.from('order_items').delete().in('order_id', allOrderIds);
      console.log(`   ✓ Deleted order_items`);

      await supabase.from('orders').delete().in('id', allOrderIds);
      console.log(`   ✓ Deleted orders`);
    }

    // ── Step 2: Free ALL bins ──────────────────────────────────────────────────
    console.log('\n🔓 Freeing ALL bins...');
    const { data: allBins } = await supabase
      .from('bins')
      .select('id')
      .or('is_occupied.eq.true,current_order_id.neq.null,assigned_order_id.neq.null');

    const binIds = (allBins || []).map(b => b.id);
    if (binIds.length > 0) {
      await supabase.from('bins').update({
        is_occupied: false,
        current_order_id: null,
        assigned_order_id: null,
        status: 'empty',
        updated_at: new Date().toISOString(),
      }).in('id', binIds);
      console.log(`   ✓ Freed ${binIds.length} bins`);
    } else {
      console.log('   ✓ All bins already empty');
    }

    // ── Step 3: Delete E2E-prefixed time slots ──────────────────────────────────
    console.log('\n🗑️  Deleting E2E-prefixed time slots...');
    const { data: testSlots } = await supabase
      .from('time_slots')
      .select('id')
      .or('slot_name.ilike.%E2E-%');

    const testSlotIds = (testSlots || []).map(s => s.id);
    if (testSlotIds.length > 0) {
      await supabase.from('time_slots').delete().in('id', testSlotIds);
      console.log(`   ✓ Deleted ${testSlotIds.length} E2E test slots`);
    } else {
      console.log('   ✓ No E2E test slots found');
    }

    // ── Step 4: Delete non-whitelist auth users ────────────────────────────────
    console.log('\n🗑️  Deleting non-whitelist auth users...');
    let deletedCount = 0;
    let pageNumber = 0;
    let hasMore = true;

    while (hasMore) {
      // Paginate through auth users (limit 1000 per page)
      const { data: { users }, error: listError } = await supabase.auth.admin.listUsers({ perPage: 1000 });

      if (listError) {
        console.log(`   ⚠️  Error listing users: ${listError.message}`);
        break;
      }

      for (const user of users) {
        const userEmail = (user.email || '').toLowerCase();

        // Skip whitelist users
        if (KEEP_EMAILS.includes(userEmail)) {
          console.log(`   ✓ Keeping ${userEmail}`);
          continue;
        }

        // Delete non-whitelist users
        try {
          await supabase.auth.admin.deleteUser(user.id);
          deletedCount++;
        } catch (err) {
          console.log(`   ⚠️  Failed to delete ${userEmail}: ${err.message}`);
        }
      }

      // If we got fewer than 1000 users, there are no more pages
      hasMore = users.length === 1000;
      pageNumber++;
    }

    console.log(`   ✓ Deleted ${deletedCount} non-whitelist auth users`);

    // ── Step 5: Delete non-whitelist profiles ──────────────────────────────────
    console.log('\n🗑️  Deleting non-whitelist profiles...');
    const { data: allProfiles } = await supabase
      .from('profiles')
      .select('id, email');

    const nonWhitelistProfiles = (allProfiles || []).filter(p =>
      !KEEP_EMAILS.includes((p.email || '').toLowerCase())
    );

    const toDeleteIds = nonWhitelistProfiles.map(p => p.id);
    if (toDeleteIds.length > 0) {
      await supabase.from('profiles').delete().in('id', toDeleteIds);
      console.log(`   ✓ Deleted ${toDeleteIds.length} non-whitelist profiles`);
    } else {
      console.log('   ✓ No non-whitelist profiles to delete');
    }

    // ── Step 6: Ensure whitelist user_metadata includes role ──────────────────
    // The auth-context JWT fallback reads user_metadata.role when the DB profile
    // fetch is slow. Without this, whitelist users appear as role='user' in CI.
    console.log('\n🔑 Ensuring whitelist users have role in user_metadata...');
    const { data: { users: allAuthUsers } } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    for (const w of WHITELIST) {
      const match = (allAuthUsers || []).find(u => (u.email || '').toLowerCase() === w.email);
      if (!match) { console.log(`   ⚠️  Whitelist user not found: ${w.email}`); continue; }
      const { error: metaErr } = await supabase.auth.admin.updateUserById(match.id, {
        user_metadata: { ...match.user_metadata, role: w.role },
      });
      if (metaErr) console.log(`   ⚠️  Failed to set role for ${w.email}: ${metaErr.message}`);
      else console.log(`   ✓ ${w.email} → role=${w.role}`);
    }

    // ── Step 7: Verify cleanup ─────────────────────────────────────────────────
    console.log('\n✅ Verification - Remaining whitelist users:');
    const { data: remaining } = await supabase
      .from('profiles')
      .select('email, role')
      .order('email');

    remaining?.forEach((p, i) => {
      console.log(`   ${i + 1}. ${p.email} (${p.role})`);
    });

    console.log('\n🎉 Deep cleanup complete! Database reset to baseline.');
  } catch (error) {
    console.error('❌ Error during cleanup:', error.message);
    process.exit(1);
  }
}

cleanup();

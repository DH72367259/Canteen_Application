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

// Keep these whitelist accounts - never delete them
const KEEP_EMAILS = [
  'admin@noqx.test',
  'canteen1@noqx.test',
  'canteen2@noqx.test',
  'worker1@noqx.test',
  'coadmin@noqx.test',
];

async function cleanupE2E() {
  console.log('🧹 Starting E2E test cleanup...\n');

  try {
    // 1. Get all test-created users (e2e-* emails)
    console.log('🔍 Finding E2E test users...');
    const { data: allProfiles } = await supabase
      .from('profiles')
      .select('id, email, role');

    const e2eUsers = (allProfiles || []).filter(p => p.email.startsWith('e2e-'));
    console.log(`   Found ${e2eUsers.length} E2E test users to delete\n`);

    // 2. Delete all orders related to E2E users
    console.log('🗑️  Deleting orders and related data...');
    for (const user of e2eUsers) {
      // Delete order_bins first (FK constraint)
      const { data: userOrders } = await supabase
        .from('orders')
        .select('id')
        .eq('user_id', user.id);

      for (const order of userOrders || []) {
        // Delete in order of FK dependencies
        await supabase.from('order_bins').delete().eq('order_id', order.id);
        await supabase.from('payments').delete().eq('order_id', order.id);
        await supabase.from('order_items').delete().eq('order_id', order.id);
        await supabase.from('orders').delete().eq('id', order.id);
      }
    }
    console.log('   ✓ Orders deleted\n');

    // 3. Free up any bins marked as occupied by test orders
    console.log('🔓 Releasing occupied bins...');
    const { data: occupiedBins } = await supabase
      .from('bins')
      .select('id, order_id, assigned_order_id')
      .or(`order_id.neq.null,assigned_order_id.neq.null`);

    if (occupiedBins && occupiedBins.length > 0) {
      // Check if these orders still exist
      const binIds = occupiedBins.map(b => b.id);
      for (const binId of binIds) {
        await supabase.from('bins').update({
          is_occupied: false,
          order_id: null,
          assigned_order_id: null,
          status: 'empty',
          updated_at: new Date().toISOString(),
        }).eq('id', binId);
      }
      console.log(`   ✓ Released ${binIds.length} bins\n`);
    }

    // 4. Delete test-created time slots (E2E-SLOTCAP-*, E2E-BIN-PERM-*)
    console.log('🗑️  Deleting test time slots...');
    const { data: testSlots } = await supabase
      .from('time_slots')
      .select('id')
      .or(`slot_name.ilike.%E2E-%`);

    if (testSlots && testSlots.length > 0) {
      for (const slot of testSlots) {
        await supabase.from('time_slots').delete().eq('id', slot.id);
      }
      console.log(`   ✓ Deleted ${testSlots.length} test slots\n`);
    }

    // 5. Delete E2E test users from auth and profiles
    console.log('🗑️  Deleting E2E test users...');
    for (const user of e2eUsers) {
      // Delete from profiles
      await supabase.from('profiles').delete().eq('id', user.id);

      // Delete from auth
      try {
        await supabase.auth.admin.deleteUser(user.id);
      } catch (e) {
        // User might already be deleted, that's ok
      }
    }
    console.log(`   ✓ Deleted ${e2eUsers.length} users\n`);

    // 6. Verify cleanup
    console.log('✅ Verification - Remaining whitelist users:');
    const { data: remaining } = await supabase
      .from('profiles')
      .select('email, role')
      .order('email');

    remaining?.forEach((p, i) => {
      console.log(`   ${i + 1}. ${p.email} (${p.role})`);
    });

    console.log('\n✅ E2E cleanup complete!');
  } catch (error) {
    console.error('❌ Error during cleanup:', error.message);
    process.exit(1);
  }
}

cleanupE2E();

#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

// Load environment variables
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

// The 5 users to keep
const KEEP_EMAILS = [
  'admin@noqx.test',
  'canteen1@noqx.test',
  'canteen2@noqx.test',
  'worker1@noqx.test',
  'coadmin@noqx.test',
];

async function cleanup() {
  console.log('🧹 Starting database cleanup...\n');

  try {
    // Step 1: Get all users from auth
    console.log('📋 Fetching all Supabase Auth users...');
    const { data: allUsers, error: listError } = await supabase.auth.admin.listUsers();
    if (listError) throw new Error(`List users failed: ${listError.message}`);
    console.log(`   Found ${allUsers.users.length} total users`);

    // Step 2: Get profile IDs to keep
    console.log('\n🔍 Finding profiles to keep...');
    const { data: keepProfiles, error: keepError } = await supabase
      .from('profiles')
      .select('id, email')
      .in('email', KEEP_EMAILS);
    if (keepError) throw new Error(`Fetch keep profiles failed: ${keepError.message}`);
    console.log(`   Found ${keepProfiles.length} profiles to keep`);
    const keepIds = new Set(keepProfiles.map(p => p.id));

    // Step 3: Delete orders and related data for users NOT in the keep list
    console.log('\n🗑️  Deleting orders and data for users not in keep list...');
    const { data: usersToDelete } = await supabase
      .from('orders')
      .select('user_id')
      .not('user_id', 'in', `(${Array.from(keepIds).map(id => `'${id}'`).join(',')})`);

    if (usersToDelete && usersToDelete.length > 0) {
      const userIdsToClean = [...new Set(usersToDelete.map(o => o.user_id))];
      console.log(`   Found orders from ${userIdsToClean.length} users to delete`);

      for (const userId of userIdsToClean) {
        // Delete order_bins
        const { error: binError } = await supabase
          .from('order_bins')
          .delete()
          .eq('order_id', (await supabase.from('orders').select('id').eq('user_id', userId)).data[0]?.id || '');
        
        // Delete payments
        await supabase.from('payments').delete().in(
          'order_id',
          (await supabase.from('orders').select('id').eq('user_id', userId)).data?.map(o => o.id) || []
        );

        // Delete order_items
        await supabase.from('order_items').delete().in(
          'order_id',
          (await supabase.from('orders').select('id').eq('user_id', userId)).data?.map(o => o.id) || []
        );

        // Delete orders
        await supabase.from('orders').delete().eq('user_id', userId);
      }
      console.log('   ✓ Deleted orders and related data');
    }

    // Step 4: Delete all other data tables (clear them completely)
    console.log('\n🗑️  Clearing supporting data tables...');

    const tablesToClear = [
      'notifications',
      'support_tickets',
      'refund_logs',
      'noqx_pro_subscriptions',
      'settlement_payments',
    ];

    for (const table of tablesToClear) {
      try {
        await supabase.from(table).delete().neq('id', '');
        console.log(`   ✓ Cleared ${table}`);
      } catch (e) {
        console.log(`   ℹ️  ${table} (skipped - may be empty or restricted)`);
      }
    }

    // Step 5: Delete users from auth
    console.log('\n🔐 Deleting extra auth users...');
    let deletedCount = 0;
    for (const user of allUsers.users) {
      if (!KEEP_EMAILS.includes(user.email || '')) {
        try {
          await supabase.auth.admin.deleteUser(user.id);
          deletedCount++;
        } catch (e) {
          console.log(`   ⚠️  Failed to delete ${user.email}: ${e.message}`);
        }
      }
    }
    console.log(`   ✓ Deleted ${deletedCount} auth users`);

    // Step 6: Delete profiles not in keep list
    console.log('\n👥 Cleaning up extra profiles...');
    const { error: deleteProfilesError } = await supabase
      .from('profiles')
      .delete()
      .not('id', 'in', `(${Array.from(keepIds).map(id => `'${id}'`).join(',')})`);
    if (deleteProfilesError) {
      console.log(`   ⚠️  ${deleteProfilesError.message}`);
    } else {
      console.log(`   ✓ Deleted extra profiles`);
    }

    // Step 7: Verify
    console.log('\n✅ Cleanup complete! Verifying...');
    const { data: finalUsers } = await supabase.from('profiles').select('email, role');
    console.log(`\n   Remaining users in database:`);
    finalUsers.forEach(u => console.log(`   - ${u.email} (${u.role})`));

    console.log('\n🎉 Database cleanup finished successfully!');
  } catch (error) {
    console.error('❌ Cleanup failed:', error.message);
    process.exit(1);
  }
}

cleanup();

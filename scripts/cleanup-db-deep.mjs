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

const KEEP_EMAILS = [
  'admin@noqx.test',
  'canteen1@noqx.test',
  'canteen2@noqx.test',
  'worker1@noqx.test',
  'coadmin@noqx.test',
];

async function cleanup() {
  console.log('🧹 Deep cleanup - removing orphaned orders...\n');

  try {
    // Get profiles to delete
    const { data: allProfiles } = await supabase
      .from('profiles')
      .select('id, email');
    
    const toDeleteIds = allProfiles
      .filter(p => !KEEP_EMAILS.includes(p.email))
      .map(p => p.id);
    
    console.log(`Profiles to clean: ${toDeleteIds.length}`);

    // Delete orders for those users
    for (const userId of toDeleteIds) {
      console.log(`\n🔍 Cleaning user: ${userId}`);
      
      // Get orders
      const { data: orders } = await supabase
        .from('orders')
        .select('id')
        .eq('user_id', userId);
      
      console.log(`   Found ${orders?.length || 0} orders`);
      
      if (orders && orders.length > 0) {
        const orderIds = orders.map(o => o.id);
        
        // Delete order_bins
        await supabase.from('order_bins').delete().in('order_id', orderIds);
        console.log(`   ✓ Deleted order_bins`);
        
        // Delete payments
        await supabase.from('payments').delete().in('order_id', orderIds);
        console.log(`   ✓ Deleted payments`);
        
        // Delete order_items
        await supabase.from('order_items').delete().in('order_id', orderIds);
        console.log(`   ✓ Deleted order_items`);
        
        // Delete orders
        await supabase.from('orders').delete().eq('user_id', userId);
        console.log(`   ✓ Deleted orders`);
      }
      
      // Now delete the profile
      const { error: profileError } = await supabase
        .from('profiles')
        .delete()
        .eq('id', userId);
      
      if (profileError) {
        console.log(`   ❌ Failed to delete profile: ${profileError.message}`);
      } else {
        console.log(`   ✓ Deleted profile`);
      }
    }

    // Final verification
    console.log('\n✅ Final check - Remaining users:');
    const { data: finalProfiles } = await supabase
      .from('profiles')
      .select('email, role')
      .order('email');
    
    console.log(`\nTotal: ${finalProfiles.length} users\n`);
    finalProfiles.forEach((p, i) => {
      const isKeep = KEEP_EMAILS.includes(p.email);
      const checkmark = isKeep ? '✓' : '❌';
      console.log(`   ${checkmark} ${p.email} (${p.role})`);
    });

    console.log('\n🎉 Cleanup complete!');
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

cleanup();

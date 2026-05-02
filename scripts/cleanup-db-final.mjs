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
  console.log('🧹 Running additional cleanup pass...\n');

  try {
    console.log('🔍 Fetching all profiles...');
    const { data: allProfiles, error: fetchError } = await supabase
      .from('profiles')
      .select('id, email, role');
    
    if (fetchError) throw fetchError;
    
    console.log(`   Found ${allProfiles.length} profiles total`);
    
    const toDelete = allProfiles.filter(p => !KEEP_EMAILS.includes(p.email));
    console.log(`   Need to delete: ${toDelete.length} profiles`);
    
    if (toDelete.length > 0) {
      console.log('\n🗑️  Deleting extra profiles:');
      for (const profile of toDelete) {
        console.log(`   - ${profile.email} (${profile.role})`);
        
        // Delete from profiles table
        const { error: delError } = await supabase
          .from('profiles')
          .delete()
          .eq('id', profile.id);
        
        if (delError) {
          console.log(`     ⚠️  Profile delete error: ${delError.message}`);
        } else {
          console.log(`     ✓ Deleted from profiles`);
        }
        
        // Try to delete from auth
        try {
          await supabase.auth.admin.deleteUser(profile.id);
          console.log(`     ✓ Deleted from auth`);
        } catch (e) {
          console.log(`     ℹ️  Auth delete: ${e.message}`);
        }
      }
    }

    // Verify final state
    console.log('\n✅ Verification - Final users in database:');
    const { data: finalProfiles } = await supabase
      .from('profiles')
      .select('email, role')
      .order('email');
    
    finalProfiles.forEach((p, i) => {
      console.log(`   ${i + 1}. ${p.email} (${p.role})`);
    });

    console.log('\n🎉 Cleanup complete!');
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

cleanup();

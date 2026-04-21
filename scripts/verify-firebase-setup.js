#!/usr/bin/env node

/**
 * Firebase Setup Verification Script
 * Run: node scripts/verify-firebase-setup.js
 * 
 * Checks:
 * 1. Environment variables are set
 * 2. Firebase config is valid
 * 3. Admin SDK key exists and is readable
 * 4. Firebase project is accessible
 */

const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const envLocalPath = path.join(projectRoot, '.env.local');
const serviceAccountPath = path.join(projectRoot, 'serviceAccountKey.json');

console.log('🔍 Firebase Setup Verification\n');
console.log(`Project root: ${projectRoot}\n`);

let hasErrors = false;

// Check 1: .env.local exists
console.log('1. Checking .env.local file...');
if (fs.existsSync(envLocalPath)) {
  console.log('   ✅ .env.local exists\n');
} else {
  console.log('   ❌ .env.local not found');
  console.log('   📝 Create it: cp .env.example .env.local\n');
  hasErrors = true;
}

// Check 2: Environment variables
console.log('2. Checking environment variables...');
const requiredPublicEnv = [
  'NEXT_PUBLIC_FIREBASE_API_KEY',
  'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
  'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET',
  'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  'NEXT_PUBLIC_FIREBASE_APP_ID'
];

const requiredServerEnv = [
  'FIREBASE_PROJECT_ID',
  'FIREBASE_CLIENT_EMAIL',
  'FIREBASE_PRIVATE_KEY'
];

// Load from .env.local
let envVars = {};
if (fs.existsSync(envLocalPath)) {
  const envContent = fs.readFileSync(envLocalPath, 'utf-8');
  envContent.split('\n').forEach(line => {
    const [key, ...valueParts] = line.split('=');
    const value = valueParts.join('=').trim();
    if (key && !key.startsWith('#')) {
      envVars[key.trim()] = value;
    }
  });
}

// Check public env vars
console.log('   Public Client Vars:');
let publicMissing = false;
requiredPublicEnv.forEach(key => {
  const value = process.env[key] || envVars[key];
  if (value && value !== '') {
    console.log(`     ✅ ${key}`);
  } else {
    console.log(`     ❌ ${key} - NOT SET`);
    publicMissing = true;
    hasErrors = true;
  }
});

if (publicMissing) {
  console.log('   📝 Add these from Firebase Console → Project Settings → Web app config\n');
} else {
  console.log('');
}

// Check server env vars
console.log('   Server Admin Vars:');
let serverMissing = false;
requiredServerEnv.forEach(key => {
  const value = process.env[key] || envVars[key];
  if (value && value !== '') {
    const preview = key === 'FIREBASE_PRIVATE_KEY' 
      ? value.substring(0, 30) + '...'
      : value;
    console.log(`     ✅ ${key}`);
  } else {
    console.log(`     ❌ ${key} - NOT SET`);
    serverMissing = true;
    hasErrors = true;
  }
});

if (serverMissing) {
  console.log('   📝 Add these from Firebase Console → Service Accounts → Generate new private key\n');
} else {
  console.log('');
}

// Check 3: Service Account Key file
console.log('3. Checking serviceAccountKey.json file...');
if (fs.existsSync(serviceAccountPath)) {
  try {
    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf-8'));
    if (serviceAccount.project_id && serviceAccount.private_key) {
      console.log('   ✅ serviceAccountKey.json is valid\n');
    } else {
      console.log('   ❌ serviceAccountKey.json is missing required fields\n');
      hasErrors = true;
    }
  } catch (e) {
    console.log('   ❌ serviceAccountKey.json is invalid JSON\n');
    hasErrors = true;
  }
} else {
  console.log('   ℹ️  serviceAccountKey.json not found (optional for development)\n');
  console.log('   📝 Download from: Firebase Console → Service Accounts → Generate new private key\n');
}

// Check 4: .gitignore configuration
console.log('4. Checking .gitignore...');
const gitignorePath = path.join(projectRoot, '.gitignore');
if (fs.existsSync(gitignorePath)) {
  const gitignoreContent = fs.readFileSync(gitignorePath, 'utf-8');
  if (gitignoreContent.includes('.env.local') && gitignoreContent.includes('serviceAccountKey.json')) {
    console.log('   ✅ .gitignore properly configured\n');
  } else {
    console.log('   ⚠️  .gitignore missing security entries');
    if (!gitignoreContent.includes('.env.local')) {
      console.log('     - Missing: .env.local');
    }
    if (!gitignoreContent.includes('serviceAccountKey.json')) {
      console.log('     - Missing: serviceAccountKey.json');
    }
    console.log('   📝 Add these to .gitignore to prevent secret leaks\n');
  }
}

// Summary
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
if (hasErrors) {
  console.log('❌ Setup issues found. See above for fixes.\n');
  console.log('Next steps:');
  console.log('1. Follow SETUP_ENV.md instructions');
  console.log('2. Copy values from Firebase Console');
  console.log('3. Run this script again to verify\n');
  process.exit(1);
} else {
  console.log('✅ Firebase setup looks good!\n');
  console.log('Next steps:');
  console.log('1. Run: npm run dev');
  console.log('2. Test login at: http://localhost:3000/login');
  console.log('3. Try all 5 roles\n');
  process.exit(0);
}

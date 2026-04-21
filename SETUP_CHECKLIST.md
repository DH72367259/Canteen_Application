# Firebase Setup Checklist

## Overview
This checklist guides you through completing the Firebase setup for the Canteen application. **Estimated time: 20-30 minutes**

Your Firebase project: `canteen-dashboard-cfeb9`

---

## Phase 1: Firebase Console (10-15 min)

### ☐ Enable Authentication Methods
- [ ] Go to Firebase Console → Authentication → Sign-in method
- [ ] Enable **Email/Password** provider
- [ ] Enable **Anonymous** provider  
- [ ] (Optional) Enable **Google** provider
- **Status**: All required providers should have a green ✅

### ☐ Create Firestore Database
- [ ] Go to Firebase Console → Firestore Database
- [ ] Click "Create Database"
- [ ] Select region closest to users
- [ ] Start in **test mode** (we'll strengthen rules in Phase 3)
- [ ] Click "Create"
- **Wait**: 2-3 minutes for database to initialize
- **Status**: Database should show collections view

### ☐ Deploy Security Rules
- [ ] Go to Firestore → Rules tab
- [ ] Replace all content with rules from [FIREBASE_CONSOLE_SETUP.md](./FIREBASE_CONSOLE_SETUP.md#step-3-deploy-firestore-security-rules)
- [ ] Click **Publish**
- **Status**: Message should say "Rules deployed successfully"

### ☐ Get Firebase Configuration
- [ ] Go to Firebase Console → Settings ⚙️ → Project Settings
- [ ] Scroll to "Your apps" section
- [ ] Click the **Web** app (or add one)
- [ ] Copy the `firebaseConfig` object
- **Status**: Have all 6 values ready:
  - apiKey
  - authDomain
  - projectId
  - storageBucket
  - messagingSenderId
  - appId

### ☐ Download Admin SDK Key
- [ ] Go to Firebase Console → Settings ⚙️ → Service Accounts
- [ ] Under "Firebase Admin SDK", click **Generate new private key**
- [ ] Save JSON file: `serviceAccountKey.json`
- [ ] Move to project root: `mv ~/Downloads/*.json ./serviceAccountKey.json`
- **Status**: File should be in `/Users/kuhelijoardar/Canteen/serviceAccountKey.json`

---

## Phase 2: Local Environment Setup (5 min)

### ☐ Create `.env.local` File
- [ ] Copy from template: `cp .env.example .env.local`
- **Status**: `.env.local` file created in project root

### ☐ Populate Firebase Client Config
- [ ] Open `.env.local` in editor
- [ ] Fill `NEXT_PUBLIC_FIREBASE_API_KEY` from firebaseConfig.apiKey
- [ ] Fill `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` from firebaseConfig.authDomain
- [ ] Fill `NEXT_PUBLIC_FIREBASE_PROJECT_ID` from firebaseConfig.projectId
- [ ] Fill `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` from firebaseConfig.storageBucket
- [ ] Fill `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` from firebaseConfig.messagingSenderId
- [ ] Fill `NEXT_PUBLIC_FIREBASE_APP_ID` from firebaseConfig.appId
- **Status**: All 6 NEXT_PUBLIC_* variables should be filled

### ☐ Populate Firebase Admin Config
- [ ] Open `serviceAccountKey.json` in editor
- [ ] From `serviceAccountKey.json`, copy:
  - `project_id` → `FIREBASE_PROJECT_ID`
  - `client_email` → `FIREBASE_CLIENT_EMAIL`
  - `private_key` → `FIREBASE_PRIVATE_KEY` (include quotes and `\n` characters)
- **Status**: All 3 admin variables should be filled

### ☐ Add Admin Emails
- [ ] In `.env.local`, fill `ADMIN_EMAILS`:
  - `ADMIN_EMAILS=canteen-admin@example.com,super-admin@example.com`
- **Status**: At least one admin email configured

### ☐ Verify `.gitignore` Configuration
- [ ] Check `.gitignore` contains:
  - `.env*.local` ✅
  - `serviceAccountKey.json` ✅
- [ ] Run: `grep -E "(env|serviceAccount)" .gitignore`
- **Status**: Both entries should be listed

---

## Phase 3: Verification (5 min)

### ☐ Run Verification Script
```bash
node scripts/verify-firebase-setup.js
```
- **Expected output**: ✅ Firebase setup looks good!
- **If errors**: Follow the suggestions and re-run

### ☐ Start Development Server
```bash
npm run dev
```
- **Expected output**: 
  ```
  ▲ Next.js 16.x
  - Local: http://localhost:3000
  ```
- **If fails**: Check `.env.local` values and restart

### ☐ Test Login Page
- [ ] Open `http://localhost:3000` in browser
- [ ] Click "Login" button
- [ ] See role dropdown with 5 options:
  - 🛒 Customer
  - 🏪 Canteen Admin
  - 🍕 Vendor
  - 👷 Worker
  - 🔐 Super Admin

### ☐ Create Test Users (Firebase Console)
- [ ] Go to Firebase Console → Authentication → Users
- [ ] Click **Add User** button
- [ ] Create these test accounts:
  - Email: `customer@example.com` | Password: `password123`
  - Email: `canteen-admin@example.com` | Password: `admin123`
  - Email: `vendor@example.com` | Password: `vendor123`
  - Email: `worker@example.com` | Password: `worker123`
  - Email: `super-admin@example.com` | Password: `super123`
- **Status**: 5 users should appear in Firebase Console

### ☐ Test Login Flow
- [ ] On login page, select **Customer** role
- [ ] Enter: `customer@example.com` | `password123`
- [ ] Click Sign In
- **Expected**: Redirect to `/dashboard` (customer dashboard)
- [ ] Repeat for other roles, verify each redirects to correct dashboard:
  - Canteen Admin → `/admin/dashboard`
  - Vendor → `/vendor/dashboard`
  - Worker → `/worker/dashboard`
  - Super Admin → `/system/dashboard`

### ☐ Verify Firestore Connection
- [ ] While logged in, open browser DevTools (F12)
- [ ] Go to Console tab
- [ ] You should see: No errors about Firebase initialization
- [ ] Go to Network tab, filter by "firestore"
- [ ] You should see requests to firebaseio.com
- **Status**: Firestore is connecting and loading data

---

## Phase 4: Additional Setup (Optional)

### ☐ Create Sample Data
- [ ] (Optional) Add sample canteens, vendors, menu items
- [ ] Use Firestore console to manually add documents
- [ ] Or see [DEPLOYMENT.md](./DEPLOYMENT.md#create-admin-users) for bulk import

### ☐ Configure Custom Claims (Advanced)
- [ ] If using Firebase CLI: set custom role claims
- [ ] This allows role-based security rules to work
- [ ] See [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed steps

### ☐ Enable Additional Features
- [ ] Firebase Cloud Storage (for menu item images)
- [ ] Firebase Cloud Functions (for automated tasks)
- [ ] Firebase Hosting (for deployment)

---

## Phase 5: Deployment (See DEPLOYMENT.md)

After all above phases are complete:

### ☐ Deploy to Firebase Hosting
```bash
npm run firebase:deploy:canteen
```

### ☐ Set Production Security Rules
- [ ] Update Firestore → Rules with stricter production rules
- [ ] Review [FIREBASE_CONSOLE_SETUP.md](./FIREBASE_CONSOLE_SETUP.md) for production examples

### ☐ Monitor in Firebase Console
- [ ] Go to Build → Usage dashboard
- [ ] Verify read/write operations are functioning
- [ ] Check for any errors in Authentication or Firestore logs

---

## Troubleshooting

| Challenge | Solution |
|-----------|----------|
| `.env.local` not found | Run: `cp .env.example .env.local` |
| Verification script fails | Make sure all env vars in `.env.local` are filled |
| Login fails with "User not found" | Create test user in Firebase Console → Authentication |
| Firestore permission denied | Check security rules deployment or use test mode temporarily |
| Can't find Firebase config | Make sure you're in correct Firebase Console project |
| Environment changes not taking effect | Stop dev server, delete `.next/`, restart with `npm run dev` |

---

## Quick Reference

**Firebase Console URLs**:
- [Project Overview](https://console.firebase.google.com/u/0/project/canteen-dashboard-cfeb9/overview)
- [Authentication](https://console.firebase.google.com/u/0/project/canteen-dashboard-cfeb9/authentication/providers)
- [Firestore Database](https://console.firebase.google.com/u/0/project/canteen-dashboard-cfeb9/firestore)
- [Firestore Rules](https://console.firebase.google.com/u/0/project/canteen-dashboard-cfeb9/firestore/rules)
- [Project Settings](https://console.firebase.google.com/u/0/project/canteen-dashboard-cfeb9/settings/general)

**Local Development Commands**:
```bash
npm run dev                          # Start dev server
npm run lint                         # Lint code
npm run build                        # Build for production
node scripts/verify-firebase-setup.js # Verify setup
npm run firebase:deploy:canteen      # Deploy to Firebase
```

---

## Need Help?

See these guides:
- **Firebase Console Setup**: [FIREBASE_CONSOLE_SETUP.md](./FIREBASE_CONSOLE_SETUP.md)
- **Environment Variables**: [SETUP_ENV.md](./SETUP_ENV.md)
- **Complete Deployment**: [DEPLOYMENT.md](./DEPLOYMENT.md)
- **Project README**: [README.md](./README.md)

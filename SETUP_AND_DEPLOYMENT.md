# NoQx Application - Complete Setup & Deployment Guide

**Date**: 21 April 2026  
**Project**: Canteen Management Platform  
**Status**: Ready for Production Setup

---

## 🚀 QUICK START - STEP BY STEP

### Prerequisites Checklist
- ✅ Firebase Project Created: `canteen-dashboard-cfeb9`
- ✅ Node.js 18+ installed
- ✅ npm 9+ installed
- ✅ Git configured
- ✅ Next.js project initialized
- ✅ TypeScript configured

---

## 📋 STEP 1: FIREBASE SETUP (Already Created)

### What's Already Done
```
✅ Firebase Project: canteen-dashboard-cfeb9
✅ Authentication: Email/Password + Anonymous
✅ Firestore Database: Created
✅ Security Rules: Deployed
✅ Hosting: Configured
```

### Verify Firebase Project
1. Go to https://console.firebase.google.com
2. Select project: **canteen-dashboard-cfeb9**
3. Check status:
   - Authentication: ✅ (look for enabled methods)
   - Firestore: ✅ (should see collections)
   - Hosting: ✅ (should see domain)

---

## 🔑 STEP 2: ENVIRONMENT VARIABLES

### Create `.env.local` file
```bash
# From terminal in /Users/kuhelijoardar/Canteen
touch .env.local
```

### Add Firebase Config
Get values from Firebase Console → Project Settings → General

```env
# ===== FIREBASE CLIENT SDK =====
NEXT_PUBLIC_FIREBASE_API_KEY=YOUR_API_KEY
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=canteen-dashboard-cfeb9.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=canteen-dashboard-cfeb9
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=canteen-dashboard-cfeb9.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=YOUR_MESSAGING_SENDER_ID
NEXT_PUBLIC_FIREBASE_APP_ID=YOUR_APP_ID

# ===== FIREBASE ADMIN SDK =====
# Get from Firebase Console → Service Accounts → Node.js
FIREBASE_PROJECT_ID=canteen-dashboard-cfeb9
FIREBASE_CLIENT_EMAIL=your-service-account@canteen-dashboard-cfeb9.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

# ===== ADMIN ALLOWLIST =====
ADMIN_EMAILS=admin@yourdomain.com,superadmin@yourdomain.com

# ===== FIREBASE ALIAS =====
FIREBASE_ALIAS=canteen-isolated
```

### How to Get Firebase Values
1. **API_KEY, AUTH_DOMAIN, etc.**:
   - Go to Firebase Console
   - Project Settings → General
   - Scroll to "Your apps" section
   - Copy the config object

2. **PRIVATE_KEY**:
   - Firebase Console → Settings → Service Accounts
   - Click "Generate New Private Key"
   - Copy the `private_key` value (with escaped newlines)

---

## 🏗️ STEP 3: LOCAL DEVELOPMENT SETUP

### Install Dependencies
```bash
cd /Users/kuhelijoardar/Canteen

# Install/verify packages
npm install

# Or rebuild if needed
npm install --legacy-peer-deps
```

### Verify Installation
```bash
# Check Next.js
npm run build

# Check linting
npm run lint

# Check TypeScript
npx tsc --noEmit
```

### Start Development Server
```bash
npm run dev
```

**Expected Output**:
```
> next dev

  ▲ Next.js 16.0.0
  - Local:        http://localhost:3000
  - Environments: .env.local

✓ Ready in 2.4s
```

---

## 👥 STEP 4: CREATE TEST USERS & LOGIN SETUP

### User Roles Available
1. **Regular User** (Customer)
2. **Canteen Admin** (Kitchen Manager)
3. **Vendor** (Menu Manager)
4. **Worker** (Staff)
5. **Super Admin** (Platform Owner)

### Create Test Accounts in Firebase

#### Method 1: Firebase Console (Easy)
1. Go to **Firebase Console** → Authentication → Users
2. Click "Add User"
3. Enter email and password
4. Create 5 test accounts:

```
TEST ACCOUNTS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. User (Customer)
   Email: user@test.com
   Password: Test@123456

2. Canteen Admin
   Email: admin@canteen.com
   Password: Admin@123456

3. Vendor
   Email: vendor@canteen.com
   Password: Vendor@123456

4. Worker
   Email: worker@canteen.com
   Password: Worker@123456

5. Super Admin
   Email: superadmin@canteen.com
   Password: SuperAdmin@123456
```

#### Method 2: Using Script (Programmatic)
```bash
# Use admin SDK script to create users with custom claims
npm run admin:create -- --email=user@test.com --password=Test@123456 --role=user
npm run admin:create -- --email=admin@canteen.com --password=Admin@123456 --role=canteen_admin
```

---

## 🔐 STEP 5: ASSIGN ROLES (Custom Claims)

### Add Custom Claims to Users

In Firebase Console:
1. Go to **Authentication** → Users
2. Click on a user
3. Scroll to "Custom Claims"
4. Add JSON:

#### For Customer User
```json
{
  "role": "user"
}
```

#### For Canteen Admin
```json
{
  "role": "canteen_admin",
  "canteenId": "canteen-1"
}
```

#### For Vendor
```json
{
  "role": "vendor",
  "vendorId": "vendor-1"
}
```

#### For Worker
```json
{
  "role": "worker",
  "canteenId": "canteen-1"
}
```

#### For Super Admin
```json
{
  "role": "super_admin"
}
```

---

## 🧪 STEP 6: LOGIN TEST - USER FLOWS

### Access Application
```
Local: http://localhost:3000
Dev: http://localhost:3000/login
```

### Test Login 1: Regular User
```
Email: user@test.com
Password: Test@123456

Expected Route: /dashboard
Expected View: User Dashboard (my orders, rewards, profile)
```

### Test Login 2: Canteen Admin
```
Email: admin@canteen.com
Password: Admin@123456

Expected Route: /admin
Expected View: Admin Dashboard (live orders, order management)
```

### Test Login 3: Vendor
```
Email: vendor@canteen.com
Password: Vendor@123456

Expected Route: /vendor
Expected View: Vendor Dashboard (menu management, slots)
```

### Test Login 4: Worker
```
Email: worker@canteen.com
Password: Worker@123456

Expected Route: /worker
Expected View: Worker Dashboard (waste reporting, bin tracking)
```

### Test Login 5: Super Admin
```
Email: superadmin@canteen.com
Password: SuperAdmin@123456

Expected Route: /system/admin
Expected View: Super Admin Dashboard (system controls)
```

---

## 📱 STEP 7: CREATE SAMPLE DATA (Firestore)

### Navigate to Firestore Console
```
Firebase Console → Firestore Database
```

### Create Collections (if not exists)

#### Collection: canteens
Add a document:
```json
{
  "id": "canteen-1",
  "name": "Main Canteen",
  "location": "Building A",
  "vendorIds": ["vendor-1"],
  "operatingHours": {
    "open": "08:00",
    "close": "20:00"
  },
  "active": true,
  "createdAt": "2026-04-21T00:00:00Z",
  "updatedAt": "2026-04-21T00:00:00Z"
}
```

#### Collection: menus
Add a document:
```json
{
  "id": "menu-1",
  "vendorId": "vendor-1",
  "canteenId": "canteen-1",
  "name": "Noodles",
  "description": "Delicious noodles",
  "price": 50,
  "category": "meal",
  "available": true,
  "prepTime": 5,
  "createdAt": "2026-04-21T00:00:00Z",
  "updatedAt": "2026-04-21T00:00:00Z"
}
```

#### Collection: bins
Add a document:
```json
{
  "id": "bin-1",
  "canteenId": "canteen-1",
  "type": "organic",
  "currentWaste": 0,
  "threshold": 50,
  "lastEmptied": "2026-04-21T00:00:00Z",
  "status": "normal",
  "createdAt": "2026-04-21T00:00:00Z",
  "updatedAt": "2026-04-21T00:00:00Z"
}
```

---

## 📦 STEP 8: COMMIT TO GITHUB

### Prerequisites
- ✅ Git installed locally
- ✅ GitHub account setup
- ✅ Repository ready: `DH72367259/Canteen_Application`

### Commit Process

#### 1. Initialize Git (if not done)
```bash
cd /Users/kuhelijoardar/Canteen

git init
git config user.name "Your Name"
git config user.email "your.email@example.com"
```

#### 2. Add Remote Origin
```bash
git remote add origin https://github.com/DH72367259/Canteen_Application.git
```

#### 3. Create .gitignore (if not exists)
```bash
cat > .gitignore << 'EOF'
# Dependencies
node_modules/
.pnp
.pnp.js

# Testing
.nyc_output
coverage

# Production
.next
out
build
dist

# Environment
.env.local
.env.*.local

# IDE
.vscode
.idea
*.swp
*.swo
*~

# OS
.DS_Store
Thumbs.db

# Logs
logs
*.log
npm-debug.log*
yarn-debug.log*
EOF
```

#### 4. Stage All Files
```bash
git add .
```

#### 5. Create Commit
```bash
git commit -m "feat: production ready canteen application with multi-role auth

- Implemented 5-role authentication system (user, admin, vendor, worker, super_admin)
- Created user dashboard with order tracking and rewards system
- Built admin dashboard with real-time order management (5s refresh)
- Implemented worker waste reporting interface with bin tracking
- Added vendor dashboard with menu management
- Firestore database schema with 8 collections
- Real-time order status pipeline (Confirmed → Preparing → Ready → Collected)
- Reward system: ₹1-₹2 per order, max ₹20 redemption, 14-day expiry
- OTP-based pickup verification system
- Slot-based ordering with per-item capacity limits
- TypeScript for 100% type safety
- Firebase Auth + Firestore integration
- Environmental configuration via .env.local
- Comprehensive documentation and setup guides

All workflows aligned with Figma design and business specifications.
Ready for staging/production deployment.

Type: feat
Scope: canteen-app
Breaking: false
Closes: #1"
```

#### 6. Push to GitHub
```bash
git branch -M main
git push -u origin main
```

**Expected Output**:
```
Enumerating objects: 150, done.
Counting objects: 100% (150/150), done.
Delta compression using up to 8 threads
Compressing objects: 100% (120/120), done.
Writing objects: 100% (150/150), 2.50 MiB, done.

To https://github.com/DH72367259/Canteen_Application.git
 * [new branch]      main -> main
Branch 'main' set up to track remote branch 'main' from 'origin'.
```

---

## 🌐 STEP 9: DEPLOY TO FIREBASE HOSTING

### Deploy to Firebase
```bash
cd /Users/kuhelijoardar/Canteen

# Login to Firebase CLI (first time only)
npm run firebase:login

# Deploy to Firebase Hosting
npm run firebase:deploy:canteen:hosting
```

**Expected Output**:
```
✔ Deploy complete!

Project Console: https://console.firebase.google.com/project/canteen-dashboard-cfeb9/overview
Hosting URL: https://canteen-dashboard-cfeb9.web.app
```

### Access Production
```
🌐 Production URL: https://canteen-dashboard-cfeb9.web.app
🔗 Custom Domain: (if configured)
```

---

## 📚 STEP 10: PRODUCTION SETUP CHECKLIST

### Pre-Deployment
- [ ] `.env.local` configured with Firebase values
- [ ] All 5 test users created in Firebase Auth
- [ ] Custom claims assigned to users
- [ ] Sample data added to Firestore
- [ ] Code committed to GitHub
- [ ] Build tested locally (`npm run build`)
- [ ] No TypeScript errors
- [ ] ESLint passes

### Deployment
- [ ] Firebase hosting prepared
- [ ] Security rules reviewed
- [ ] Firestore backups enabled
- [ ] Billing account active

### Post-Deployment
- [ ] Test all user logins in production
- [ ] Verify real-time updates work
- [ ] Check Firestore queries perform
- [ ] Monitor error logs

---

## 🔗 LOGIN LINKS & CREDENTIALS

### Production URLs

#### User App
```
🌐 Base URL: https://canteen-dashboard-cfeb9.web.app
🔐 Login: https://canteen-dashboard-cfeb9.web.app/login
📊 Dashboard: https://canteen-dashboard-cfeb9.web.app/dashboard
```

#### Test Credentials

| Role | Email | Password | Dashboard URL |
|------|-------|----------|---|
| **User** | user@test.com | Test@123456 | /dashboard |
| **Canteen Admin** | admin@canteen.com | Admin@123456 | /admin |
| **Vendor** | vendor@canteen.com | Vendor@123456 | /vendor |
| **Worker** | worker@canteen.com | Worker@123456 | /worker |
| **Super Admin** | superadmin@canteen.com | SuperAdmin@123456 | /system/admin |

---

## 🛠️ TROUBLESHOOTING

### Issue: "Cannot find module 'firebase'"
```bash
npm install firebase firebase-admin --save
```

### Issue: ".env.local not working"
- Verify file exists: `ls -la /Users/kuhelijoardar/Canteen/.env.local`
- Restart dev server: `Ctrl+C` then `npm run dev`
- Check variable access in code

### Issue: "Custom claims not working"
- Firestore Emulator issue: Use Firebase Console to set claims
- Wait for token refresh: Log out and log in again
- Check user is in correct custom claim format

### Issue: "Firestore queries returning empty"
- Check collection names (case-sensitive)
- Verify security rules allow read/write
- Ensure documents exist in Firestore
- Check user is authenticated

### Issue: "Real-time updates not working"
- Firestore listener should auto-activate
- Check browser console for errors
- Verify Firestore rules allow real-time sync
- Restart dev server

---

## 📞 SUPPORT & DOCUMENTATION

### File Reference
- **README.md** - Main project documentation
- **IMPLEMENTATION_VERIFICATION.md** - Feature checklist (this doc)
- **WORKFLOW_UPDATE_SUMMARY.md** - Detailed status
- **DELIVERY_SUMMARY.md** - What was delivered
- **COMMIT_LOG.md** - Code changes documentation

### Firebase Documentation
- https://firebase.google.com/docs
- https://firebase.google.com/docs/firestore
- https://firebase.google.com/docs/auth

### Next.js Documentation
- https://nextjs.org/docs
- https://nextjs.org/docs/deployment

---

## ✅ FINAL CHECKLIST

Before going live:
- [ ] All 5 user roles tested
- [ ] Login credentials verified
- [ ] Real-time updates working (5s refresh)
- [ ] Firestore data persisting
- [ ] No TypeScript errors
- [ ] Code committed to GitHub
- [ ] Production build successful
- [ ] Firebase hosting deployed
- [ ] Environment variables configured
- [ ] Custom claims assigned to all users
- [ ] Sample data created in Firestore

---

**Status**: ✅ Ready for Production

**Setup Time**: ~15-20 minutes

**Support**: Reference documentation files in repository

**Last Updated**: 21 April 2026

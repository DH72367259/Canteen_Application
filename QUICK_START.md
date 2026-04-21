# Quick Start: Firebase Setup

**Time required**: 20-30 minutes to complete all steps

**Your Firebase Project**: `canteen-dashboard-cfeb9`

---

## 📋 Checklist (Quick Version)

### Step 1: Firebase Console (10-15 min)
- [ ] Login to [Firebase Console](https://console.firebase.google.com/u/0/project/canteen-dashboard-cfeb9/overview)
- [ ] Go to **Authentication** → **Sign-in method**
  - [ ] Enable Email/Password
  - [ ] Enable Anonymous
- [ ] Go to **Firestore Database**
  - [ ] Click Create Database
  - [ ] Choose your region
  - [ ] Start in test mode
- [ ] Go to **Firestore Rules** tab
  - [ ] Paste rules from [FIREBASE_CONSOLE_SETUP.md](./FIREBASE_CONSOLE_SETUP.md#step-3-deploy-firestore-security-rules)
  - [ ] Click Publish
- [ ] Get your **Firebase config**:
  - [ ] Settings ⚙️ → Project Settings
  - [ ] Scroll to "Your apps"
  - [ ] Click Web app → Copy JSON config
- [ ] Download **serviceAccountKey.json**:
  - [ ] Settings ⚙️ → Service Accounts
  - [ ] Click "Generate new private key"
  - [ ] Save to project root

### Step 2: Local Setup (5 min)
```bash
# Create environment file
cp .env.example .env.local

# Move admin key to project
mv ~/Downloads/*.json ./serviceAccountKey.json
```

Then edit `.env.local` and fill:
- 6 values from Firebase config (NEXT_PUBLIC_FIREBASE_*)
- 3 values from serviceAccountKey.json (FIREBASE_*)
- Admin emails (ADMIN_EMAILS=...)

### Step 3: Verify Setup (2 min)
```bash
node scripts/verify-firebase-setup.js
```

Expected: ✅ Firebase setup looks good!

### Step 4: Test Locally (3 min)
```bash
npm run dev
```

Then:
- [ ] Open http://localhost:3000/login
- [ ] Select a role (e.g., "Customer")
- [ ] Create users in Firebase Console → Authentication → Add User
  - Email: `customer@example.com`, Password: `password123`
- [ ] Login and verify redirect to dashboard

---

## 🚀 Done!

You're ready to:
- Develop features locally against Firebase
- Deploy to Firebase Hosting when ready
- See [FIREBASE_SETUP_SUMMARY.md](./FIREBASE_SETUP_SUMMARY.md) for next steps

---

## 📚 Need More Details?

| If you need... | Read this |
|---|---|
| Step-by-step Firebase Console guide | [FIREBASE_CONSOLE_SETUP.md](./FIREBASE_CONSOLE_SETUP.md) |
| How to configure `.env.local` | [SETUP_ENV.md](./SETUP_ENV.md) |
| Full checklist with explanations | [SETUP_CHECKLIST.md](./SETUP_CHECKLIST.md) |
| Architecture & next steps | [FIREBASE_SETUP_SUMMARY.md](./FIREBASE_SETUP_SUMMARY.md) |
| Production deployment | [DEPLOYMENT.md](./DEPLOYMENT.md) |

---

## ⚡ Troubleshooting

**Verification script fails?**
- Make sure all values in `.env.local` are filled
- Check serviceAccountKey.json is in project root
- Restart shell: `source ~/.zshrc`

**Login doesn't work?**
- Create test user in Firebase Console → Authentication
- Restart dev server: `npm run dev`
- Check browser console (F12) for errors

**Can't find Firebase config?**
- Make sure you're in correct Firebase project: canteen-dashboard-cfeb9
- Settings → Project Settings → Your apps → Web app

For more help, see [SETUP_ENV.md#troubleshooting](./SETUP_ENV.md#troubleshooting)

---

**Next**: [SETUP_CHECKLIST.md](./SETUP_CHECKLIST.md) has the detailed checklist with all steps explained.

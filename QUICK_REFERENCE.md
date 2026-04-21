# Firebase Setup Quick Reference Card

**Print this page or save as bookmark for quick access**

---

## 🚀 Single Page Summary

Your Firebase project is: **`canteen-dashboard-cfeb9`**

### 3-Step Setup
```bash
# 1. Fill Firebase config values in .env.local
cp .env.example .env.local
# Edit with: API key, auth domain, project ID, etc.

# 2. Download and place admin credentials
mv ~/Downloads/*.json ./serviceAccountKey.json

# 3. Verify everything works
node scripts/verify-firebase-setup.js
```

### 3-Step Testing
```bash
# 1. Start development server
npm run dev

# 2. Open login page
# Visit: http://localhost:3000/login

# 3. Test with different roles
# Select role → Create user in Firebase Console → Login
```

---

## 📋 Configuration Values Needed

### From Firebase Console → Settings → Project Settings → Web app
```
NEXT_PUBLIC_FIREBASE_API_KEY = [apiKey]
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN = [authDomain]
NEXT_PUBLIC_FIREBASE_PROJECT_ID = [projectId]
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET = [storageBucket]
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID = [messagingSenderId]
NEXT_PUBLIC_FIREBASE_APP_ID = [appId]
```

### From serviceAccountKey.json
```
FIREBASE_PROJECT_ID = "project_id"
FIREBASE_CLIENT_EMAIL = "client_email"
FIREBASE_PRIVATE_KEY = "private_key" (with \n chars)
```

### Admin Access
```
ADMIN_EMAILS = canteen-admin@example.com,super-admin@example.com
```

---

## 🔗 Important Links

| Resource | Link |
|----------|------|
| **Firebase Console** | https://console.firebase.google.com/u/0/project/canteen-dashboard-cfeb9/overview |
| **Authentication Setup** | https://console.firebase.google.com/u/0/project/canteen-dashboard-cfeb9/authentication/providers |
| **Firestore Database** | https://console.firebase.google.com/u/0/project/canteen-dashboard-cfeb9/firestore |
| **Security Rules** | https://console.firebase.google.com/u/0/project/canteen-dashboard-cfeb9/firestore/rules |

---

## ⚙️ Firebase Console Setup (Copy-Paste Checklist)

### Step 1: Enable Auth Methods
[ ] Authentication → Sign-in method
  - [ ] Email/Password: **Enable**
  - [ ] Anonymous: **Enable**

### Step 2: Create Firestore
[ ] Firestore Database → Create Database
  - [ ] Region: *Select closest to users*
  - [ ] Mode: **Test mode**
  - [ ] Wait 2-3 minutes for creation

### Step 3: Deploy Rules
[ ] Firestore → Rules tab
  - [ ] Replace all content with rules from FIREBASE_CONSOLE_SETUP.md
  - [ ] Click **Publish**

### Step 4: Get Config
[ ] Settings ⚙️ → Project Settings
  - [ ] Scroll to "Your apps" section
  - [ ] Click Web app
  - [ ] Copy firebaseConfig object

### Step 5: Download Admin Key
[ ] Settings ⚙️ → Service Accounts
  - [ ] Click "Generate new private key"
  - [ ] Save as: `serviceAccountKey.json`

---

## 👥 5 Roles at a Glance

| Role | Email Pattern | Dashboard | Use Case |
|------|---|---|---|
| 🛒 Customer | any@example.com | /dashboard | Browse & order |
| 🏪 Admin | canteen-admin@* | /admin/dashboard | Manage orders |
| 🍕 Vendor | vendor@example.com | /vendor/dashboard | Manage menu |
| 👷 Worker | worker@example.com | /worker/dashboard | Track orders |
| 🔐 Super Admin | super-admin@* | /system/dashboard | Platform mgmt |

---

## ⚠️ Common Issues & Fixes

| Problem | Fix |
|---------|-----|
| ❌ `.env.local` not found | `cp .env.example .env.local` |
| ❌ Verification fails | Fill all NEXT_PUBLIC_* and FIREBASE_* in `.env.local` |
| ❌ Login fails | Create user in Firebase Console → Authentication |
| ❌ Permission denied | Deploy Firestore rules (Step 3 above) |
| ❌ Can't find Firebase config | Make sure you're in right project: canteen-dashboard-cfeb9 |

---

## Documentation Quick Map

```
Start here ──→ Choose one path:

┌─ 30 min? ─────→ QUICK_START.md
├─ 1-2 hours? ──→ SETUP_CHECKLIST.md
├─ Understand? ─→ FIREBASE_SETUP_SUMMARY.md
├─ Confused? ───→ SETUP_ENV.md (troubleshooting)
└─ Deploy? ─────→ DEPLOYMENT.md
```

---

## ✅ Success Checklist

When you see this, you're done ✅:

```
✅ node scripts/verify-firebase-setup.js returns: "Firebase setup looks good!"
✅ npm run dev starts without errors
✅ http://localhost:3000/login loads
✅ Can see all 5 roles in dropdown
✅ Can create user and login
✅ Redirected to correct dashboard
✅ No errors in browser console (F12)
```

---

## 🔐 Security Reminders

✅ Do this:
- [x] Add `.env.local` to `.gitignore` ✓ (already done)
- [x] Add `serviceAccountKey.json` to `.gitignore` ✓ (already done)
- [x] Never commit `.env.local` to git
- [x] Never share `serviceAccountKey.json`

❌ Don't do this:
- [ ] Don't hardcode Firebase keys in source
- [ ] Don't paste private key in Slack/email
- [ ] Don't share serviceAccountKey.json with others
- [ ] Don't commit `.env.local` to git

---

## 🎯 Next Steps After Setup

Once verification passes ✅:

1. **Start development**: `npm run dev`
2. **Implement features**: See FIREBASE_SETUP_SUMMARY.md → "What's Ready to Work On Next"
3. **Deploy when ready**: `npm run firebase:deploy:canteen`

---

## 📞 Need Help?

Look in this order:

1. **Can't find something?** → DOCUMENTATION_INDEX.md
2. **Setup stuck?** → SETUP_ENV.md (Troubleshooting section)
3. **Firebase Console lost?** → FIREBASE_CONSOLE_SETUP.md
4. **Want architecture overview?** → FIREBASE_SETUP_SUMMARY.md
5. **Ready to deploy?** → DEPLOYMENT.md

---

## ⏱️ Typical Timeline

| Task | Time | Command |
|------|------|---------|
| Firebase Console setup | 10-15 min | Manual in console |
| Local .env.local setup | 5 min | `cp .env.example .env.local` + edit |
| Verification | 1-2 min | `node scripts/verify-firebase-setup.js` |
| Test locally | 5 min | `npm run dev` |
| **Total** | **20-30 min** | — |

---

## 💡 Pro Tips

- **Faster verification**: Run `node scripts/verify-firebase-setup.js` to avoid manual checking
- **Faster testing**: Create test users all at once in Firebase Console
- **Faster editing**: Use VS Code find-replace to update `.env.local` values
- **Faster deployment**: Have `npm run firebase:deploy:canteen` ready for when you're done

---

**Status**: ✅ Firebase infrastructure ready  
**Your action**: Start with your chosen path from DOCUMENTATION_INDEX.md  
**Time invested so far**: 0 min (this is just setup documentation)  
**Time remaining**: ~30 min (to complete setup)

Good luck! 🚀

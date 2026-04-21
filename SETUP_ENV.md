# Environment Variables Setup Guide

Complete instructions for configuring `.env.local` with your Firebase project credentials.

## Overview

Your Next.js app needs two sets of Firebase credentials:
1. **Client SDK config** - Public variables (safe to expose, prefixed with `NEXT_PUBLIC_`)
2. **Admin SDK config** - Secret credentials (server-only, never expose)

## Step 1: Get Firebase Client Config

### From Firebase Console
1. Go to [Firebase Console](https://console.firebase.google.com/u/0/project/canteen-dashboard-cfeb9/overview)
2. Click the **Settings** ⚙️ icon (top left) → **Project Settings**
3. Scroll down to **Your apps** section
4. Click the **Web** app (or add one if missing)
5. Under **Firebase SDK snippet**, select **Config**
6. You'll see a `firebaseConfig` object like this:

```javascript
const firebaseConfig = {
  apiKey: "AIzaSyD1234567890abcdefghijk",
  authDomain: "canteen-dashboard-cfeb9.firebaseapp.com",
  projectId: "canteen-dashboard-cfeb9",
  storageBucket: "canteen-dashboard-cfeb9.appspot.com",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abc123def456ghi789"
};
```

## Step 2: Get Firebase Admin SDK Credentials

### Download Service Account Key
1. In Firebase Console → **Settings** ⚙️ → **Service Accounts** tab
2. Under **Firebase Admin SDK**, click **Generate new private key**
3. A JSON file downloads (e.g., `canteen-dashboard-cfeb9-123456.json`)
4. **IMPORTANT**: Keep this file SECRET - never commit to git

### Save Service Account Key
1. Move/rename the downloaded file to your project:
   ```bash
   mv ~/Downloads/canteen-dashboard-cfeb9-*.json ~/Canteen/serviceAccountKey.json
   ```
2. Verify it's in your project root with this structure:
   ```
   Canteen/
   ├── serviceAccountKey.json  ← Add this file
   ├── .env.local              ← Create/update this
   ├── .env.example
   ├── package.json
   └── ...
   ```

## Step 3: Create `.env.local` File

### Create the file
If `.env.local` doesn't exist, create it in your project root:
```bash
touch .env.local
```

### Add Client SDK Variables
Copy from your Firebase config and populate:

```bash
# Firebase client SDK config (from firebaseConfig object)
NEXT_PUBLIC_FIREBASE_API_KEY=YOUR_API_KEY_HERE
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=canteen-dashboard-cfeb9.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=canteen-dashboard-cfeb9
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=canteen-dashboard-cfeb9.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=YOUR_SENDER_ID_HERE
NEXT_PUBLIC_FIREBASE_APP_ID=YOUR_APP_ID_HERE
```

### Add Admin SDK Variables
From your `serviceAccountKey.json` file, extract these fields:

```bash
# Firebase Admin SDK config (from serviceAccountKey.json)
FIREBASE_PROJECT_ID=canteen-dashboard-cfeb9
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-abc123@canteen-dashboard-cfeb9.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC...\n-----END PRIVATE KEY-----\n"
```

**Where to find these in `serviceAccountKey.json`**:
- `FIREBASE_PROJECT_ID` = `"project_id"` field
- `FIREBASE_CLIENT_EMAIL` = `"client_email"` field
- `FIREBASE_PRIVATE_KEY` = `"private_key"` field (includes quotes and newlines)

### Add Admin Emails
```bash
# Comma-separated admin emails for server-side role checks
ADMIN_EMAILS=canteen-admin@example.com,super-admin@example.com
```

## Complete `.env.local` Example

Here's what your final `.env.local` should look like:

```bash
# Firebase client SDK config
NEXT_PUBLIC_FIREBASE_API_KEY=AIzaSyD1234567890abcdefghijk
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=canteen-dashboard-cfeb9.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=canteen-dashboard-cfeb9
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=canteen-dashboard-cfeb9.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=123456789012
NEXT_PUBLIC_FIREBASE_APP_ID=1:123456789012:web:abc123def456ghi789

# Firebase Admin SDK config
FIREBASE_PROJECT_ID=canteen-dashboard-cfeb9
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-abc123@canteen-dashboard-cfeb9.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC...\n-----END PRIVATE KEY-----\n"

# Admin emails
ADMIN_EMAILS=canteen-admin@example.com,super-admin@example.com
```

## Step 4: Verify `.env.local` is in `.gitignore`

```bash
cat .gitignore | grep env.local
```

You should see `.env.local` listed. If not, add it:

```bash
echo ".env.local" >> .gitignore
```

## Step 5: Test the Setup

### Restart Development Server
```bash
npm run dev
```

### Check Initialization
Open browser DevTools (F12 → Console) and you should see:
```
✅ Firebase initialized
✅ Firestore connected
```

If you see errors:
```
❌ Firebase config is missing or incomplete
❌ Cannot read property 'apiKey' of undefined
❌ Error: Failed to get document from cache. (...)
```

See **Troubleshooting** below.

### Test Firebase Auth
1. Navigate to `http://localhost:3000/login`
2. Select a role from dropdown (e.g., "Customer")
3. Try signing in:
   - **Email**: `customer@example.com`
   - **Password**: `password123`

Expected:
- ✅ Login succeeds (or shows auth error if user doesn't exist)
- ✅ Browser redirects to `/dashboard`
- ✅ Console shows user role and UID

### Test Firestore Access
After login, check browser console:
```javascript
// You should be able to see in dev tools Network tab:
// - Requests to firebaseio.com (Firestore)
// - Firestore data loading successfully
```

## Step 6: Add Test Users

### Option A: Firebase Console UI
1. Go to [Firebase Auth Users](https://console.firebase.google.com/u/0/project/canteen-dashboard-cfeb9/authentication/users)
2. Click **Add User** button
3. Enter email: `canteen-admin@example.com`
4. Enter password: `admin123`
5. Click **Add user**

Repeat for other roles:
- `customer@example.com`
- `vendor@example.com`
- `worker@example.com`
- `super-admin@example.com`

### Option B: Firebase CLI (Advanced)
If you've installed Firebase CLI:

```bash
# Create user
firebase auth:import users.json --hash-algo=scrypt

# OR manually with CLI
firebase auth:set-custom-claims canteen-admin@example.com --claims='{"role":"canteen-admin"}'
```

## Troubleshooting

### Error: "Firebase config is missing"
**Cause**: `NEXT_PUBLIC_FIREBASE_*` variables not set in `.env.local`
**Fix**: Complete Step 3, then restart dev server with `npm run dev`

### Error: "Cannot find serviceAccountKey.json"
**Cause**: Admin SDK initialization can't find credentials file
**Fix**: Ensure `serviceAccountKey.json` is in project root (Step 2)

### Error: "Permission denied" on Firestore read
**Cause**: Security rules didn't deploy or custom claims not set on user
**Fix**: 
1. Check Firestore Rules tab in Console (Step 3 of FIREBASE_CONSOLE_SETUP.md)
2. Set custom claims on test users (Step 6 above)

### Error: "NEXT_PUBLIC_FIREBASE_API_KEY is invalid"
**Cause**: Copied wrong value or extra spaces
**Fix**: Copy exact value from Firebase Console, remove quotes and spaces

### App starts but can't login
**Cause**: Test users haven't been created in Firebase Auth
**Fix**: Complete Step 6 to add test users

### Env variables load but still getting errors
**Solution**: 
1. Stop dev server (`Ctrl+C`)
2. Delete `.next` folder: `rm -rf .next`
3. Restart: `npm run dev`

---

## Next Steps

After environment setup is complete:

1. **Test login flow** - Try each role (customer, admin, vendor, worker, super-admin)
2. **Verify dashboards** - Each role should redirect to their dashboard
3. **Check Firestore connection** - Orders and data should be accessible
4. **Deploy to Firebase Hosting** - See DEPLOYMENT.md for hosting setup

---

## Quick Reference

| File | Purpose | When to update |
|------|---------|-----------------|
| `.env.local` | Development secrets | When Firebase credentials change |
| `serviceAccountKey.json` | Admin SDK credentials | Should remain stable after download |
| `.env.example` | Template for new devs | When adding new env variables |
| `.gitignore` | Prevent secret leaks | Already includes `.env.local` |

**Important Security Notes**:
- ✅ `.env.local` is in `.gitignore` - secrets won't be committed
- ✅ `serviceAccountKey.json` is in `.gitignore` - admin key stays private
- ⚠️ `NEXT_PUBLIC_*` variables ARE public (safe to expose)
- ⚠️ Never share `FIREBASE_PRIVATE_KEY` or `serviceAccountKey.json`

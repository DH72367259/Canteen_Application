# 🚀 Deploy Working Canteen Application to Cloud

Your application is currently showing a "Deploying" status page. To get the **working application** live on the cloud, follow these steps:

## Step 1: Get Firebase Credentials

1. Go to: https://console.firebase.google.com/project/canteen-dashboard-cfeb9/settings/general
2. Under **Your apps** → Click **Web** app
3. Copy the Firebase config:
   ```json
   {
     "apiKey": "YOUR_API_KEY",
     "authDomain": "canteen-dashboard-cfeb9.firebaseapp.com",
     "projectId": "canteen-dashboard-cfeb9",
     "storageBucket": "canteen-dashboard-cfeb9.appspot.com",
     "messagingSenderId": "YOUR_SENDER_ID",
     "appId": "YOUR_APP_ID"
   }
   ```

## Step 2: Create .env.local File

Create a file named `.env.local` in `/Users/kuhelijoardar/Canteen/` with:

```
NEXT_PUBLIC_FIREBASE_API_KEY=YOUR_API_KEY
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=canteen-dashboard-cfeb9.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=canteen-dashboard-cfeb9
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=canteen-dashboard-cfeb9.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=YOUR_SENDER_ID
NEXT_PUBLIC_FIREBASE_APP_ID=YOUR_APP_ID
```

## Step 3: Build and Deploy

```bash
cd /Users/kuhelijoardar/Canteen

# 1. Build the app
npm run build

# 2. Deploy to Firebase
firebase deploy --only hosting:canteenApp
```

## Step 4: Access Your Live App

After deployment completes, visit:
**https://canteen-dashboard-cfeb9.web.app**

Login with:
- Email: user@test.com
- Password: Test@123456

---

## Deployment Troubleshooting

**"Failed to authenticate, have you run firebase login?"**
```bash
firebase login
# Then try deploy again
```

**"Firebase config missing"**
- Make sure .env.local exists in project root
- Run `npm run build` again
- Deploy with `firebase deploy --only hosting:canteenApp`

---

## Current Status

- ✅ Cloud hosting configured (Firebase)
- ✅ Domain ready: https://canteen-dashboard-cfeb9.web.app
- ❌ Credentials not set (.env.local missing)
- ❌ Full app not deployed yet

**Action needed**: Add Firebase credentials and redeploy.

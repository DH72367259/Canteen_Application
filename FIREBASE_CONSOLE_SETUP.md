# Firebase Console Setup Guide

Complete step-by-step instructions for configuring your Firebase project: `canteen-dashboard-cfeb9`

## Step 1: Enable Authentication Methods

### Navigate to Authentication
1. Go to [Firebase Console](https://console.firebase.google.com/u/0/project/canteen-dashboard-cfeb9/overview)
2. Click **Build** in the left sidebar
3. Select **Authentication**
4. Click the **Sign-in method** tab

### Enable Sign-in Providers

#### 1. Email/Password
- Click **Email/Password** provider
- Toggle **Enable** to ON
- Leave "Password account sign-up" enabled (allows user registration)
- Click **Save**

#### 2. Anonymous
- Click **Anonymous** provider
- Toggle **Enable** to ON
- Click **Save**
- *Note: This allows customers to login without email (for quick orders)*

#### 3. Google (Optional but Recommended)
- Click **Google** provider
- Toggle **Enable** to ON
- A popup will ask for a Project Support Email - use any Firebase-generated email
- Click **Save**

### Verify Enabled Providers
You should now see at least these enabled:
- ✅ Email/Password
- ✅ Anonymous

**Result**: Authentication methods are now configured and ready for use.

---

## Step 2: Create Firestore Database

### Navigate to Firestore
1. In Firebase Console, click **Build** → **Firestore Database**
2. Click **Create Database**

### Configure Database Settings
- **Location**: Choose region closest to your users (e.g., `us-central1` for US, `asia-south1` for India)
- **Security Rules**: Select **Start in test mode** for now
  - ⚠️ **Important**: We'll strengthen rules in Step 3
- Click **Create**

**Wait** ~2-3 minutes for database initialization to complete.

### Verify Database Created
You should see a Firestore console with an empty database ready for collections.

---

## Step 3: Deploy Firestore Security Rules

### Open Firestore Rules Editor
1. In Firestore Database view, click the **Rules** tab
2. You'll see the current test rules

### Replace with Production Rules
Copy and paste the following security rules:

```firestore
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Helper functions
    function isAuthenticated() {
      return request.auth != null;
    }
    
    function isAdmin(docData) {
      return request.auth.token.role in ['canteen-admin', 'super-admin'];
    }
    
    function isSuperAdmin() {
      return request.auth.token.role == 'super-admin';
    }
    
    function isVendor(vendorId) {
      return request.auth.uid == vendorId || request.auth.token.role == 'super-admin';
    }
    
    function isWorker() {
      return request.auth.token.role == 'worker';
    }
    
    function ownsOrder(order) {
      return request.auth.uid == order.customerId || isAdmin(order);
    }

    // Canteens collection - Super admin only
    match /canteens/{canteenId} {
      allow read: if isSuperAdmin();
      allow write: if isSuperAdmin();
      
      // Subordinate collections
      match /vendors/{vendorId} {
        allow read: if isSuperAdmin();
        allow write: if isSuperAdmin();
      }
      
      match /timeSlots/{slotId} {
        allow read: if isAuthenticated();
        allow write: if isAdmin(null);
      }
      
      match /orders/{orderId} {
        allow read: if isAuthenticated();
        allow write: if isAdmin(null);
        
        match /items/{itemId} {
          allow read: if isAuthenticated();
          allow write: if isAdmin(null);
        }
      }
      
      match /bins/{binId} {
        allow read: if isAuthenticated();
        allow write: if isWorker() || isAdmin(null);
      }
      
      match /wasteReports/{reportId} {
        allow read: if isWorker() || isAdmin(null);
        allow write: if isWorker() || isAdmin(null);
      }
    }
    
    // Users collection
    match /users/{userId} {
      allow read: if isAuthenticated() && (request.auth.uid == userId || isSuperAdmin());
      allow write: if isSuperAdmin();
      
      match /rewards/{rewardId} {
        allow read: if isAuthenticated() && request.auth.uid == userId;
        allow write: if isSuperAdmin();
      }
    }
    
    // Platform analytics - Super admin only
    match /platformAnalytics/{doc=**} {
      allow read: if isSuperAdmin();
      allow write: if isSuperAdmin();
    }
    
    // Settlements - Super admin only
    match /settlements/{doc=**} {
      allow read: if isSuperAdmin();
      allow write: if isSuperAdmin();
    }
    
    // Deny all other access
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

### Deploy Rules
1. Click **Publish** button (top right)
2. Confirm the deployment
3. Wait for confirmation message: "Rules deployed successfully"

**Important**: These rules use Firebase custom claims (set on your backend). Once deployed, they'll restrict data access by role.

---

## Step 4: Set Up Admin User (Firebase CLI)

You'll need the Firebase CLI to create users with custom claims. Instructions for this are in [DEPLOYMENT.md](./DEPLOYMENT.md#create-admin-users).

---

## Step 5: Initialize Collections (Optional Data)

### Create Sample Collections Manually (Optional)
You can create initial documents for testing:

1. **canteens** collection
   - Document ID: `canteen-001`
   - Data:
     ```json
     {
       "name": "Main Canteen",
       "location": "Building A",
       "openingTime": "08:00",
       "closingTime": "18:00",
       "created": 1640000000000
     }
     ```

2. **vendors** subcollection under canteens/canteen-001
   - Document ID: `vendor-001`
   - Data:
     ```json
     {
       "name": "Fresh Foods Co.",
       "email": "vendor@example.com",
       "rating": 4.5,
       "active": true
     }
     ```

### OR Use Admin SDK Script
We can create an initialization script to populate collections. This is covered in DEPLOYMENT.md.

---

## Step 6: Get Firebase Config

### Locate Your Firebase Config
1. In Firebase Console, click the **Settings** gear icon (top left)
2. Select **Project Settings**
3. Scroll down to **Your apps** section
4. Click the **Web** platform or add one if not present
5. Copy the `firebaseConfig` object

### Example Firebase Config
```javascript
const firebaseConfig = {
  apiKey: "AIzaSyD...",
  authDomain: "canteen-dashboard-cfeb9.firebaseapp.com",
  projectId: "canteen-dashboard-cfeb9",
  storageBucket: "canteen-dashboard-cfeb9.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123..."
};
```

**Keep this safe** - we'll use it in Step 7.

---

## Step 7: Update Environment Variables

### Update `.env.local`
Add or update these environment variables in your `.env.local` file:

```bash
# Firebase Client Config
NEXT_PUBLIC_FIREBASE_API_KEY=your_api_key_here
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=canteen-dashboard-cfeb9.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=canteen-dashboard-cfeb9
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=canteen-dashboard-cfeb9.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_sender_id_here
NEXT_PUBLIC_FIREBASE_APP_ID=your_app_id_here

# Firebase Admin Config (Server-side only)
FIREBASE_ADMIN_SDK_KEY=path/to/serviceAccountKey.json
```

**Where to get the Admin SDK Key**:
1. In Firebase Console, go to **Settings** → **Service Accounts**
2. Click **Generate New Private Key**
3. Save the JSON file as `/Users/kuhelijoardar/Canteen/serviceAccountKey.json`
4. **Set in `.env.local`**: `FIREBASE_ADMIN_SDK_KEY=serviceAccountKey.json`

---

## Step 8: Verify Setup in Application

### Start Development Server
```bash
npm run dev
```

### Test Firebase Connection
1. Navigate to `http://localhost:3000`
2. Go to `/login`
3. Try logging in with:
   - **Email**: `customer@example.com`
   - **Password**: `password123`
   
   OR use Anonymous Sign-in

### Check Browser Console
If logging in works:
```
✅ Firebase initialized
✅ User authenticated
✅ Role: customer
✅ Dashboard redirect: /dashboard
```

If there are errors:
```
❌ Firebase config missing
❌ Invalid credentials
❌ Database rules denied access
```

---

## Step 9: Create Test Users

### Option A: Firebase Console UI
1. In Firebase Console → **Authentication** → **Users** tab
2. Click **Add User**
3. Email: `canteen-admin@example.com`
4. Password: `admin123`
5. Click **Add user**

### Option B: Firebase CLI (Recommended)
To set custom claims and roles, use Firebase CLI:

```bash
npm install -g firebase-tools
firebase login
firebase auth:import users.json --hash-algo=scrypt
```

See DEPLOYMENT.md for complete user creation script.

---

## Troubleshooting

### Database Not Showing Data After Login
- **Cause**: Firestore security rules too restrictive
- **Fix**: Check Rules tab, ensure test mode allows reads/writes, or check custom claims are set
- **Verify**: Go to Firestore → Data tab, you should see a `canteens` collection after data is created

### Authentication Not Working
- **Cause**: Firebase config not loaded or incorrect
- **Fix**: Check `.env.local` variables, restart dev server with `npm run dev`
- **Verify**: Open browser DevTools → Console, check for Firebase initialization message

### Rules Deployment Failed
- **Cause**: Syntax error in rules
- **Fix**: Check the error message, copy exact rules from Step 3
- **Verify**: Click **Publish** again

### Users Can't Access Their Data
- **Cause**: Custom claims not set on user records
- **Fix**: Set role via Firebase Admin SDK (see DEPLOYMENT.md) or use test mode temporarily
- **Verify**: Go to Firebase Console → Authentication → Click user → Custom claims section

---

## Next Steps

1. **Deploy to Firebase Hosting** (see DEPLOYMENT.md)
2. **Create production data** using admin scripts
3. **Monitor usage** in Firebase Console → Usage dashboard
4. **Set up backups** if needed (Firestore → Schedules)

---

## Quick Reference Links

- [Firebase Console](https://console.firebase.google.com/u/0/project/canteen-dashboard-cfeb9/overview)
- [Authentication Methods](https://console.firebase.google.com/u/0/project/canteen-dashboard-cfeb9/authentication/providers)
- [Firestore Database](https://console.firebase.google.com/u/0/project/canteen-dashboard-cfeb9/firestore)
- [Security Rules](https://console.firebase.google.com/u/0/project/canteen-dashboard-cfeb9/firestore/rules)
- [Project Settings](https://console.firebase.google.com/u/0/project/canteen-dashboard-cfeb9/settings/general)

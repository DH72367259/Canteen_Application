# NoQx Canteen Platform - Deployment Guide

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ installed
- npm or yarn
- Firebase project (free tier supported)
- GitHub/Git (optional, for version control)

### Step 1: Firebase Setup

1. **Create Firebase Project**
   - Go to [Firebase Console](https://console.firebase.google.com)
   - Click "Add project"
   - Name it (e.g., "noqx-canteen-isolated")
   - Enable Google Analytics (optional)
   - Click "Create project"

2. **Enable Authentication**
   - Go to Authentication → Sign-in methods
   - Enable "Anonymous"
   - Enable "Email/Password"
   - Save

3. **Enable Firestore**
   - Go to Firestore Database
   - Click "Create database"
   -Start in **Production mode** (we'll update rules)
   - Select your preferred region (recommend `asia-south1` for India)
   - Click "Enable"

4. **Get Project Credentials**
   - Go to Project Settings (⚙️ icon)
   - Under "General" tab, copy:
     - Project ID
     - Web API Key
   - Go to "Service Accounts" tab
   - Click "Generate New Private Key"
   - Save the JSON file securely

5. **Optional: Enable Hosting**
   - Go to Hosting
   - Click "Get Started"
   - Follow instructions (or skip - deployment handles this)

### Step 2: Environment Configuration

1. **Create `.env.local` file**
   ```bash
   cp .env.example .env.local
   ```

2. **Fill in environment variables**
   ```
   FIREBASE_PROJECT_ID=your-project-id
   FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project-id.iam.gserviceaccount.com
   FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n....\n-----END PRIVATE KEY-----\n"

   NEXT_PUBLIC_FIREBASE_API_KEY=your-web-api-key
   NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project-id.firebaseapp.com
   NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project-id
   NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your-project-id.appspot.com
   NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=xxxxx
   NEXT_PUBLIC_FIREBASE_APP_ID=1:xxxxx:web:xxxxx

   ADMIN_EMAILS=admin@domain.com,super-admin@domain.com,canteen-admin@example.com
   ```

3. **Update `.firebaserc`**
   ```json
   {
     "projects": {
       "canteen-isolated": "your-project-id"
     },
     "targets": {
       "your-project-id": {
         "hosting": {
           "canteenApp": ["canteen-app-site-id"]
         }
       }
     }
   }
   ```

### Step 3: Deploy Firestore Rules

1. **Create admin user**
   ```bash
   npx ts-node scripts/create-admin-user.mjs
   # Enter email and password when prompted
   ```

2. **Deploy security rules**
   ```bash
   firebase deploy --only firestore:rules --project canteen-isolated
   ```

### Step 4: Deploy Application

1. **Install Firebase CLI** (if not already installed)
   ```bash
   npm install -g firebase-tools
   ```

2. **Authenticate Firebase CLI**
   ```bash
   firebase login
   ```

3. **Build the application**
   ```bash
   npm run build
   ```

4. **Deploy to Firebase Hosting**
   ```bash
   npm run firebase:deploy
   ```

5. **Get your production URL**
   ```
   After deployment, your app is live at:
   https://your-project-id.web.app
   ```

## 🌐 Production URLs

After deployment, access your app with these URLs:

### Customer Access
- **Main Site**: `https://your-project-id.web.app`
- **Login**: `https://your-project-id.web.app/login`
- **Customer Dashboard**: `https://your-project-id.web.app/dashboard`

### Admin Access
- **Canteen Admin Dashboard**: `https://your-project-id.web.app/admin/dashboard`
- **Super Admin Dashboard**: `https://your-project-id.web.app/system/dashboard`
- **Vendor Dashboard**: `https://your-project-id.web.app/vendor/dashboard`
- **Worker Dashboard**: `https://your-project-id.web.app/worker/dashboard`

## 🔐 Creating Users

### Customer (Anonymous)
- No account needed - click "Continue as Customer" on login page
- Can place orders and track rewards

### Canteen Admin
1. Go to Firebase Console → Authentication
2. Click "Add user"
3. Create account with email: `canteen-admin@yourdomain.com`
4. Set password
5. User automatically gets canteen-admin role based on email prefix

### Super Admin (Platform Admin)
1. Create account with email: `super-admin@yourdomain.com`
2. Automatically gets super-admin role

### Vendor
1. Create account with email: `vendor@yourdomain.com`
2. Automatically gets vendor role

### Worker
1. Create account with email: `worker@yourdomain.com`
2. Automatically gets worker role

## 📊 First-Time Setup

### 1. Create a Canteen
- Login as super-admin
- Go to `/system/dashboard`
- Click "Manage Canteens"
- Add your first canteen
- Copy canteen ID

### 2. Create a Vendor
- Go to `/system/dashboard`
- Click "User Management"
- Add vendor user
- Vendor can now manage menu and pricing

### 3. Add Menu Items
- Login as vendor
- Go to `/vendor/dashboard`
- Click "Manage Menu"
- Add food items with pricing

### 4. Create Time Slots
- Canteen admin login
- Go to `/admin/dashboard`
- Add time slots for ordering

### 5: Test Order Flow
- Logout
- Click "Continue as Customer"
- Go to `/dashboard/order`
- Select items and place order

## 🛠️ Maintenance

### Monitor Performance
```bash
firebase hosting:channel:list --project canteen-isolated
```

### View Logs
```bash
firebase functions:log --project canteen-isolated
```

### Backup Firestore Data
```bash
gcloud firestore export gs://your-backup-bucket/backup-date
```

## 🐛 Troubleshooting

### Firebase Config Missing
- Verify `.env.local` has all `NEXT_PUBLIC_*` variables
- Restart dev server: `npm run dev`

### Authentication Failed
- Check email is in `ADMIN_EMAILS` environment variable
- Verify Firebase Authentication is enabled
- Confirm email/password user exists in Firebase Console

### Orders Not Saving to Firestore
- Check Firestore security rules are deployed
- Verify Firestore Database is created
- Check browser console for specific errors

### Deployment Fails
- Run `firebase login` again
- Verify `.firebaserc` has correct project ID
- Check `firebase.json` is valid JSON
- Ensure you have Firebase Hosting enabled

## 📞 Support

For issues:
1. Check Firebase Console logs
2. View browser console (F12) for JavaScript errors
3. Verify environment variables in `.env.local`
4. Check Next.js build output: `npm run build`

## 🎯 Next Features to Implement

- [ ] Slot-based ordering system
- [ ] OTP verification for pickup
- [ ] Payment gateway integration
- [ ] Waste tracking dashboard
- [ ] Reward redemption system
- [ ] Email notifications
- [ ] SMS alerts
- [ ] Advanced analytics
- [ ] Mobile app

---

**Version**: 1.0.0  
**Last Updated**: 2025-04-21  
**Maintained By**: NoQx Team

# 🚀 Get Started with Canteen

Your Canteen Management Application is ready to run! Just add Firebase credentials.

## ⚡ Quick Setup (5 minutes)

### 1. Get Firebase Configuration

**Option A: Use Existing Firebase Project**
- Go to [Firebase Console - canteen-dashboard-cfeb9](https://console.firebase.google.com/u/0/project/canteen-dashboard-cfeb9/overview)
- Click Settings ⚙️ → Project Settings
- Scroll to **Your apps** → Click **Web** app
- Under **Firebase SDK snippet**, click **Config**
- Copy the `firebaseConfig` object

**Option B: Create New Firebase Web App**
- Same steps above, but click **+ Add app** → Select **Web**
- Fill project name: `Canteen App`
- Register and copy the config

### 2. Create `.env.local` File

In your project root (`/Users/kuhelijoardar/Canteen/`), create `.env.local`:

```bash
# Firebase client SDK config (from firebaseConfig)
NEXT_PUBLIC_FIREBASE_API_KEY=YOUR_API_KEY_HERE
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=canteen-dashboard-cfeb9.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=canteen-dashboard-cfeb9
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=canteen-dashboard-cfeb9.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=YOUR_SENDER_ID_HERE
NEXT_PUBLIC_FIREBASE_APP_ID=YOUR_APP_ID_HERE

# (Optional) Admin SDK credentials for server-side operations
FIREBASE_PROJECT_ID=canteen-dashboard-cfeb9
FIREBASE_CLIENT_EMAIL=your-email@canteen-dashboard-cfeb9.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
ADMIN_EMAILS=admin@example.com
```

**Where to find each value:**

| Variable | Location in Firebase Console |
|----------|------|
| `NEXT_PUBLIC_FIREBASE_API_KEY` | `firebaseConfig.apiKey` |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | `firebaseConfig.authDomain` |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | `firebaseConfig.projectId` |
| `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` | `firebaseConfig.storageBucket` |
| `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | `firebaseConfig.messagingSenderId` |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | `firebaseConfig.appId` |

### 3. Start Development Server

```bash
cd /Users/kuhelijoardar/Canteen
npm run dev
```

Visit: **http://localhost:3000**

## 🔐 Test Login Credentials

Use these credentials to test after Firebase is configured:

| Role | Email | Password |
|------|-------|----------|
| Customer | user@test.com | Test@123456 |
| Vendor | vendor@canteen.com | Vendor@123456 |
| Admin | admin@canteen.com | Admin@123456 |
| Worker | worker@canteen.com | Worker@123456 |
| SuperAdmin | superadmin@canteen.com | SuperAdmin@123456 |

✅ All users can change password after first login.

## 📊 What's Included

✅ Complete Next.js 16 + React 19 + TypeScript app  
✅ 5 user roles with role-based access control  
✅ Real-time order management system  
✅ Waste tracking for workers  
✅ Reward points system  
✅ Responsive design (mobile + desktop)  
✅ Firebase Firestore database  
✅ Firebase Authentication  

## 🐛 Troubleshooting

**"Missing Firebase client config" error?**
- Check `.env.local` has `NEXT_PUBLIC_FIREBASE_*` variables
- Restart dev server: Press `Ctrl+C` then `npm run dev` again
- Make sure `.env.local` is in project root directory

**Can't find Firebase config in console?**
- Go to: https://console.firebase.google.com/u/0/project/canteen-dashboard-cfeb9/overview
- Always select the **Web** app (not Android/iOS)

**Still stuck?**
- See [SETUP_ENV.md](./SETUP_ENV.md) for detailed instructions
- See [QUICK_START.md](./QUICK_START.md) for deployment options

## 🚀 Next Steps

1. ✅ Add Firebase config to `.env.local`
2. ✅ Run `npm run dev`
3. ✅ Test login with provided credentials
4. ✅ Explore the app features
5. ✅ Deploy to [Vercel](https://vercel.com/) for production

## 📚 Project Structure

```
app/              → 20+ Next.js routes (App Router)
components/       → Reusable React components
lib/              → Firebase utilities & services
types/            → TypeScript definitions
public/           → Static assets
```

## 🎯 Key Features by Role

**👤 Customer**
- Pre-order meals from vendors
- Real-time order tracking
- Earn reward points
- Track meal in bins

**🏪 Canteen Admin**
- Manage canteen operations
- View all orders
- Analytics & reports

**👨‍🍳 Vendor**
- Create menu items
- Set time slots
- Track sales
- Manage inventory

**👷 Worker**
- Track waste by bin
- Mark order pickups
- Report issues

**🔐 Super Admin**
- Platform administration
- User management
- System analytics

---

**Ready? Add Firebase credentials and run `npm run dev` now!** 🎉

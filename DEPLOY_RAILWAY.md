# 🚀 Deploy NoQx to Railway (Fresh Project)

## Prerequisites
- Railway account at [railway.app](https://railway.app)
- Git (code pushed to GitHub)

---

## Option A: Deploy via Railway Dashboard (Easiest — No CLI needed)

1. Go to **https://railway.app** → sign in with Google/GitHub
2. Click **"New Project"** → **"Deploy from GitHub repo"**
3. Authorize Railway → select **`Canteen_Application`** repo
4. Railway auto-detects Next.js and deploys
5. Click **"Settings"** → **"Networking"** → **"Generate Domain"**
6. Your app is live at `https://xxxx.up.railway.app` 🎉

> This creates a **fresh, separate project** — nothing linked to weavecart-production or truthful-solace.

---

## Option B: Deploy via Railway CLI

```bash
# 1. Install Railway CLI (if not already installed)
npm install -g @railway/cli

# 2. Login (opens browser)
railway login

# 3. Create a NEW project (separate from all existing ones)
railway init --name noqx-canteen

# 4. Deploy
railway up

# 5. Get your public URL
railway domain
```

---

## Environment Variables (Optional — for Firebase auth)

If you want to add real Firebase auth later, set these in Railway dashboard:
```
NEXT_PUBLIC_FIREBASE_API_KEY=...
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=...
NEXT_PUBLIC_FIREBASE_PROJECT_ID=...
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=...
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=...
NEXT_PUBLIC_FIREBASE_APP_ID=...
```

> **Without these, the app works perfectly with demo accounts** (no environment variables needed).

---

## Demo Login Credentials

| Role | Email | Password |
|------|-------|----------|
| Super Admin | admin@noqx.in | admin123 |
| Vendor / Canteen | vendor@noqx.in | vendor123 |
| Canteen Admin | canteen@noqx.in | canteen123 |
| Student / User | *(any phone + OTP: 1234)* | — |

---

## What's Built

| Page | URL | Role |
|------|-----|------|
| Landing | `/` | Public |
| Login | `/login` | Public |
| User Home | `/dashboard` | User |
| My Orders | `/dashboard/orders` | User |
| Rewards | `/dashboard/rewards` | User |
| Canteen Menu | `/dashboard/menu/[id]` | User |
| Vendor Dashboard | `/vendor/dashboard` | Vendor |
| Super Admin | `/admin/dashboard` | Super Admin |

---

## Architecture

- **Framework**: Next.js 16 + React 19 + TypeScript
- **Styling**: Tailwind CSS v4 + custom NoQx design system
- **Auth**: localStorage-based session (Firebase-optional)
- **Output**: Standalone Node.js server (perfect for Railway/Docker containers)
- **Mobile**: Responsive mobile-first UI with bottom navigation

> For iOS/Android apps, a Flutter app is specified in the product PDF — that requires a separate Flutter project targeting the same API backend.

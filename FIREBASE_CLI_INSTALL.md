# FIREBASE CLI NOT FOUND - SOLUTION

Your Mac doesn't have Firebase CLI installed.

## Option 1: Automatic Installation & Deployment (Recommended)

Copy and paste this command into your Mac Terminal:

```bash
bash ~/Canteen/complete-deploy.sh
```

This automatically:
1. Installs Node.js if needed
2. Installs Firebase CLI
3. Installs project dependencies
4. Builds your app
5. Deploys to Firebase

---

## Option 2: Manual Step-by-Step

If you prefer to do it manually, run these commands one at a time:

### Step 1: Install Firebase CLI
```bash
npm install -g firebase-tools
```

### Step 2: Navigate to project
```bash
cd ~/Canteen
```

### Step 3: Install project dependencies
```bash
npm install
```

### Step 4: Enable webframeworks
```bash
firebase experiments:enable webframeworks --project canteen-dashboard-cfeb9
```

### Step 5: Build the app
```bash
npm run build
```

### Step 6: Deploy to Firebase
```bash
npm run firebase:deploy:canteen:hosting
```

---

## After Any Option Completes

Your app will be live at:
```
https://canteen-dashboard-cfeb9.web.app
```

Test credentials:
- Admin: admin@canteen.com / Admin@123456
- Vendor: vendor@canteen.com / Vendor@123456
- Worker: worker@canteen.com / Worker@123456
- User: user@test.com / Test@123456

---

## Recommended: Use Option 1

It's faster and handles errors automatically. Just run:
```bash
bash ~/Canteen/complete-deploy.sh
```

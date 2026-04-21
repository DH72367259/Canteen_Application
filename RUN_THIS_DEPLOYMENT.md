# 🚀 RUN THIS TO COMMIT & DEPLOY

## Quick Instructions

Your deployment script is ready at:
```
/Users/kuhelijoardar/Canteen/deploy.sh
```

### Step 1: Open Mac Terminal (NOT VS Code)
1. Press `Cmd + Space` 
2. Type `terminal`
3. Press Enter

### Step 2: Run the Deployment Script
```bash
bash /Users/kuhelijoardar/Canteen/deploy.sh
```

That's it! The script will:
✅ Initialize git  
✅ Commit all code to GitHub  
✅ Push to: https://github.com/DH72367259/Canteen_Application  
✅ Deploy to Firebase Hosting  
✅ Show you the final production URL

---

## What You Need

Before running the script, make sure you have:

### 1. GitHub Access
- You should be able to access: https://github.com/DH72367259/Canteen_Application
- Have Git Credential Manager or SSH keys configured

### 2. Firebase CLI Installed
```bash
# Check if firebase is installed
firebase --version

# If not, install it:
npm install -g firebase-tools
```

### 3. .env.local Configured
The file should exist at `/Users/kuhelijoardar/Canteen/.env.local` with Firebase credentials.

---

## When You Run It

You may see:
```
Username for 'https://github.com': <your-github-username>
Password for 'https://github.com': <your-personal-access-token>
```

Use your GitHub credentials or Personal Access Token.

---

## FINAL URL YOU'LL GET

After successful deployment:

### 🌐 Production Application
```
https://canteen-dashboard-cfeb9.web.app
```

### Test Logins
```
User:      user@test.com / Test@123456
Admin:     admin@canteen.com / Admin@123456
Vendor:    vendor@canteen.com / Vendor@123456
Worker:    worker@canteen.com / Worker@123456
SuperAdmin: superadmin@canteen.com / SuperAdmin@123456
```

### GitHub Repo
```
https://github.com/DH72367259/Canteen_Application
```

---

## Troubleshooting

### "command not found: git"
You need to install Git. Run:
```bash
xcode-select --install
```
Then wait for installation to complete (~10 minutes).

### "command not found: npm"
You need Node.js. Download from: https://nodejs.org

### "command not found: firebase"
Install Firebase CLI:
```bash
npm install -g firebase-tools
```

### GitHub Authentication Issues
Create a Personal Access Token:
1. Go to: https://github.com/settings/tokens/new
2. Select `repo` scope
3. Copy token
4. Use as password when prompted

---

## Done!

Once the script completes successfully, you'll have:
✅ Code committed to GitHub  
✅ Application deployed to Firebase  
✅ Production URL ready to use  

**Main URL**: https://canteen-dashboard-cfeb9.web.app

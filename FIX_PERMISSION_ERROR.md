# FIREBASE DEPLOYMENT - PERMISSION ISSUE FIXED

## The Problem
You got a permission error: `EACCES: permission denied`

This is because npm tries to write to `/usr/local/lib/` but doesn't have permission.

## Solution 1: Use Fixed Deployment Script (EASIEST)

Run this on your Mac Terminal:

```bash
bash ~/Canteen/deploy-fixed.sh
```

This script:
- Installs Firebase via Homebrew (no permission issues)
- Enables webframeworks
- Builds your app
- Deploys to Firebase
- All in one command

---

## Solution 2: Manual Fix with sudo

If you prefer to do it step by step:

```bash
# Install Firebase with permission flag
sudo npm install -g firebase-tools --unsafe-perm=true --allow-root

# Or use Homebrew (recommended)
brew install firebase-cli

# Then deploy
cd ~/Canteen
firebase experiments:enable webframeworks --project canteen-dashboard-cfeb9
npm install
npm run build
npm run firebase:deploy:canteen:hosting
```

---

## Solution 3: Fix npm Permissions (Advanced)

```bash
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
export PATH=~/.npm-global/bin:$PATH
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.zshrc
npm install -g firebase-tools
firebase experiments:enable webframeworks --project canteen-dashboard-cfeb9
cd ~/Canteen && npm run build && npm run firebase:deploy:canteen:hosting
```

---

## Recommended: Use Solution 1

```bash
bash ~/Canteen/deploy-fixed.sh
```

Handles everything automatically. Just wait for the success message.

---

## After Deployment

Your app will be at: https://canteen-dashboard-cfeb9.web.app

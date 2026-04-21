# FASTEST PATH TO LIVE DEPLOYMENT

## Run This NOW

Copy and paste into your Mac Terminal:

```bash
bash ~/Canteen/deploy-fixed.sh
```

That's it. One command. Everything handled.

---

## What Happens

1. Installs Firebase (with permission handled)
2. Enables webframeworks
3. Builds your app
4. Deploys to Firebase
5. Done ✅

---

## Wait For This Success Message

```
✅ DEPLOYMENT COMPLETE!

Your app is live at:
🌐 https://canteen-dashboard-cfeb9.web.app
```

Then open that URL in browser.

---

## If That Doesn't Work

Try this alternative:

```bash
brew install firebase-cli
cd ~/Canteen
firebase experiments:enable webframeworks --project canteen-dashboard-cfeb9
npm install
npm run build
npm run firebase:deploy:canteen:hosting
```

---

## That's All

Run one command. App goes live. Done.

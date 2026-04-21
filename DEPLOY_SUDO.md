# DEPLOY NOW - USING SUDO

## Single Command

Copy and paste this into your Mac Terminal:

```bash
bash ~/Canteen/deploy-sudo.sh
```

You'll be prompted for your Mac password (this is normal). Enter it.

Then everything deploys automatically.

---

## Or Do It Manually Step by Step

```bash
# Step 1: Install Firebase (requires password)
sudo npm install -g firebase-tools --unsafe-perm=true --allow-root

# Step 2: Enable webframeworks
cd ~/Canteen
firebase experiments:enable webframeworks --project canteen-dashboard-cfeb9

# Step 3: Install dependencies
npm install

# Step 4: Build app
npm run build

# Step 5: Deploy
npm run firebase:deploy:canteen:hosting
```

---

## Easiest: Just Run

```bash
bash ~/Canteen/deploy-sudo.sh
```

Handles everything. One command.

---

## After Deployment

App will be live at:
```
https://canteen-dashboard-cfeb9.web.app
```

Test with:
- admin@canteen.com / Admin@123456
- user@test.com / Test@123456
- vendor@canteen.com / Vendor@123456
- worker@canteen.com / Worker@123456

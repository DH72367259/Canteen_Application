# GIT COMMANDS - COPY & PASTE

## Terminal Commands to Commit & Deploy

Open Mac Terminal and run these commands in order:

---

### 1. Navigate to Project
```bash
cd /Users/kuhelijoardar/Canteen
```

### 2. Configure Git
```bash
git config --global user.name "Developer"
```

```bash
git config --global user.email "dev@canteen.app"
```

### 3. Initialize Git
```bash
git init
```

### 4. Add Remote
```bash
git remote add origin https://github.com/DH72367259/Canteen_Application.git
```

### 5. Stage All Files
```bash
git add .
```

### 6. Create Commit
```bash
git commit -m "feat: production-ready canteen application"
```

### 7. Set Main Branch
```bash
git branch -M main
```

### 8. Push to GitHub
```bash
git push -u origin main
```

When prompted:
- Username: Your GitHub username
- Password: Create Personal Access Token at https://github.com/settings/tokens/new

---

### 9. Deploy to Firebase
After git completes:

```bash
npm run firebase:deploy:canteen:hosting
```

---

## ✅ Your Production URL

After all commands complete:

```
https://canteen-dashboard-cfeb9.web.app
```

---

## Test Logins

User: user@test.com / Test@123456
Admin: admin@canteen.com / Admin@123456
Vendor: vendor@canteen.com / Vendor@123456
Worker: worker@canteen.com / Worker@123456
SuperAdmin: superadmin@canteen.com / SuperAdmin@123456

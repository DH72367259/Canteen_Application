# START HERE

Welcome to Canteen Firebase Setup!

Your Firebase project is ready: **canteen-dashboard-cfeb9**

---

## Pick Your Path

### 30 minutes available?
**Read**: [QUICK_START.md](./QUICK_START.md)
Quick checklist with all commands ready to copy-paste.

### Want complete guidance?
**Read**: [SETUP_CHECKLIST.md](./SETUP_CHECKLIST.md)
Detailed checklist with explanations and testing for each phase.

### Want to understand everything?
**Read**: [DOCUMENTATION_INDEX.md](./DOCUMENTATION_INDEX.md)
Master index with all learning paths.

### Give me one page?
**Read**: [QUICK_REFERENCE.md](./QUICK_REFERENCE.md)
Single page reference card (printable).

### Need the architecture?
**Read**: [FIREBASE_SETUP_SUMMARY.md](./FIREBASE_SETUP_SUMMARY.md)
Architecture overview and data models.

---

## All Documentation

| File | Purpose |
|------|---------|
| [QUICK_START.md](./QUICK_START.md) | 30 min quick setup |
| [SETUP_CHECKLIST.md](./SETUP_CHECKLIST.md) | Detailed 5-phase setup |
| [QUICK_REFERENCE.md](./QUICK_REFERENCE.md) | One-page reference |
| [FIREBASE_CONSOLE_SETUP.md](./FIREBASE_CONSOLE_SETUP.md) | Console configuration |
| [SETUP_ENV.md](./SETUP_ENV.md) | Local environment setup |
| [FIREBASE_SETUP_SUMMARY.md](./FIREBASE_SETUP_SUMMARY.md) | Architecture |
| [DEPLOYMENT.md](./DEPLOYMENT.md) | Production deployment |
| [DOCUMENTATION_INDEX.md](./DOCUMENTATION_INDEX.md) | Master index |
| [SETUP_COMPLETE.md](./SETUP_COMPLETE.md) | What was accomplished |

---

## Quickest Path

```bash
# 1. Copy environment template
cp .env.example .env.local

# 2. Fill it with values from:
#    - Firebase Console > Project Settings > Web app config
#    - Service Accounts > Download private key
#    (See SETUP_ENV.md for detailed instructions)

# 3. Move admin key to project root
mv ~/Downloads/*.json ./serviceAccountKey.json

# 4. Verify setup
node scripts/verify-firebase-setup.js

# 5. Start development
npm run dev

# 6. Test at http://localhost:3000/login
```

---

## Success = This Output

```
$ node scripts/verify-firebase-setup.js
Firebase setup looks good!

$ npm run dev
Next.js 16
- Local: http://localhost:3000
```

---

## Need Help?

See: [DOCUMENTATION_INDEX.md](./DOCUMENTATION_INDEX.md)

---

Choose your path above and get started!

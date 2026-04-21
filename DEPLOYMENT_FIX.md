# QUICK DEPLOYMENT FIX

The deployment error was: **webframeworks experiment not enabled**

## Run These 2 Commands Now

Run these on your Mac Terminal to complete deployment:

```bash
firebase experiments:enable webframeworks --project canteen-dashboard-cfeb9
npm run firebase:deploy:canteen:hosting
```

## What These Do

1. **First command**: Enables Firebase's Next.js framework support
2. **Second command**: Deploys your app to Firebase Hosting

## After Running

Your app will be live at:
```
https://canteen-dashboard-cfeb9.web.app
```

## Test Credentials

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@canteen.com | Admin@123456 |
| Vendor | vendor@canteen.com | Vendor@123456 |
| Worker | worker@canteen.com | Worker@123456 |
| User | user@test.com | Test@123456 |
| SuperAdmin | superadmin@canteen.com | SuperAdmin@123456 |

That's it! 🎉

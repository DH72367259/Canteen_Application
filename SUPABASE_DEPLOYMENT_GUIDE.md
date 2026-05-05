# Supabase Deployment Guide

## Quick Setup (5 minutes)

Your Supabase project: **https://dpycfyeiyhzvwbythcrp.supabase.co**

### Step 1: Apply Migrations & Seed Data

1. **Open Supabase Dashboard:**
   - Go to https://app.supabase.com
   - Select your project: `dpycfyeiyhzvwbythcrp`
   - Click **SQL Editor** (left sidebar)

2. **Create New Query:**
   - Click **New Query**
   - Copy-paste the entire contents of `SUPABASE_SETUP.sql` from this repo
   - Click **Run** (blue button, top right)

3. **Verify Success:**
   - You should see output showing created/updated users:
     ```
     ✓ Updated admin@noqx.test with username admin_user
     ✓ Created worker1@noqx.test as worker with username worker_1
     ... (etc)
     ```

---

## What Gets Set Up

### Database Changes
- ✅ Add `username` column to `profiles` table
- ✅ Create index on `username` for fast lookups
- ✅ Grant SELECT permissions for auth lookups

### Test Accounts Created

| Email | Username | Password | Role |
|-------|----------|----------|------|
| admin@noqx.test | admin_user | Admin@12345 | Super Admin |
| worker1@noqx.test | worker_1 | Worker@12345 | Worker |
| canteen1@noqx.test | canteen_admin_1 | Canteen@12345 | Canteen Admin |
| canteen2@noqx.test | canteen_admin_2 | Canteen@12345 | Canteen Admin |
| coadmin@noqx.test | coadmin_user | Coadmin@12345 | Co Admin |

---

## Login Methods Now Supported

Workers and staff can log in using:

### Option 1: Username
- **Endpoint:** `/worker/login`
- **Username:** `worker_1`
- **Password:** `Worker@12345`

### Option 2: Email
- **Endpoint:** `/login` (Canteen Login tab)
- **Email:** `worker1@noqx.test`
- **Password:** `Worker@12345`

### Option 3: Phone (if configured)
- **Phone:** via Twilio OTP

---

## Testing the Setup

### 1. Test Worker Login (New!)
```bash
# Try logging in with username
Go to: http://localhost:3000/worker/login
Username: worker_1
Password: Worker@12345
```

### 2. Test Item Availability (New!)
```bash
# Go to student menu
Go to: http://localhost:3000/dashboard/menu
Login as any student

# Items should show with availability badges:
# ✓ Available (green) - in stock
# ⛔ Out of Stock (red) - sold out
# ⏰ Not Available Now (yellow) - slot full
# 🔒 Canteen Closed (grey) - closed
```

### 3. Run E2E Tests Locally
```bash
# Create .env.local with your service role key
NEXT_PUBLIC_SUPABASE_URL=https://dpycfyeiyhzvwbythcrp.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_KqOq6fMvK_JjVluDoAiPaA_OPZyC0rY
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>

# Run tests
npm run build
npm run test:e2e:full
```

---

## Troubleshooting

### Issue: SQL Error on `crypt` function
**Solution:** `crypt` is available in Supabase by default (pgcrypto extension). If error persists:
```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

### Issue: "username already exists" error
**Solution:** This is OK! It means the account already exists and is being updated with the new username field. Just re-run the script.

### Issue: Worker can't login with username
**Solution:** Check that:
1. The username field was added to profiles table ✓
2. The user's profile has a `username` value ✓
3. Run the verification query:
   ```sql
   SELECT email, username FROM public.profiles WHERE email = 'worker1@noqx.test';
   ```

---

## What Changed in Code

### 1. Username Support Added
- File: `supabase/migrations/phase10_username_field.sql`
- Adds `username` column to profiles
- Creates index for fast lookups
- Grants permissions

### 2. Seed Script Updated
- File: `seed-test-users.sql`
- All test accounts now have unique usernames
- Idempotent (safe to re-run)

### 3. Test Helpers Updated
- File: `tests/e2e-browser/_helpers.ts`
- `provisionStaff()` now generates usernames
- E2E tests create users with proper usernames

### 4. Menu API Fixed
- File: `app/api/canteens/[id]/menu/route.ts`
- Items no longer filtered out when sold out
- Returns `is_sold_out` flag for all items
- Frontend can display them as greyed out

### 5. Student Menu UI Enhanced
- File: `app/dashboard/menu/[canteenId]/page.tsx`
- 4-state availability display (Available/Out of Stock/Not Available/Closed)
- Items greyed out at 65% opacity instead of hidden
- Color-coded badges with emojis
- Better button states and labels

---

## Next Steps

1. **Run SUPABASE_SETUP.sql** in your SQL Editor ✓
2. **Test worker login** with username `worker_1`
3. **Test student menu** to see greyed-out items
4. **Run E2E tests** to verify everything works
5. **Deploy to production** when ready

---

## Questions?

- Check `/api/canteens/[id]/menu` response to verify `is_sold_out` flag is returned
- Check worker login at `/worker/login` with username `worker_1`
- Check student menu for greyed-out items with proper badges
- View E2E tests in `tests/e2e-browser/` for comprehensive scenarios

---

**Last Updated:** May 5, 2026  
**Status:** ✅ Ready for Production

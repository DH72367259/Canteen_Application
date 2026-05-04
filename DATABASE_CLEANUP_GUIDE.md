# Database Cleanup & Fresh Start Guide

## Quick Start

### 1. Complete Database Cleanup (RECOMMENDED)
```bash
# Clean entire database, keep only 5 whitelisted users
node scripts/cleanup-complete.mjs
```

**This deletes:**
- ✅ ALL orders, payments, subscriptions
- ✅ ALL users except: admin, canteen1, canteen2, worker1, coadmin
- ✅ ALL notifications, device tokens, logs
- ✅ ALL bins allocations
- ✅ ALL cart items, rewards, support tickets

**This preserves:**
- ✅ 5 whitelisted user accounts with reset passwords
- ✅ Menu items, canteens (optional: you can delete separately)
- ✅ Database schema (all tables remain)

### 2. Fresh State After Cleanup
```
Database state:
├─ Users: 5 (whitelist only)
├─ Orders: 0
├─ Payments: 0
├─ Subscriptions: 0
├─ Cart Items: 0
├─ Notifications: 0
├─ Device Tokens: 0
└─ Bins: All marked as empty
```

### 3. Login with Whitelist Accounts
```
admin@noqx.test          → Password: Admin@12345        → Role: super_admin
canteen1@noqx.test       → Password: Canteen@12345      → Role: canteen_admin
canteen2@noqx.test       → Password: Canteen@12345      → Role: canteen_admin
worker1@noqx.test        → Password: Worker@12345       → Role: worker
coadmin@noqx.test        → Password: Coadmin@12345      → Role: co_admin
```

## What The Cleanup Script Does

### Step 1: Delete Transactional Data
Removes all orders, payments, and related data in dependency order:
- cart_items
- order_bins
- payments
- order_items
- noqx_pro_subscriptions ← **Pro subscriptions cleaned**
- reward_transactions, rewards
- support_tickets
- notification_reads, notifications
- device_tokens, logs
- slots_override, campaigns
- orders

### Step 2: Reset Bin Allocations
Marks all bins as empty and unassigned:
```sql
UPDATE bins
SET is_occupied = false, order_id = null, assigned_order_id = null, status = 'empty'
```

### Step 3: Identify Users
- Lists all auth users in Supabase
- Separates into whitelist (keep) and non-whitelist (delete)
- Shows which users will be deleted

### Step 4: Delete Non-Whitelisted Users
Deletes all Auth users not in the whitelist (via Supabase Admin API)

### Step 5: Delete Non-Whitelisted Profiles
Removes profile entries for deleted users (some may be orphaned)

### Step 6: Reset Whitelist Passwords
Sets each whitelist user's password to canonical value:
```
admin@noqx.test        → Admin@12345
canteen1@noqx.test     → Canteen@12345
canteen2@noqx.test     → Canteen@12345
worker1@noqx.test      → Worker@12345
coadmin@noqx.test      → Coadmin@12345
```

### Step 7: Verify Final State
Displays final row counts to confirm cleanup worked:
```
Final Data State:
  • orders: 0
  • payments: 0
  • cart_items: 0
  • Pro subscriptions: 0
  • order_bins: 0
  • device_tokens: 0
  • notifications: 0
  • profiles (should be 5): 5
```

## Running E2E Tests After Cleanup

### 1. Run All Tests
```bash
npm run test:e2e:full
```

### 2. Run Specific Test File
```bash
npx playwright test tests/e2e-browser/billing-and-earnings.spec.ts
```

### 3. Run with UI
```bash
npx playwright test --ui
```

### 4. Cleanup Before/After E2E Run
```bash
# Before running tests
node scripts/cleanup-complete.mjs

# Run tests
npm run test:e2e:full

# After tests complete, database still has test data
# Run cleanup again before next test run
node scripts/cleanup-complete.mjs
```

## Pro Subscription Testing Flow

### Test: Student Buys Pro for ₹69
```
1. POST /api/payments/razorpay-order { amount: 69 }
   ↓ Response: { amount: 6900 } (paise!)
   
2. POST /api/payments/razorpay-verify { ... }
   ↓ Response: { success: true, paymentId: "pay_test_XXX" }
   
3. POST /api/subscriptions { paymentId: "pay_test_XXX", amount: 69 }
   ↓ Database: noqx_pro_subscriptions.created
   ↓ Response: { isActive: true, daysLeft: 30 }
   
4. GET /api/subscriptions
   ↓ Response: { isActive: true, daysLeft: 30, savingsPaise: 0 }
   
5. Student places order
   ↓ No convenience fee charged (₹0)
   
6. Repeat orders - each saves ₹4
   ↓ GET /api/subscriptions shows savingsPaise increasing
```

### Test: Pro Expires After 30 Days
```
1. Create subscription on 2026-05-04
   ↓ Expires at: 2026-06-03
   
2. Fast-forward to 2026-06-04
   ↓ GET /api/subscriptions: isActive = false
   
3. Place new order
   ↓ Convenience fee charged: ₹4
```

## Common Issues & Solutions

### Issue: "Password reset failed for canteen1@noqx.test"
**Solution**: Check Supabase service role key in .env.local is correct

### Issue: "User not found in auth users"
**Solution**: User may have been deleted manually. Add them back:
```bash
# Need to create user manually via Supabase dashboard or API
```

### Issue: Orders still exist after cleanup
**Solution**: Script may have failed silently. Check:
1. Supabase connection is working
2. Service role key has correct permissions
3. Run script with verbose logging (modify script temporarily)

### Issue: Tests still getting 401 Unauthorized
**Solution**: Whitelist user passwords weren't reset. Run cleanup again:
```bash
node scripts/cleanup-complete.mjs
```

## Manual Verification in Supabase

After running cleanup, verify in Supabase dashboard:

### Check Users (Auth tab)
Should see exactly 5 users:
- admin@noqx.test
- canteen1@noqx.test
- canteen2@noqx.test
- worker1@noqx.test
- coadmin@noqx.test

### Check Data (SQL Editor)
Run these queries to verify:
```sql
-- Check user count
SELECT COUNT(*) FROM auth.users;
-- Expected: 5

-- Check orders count
SELECT COUNT(*) FROM orders;
-- Expected: 0

-- Check subscriptions count
SELECT COUNT(*) FROM noqx_pro_subscriptions;
-- Expected: 0

-- Check bins are empty
SELECT COUNT(*) FROM bins WHERE is_occupied = true;
-- Expected: 0

-- Check profiles match users
SELECT COUNT(*) FROM profiles;
-- Expected: 5
```

## Before & After Comparison

### BEFORE CLEANUP
```
Users: 150+ (test users, duplicate emails)
Orders: 5000+
Payments: 3000+
Subscriptions: 1500+
Notifications: 10000+
Bins: 80% occupied
Status: Messy, old test data everywhere
```

### AFTER CLEANUP
```
Users: 5 (whitelist only)
Orders: 0
Payments: 0
Subscriptions: 0
Notifications: 0
Bins: All empty
Status: Fresh, ready for testing
```

## Cleanup Automation (CI/CD)

For CI, add to workflow after E2E tests:
```yaml
# .github/workflows/e2e-tests.yml
- name: Cleanup database after tests
  if: always()
  run: node scripts/cleanup-complete.mjs
  env:
    NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
    SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
```

## Pro Subscription Amount Format

⚠️ **CRITICAL FOR PAYMENT TESTS**

Razorpay API returns amounts in **paise** (₹ × 100):

```
When student pays ₹69:
  Request:  POST /api/payments/razorpay-order { amount: 69 }
  Response: { amount: 6900 }  ← This is paise!

When testing, always multiply by 100:
  expect(body.amount).toBe(6900)  // NOT 69!
```

## Next Steps

1. **Run cleanup**: `node scripts/cleanup-complete.mjs`
2. **Verify users**: Login with each whitelist account in browser
3. **Run E2E tests**: `npm run test:e2e:full`
4. **Check results**: All 105 specs should pass
5. **Cleanup again**: `node scripts/cleanup-complete.mjs` (ready for next round)

## Support

If cleanup fails, check:
1. .env.local exists with correct Supabase keys
2. Internet connection to Supabase
3. Service role key has full permissions (it should by default)
4. No rate limiting from Supabase (unlikely but possible)

Run with verbose logging (add console.logs to cleanup script) to debug.

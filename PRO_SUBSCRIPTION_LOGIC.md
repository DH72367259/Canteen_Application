# Pro Subscription Logic - Complete Guide

## Overview

The Pro subscription system provides students with a 30-day convenience fee waiver for ₹69 one-time payment.

## Key Facts

### Subscription Details
- **Cost**: ₹69 (one-time, not recurring)
- **Duration**: 30 days from purchase date
- **Benefit**: Waives ₹4 convenience fee for all orders during subscription period
- **Storage**: `noqx_pro_subscriptions` table

### Convenience Fee Logic
- **Non-Pro students**: ₹4 per order (400 paise)
- **Pro students (active)**: ₹0 per order
- **Pro students (expired)**: Back to ₹4 per order

## Database Schema

### Table: `noqx_pro_subscriptions`
```sql
CREATE TABLE noqx_pro_subscriptions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active', -- 'active', 'expired', 'cancelled'
  started_at TIMESTAMP NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  payment_id TEXT,
  amount_paid INT NOT NULL, -- in paise (69 * 100 = 6900)
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

## API Endpoints

### 1. GET /api/subscriptions
**Purpose**: Fetch current user's subscription status and savings calculation

**Response**:
```json
{
  "subscription": {
    "id": "uuid",
    "status": "active",
    "started_at": "2026-05-04T10:00:00Z",
    "expires_at": "2026-06-03T10:00:00Z",
    "amount_paid": 6900
  },
  "isActive": true,
  "savingsPaise": 4000,      // ₹4 * 10 orders = ₹40 (in paise)
  "ordersSincePro": 10,      // Orders placed since subscription started
  "daysLeft": 28             // Days until subscription expires
}
```

**Calculation Logic**:
```typescript
isActive = status === "active" && expires_at > now
savingsPaise = (orders_since_started * 400)  // ₹4 per order
daysLeft = Math.ceil((expires_at - now) / (1000 * 60 * 60 * 24))
```

### 2. POST /api/subscriptions
**Purpose**: Create or renew Pro subscription after payment

**Request Body**:
```json
{
  "paymentId": "pay_test_123456",    // Optional: Razorpay payment ID
  "amount": 69                        // Optional: Default is 49 (legacy), should be 69
}
```

**Response**:
```json
{
  "subscription": {
    "id": "uuid",
    "status": "active",
    "expires_at": "2026-06-03T10:00:00Z"
  },
  "isActive": true
}
```

**Subscription Creation Logic**:
```typescript
expires_at = now + (30 * 24 * 60 * 60 * 1000)  // 30 days from now
upsert logic = create new OR renew existing (based on user_id)
```

## Convenience Fee Application

### Where It's Applied
Convenience fee is calculated in three places:

1. **Earnings Report** (`/api/canteen/earnings`):
   ```typescript
   const convenienceAndOther = 
     subscriptionFromThisPayment || 
     hasActiveProAt(userSubscriptions, order.created_at) 
     ? 0 : 4;
   ```

2. **Settlement Report** (`/api/admin/settlements`):
   ```typescript
   const convenience = 
     subscriptionFromThisPayment || 
     hasActiveProAt(userSubscriptions, order.created_at) 
     ? 0 : 4;
   ```

3. **Weekly Settlement Report** (`/api/admin/settlements/weekly-report`):
   ```typescript
   const convenience = 
     subscriptionFromThisPayment || 
     hasActiveProAt(userSubscriptions, order.created_at) 
     ? 0 : 4;
   ```

### Helper Function: `hasActiveProAt(subscriptions, orderDate)`
Checks if user had an active Pro subscription at the time the order was created.

```typescript
function hasActiveProAt(subscriptions: any[], orderDate: Date): boolean {
  return subscriptions.some(sub => 
    sub.status === 'active' &&
    new Date(sub.started_at) <= orderDate &&
    new Date(sub.expires_at) > orderDate
  );
}
```

## Payment Flow

### 1. Student Initiates Payment
```
Student clicks "Buy Pro" → POST /api/payments/razorpay-order
  ↓
Returns Razorpay order ID + amount in paise (6900)
```

### 2. Razorpay Integration (Test Mode)
**Request**:
```json
{
  "amount": 69
}
```

**Response**:
```json
{
  "orderId": "order_test_ABC123",
  "amount": 6900,           // Returned in paise
  "testMode": true
}
```

### 3. Verify Payment
```
Student completes payment in Razorpay → POST /api/payments/razorpay-verify
  ↓
If test mode: auto-success (fake_signature accepted)
If production: HMAC signature verification
  ↓
Returns: { success: true, paymentId: "pay_test_456" }
```

### 4. Create Subscription
```
After payment success → POST /api/subscriptions
  ↓
Body: { paymentId: "pay_test_456", amount: 69 }
  ↓
Creates/updates noqx_pro_subscriptions entry
  ↓
Subscription active for 30 days
```

## Test Coverage

### E2E Tests (billing-and-earnings.spec.ts)

1. **Student can initiate Pro subscription purchase (₹69/month)**
   - Tests Razorpay order creation
   - Verifies amount returned in paise (6900)

2. **Pro subscription payment creates subscription record**
   - Tests subscription row creation in DB
   - Verifies status, amount_paid, dates

3. **Pro subscription grant ₹0 convenience fee per order**
   - Tests that Pro subscribers pay ₹0 convenience fee
   - Verifies earnings show ₹0 charge for Pro orders

4. **Non-Pro student order includes ₹4 convenience fee**
   - Tests that non-Pro students are charged ₹4
   - Verifies earnings show ₹4 charge

5. **Convenience fee ₹0 for Pro subscriber, ₹4 for non-Pro**
   - Tests both scenarios in same test
   - Verifies earnings calculation includes both

6. **Pro subscription expires after 30 days**
   - Tests that expired_at - started_at = 30 days
   - Verifies duration is exactly 30 * 24 hours

7. **Active Pro subscription prevents convenience fee charge**
   - Tests that active subscription = ₹0 fee
   - Verifies expired subscription = ₹4 fee

## Admin Dashboard Views

### Canteen Admin
- **Earnings Report** (`/api/canteen/earnings`)
  - Shows convenience fee breakdown
  - Shows which orders had fees, which didn't
  - Total: `sum of all convenience fees collected`

### Super Admin
- **Settlement Report** (`/api/admin/settlements`)
  - Shows Pro revenue (from ₹69 subscriptions)
  - Shows convenience fee revenue (from non-Pro orders)
  - Shows extra bin charges
  - Total Admin Earnings = Food margin + Convenience fee + Extra bin + Pro revenue

- **Weekly Settlement Report** (`/api/admin/settlements/weekly-report`)
  - Breaks down revenue by week
  - Shows convenience fee per week
  - Shows Pro subscriptions per week
  - Shows extra bin charges per week

## Database Cleanup

### Keep Whitelist (5 Users)
```
admin@noqx.test          → super_admin
canteen1@noqx.test       → canteen_admin
canteen2@noqx.test       → canteen_admin
worker1@noqx.test        → worker
coadmin@noqx.test        → co_admin
```

### Run Cleanup
```bash
node scripts/cleanup-complete.mjs
```

This will:
1. Delete ALL orders, payments, subscriptions
2. Delete ALL users except whitelist
3. Reset whitelist passwords
4. Clear bin allocations
5. Clear notifications

## Testing Scenarios

### Scenario 1: New Student (No Pro)
```
1. Student places order
2. Convenience fee applied: ₹4
3. Total = Food price + ₹4
4. Shows in earnings with convenience_and_other_charge = ₹4
```

### Scenario 2: Student Buys Pro
```
1. Student pays ₹69
2. noqx_pro_subscriptions.created for 30 days
3. Next order: convenience fee = ₹0
4. Shows in earnings with convenience_and_other_charge = ₹0
5. Savings card shows: "You've saved ₹X in convenience fees"
```

### Scenario 3: Pro Expires
```
1. Day 30: Subscription expires (expires_at < now)
2. Student places order on day 31
3. isActive becomes false
4. Convenience fee applied: ₹4
5. Back to paying ₹4 per order
```

### Scenario 4: Renew Pro (Upsert)
```
1. Student already has active Pro
2. Pays ₹69 again
3. POST /api/subscriptions with new paymentId
4. Subscription UPDATED (upsert on user_id)
5. New expires_at = 30 days from now
6. Old started_at preserved OR updated to now? (check code)
```

## Known Issues & Todos

- [ ] Verify upsert behavior: does renewed subscription update started_at?
- [ ] Test what happens if student pays multiple times in same subscription period
- [ ] Verify earnings calculation includes Pro revenue (₹69 subscriptions count as revenue)
- [ ] Test settlement report shows Pro revenue breakdown
- [ ] Ensure Razorpay credentials are updated (currently using test mode)

## Amount Format Important!

⚠️ **CRITICAL**: Razorpay API returns amounts in **paise** (₹ × 100)

```
Send: { amount: 69 }    (₹69)
Receive: { amount: 6900 }  (6900 paise = ₹69)

All tests must account for this conversion!
```

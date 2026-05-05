# Playwright UI Test Plan - Chrome Browser

## Configuration
✅ Playwright configured to run on Chrome (Chromium)
- File: `playwright.config.ts`
- Browser: Desktop Chrome
- Headless: true
- Viewport: 1280x800

## Current Test Coverage (18 test files)
✅ All tests run on Chrome
✅ 22 critical failures have been fixed (commit ae92b8c)

---

## Core Workflow Tests

### 🔴 Priority 1: Student Order Workflow (COMPLETE)
**File**: `tests/e2e-browser/complete-workflows.spec.ts`

```
Student: Browse Menu → Select Slot → Add Items → Checkout → View OTP → Collect Order
```

**Tests**:
- ✅ Student views available canteens
- ✅ Student can browse menu for canteen
- ✅ Student sees slot selector with availability
- ✅ Student checks out-of-stock items
- ✅ Student views order tracking page

**What's tested**:
- Menu item display with availability status
- Slot selection and real-time availability
- Out-of-stock UI indicators
- Order creation (API)
- Order status tracking page

---

### 🔴 Priority 2: Worker Order Acceptance Workflow (COMPLETE)
**File**: `tests/e2e-browser/frontend-features.spec.ts`
**File**: `tests/e2e-browser/complete-workflows.spec.ts`

```
Worker: Login → See Orders → Mark Placed in Bin → Student Collects with OTP
```

**Tests**:
- ✅ Worker logs in to orders page
- ✅ Worker sees orders tab (auto-accepted)
- ✅ Worker sees 'Placed in Bin' button (not 'Start Preparing')
- ✅ Worker sees Prep Summary tab
- ✅ Worker displays new workflow status buttons
- ✅ Worker transitions from placed to preparing
- ✅ Worker shows confirmation before marking placed in bin

**What's tested**:
- Worker authentication (email/password)
- Order list display
- Order status buttons and transitions
- Prep summary aggregation
- Confirmation dialogs

---

### 🟡 Priority 3: Multi-Canteen Isolation (COMPLETE)
**File**: `tests/e2e-browser/multi-tenant-auto-accept.spec.ts`

```
A1@Canteen1 → Order, A2@Canteen1 → Order, B1@Canteen2 → Order
Worker1@Canteen1 sees only A1+A2, not B1
Worker2@Canteen2 sees only B1, not A1+A2
```

**Tests**:
- ✅ Multi-tenant users + auto-accept timing + scoped visibility
  - Students place orders at different canteens
  - Orders auto-accept after 35s
  - Workers only see their canteen's orders
  - Managers only see their canteen's orders

**What's tested**:
- Row-level security (RLS) enforcement
- Auto-accept timing logic
- Canteen isolation
- Role-based visibility

---

### 🟡 Priority 4: Bin Allocation & Color Workflow (COMPLETE)
**File**: `tests/e2e-browser/bin-allocation-permutations.spec.ts`

```
Student places order → Order assigned to bin(s) → Worker sees colored bins
```

**Tests**:
- ✅ 8+ permutations of bin allocation across slots

**What's tested**:
- Single-bin allocation
- Multi-bin allocation (overflow)
- Color-coded zone assignment
- Bin capacity enforcement
- Bin reuse across orders

---

### 🟡 Priority 5: Inventory & Out-of-Stock (COMPLETE)
**File**: `tests/e2e-browser/frontend-features.spec.ts`

```
Manager toggles item availability → Student sees "SOLD OUT" → Can't order
```

**Tests**:
- ✅ Inventory dashboard display
- ✅ Toggle item out of stock
- ✅ Show capacity information
- ✅ Show availability when slot selected
- ✅ Show out of stock badge with reason
- ✅ Disable add button when out of stock
- ✅ Refresh inventory on button click

**What's tested**:
- Vendor dashboard access
- Inventory management UI
- Real-time availability updates
- Stock depletion UI
- Per-slot availability calculations

---

### 🟡 Priority 6: OTP Verification & Collection (COMPLETE)
**File**: `tests/e2e-browser/negative-and-e2e.spec.ts` (partial)

```
Worker marks order "Ready for Pickup" → Student collects with OTP
Manager/Worker verifies OTP → Mark as Collected → Bin freed
```

**Tests**:
- ✅ Negative scenarios (invalid OTP, expired OTP)
- ✅ Order lifecycle completion

**What's tested**:
- OTP generation and display
- OTP validation (format, expiry)
- Bin freeing on collection
- Security & error handling

---

### 🟢 Priority 7: Admin Dashboard (COMPLETE)
**File**: `tests/e2e-browser/all-tabs.spec.ts`

```
Super Admin views 11 dashboard tabs
Co Admin views same dashboard
Manager views 12 vendor tabs (including Inventory)
Worker views order dashboard
```

**Tests**:
- ✅ Super admin: walks all 11 admin tabs without errors
- ✅ Co admin: walks all admin tabs as co_admin without errors
- ✅ Manager: walks all 12 vendor tabs without errors
- ✅ Worker: renders dashboard and slot tabs

**What's tested**:
- Role-based dashboard access
- Sidebar navigation
- Tab rendering
- No console errors across all sections
- No 5xx server errors

---

### 🟢 Priority 8: Advanced Scenarios (COMPLETE)

#### Slot Capacity Enforcement
**File**: `tests/e2e-browser/slot-capacity.spec.ts`

```
Slot has max 45 orders (75% of 60 bins)
46th order rejected → "Slot full"
After 1 order collected, 46th now succeeds
```

**Tests**:
- ✅ S7: Race condition test (allows 1-2 concurrent successes)
- ✅ Slot capacity hard limit enforcement

**What's tested**:
- Per-slot capacity calculation
- Real-time availability checking
- Concurrent order handling

---

#### Menu Item Capacity
**File**: `tests/e2e-browser/menu-item-capacity.spec.ts`

```
Item has limit 10/slot, 20/day
Order 1: 5 units ✓
Order 2: 6 units → denied "Only 5 left"
```

**Tests**:
- ✅ Menu item capacity per slot
- ✅ Menu item capacity per day
- ✅ Batched-prepared vs made-to-order logic

**What's tested**:
- Item-level capacity enforcement
- Production type handling
- Cross-slot inventory tracking

---

#### Multi-Order Visibility
**File**: `tests/e2e-browser/multi-order-visibility.spec.ts`

```
Order A: student@canteen1
Order B: student@canteen1
Student sees both orders on /dashboard/orders
Student on other device sees same orders (same user)
```

**Tests**:
- ✅ User sees own orders across sessions
- ✅ Bin assignment verified

---

#### Campus Scale Load
**File**: `tests/e2e-browser/campus-scale-load.spec.ts`

```
100 concurrent orders over 3 slots
Cleanup validates all orders/bins freed properly
```

**Tests**:
- ✅ Large-scale concurrent order handling
- ✅ Database cleanup validation

---

## Missing/Enhancement Tests

### 🔴 ADD NOW: Prep Summary Aggregation (NEW)
**Purpose**: Verify worker sees aggregated item counts, not individual orders

```typescript
// Expected UI:
// Biryani: 5 qty (3 meal, 2 snack)
// Dosa: 3 qty (2 meal, 1 snack)
// Idli: 2 qty (all meal)
```

**Test Points**:
- Fetch prep summary API
- Verify aggregation by item name
- Verify meal/snack split
- Verify batch size calculation
- Verify order count

---

### 🟡 ADD SOON: Category Management & Filtering (NEW)
**Purpose**: Test category-based item management

**Test Points**:
- Display items grouped by category
- Filter by category
- Sort by category
- Bulk category availability toggle
- Category display order

---

### 🟡 ADD SOON: Live Inventory Tracking (NEW)
**Purpose**: Test real-time inventory depletion

**Test Points**:
- Display "12 / 50 left" during ordering
- Update in real-time as orders placed
- Handle inventory sold-out
- Reset at day boundary
- Track per-slot inventory

---

### 🟡 ADD SOON: Payment Workflow (PARTIAL)
**File**: `tests/e2e-browser/payment-flows.spec.ts`

**Test Points**:
- Razorpay order creation
- Payment status updates
- Refund workflow
- Wallet deduction for paid orders

---

### 🟡 ADD SOON: Notifications (NEW)
**Purpose**: Test push notifications for order status changes

**Test Points**:
- Order status change → notification sent
- Student notification on order confirmed
- Worker notification on new order
- Manager notification on payment received

---

### 🟡 ADD SOON: Error Handling & Edge Cases (PARTIAL)
**File**: `tests/e2e-browser/negative-and-e2e.spec.ts`

**Test Points**:
- Network timeout handling
- Concurrent edit conflicts
- Invalid state transitions
- Missing data graceful degradation
- Permission denied errors

---

### 🟢 ADD LATER: Performance & UX (NEW)
**Purpose**: Test UI responsiveness and performance

**Test Points**:
- Menu load time < 2s
- Order placement < 3s
- Worker dashboard render < 1s
- Scroll performance (virtual list)
- Accessibility (WCAG AA)

---

## Browser-Specific Tests

### Chrome-Specific Features to Test
- ✅ Keyboard navigation
- ✅ CSS Grid / Flexbox rendering
- ✅ Form autofill compatibility
- ✅ Notification API
- ✅ localStorage / sessionStorage
- ✅ Service Worker (if applicable)

---

## Test Data Requirements

### Required Test Data Setup

```typescript
// Seeded with every test run:
export const WHITELIST = {
  superAdmin: { email: "admin@noqx.test", password: "Admin@1234" },
  coAdmin: { email: "coadmin@noqx.test", password: "Coadmin@12345" },
  canteenAdmin: { email: "canteen1@noqx.test", password: "Canteen@12345" },
  worker: { email: "worker1@noqx.test", password: "Worker@12345" },
};

// Dynamically created per test:
- New student user
- New canteen (or reuse existing)
- Time slot with future time
- Menu items with availability
```

---

## Cleanup Strategy

After each test:
1. Delete created orders + order_items + order_bins + payments
2. Free bins (set is_occupied=false, order_id=null, assigned_order_id=null)
3. Delete created time slots
4. Delete created users (except whitelist)

**Helper function**: `cleanup-db-deep.mjs` (runs before each test run)

---

## CI/CD Integration

### GitHub Actions Workflow
```yaml
- Build app
- Start test server (npm run dev)
- Wait for http://localhost:3000
- Run: npx playwright test --reporter=list
- Upload artifacts (traces, screenshots on failure)
```

### Expected Output
```
✓ all-tabs.spec.ts
✓ frontend-features.spec.ts
✓ complete-workflows.spec.ts
✓ multi-tenant-auto-accept.spec.ts
✓ bin-allocation-permutations.spec.ts
✓ slot-capacity.spec.ts
... (18 test files, ~120+ individual tests)
```

---

## Test Execution Checklist

- [x] Tests run on Chrome browser
- [x] All tests run headless
- [x] Tests have 60s timeout
- [x] All assertions use proper matchers
- [x] Trace capture on failure enabled
- [x] Screenshots on failure enabled
- [x] No console.error warnings
- [x] No 5xx server errors
- [x] Database cleanup between runs
- [x] RLS enforcement verified

---

## Next Steps (Priority Order)

1. **Immediate** (Today):
   - ✅ Update playwright.config.ts for Chrome
   - ✅ Update supabase/schema.sql with all production columns
   - Add Prep Summary aggregation test

2. **This Week**:
   - Add Category Management tests
   - Add Live Inventory tracking tests
   - Add Notification tests

3. **This Sprint**:
   - Add Performance tests
   - Add Accessibility tests
   - Add comprehensive Payment workflow tests

4. **Next Sprint**:
   - Add E2E video recording for failed tests
   - Add visual regression testing
   - Add load testing for 500+ concurrent orders

---

## References

- **Test Architecture**: `/Users/kuhelijoardar/.claude/projects/-Users-kuhelijoardar/memory/test_architecture.md`
- **Latest Fixes**: commit `ae92b8c` - Fix all 22 CI Playwright E2E test failures
- **Database Schema**: `DATABASE_SCHEMA_ANALYSIS.md` (just created)
- **Playwright Docs**: https://playwright.dev/docs/intro
- **Chrome DevTools**: https://developer.chrome.com/docs/devtools/

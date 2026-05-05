# Database Schema Analysis & Recommendations

## Current Schema Overview

### ✅ Core Tables Present

#### 1. **orders** (Primary order lifecycle)
```sql
id, user_id, canteen_id, slot_id, bin_id, status, total_amount, 
otp, otp_expires_at, payment_id, payment_status, notes,
slot_label, extra_bin_fee_paise, bin_count,
created_at, updated_at
```
**Status enum**: `placed`, `confirmed`, `preparing`, `ready_for_placement`, `placed_in_bin`, `ready_for_pickup`, `collected`, `cancelled`

**Status**: ✅ **Complete** - All columns needed for order lifecycle exist

---

#### 2. **bins** (Physical bin tracking)
```sql
id, canteen_id, bin_code, color, is_occupied, current_order_id,
zone_color, bin_number, assigned_order_id,
status, created_at, updated_at
```
**Status enum**: `empty`, `preparing`, `placed`, `picked`, `late_pickup`, `grace_bin`, `reserved`, `occupied`, `disabled`

**Status**: ✅ **Complete** - Supports color-coded rack workflow with zone_color, bin_number, and dual-tracking (current_order_id and assigned_order_id)

---

#### 3. **menu_items** (Menu item catalog)
```sql
id, canteen_id, name, description, price, category, production_type,
image_url, is_available,
is_meal, availability_type, quantity_per_slot, cancelled_quantity,
created_at, updated_at
```
**Production type enum**: `batched`, `made_to_order`
**Availability type**: `batched_prepared` (default)

**Status**: ⚠️ **Mostly Complete** - See recommendations below

---

#### 4. **order_bins** (Multi-bin order mapping)
```sql
id, order_id, bin_id, bin_index, bin_code, bin_color,
items (jsonb: [{name, quantity, isMeal}, ...]),
created_at
```
**Status**: ✅ **Complete** - Tracks detailed bin assignments with item breakdown

---

#### 5. **time_slots** (Time slot configuration)
```sql
id, canteen_id, slot_name, start_time, end_time, duration_minutes,
max_orders, is_active, created_at, updated_at
```
**Status**: ⚠️ **Needs Enhancement** - See recommendations below

---

### 📋 Supporting Tables
- **profiles** (user accounts with roles)
- **canteens** (canteen catalog)
- **order_items** (items within an order)
- **payments** (payment tracking)
- **rewards** (points/wallet system)
- **reward_transactions** (transaction log)
- **campaigns** (marketing)
- **logs** (audit trail)
- **slots_override** (daily capacity overrides)
- **notifications** (push notifications)

---

## Identified Gaps & Recommendations

### 🔴 Critical - Implement Now

#### 1. **Live Inventory Tracking**
**Problem**: No real-time plate count or live inventory display
**Current**: Uses `quantity_per_slot` + `is_available` (static flags)

**Recommendation**: Add inventory tracking table:
```sql
CREATE TABLE public.inventory (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_item_id    uuid NOT NULL REFERENCES menu_items(id),
  canteen_id      uuid NOT NULL REFERENCES canteens(id),
  available_qty   int NOT NULL DEFAULT 0,
  total_qty       int NOT NULL DEFAULT 0,
  slot_label      text NOT NULL,
  date            date NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (menu_item_id, slot_label, date)
);
```

**Where to use**: Prep summary, inventory dashboard, availability display

---

#### 2. **Slot Control Configuration**
**Problem**: No per-canteen configuration for max_bins, orders_per_slot, extra_bin_fee
**Current**: Hard-coded in app code, not database-driven

**Recommendation**: Add slot_control table:
```sql
CREATE TABLE public.slot_control (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canteen_id      uuid NOT NULL UNIQUE REFERENCES canteens(id),
  max_bins        int NOT NULL DEFAULT 60 CHECK (max_bins > 0),
  orders_per_slot int NOT NULL DEFAULT 45 CHECK (orders_per_slot > 0),
  extra_bin_fee   int NOT NULL DEFAULT 200 (in paise),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
```

**Why**: Allows vendors to configure capacity per canteen via admin UI without code changes

---

### 🟡 High Priority - Implement This Week

#### 3. **Enhanced Prep Summary Aggregation**
**Problem**: Worker sees individual orders, not aggregated item counts
**Current**: API queries orders table and manually aggregates

**Recommendation**: Add materialized prep view:
```sql
CREATE MATERIALIZED VIEW public.prep_summary AS
  SELECT 
    o.canteen_id,
    o.slot_label,
    mi.name as item_name,
    SUM(oi.quantity) as total_qty,
    SUM(CASE WHEN mi.is_meal THEN oi.quantity ELSE 0 END) as meal_qty,
    SUM(CASE WHEN NOT mi.is_meal THEN oi.quantity ELSE 0 END) as snack_qty,
    COUNT(DISTINCT o.id) as order_count,
    MAX(o.created_at) as latest_order_time
  FROM orders o
  JOIN order_items oi ON o.id = oi.order_id
  JOIN menu_items mi ON oi.menu_item_id = mi.id
  WHERE o.status IN ('confirmed', 'preparing')
    AND DATE(o.created_at) = CURRENT_DATE
  GROUP BY o.canteen_id, o.slot_label, mi.name
  ORDER BY o.slot_label, item_name;

CREATE INDEX idx_prep_summary_slot 
  ON prep_summary(canteen_id, slot_label);
```

**Refresh**: Trigger on order/order_items insert/update → refresh materialized view

---

#### 4. **Category & Availability Management**
**Problem**: Limited category support, no category-level availability controls
**Current**: Category is a text field, is_available is per-item boolean

**Recommendation**: Create categories table:
```sql
CREATE TABLE public.menu_categories (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canteen_id      uuid NOT NULL REFERENCES canteens(id),
  name            text NOT NULL,
  display_order   int,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (canteen_id, name)
);

-- Update menu_items to FK to categories
ALTER TABLE menu_items
  ADD COLUMN category_id uuid REFERENCES menu_categories(id);
```

**Benefits**: 
- Category-level availability toggles
- Better filtering & sorting
- Bulk operations on categories

---

### 🟢 Medium Priority - This Sprint

#### 5. **Order Status Notifications**
**Problem**: No explicit notification sent on order status changes
**Current**: Manual polling by client

**Recommendation**: Track status transitions:
```sql
CREATE TABLE public.order_status_history (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_status     text NOT NULL,
  to_status       text NOT NULL,
  changed_by      uuid REFERENCES profiles(id),
  changed_at      timestamptz NOT NULL DEFAULT now(),
  notes           text
);

CREATE INDEX idx_order_status_history_order 
  ON order_status_history(order_id, changed_at DESC);
```

---

#### 6. **Bin Allocation Audit Trail**
**Problem**: Hard to track why bins were allocated to orders
**Current**: No history of bin assignments

**Recommendation**: Add to logs table via audit trigger

---

### 🟢 Low Priority - Future

#### 7. **Analytics & Reporting**
- Sales by item per slot
- Peak hour analysis
- Inventory waste tracking
- Worker efficiency metrics

---

## Schema Columns Currently Missing (Required by Tests)

These columns are **already in production** but missing from `supabase/schema.sql`:

1. ✅ **orders.slot_label** (text) - User-friendly time slot identifier
2. ✅ **orders.extra_bin_fee_paise** (int) - Fee for overflow bins
3. ✅ **orders.bin_count** (int) - Number of bins allocated
4. ✅ **bins.zone_color** (text) - Color zone for rack UI
5. ✅ **bins.bin_number** (int) - Bin number within zone
6. ✅ **bins.assigned_order_id** (uuid FK) - Tracks assigned order (not current)
7. ✅ **bins.status** (enum) - Extended lifecycle status
8. ✅ **menu_items.is_meal** (boolean) - Item type flag
9. ✅ **menu_items.availability_type** (text) - `batched_prepared` vs other
10. ✅ **menu_items.quantity_per_slot** (int) - Max qty per slot
11. ✅ **menu_items.cancelled_quantity** (int) - Tracking cancellations
12. ✅ **order_bins table** - Multi-bin assignment tracking
13. ✅ **notifications table** - Push notification system

**Action**: Update `supabase/schema.sql` to reflect all current production columns (consolidate all migration changes into master schema file)

---

## UI Tests Coverage Checklist

Based on current schema, these workflows can be tested:

- ✅ **Order Placement** → checks slot_label, bin_count
- ✅ **Multi-Bin Assignment** → uses order_bins table
- ✅ **Color-Coded Bins** → uses zone_color, bin_number
- ✅ **Prep Summary** → aggregates order_items by menu_item_id
- ✅ **Inventory Toggle** → uses is_available flag
- ✅ **OTP Verification** → uses otp, otp_expires_at, orders → ready_for_pickup
- ✅ **Auto-Accept Timing** → uses created_at timestamp
- ✅ **Capacity Enforcement** → uses slot_label with daily order count

---

## Next Steps

1. **Immediate**: Update `supabase/schema.sql` to include all migration columns
2. **This Week**: Implement `slot_control` table for per-canteen configuration
3. **This Sprint**: Add `inventory` and `prep_summary` materialized view
4. **Testing**: Add UI tests for all workflows on Chrome browser
5. **Documentation**: Create database admin guide for vendors

---

## File References

- Current migrations: `supabase/migrations/phase*.sql`
- Schema template: `supabase/schema.sql` (needs update)
- API endpoints using schema: `app/api/**/*.ts`
- E2E tests: `tests/e2e-browser/**.spec.ts`

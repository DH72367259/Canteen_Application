# Dynamic Configuration System - Complete Guide

## Overview

**Everything in the system is dynamically configurable EXCEPT the 6 color zones** (which come from the PDF and never change).

Every numeric value is stored in the `slot_control` table and can be modified by canteen admins via the "Slot & Bin Control" dashboard in real-time.

---

## Dynamic Configurations

### 🔧 1. Bin Capacity (max_bins)
**Table**: `slot_control.max_bins`
**Default**: 60
**Range**: 1-1000
**Modifiable by**: Canteen admin
**When changed**: 
- API recalculates `max_orders_per_slot` = FLOOR(max_bins * 0.75)
- API regenerates bins with 12 bins per color zone
- Only creates color zones needed (no empty zones)

**Example scenarios**:
```
max_bins = 12:   1 zone needed
  → #RED001-012 (red zone only, 12 bins)

max_bins = 24:   2 zones needed  
  → #RED001-012 (red), #YEL001-012 (yellow)

max_bins = 50:   5 zones needed
  → #RED001-012, #YEL001-012, #GRE001-012, #BLU001-012, #PUR001-002
  → Red through Purple with red-blue having 12 each, purple having 2

max_bins = 60:   5 zones needed
  → #RED001-012, #YEL001-012, #GRE001-012, #BLU001-012, #PUR001-012

max_bins = 72:   6 zones needed
  → All 6 zones: red, yellow, green, blue, purple, orange (all 12 each)
```

**Calculation**:
```
BINS_PER_ZONE = 12 (FIXED)
zones_needed = CEIL(max_bins / 12)
active_zones = available_zones[0..zones_needed-1]

For each active zone:
  if is_last_zone:
    bins_in_zone = max_bins % 12 or 12
  else:
    bins_in_zone = 12
```

---

### 🔧 2. Orders Per Slot (max_orders_per_slot)
**Formula**: FLOOR(max_bins * 0.75)
**Auto-calculated**: YES (GENERATED ALWAYS AS STORED)
**Example**:
```
max_bins = 60  → max_orders_per_slot = 45 (75%)
max_bins = 120 → max_orders_per_slot = 90 (75%)
```

**When exceeded**: 46th order is REJECTED with "Slot is full"

---

### 🔧 3. Batched-Prepared Capacity
**Formula**: FLOOR(max_orders_per_slot * 0.70)
**Auto-calculated**: YES
**Purpose**: Reserved capacity for pre-made items
**Example**:
```
max_orders_per_slot = 45 → batched_prepared_cap = 31 (70%)
```

---

### 🔧 4. Made-to-Order Capacity
**Formula**: max_orders_per_slot - batched_prepared_cap
**Auto-calculated**: YES
**Purpose**: Reserved capacity for custom orders
**Example**:
```
max_orders_per_slot = 45 → made_to_order_cap = 14 (30%)
```

---

### 🔧 5. Slot Timing (per day)
**Table**: `slot_control` columns
```
morning_start        = '07:00' (DEFAULT)
morning_end          = '11:00' (DEFAULT)
afternoon_start      = '11:30' (DEFAULT)
afternoon_end        = '17:00' (DEFAULT)
evening_start        = '18:00' (DEFAULT)
evening_end          = '21:30' (DEFAULT)
```

**Modifiable by**: Canteen admin
**When changed**: Time slots are regenerated for the canteen

---

### 🔧 6. Slot Duration (slot_duration_mins)
**Table**: `slot_control.slot_duration_mins`
**Default**: 15 minutes
**Allowed values**: 10, 15, 20
**Modifiable by**: Canteen admin
**Example**:
```
Morning 07:00-11:00 with 15min slots:
  07:00-07:15, 07:15-07:30, 07:30-07:45, ..., 10:45-11:00
  → 16 slots

Morning 07:00-11:00 with 10min slots:
  07:00-07:10, 07:10-07:20, ..., 10:50-11:00
  → 24 slots
```

---

### 🔧 7. Grace Period
**Table**: `slot_control.grace_period_mins`
**Default**: 10 minutes
**Modifiable by**: Canteen admin
**Purpose**: Buffer time for late pickup before marking "late_pickup"

---

### 🔧 8. Extra Bin Fee
**Table**: `slot_control.extra_bin_fee_paise`
**Default**: 200 (₹2)
**Modifiable by**: Canteen admin
**Applied when**: Order needs >1 bin
**Example**:
```
Student orders 3 meals (needs 2 bins):
  Total = item_price + extra_bin_fee_paise (₹2)
```

---

### 🔧 9. Meals Per Bin
**Table**: `slot_control.meals_per_bin`
**Default**: 2
**Modifiable by**: Canteen admin
**Purpose**: Determines when an order overflows to extra bin
**Example**:
```
meals_per_bin = 2:
  1-2 meals → 1 bin
  3-4 meals → 2 bins
  5-6 meals → 3 bins
```

---

### 🔧 10. Snacks Per Bin
**Table**: `slot_control.snacks_per_bin`
**Default**: 5
**Modifiable by**: Canteen admin
**Purpose**: Separate capacity for non-meal items

---

### 📌 11. Menu Item Limits (Per-Item)
**Table**: `menu_items` columns
```
is_meal              = false/true (item type)
availability_type    = 'batched_prepared' (DEFAULT)
quantity_per_slot    = null or INTEGER (e.g., 10)
total_per_day        = null or INTEGER (e.g., 50)
cancelled_quantity   = 0 (tracked)
is_available         = true/false (toggle)
```

**Modifiable by**: Canteen admin (Inventory Dashboard)

**Example**:
```
Item: "Biryani"
  is_meal = true
  quantity_per_slot = 20 (max 20 per slot)
  total_per_day = 100 (max 100 across all slots)
  
When slot reaches 20 biryani orders → SOLD OUT
When day reaches 100 biryani orders → SOLD OUT for entire day
```

---

## Fixed (NOT Configurable)

### 🔒 Color Zones (Fixed)
**Hardcoded in**: `lib/binProvisioning.ts`
```typescript
const BIN_ZONES = ["red", "yellow", "green", "blue", "purple", "orange"]
```

**Why fixed**: From client PDF requirements (page 10)

**Distribution algorithm**:
```
For max_bins = N:
  bins_per_zone = FLOOR(N / 6)
  extra_bins = N % 6
  
  Zones 0..extra_bins-1 get +1 bin
  Remaining zones get base bins
  
Result: bins distributed as evenly as possible across 6 zones
```

**Example**:
```
max_bins = 12:
  12 / 6 = 2 bins per zone, 0 remainder
  → Each zone: 2 bins
  
max_bins = 13:
  13 / 6 = 2 bins per zone, 1 remainder
  → Red zone: 3 bins, others: 2 bins
  
max_bins = 60:
  60 / 6 = 10 bins per zone, 0 remainder
  → Each zone: 10 bins
```

---

## API Endpoints for Dynamic Configuration

### GET /api/canteen/slot-control
**Purpose**: Read current configuration
**Returns**: 
```json
{
  "slot_control": {
    "canteen_id": "uuid",
    "max_bins": 60,
    "slot_duration_mins": 15,
    "morning_start": "07:00",
    "morning_end": "11:00",
    "max_orders_per_slot": 45,
    "batched_prepared_cap": 31,
    "made_to_order_cap": 14,
    ...
  },
  "capacity": {
    "maxBins": 60,
    "maxOrdersPerSlot": 45,
    "batchedPreparedCap": 31,
    "madeToOrderCap": 14,
    "bufferBins": 15
  },
  "windows": [
    { "label": "Morning", "slots": [...] },
    { "label": "Afternoon", "slots": [...] },
    { "label": "Evening", "slots": [...] }
  ]
}
```

### POST /api/canteen/slot-control
**Purpose**: Update configuration
**Allowed fields**:
- `max_bins` (1-1000)
- `slot_duration_mins` (10, 15, 20)
- `morning_start`, `morning_end` (HH:MM format)
- `afternoon_start`, `afternoon_end`
- `evening_start`, `evening_end`
- `grace_period_mins` (0+)
- `extra_bin_fee_paise` (0+)
- `meals_per_bin` (1+)
- `snacks_per_bin` (1+)

**Side effects**:
- Recalculates max_orders_per_slot
- Regenerates time_slots
- Regenerates bins (if max_bins changed)

---

## Database Schema

### slot_control table (per canteen, one row)
```sql
CREATE TABLE slot_control (
  canteen_id              uuid PRIMARY KEY,
  max_bins                int NOT NULL DEFAULT 60,
  slot_duration_mins      int NOT NULL DEFAULT 15,
  morning_start           time NOT NULL DEFAULT '07:00',
  morning_end             time NOT NULL DEFAULT '11:00',
  afternoon_start         time NOT NULL DEFAULT '11:30',
  afternoon_end           time NOT NULL DEFAULT '17:00',
  evening_start           time NOT NULL DEFAULT '18:00',
  evening_end             time NOT NULL DEFAULT '21:30',
  grace_period_mins       int NOT NULL DEFAULT 10,
  extra_bin_fee_paise     int NOT NULL DEFAULT 200,
  meals_per_bin           int NOT NULL DEFAULT 2,
  snacks_per_bin          int NOT NULL DEFAULT 5,
  
  -- AUTO-GENERATED (never insert manually):
  max_orders_per_slot     int GENERATED ALWAYS AS (FLOOR(max_bins * 0.75)::int) STORED,
  batched_prepared_cap    int GENERATED ALWAYS AS (FLOOR(FLOOR(max_bins * 0.75) * 0.70)::int) STORED,
  made_to_order_cap       int GENERATED ALWAYS AS (...) STORED,
  
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
```

---

## How Tests Validate Dynamicity

### ✅ Test Pattern: Don't Hardcode, Read from DB
**BAD**:
```typescript
// ❌ Wrong: assumes max_bins = 60
const maxOrdersExpected = 45;
```

**GOOD**:
```typescript
// ✅ Right: fetch from slot_control
const { data: sc } = await admin.from("slot_control")
  .select("max_bins")
  .eq("canteen_id", canteenId)
  .single();
const maxBins = Number(sc?.max_bins) || 60;
const maxOrders = Math.floor(maxBins * 0.75);
```

### ✅ Test Pattern: Verify Calculation
```typescript
// Verify the formula is applied correctly
const maxBins = 120;
const expectedOrders = Math.floor(120 * 0.75); // 90
const expectedBatched = Math.floor(90 * 0.70); // 63
const expectedMTO = 90 - 63; // 27

const capacity = computeSlotCapacity(maxBins);
expect(capacity.maxOrdersPerSlot).toBe(expectedOrders);
expect(capacity.batchedPreparedCap).toBe(expectedBatched);
expect(capacity.madeToOrderCap).toBe(expectedMTO);
```

### ✅ Test Pattern: Verify Change Propagation
```typescript
// Change max_bins → verify recalculation
await admin.from("slot_control")
  .update({ max_bins: 90 })
  .eq("canteen_id", canteenId);

// Bins should be regenerated
const { data: bins } = await admin.from("bins")
  .select("*")
  .eq("canteen_id", canteenId);
// Should have 90 bins split across 6 zones
expect(bins.length).toBe(90);
```

---

## Test Coverage Checklist

- [ ] Test slot_control defaults on canteen creation
- [ ] Test max_bins modification triggers bin regeneration
- [ ] Test slot_duration_mins changes regenerate time_slots
- [ ] Test morning/afternoon/evening time range modifications
- [ ] Test grace_period_mins in late pickup detection
- [ ] Test extra_bin_fee_paise charged correctly
- [ ] Test meals_per_bin overflow calculation
- [ ] Test snacks_per_bin separate from meals
- [ ] Test menu_item quantity_per_slot enforcement
- [ ] Test menu_item total_per_day enforcement
- [ ] Test is_available toggle affects order placement
- [ ] Test 6 color zones never change
- [ ] Test bin distribution across zones (even split)
- [ ] Test no hardcoded 60, 45, 75%, 70%, 30% anywhere in tests

---

## Migration Guide: Existing Deployments

If your deployment hardcodes max_bins = 60:

1. **Add slot_control row**:
   ```sql
   INSERT INTO slot_control (canteen_id, max_bins) 
   SELECT id, 60 FROM canteens
   ON CONFLICT (canteen_id) DO NOTHING;
   ```

2. **Backfill existing bins** (optional):
   ```sql
   DELETE FROM bins WHERE is_occupied = false AND assigned_order_id IS NULL;
   -- Then regenerate via POST /api/canteen/bins/regenerate
   ```

3. **Update all hardcoded 60 → slot_control.max_bins lookup**

---

## References

- **Phase 1 Migration**: `supabase/migrations/phase1_data_foundation.sql`
- **Slot Capacity Logic**: `lib/slotCapacity.ts`
- **Bin Provisioning**: `lib/binProvisioning.ts`
- **API**: `/api/canteen/slot-control/route.ts`
- **Schema**: `supabase/schema.sql` (consolidated)


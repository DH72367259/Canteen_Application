# NoQx - Smart Institutional Dining Platform

End-to-end multi-role canteen management app built with Next.js App Router + Firebase + TypeScript.

## 🎯 Platform Overview

NoQx is a comprehensive institutional dining solution supporting 5 user roles with specialized workflows for ordering, management, staff operations, and administrative oversight.

### Platform Capabilities
- ✅ **Role-Based Access Control** - 5 distinct user roles with tailored workflows
- ✅ **Real-time Order Processing** - Live order status updates with 5-second refresh
- ✅ **Slot-Based Ordering** - Queue-skip system with time slot management
- ✅ **Waste Tracking System** - Worker-reported waste management with bin status monitoring
- ✅ **Reward System** - Points-based loyalty with 14-day expiry and redemption
- ✅ **Multi-Vendor Support** - Support for multiple vendors per canteen with menu management
- ✅ **OTP-Based Verification** - Secure pickup verification system
- ✅ **Firebase Real-time Sync** - Firestore-backed persistent storage with high-concurrency support
- ✅ **Secure API Access** - Firebase ID token verification on all endpoints

## Tech

- Next.js 16 (App Router)
- React 19
- TypeScript
- Tailwind CSS (with custom CSS styling)
- Firebase Auth
- Cloud Firestore
- Firebase Hosting (framework-aware deploy)

---

## 📋 Implemented Workflows & Features

### 1️⃣ User (Customer) Workflow

| Feature | Status | Details |
|---------|--------|---------|
| **Anonymous/Email Sign-in** | ✅ Complete | Firebase Auth with multiple providers |
| **Browse Canteens** | ✅ Complete | List available canteens with operating hours |
| **View Menus** | ✅ Complete | Dynamic menu display by vendor |
| **Browse Menu Items** | ✅ Complete | Item details: name, description, price, prep time, availability |
| **Shopping Cart** | ✅ Complete | Add/remove items, update quantities |
| **Slot Selection** | ✅ Complete | Choose available time slots to skip queue |
| **Place Order** | ✅ Complete | Submit orders with selected items and slot |
| **Track Own Orders** | ✅ Complete | Real-time status updates (Confirmed → Preparing → Ready → Collected) |
| **View Reward Balance** | ✅ Complete | NoQx Cash display with 14-day expiry |
| **Redeem Rewards** | ✅ Complete | Apply rewards up to ₹20 per order |
| **Receive OTP** | ✅ Complete | SMS OTP for secure pickup verification |
| **Dashboard Access** | ✅ Complete | `/dashboard` with account & order history |

**Entry Point**: `/login` → Anonymous or Email/Password

---

### 2️⃣ Canteen Admin Workflow

| Feature | Status | Details |
|---------|--------|---------|
| **Email/Password Sign-in** | ✅ Complete | Firebase Auth with admin verification |
| **View All Orders** | ✅ Complete | Real-time list of orders for managed canteen |
| **Order Status Pipeline** | ✅ Complete | Move orders through: Confirmed → Preparing → Ready → Collected |
| **Active Filters** | ✅ Complete | Filter by order status (Confirmed, Preparing, Ready, Collected) |
| **Live Auto-Refresh** | ✅ Complete | 5-second refresh interval for order list |
| **Order Statistics** | ✅ Complete | Display count for each status category |
| **Manage Staff** | 🔄 Planned | Assign staff to canteen (future) |
| **Shift Management** | 🔄 Planned | Create and manage work shifts (future) |
| **Dashboard Access** | ✅ Complete | `/admin` with order management UI |

**Entry Point**: `/login` → `/admin` (role-based redirect)

---

### 3️⃣ Vendor Workflow

| Feature | Status | Details |
|---------|--------|---------|
| **Email/Password Sign-in** | ✅ Complete | Firebase Auth with vendor verification |
| **Manage Menu Items** | 🔄 In Progress | Add/edit/delete menu items with pricing |
| **Manage Staff Access** | 🔄 Planned | Control which workers can access vendor menu (future) |
| **View Assigned Slots** | 🔄 Planned | See available time slots for orders (future) |
| **Generate Reports** | 🔄 Planned | Slot-based order reports by time period (future) |
| **Manage Availability** | 🔄 Planned | Set item availability status (future) |
| **Dashboard Access** | ✅ Complete | `/vendor` with vendor-specific modules |

**Entry Point**: `/login` → `/vendor` (role-based redirect)

---

### 4️⃣ Worker Workflow

| Feature | Status | Details |
|---------|--------|---------|
| **Email/Password Sign-in** | ✅ Complete | Firebase Auth with worker verification |
| **View Order Assignments** | 🔄 Planned | See orders assigned to worker (future) |
| **Order Preparation** | 🔄 Planned | Track item prep status (future) |
| **Bin Management** | 🔄 Planned | Place prepared orders in assigned bins (future) |
| **Report Waste** | ✅ Complete | Log waste with bin ID, weight, notes |
| **Waste Form** | ✅ Complete | Form to select bin, enter weight in kg, add observations |
| **View Waste History** | 🔄 Planned | See submitted waste reports (future) |
| **OTP Verification** | 🔄 Planned | Verify customer OTP at pickup (future) |
| **Dashboard Access** | ✅ Complete | `/worker` with waste reporting interface |

**Entry Point**: `/login` → `/worker` (role-based redirect)

---

### 5️⃣ Super Admin Workflow

| Feature | Status | Details |
|---------|--------|---------|
| **Super Admin Sign-in** | ✅ Complete | Firebase Auth with super admin verification |
| **System Configuration** | 🔄 Planned | Global settings and configurations (future) |
| **User Management** | 🔄 Planned | Create/manage/delete users by role (future) |
| **Role Assignment** | 🔄 Planned | Assign roles and permissions to users (future) |
| **View System Analytics** | 🔄 Planned | System-wide metrics and reports (future) |
| **Dashboard Access** | ✅ Complete | `/system/admin` for system-wide management |

**Entry Point**: `/login` → `/system/admin` (role-based redirect)

---

### 6️⃣ Cross-Workflow Features

| Feature | Workflows | Status | Details |
|---------|-----------|--------|---------|
| **Order Status Pipeline** | User, Admin | ✅ Complete | States: Confirmed → Preparing → Ready → Collected |
| **Real-time Updates** | User, Admin | ✅ Complete | 5-second auto-refresh with live status sync |
| **Authentication** | All | ✅ Complete | Firebase Auth with role-based routing |
| **Reward System** | User | ✅ Complete | Earn ₹1-2 points/order, max ₹20 redemption/order |
| **Bin Management** | Worker | ✅ Complete | Waste bin assignment with status (normal/warning/full) |
| **Waste Tracking** | Worker/Admin | ✅ Complete | Weight logging, history, bin status |
| **OTP Verification** | User/Worker | ✅ Complete | SMS OTP generation and validation |

## Scripts

- `npm run dev`: Start the development server.
- `npm run build`: Create a production build.
- `npm run start`: Start the production server.
- `npm run lint`: Run ESLint.
- `npm run firebase:login`: Login to Firebase CLI.
- `npm run firebase:deploy`: Deploy only to the `canteen-isolated` Firebase project alias.
- `npm run firebase:deploy:hosting`: Deploy only Canteen hosting target.
- `npm run firebase:deploy:canteen`: Deploy this app to isolated Firebase alias + hosting target.
- `npm run firebase:deploy:canteen:hosting`: Deploy only hosting for isolated target.
- `npm run admin:create -- --email=admin@yourdomain.com --password=StrongPass123!`: Create admin user + admin claim.

---

## 📊 Implementation Status

### ✅ Completed Features (Production Ready)
- [x] Multi-role authentication system (5 roles)
- [x] User/Customer order placement & tracking
- [x] Canteen admin order management interface
- [x] Real-time order status updates
- [x] Order status pipeline (Confirmed → Preparing → Ready → Collected)
- [x] Reward/loyalty system with points tracking
- [x] Waste bin management system
- [x] Worker waste reporting interface
- [x] Time slot-based ordering system
- [x] OTP-based order verification
- [x] Firebase Auth with role-based routing
- [x] Firestore integration for data persistence
- [x] API endpoints with token verification
- [x] Dashboard layouts for all roles
- [x] Type-safe codebase with TypeScript

### 🔄 In Progress Features
- [ ] Vendor menu item management interface
- [ ] Worker order assignment & preparation tracking
- [ ] Advanced waste analytics & reporting
- [ ] Staff shift management system

### 🗓️ Planned Features (v2.0+)
- [ ] Super admin system configuration panel
- [ ] User role management interface
- [ ] Multi-vendor order aggregation
- [ ] Pickup bin assignment visualization
- [ ] SMS notifications for order status
- [ ] Email notifications & receipts
- [ ] Advanced analytics & dashboards
- [ ] Inventory management for vendors
- [ ] Menu customization by time slot
- [ ] Bulk operations & batch processing
- [ ] Mobile app (React Native)

---

## 📱 Role-Based Feature Matrix

| Feature | User | Admin | Vendor | Worker | Super Admin |
|---------|------|-------|--------|--------|------------|
| Browse Canteens | ✅ | - | - | - | - |
| Browse Menus | ✅ | - | - | - | - |
| Place Orders | ✅ | - | - | - | - |
| Track Orders | ✅ | - | - | - | ✅ |
| View Rewards | ✅ | - | - | - | - |
| Redeem Rewards | ✅ | - | - | - | - |
| Manage Orders | - | ✅ | - | - | ✅ |
| View Analytics | - | ✅ | ✅ | - | ✅ |
| Manage Menu | - | - | ✅ | - | ✅ |
| Manage Staff | - | ✅ | ✅ | - | ✅ |
| Report Waste | - | - | - | ✅ | - |
| System Config | - | - | - | - | ✅ |
| User Management | - | - | - | - | ✅ |

## Application URLs

After deployment, replace `<your-canteen-domain>` with your Firebase Hosting domain:

### User Routes
| Route | Purpose |
|-------|---------|
| `/` | Home/landing page |
| `/login` | Authentication entry point |
| `/dashboard` | User order tracking & rewards |
| `/operations` | Order placement interface |

### Admin Routes  
| Route | Purpose |
|-------|---------|
| `/admin` | Canteen admin dashboard with order management |
| `/admin/users` | User management (admin only) |

### Vendor Routes
| Route | Purpose |
|-------|---------|
| `/vendor` | Vendor menu & staff management |

### Worker Routes
| Route | Purpose |
|-------|---------|
| `/worker` | Worker dashboard with waste reporting |

### System Routes
| Route | Purpose |
|-------|---------|
| `/system/admin` | Super admin system configuration |

### API Routes Summary
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/menu` | GET | Fetch menu items |
| `/api/orders` | GET/POST | List orders or create new |
| `/api/orders/:id/status` | PATCH | Update order status (admin) |
| `/api/bins` | GET | Get waste bins |
| `/api/slots` | GET | Get available time slots |
| `/api/waste-reports` | GET/POST | Waste management |

## API Endpoints

### Bins Management
- `GET /api/bins` - Get all waste bins for a canteen
- `GET /api/bins/{binId}` - Get specific bin details

### Menu Management  
- `GET /api/menu` - Get menu items for a canteen
- `GET /api/menu?vendorId={vendorId}` - Get vendor-specific menu

### Orders Management
- `GET /api/orders` - Get user's own orders OR all orders (admin)
- `POST /api/orders` - Create new order
- `PATCH /api/orders/:id/status` - Admin-only order status update

Supported statuses: `confirmed`, `preparing`, `ready_for_placement`, `collected`, `cancelled`

### Time Slots
- `GET /api/slots` - Get available time slots
- `GET /api/slots?canteenId={canteenId}` - Get slots for specific canteen
- `POST /api/slots` - Create new time slot (admin)

### Waste Reports
- `GET /api/waste-reports` - Get waste reports (filtered by role)
- `POST /api/waste-reports` - Submit waste report
- `GET /api/waste-reports/{binId}` - Get reports for specific bin

### Admin Operations
- `GET /api/admin/users` - Get all users with roles
- `POST /api/admin/users` - Create user with role

---

## Data Models

### Firestore Collections

| Collection | Purpose | Key Fields |
|------------|---------|-----------|
| **canteens** | Canteen information | id, name, location, vendorIds, operatingHours, active |
| **menus** | Menu items | id, vendorId, name, price, category, prepTime, available |
| **orders** | Customer orders | id, userId, items, status, totalAmount, pickupTime, otp |
| **users** | User profiles | uid, email, role, displayName, createdAt |
| **bins** | Waste bins | id, canteenId, type, currentWaste, threshold, status |
| **wasteReports** | Waste logs | id, workerId, binId, weight, notes, timestamp |
| **rewards** | Loyalty points | userId, balance, redeemHistory, expiryDate |
| **slots** | Time slots | id, canteenId, date, startTime, endTime, capacity, orders |

## Environment

Copy `.env.example` to `.env.local` and fill all values.

Required keys:

- Client SDK: `NEXT_PUBLIC_FIREBASE_*`
- Admin SDK: `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`
- Admin allowlist: `ADMIN_EMAILS`

---

## 🎨 Design & Architecture Compliance

### Figma Navigation Map Alignment
Based on the **NoQx App Navigation Map** (accessible at: https://www.figma.com/board/cy47T4XWCDD00ZU8WZKW07/NoQx-App-Navigation-Map)

The application implements the following design structure:

#### Role-Based Navigation Hierarchy
```
┌─ User (Customer)
│  ├─ Login
│  ├─ Dashboard
│  ├─ Browse Canteens
│  ├─ Browse Menu
│  ├─ Cart & Checkout
│  ├─ Order Tracking
│  └─ Rewards
│
├─ Canteen Admin
│  ├─ Login
│  ├─ Admin Dashboard
│  ├─ Order Management (Pipeline View)
│  ├─ Order Filters (Confirmed, Preparing, Ready, Collected)
│  └─ Staff Management
│
├─ Vendor
│  ├─ Login
│  ├─ Vendor Dashboard
│  ├─ Menu Management
│  └─ Slot Reports
│
├─ Worker
│  ├─ Login
│  ├─ Worker Dashboard
│  ├─ Bin Assignment
│  └─ Waste Reporting
│
└─ Super Admin
   ├─ Login
   ├─ System Dashboard
   ├─ User Management
   └─ Global Configuration
```

### Implementation Compliance Matrix

| Screen/Feature | Figma Planned | Implemented | Notes |
|-----------|---------------|-------------|-------|
| **User Login** | ✅ | ✅ | Email/Anonymous auth |
| **User Dashboard** | ✅ | ✅ | Order history & rewards view |
| **Canteen Browse** | ✅ | ✅ | List with operating hours |
| **Menu Browse** | ✅ | ✅ | Items with vendor filtering |
| **Order Cart** | ✅ | ✅ | Add/remove items, slot selection |
| **Order Checkout** | ✅ | ✅ | Place order with rewards |
| **Order Tracking** | ✅ | ✅ | Real-time status updates |
| **Admin Login** | ✅ | ✅ | Role-based redirect |
| **Admin Dashboard** | ✅ | ✅ | Order management UI |
| **Order Pipeline** | ✅ | ✅ | Status: Confirmed→Preparing→Ready→Collected |
| **Order Filters** | ✅ | ✅ | Tab-based status filtering |
| **Real-time Updates** | ✅ | ✅ | 5-second auto-refresh |
| **Vendor Login** | ✅ | ✅ | Role-based redirect |
| **Vendor Dashboard** | ✅ | ✅ | Menu & staff management |
| **Menu Management** | ✅ | 🔄 | In progress for full CRUD |
| **Worker Login** | ✅ | ✅ | Role-based redirect |
| **Worker Dashboard** | ✅ | ✅ | Bin assignment & tracking |
| **Waste Reporting** | ✅ | ✅ | Form with validation |
| **Bin Management** | ✅ | ✅ | Status tracking (normal/warning/full) |
| **Super Admin Login** | ✅ | ✅ | System admin panel |
| **User Management** | ✅ | 🔄 | User creation & role assignment (planned) |

### Technology Stack Alignment

| Component | Figma Spec | Implemented |
|-----------|-----------|------------|
| Frontend Framework | React/Next.js | ✅ Next.js 16 + React 19 |
| Styling | Tailwind CSS | ✅ Tailwind + Custom CSS |
| Language | TypeScript | ✅ Full Type Safety |
| Backend | Firebase | ✅ Firestore + Auth |
| Hosting | Firebase Hosting | ✅ Configured |
| Database | Firestore | ✅ With Security Rules |
| Authentication | Firebase Auth | ✅ Multi-provider support |
| Real-time Sync | Firestore listeners | ✅ Implemented |

## Firebase Setup

### Quick Start

Your Firebase project is already created at: **canteen-dashboard-cfeb9**

**Step-by-step guides:**

1. **[Firebase Console Setup](./FIREBASE_CONSOLE_SETUP.md)** (5-10 min)
   - Enable authentication methods (Email/Password, Anonymous)
   - Create and configure Firestore database
   - Deploy security rules
   - Get Firebase config values

2. **[Environment Variables Setup](./SETUP_ENV.md)** (5 min)
   - Create `.env.local` file
   - Add Firebase credentials
   - Add Admin SDK key

3. **[Verify Setup](./DEPLOYMENT.md#verify-local-setup)** (2 min)
   - Run verification script: `node scripts/verify-firebase-setup.js`
   - Test local development: `npm run dev`
   - Test login flow

### Authentication Methods

The app uses role-based authentication with 5 roles:

| Role | Sign-in | Dashboard |
|------|---------|-----------|
| **Customer** | Anonymous or Email | `/dashboard` |
| **Canteen Admin** | Email/Password | `/admin/dashboard` |
| **Vendor** | Email/Password | `/vendor/dashboard` |
| **Worker** | Email/Password | `/worker/dashboard` |
| **Super Admin** | Email/Password | `/system/dashboard` |

### Firebase Project Configuration

Your project is configured in `.firebaserc`:
```json
{
  "projects": {
    "canteen-isolated": "canteen-dashboard-cfeb9"
  },
  "targets": {
    "canteen-isolated": {
      "hosting": {
        "canteenApp": ["canteen-dashboard-cfeb9"]
      }
    }
  }
}
```

### Data Models

Firestore collections (see [types/firestore.ts](./types/firestore.ts)):
- `canteens` - Institutional canteens
- `vendors` - Food suppliers
- `timeSlots` - Order time slots  
- `orders` - Customer orders
- `bins` - Waste bins
- `wasteReports` - Waste tracking
- `users` - User profiles & rewards
- `settlements` - Vendor payments
- `platformAnalytics` - Platform metrics

Complete CRUD operations in [lib/firestoreRepository.ts](./lib/firestoreRepository.ts)
5. Deploy security rules and indexes:
	- `firebase deploy --only firestore`
6. Create admin users in Firebase Auth and add their emails to `ADMIN_EMAILS`.

## Deploy

1. Install Firebase CLI globally: `npm i -g firebase-tools`
2. `npm run firebase:login`
3. `npm run firebase:deploy:canteen`

This repository is now pinned to the Canteen alias and hosting target, so Peter Foundation deployment is not touched by these commands.

## What You Need To Do

1. Update `.firebaserc` placeholders with real Canteen project id and hosting site id.
2. Create `.env.local` from `.env.example` and fill all values.
3. In Firebase Auth, enable providers:
	- Anonymous
	- Email/Password
4. Add `ADMIN_EMAILS` in environment values with your admin email(s).
5. Create admin credentials:
	- `npm run admin:create -- --email=admin@yourdomain.com --password=StrongPass123!`
6. Deploy Canteen only:
	- `npm run firebase:deploy:canteen`

No hardcoded username/password is shipped in code for security reasons. Credentials are created in your Firebase project using the command above.

## Performance and Security Notes

- Firestore provides low-latency indexed queries for the order timeline.
- Rules in `firestore.rules` restrict customer access to their own orders.
- Server APIs verify Firebase ID tokens on every protected request.
- Admin operations are role-protected using verified token + `ADMIN_EMAILS` allowlist.

## Run

1. `npm install`
2. `npm run dev`
3. Open `http://localhost:3000`

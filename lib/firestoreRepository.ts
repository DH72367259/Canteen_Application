/**
 * Firestore repository layer for all data operations
 * Uses Admin SDK (firebase-admin) for server-side operations
 */

import { getAdminDb } from "./firebaseAdmin";
import type {
  Canteen,
  Vendor,
  MenuItem,
  TimeSlot,
  Bin,
  WasteReport,
  Reward,
  UserProfile,
  Settlement,
} from "@/types/firestore";

// Helper to get Firestore instance
function getDb() {
  return getAdminDb();
}

// ===== CANTEEN OPERATIONS =====

export async function createCanteen(canteen: Partial<Canteen>): Promise<Canteen> {
  const db = getDb();
  const canteenRef = db.collection("canteens").doc();
  const now = new Date().toISOString();
  const data: Canteen = {
    id: canteenRef.id,
    name: canteen.name || "New Canteen",
    location: canteen.location || "",
    vendorIds: canteen.vendorIds || [],
    operatingHours: canteen.operatingHours || { open: "08:00", close: "20:00" },
    active: canteen.active !== false,
    createdAt: now,
    updatedAt: now,
  };
  await canteenRef.set(data);
  return data;
}

export async function getCanteen(canteenId: string): Promise<Canteen | null> {
  const db = getDb();
  const snapshot = await db.collection("canteens").doc(canteenId).get();
  return snapshot.exists ? (snapshot.data() as Canteen) : null;
}

export async function listCanteens(): Promise<Canteen[]> {
  const db = getDb();
  const snapshot = await db.collection("canteens").where("active", "==", true).get();
  return snapshot.docs.map((doc) => doc.data() as Canteen);
}

export async function updateCanteen(canteenId: string, updates: Partial<Canteen>): Promise<void> {
  const db = getDb();
  await db
    .collection("canteens")
    .doc(canteenId)
    .update({
      ...updates,
      updatedAt: new Date().toISOString(),
    });
}

// ===== VENDOR OPERATIONS =====

export async function createVendor(vendor: Partial<Vendor>): Promise<Vendor> {
  const db = getDb();
  const vendorRef = db.collection("vendors").doc();
  const now = new Date().toISOString();
  const data: Vendor = {
    id: vendorRef.id,
    name: vendor.name || "New Vendor",
    email: vendor.email || "",
    phone: vendor.phone || "",
    canteenIds: vendor.canteenIds || [],
    menuItems: vendor.menuItems || [],
    active: vendor.active !== false,
    createdAt: now,
    updatedAt: now,
  };
  await vendorRef.set(data);
  return data;
}

export async function getVendor(vendorId: string): Promise<Vendor | null> {
  const db = getDb();
  const snapshot = await db.collection("vendors").doc(vendorId).get();
  return snapshot.exists ? (snapshot.data() as Vendor) : null;
}

export async function listVendors(canteenId?: string): Promise<Vendor[]> {
  const db = getDb();
  let query = db.collection("vendors").where("active", "==", true);
  if (canteenId) {
    query = query.where("canteenIds", "array-contains", canteenId);
  }
  const snapshot = await query.get();
  return snapshot.docs.map((doc) => doc.data() as Vendor);
}

export async function updateVendor(vendorId: string, updates: Partial<Vendor>): Promise<void> {
  const db = getDb();
  await db
    .collection("vendors")
    .doc(vendorId)
    .update({
      ...updates,
      updatedAt: new Date().toISOString(),
    });
}

// ===== MENU ITEM OPERATIONS =====

export async function createMenuItem(item: Partial<MenuItem>): Promise<MenuItem> {
  const db = getDb();
  const itemRef = db.collection("menuItems").doc();
  const now = new Date().toISOString();
  const data: MenuItem = {
    id: itemRef.id,
    vendorId: item.vendorId || "",
    canteenId: item.canteenId || "",
    name: item.name || "New Item",
    description: item.description || "",
    price: item.price || 0,
    category: item.category || "meal",
    available: item.available !== false,
    prepTime: item.prepTime || 15,
    createdAt: now,
    updatedAt: now,
  };
  await itemRef.set(data);
  return data;
}

export async function getMenuItems(vendorId: string): Promise<MenuItem[]> {
  const db = getDb();
  const snapshot = await db
    .collection("menuItems")
    .where("vendorId", "==", vendorId)
    .where("available", "==", true)
    .get();
  return snapshot.docs.map((doc) => doc.data() as MenuItem);
}

// ===== TIME SLOT OPERATIONS =====

export async function createTimeSlot(slot: Partial<TimeSlot>): Promise<TimeSlot> {
  const db = getDb();
  const slotRef = db.collection("timeSlots").doc();
  const now = new Date().toISOString();
  const data: TimeSlot = {
    id: slotRef.id,
    canteenId: slot.canteenId || "",
    date: slot.date || new Date().toISOString().split("T")[0],
    startTime: slot.startTime || "12:00",
    endTime: slot.endTime || "13:00",
    capacity: slot.capacity || 50,
    currentCount: slot.currentCount || 0,
    orders: slot.orders || [],
    active: slot.active !== false,
    createdAt: now,
    updatedAt: now,
  };
  await slotRef.set(data);
  return data;
}

export async function getAvailableSlots(canteenId: string, date: string): Promise<TimeSlot[]> {
  const db = getDb();
  const snapshot = await db
    .collection("timeSlots")
    .where("canteenId", "==", canteenId)
    .where("date", "==", date)
    .where("active", "==", true)
    .get();
  return snapshot.docs
    .map((doc) => doc.data() as TimeSlot)
    .filter((slot) => slot.currentCount < slot.capacity);
}

// ===== BIN OPERATIONS =====

export async function createBin(bin: Partial<Bin>): Promise<Bin> {
  const db = getDb();
  const binRef = db.collection("bins").doc();
  const now = new Date().toISOString();
  const data: Bin = {
    id: binRef.id,
    canteenId: bin.canteenId || "",
    type: bin.type || "mixed",
    currentWaste: bin.currentWaste || 0,
    threshold: bin.threshold || 20,
    lastEmptied: bin.lastEmptied || now,
    status: bin.status || "normal",
    createdAt: now,
    updatedAt: now,
  };
  await binRef.set(data);
  return data;
}

export async function getBinsForCanteen(canteenId: string): Promise<Bin[]> {
  const db = getDb();
  const snapshot = await db.collection("bins").where("canteenId", "==", canteenId).get();
  return snapshot.docs.map((doc) => doc.data() as Bin);
}

export async function updateBinStatus(binId: string, waste: number): Promise<void> {
  const db = getDb();
  const binRef = db.collection("bins").doc(binId);
  const snapshot = await binRef.get();
  if (!snapshot.exists) return;

  const bin = snapshot.data() as Bin;
  const newWaste = bin.currentWaste + waste;
  const status: "normal" | "warning" | "full" =
    newWaste >= bin.threshold ? "full" : newWaste >= bin.threshold * 0.8 ? "warning" : "normal";

  await binRef.update({
    currentWaste: newWaste,
    status,
    updatedAt: new Date().toISOString(),
  });
}

// ===== WASTE REPORT OPERATIONS =====

export async function createWasteReport(report: Partial<WasteReport>): Promise<WasteReport> {
  const db = getDb();
  const reportRef = db.collection("wasteReports").doc();
  const now = new Date().toISOString();
  const data: WasteReport = {
    id: reportRef.id,
    canteenId: report.canteenId || "",
    workerId: report.workerId || "",
    binId: report.binId || "",
    weight: report.weight || 0,
    notes: report.notes || "",
    timestamp: report.timestamp || now,
    createdAt: now,
  };
  await reportRef.set(data);
  return data;
}

// ===== REWARD OPERATIONS =====

export async function getOrCreateReward(userId: string): Promise<Reward> {
  const db = getDb();
  const rewardRef = db.collection("rewards").doc(userId);
  const snapshot = await rewardRef.get();

  if (snapshot.exists) {
    return snapshot.data() as Reward;
  }

  const now = new Date().toISOString();
  const newReward: Reward = {
    id: userId,
    userId,
    points: 0,
    balance: 0,
    redeemHistory: [],
    createdAt: now,
    updatedAt: now,
  };
  await rewardRef.set(newReward);
  return newReward;
}

export async function addRewardPoints(userId: string, points: number): Promise<void> {
  const db = getDb();
  const rewardRef = db.collection("rewards").doc(userId);
  const snapshot = await rewardRef.get();

  if (!snapshot.exists) {
    await getOrCreateReward(userId);
  }

  const currentReward = snapshot.exists ? (snapshot.data() as Reward) : { points: 0, balance: 0 };

  await rewardRef.update({
    points: currentReward.points + points,
    balance: currentReward.balance + points,
    updatedAt: new Date().toISOString(),
  });
}

// ===== USER PROFILE OPERATIONS =====

export async function createUserProfile(profile: Partial<UserProfile>): Promise<UserProfile> {
  const db = getDb();
  const now = new Date().toISOString();
  const data: UserProfile = {
    uid: profile.uid || "",
    email: profile.email || "",
    name: profile.name || "",
    phone: profile.phone,
    role: profile.role || "customer",
    canteenId: profile.canteenId,
    vendorId: profile.vendorId,
    active: profile.active !== false,
    createdAt: now,
    updatedAt: now,
  };
  const userRef = db.collection("users").doc(data.uid);
  await userRef.set(data);
  return data;
}

export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  const db = getDb();
  const snapshot = await db.collection("users").doc(userId).get();
  return snapshot.exists ? (snapshot.data() as UserProfile) : null;
}

export async function updateUserProfile(userId: string, updates: Partial<UserProfile>): Promise<void> {
  const db = getDb();
  await db
    .collection("users")
    .doc(userId)
    .update({
      ...updates,
      updatedAt: new Date().toISOString(),
    });
}

// ===== SETTLEMENT OPERATIONS =====

export async function createSettlement(settlement: Partial<Settlement>): Promise<Settlement> {
  const db = getDb();
  const settlementRef = db.collection("settlements").doc();
  const now = new Date().toISOString();
  const data: Settlement = {
    id: settlementRef.id,
    vendorId: settlement.vendorId || "",
    canteenId: settlement.canteenId || "",
    period: settlement.period || new Date().toISOString().substring(0, 7),
    totalOrders: settlement.totalOrders || 0,
    totalAmount: settlement.totalAmount || 0,
    commissionRate: settlement.commissionRate || 15,
    commissionAmount: settlement.commissionAmount || 0,
    netAmount: settlement.netAmount || 0,
    status: settlement.status || "pending",
    createdAt: now,
  };
  await settlementRef.set(data);
  return data;
}

export async function getSettlementsForVendor(vendorId: string): Promise<Settlement[]> {
  const db = getDb();
  const snapshot = await db
    .collection("settlements")
    .where("vendorId", "==", vendorId)
    .orderBy("createdAt", "desc")
    .get();
  return snapshot.docs.map((doc) => doc.data() as Settlement);
}

// ===== MENU OPERATIONS (continued) =====

export async function getAllMenuItems(): Promise<MenuItem[]> {
  const db = getDb();
  const snapshot = await db.collection("menuItems").where("available", "==", true).get();
  return snapshot.docs.map((doc) => doc.data() as MenuItem);
}

// ===== TIME SLOT OPERATIONS (continued) =====

export async function getAvailableTimeSlots(): Promise<TimeSlot[]> {
  const db = getDb();
  const today = new Date().toISOString().split("T")[0];
  const snapshot = await db
    .collection("timeSlots")
    .where("available", "==", true)
    .where("date", ">=", today)
    .orderBy("date", "asc")
    .orderBy("startTime", "asc")
    .limit(20)
    .get();
  return snapshot.docs.map((doc) => doc.data() as TimeSlot);
}

// ===== ORDER OPERATIONS =====

export async function createOrder(order: any): Promise<any> {
  const db = getDb();
  const orderRef = db.collection("canteens").doc(order.canteenId || "default").collection("orders").doc();
  const now = new Date().toISOString();
  const data = {
    id: orderRef.id,
    ...order,
    createdAt: now,
    updatedAt: now,
    status: "received",
  };
  await orderRef.set(data);
  return data;
}

export async function getOrder(orderId: string): Promise<any> {
  const db = getDb();
  // Search in default canteen first
  let snapshot = await db.collection("canteens").doc("default").collection("orders").doc(orderId).get();
  if (snapshot.exists) {
    return snapshot.data();
  }
  
  // Search across all canteens
  const canteensSnapshot = await db.collection("canteens").get();
  for (const canteenDoc of canteensSnapshot.docs) {
    const orderSnapshot = await db.collection("canteens").doc(canteenDoc.id).collection("orders").doc(orderId).get();
    if (orderSnapshot.exists) {
      return orderSnapshot.data();
    }
  }
  
  return null;
}

export async function getOrdersByCustomer(customerId: string): Promise<any[]> {
  const db = getDb();
  const allOrders: any[] = [];
  
  // Search across all canteens
  const canteensSnapshot = await db.collection("canteens").get();
  for (const canteenDoc of canteensSnapshot.docs) {
    const ordersSnapshot = await db
      .collection("canteens")
      .doc(canteenDoc.id)
      .collection("orders")
      .where("customerId", "==", customerId)
      .orderBy("createdAt", "desc")
      .get();
    
    allOrders.push(...ordersSnapshot.docs.map((doc) => doc.data()));
  }
  
  return allOrders;
}

export async function updateOrder(orderId: string, updates: any, canteenId: string = "default"): Promise<void> {
  const db = getDb();
  await db
    .collection("canteens")
    .doc(canteenId)
    .collection("orders")
    .doc(orderId)
    .update({
      ...updates,
      updatedAt: new Date().toISOString(),
    });
}

// ===== BIN OPERATIONS =====

export async function getAllBins(): Promise<Bin[]> {
  const db = getDb();
  const snapshot = await db.collection("bins").orderBy("createdAt", "asc").get();
  return snapshot.docs.map((doc) => doc.data() as Bin);
}

export async function getBin(binId: string): Promise<Bin | null> {
  const db = getDb();
  const snapshot = await db.collection("bins").doc(binId).get();
  return snapshot.exists ? (snapshot.data() as Bin) : null;
}

// ===== WASTE REPORT OPERATIONS =====

export async function getAllWasteReports(): Promise<WasteReport[]> {
  const db = getDb();
  const snapshot = await db
    .collection("wasteReports")
    .orderBy("timestamp", "desc")
    .limit(50)
    .get();
  return snapshot.docs.map((doc) => doc.data() as WasteReport);
}

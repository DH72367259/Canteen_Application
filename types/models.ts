/**
 * Data models for the Canteen-Application
 * TypeScript interfaces for all database collections
 */

import type { UserRole } from "./canteen";

export interface Canteen {
  id: string;
  name: string;
  location: string;
  vendorIds: string[];
  operatingHours: {
    open: string; // HH:mm
    close: string; // HH:mm
  };
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Vendor {
  id: string;
  name: string;
  email: string;
  phone: string;
  canteenIds: string[];
  menuItems: string[]; // Array of menu item IDs
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MenuItem {
  id: string;
  vendorId: string;
  canteenId: string;
  name: string;
  description: string;
  price: number;
  category: "meal" | "snack" | "drink" | "dessert";
  available: boolean;
  prepTime: number; // in minutes
  createdAt: string;
  updatedAt: string;
}

export interface TimeSlot {
  id: string;
  canteenId: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  capacity: number;
  currentCount: number;
  orders: string[]; // Array of order IDs
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Bin {
  id: string;
  canteenId: string;
  type: "organic" | "inorganic" | "mixed";
  currentWaste: number; // in kg
  threshold: number; // in kg
  lastEmptied: string;
  status: "normal" | "warning" | "full";
  createdAt: string;
  updatedAt: string;
}

export interface WasteReport {
  id: string;
  canteenId: string;
  workerId: string;
  binId: string;
  weight: number; // in kg
  notes: string;
  timestamp: string;
  createdAt: string;
}

export interface Reward {
  id: string;
  userId: string;
  points: number;
  balance: number;
  redeemHistory: Array<{
    pointsRedeemed: number;
    timestamp: string;
    orderId: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

export interface UserProfile {
  uid: string;
  email: string;
  name: string;
  phone?: string;
  role: UserRole;
  canteenId?: string;
  vendorId?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OrderWithMetadata {
  id: string;
  uid: string;
  customerName: string;
  customerPhone?: string;
  canteenId?: string;
  slotId?: string;
  vendorId?: string;
  items: Array<{
    itemId: string;
    name: string;
    unitPrice: number;
    quantity: number;
    lineTotal: number;
  }>;
  total: number;
  status: "received" | "preparing" | "ready" | "completed" | "cancelled";
  statusHistory: Array<{
    status: "received" | "preparing" | "ready" | "completed" | "cancelled";
    timestamp: string;
    updatedBy?: string;
  }>;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface Settlement {
  id: string;
  vendorId: string;
  canteenId: string;
  period: string; // YYYY-MM
  totalOrders: number;
  totalAmount: number;
  commissionRate: number; // percentage
  commissionAmount: number;
  netAmount: number;
  status: "pending" | "processed" | "paid";
  createdAt: string;
  processedAt?: string;
}

export interface PlatformAnalytics {
  id: string;
  date: string; // YYYY-MM-DD
  totalOrders: number;
  totalRevenue: number;
  activeUsers: number;
  activeCanteens: number;
  activeVendors: number;
  averageOrderValue: number;
  wasteReported: number; // in kg
  createdAt: string;
}

// Data models for the Canteen platform

export type OrderStatus = 
  | 'placed'
  | 'confirmed'
  | 'preparing'
  | 'ready_for_placement'
  | 'placed_in_bin'
  | 'ready_for_pickup'
  | 'collected'
  | 'cancelled';

export type UserType = 'student' | 'teacher' | 'visitor';

export interface MenuItem {
  id: string;
  canteenId: string;
  name: string;
  price: number;
  prepTime: number;
  category: 'breakfast' | 'lunch' | 'snacks' | 'dinner';
  image?: string;
  available: boolean;
  maxPerSlot: number;
}

export interface TimeSlot {
  id: string;
  canteenId: string;
  startTime: string; // HH:MM
  endTime: string;   // HH:MM
  capacity: number;
  itemCapacities: Record<string, number>; // itemId -> max orders
  currentOrders: number;
}

export interface OrderItem {
  menuItemId: string;
  quantity: number;
  price: number;
  name: string;
}

export interface Order {
  id: string;
  uid: string;
  canteenId: string;
  slotId: string;
  items: OrderItem[];
  totalAmount: number;
  status: OrderStatus;
  binNumber?: number;
  otp?: string;
  createdAt: string;
  pickupTime: string; // slot time
  completedAt?: string;
  rewardEarned?: number;
}

export interface Bin {
  id: string;
  canteenId: string;
  binNumber: number;
  color: string;
  status: 'empty' | 'occupied' | 'picked_up';
  currentOrder?: string; // orderId
  createdAt: string;
}

export interface Canteen {
  id: string;
  name: string;
  location: string;
  isOpen: boolean;
  workingHours: {
    start: string;
    end: string;
  };
  bins: number;
  createdAt: string;
}

export interface User {
  uid: string;
  email: string;
  name?: string;
  userType: UserType;
  role: 'user' | 'canteen_admin' | 'vendor' | 'worker' | 'super_admin';
  campusId?: string;
  canteenId?: string; // for vendors/admins
  walletBalance: number;
  ordersCount: number;
  joinedAt: string;
}

export interface Reward {
  id: string;
  uid: string;
  points: number;
  expiresAt: string;
  redeemed: boolean;
  redeemedAt?: string;
  createdAt: string;
}

export interface RewardTransaction {
  id: string;
  uid: string;
  type: 'earned' | 'redeemed' | 'expired';
  points: number;
  orderId?: string;
  reason: string;
  createdAt: string;
}

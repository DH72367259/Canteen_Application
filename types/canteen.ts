export type UserRole = "user" | "canteen_admin" | "vendor" | "worker" | "super_admin" | "co_admin";

export type MenuCategory = "meal" | "drink" | "snack";

export type MenuItem = {
  id: string;
  name: string;
  price: number;
  category: MenuCategory;
  available: boolean;
};

export type OrderItemInput = {
  itemId: string;
  quantity: number;
};

export type OrderItem = {
  itemId: string;
  name: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
};

export type OrderStatus = "received" | "preparing" | "ready" | "completed" | "cancelled";

export type CanteenOrder = {
  id: string;
  uid: string;
  customerName: string;
  items: OrderItem[];
  total: number;
  status: OrderStatus;
  createdAt: string;
  updatedAt?: string; // last DB update timestamp — used by student UI to compute the 5-min pickup countdown in batched_only
  // Extended fields (populated where available)
  canteenId?: string;
  canteenName?: string;
  paymentId?: string;
  slotName?: string;
  rawStatus?: string;
  cancellation_reason?: string | null;
  cancelled_at?: string | null;
  refund_status?: string | null;
  refund_id?: string | null;
  // Bin & OTP fields (set when order is placed via /api/orders/place)
  otp?: string;
  binLabel?: string;
  binColor?: string;
  binId?: string;
  pickupSlot?: string;
  slotLabel?: string;
  // Phase 7: extra-bin workflow
  binCount?: number;
  extraBinFeePaise?: number;
  binAssignments?: Array<{
    binIndex: number;
    binLabel: string;
    binColor: string;
    items: Array<{ name: string; quantity: number; isMeal?: boolean }>;
  }>;
};

export type CreateOrderRequest = {
  customerName: string;
  items: OrderItemInput[];
};

export type UserProfile = {
  uid: string;
  email: string;
  name: string;
  role: UserRole;
  canteenId?: string;
  createdAt: string;
  updatedAt: string;
};

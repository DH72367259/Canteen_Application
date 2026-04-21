export type UserRole = "user" | "canteen_admin" | "vendor" | "worker" | "super_admin";

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

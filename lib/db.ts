import {
  collection,
  query,
  where,
  getDocs,
  getDoc,
  doc,
  addDoc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { getDatabase } from './firebase';
import { Order, OrderStatus, Bin, Reward } from './types';

/**
 * Order Management
 */

export async function createOrder(orderData: Omit<Order, 'id' | 'createdAt'>) {
  const db = getDatabase();
  const docRef = await addDoc(collection(db, 'orders'), {
    ...orderData,
    createdAt: serverTimestamp(),
    status: 'placed',
  });
  return docRef.id;
}

export async function getOrder(orderId: string) {
  const db = getDatabase();
  const docRef = doc(db, 'orders', orderId);
  const docSnap = await getDoc(docRef);
  return docSnap.data() as Order | undefined;
}

export async function getUserOrders(uid: string) {
  const db = getDatabase();
  const q = query(collection(db, 'orders'), where('uid', '==', uid));
  const querySnapshot = await getDocs(q);
  return querySnapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  })) as (Order & { id: string })[];
}

export async function getCanteenOrders(canteenId: string, status?: OrderStatus) {
  const db = getDatabase();
  let q;
  if (status) {
    q = query(
      collection(db, 'orders'),
      where('canteenId', '==', canteenId),
      where('status', '==', status)
    );
  } else {
    q = query(collection(db, 'orders'), where('canteenId', '==', canteenId));
  }
  const querySnapshot = await getDocs(q);
  return querySnapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  })) as (Order & { id: string })[];
}

export async function updateOrderStatus(orderId: string, status: OrderStatus) {
  const db = getDatabase();
  const docRef = doc(db, 'orders', orderId);
  await updateDoc(docRef, { status });
}

export async function assignOrderToBin(orderId: string, binNumber: number) {
  const db = getDatabase();
  const docRef = doc(db, 'orders', orderId);
  const otp = generateOTP();
  await updateDoc(docRef, {
    binNumber,
    otp,
    status: 'ready_for_placement' as OrderStatus,
  });
  return otp;
}

/**
 * Bin Management
 */

export async function getAvailableBin(canteenId: string): Promise<Bin | null> {
  const db = getDatabase();
  const q = query(
    collection(db, 'bins'),
    where('canteenId', '==', canteenId),
    where('status', '==', 'empty')
  );
  const querySnapshot = await getDocs(q);
  return querySnapshot.docs.length > 0
    ? (querySnapshot.docs[0].data() as Bin)
    : null;
}

export async function updateBinStatus(
  binId: string,
  status: 'empty' | 'occupied' | 'picked_up',
  orderId?: string
) {
  const db = getDatabase();
  const docRef = doc(db, 'bins', binId);
  await updateDoc(docRef, {
    status,
    ...(orderId && { currentOrder: orderId }),
  });
}

/**
 * Rewards System
 */

export async function getUserRewardBalance(uid: string): Promise<number> {
  const db = getDatabase();
  const q = query(
    collection(db, 'rewards'),
    where('uid', '==', uid),
    where('redeemed', '==', false)
  );
  const querySnapshot = await getDocs(q);
  let total = 0;
  querySnapshot.forEach((docSnap) => {
    const reward = docSnap.data() as Reward;
    const expiresAt = new Date(reward.expiresAt);
    if (expiresAt > new Date()) {
      total += reward.points;
    }
  });
  return total;
}

export async function earnReward(
  uid: string,
  points: number,
  orderId: string,
  reason: string
) {
  const db = getDatabase();
  // Add reward points
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 14); // 14 days expiry

  await addDoc(collection(db, 'rewards'), {
    uid,
    points,
    expiresAt: expiresAt.toISOString(),
    redeemed: false,
    createdAt: serverTimestamp(),
  });

  // Record transaction
  await addDoc(collection(db, 'reward_transactions'), {
    uid,
    type: 'earned',
    points,
    orderId,
    reason,
    createdAt: serverTimestamp(),
  });
}

export async function redeemReward(uid: string, points: number, orderId: string) {
  const db = getDatabase();
  // Find and mark reward as redeemed
  const q = query(
    collection(db, 'rewards'),
    where('uid', '==', uid),
    where('redeemed', '==', false)
  );
  const querySnapshot = await getDocs(q);
  let remaining = points;

  for (const docSnap of querySnapshot.docs) {
    if (remaining <= 0) break;
    const reward = docSnap.data() as Reward;
    const deduct = Math.min(reward.points, remaining);

    if (deduct === reward.points) {
      await updateDoc(doc(db, 'rewards', docSnap.id), { redeemed: true });
    } else {
      // Split reward
      await updateDoc(doc(db, 'rewards', docSnap.id), {
        points: reward.points - deduct,
      });
    }

    remaining -= deduct;
  }

  // Record transaction
  await addDoc(collection(db, 'reward_transactions'), {
    uid,
    type: 'redeemed',
    points,
    orderId,
    reason: 'Order discount',
    createdAt: serverTimestamp(),
  });
}

/**
 * Utility Functions
 */

export function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export function calculateOrderRewards(orderAmount: number): number {
  // ₹50+ = ₹1, ₹100+ = ₹2
  if (orderAmount >= 100) return 2;
  if (orderAmount >= 50) return 1;
  return 0;
}

export function getOrderTime(slotStart: string): string {
  // Convert HH:MM to readable time
  return slotStart;
}

export function calculateRemainingCapacity(
  total: number,
  current: number
): number {
  return total - current;
}

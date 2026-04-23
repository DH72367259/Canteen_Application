'use client';

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { getUserOrders, getUserRewardBalance } from '@/lib/db';
import { Order } from '@/lib/types';

export default function UserDashboard() {
  const { user, logout } = useAuth();
  const [orders, setOrders] = useState<(Order & { id: string })[]>([]);
  const [rewards, setRewards] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      if (!user?.uid) return;
      try {
        const [userOrders, rewardBalance] = await Promise.all([
          getUserOrders(user.uid),
          getUserRewardBalance(user.uid),
        ]);
        setOrders(userOrders);
        setRewards(rewardBalance);
      } catch (err) {
        console.error('Failed to fetch user data:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [user?.uid]);

  if (loading) {
    return <div style={styles.center}>Loading dashboard...</div>;
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1>Canteen-Application – Dashboard</h1>
        <button onClick={logout} style={styles.logoutButton}>
          Logout
        </button>
      </div>

      <div style={styles.grid}>
        <div style={styles.card}>
          <h3>Account</h3>
          <p>Email: {user?.email || 'Anonymous'}</p>
          <p>Total Orders: {orders.length}</p>
        </div>

        <div style={styles.card}>
          <h3>Rewards (Canteen Cash)</h3>
          <p style={styles.largeText}>₹{rewards}</p>
          <p style={styles.smallText}>14 days expiry policy</p>
        </div>
      </div>

      <div style={styles.section}>
        <h2>Your Orders</h2>
        {orders.length === 0 ? (
          <p style={styles.emptyText}>No orders yet. Place your first order!</p>
        ) : (
          <div style={styles.ordersList}>
            {orders.map((order) => (
              <div key={order.id} style={styles.orderCard}>
                <div style={styles.orderHeader}>
                  <span>Order #{order.id.slice(0, 8)}</span>
                  <span style={styles.badge}>{order.status}</span>
                </div>
                <p>Amount: ₹{order.totalAmount}</p>
                <p>Pickup: {order.pickupTime}</p>
                {order.otp && <p style={styles.otp}>OTP: {order.otp}</p>}
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={styles.section}>
        <h3>How It Works</h3>
        <ul style={styles.list}>
          <li>Browse canteens and menus</li>
          <li>Slot-based ordering (skip queue)</li>
          <li>Earn ₹1-2 per order</li>
          <li>Use rewards (max ₹20/order)</li>
          <li>Pick up from assigned bin with OTP</li>
        </ul>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: '1000px',
    margin: '0 auto',
    padding: '20px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '30px',
    borderBottom: '2px solid #2563eb',
    paddingBottom: '20px',
  },
  logoutButton: {
    padding: '8px 16px',
    backgroundColor: '#dc2626',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
    gap: '20px',
    marginBottom: '30px',
  },
  card: {
    padding: '20px',
    backgroundColor: '#f0f9ff',
    borderRadius: '8px',
    borderLeft: '4px solid #2563eb',
  },
  largeText: {
    fontSize: '28px',
    fontWeight: 'bold',
    color: '#2563eb',
    margin: '10px 0',
  },
  smallText: {
    fontSize: '12px',
    color: '#666',
  },
  section: {
    marginBottom: '30px',
  },
  ordersList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  orderCard: {
    padding: '16px',
    backgroundColor: '#f9f9f9',
    borderRadius: '6px',
    border: '1px solid #ddd',
  },
  orderHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: '8px',
  },
  badge: {
    display: 'inline-block',
    padding: '4px 8px',
    backgroundColor: '#2563eb',
    color: 'white',
    borderRadius: '4px',
    fontSize: '12px',
  },
  otp: {
    fontWeight: 'bold',
    color: '#059669',
    fontSize: '16px',
  },
  list: {
    paddingLeft: '20px',
  },
  emptyText: {
    color: '#999',
    fontStyle: 'italic',
  },
  center: {
    textAlign: 'center',
    padding: '40px',
    color: '#666',
  },
};

'use client';

import React, { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { getCanteenOrders, updateOrderStatus } from '@/lib/db';
import { Order, OrderStatus } from '@/lib/types';

export default function CanteenAdminDashboard() {
  const { user, logout } = useAuth();
  const [orders, setOrders] = useState<(Order & { id: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<OrderStatus>('confirmed');

  useEffect(() => {
    const fetchOrders = async () => {
      if (!user?.uid) return;
      try {
        // For demo, fetch all orders (in production, get canteenId from user profile)
        const allOrders = await getCanteenOrders(user.uid);
        setOrders(allOrders);
      } catch (err) {
        console.error('Failed to fetch orders:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchOrders();
    const interval = setInterval(fetchOrders, 5000); // Refresh every 5 seconds
    return () => clearInterval(interval);
  }, [user?.uid]);

  const handleStatusChange = async (orderId: string, newStatus: OrderStatus) => {
    try {
      await updateOrderStatus(orderId, newStatus);
      setOrders((prev) =>
        prev.map((o) => (o.id === orderId ? { ...o, status: newStatus } : o))
      );
    } catch (err) {
      console.error('Failed to update order status:', err);
    }
  };

  const filteredOrders = orders.filter((o) => o.status === filter || filter === 'confirmed');

  if (loading) {
    return <div style={styles.center}>Loading orders...</div>;
  }

  const statusCounts = {
    confirmed: orders.filter((o) => o.status === 'confirmed').length,
    preparing: orders.filter((o) => o.status === 'preparing').length,
    ready: orders.filter((o) => o.status === 'ready_for_placement').length,
    collected: orders.filter((o) => o.status === 'collected').length,
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1>Canteen Admin Dashboard</h1>
        <button onClick={logout} style={styles.logoutButton}>
          Logout
        </button>
      </div>

      <div style={styles.stats}>
        <div style={styles.statCard}>
          <div style={styles.statNumber}>{statusCounts.confirmed}</div>
          <div>Confirmed</div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statNumber}>{statusCounts.preparing}</div>
          <div>Preparing</div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statNumber}>{statusCounts.ready}</div>
          <div>Ready</div>
        </div>
        <div style={styles.statCard}>
          <div style={styles.statNumber}>{statusCounts.collected}</div>
          <div>Collected</div>
        </div>
      </div>

      <div style={styles.filterTabs}>
        {(['confirmed', 'preparing', 'ready_for_placement', 'collected'] as const).map(
          (status) => (
            <button
              key={status}
              onClick={() => setFilter(status)}
              style={{
                ...styles.filterTab,
                ...(filter === status && styles.filterTabActive),
              }}
            >
              {status.replace(/_/g, ' ')}
            </button>
          )
        )}
      </div>

      <div style={styles.ordersContainer}>
        {filteredOrders.length === 0 ? (
          <p style={styles.emptyText}>No orders in this status</p>
        ) : (
          <div style={styles.ordersList}>
            {filteredOrders.map((order) => (
              <div key={order.id} style={styles.orderCard}>
                <div style={styles.orderTop}>
                  <div>
                    <div style={styles.orderId}>Order #{order.id.slice(0, 8)}</div>
                    <div style={styles.orderTime}>{order.pickupTime}</div>
                  </div>
                  <div style={styles.orderItems}>
                    {order.items.map((item, i) => (
                      <div key={i} style={styles.item}>
                        {item.quantity}x {item.name}
                      </div>
                    ))}
                  </div>
                  <div style={styles.orderTotal}>₹{order.totalAmount}</div>
                </div>

                <div style={styles.orderActions}>
                  <select
                    value={order.status}
                    onChange={(e) =>
                      handleStatusChange(order.id, e.target.value as OrderStatus)
                    }
                    style={styles.statusSelect}
                  >
                    <option value="confirmed">Confirmed</option>
                    <option value="preparing">Preparing</option>
                    <option value="ready_for_placement">Ready for Bin</option>
                    <option value="placed_in_bin">Placed in Bin</option>
                    <option value="ready_for_pickup">Ready for Pickup</option>
                    <option value="collected">Collected</option>
                  </select>

                  {order.otp && (
                    <div style={styles.otp}>
                      <span style={styles.otpLabel}>OTP:</span>
                      <span style={styles.otpValue}>{order.otp}</span>
                    </div>
                  )}

                  {order.binNumber && (
                    <div style={styles.bin}>
                      Bin #{order.binNumber}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: '1200px',
    margin: '0 auto',
    padding: '20px',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '30px',
    borderBottom: '2px solid #dc2626',
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
  stats: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
    gap: '15px',
    marginBottom: '30px',
  },
  statCard: {
    padding: '20px',
    backgroundColor: '#fef2f2',
    borderRadius: '8px',
    textAlign: 'center',
    border: '1px solid #fee2e2',
  },
  statNumber: {
    fontSize: '32px',
    fontWeight: 'bold',
    color: '#dc2626',
  },
  filterTabs: {
    display: 'flex',
    gap: '10px',
    marginBottom: '20px',
    borderBottom: '1px solid #ddd',
    overflowX: 'auto',
  },
  filterTab: {
    padding: '10px 16px',
    backgroundColor: 'transparent',
    border: 'none',
    borderBottom: '3px solid transparent',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    textTransform: 'capitalize',
  },
  filterTabActive: {
    borderBottomColor: '#dc2626',
    color: '#dc2626',
    fontWeight: 'bold',
  },
  ordersContainer: {
    backgroundColor: '#f9f9f9',
    borderRadius: '8px',
    padding: '20px',
  },
  ordersList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '15px',
  },
  orderCard: {
    padding: '16px',
    backgroundColor: 'white',
    borderRadius: '8px',
    border: '1px solid #e5e7eb',
    boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
  },
  orderTop: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: '12px',
    paddingBottom: '12px',
    borderBottom: '1px solid #f0f0f0',
  },
  orderId: {
    fontWeight: 'bold',
    fontSize: '16px',
  },
  orderTime: {
    fontSize: '12px',
    color: '#666',
    marginTop: '4px',
  },
  orderItems: {
    flex: 1,
    marginLeft: '20px',
  },
  item: {
    fontSize: '13px',
    color: '#333',
    marginBottom: '4px',
  },
  orderTotal: {
    fontWeight: 'bold',
    fontSize: '16px',
    color: '#2563eb',
    whiteSpace: 'nowrap',
    marginLeft: '20px',
  },
  orderActions: {
    display: 'flex',
    gap: '12px',
    alignItems: 'center',
  },
  statusSelect: {
    padding: '8px',
    border: '1px solid #ddd',
    borderRadius: '4px',
    fontSize: '13px',
  },
  otp: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 12px',
    backgroundColor: '#f0fdf4',
    borderRadius: '4px',
    border: '1px solid #dcfce7',
  },
  otpLabel: {
    fontSize: '12px',
    color: '#666',
  },
  otpValue: {
    fontWeight: 'bold',
    fontSize: '14px',
    color: '#059669',
    fontFamily: 'monospace',
  },
  bin: {
    padding: '8px 12px',
    backgroundColor: '#eff6ff',
    borderRadius: '4px',
    border: '1px solid #bfdbfe',
    fontSize: '13px',
    fontWeight: 'bold',
    color: '#1e40af',
  },
  emptyText: {
    textAlign: 'center',
    color: '#999',
    padding: '40px 20px',
  },
  center: {
    textAlign: 'center',
    padding: '40px',
    color: '#666',
  },
};

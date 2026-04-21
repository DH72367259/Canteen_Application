'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useUserRole } from '@/lib/rolesClient';

interface OrderItem {
  menuItemId: string;
  name: string;
  price: number;
  quantity: number;
}

interface Order {
  id: string;
  customerId: string;
  slotId: string;
  items: OrderItem[];
  status: 'received' | 'preparing' | 'ready' | 'completed' | 'cancelled';
  subtotal: number;
  tax: number;
  total: number;
  specialRequests?: string;
  createdAt: string;
  updatedAt: string;
  slotStartTime?: string;
  slotEndTime?: string;
}

const STATUS_COLORS: Record<string, string> = {
  received: 'bg-blue-100 text-blue-800',
  preparing: 'bg-yellow-100 text-yellow-800',
  ready: 'bg-green-100 text-green-800',
  completed: 'bg-gray-100 text-gray-800',
  cancelled: 'bg-red-100 text-red-800',
};

const STATUS_LABELS: Record<string, string> = {
  received: 'Order Received',
  preparing: 'Preparing',
  ready: 'Ready for Pickup',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export default function OrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const orderId = params.id as string;
  const { loading: roleLoading } = useUserRole();

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchOrder = async () => {
      try {
        const user = JSON.parse(localStorage.getItem('firebaseUser') || '{}');
        const idToken = user?.idToken;

        if (!idToken) {
          router.push('/login');
          return;
        }

        const response = await fetch(`/api/orders/${orderId}`, {
          headers: { Authorization: `Bearer ${idToken}` },
        });

        if (!response.ok) {
          throw new Error('Failed to fetch order');
        }

        const data = await response.json();
        setOrder(data.order);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load order');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    if (!roleLoading && orderId) {
      fetchOrder();
    }
  }, [orderId, roleLoading, router]);

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
          {error || 'Order not found'}
        </div>
        <Link href="/dashboard" className="text-accent hover:underline mt-4 block">
          ← Back to Dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold">Order #{order.id.slice(0, 8).toUpperCase()}</h1>
          <p className="text-gray-600">
            Placed on {new Date(order.createdAt).toLocaleDateString()}
          </p>
        </div>
        <Link href="/dashboard" className="text-accent hover:underline">
          ← Back
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Order Details */}
        <div className="lg:col-span-2 space-y-6">
          {/* Status */}
          <div className="bg-panel rounded-lg p-6 border border-line">
            <h2 className="text-xl font-bold mb-4">Order Status</h2>
            <div className={`${STATUS_COLORS[order.status]} px-4 py-3 rounded-lg text-center font-semibold`}>
              {STATUS_LABELS[order.status]}
            </div>

            {/* Status Timeline */}
            <div className="mt-6 space-y-4">
              {['received', 'preparing', 'ready', 'completed'].map((status, index) => (
                <div
                  key={status}
                  className={`flex items-center gap-4 pb-4 ${
                    index < 3 ? 'border-b border-line' : ''
                  }`}
                >
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-white ${
                      ['received', 'preparing', 'ready', 'completed'].indexOf(order.status) >=
                      index
                        ? 'bg-accent'
                        : 'bg-gray-300'
                    }`}
                  >
                    ✓
                  </div>
                  <div>
                    <p className="font-semibold capitalize">{STATUS_LABELS[status]}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Order Items */}
          <div className="bg-panel rounded-lg p-6 border border-line">
            <h2 className="text-xl font-bold mb-4">Order Items</h2>
            <div className="space-y-4">
              {order.items.map((item, index) => (
                <div key={index} className="flex justify-between items-center pb-4 border-b border-line last:border-b-0">
                  <div>
                    <p className="font-semibold">{item.name}</p>
                    <p className="text-sm text-gray-600">Qty: {item.quantity}</p>
                  </div>
                  <p className="font-semibold">₹{(item.price * item.quantity).toFixed(2)}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Special Requests */}
          {order.specialRequests && (
            <div className="bg-panel rounded-lg p-6 border border-line">
              <h2 className="text-xl font-bold mb-4">Special Requests</h2>
              <p className="text-gray-700">{order.specialRequests}</p>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Time Slot */}
          <div className="bg-panel rounded-lg p-6 border border-line">
            <h3 className="font-bold mb-3">Pickup Time</h3>
            <p className="text-2xl font-bold text-accent">
              {order.slotStartTime} - {order.slotEndTime}
            </p>
            <p className="text-sm text-gray-600 mt-2">
              Please pick up your order during this time slot
            </p>
          </div>

          {/* Order Summary */}
          <div className="bg-panel rounded-lg p-6 border border-line">
            <h3 className="font-bold mb-4">Order Summary</h3>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span>Subtotal:</span>
                <span>₹{order.subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span>Tax (5%):</span>
                <span>₹{order.tax.toFixed(2)}</span>
              </div>
              <div className="flex justify-between font-bold text-lg pt-3 border-t border-line">
                <span>Total:</span>
                <span className="text-accent">₹{order.total.toFixed(2)}</span>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="space-y-3">
            <button
              onClick={() => router.push('/dashboard')}
              className="w-full bg-accent text-white py-3 rounded font-bold hover:opacity-90"
            >
              Continue Shopping
            </button>
            <button
              onClick={() => window.print()}
              className="w-full bg-gray-200 text-gray-900 py-3 rounded font-bold hover:bg-gray-300"
            >
              Print Receipt
            </button>
          </div>

          {/* Help */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm">
            <p className="font-semibold mb-2">Need Help?</p>
            <p className="text-gray-700">
              Contact the canteen staff if you have any questions about your order.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

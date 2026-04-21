'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useUserRole } from '@/lib/rolesClient';

interface MenuItem {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  available: boolean;
  vegOnly?: boolean;
  image?: string;
}

interface TimeSlot {
  id: string;
  startTime: string;
  endTime: string;
  capacity: number;
  booked: number;
  available: boolean;
}

interface CartItem extends MenuItem {
  quantity: number;
  cartId?: string;
}

export default function OrderPage() {
  const router = useRouter();
  const { role, loading: roleLoading } = useUserRole();

  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCheckout, setShowCheckout] = useState(false);
  const [notes, setNotes] = useState('');
  const [placing, setPlacing] = useState(false);

  // Redirect non-customers
  useEffect(() => {
    if (!roleLoading && role && role !== 'user') {
      router.push('/dashboard');
    }
  }, [role, roleLoading, router]);

  // Get auth header
  const getAuthHeader = useCallback(async () => {
    const user = JSON.parse(localStorage.getItem('firebaseUser') || '{}');
    if (user.idToken) {
      return { Authorization: `Bearer ${user.idToken}` };
    }
    return { Authorization: '' };
  }, []);

  // Fetch menu and slots
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const authHeader = await getAuthHeader();

        // Fetch menu
        const menuRes = await fetch('/api/menu', { headers: authHeader });
        if (menuRes.ok) {
          const menuData = await menuRes.json();
          setMenuItems(menuData.items || []);
        }

        // Fetch time slots
        const slotsRes = await fetch('/api/slots', { headers: authHeader });
        if (slotsRes.ok) {
          const slotsData = await slotsRes.json();
          setTimeSlots(slotsData.slots || []);
        }

        setError('');
      } catch (err) {
        setError('Failed to load menu and slots');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    if (!roleLoading) {
      fetchData();
    }
  }, [roleLoading, getAuthHeader]);

  // Add to cart
  const addToCart = (item: MenuItem) => {
    setCart((prev) => {
      const existing = prev.find((c) => c.id === item.id);
      if (existing) {
        return prev.map((c) =>
          c.id === item.id ? { ...c, quantity: c.quantity + 1 } : c
        );
      }
      return [...prev, { ...item, quantity: 1 }];
    });
  };

  // Remove from cart
  const removeFromCart = (itemId: string) => {
    setCart((prev) => prev.filter((c) => c.id !== itemId));
  };

  // Update quantity
  const updateQuantity = (itemId: string, quantity: number) => {
    if (quantity <= 0) {
      removeFromCart(itemId);
      return;
    }
    setCart((prev) =>
      prev.map((c) => (c.id === itemId ? { ...c, quantity } : c))
    );
  };

  // Calculate totals
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const tax = subtotal * 0.05; // 5% tax
  const total = subtotal + tax;

  // Place order
  const placeOrder = async () => {
    if (!selectedSlot) {
      setError('Please select a time slot');
      return;
    }

    if (cart.length === 0) {
      setError('Cart is empty');
      return;
    }

    try {
      setPlacing(true);
      setError('');

      const authHeader = await getAuthHeader();

      const response = await fetch('/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeader,
        },
        body: JSON.stringify({
          slotId: selectedSlot,
          items: cart.map((item) => ({
            menuItemId: item.id,
            name: item.name,
            price: item.price,
            quantity: item.quantity,
          })),
          subtotal,
          tax,
          total,
          specialRequests: notes,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to place order');
      }

      const orderData = await response.json();
      router.push(`/dashboard/orders/${orderData.orderId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to place order');
      console.error(err);
    } finally {
      setPlacing(false);
    }
  };

  if (roleLoading || loading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">Place Order</h1>
        <Link href="/dashboard" className="text-accent hover:underline">
          ← Back
        </Link>
      </div>

      {error && (
        <div className="bg-red-500 text-white p-4 rounded mb-8">{error}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Menu Section */}
        <div className="lg:col-span-2">
          <div className="bg-panel rounded-lg p-6 border border-line">
            <h2 className="text-xl font-bold mb-6">Select Items</h2>

            {menuItems.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                No menu items available
              </div>
            ) : (
              <div className="space-y-4">
                {menuItems.map((item) => (
                  <div
                    key={item.id}
                    className="flex justify-between items-center p-4 border border-line rounded hover:bg-gray-50 transition"
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold">{item.name}</h3>
                        {item.vegOnly && (
                          <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">
                            🌱 Veg
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-600">{item.description}</p>
                      <p className="text-sm text-gray-500">{item.category}</p>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <p className="font-bold text-accent">₹{item.price}</p>
                        <p className="text-xs text-gray-500">
                          {item.available ? 'Available' : 'Out of stock'}
                        </p>
                      </div>
                      <button
                        onClick={() => addToCart(item)}
                        disabled={!item.available}
                        className="bg-accent text-white px-4 py-2 rounded font-semibold hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        +
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Cart & Checkout Section */}
        <div>
          {!showCheckout ? (
            <>
              {/* Cart Preview */}
              <div className="bg-panel rounded-lg p-6 border border-line sticky top-8">
                <h2 className="text-xl font-bold mb-4">Cart ({cart.length})</h2>

                {cart.length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    Cart is empty
                  </div>
                ) : (
                  <>
                    <div className="space-y-3 mb-6 max-h-64 overflow-y-auto">
                      {cart.map((item) => (
                        <div key={item.id} className="flex justify-between items-start pb-3 border-b border-line">
                          <div className="flex-1">
                            <p className="font-semibold">{item.name}</p>
                            <p className="text-sm text-gray-600">₹{item.price} x {item.quantity}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => updateQuantity(item.id, item.quantity - 1)}
                              className="bg-gray-200 px-2 py-1 rounded text-sm"
                            >
                              −
                            </button>
                            <span className="w-6 text-center">{item.quantity}</span>
                            <button
                              onClick={() => updateQuantity(item.id, item.quantity + 1)}
                              className="bg-gray-200 px-2 py-1 rounded text-sm"
                            >
                              +
                            </button>
                            <button
                              onClick={() => removeFromCart(item.id)}
                              className="text-red-500 hover:text-red-700 ml-2"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Totals */}
                    <div className="space-y-2 py-4 border-t border-line">
                      <div className="flex justify-between">
                        <span>Subtotal:</span>
                        <span>₹{subtotal.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Tax (5%):</span>
                        <span>₹{tax.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between font-bold text-lg pt-2 border-t border-line">
                        <span>Total:</span>
                        <span className="text-accent">₹{total.toFixed(2)}</span>
                      </div>
                    </div>

                    <button
                      onClick={() => setShowCheckout(true)}
                      className="w-full bg-accent text-white py-3 rounded font-bold mt-6 hover:opacity-90"
                    >
                      Proceed to Checkout
                    </button>
                  </>
                )}
              </div>
            </>
          ) : (
            <>
              {/* Checkout Form */}
              <div className="bg-panel rounded-lg p-6 border border-line sticky top-8">
                <h2 className="text-xl font-bold mb-6">Checkout</h2>

                {/* Time Slot Selection */}
                <div className="mb-6">
                  <label className="block font-semibold mb-3">Select Time Slot</label>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {timeSlots.length === 0 ? (
                      <p className="text-gray-500">No slots available</p>
                    ) : (
                      timeSlots.map((slot) => (
                        <button
                          key={slot.id}
                          onClick={() => setSelectedSlot(slot.id)}
                          disabled={!slot.available}
                          className={`w-full p-3 rounded border-2 text-left transition ${
                            selectedSlot === slot.id
                              ? 'border-accent bg-accent bg-opacity-10'
                              : 'border-line'
                          } ${!slot.available ? 'opacity-50 cursor-not-allowed' : 'hover:border-accent'}`}
                        >
                          <p className="font-semibold">
                            {slot.startTime} - {slot.endTime}
                          </p>
                          <p className="text-sm text-gray-600">
                            {slot.booked}/{slot.capacity} booked
                          </p>
                        </button>
                      ))
                    )}
                  </div>
                </div>

                {/* Special Requests */}
                <div className="mb-6">
                  <label className="block font-semibold mb-3">Special Requests (Optional)</label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="E.g., No onions, extra spice, etc."
                    className="w-full p-3 border border-line rounded focus:outline-none focus:border-accent"
                    rows={4}
                  />
                </div>

                {/* Order Summary */}
                <div className="bg-gray-50 p-4 rounded mb-6">
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span>Subtotal:</span>
                      <span>₹{subtotal.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Tax (5%):</span>
                      <span>₹{tax.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between font-bold text-base pt-2 border-t border-line">
                      <span>Total:</span>
                      <span className="text-accent">₹{total.toFixed(2)}</span>
                    </div>
                  </div>
                </div>

                {/* Buttons */}
                <div className="space-y-3">
                  <button
                    onClick={placeOrder}
                    disabled={placing || !selectedSlot}
                    className="w-full bg-accent text-white py-3 rounded font-bold hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {placing ? 'Placing Order...' : 'Place Order'}
                  </button>
                  <button
                    onClick={() => setShowCheckout(false)}
                    className="w-full bg-gray-200 text-gray-900 py-3 rounded font-bold hover:bg-gray-300"
                  >
                    Back to Menu
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

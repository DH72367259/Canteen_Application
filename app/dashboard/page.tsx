"use client";

import { useCallback, useEffect, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getClientAuth, isFirebaseClientConfigured } from "@/lib/firebaseClient";
import { useUserRole } from "@/lib/rolesClient";
import type { CanteenOrder } from "@/types/canteen";

function currency(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
}

export default function CustomerDashboard() {
  const router = useRouter();
  const { role, loading: roleLoading } = useUserRole();
  const [rewards, setRewards] = useState({ points: 0, balance: 0 });
  const [orders, setOrders] = useState<CanteenOrder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const clientConfigReady = isFirebaseClientConfigured();

  // Redirect if not customer
  useEffect(() => {
    if (!roleLoading && role && role !== "customer") {
      router.push("/");
    }
  }, [role, roleLoading, router]);

  const getAuthHeader = useCallback(async () => {
    const currentUser = getClientAuth().currentUser;
    if (!currentUser) {
      throw new Error("User not authenticated.");
    }

    const token = await currentUser.getIdToken();
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
  }, []);

  const refreshOrders = useCallback(async () => {
    try {
      const response = await fetch("/api/orders", {
        cache: "no-store",
        headers: await getAuthHeader(),
      });

      const payload = (await response.json()) as {
        orders?: CanteenOrder[];
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Could not load orders.");
      }

      setOrders(payload.orders ?? []);
      setRewards({ points: (payload.orders?.length ?? 0) * 2, balance: (payload.orders?.length ?? 0) * 2 });
      setLoading(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not load orders.";
      setError(message);
      setLoading(false);
    }
  }, [getAuthHeader]);

  useEffect(() => {
    if (!clientConfigReady || roleLoading) {
      return;
    }

    const unsubscribe = onAuthStateChanged(getClientAuth(), async (authUser) => {
      if (!authUser) {
        setLoading(false);
        return;
      }

      await refreshOrders();
    });

    return () => {
      unsubscribe();
    };
  }, [clientConfigReady, roleLoading, refreshOrders]);

  async function handleLogout() {
    try {
      await signOut(getClientAuth());
      router.push("/login");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Logout failed.";
      setError(message);
    }
  }

  if (!clientConfigReady) {
    return (
      <main className="canteen-page">
        <section className="hero">
          <h1>Firebase configuration missing</h1>
        </section>
      </main>
    );
  }

  if (roleLoading) {
    return (
      <main className="canteen-page">
        <section className="hero">
          <h1>Loading...</h1>
        </section>
      </main>
    );
  }

  return (
    <main className="canteen-page">
      <section className="hero">
        <p className="hero-kicker">Customer Portal</p>
        <h1>Order & Rewards Dashboard</h1>
        <p>Place orders, track delivery, and earn rewards.</p>
        <p className="route-links">
          <Link href="/">Home</Link> |
          <button 
            type="button" 
            onClick={handleLogout}
            style={{ background: "none", border: "none", color: "#7a2f00", cursor: "pointer", textDecoration: "underline" }}
          >
            Logout
          </button>
        </p>
      </section>

      <section className="grid-wrap">
        <div className="panel">
          <h2>🎁 Rewards</h2>
          <div style={{ display: "grid", gap: "1rem" }}>
            <div style={{ padding: "0.75rem", background: "#ffe0cc", borderRadius: "10px" }}>
              <p style={{ fontSize: "0.9rem", color: "#666" }}>Total Points</p>
              <h3 style={{ fontSize: "1.8rem" }}>{rewards.points}</h3>
            </div>
            <div style={{ padding: "0.75rem", background: "#ffeedd", borderRadius: "10px" }}>
              <p style={{ fontSize: "0.9rem", color: "#666" }}>Redeemable Balance</p>
              <h3 style={{ fontSize: "1.8rem" }}>₹{rewards.balance}</h3>
            </div>
            <Link 
              href="/dashboard/redeem"
              style={{ 
                display: "block", 
                padding: "0.75rem", 
                background: "#c75100", 
                color: "white",
                borderRadius: "10px", 
                textAlign: "center",
                textDecoration: "none",
                fontWeight: "600"
              }}
            >
              Redeem Rewards
            </Link>
          </div>
        </div>

        <div className="panel">
          <h2>🛒 Quick Actions</h2>
          <div style={{ display: "grid", gap: "0.6rem" }}>
            <Link 
              href="/dashboard/order"
              style={{ display: "block", padding: "0.75rem", background: "#fff8ef", border: "1px solid #e8cfb4", borderRadius: "10px", textDecoration: "none", color: "inherit" }}
            >
              <strong>Place New Order</strong>
              <p style={{ fontSize: "0.9rem", color: "#999", marginTop: "0.2rem" }}>Browse menu and create order</p>
            </Link>
            <Link 
              href="/dashboard/slots"
              style={{ display: "block", padding: "0.75rem", background: "#fff8ef", border: "1px solid #e8cfb4", borderRadius: "10px", textDecoration: "none", color: "inherit" }}
            >
              <strong>View Available Slots</strong>
              <p style={{ fontSize: "0.9rem", color: "#999", marginTop: "0.2rem" }}>Check time slots for pickup</p>
            </Link>
            <Link 
              href="/dashboard/orders"
              style={{ display: "block", padding: "0.75rem", background: "#fff8ef", border: "1px solid #e8cfb4", borderRadius: "10px", textDecoration: "none", color: "inherit" }}
            >
              <strong>Order History</strong>
              <p style={{ fontSize: "0.9rem", color: "#999", marginTop: "0.2rem" }}>View past and current orders</p>
            </Link>
          </div>
        </div>
      </section>

      <section className="panel orders">
        <h2>📦 Recent Orders</h2>
        {loading ? <p>Loading orders...</p> : null}
        {orders.length === 0 && !loading ? (
          <p style={{ color: "#999" }}>No orders yet. <Link href="/dashboard/order" style={{ color: "#c75100", fontWeight: "600" }}>Place your first order</Link></p>
        ) : null}
        <div className="orders-list">
          {orders.map((order) => (
            <div key={order.id} className="order-card">
              <div className="order-head">
                <h3>Order #{order.id.substring(0, 8)}</h3>
                <span>{order.status}</span>
              </div>
              <ul>
                {order.items.map((item) => (
                  <li key={`${order.id}-${item.itemId}`}>
                    {item.name} x {item.quantity} = {currency(item.lineTotal)}
                  </li>
                ))}
              </ul>
              <strong>Total: {currency(order.total)}</strong>
              <div style={{ fontSize: "0.85rem", color: "#999", marginTop: "0.35rem" }}>
                {new Date(order.createdAt).toLocaleString()}
              </div>
              <Link 
                href={`/dashboard/order/${order.id}`}
                style={{ 
                  display: "block", 
                  marginTop: "0.6rem",
                  padding: "0.5rem",
                  background: "#fff8ef",
                  border: "1px solid #e8cfb4",
                  borderRadius: "8px",
                  textAlign: "center",
                  textDecoration: "none",
                  color: "#7a2f00",
                  fontSize: "0.9rem"
                }}
              >
                Track Order
              </Link>
            </div>
          ))}
        </div>
        {error ? <p className="error-msg">{error}</p> : null}
      </section>
    </main>
  );
}

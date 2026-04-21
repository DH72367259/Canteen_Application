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

export default function CanteenAdminDashboard() {
  const router = useRouter();
  const { role, loading: roleLoading } = useUserRole();
  const [orders, setOrders] = useState<CanteenOrder[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const clientConfigReady = isFirebaseClientConfigured();

  // Redirect if not canteen-admin
  useEffect(() => {
    if (!roleLoading && role && role !== "canteen-admin") {
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
      setLoading(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not load orders.";
      setError(message);
      setLoading(false);
    }
  }, [getAuthHeader]);

  useEffect(() => {
    if (!clientConfigReady) {
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
  }, [clientConfigReady, refreshOrders]);

  async function updateStatus(orderId: string, status: CanteenOrder["status"]) {
    try {
      const response = await fetch(`/api/orders/${orderId}/status`, {
        method: "PATCH",
        headers: await getAuthHeader(),
        body: JSON.stringify({ status }),
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "Status update failed.");
      }

      await refreshOrders();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not update status.";
      setError(message);
    }
  }

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

  if (role !== "canteen-admin") {
    return (
      <main className="canteen-page">
        <section className="hero">
          <h1>Access Denied</h1>
          <p>You do not have permission to view this page.</p>
          <p className="route-links">
            <Link href="/">Home</Link> | <Link href="/login">Login</Link>
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="canteen-page">
      <section className="hero">
        <p className="hero-kicker">Canteen Administration</p>
        <h1>Order Management Dashboard</h1>
        <p>Manage incoming orders and update order status.</p>
        <p className="route-links">
          <Link href="/">Home</Link> | <Link href="/admin/menu">Manage Menu</Link> |
          <button 
            type="button" 
            onClick={handleLogout}
            style={{ background: "none", border: "none", color: "#7a2f00", cursor: "pointer", textDecoration: "underline" }}
          >
            Logout
          </button>
        </p>
      </section>

      <section className="panel orders">
        <h2>Incoming Orders</h2>
        {loading ? <p>Loading orders...</p> : null}
        {orders.length === 0 && !loading ? <p>No orders found.</p> : null}
        <div className="orders-list">
          {orders.map((order) => (
            <div key={order.id} className="order-card">
              <div className="order-head">
                <h3>{order.customerName}</h3>
                <span>{order.status}</span>
              </div>
              <p style={{ fontSize: "0.85rem", color: "#999" }}>Order ID: {order.id}</p>
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
              <div className="status-actions">
                <button type="button" onClick={() => updateStatus(order.id, "preparing")}>
                  Preparing
                </button>
                <button type="button" onClick={() => updateStatus(order.id, "ready")}>
                  Ready
                </button>
                <button type="button" onClick={() => updateStatus(order.id, "completed")}>
                  Completed
                </button>
                <button type="button" onClick={() => updateStatus(order.id, "cancelled")}>
                  Cancel
                </button>
              </div>
            </div>
          ))}
        </div>
        {error ? <p className="error-msg">{error}</p> : null}
      </section>
    </main>
  );
}

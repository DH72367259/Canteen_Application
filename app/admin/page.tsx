"use client";

import { useCallback, useEffect, useState } from "react";
import { onAuthStateChanged, signInWithEmailAndPassword } from "firebase/auth";
import Link from "next/link";
import { getClientAuth, isFirebaseClientConfigured } from "@/lib/firebaseClient";
import type { CanteenOrder } from "@/types/canteen";

function currency(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
}

export default function AdminDashboardPage() {
  const [orders, setOrders] = useState<CanteenOrder[]>([]);
  const [role, setRole] = useState<"customer" | "admin" | null>(null);
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const clientConfigReady = isFirebaseClientConfigured();

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
        role?: "customer" | "admin";
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error ?? "Could not load orders.");
      }

      setOrders(payload.orders ?? []);
      setRole(payload.role ?? "customer");
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

  async function handleAdminLogin() {
    setSigningIn(true);
    setError(null);

    try {
      await signInWithEmailAndPassword(getClientAuth(), adminEmail, adminPassword);
      await refreshOrders();
    } catch {
      setError("Admin login failed. Check email/password or admin allowlist.");
    } finally {
      setSigningIn(false);
    }
  }

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

  if (!clientConfigReady) {
    return (
      <main className="canteen-page">
        <section className="hero">
          <h1>Firebase configuration missing</h1>
        </section>
      </main>
    );
  }

  const isAdmin = role === "admin";

  return (
    <main className="canteen-page">
      <section className="hero">
        <p className="hero-kicker">Admin Workflow</p>
        <h1>Admin Canteen Dashboard</h1>
        <p>Sign in as admin to manage order operations.</p>
        <p className="route-links">
          <Link href="/">Home</Link> | <Link href="/login">Login</Link> | <Link href="/admin/users">Users</Link>
        </p>
      </section>

      {!isAdmin ? (
        <section className="panel checkout">
          <h2>Admin Login Required</h2>
          <label htmlFor="admin-email">Email</label>
          <input
            id="admin-email"
            type="email"
            value={adminEmail}
            onChange={(event) => setAdminEmail(event.target.value)}
            placeholder="admin@domain.com"
          />
          <label htmlFor="admin-password">Password</label>
          <input
            id="admin-password"
            type="password"
            value={adminPassword}
            onChange={(event) => setAdminPassword(event.target.value)}
            placeholder="Enter password"
          />
          <button type="button" className="place-btn" onClick={handleAdminLogin} disabled={signingIn}>
            {signingIn ? "Signing in..." : "Login as Admin"}
          </button>
          {error ? <p className="error-msg">{error}</p> : null}
        </section>
      ) : null}

      {isAdmin ? (
        <section className="panel orders">
          <h2>All Orders</h2>
          {loading ? <p>Loading orders...</p> : null}
          {orders.length === 0 && !loading ? <p>No orders found.</p> : null}
          <div className="orders-list">
            {orders.map((order) => (
              <div key={order.id} className="order-card">
                <div className="order-head">
                  <h3>{order.customerName}</h3>
                  <span>{order.status}</span>
                </div>
                <p>{order.id}</p>
                <ul>
                  {order.items.map((item) => (
                    <li key={`${order.id}-${item.itemId}`}>
                      {item.name} x {item.quantity}
                    </li>
                  ))}
                </ul>
                <strong>{currency(order.total)}</strong>
                <div className="status-actions">
                  <button type="button" onClick={() => updateStatus(order.id, "preparing")}>Preparing</button>
                  <button type="button" onClick={() => updateStatus(order.id, "ready")}>Ready</button>
                  <button type="button" onClick={() => updateStatus(order.id, "completed")}>Completed</button>
                  <button type="button" onClick={() => updateStatus(order.id, "cancelled")}>Cancel</button>
                </div>
              </div>
            ))}
          </div>
          {error ? <p className="error-msg">{error}</p> : null}
        </section>
      ) : null}
    </main>
  );
}

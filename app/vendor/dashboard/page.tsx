"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getClientAuth, isFirebaseClientConfigured } from "@/lib/firebaseClient";
import { useUserRole } from "@/lib/rolesClient";

export default function VendorDashboard() {
  const router = useRouter();
  const { role, loading: roleLoading } = useUserRole();
  const [stats, setStats] = useState({
    todayOrders: 0,
    todayRevenue: 0,
    menuItems: 0,
    availableSlots: 0,
  });
  const [error, setError] = useState<string | null>(null);
  const clientConfigReady = isFirebaseClientConfigured();

  // Redirect if not vendor
  useEffect(() => {
    if (!roleLoading && role && role !== "vendor") {
      router.push("/");
    }
  }, [role, roleLoading, router]);

  useEffect(() => {
    if (!clientConfigReady || roleLoading) {
      return;
    }

    const unsubscribe = onAuthStateChanged(getClientAuth(), async (authUser) => {
      if (!authUser) {
        return;
      }

      // TODO: Load actual vendor stats from API
      setStats({
        todayOrders: 0,
        todayRevenue: 0,
        menuItems: 0,
        availableSlots: 0,
      });
    });

    return () => {
      unsubscribe();
    };
  }, [clientConfigReady, roleLoading]);

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

  if (role !== "vendor") {
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
        <p className="hero-kicker">Vendor Portal</p>
        <h1>Vendor Dashboard</h1>
        <p>Manage your menu, pricing, and sales.</p>
        <p className="route-links">
          <Link href="/">Home</Link> | <Link href="/vendor">Workflows</Link> |
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
          <h2>📈 Today&apos;s Performance</h2>
          <div style={{ display: "grid", gap: "1rem" }}>
            <div style={{ padding: "0.75rem", background: "#ffe0cc", borderRadius: "10px" }}>
              <p style={{ fontSize: "0.9rem", color: "#666" }}>Orders Received</p>
              <h3 style={{ fontSize: "1.8rem" }}>{stats.todayOrders}</h3>
            </div>
            <div style={{ padding: "0.75rem", background: "#ffeedd", borderRadius: "10px" }}>
              <p style={{ fontSize: "0.9rem", color: "#666" }}>Today&apos;s Revenue</p>
              <h3 style={{ fontSize: "1.8rem" }}>₹{stats.todayRevenue}</h3>
            </div>
          </div>
        </div>

        <div className="panel">
          <h2>🛠️ Quick Actions</h2>
          <div style={{ display: "grid", gap: "0.6rem" }}>
            <Link href="/vendor/menu" style={{ display: "block", padding: "0.75rem", background: "#fff8ef", border: "1px solid #e8cfb4", borderRadius: "10px", textDecoration: "none", color: "inherit" }}>
              <strong>Manage Menu</strong>
              <p style={{ fontSize: "0.9rem", color: "#999", marginTop: "0.2rem" }}>Edit items and pricing ({stats.menuItems} items)</p>
            </Link>
            <Link href="/vendor/slots" style={{ display: "block", padding: "0.75rem", background: "#fff8ef", border: "1px solid #e8cfb4", borderRadius: "10px", textDecoration: "none", color: "inherit" }}>
              <strong>Schedule Slots</strong>
              <p style={{ fontSize: "0.9rem", color: "#999", marginTop: "0.2rem" }}>Manage availability slots</p>
            </Link>
            <Link href="/vendor/orders" style={{ display: "block", padding: "0.75rem", background: "#fff8ef", border: "1px solid #e8cfb4", borderRadius: "10px", textDecoration: "none", color: "inherit" }}>
              <strong>Order History</strong>
              <p style={{ fontSize: "0.9rem", color: "#999", marginTop: "0.2rem" }}>View and track sales</p>
            </Link>
            <Link href="/vendor/analytics" style={{ display: "block", padding: "0.75rem", background: "#fff8ef", border: "1px solid #e8cfb4", borderRadius: "10px", textDecoration: "none", color: "inherit" }}>
              <strong>Sales Analytics</strong>
              <p style={{ fontSize: "0.9rem", color: "#999", marginTop: "0.2rem" }}>View sales metrics and trends</p>
            </Link>
          </div>
        </div>
      </section>

      {error ? <p className="error-msg">{error}</p> : null}
    </main>
  );
}

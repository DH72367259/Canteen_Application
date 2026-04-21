"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getClientAuth, isFirebaseClientConfigured } from "@/lib/firebaseClient";
import { useUserRole } from "@/lib/rolesClient";

export default function SuperAdminDashboard() {
  const router = useRouter();
  const { role, loading: roleLoading } = useUserRole();
  const [stats, setStats] = useState({
    totalCanteens: 0,
    totalUsers: 0,
    totalOrders: 0,
    totalRevenue: 0,
  });
  const [error, setError] = useState<string | null>(null);
  const clientConfigReady = isFirebaseClientConfigured();

  // Redirect if not super-admin
  useEffect(() => {
    if (!roleLoading && role && role !== "super_admin") {
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

      // TODO: Load actual stats from API
      setStats({
        totalCanteens: 0,
        totalUsers: 0,
        totalOrders: 0,
        totalRevenue: 0,
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

  if (role !== "super_admin") {
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
        <p className="hero-kicker">Platform Administration</p>
        <h1>Super Admin Dashboard</h1>
        <p>Manage canteens, users, and platform analytics.</p>
        <p className="route-links">
          <Link href="/">Home</Link> | <Link href="/system">Workflows</Link> |
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
          <h2>📊 Platform Statistics</h2>
          <div style={{ display: "grid", gap: "1rem" }}>
            <div style={{ padding: "0.75rem", background: "#ffe0cc", borderRadius: "10px" }}>
              <p style={{ fontSize: "0.9rem", color: "#666" }}>Total Canteens</p>
              <h3 style={{ fontSize: "1.8rem" }}>{stats.totalCanteens}</h3>
            </div>
            <div style={{ padding: "0.75rem", background: "#ffeedd", borderRadius: "10px" }}>
              <p style={{ fontSize: "0.9rem", color: "#666" }}>Total Users</p>
              <h3 style={{ fontSize: "1.8rem" }}>{stats.totalUsers}</h3>
            </div>
            <div style={{ padding: "0.75rem", background: "#fff0e0", borderRadius: "10px" }}>
              <p style={{ fontSize: "0.9rem", color: "#666" }}>Total Orders</p>
              <h3 style={{ fontSize: "1.8rem" }}>{stats.totalOrders}</h3>
            </div>
            <div style={{ padding: "0.75rem", background: "#fff5eb", borderRadius: "10px" }}>
              <p style={{ fontSize: "0.9rem", color: "#666" }}>Total Revenue</p>
              <h3 style={{ fontSize: "1.8rem" }}>₹{stats.totalRevenue}</h3>
            </div>
          </div>
        </div>

        <div className="panel">
          <h2>🔧 Management Tools</h2>
          <div style={{ display: "grid", gap: "0.6rem" }}>
            <Link href="/system/canteens" style={{ display: "block", padding: "0.75rem", background: "#fff8ef", border: "1px solid #e8cfb4", borderRadius: "10px", textDecoration: "none", color: "inherit" }}>
              <strong>Manage Canteens</strong>
              <p style={{ fontSize: "0.9rem", color: "#999", marginTop: "0.2rem" }}>Create, edit, and manage canteen locations</p>
            </Link>
            <Link href="/system/users" style={{ display: "block", padding: "0.75rem", background: "#fff8ef", border: "1px solid #e8cfb4", borderRadius: "10px", textDecoration: "none", color: "inherit" }}>
              <strong>User Management</strong>
              <p style={{ fontSize: "0.9rem", color: "#999", marginTop: "0.2rem" }}>Control user roles and permissions</p>
            </Link>
            <Link href="/system/settlements" style={{ display: "block", padding: "0.75rem", background: "#fff8ef", border: "1px solid #e8cfb4", borderRadius: "10px", textDecoration: "none", color: "inherit" }}>
              <strong>Payments & Settlements</strong>
              <p style={{ fontSize: "0.9rem", color: "#999", marginTop: "0.2rem" }}>View and manage payment settlements</p>
            </Link>
            <Link href="/system/analytics" style={{ display: "block", padding: "0.75rem", background: "#fff8ef", border: "1px solid #e8cfb4", borderRadius: "10px", textDecoration: "none", color: "inherit" }}>
              <strong>Platform Analytics</strong>
              <p style={{ fontSize: "0.9rem", color: "#999", marginTop: "0.2rem" }}>View platform performance metrics</p>
            </Link>
          </div>
        </div>
      </section>

      {error ? <p className="error-msg">{error}</p> : null}
    </main>
  );
}

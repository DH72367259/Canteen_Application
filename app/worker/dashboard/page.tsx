"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getClientAuth, isFirebaseClientConfigured } from "@/lib/firebaseClient";
import { useUserRole } from "@/lib/rolesClient";

export default function WorkerDashboard() {
  const router = useRouter();
  const { role, loading: roleLoading } = useUserRole();
  const [stats, setStats] = useState({
    pendingOrders: 0,
    completedToday: 0,
    binStatus: "normal",
    wasteReports: 0,
  });
  const [error, setError] = useState<string | null>(null);
  const clientConfigReady = isFirebaseClientConfigured();

  // Redirect if not worker
  useEffect(() => {
    if (!roleLoading && role && role !== "worker") {
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

      // TODO: Load actual worker stats from API
      setStats({
        pendingOrders: 0,
        completedToday: 0,
        binStatus: "normal",
        wasteReports: 0,
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

  if (role !== "worker") {
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
        <p className="hero-kicker">Worker Operations</p>
        <h1>Worker Dashboard</h1>
        <p>Track orders, manage bins, and report waste.</p>
        <p className="route-links">
          <Link href="/">Home</Link> | <Link href="/operations">Workflows</Link> |
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
          <h2>⏱️ Today&apos;s Workload</h2>
          <div style={{ display: "grid", gap: "1rem" }}>
            <div style={{ padding: "0.75rem", background: "#ffe0cc", borderRadius: "10px" }}>
              <p style={{ fontSize: "0.9rem", color: "#666" }}>Pending Orders</p>
              <h3 style={{ fontSize: "1.8rem" }}>{stats.pendingOrders}</h3>
            </div>
            <div style={{ padding: "0.75rem", background: "#ffeedd", borderRadius: "10px" }}>
              <p style={{ fontSize: "0.9rem", color: "#666" }}>Completed Today</p>
              <h3 style={{ fontSize: "1.8rem" }}>{stats.completedToday}</h3>
            </div>
            <div style={{ 
              padding: "0.75rem", 
              borderRadius: "10px",
              background: stats.binStatus === "normal" ? "#e8f5e9" : stats.binStatus === "warning" ? "#fff9c4" : "#ffebee",
              borderLeft: `4px solid ${stats.binStatus === "normal" ? "#4caf50" : stats.binStatus === "warning" ? "#fbc02d" : "#f44336"}`
            }}>
              <p style={{ fontSize: "0.9rem", color: "#666" }}>Bin Status</p>
              <h3 style={{ fontSize: "1.5rem", textTransform: "capitalize" }}>{stats.binStatus}</h3>
            </div>
          </div>
        </div>

        <div className="panel">
          <h2>🔔 Current Tasks</h2>
          <div style={{ display: "grid", gap: "0.6rem" }}>
            <Link href="/operations/orders" style={{ display: "block", padding: "0.75rem", background: "#fff8ef", border: "1px solid #e8cfb4", borderRadius: "10px", textDecoration: "none", color: "inherit" }}>
              <strong>Incoming Orders</strong>
              <p style={{ fontSize: "0.9rem", color: "#999", marginTop: "0.2rem" }}>View and confirm new orders ({stats.pendingOrders})</p>
            </Link>
            <Link href="/operations/bins" style={{ display: "block", padding: "0.75rem", background: "#fff8ef", border: "1px solid #e8cfb4", borderRadius: "10px", textDecoration: "none", color: "inherit" }}>
              <strong>Bin Management</strong>
              <p style={{ fontSize: "0.9rem", color: "#999", marginTop: "0.2rem" }}>Update bin status and schedule emptying</p>
            </Link>
            <Link href="/operations/waste" style={{ display: "block", padding: "0.75rem", background: "#fff8ef", border: "1px solid #e8cfb4", borderRadius: "10px", textDecoration: "none", color: "inherit" }}>
              <strong>Waste Reporting</strong>
              <p style={{ fontSize: "0.9rem", color: "#999", marginTop: "0.2rem" }}>Report waste disposal ({stats.wasteReports} pending)</p>
            </Link>
            <Link href="/operations/notifications" style={{ display: "block", padding: "0.75rem", background: "#fff8ef", border: "1px solid #e8cfb4", borderRadius: "10px", textDecoration: "none", color: "inherit" }}>
              <strong>Notifications</strong>
              <p style={{ fontSize: "0.9rem", color: "#999", marginTop: "0.2rem" }}>View alerts and important messages</p>
            </Link>
          </div>
        </div>
      </section>

      {error ? <p className="error-msg">{error}</p> : null}
    </main>
  );
}

"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

export default function WorkerDashboard() {
  const router = useRouter();
  const { user, loading, logout } = useAuth();

  useEffect(() => {
    if (!loading && !user) router.push("/login");
    if (!loading && user && user.role !== "worker") router.push("/");
  }, [user, loading, router]);

  async function handleLogout() {
    await logout();
    router.push("/login");
  }

  if (loading) return <div className="page-loading"><div className="spinner" /></div>;
  if (!user || user.role !== "worker") return null;

  return (
    <main className="canteen-page">
      <section className="hero">
        <p className="hero-kicker">Worker Operations</p>
        <h1>Worker Dashboard</h1>
        <p>Track orders, manage bins, and report waste.</p>
        <p className="route-links">
          <Link href="/worker/orders">Live Orders</Link> |{" "}
          <Link href="/worker/bins">Bins</Link> |{" "}
          <Link href="/worker/otp-verify">OTP Verify</Link> |{" "}
          <button type="button" onClick={handleLogout} style={{ background: "none", border: "none", color: "#7a2f00", cursor: "pointer", textDecoration: "underline" }}>
            Logout
          </button>
        </p>
      </section>

      <section className="grid-wrap">
        <div className="panel">
          <h2>🔔 Quick Links</h2>
          <div style={{ display: "grid", gap: "0.6rem" }}>
            <Link href="/worker/orders" style={{ display: "block", padding: "0.75rem", background: "#fff8ef", border: "1px solid #e8cfb4", borderRadius: "10px", textDecoration: "none", color: "inherit" }}>
              <strong>📦 Incoming Orders</strong>
              <p style={{ fontSize: "0.9rem", color: "#999", marginTop: "0.2rem" }}>View and prepare orders</p>
            </Link>
            <Link href="/worker/bins" style={{ display: "block", padding: "0.75rem", background: "#fff8ef", border: "1px solid #e8cfb4", borderRadius: "10px", textDecoration: "none", color: "inherit" }}>
              <strong>🧺 Bin Management</strong>
              <p style={{ fontSize: "0.9rem", color: "#999", marginTop: "0.2rem" }}>Update bin placement status</p>
            </Link>
            <Link href="/worker/otp-verify" style={{ display: "block", padding: "0.75rem", background: "#fff8ef", border: "1px solid #e8cfb4", borderRadius: "10px", textDecoration: "none", color: "inherit" }}>
              <strong>🔐 OTP Verify</strong>
              <p style={{ fontSize: "0.9rem", color: "#999", marginTop: "0.2rem" }}>Backup OTP verification mode</p>
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}


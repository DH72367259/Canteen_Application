"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

export default function SuperAdminDashboard() {
  const router = useRouter();
  const { user, loading, logout } = useAuth();

  useEffect(() => {
    if (!loading && !user) router.push("/login");
    if (!loading && user && user.role !== "super_admin") router.push("/");
  }, [user, loading, router]);

  async function handleLogout() {
    await logout();
    router.push("/login");
  }

  if (loading) return <div className="page-loading"><div className="spinner" /></div>;
  if (!user || user.role !== "super_admin") return null;

  return (
    <main className="canteen-page">
      <section className="hero">
        <p className="hero-kicker">Platform Administration</p>
        <h1>Super Admin Dashboard</h1>
        <p>Manage canteens, users, campaigns, and platform analytics.</p>
        <p className="route-links">
          <Link href="/">Home</Link> | <Link href="/system">Workflows</Link> |{" "}
          <button type="button" onClick={handleLogout} style={{ background: "none", border: "none", color: "#7a2f00", cursor: "pointer", textDecoration: "underline" }}>
            Logout
          </button>
        </p>
      </section>

      <section className="grid-wrap">
        <div className="panel">
          <h2>🔧 Management Tools</h2>
          <div style={{ display: "grid", gap: "0.6rem" }}>
            <Link href="/system/canteens" style={{ display: "block", padding: "0.75rem", background: "#fff8ef", border: "1px solid #e8cfb4", borderRadius: "10px", textDecoration: "none", color: "inherit" }}>
              <strong>🏪 Manage Canteens</strong>
              <p style={{ fontSize: "0.9rem", color: "#999", marginTop: "0.2rem" }}>Create, edit, and manage canteen locations</p>
            </Link>
            <Link href="/system/users-control" style={{ display: "block", padding: "0.75rem", background: "#fff8ef", border: "1px solid #e8cfb4", borderRadius: "10px", textDecoration: "none", color: "inherit" }}>
              <strong>👥 User Management</strong>
              <p style={{ fontSize: "0.9rem", color: "#999", marginTop: "0.2rem" }}>Control user roles and permissions</p>
            </Link>
            <Link href="/system/cities" style={{ display: "block", padding: "0.75rem", background: "#fff8ef", border: "1px solid #e8cfb4", borderRadius: "10px", textDecoration: "none", color: "inherit" }}>
              <strong>🌆 Manage Cities</strong>
              <p style={{ fontSize: "0.9rem", color: "#999", marginTop: "0.2rem" }}>City-level operational configuration</p>
            </Link>
            <Link href="/system/colleges" style={{ display: "block", padding: "0.75rem", background: "#fff8ef", border: "1px solid #e8cfb4", borderRadius: "10px", textDecoration: "none", color: "inherit" }}>
              <strong>🎓 Manage Colleges</strong>
              <p style={{ fontSize: "0.9rem", color: "#999", marginTop: "0.2rem" }}>College onboarding and configuration</p>
            </Link>
            <Link href="/system/platform-analytics" style={{ display: "block", padding: "0.75rem", background: "#fff8ef", border: "1px solid #e8cfb4", borderRadius: "10px", textDecoration: "none", color: "inherit" }}>
              <strong>📊 Platform Analytics</strong>
              <p style={{ fontSize: "0.9rem", color: "#999", marginTop: "0.2rem" }}>View platform performance metrics</p>
            </Link>
            <Link href="/system/settlements" style={{ display: "block", padding: "0.75rem", background: "#fff0e0", border: "1px solid #fdba74", borderRadius: "10px", textDecoration: "none", color: "inherit" }}>
              <strong>💸 Settlement Dashboard</strong>
              <p style={{ fontSize: "0.9rem", color: "#999", marginTop: "0.2rem" }}>Pay canteens · Track platform charges · View payment history</p>
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}



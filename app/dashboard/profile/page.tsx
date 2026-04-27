"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

export default function ProfilePage() {
  const router = useRouter();
  const { user, loading, logout } = useAuth();
  const [signingOut, setSigningOut] = useState(false);

  // Auth guard
  useEffect(() => {
    if (!loading && !user) router.replace("/login?role=user");
  }, [user, loading, router]);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await logout();
      router.replace("/login");
    } catch {
      setSigningOut(false);
    }
  };

  if (loading || !user) {
    return <div className="loading-screen"><div className="spinner" /></div>;
  }

  const roleLabel: Record<string, string> = {
    super_admin: "Super Admin",
    canteen_admin: "Canteen Admin",
    vendor: "Vendor",
    worker: "Kitchen Staff",
    user: "Student",
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg, #fafaf8)", paddingBottom: 80 }}>
      {/* Header */}
      <div style={{
        background: "white",
        padding: "1rem 1.25rem 0.75rem",
        borderBottom: "1px solid var(--border, #e5e5e3)",
        position: "sticky",
        top: 0,
        zIndex: 10,
      }}>
        <h1 style={{ margin: 0, fontSize: "1.125rem", fontWeight: 700, color: "var(--ink-1, #1a1a18)" }}>
          My Profile
        </h1>
      </div>

      <div style={{ padding: "1.25rem", display: "flex", flexDirection: "column", gap: "1rem" }}>

        {/* Avatar + name card */}
        <div style={{
          background: "white",
          borderRadius: 16,
          padding: "1.5rem 1.25rem",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "0.5rem",
          boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
        }}>
          <div style={{
            width: 72, height: 72,
            background: "var(--orange, #f36f20)",
            borderRadius: "50%",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: "2rem",
          }}>
            👤
          </div>
          <h2 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700, color: "var(--ink-1, #1a1a18)" }}>
            {user.displayName || "Student"}
          </h2>
          <span style={{
            background: "var(--orange-light, #fff3eb)",
            color: "var(--orange, #f36f20)",
            borderRadius: 20,
            padding: "0.2rem 0.75rem",
            fontSize: "0.75rem",
            fontWeight: 600,
          }}>
            {roleLabel[user.role ?? "user"] ?? user.role ?? "Student"}
          </span>
        </div>

        {/* Contact details */}
        <div style={{
          background: "white",
          borderRadius: 16,
          overflow: "hidden",
          boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
        }}>
          <div style={{ padding: "0.75rem 1.25rem", borderBottom: "1px solid var(--border, #e5e5e3)" }}>
            <span style={{ fontSize: "0.7rem", fontWeight: 700, color: "var(--ink-3, #9b9b94)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Account Details
            </span>
          </div>

          {user.email && (
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.875rem 1.25rem", borderBottom: "1px solid var(--border, #e5e5e3)" }}>
              <span style={{ fontSize: "1.1rem" }}>✉️</span>
              <div>
                <div style={{ fontSize: "0.7rem", color: "var(--ink-3, #9b9b94)", marginBottom: 2 }}>Email</div>
                <div style={{ fontSize: "0.9rem", fontWeight: 500, color: "var(--ink-1, #1a1a18)" }}>{user.email}</div>
              </div>
            </div>
          )}

          {user.phone && (
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.875rem 1.25rem", borderBottom: "1px solid var(--border, #e5e5e3)" }}>
              <span style={{ fontSize: "1.1rem" }}>📱</span>
              <div>
                <div style={{ fontSize: "0.7rem", color: "var(--ink-3, #9b9b94)", marginBottom: 2 }}>Phone</div>
                <div style={{ fontSize: "0.9rem", fontWeight: 500, color: "var(--ink-1, #1a1a18)" }}>{user.phone}</div>
              </div>
            </div>
          )}

          {!user.email && !user.phone && (
            <div style={{ padding: "0.875rem 1.25rem", color: "var(--ink-3, #9b9b94)", fontSize: "0.85rem" }}>
              No contact details on file
            </div>
          )}
        </div>

        {/* Wallet balance */}
        <div style={{
          background: "white",
          borderRadius: 16,
          overflow: "hidden",
          boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
        }}>
          <div style={{ padding: "0.75rem 1.25rem", borderBottom: "1px solid var(--border, #e5e5e3)" }}>
            <span style={{ fontSize: "0.7rem", fontWeight: 700, color: "var(--ink-3, #9b9b94)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Canteen Cash
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.875rem 1.25rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
              <span style={{ fontSize: "1.1rem" }}>💰</span>
              <div>
                <div style={{ fontSize: "0.7rem", color: "var(--ink-3, #9b9b94)", marginBottom: 2 }}>Available balance</div>
                <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--ink-1, #1a1a18)" }}>
                  ₹{(user.walletBalance ?? 0).toFixed(2)}
                </div>
              </div>
            </div>
            <Link href="/dashboard/rewards" style={{
              background: "var(--orange, #f36f20)",
              color: "white",
              padding: "0.4rem 0.9rem",
              borderRadius: 20,
              fontSize: "0.8rem",
              fontWeight: 600,
              textDecoration: "none",
            }}>
              Rewards →
            </Link>
          </div>
        </div>

        {/* Quick links */}
        <div style={{
          background: "white",
          borderRadius: 16,
          overflow: "hidden",
          boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
        }}>
          {[
            { icon: "📦", label: "My Orders",       href: "/dashboard/orders" },
            { icon: "💎", label: "NoQx Pro",         href: "/dashboard/pro" },
            { icon: "🎧", label: "Support",           href: "/dashboard/support" },
            { icon: "📋", label: "Terms of Service", href: "/terms" },
            { icon: "🔒", label: "Privacy Policy",   href: "/privacy" },
            { icon: "💵", label: "Refund Policy",    href: "/refund" },
          ].map(({ icon, label, href }, i, arr) => (
            <Link
              key={href}
              href={href}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.75rem",
                padding: "0.875rem 1.25rem",
                borderBottom: i < arr.length - 1 ? "1px solid var(--border, #e5e5e3)" : "none",
                textDecoration: "none",
                color: "var(--ink-1, #1a1a18)",
              }}
            >
              <span style={{ fontSize: "1.1rem" }}>{icon}</span>
              <span style={{ flex: 1, fontSize: "0.9rem", fontWeight: 500 }}>{label}</span>
              <span style={{ color: "var(--ink-3, #9b9b94)", fontSize: "0.85rem" }}>›</span>
            </Link>
          ))}
        </div>

        {/* App version */}
        <div style={{ textAlign: "center", color: "var(--ink-3, #9b9b94)", fontSize: "0.72rem", marginTop: "0.25rem" }}>
          NoQx · Smart Institutional Dining
        </div>

        {/* Sign out */}
        <button
          onClick={handleSignOut}
          disabled={signingOut}
          style={{
            width: "100%",
            padding: "0.875rem",
            borderRadius: 14,
            border: "1.5px solid #fca5a5",
            background: "white",
            color: "#dc2626",
            fontWeight: 600,
            fontSize: "0.9rem",
            cursor: "pointer",
          }}
        >
          {signingOut ? "Signing out…" : "🚪 Sign Out"}
        </button>
      </div>

      {/* Bottom navigation */}
      <nav className="bottom-nav">
        {(["home", "orders", "rewards", "profile"] as const).map(tab => {
          const icons: Record<string, string>  = { home: "🏠", orders: "📦", rewards: "🎁", profile: "👤" };
          const labels: Record<string, string> = { home: "Home", orders: "My Orders", rewards: "Rewards", profile: "Profile" };
          const hrefs: Record<string, string>  = { home: "/dashboard", orders: "/dashboard/orders", rewards: "/dashboard/rewards", profile: "/dashboard/profile" };
          return (
            <Link
              key={tab}
              href={hrefs[tab]}
              className={`bottom-nav-item ${tab === "profile" ? "active" : ""}`}
            >
              <span className="nav-icon">{icons[tab]}</span>
              <span>{labels[tab]}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type OrderStatus = "active" | "upcoming" | "completed" | "cancelled";

const MOCK_ORDERS = [
  { id: "ORD001", canteen: "Main Canteen", items: ["Paneer Butter Masala", "Roti × 2", "Lassi"], total: 145, slot: "1:00 PM – 1:15 PM", bin: "Bin #4", otp: "4821", status: "active" as OrderStatus, date: "Today", earning: 2 },
  { id: "ORD002", canteen: "Snack Corner", items: ["Vada Pav × 2", "Chai"], total: 52, slot: "11:30 AM – 11:45 AM", bin: null, otp: null, status: "upcoming" as OrderStatus, date: "Today", earning: 1 },
  { id: "ORD003", canteen: "Main Canteen", items: ["Dal Rice", "Papad", "Pickle"], total: 80, slot: "12:30 PM – 12:45 PM", bin: "Bin #7", otp: null, status: "completed" as OrderStatus, date: "Yesterday", earning: 1 },
  { id: "ORD004", canteen: "Hostel Mess", items: ["Dinner Thali"], total: 65, slot: "8:00 PM – 8:15 PM", bin: null, otp: null, status: "cancelled" as OrderStatus, date: "2 days ago", earning: 0 },
];

const STATUS_CONFIG = {
  active:    { label: "Active",    tagClass: "tag-green",  dot: "var(--green)" },
  upcoming:  { label: "Upcoming",  tagClass: "tag-blue",   dot: "var(--blue)" },
  completed: { label: "Completed", tagClass: "tag-gray",   dot: "var(--ink-3)" },
  cancelled: { label: "Cancelled", tagClass: "tag-red",    dot: "var(--red)" },
};

export default function MyOrdersPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<OrderStatus | "all">("all");

  const filtered = activeTab === "all" ? MOCK_ORDERS : MOCK_ORDERS.filter(o => o.status === activeTab);

  return (
    <div className="app-shell">
      {/* Top bar */}
      <div className="topbar">
        <button onClick={() => router.back()} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "1.1rem", color: "var(--ink-3)", marginRight: "0.5rem" }}>←</button>
        <div>
          <div className="topbar" style={{ padding: 0, border: "none", position: "static" }}>
            <h1 style={{ fontSize: "1.1rem", fontWeight: 700 }}>My Orders</h1>
          </div>
        </div>
        <div />
      </div>

      {/* Tab filter */}
      <div className="slot-tabs" style={{ gap: "0.4rem" }}>
        {(["all", "active", "upcoming", "completed", "cancelled"] as const).map(tab => (
          <button
            key={tab}
            className={`slot-tab ${activeTab === tab ? "active" : ""}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab === "all" ? "All" : STATUS_CONFIG[tab].label}
          </button>
        ))}
      </div>

      {/* Orders list */}
      <div style={{ padding: "0.75rem 1rem", display: "flex", flexDirection: "column", gap: "0.75rem", paddingBottom: "5rem" }}>
        {filtered.length === 0 ? (
          <div className="empty-state">
            <span className="empty-icon">📦</span>
            <h3>No orders here</h3>
            <p>Your {activeTab} orders will show up here</p>
            <Link href="/dashboard" className="btn btn-primary" style={{ marginTop: "0.5rem" }}>Browse canteens</Link>
          </div>
        ) : filtered.map(order => {
          const cfg = STATUS_CONFIG[order.status];
          return (
            <div key={order.id} className="order-card">
              <div className="order-header">
                <div>
                  <div className="order-id">#{order.id}</div>
                  <div className="order-time">{order.date} · {order.slot}</div>
                </div>
                <span className={`tag ${cfg.tagClass}`}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: cfg.dot, display: "inline-block" }} />
                  {cfg.label}
                </span>
              </div>

              <div style={{ fontSize: "0.82rem", color: "var(--ink-3)" }}>{order.canteen}</div>
              <div className="order-items">{order.items.join(" · ")}</div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "0.25rem" }}>
                <span className="order-amount">₹{order.total}</span>
                {order.earning > 0 && (
                  <span className="tag tag-orange">+₹{order.earning} Canteen Cash</span>
                )}
              </div>

              {/* Active order: show OTP + bin */}
              {order.status === "active" && order.otp && (
                <div style={{ background: "var(--green-light)", border: "1px solid #bbf7d0", borderRadius: 12, padding: "0.75rem", marginTop: "0.25rem" }}>
                  <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "#15803d", textTransform: "uppercase", marginBottom: "0.3rem" }}>
                    Show this OTP at pickup · {order.bin}
                  </div>
                  <div style={{ fontSize: "2rem", fontWeight: 900, letterSpacing: "0.3em", color: "var(--ink)" }}>
                    {order.otp}
                  </div>
                  <div style={{ fontSize: "0.72rem", color: "var(--ink-3)", marginTop: "0.25rem" }}>
                    Canteen staff will scan or type this OTP to complete your order
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Bottom nav */}
      <nav className="bottom-nav">
        {[
          { tab: "home", icon: "🏠", label: "Home", href: "/dashboard" },
          { tab: "orders", icon: "📦", label: "My Orders", href: "/dashboard/orders" },
          { tab: "rewards", icon: "💰", label: "Rewards", href: "/dashboard/rewards" },
          { tab: "profile", icon: "👤", label: "Profile", href: "/dashboard/profile" },
        ].map(item => (
          <Link key={item.tab} href={item.href} className={`bottom-nav-item ${item.tab === "orders" ? "active" : ""}`}>
            <span className="nav-icon">{item.icon}</span>
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}

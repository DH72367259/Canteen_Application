"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

type AdminSection = "overview" | "canteens" | "users" | "cities" | "analytics" | "payments" | "support";

const ADMIN_NAV = [
  { id: "overview", icon: "📊", label: "Dashboard" },
  { id: "canteens", icon: "🏪", label: "Manage Canteens" },
  { id: "users", icon: "👥", label: "All Users" },
  { id: "cities", icon: "🏫", label: "Cities & Colleges" },
  { id: "analytics", icon: "📈", label: "Analytics" },
  { id: "payments", icon: "💳", label: "Payments" },
  { id: "support", icon: "🎧", label: "Support" },
];

const MOCK_CANTEENS = [
  { id: "c1", name: "IIT Bombay – Main Canteen", college: "IIT Bombay", city: "Mumbai", status: "active", orders: 1240, revenue: "₹1.2L" },
  { id: "c2", name: "BITS Pilani – Central Mess", college: "BITS Pilani", city: "Rajasthan", status: "active", orders: 890, revenue: "₹86K" },
  { id: "c3", name: "NIT Trichy – Block A Caf", college: "NIT Trichy", city: "Chennai", status: "inactive", orders: 0, revenue: "₹0" },
  { id: "c4", name: "VIT University – Canteen 2", college: "VIT Vellore", city: "Vellore", status: "active", orders: 560, revenue: "₹55K" },
];

const MOCK_USERS = [
  { id: "u1", name: "Arjun Sharma", phone: "+91 98765 43210", college: "IIT Bombay", orders: 28, rewards: "₹42", joined: "Jun 2025" },
  { id: "u2", name: "Priya Menon", phone: "+91 90123 45678", college: "BITS Pilani", orders: 14, rewards: "₹18", joined: "Jul 2025" },
  { id: "u3", name: "Karan Das", phone: "+91 87654 32109", college: "NIT Trichy", orders: 6, rewards: "₹8", joined: "Jul 2025" },
  { id: "u4", name: "Sneha Joshi", phone: "+91 81234 56789", college: "VIT Vellore", orders: 35, rewards: "₹62", joined: "May 2025" },
];

export default function SuperAdminDashboard() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const [section, setSection] = useState<AdminSection>("overview");

  useEffect(() => {
    if (user && user.role !== "super_admin") router.push("/login");
  }, [user, router]);

  const handleLogout = async () => { await logout(); router.push("/login"); };

  return (
    <div className="web-shell">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="logo-badge"><span className="dot" />NoQx Admin</div>
          <p>Super Administrator</p>
        </div>
        <nav className="sidebar-nav">
          {ADMIN_NAV.map(item => (
            <button key={item.id} className={`sidebar-link ${section === item.id ? "active" : ""}`} onClick={() => setSection(item.id as AdminSection)}>
              <span className="icon">{item.icon}</span>{item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <button className="sidebar-link" onClick={handleLogout} style={{ color: "#f87171" }}>
            <span className="icon">🚪</span>Logout
          </button>
        </div>
      </aside>

      <main className="main-with-sidebar">
        {section === "overview" && <OverviewSection />}
        {section === "canteens" && <CanteensSection />}
        {section === "users" && <UsersSection />}
        {section === "analytics" && <AnalyticsSection />}
        {section === "payments" && <PaymentsSection />}
        {(section === "cities" || section === "support") && (
          <div className="page-content">
            <div className="empty-state">
              <span className="empty-icon">🔧</span>
              <h3>{ADMIN_NAV.find(n => n.id === section)?.label}</h3>
              <p>This section is under development</p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function OverviewSection() {
  return (
    <div className="page-content">
      <div className="page-header"><h2>Platform Overview</h2><span className="tag tag-green">● Live</span></div>
      <div className="dashboard-grid">
        {[
          { icon: "🏪", label: "Active Canteens", value: "3", sub: "+1 this month", color: "var(--orange)" },
          { icon: "👥", label: "Total Users", value: "2,841", sub: "+128 this week", color: "var(--blue)" },
          { icon: "📦", label: "Orders Today", value: "1,248", sub: "₹96,240 revenue", color: "var(--green)" },
          { icon: "💰", label: "NoQx Cash Given", value: "₹14,220", sub: "rewards this month", color: "var(--yellow)" },
          { icon: "⭐", label: "Avg. Rating", value: "4.4", sub: "across all canteens", color: "var(--orange)" },
          { icon: "📱", label: "App Users", value: "1,922", sub: "iOS + Android", color: "var(--blue)" },
        ].map(s => (
          <div key={s.label} className="stat-card" style={{ textAlign: "left" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
              <span style={{ fontSize: "1.2rem" }}>{s.icon}</span>
              <span style={{ fontSize: "0.78rem", color: "var(--ink-3)", fontWeight: 600, textTransform: "uppercase" }}>{s.label}</span>
            </div>
            <div className="stat-num" style={{ color: s.color, textAlign: "left" }}>{s.value}</div>
            <div className="stat-label" style={{ textAlign: "left" }}>{s.sub}</div>
          </div>
        ))}
      </div>

      <h3 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "0.75rem" }}>Recent Activity</h3>
      <div className="table-wrap">
        <table>
          <thead><tr><th>TIME</th><th>EVENT</th><th>CANTEEN</th><th>DETAIL</th></tr></thead>
          <tbody>
            {[
              { time: "1:08 PM", event: "New Order", canteen: "IIT Bombay – Main", detail: "ORD-1248 · ₹145" },
              { time: "1:05 PM", event: "OTP Verified", canteen: "BITS Pilani", detail: "Bin #3 · Arjun S." },
              { time: "12:58 PM", event: "Menu Updated", canteen: "VIT Vellore", detail: "Chicken Curry OFF" },
              { time: "12:45 PM", event: "Slot Opened", canteen: "IIT Bombay – Main", detail: "1:30 PM slot (capacity 25)" },
              { time: "12:30 PM", event: "Settlement", canteen: "BITS Pilani", detail: "₹22,400 transferred" },
            ].map((r, i) => (
              <tr key={i}>
                <td style={{ color: "var(--ink-3)", fontSize: "0.8rem" }}>{r.time}</td>
                <td><span className="tag tag-orange">{r.event}</span></td>
                <td style={{ fontSize: "0.82rem" }}>{r.canteen}</td>
                <td style={{ fontSize: "0.82rem", color: "var(--ink-3)" }}>{r.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CanteensSection() {
  return (
    <div className="page-content">
      <div className="page-header">
        <h2>Manage Canteens</h2>
        <button className="btn btn-primary" style={{ fontSize: "0.85rem", padding: "0.5rem 1rem" }}>+ Add Canteen</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>CANTEEN</th><th>COLLEGE</th><th>CITY</th><th>ORDERS</th><th>REVENUE</th><th>STATUS</th><th>ACTION</th></tr></thead>
          <tbody>
            {[
              { id: "c1", name: "Main Canteen", college: "IIT Bombay", city: "Mumbai", status: "active", orders: 1240, revenue: "₹1.2L" },
              { id: "c2", name: "Central Mess", college: "BITS Pilani", city: "Rajasthan", status: "active", orders: 890, revenue: "₹86K" },
              { id: "c3", name: "Block A Caf", college: "NIT Trichy", city: "Chennai", status: "inactive", orders: 0, revenue: "₹0" },
              { id: "c4", name: "Canteen 2", college: "VIT Vellore", city: "Vellore", status: "active", orders: 560, revenue: "₹55K" },
            ].map(c => (
              <tr key={c.id}>
                <td style={{ fontWeight: 600 }}>{c.name}</td>
                <td style={{ fontSize: "0.82rem" }}>{c.college}</td>
                <td style={{ fontSize: "0.82rem", color: "var(--ink-3)" }}>{c.city}</td>
                <td>{c.orders.toLocaleString()}</td>
                <td style={{ fontWeight: 600 }}>{c.revenue}</td>
                <td><span className={`tag ${c.status === "active" ? "tag-green" : "tag-gray"}`}>{c.status}</span></td>
                <td><button className="btn btn-ghost" style={{ fontSize: "0.78rem", padding: "0.25rem 0.5rem" }}>Edit</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function UsersSection() {
  return (
    <div className="page-content">
      <div className="page-header">
        <h2>All Users</h2>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <input className="form-input" type="search" placeholder="Search users…" style={{ width: 220 }} />
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>USER</th><th>PHONE</th><th>COLLEGE</th><th>ORDERS</th><th>REWARDS</th><th>JOINED</th></tr></thead>
          <tbody>
            {[
              { name: "Arjun Sharma", phone: "+91 98765 43210", college: "IIT Bombay", orders: 28, rewards: "₹42", joined: "Jun 2025" },
              { name: "Priya Menon", phone: "+91 90123 45678", college: "BITS Pilani", orders: 14, rewards: "₹18", joined: "Jul 2025" },
              { name: "Karan Das", phone: "+91 87654 32109", college: "NIT Trichy", orders: 6, rewards: "₹8", joined: "Jul 2025" },
              { name: "Sneha Joshi", phone: "+91 81234 56789", college: "VIT Vellore", orders: 35, rewards: "₹62", joined: "May 2025" },
              { name: "Rohan Kumar", phone: "+91 77654 32100", college: "IIT Bombay", orders: 52, rewards: "₹88", joined: "Apr 2025" },
            ].map((u, i) => (
              <tr key={i}>
                <td style={{ fontWeight: 600 }}>{u.name}</td>
                <td style={{ fontSize: "0.82rem", color: "var(--ink-3)" }}>{u.phone}</td>
                <td style={{ fontSize: "0.82rem" }}>{u.college}</td>
                <td>{u.orders}</td>
                <td style={{ color: "var(--green)", fontWeight: 600 }}>{u.rewards}</td>
                <td style={{ fontSize: "0.78rem", color: "var(--ink-3)" }}>{u.joined}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AnalyticsSection() {
  return (
    <div className="page-content">
      <div className="page-header"><h2>Platform Analytics</h2></div>
      <div className="stats-row">
        <div className="stat-card"><div className="stat-num">₹2.4L</div><div className="stat-label">Revenue This Month</div></div>
        <div className="stat-card"><div className="stat-num">14,820</div><div className="stat-label">Orders This Month</div></div>
        <div className="stat-card"><div className="stat-num">2,841</div><div className="stat-label">Active Users</div></div>
        <div className="stat-card"><div className="stat-num" style={{ color: "var(--green)" }}>4.4★</div><div className="stat-label">Avg Platform Rating</div></div>
      </div>
      <div className="card" style={{ textAlign: "center", padding: "2rem", color: "var(--ink-3)" }}>
        <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>📈</div>
        <div style={{ fontWeight: 600 }}>Revenue chart coming soon</div>
        <div style={{ fontSize: "0.8rem" }}>Connect to the API backend for live charts</div>
      </div>
    </div>
  );
}

function PaymentsSection() {
  return (
    <div className="page-content">
      <div className="page-header"><h2>Payments & Settlements</h2></div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>DATE</th><th>CANTEEN</th><th>ORDERS</th><th>GROSS</th><th>PLATFORM FEE</th><th>NET</th><th>STATUS</th></tr></thead>
          <tbody>
            {[
              { date: "Jul 28, 2025", canteen: "IIT Bombay – Main", orders: 42, gross: "₹3,240", fee: "₹162", net: "₹3,078", status: "settled" },
              { date: "Jul 27, 2025", canteen: "BITS Pilani – Mess", orders: 38, gross: "₹2,940", fee: "₹147", net: "₹2,793", status: "settled" },
              { date: "Jul 28, 2025", canteen: "VIT Vellore – Caf 2", orders: 24, gross: "₹1,880", fee: "₹94", net: "₹1,786", status: "pending" },
            ].map((r, i) => (
              <tr key={i}>
                <td style={{ fontSize: "0.82rem", color: "var(--ink-3)" }}>{r.date}</td>
                <td style={{ fontSize: "0.82rem" }}>{r.canteen}</td>
                <td>{r.orders}</td>
                <td style={{ fontWeight: 600 }}>{r.gross}</td>
                <td style={{ color: "var(--red)" }}>{r.fee}</td>
                <td style={{ fontWeight: 700, color: "var(--green)" }}>{r.net}</td>
                <td><span className={`tag ${r.status === "settled" ? "tag-green" : "tag-yellow"}`}>{r.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}



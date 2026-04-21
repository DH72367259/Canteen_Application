"use client";

import Link from "next/link";

const TRANSACTIONS = [
  { id: 1, type: "earn", desc: "Order #ORD001 – On-time pickup bonus", amount: 3, date: "Today, 1:05 PM", expiry: "in 14 days" },
  { id: 2, type: "earn", desc: "Order #ORD003 – ₹80 order reward", amount: 1, date: "Yesterday, 12:38 PM", expiry: "in 13 days" },
  { id: 3, type: "spend", desc: "Used at checkout – Order #ORD099", amount: -5, date: "3 days ago", expiry: null },
  { id: 4, type: "earn", desc: "Order #ORD088 – ₹110 order reward", amount: 2, date: "5 days ago", expiry: "in 9 days" },
];

export default function RewardsPage() {
  const balance = 12;
  const expiringAmount = 3;
  const expiryDays = 6;

  return (
    <div className="app-shell">
      {/* Top bar */}
      <div className="topbar">
        <Link href="/dashboard" style={{ background: "none", border: "none", cursor: "pointer", fontSize: "1.1rem", color: "var(--ink-3)", textDecoration: "none" }}>←</Link>
        <h1 style={{ fontSize: "1.05rem", fontWeight: 700 }}>NoQx Cash</h1>
        <div />
      </div>

      {/* Balance card */}
      <div className="rewards-balance-card">
        <div className="balance-label">Total Balance</div>
        <div className="balance-amount">₹{balance}</div>
        <div className="balance-sub">Max ₹20 per order · Min ₹10 to redeem</div>
        {expiringAmount > 0 && (
          <div style={{ marginTop: "0.75rem", background: "rgba(255,255,255,0.12)", borderRadius: 12, padding: "0.5rem 0.75rem", fontSize: "0.78rem" }}>
            ⚠️ ₹{expiringAmount} expires in {expiryDays} days
          </div>
        )}
      </div>

      {/* How to earn */}
      <div style={{ padding: "0 1rem" }}>
        <h3 style={{ fontSize: "0.9rem", fontWeight: 700, marginBottom: "0.75rem", marginTop: "0.5rem" }}>How to earn NoQx Cash</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.6rem" }}>
          {[
            { icon: "₹1", label: "Order ≥₹50", sub: "Get ₹1 reward" },
            { icon: "₹2", label: "Order ≥₹100", sub: "Get ₹2 reward" },
            { icon: "⏱", label: "On-time pickup", sub: "+₹1 extra bonus" },
            { icon: "📅", label: "14-day expiry", sub: "Use before they expire" },
          ].map(item => (
            <div key={item.label} className="card" style={{ textAlign: "center", padding: "0.75rem" }}>
              <div style={{ fontSize: "1.4rem", marginBottom: "0.25rem" }}>{item.icon}</div>
              <div style={{ fontSize: "0.8rem", fontWeight: 700 }}>{item.label}</div>
              <div style={{ fontSize: "0.72rem", color: "var(--ink-3)" }}>{item.sub}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Transactions */}
      <div style={{ padding: "0 1rem 5rem" }}>
        <h3 style={{ fontSize: "0.9rem", fontWeight: 700, margin: "1rem 0 0.6rem" }}>Transaction History</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {TRANSACTIONS.map(t => (
            <div key={t.id} className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem", padding: "0.75rem" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: "0.82rem", fontWeight: 600 }}>{t.desc}</div>
                <div style={{ fontSize: "0.72rem", color: "var(--ink-3)", marginTop: "0.15rem" }}>{t.date}{t.expiry ? ` · Expires ${t.expiry}` : ""}</div>
              </div>
              <div style={{ fontWeight: 800, fontSize: "0.95rem", color: t.type === "earn" ? "var(--green)" : "var(--red)", flexShrink: 0 }}>
                {t.type === "earn" ? "+" : ""}₹{Math.abs(t.amount)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Bottom nav */}
      <nav className="bottom-nav">
        {[
          { tab: "home", icon: "🏠", label: "Home", href: "/dashboard" },
          { tab: "orders", icon: "📦", label: "My Orders", href: "/dashboard/orders" },
          { tab: "rewards", icon: "💰", label: "Rewards", href: "/dashboard/rewards" },
          { tab: "profile", icon: "👤", label: "Profile", href: "/dashboard/profile" },
        ].map(item => (
          <Link key={item.tab} href={item.href} className={`bottom-nav-item ${item.tab === "rewards" ? "active" : ""}`}>
            <span className="nav-icon">{item.icon}</span>
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}

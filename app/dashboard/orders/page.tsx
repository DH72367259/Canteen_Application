"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface Transaction {
  orderId:      string;
  paymentId:    string;
  amount:       number;
  canteen:      string;
  items:        string;
  slot:         string;
  bin:          string;
  status:       string;
  refundStatus: string | null;
  timestamp:    string;
}
interface ActiveOrder {
  id:    string;
  bin:   string;
  otp:   string;
  slot:  string;
  items: string;
}

function relativeDate(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000)        return "Just now";
  if (diff < 3_600_000)     return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000)    return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 172_800_000)   return "Yesterday";
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export default function MyOrdersPage() {
  const router = useRouter();
  const [txns,        setTxns]        = useState<Transaction[]>([]);
  const [activeOrder, setActiveOrder] = useState<ActiveOrder | null>(null);
  const [tab,         setTab]         = useState<"orders" | "transactions">("orders");

  useEffect(() => {
    try {
      const raw = localStorage.getItem("noqx_transactions");
      if (raw) setTxns(JSON.parse(raw));
      const ao  = localStorage.getItem("canteen_active_order");
      if (ao)  setActiveOrder(JSON.parse(ao));
    } catch { /* ignore */ }
  }, []);

  return (
    <div className="app-shell">
      {/* Top bar */}
      <div className="topbar">
        <button onClick={() => router.back()} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "1.1rem", color: "var(--ink-3)" }}>←</button>
        <h1 style={{ fontSize: "1.1rem", fontWeight: 700 }}>My Orders</h1>
        <div />
      </div>

      {/* Tab switcher */}
      <div className="slot-tabs" style={{ gap: "0.4rem" }}>
        {(["orders", "transactions"] as const).map(t => (
          <button key={t} className={`slot-tab ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>
            {t === "orders" ? "Active Order" : `History (${txns.length})`}
          </button>
        ))}
      </div>

      <div style={{ padding: "0.75rem 1rem", display: "flex", flexDirection: "column", gap: "0.75rem", paddingBottom: "5rem" }}>

        {tab === "orders" && (
          activeOrder ? (
            <div className="card" style={{ padding: "1rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.5rem" }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: "0.95rem" }}>{activeOrder.id}</div>
                  <div style={{ fontSize: "0.8rem", color: "var(--ink-3)" }}>{activeOrder.slot}</div>
                </div>
                <span className="tag tag-green">
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--green)", display: "inline-block", marginRight: 4 }} />
                  Active
                </span>
              </div>
              <div style={{ fontSize: "0.82rem", color: "var(--ink-3)", marginBottom: "0.5rem" }}>{activeOrder.items}</div>
              <div style={{ background: "var(--green-light)", border: "1px solid #bbf7d0", borderRadius: 12, padding: "0.75rem", marginTop: "0.25rem" }}>
                <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "#15803d", textTransform: "uppercase", marginBottom: "0.3rem" }}>
                  Show this OTP at pickup · {activeOrder.bin}
                </div>
                <div style={{ fontSize: "2rem", fontWeight: 900, letterSpacing: "0.3em", color: "var(--ink)" }}>
                  {activeOrder.otp}
                </div>
                <div style={{ fontSize: "0.72rem", color: "var(--ink-3)", marginTop: "0.25rem" }}>
                  Canteen staff will confirm your order using this OTP.
                </div>
              </div>
              <button
                className="btn btn-outline btn-full"
                style={{ marginTop: "0.75rem", fontSize: "0.82rem", padding: "0.5rem" }}
                onClick={() => { localStorage.removeItem("canteen_active_order"); setActiveOrder(null); }}>
                Mark as collected
              </button>
            </div>
          ) : (
            <div className="empty-state">
              <span className="empty-icon">📦</span>
              <h3>No active order</h3>
              <p>Your current order will appear here after checkout.</p>
              <Link href="/dashboard" className="btn btn-primary" style={{ marginTop: "0.5rem" }}>Browse canteens</Link>
            </div>
          )
        )}

        {tab === "transactions" && (
          txns.length === 0 ? (
            <div className="empty-state">
              <span className="empty-icon">🧾</span>
              <h3>No transactions yet</h3>
              <p>Your payment history will appear here after your first order.</p>
              <Link href="/dashboard" className="btn btn-primary" style={{ marginTop: "0.5rem" }}>Place an order</Link>
            </div>
          ) : txns.map((txn, i) => (
            <div key={i} className="card" style={{ padding: "0.85rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: "0.88rem" }}>{txn.orderId}</div>
                  <div style={{ fontSize: "0.76rem", color: "var(--ink-3)" }}>{txn.canteen} · {txn.slot}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontWeight: 800, color: "var(--orange)" }}>₹{txn.amount}</div>
                  <div style={{ fontSize: "0.7rem", color: "var(--ink-3)" }}>{relativeDate(txn.timestamp)}</div>
                </div>
              </div>
              <div style={{ fontSize: "0.8rem", color: "var(--ink-3)", margin: "0.4rem 0" }}>{txn.items}</div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: "0.72rem", color: "var(--ink-3)", fontFamily: "monospace" }}>
                  {txn.paymentId !== "WALLET" ? `ID: ${txn.paymentId}` : "Paid via wallet"}
                </span>
                {txn.refundStatus ? (
                  <span className="tag tag-blue">Refund in progress</span>
                ) : (
                  <span className="tag tag-green">Paid</span>
                )}
              </div>
              {txn.refundStatus && (
                <div style={{ fontSize: "0.72rem", color: "var(--blue)", marginTop: "0.4rem", padding: "0.4rem 0.6rem", background: "var(--blue-light, #eff6ff)", borderRadius: 8 }}>
                  Refund initiated · expected within 5-7 business days.
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Bottom nav */}
      <nav className="bottom-nav">
        {[
          { tab: "home",    icon: "🏠", label: "Home",      href: "/dashboard" },
          { tab: "orders",  icon: "📦", label: "My Orders", href: "/dashboard/orders" },
          { tab: "rewards", icon: "💰", label: "Rewards",   href: "/dashboard/rewards" },
          { tab: "profile", icon: "👤", label: "Profile",   href: "/dashboard/profile" },
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

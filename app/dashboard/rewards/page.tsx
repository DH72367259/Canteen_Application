"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

interface RewardTransaction {
  id: string;
  type: "earned" | "redeemed" | "expired";
  points: number;
  reason: string;
  created_at: string;
  expires_at?: string;
}

function daysUntilExpiry(isoDate?: string): number | null {
  if (!isoDate) return null;
  const diff = new Date(isoDate).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

export default function RewardsPage() {
  const router = useRouter();
  const { user, session, loading } = useAuth();
  const [transactions, setTransactions] = useState<RewardTransaction[]>([]);
  const [fetching, setFetching] = useState(true);

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [user, loading, router]);

  useEffect(() => {
    if (!session) return;
    fetch("/api/rewards", { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then(r => r.json())
      .then(d => { setTransactions(d.transactions ?? []); setFetching(false); })
      .catch(() => setFetching(false));
  }, [session]);

  const balance = user?.walletBalance ?? 0;
  const expiringTx = transactions.find(t => t.type === "earned" && daysUntilExpiry(t.expires_at) !== null && (daysUntilExpiry(t.expires_at) ?? 8) <= 7);
  const expiryDays = expiringTx ? daysUntilExpiry(expiringTx.expires_at) : null;

  if (loading) return <div className="page-loading"><div className="spinner" /></div>;

  return (
    <div className="app-shell">
      {/* Top bar */}
      <div className="app-topbar">
        <button onClick={() => router.back()} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "1.1rem", color: "var(--ink-3)" }}>←</button>
        <h1 style={{ fontSize: "1.05rem", fontWeight: 700 }}>NoQx Cash</h1>
        <div />
      </div>

      {/* Balance card */}
      <div className="rewards-balance-card">
        <div className="balance-label">Total Balance</div>
        <div className="balance-amount">₹{balance}</div>
        {expiryDays !== null && expiryDays <= 7 && expiringTx && (
          <div style={{ marginTop: "0.75rem", background: "rgba(255,255,255,0.15)", borderRadius: 12, padding: "0.5rem 0.75rem", fontSize: "0.78rem" }}>
            ⚡ ₹{expiringTx.points} expiring in {expiryDays === 0 ? "today" : `${expiryDays} day${expiryDays !== 1 ? "s" : ""}`}
          </div>
        )}
      </div>

      {/* How it works */}
      <div style={{ padding: "0 1rem" }}>
        <h3 style={{ fontSize: "0.9rem", fontWeight: 700, marginBottom: "0.5rem", marginTop: "0.5rem" }}>HOW IT WORKS</h3>
        <div style={{ fontSize: "0.85rem", color: "var(--ink-2)", lineHeight: 1.8 }}>
          🍽️ Order → Earn rewards<br />
          ⏰ Pickup → Earn more<br />
          💵 Use on next order
        </div>
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
          <div style={{ flex: 1, background: "var(--orange-light)", border: "1px solid #fed7aa", borderRadius: 12, padding: "0.65rem", textAlign: "center" }}>
            <div style={{ fontWeight: 700, color: "var(--orange-dark)", fontSize: "0.8rem" }}>Expiry</div>
            <div style={{ fontSize: "0.72rem", color: "var(--ink-3)", marginTop: "0.25rem" }}>7 days from earning</div>
          </div>
          <div style={{ flex: 1, background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 12, padding: "0.65rem", textAlign: "center" }}>
            <div style={{ fontWeight: 700, color: "var(--green)", fontSize: "0.8rem" }}>Earn Rate</div>
            <div style={{ fontSize: "0.72rem", color: "var(--ink-3)", marginTop: "0.25rem" }}>₹1 per ₹50 ordered</div>
          </div>
        </div>
      </div>

      {/* Transactions */}
      <div style={{ padding: "0 1rem 5rem" }}>
        <h3 style={{ fontSize: "0.9rem", fontWeight: 700, margin: "1rem 0 0.6rem" }}>RECENT ACTIVITY</h3>
        {fetching ? <p style={{ color: "var(--ink-3)", fontSize: "0.85rem" }}>Loading...</p> : null}
        {!fetching && transactions.length === 0 && (
          <p style={{ color: "var(--ink-3)", fontSize: "0.85rem" }}>No transactions yet. Place an order to start earning!</p>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {transactions.map(t => {
            const days = daysUntilExpiry(t.expires_at);
            return (
              <div key={t.id} className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem", padding: "0.75rem" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "0.82rem", fontWeight: 600 }}>{t.reason || (t.type === "earned" ? "Order reward" : t.type === "redeemed" ? "Used at checkout" : "Expired")}</div>
                  <div style={{ fontSize: "0.72rem", color: "var(--ink-3)", marginTop: "0.15rem" }}>
                    {new Date(t.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                    {t.type === "earned" && days !== null && days <= 7 && ` · ⚡ Expires in ${days}d`}
                  </div>
                </div>
                <div style={{ fontWeight: 800, fontSize: "0.95rem", color: t.type === "earned" ? "var(--green)" : "var(--red)", flexShrink: 0 }}>
                  {t.type === "earned" ? "+" : "-"}₹{Math.abs(t.points)}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Bottom nav */}
      <nav className="bottom-nav">
        {[
          { tab: "home",    icon: "🏠", label: "Home",      href: "/dashboard" },
          { tab: "orders",  icon: "📦", label: "My Orders", href: "/dashboard/orders" },
          { tab: "rewards", icon: "💰", label: "Rewards",   href: "/dashboard/rewards" },
          { tab: "profile", icon: "👤", label: "Profile",   href: "/dashboard/profile" },
        ].map(item => (
          <a key={item.tab} href={item.href} className={`bottom-nav-item ${item.tab === "rewards" ? "active" : ""}`}>
            <span className="nav-icon">{item.icon}</span>
            <span>{item.label}</span>
          </a>
        ))}
      </nav>
    </div>
  );
}

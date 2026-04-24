"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";

interface RewardTx {
  orderId: string;
  amount: number;
  type: "earn" | "redeem";
  description: string;
  timestamp: string;
}

export default function RewardsPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [balance, setBalance] = useState(0);
  const [expiringAmount, setExpiringAmount] = useState(0);
  const [totalSaved, setTotalSaved] = useState(0);
  const [transactions, setTransactions] = useState<RewardTx[]>([]);

  useEffect(() => {
    if (!loading && !user) router.replace("/login?role=user");
  }, [user, loading, router]);

  useEffect(() => {
    // Load wallet balance from localStorage (source of truth currently)
    const bal = Number(localStorage.getItem("canteen_wallet_balance") || "0");
    setBalance(bal);

    // Compute expiring amount (simulate: any balance earned > 5 days ago expires soon)
    const txns: RewardTx[] = JSON.parse(localStorage.getItem("canteen_reward_transactions") || "[]");
    setTransactions(txns);

    // Calculate total saved using NoQx
    const saved = txns.filter(t => t.type === "redeem").reduce((s, t) => s + Math.abs(t.amount), 0);
    setTotalSaved(saved);

    // Check for expiring rewards (earned > 5 days ago, < 7 days)
    const now = Date.now();
    const expiring = txns
      .filter(t => t.type === "earn")
      .filter(t => {
        const age = (now - new Date(t.timestamp).getTime()) / (1000 * 60 * 60 * 24);
        return age >= 5 && age < 7;
      })
      .reduce((s, t) => s + t.amount, 0);
    setExpiringAmount(expiring);
  }, []);

  if (loading || !user) return <div className="loading-screen"><div className="spinner" /></div>;

  return (
    <div className="app-shell">
      {/* Top bar */}
      <div className="topbar">
        <button onClick={() => router.back()} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "1.2rem", color: "var(--ink-3)", padding: "0.25rem" }}>←</button>
        <h1 style={{ fontSize: "1rem", fontWeight: 700 }}>Rewards</h1>
        <div />
      </div>

      <div style={{ padding: "0 1rem 6rem", display: "flex", flexDirection: "column", gap: "1rem" }}>

        {/* Balance card */}
        <div style={{
          background: "linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)",
          borderRadius: 20, padding: "1.5rem 1.25rem",
          color: "#fff", textAlign: "center",
          boxShadow: "0 8px 24px rgba(124,58,237,0.35)",
        }}>
          <div style={{ fontSize: "0.78rem", fontWeight: 600, opacity: 0.85, marginBottom: "0.25rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            NoQx Cash
          </div>
          <div style={{ fontSize: "3rem", fontWeight: 900, lineHeight: 1.1, marginBottom: "0.1rem" }}>
            {balance}/-
          </div>
          <div style={{ fontSize: "0.8rem", opacity: 0.8 }}>NoQx Cash</div>

          {expiringAmount > 0 && (
            <div style={{ marginTop: "0.85rem", background: "rgba(255,255,255,0.15)", borderRadius: 10, padding: "0.4rem 0.75rem", fontSize: "0.78rem", fontWeight: 600 }}>
              ⚡ ₹{expiringAmount} expiring in 2 days
            </div>
          )}

          {totalSaved > 0 && (
            <div style={{ marginTop: "0.5rem", fontSize: "0.82rem", opacity: 0.9, fontWeight: 600 }}>
              You&apos;ve saved ₹{totalSaved} using NoQx
            </div>
          )}
        </div>

        {/* How it works */}
        <div className="card" style={{ padding: "1rem" }}>
          <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--ink-3)", textTransform: "uppercase", marginBottom: "0.75rem" }}>
            HOW IT WORKS
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
            {[
              { icon: "🍽️", text: "Order → Earn rewards" },
              { icon: "⏱️", text: "Pickup → Earn more" },
              { icon: "💚", text: "Use on next order" },
            ].map(({ icon, text }) => (
              <div key={text} style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                <span style={{ fontSize: "1rem" }}>{icon}</span>
                <span style={{ fontSize: "0.88rem", fontWeight: 600, color: "var(--ink)" }}>{text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Expiry notice */}
        <div style={{ background: "#fef9c3", border: "1.5px solid #fde68a", borderRadius: 12, padding: "0.75rem 1rem", display: "flex", alignItems: "flex-start", gap: "0.6rem" }}>
          <span style={{ fontSize: "1rem", flexShrink: 0 }}>ℹ️</span>
          <div style={{ fontSize: "0.78rem", color: "#92400e" }}>
            Rewards expire <strong>7 days</strong> from the date they are earned. Use them before they expire!
          </div>
        </div>

        {/* Use in checkout nudge */}
        <div style={{ background: "var(--orange-light)", border: "1.5px solid #fed7aa", borderRadius: 12, padding: "0.75rem 1rem", fontSize: "0.82rem", color: "#92400e", fontWeight: 600 }}>
          {balance > 0
            ? `💡 Use ₹${balance} before it expires — applied automatically at checkout`
            : "💡 Place an order to start earning NoQx Cash rewards!"}
        </div>

        {/* NoQx Pro banner */}
        <Link href="/dashboard/pro" style={{ textDecoration: "none" }}>
          <div style={{ background: "linear-gradient(135deg, #f97316, #ea580c)", borderRadius: 16, padding: "1rem", color: "#fff", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: "0.95rem", marginBottom: "0.15rem" }}>⚡ NoQx Pro</div>
              <div style={{ fontSize: "0.78rem", opacity: 0.9 }}>Skip queues · ₹0 convenience fee · ₹49/month</div>
            </div>
            <span style={{ fontWeight: 700, fontSize: "0.88rem" }}>Upgrade →</span>
          </div>
        </Link>

        {/* Transaction history */}
        <div>
          <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--ink-3)", textTransform: "uppercase", marginBottom: "0.5rem" }}>
            RECENT ACTIVITY
          </div>
          {transactions.length === 0 ? (
            <div className="card" style={{ padding: "1.5rem", textAlign: "center", color: "var(--ink-3)" }}>
              <div style={{ fontSize: "1.5rem", marginBottom: "0.4rem" }}>🎁</div>
              <div style={{ fontSize: "0.85rem", fontWeight: 600 }}>No rewards yet</div>
              <div style={{ fontSize: "0.78rem", marginTop: "0.25rem" }}>Place your first order to start earning!</div>
            </div>
          ) : (
            transactions.slice(0, 20).map((tx, i) => (
              <div key={i} className="card" style={{ padding: "0.75rem 1rem", marginBottom: "0.5rem", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: "0.85rem" }}>{tx.description}</div>
                  <div style={{ fontSize: "0.72rem", color: "var(--ink-3)" }}>
                    Order#{tx.orderId.substring(0, 8).toUpperCase()} · {new Date(tx.timestamp).toLocaleDateString("en-IN")}
                  </div>
                </div>
                <div style={{ fontWeight: 800, fontSize: "0.95rem", color: tx.type === "earn" ? "#16a34a" : "#f97316" }}>
                  {tx.type === "earn" ? "+" : "-"}₹{Math.abs(tx.amount)}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Bottom nav */}
      <nav className="bottom-nav">
        {([
          { tab: "home", icon: "🏠", label: "Home", href: "/dashboard" },
          { tab: "orders", icon: "📦", label: "My Orders", href: "/dashboard/orders" },
          { tab: "rewards", icon: "🎁", label: "Rewards", href: "/dashboard/rewards" },
          { tab: "profile", icon: "👤", label: "Profile", href: "/dashboard/profile" },
        ] as const).map(({ tab, icon, label, href }) => (
          <Link key={tab} href={href} className={`bottom-nav-item ${tab === "rewards" ? "active" : ""}`}>
            <span className="nav-icon">{icon}</span>
            <span>{label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}

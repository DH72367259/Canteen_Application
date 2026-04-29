"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";

const FEATURES = [
  { icon: "⚡", title: "Priority Pickup",    desc: "Your orders are prepped sooner." },
  { icon: "₹0", title: "Zero Convenience Fee", desc: "No ₹4 fee, ever. Every single order." },
  { icon: "🔔", title: "Instant Notifications", desc: "Be first to know when ready." },
  { icon: "🏆", title: "Pro Badge",           desc: "Show off your membership." },
];

export default function ProPage() {
  const router = useRouter();
  const { session } = useAuth();
  const [isPro, setIsPro] = useState(false);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [daysLeft, setDaysLeft] = useState<number>(0);
  const [savingsPaise, setSavingsPaise] = useState<number>(0);
  const [ordersSincePro, setOrdersSincePro] = useState<number>(0);

  useEffect(() => {
    // Fast-path from localStorage so the UI never flashes "Get Pro" for an
    // already-paid member while the server fetch is in flight.
    const proActive = localStorage.getItem("noqx_pro_active");
    if (proActive === "true") {
      setIsPro(true);
      const exp = localStorage.getItem("noqx_pro_expires");
      if (exp) setExpiresAt(exp);
    }
    // Authoritative refresh from the server (covers expiry + savings).
    if (!session?.access_token) return;
    let cancelled = false;
    fetch("/api/subscriptions", { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(j => {
        if (cancelled || !j) return;
        if (j.isActive) {
          setIsPro(true);
          if (j.subscription?.expires_at) {
            setExpiresAt(j.subscription.expires_at);
            localStorage.setItem("noqx_pro_active", "true");
            localStorage.setItem("noqx_pro_expires", j.subscription.expires_at);
          }
          setDaysLeft(Number(j.daysLeft) || 0);
          setSavingsPaise(Number(j.savingsPaise) || 0);
          setOrdersSincePro(Number(j.ordersSincePro) || 0);
        } else {
          setIsPro(false);
          localStorage.removeItem("noqx_pro_active");
          localStorage.removeItem("noqx_pro_expires");
        }
      })
      .catch(() => { /* keep localStorage fast-path */ });
    return () => { cancelled = true; };
  }, [session]);

  return (
    <div className="app-shell">
      <div className="topbar">
        <button onClick={() => router.back()} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "1.2rem", color: "var(--ink-3)", padding: "0.25rem" }}>←</button>
        <h1 style={{ fontSize: "1rem", fontWeight: 700 }}>NoQx Pro</h1>
        <div />
      </div>

      <div style={{ padding: "0 1rem 6rem", display: "flex", flexDirection: "column", gap: "1.25rem" }}>

        {/* Hero */}
        <div style={{
          background: "linear-gradient(135deg, #f97316 0%, #ea580c 100%)",
          borderRadius: 20, padding: "1.75rem 1.25rem", color: "#fff", textAlign: "center",
          boxShadow: "0 8px 32px rgba(249,115,22,0.35)",
        }}>
          <div style={{ fontSize: "2.5rem", marginBottom: "0.5rem" }}>💎</div>
          <h2 style={{ fontWeight: 900, fontSize: "1.4rem", marginBottom: "0.3rem" }}>NoQx Pro</h2>
          <p style={{ fontSize: "0.88rem", opacity: 0.9, marginBottom: "1rem" }}>
            Skip queues every day · Zero convenience fee, every order
          </p>
          <div style={{ fontSize: "2.25rem", fontWeight: 900 }}>
            ₹69<span style={{ fontSize: "1rem", fontWeight: 500, opacity: 0.85 }}>/month</span>
          </div>
        </div>

        {/* Active badge — shows days-left + total saved (PDF requirement) */}
        {isPro && (
          <div style={{ background: "#f0fdf4", border: "1.5px solid #86efac", borderRadius: 14, padding: "0.95rem 1rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.6rem" }}>
              <span style={{ fontSize: "1.2rem" }}>✅</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: "0.9rem", color: "#15803d" }}>You&apos;re a Pro member!</div>
                {expiresAt && (
                  <div style={{ fontSize: "0.75rem", color: "#166534", marginTop: "0.1rem" }}>
                    Active until {new Date(expiresAt).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}
                  </div>
                )}
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.6rem" }}>
              <div style={{ background: "#fff", border: "1px solid #bbf7d0", borderRadius: 10, padding: "0.55rem 0.75rem", textAlign: "center" }}>
                <div style={{ fontSize: "1.35rem", fontWeight: 900, color: "#15803d" }}>{daysLeft}</div>
                <div style={{ fontSize: "0.7rem", color: "#166534", fontWeight: 600 }}>days left</div>
              </div>
              <div style={{ background: "#fff", border: "1px solid #bbf7d0", borderRadius: 10, padding: "0.55rem 0.75rem", textAlign: "center" }}>
                <div style={{ fontSize: "1.35rem", fontWeight: 900, color: "#15803d" }}>₹{(savingsPaise / 100).toFixed(0)}</div>
                <div style={{ fontSize: "0.7rem", color: "#166534", fontWeight: 600 }}>saved · {ordersSincePro} orders</div>
              </div>
            </div>
          </div>
        )}

        {/* Features */}
        <div>
          <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--ink-3)", textTransform: "uppercase", marginBottom: "0.6rem" }}>What you get</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
            {FEATURES.map(f => (
              <div key={f.icon} style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem", background: "#fff", border: "1px solid var(--border)", borderRadius: 14, padding: "0.75rem 1rem" }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: "var(--orange-light)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1rem", fontWeight: 800, color: "var(--orange)", flexShrink: 0 }}>
                  {f.icon}
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: "0.88rem" }}>{f.title}</div>
                  <div style={{ fontSize: "0.78rem", color: "var(--ink-3)", marginTop: "0.1rem" }}>{f.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Savings calculator */}
        <div style={{ background: "#fef9c3", border: "1.5px solid #fde68a", borderRadius: 14, padding: "0.85rem 1rem" }}>
          <div style={{ fontWeight: 700, fontSize: "0.85rem", marginBottom: "0.4rem" }}>💡 Break-even in 13 orders</div>
          <div style={{ fontSize: "0.78rem", color: "#92400e" }}>
            Order 13 times/month and Pro pays for itself. Order more and you&apos;re saving real money.
          </div>
        </div>

        {/* Error banner removed: Pro CTA no longer triggers payment, so no error path can reach here. */}



        {/* CTA */}
        {!isPro ? (
          <button
            onClick={() => router.push("/dashboard")}
            className="btn btn-primary btn-full"
            style={{ padding: "0.95rem", fontSize: "1.05rem", fontWeight: 800 }}
          >
            Order Now avail Benefits →
          </button>
        ) : (
          <div style={{ textAlign: "center", fontSize: "0.78rem", color: "var(--ink-3)", padding: "0.5rem" }}>
            Renewal is manual. Come back before expiry to continue.
          </div>
        )}

        <div style={{ fontSize: "0.7rem", color: "var(--ink-3)", textAlign: "center" }}>
          Pro is added to your next order at checkout · No auto-renewal
        </div>
      </div>

      {/* Bottom nav */}
      <nav className="bottom-nav">
        {[
          { icon: "🏠", label: "Home",      href: "/dashboard", active: false },
          { icon: "📦", label: "My Orders", href: "/dashboard/orders", active: false },
          { icon: "👤", label: "Profile",   href: "/dashboard/profile", active: false },
        ].map(item => (
          <Link key={item.href} href={item.href} className={`bottom-nav-item ${item.active ? "active" : ""}`}>
            <span className="nav-icon">{item.icon}</span>
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}

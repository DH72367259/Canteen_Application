"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Razorpay: new (opts: any) => { open(): void };
  }
}

function loadRazorpay(): Promise<boolean> {
  return new Promise(resolve => {
    if (typeof window !== "undefined" && window.Razorpay) { resolve(true); return; }
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload  = () => resolve(true);
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
}

const FEATURES = [
  { icon: "⚡", title: "Priority Pickup",    desc: "Your orders are prepped sooner." },
  { icon: "₹0", title: "Zero Convenience Fee", desc: "No ₹4 fee, ever. Every single order." },
  { icon: "🔔", title: "Instant Notifications", desc: "Be first to know when ready." },
  { icon: "🏆", title: "Pro Badge",           desc: "Show off your membership." },
];

export default function ProPage() {
  const router = useRouter();
  const { user, session } = useAuth();
  const [isPro, setIsPro] = useState(false);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const proActive = localStorage.getItem("noqx_pro_active");
    if (proActive === "true") {
      setIsPro(true);
      const exp = localStorage.getItem("noqx_pro_expires");
      if (exp) setExpiresAt(exp);
    }
  }, []);

  async function handleSubscribe() {
    if (!user) { router.push("/login"); return; }
    setBusy(true); setError(null);

    const loaded = await loadRazorpay();
    if (!loaded) {
      setError("Payment gateway failed to load. Check your internet connection.");
      setBusy(false);
      return;
    }

    try {
      const res = await fetch("/api/payments/razorpay-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: 49, canteenId: "pro", userId: user.uid, slotId: "pro" }),
      });
      const json = await res.json();
      if (!res.ok || !json.orderId) {
        setError(json.error || "Could not initiate payment. Please try again.");
        setBusy(false);
        return;
      }

      const rzp = new window.Razorpay({
        key:         json.keyId,
        amount:      json.amount,
        currency:    json.currency,
        name:        "NoQx Pro",
        description: "Monthly subscription — ₹49/month",
        order_id:    json.orderId,
        prefill:     { name: user.displayName || "", email: user.email || "" },
        theme:       { color: "#f97316" },
        modal: {
          ondismiss: () => { setBusy(false); },
        },
        handler: async (resp: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => {
          try {
            const verifyRes = await fetch("/api/payments/razorpay-verify", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ razorpay_order_id: resp.razorpay_order_id, razorpay_payment_id: resp.razorpay_payment_id, razorpay_signature: resp.razorpay_signature }),
            });
            const vd = await verifyRes.json();
            if (!verifyRes.ok || !vd.success) {
              setError("Payment could not be verified. Please contact support.");
              setBusy(false);
              return;
            }
            // Record subscription in Supabase via API if user has a session
            if (session?.access_token) {
              await fetch("/api/subscriptions", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
                body: JSON.stringify({ paymentId: resp.razorpay_payment_id, amount: 49 }),
              });
            }
            // Save to localStorage as fast-path
            const expiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
            localStorage.setItem("noqx_pro_active", "true");
            localStorage.setItem("noqx_pro_expires", expiry);
            setIsPro(true); setExpiresAt(expiry); setSuccess(true); setBusy(false);
          } catch {
            setError("Verification error. If money was debited, it will be auto-refunded within 5–7 business days.");
            setBusy(false);
          }
        },
      });
      rzp.open();
    } catch {
      setError("Network error. Please try again.");
      setBusy(false);
    }
  }

  if (success) {
    return (
      <div className="app-shell" style={{ alignItems: "center", justifyContent: "center", textAlign: "center", padding: "2rem 1rem" }}>
        <div style={{ fontSize: "3.5rem", marginBottom: "0.75rem" }}>🎉</div>
        <h2 style={{ fontWeight: 900, fontSize: "1.3rem", marginBottom: "0.5rem" }}>Welcome to NoQx Pro!</h2>
        <p style={{ color: "var(--ink-3)", fontSize: "0.9rem", marginBottom: "1.5rem" }}>
          You now enjoy ₹0 convenience fee on every order this month.
        </p>
        <button className="btn btn-primary btn-full" style={{ maxWidth: 320 }} onClick={() => router.push("/dashboard")}>
          Start ordering →
        </button>
      </div>
    );
  }

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
            ₹49<span style={{ fontSize: "1rem", fontWeight: 500, opacity: 0.85 }}>/month</span>
          </div>
        </div>

        {/* Active badge */}
        {isPro && (
          <div style={{ background: "#f0fdf4", border: "1.5px solid #86efac", borderRadius: 14, padding: "0.85rem 1rem", display: "flex", alignItems: "center", gap: "0.6rem" }}>
            <span style={{ fontSize: "1.2rem" }}>✅</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: "0.9rem", color: "#15803d" }}>You&apos;re a Pro member!</div>
              {expiresAt && (
                <div style={{ fontSize: "0.75rem", color: "#166534", marginTop: "0.1rem" }}>
                  Active until {new Date(expiresAt).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}
                </div>
              )}
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

        {error && (
          <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "0.6rem 0.85rem", fontSize: "0.8rem", color: "#dc2626" }}>
            {error}
          </div>
        )}

        {/* CTA */}
        {!isPro ? (
          <button
            onClick={handleSubscribe}
            disabled={busy}
            className="btn btn-primary btn-full"
            style={{ padding: "0.95rem", fontSize: "1.05rem", fontWeight: 800 }}
          >
            {busy ? "Processing…" : "Get Pro — ₹49/month →"}
          </button>
        ) : (
          <div style={{ textAlign: "center", fontSize: "0.78rem", color: "var(--ink-3)", padding: "0.5rem" }}>
            Renewal is manual. Come back before expiry to continue.
          </div>
        )}

        <div style={{ fontSize: "0.7rem", color: "var(--ink-3)", textAlign: "center" }}>
          Cancel anytime · No auto-renewal · Secured by Razorpay
        </div>
      </div>

      {/* Bottom nav */}
      <nav className="bottom-nav">
        {[
          { icon: "🏠", label: "Home",      href: "/dashboard", active: false },
          { icon: "📦", label: "My Orders", href: "/dashboard/orders", active: false },
          { icon: "⭐", label: "Pro",        href: "/dashboard/pro", active: true },
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

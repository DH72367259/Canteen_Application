"use client";

import Link from "next/link";

export default function HomePage() {
  return (
    <div className="landing-shell">
      {/* Top nav */}
      <header style={{ padding: "1rem 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--border)", background: "var(--surface)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={{ width: 32, height: 32, background: "var(--orange)", borderRadius: "10px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.1rem" }}>🍽️</span>
          <span style={{ fontWeight: 900, fontSize: "1.2rem", color: "var(--ink)" }}>NoQx</span>
        </div>
        <Link href="/login" className="btn btn-primary" style={{ padding: "0.5rem 1.1rem", fontSize: "0.85rem" }}>Sign In</Link>
      </header>

      {/* Hero section */}
      <section style={{ background: "linear-gradient(135deg, var(--orange-light) 0%, #fff 100%)", padding: "4rem 1.5rem 3rem", textAlign: "center" }}>
        <div style={{ display: "inline-block", background: "var(--orange-light)", color: "var(--orange-dark)", fontSize: "0.75rem", fontWeight: 700, padding: "0.25rem 0.75rem", borderRadius: 999, marginBottom: "1rem", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          Smart Institutional Dining
        </div>
        <h1 style={{ fontSize: "clamp(2rem, 5vw, 3.2rem)", fontWeight: 900, lineHeight: 1.1, marginBottom: "1rem", color: "var(--ink)" }}>
          Skip the queue.<br />
          <span style={{ color: "var(--orange)" }}>Pre-order your meal.</span>
        </h1>
        <p style={{ fontSize: "1.05rem", color: "var(--ink-3)", maxWidth: 480, margin: "0 auto 2rem" }}>
          NoQx lets you pre-order canteen meals, pick up from your assigned bin with a secure OTP, and earn rewards with every order.
        </p>
        <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center", flexWrap: "wrap" }}>
          <Link href="/login?role=user" className="btn btn-primary" style={{ fontSize: "1rem", padding: "0.75rem 1.75rem" }}>Order Now →</Link>
          <Link href="/login?role=vendor" className="btn btn-outline" style={{ fontSize: "1rem", padding: "0.75rem 1.75rem" }}>Vendor Login</Link>
        </div>
      </section>

      {/* Features grid */}
      <section style={{ padding: "3rem 1.5rem", maxWidth: 960, margin: "0 auto", width: "100%" }}>
        <h2 style={{ textAlign: "center", fontSize: "1.5rem", fontWeight: 800, marginBottom: "0.5rem" }}>Everything you need</h2>
        <p style={{ textAlign: "center", color: "var(--ink-3)", marginBottom: "2.5rem" }}>Built for college canteens, hostels, and institutional dining</p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "1rem" }}>
          {[
            { icon: "🔢", title: "Bin-based pickup", desc: "Auto-assigned numbered bins with OTP verification for secure, contactless pickup." },
            { icon: "🎁", title: "NoQx Cash Rewards", desc: "Earn ₹1–₹2 per order. Use rewards at checkout. 14-day expiry keeps it fair." },
            { icon: "🕐", title: "Slot-based ordering", desc: "Pick your pickup time slot. No rush, no chaos, no cold food." },
            { icon: "📊", title: "Live vendor dashboard", desc: "Color-coded live orders view. Yellow = preparing, Green = done, Red = delayed." },
            { icon: "💳", title: "UPI & card payments", desc: "Pay via any UPI app, debit/credit card, or wallet. Fully secure checkout." },
            { icon: "📱", title: "Web + iOS + Android", desc: "Full featured web dashboard, and apps for iOS and Android users." },
          ].map(f => (
            <div key={f.title} className="card" style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <span style={{ fontSize: "1.5rem" }}>{f.icon}</span>
              <h3 style={{ fontWeight: 700, fontSize: "0.95rem" }}>{f.title}</h3>
              <p style={{ fontSize: "0.82rem", color: "var(--ink-3)", lineHeight: 1.5 }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Portals */}
      <section style={{ padding: "0 1.5rem 3rem", maxWidth: 960, margin: "0 auto", width: "100%" }}>
        <h2 style={{ fontSize: "1.4rem", fontWeight: 800, marginBottom: "1.25rem" }}>Access your portal</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "0.75rem" }}>
          {[
            { role: "user", label: "Customer / Student", desc: "Order food, track pickup, earn rewards", icon: "🛒" },
            { role: "vendor", label: "Canteen Vendor", desc: "Live orders, menu, bins, earnings", icon: "🏪" },
            { role: "super-admin", label: "Super Admin", desc: "Platform analytics & management", icon: "⚙️" },
          ].map(p => (
            <Link href={`/login?role=${p.role}`} key={p.role} style={{ textDecoration: "none" }}>
              <div className="card" style={{ cursor: "pointer", transition: "box-shadow 0.15s", display: "flex", flexDirection: "column", gap: "0.4rem" }} onMouseEnter={e => (e.currentTarget.style.boxShadow = "0 4px 16px rgba(0,0,0,0.1)")} onMouseLeave={e => (e.currentTarget.style.boxShadow = "")}>
                <span style={{ fontSize: "1.6rem" }}>{p.icon}</span>
                <h3 style={{ fontWeight: 700, fontSize: "0.9rem", color: "var(--ink)" }}>{p.label}</h3>
                <p style={{ fontSize: "0.78rem", color: "var(--ink-3)" }}>{p.desc}</p>
                <span style={{ color: "var(--orange)", fontSize: "0.8rem", fontWeight: 600, marginTop: "0.25rem" }}>Sign in →</span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer style={{ borderTop: "1px solid var(--border)", padding: "1.25rem 1.5rem", textAlign: "center", fontSize: "0.8rem", color: "var(--ink-3)" }}>
        <p>© 2025 Krytil Private Limited · NoQx Platform · <Link href="/login" style={{ color: "var(--orange)", textDecoration: "none" }}>Sign in</Link></p>
      </footer>
    </div>
  );
}

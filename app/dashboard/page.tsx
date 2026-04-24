"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

interface ActiveOrder {
  id: string;
  bin: string;
  otp: string;
  items: string;
  slot: string;
}

const CANTEENS = [
  { id: "c1", name: "Main Canteen",      desc: "Breakfast · Lunch · Dinner", emoji: "🍱", status: "open",   nextSlot: "12:30 PM",   items: 42, rating: 4.6, location: "Main Building" },
  { id: "c2", name: "Snack Corner",      desc: "Snacks · Tea · Coffee",       emoji: "☕", status: "busy",   nextSlot: "11:45 AM",   items: 18, rating: 4.3, location: "North Block"   },
  { id: "c3", name: "Hostel Mess",       desc: "Breakfast · Dinner",          emoji: "🥘", status: "open",   nextSlot: "7:30 AM",    items: 12, rating: 4.1, location: "Hostel"        },
  { id: "c4", name: "Ground Floor Cafe", desc: "All Day Dining",              emoji: "🥗", status: "closed", nextSlot: "Opens 8 AM", items: 28, rating: 4.4, location: "South Block"   },
];

const LOCATIONS = ["All", ...Array.from(new Set(CANTEENS.map(c => c.location)))];

export default function UserHomePage() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [activeNav, setActiveNav] = useState<"home" | "orders" | "rewards" | "profile">("home");
  const [walletBalance, setWalletBalance] = useState(0);
  const [activeOrder, setActiveOrder] = useState<ActiveOrder | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<string | null>(null);
  const [showLocationPicker, setShowLocationPicker] = useState(false);

  useEffect(() => {
    const bal = localStorage.getItem("canteen_wallet_balance");
    if (bal) setWalletBalance(Number(bal));
    const order = localStorage.getItem("canteen_active_order");
    if (order) {
      try { setActiveOrder(JSON.parse(order)); } catch { /* invalid data */ }
    }
    const savedLoc = localStorage.getItem("canteen_student_location");
    if (savedLoc) {
      setSelectedLocation(savedLoc);
    } else {
      // First visit — ask for location
      setShowLocationPicker(true);
    }
  }, []);

  const handleSelectLocation = (loc: string) => {
    setSelectedLocation(loc);
    localStorage.setItem("canteen_student_location", loc);
    setShowLocationPicker(false);
  };

  const handleLogout = async () => { await logout(); router.push("/login"); };

  const visibleCanteens = selectedLocation && selectedLocation !== "All"
    ? CANTEENS.filter(c => c.location === selectedLocation)
    : CANTEENS;

  return (
    <div className="app-shell">
      {/* Location picker modal — shown only on first visit */}
      {showLocationPicker && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
          <div style={{ background: "#fff", borderRadius: "24px 24px 0 0", padding: "1.5rem 1.25rem 2.5rem", width: "100%", maxWidth: 430 }}>
            <div style={{ width: 40, height: 4, background: "#e5e7eb", borderRadius: 99, margin: "0 auto 1.25rem" }} />
            <h3 style={{ fontSize: "1.1rem", fontWeight: 800, marginBottom: "0.35rem" }}>📍 Where are you?</h3>
            <p style={{ fontSize: "0.82rem", color: "var(--ink-3)", marginBottom: "1.1rem" }}>
              We&apos;ll show only the canteens near your location.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
              {LOCATIONS.filter(l => l !== "All").map(loc => (
                <button
                  key={loc}
                  onClick={() => handleSelectLocation(loc)}
                  style={{ background: "var(--orange-light)", border: "1.5px solid var(--orange)", borderRadius: 14, padding: "0.75rem 1rem", fontSize: "0.92rem", fontWeight: 600, color: "var(--orange-dark)", cursor: "pointer", textAlign: "left" }}
                >
                  {loc}
                </button>
              ))}
              <button
                onClick={() => handleSelectLocation("All")}
                style={{ background: "none", border: "1.5px solid var(--border)", borderRadius: 14, padding: "0.75rem 1rem", fontSize: "0.88rem", fontWeight: 600, color: "var(--ink-3)", cursor: "pointer", textAlign: "left", marginTop: "0.2rem" }}
              >
                Show all canteens
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Top bar */}
      <div className="app-topbar">
        <div className="greeting-block">
          <div className="greeting">Good morning 👋</div>
          <div className="name">{user?.displayName || user?.email?.split("@")[0] || "Guest"}</div>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <Link href="/dashboard/rewards" style={{ background: "var(--orange-light)", borderRadius: 999, padding: "0.3rem 0.7rem", fontSize: "0.78rem", fontWeight: 700, color: "var(--orange-dark)", textDecoration: "none" }}>
            {walletBalance > 0 ? `₹${walletBalance} Canteen Cash` : "Top Up"}
          </Link>
          <button onClick={handleLogout} style={{ background: "none", border: "none", fontSize: "1.2rem", cursor: "pointer" }} title="Logout">🚪</button>
        </div>
      </div>

      {/* Hero card */}
      <div className="hero-card">
        <div style={{ maxWidth: "60%", position: "relative", zIndex: 1 }}>
          <h2>Skip the queue.<br />Pre-order now.</h2>
          <p>Choose your meal, pick a slot, collect from your bin.</p>
          <a href="#canteens" className="hero-cta" style={{ display: "inline-block", marginTop: "0.75rem" }}>Browse canteens ↓</a>
        </div>
      </div>

      {/* Active order banner — shown only when an order exists */}
      {activeOrder && (
        <div style={{ margin: "0 1rem 0.25rem", background: "var(--green-light)", borderRadius: 14, padding: "0.75rem 1rem", display: "flex", alignItems: "center", justifyContent: "space-between", border: "1px solid #bbf7d0" }}>
          <div>
            <div style={{ fontSize: "0.72rem", color: "#15803d", fontWeight: 600, textTransform: "uppercase" }}>Active Order</div>
            <div style={{ fontSize: "0.88rem", fontWeight: 700 }}>{activeOrder.slot} · {activeOrder.bin}</div>
            <div style={{ fontSize: "0.75rem", color: "var(--ink-3)" }}>{activeOrder.items}</div>
          </div>
          <Link href="/dashboard/orders" style={{ background: "var(--green)", color: "#fff", borderRadius: 10, padding: "0.45rem 0.75rem", fontSize: "0.78rem", fontWeight: 700, textDecoration: "none" }}>Track →</Link>
        </div>
      )}

      {/* Canteen list */}
      <div id="canteens">
        <div className="section-header">
          <div>
            <h3>
              {selectedLocation && selectedLocation !== "All" ? `Canteens · ${selectedLocation}` : "All Canteens"}
            </h3>
          </div>
          <button
            onClick={() => setShowLocationPicker(true)}
            style={{ background: "var(--orange-light)", border: "none", color: "var(--orange-dark)", fontSize: "0.75rem", fontWeight: 600, cursor: "pointer", borderRadius: 999, padding: "0.25rem 0.65rem", display: "flex", alignItems: "center", gap: "0.3rem" }}
          >
            📍 {selectedLocation && selectedLocation !== "All" ? selectedLocation : "Change area"}
          </button>
        </div>

        <div className="canteen-list">
          {visibleCanteens.length === 0 ? (
            <div style={{ textAlign: "center", padding: "2rem 1rem", color: "var(--ink-3)" }}>
              <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>🍽️</div>
              <div style={{ fontWeight: 600 }}>No canteens in this area</div>
              <button onClick={() => setShowLocationPicker(true)} style={{ marginTop: "0.75rem", background: "var(--orange)", color: "#fff", border: "none", borderRadius: 10, padding: "0.5rem 1.2rem", fontSize: "0.85rem", fontWeight: 600, cursor: "pointer" }}>Change location</button>
            </div>
          ) : visibleCanteens.map(c => (
            <Link key={c.id} href={`/dashboard/menu/${c.id}`} className="canteen-card">
              <div className="canteen-icon">{c.emoji}</div>
              <div className="canteen-info">
                <h4>{c.name}</h4>
                <p>{c.desc}</p>
                <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginTop: "0.35rem" }}>
                  <span style={{ fontSize: "0.72rem", color: "var(--ink-3)" }}>⭐ {c.rating}</span>
                  <span style={{ color: "var(--border)" }}>·</span>
                  <span style={{ fontSize: "0.72rem", color: "var(--ink-3)" }}>{c.items} items</span>
                  <span style={{ color: "var(--border)" }}>·</span>
                  <span style={{ fontSize: "0.72rem", color: "var(--ink-3)" }}>Next: {c.nextSlot}</span>
                </div>
              </div>
              <span className={`canteen-badge badge-${c.status}`}>
                {c.status === "open" ? "Open" : c.status === "busy" ? "Busy" : "Closed"}
              </span>
            </Link>
          ))}
        </div>
      </div>

      {/* Bottom navigation */}
      <nav className="bottom-nav">
        {(["home", "orders", "rewards", "profile"] as const).map(tab => {
          const icons: Record<string, string> = { home: "🏠", orders: "📦", rewards: "💰", profile: "👤" };
          const labels: Record<string, string> = { home: "Home", orders: "My Orders", rewards: "Rewards", profile: "Profile" };
          const links: Record<string, string> = { home: "/dashboard", orders: "/dashboard/orders", rewards: "/dashboard/rewards", profile: "/dashboard/profile" };
          return (
            <Link
              key={tab}
              href={links[tab]}
              className={`bottom-nav-item ${activeNav === tab ? "active" : ""}`}
              onClick={() => setActiveNav(tab)}
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



"use client";

import { useEffect, useState, useRef } from "react";
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

// Campus area coordinates — update lat/lng to real values for your campus
const CANTEENS = [
  { id: "c1", name: "Main Canteen",      desc: "Breakfast · Lunch · Dinner", emoji: "🍱", status: "open",   nextSlot: "12:30 PM",   items: 42, rating: 4.6, location: "Main Building", lat: 12.9716, lng: 77.5946 },
  { id: "c2", name: "Snack Corner",      desc: "Snacks · Tea · Coffee",       emoji: "☕", status: "busy",   nextSlot: "11:45 AM",   items: 18, rating: 4.3, location: "North Block",   lat: 12.9726, lng: 77.5950 },
  { id: "c3", name: "Hostel Mess",       desc: "Breakfast · Dinner",          emoji: "🥘", status: "open",   nextSlot: "7:30 AM",    items: 12, rating: 4.1, location: "Hostel",        lat: 12.9730, lng: 77.5940 },
  { id: "c4", name: "Ground Floor Cafe", desc: "All Day Dining",              emoji: "🥗", status: "closed", nextSlot: "Opens 8 AM", items: 28, rating: 4.4, location: "South Block",   lat: 12.9706, lng: 77.5948 },
];

const LOCATIONS = Array.from(new Set(CANTEENS.map(c => c.location)));
const MAX_RADIUS_KM = 10;

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDist(km: number) {
  if (km < 0.1) return "< 100 m away";
  if (km < 1)   return `${Math.round(km * 1000)} m away`;
  return `${km.toFixed(1)} km away`;
}

export default function UserHomePage() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [activeNav, setActiveNav] = useState<"home" | "orders" | "rewards" | "profile">("home");
  const [walletBalance, setWalletBalance] = useState(0);
  const [activeOrder, setActiveOrder] = useState<ActiveOrder | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<string | null>(null);
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [locationSearch, setLocationSearch] = useState("");
  const [gpsStatus, setGpsStatus] = useState<"idle" | "loading" | "error">("idle");
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [showAll, setShowAll] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const bal = localStorage.getItem("canteen_wallet_balance");
    if (bal) setWalletBalance(Number(bal));
    const order = localStorage.getItem("canteen_active_order");
    if (order) {
      try { setActiveOrder(JSON.parse(order)); } catch { /* invalid data */ }
    }
    const savedLoc = localStorage.getItem("canteen_student_location");
    const savedCoords = localStorage.getItem("canteen_student_coords");
    if (savedCoords) {
      try { setUserCoords(JSON.parse(savedCoords)); } catch { /* ignore */ }
    }
    if (savedLoc) {
      setSelectedLocation(savedLoc);
    } else {
      setShowLocationPicker(true);
    }
  }, []);

  // Auto-focus search input when picker opens
  useEffect(() => {
    if (showLocationPicker) {
      setLocationSearch("");
      setGpsStatus("idle");
      setTimeout(() => searchRef.current?.focus(), 150);
    }
  }, [showLocationPicker]);

  const handleSelectLocation = (loc: string) => {
    setSelectedLocation(loc);
    setShowAll(false);
    localStorage.setItem("canteen_student_location", loc);
    setShowLocationPicker(false);
  };

  const handleShowAll = () => {
    setShowAll(true);
    setShowLocationPicker(false);
  };

  const handleUseGPS = () => {
    if (!navigator.geolocation) { setGpsStatus("error"); return; }
    setGpsStatus("loading");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        const coords = { lat: latitude, lng: longitude };
        setUserCoords(coords);
        localStorage.setItem("canteen_student_coords", JSON.stringify(coords));
        // Find nearest area
        let nearestArea = LOCATIONS[0];
        let minDist = Infinity;
        CANTEENS.forEach(c => {
          const d = haversineKm(latitude, longitude, c.lat, c.lng);
          if (d < minDist) { minDist = d; nearestArea = c.location; }
        });
        setGpsStatus("idle");
        handleSelectLocation(nearestArea);
      },
      () => setGpsStatus("error"),
      { timeout: 8000, maximumAge: 60000 }
    );
  };

  const handleLogout = async () => { await logout(); router.push("/login"); };

  const filteredLocations = locationSearch.trim()
    ? LOCATIONS.filter(l => l.toLowerCase().includes(locationSearch.toLowerCase()))
    : LOCATIONS;

  // Build canteen list with distance attached
  const canteensWithDist = CANTEENS.map(c => ({
    ...c,
    distKm: userCoords ? haversineKm(userCoords.lat, userCoords.lng, c.lat, c.lng) : null,
  }));

  // "See all" with GPS → show all within 10km; without GPS → show all
  // Filtered by area → show that area's canteens (always within campus = within 10km)
  const visibleCanteens = showAll
    ? (userCoords
        ? canteensWithDist.filter(c => (c.distKm ?? 0) <= MAX_RADIUS_KM).sort((a, b) => (a.distKm ?? 0) - (b.distKm ?? 0))
        : canteensWithDist)
    : (selectedLocation && selectedLocation !== "All"
        ? canteensWithDist.filter(c => c.location === selectedLocation)
        : canteensWithDist);

  const isFiltered = !showAll && selectedLocation && selectedLocation !== "All";

  return (
    <div className="app-shell">
      {/* Location picker bottom-sheet */}
      {showLocationPicker && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center" }}
          onClick={(e) => { if (e.target === e.currentTarget && selectedLocation) setShowLocationPicker(false); }}
        >
          <div style={{ background: "#fff", borderRadius: "24px 24px 0 0", padding: "1.25rem 1.25rem 2.5rem", width: "100%", maxWidth: 430 }}>
            <div style={{ width: 40, height: 4, background: "#e5e7eb", borderRadius: 99, margin: "0 auto 1.1rem" }} />
            <h3 style={{ fontSize: "1.1rem", fontWeight: 800, marginBottom: "0.25rem" }}>📍 Where are you?</h3>
            <p style={{ fontSize: "0.82rem", color: "var(--ink-3)", marginBottom: "1rem" }}>
              We&apos;ll show only the canteens near your area.
            </p>

            {/* GPS button */}
            <button
              onClick={handleUseGPS}
              disabled={gpsStatus === "loading"}
              style={{
                width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem",
                background: gpsStatus === "error" ? "var(--red-light)" : "var(--blue-light)",
                border: `1.5px solid ${gpsStatus === "error" ? "var(--red)" : "var(--blue)"}`,
                borderRadius: 14, padding: "0.7rem 1rem", fontSize: "0.88rem", fontWeight: 700,
                color: gpsStatus === "error" ? "var(--red)" : "var(--blue)", cursor: gpsStatus === "loading" ? "not-allowed" : "pointer",
                marginBottom: "0.9rem", opacity: gpsStatus === "loading" ? 0.7 : 1,
              }}
            >
              {gpsStatus === "loading" ? "⏳ Detecting your location…" : gpsStatus === "error" ? "⚠️ GPS unavailable — pick manually" : "🎯 Use my current location"}
            </button>

            {/* Divider */}
            <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.9rem" }}>
              <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
              <span style={{ fontSize: "0.75rem", color: "var(--ink-3)", fontWeight: 600 }}>or type your location</span>
              <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
            </div>

            {/* Search input */}
            <input
              ref={searchRef}
              type="text"
              placeholder="e.g. Hostel, North Block…"
              value={locationSearch}
              onChange={e => setLocationSearch(e.target.value)}
              style={{
                width: "100%", border: "1.5px solid var(--border)", borderRadius: 12, padding: "0.65rem 0.9rem",
                fontSize: "0.9rem", outline: "none", marginBottom: "0.75rem", boxSizing: "border-box",
              }}
              onFocus={e => (e.target.style.borderColor = "var(--orange)")}
              onBlur={e => (e.target.style.borderColor = "var(--border)")}
            />

            {/* Location options */}
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxHeight: 220, overflowY: "auto" }}>
              {filteredLocations.length === 0 ? (
                <p style={{ fontSize: "0.82rem", color: "var(--ink-3)", textAlign: "center", padding: "0.5rem 0" }}>No matching area found</p>
              ) : filteredLocations.map(loc => (
                <button
                  key={loc}
                  onClick={() => handleSelectLocation(loc)}
                  style={{
                    background: selectedLocation === loc ? "var(--orange-light)" : "#f9fafb",
                    border: `1.5px solid ${selectedLocation === loc ? "var(--orange)" : "var(--border)"}`,
                    borderRadius: 12, padding: "0.65rem 1rem", fontSize: "0.9rem", fontWeight: 600,
                    color: selectedLocation === loc ? "var(--orange-dark)" : "var(--ink)", cursor: "pointer", textAlign: "left",
                  }}
                >
                  📍 {loc}
                </button>
              ))}
            </div>

            <button
              onClick={handleShowAll}
              style={{
                width: "100%", background: "none", border: "1.5px solid var(--border)", borderRadius: 12,
                padding: "0.65rem 1rem", fontSize: "0.85rem", fontWeight: 600, color: "var(--ink-3)",
                cursor: "pointer", textAlign: "center", marginTop: "0.75rem",
              }}
            >
              Show all canteens
            </button>
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

      {/* Active order banner */}
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
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
            <h3>{showAll ? (userCoords ? `Within ${MAX_RADIUS_KM} km` : "All Canteens") : (isFiltered ? "Canteens nearby" : "All Canteens")}</h3>
            {isFiltered && (
              <span style={{ fontSize: "0.72rem", background: "var(--orange-light)", color: "var(--orange-dark)", borderRadius: 999, padding: "0.15rem 0.55rem", fontWeight: 600 }}>
                📍 {selectedLocation}
              </span>
            )}
          </div>
          <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
            {isFiltered && (
              <button
                onClick={handleShowAll}
                style={{ background: "none", border: "none", color: "var(--orange)", fontSize: "0.8rem", fontWeight: 600, cursor: "pointer", padding: "0.2rem 0.4rem" }}
              >
                See all
              </button>
            )}
            <button
              onClick={() => setShowLocationPicker(true)}
              style={{ background: "var(--orange-light)", border: "none", color: "var(--orange-dark)", fontSize: "0.75rem", fontWeight: 600, cursor: "pointer", borderRadius: 999, padding: "0.25rem 0.65rem" }}
            >
              📍 {userCoords ? "Change" : "Set location"}
            </button>
          </div>
        </div>

        <div className="canteen-list">
          {visibleCanteens.length === 0 ? (
            <div style={{ textAlign: "center", padding: "2rem 1rem", color: "var(--ink-3)" }}>
              <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>🍽️</div>
              <div style={{ fontWeight: 600 }}>
                {userCoords ? `No canteens within ${MAX_RADIUS_KM} km` : "No canteens in this area"}
              </div>
              <button onClick={() => setShowLocationPicker(true)} style={{ marginTop: "0.75rem", background: "var(--orange)", color: "#fff", border: "none", borderRadius: 10, padding: "0.5rem 1.2rem", fontSize: "0.85rem", fontWeight: 600, cursor: "pointer" }}>
                Change location
              </button>
            </div>
          ) : visibleCanteens.map(c => (
            <Link key={c.id} href={`/dashboard/menu/${c.id}`} className="canteen-card">
              <div className="canteen-icon">{c.emoji}</div>
              <div className="canteen-info">
                <h4>{c.name}</h4>
                <p>{c.desc}</p>
                <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginTop: "0.35rem", flexWrap: "wrap" }}>
                  <span style={{ fontSize: "0.72rem", color: "var(--ink-3)" }}>⭐ {c.rating}</span>
                  <span style={{ color: "var(--border)" }}>·</span>
                  <span style={{ fontSize: "0.72rem", color: "var(--ink-3)" }}>{c.items} items</span>
                  <span style={{ color: "var(--border)" }}>·</span>
                  <span style={{ fontSize: "0.72rem", color: "var(--ink-3)" }}>Next: {c.nextSlot}</span>
                  {c.distKm !== null && (
                    <>
                      <span style={{ color: "var(--border)" }}>·</span>
                      <span style={{ fontSize: "0.72rem", color: "var(--blue)", fontWeight: 600 }}>📍 {formatDist(c.distKm)}</span>
                    </>
                  )}
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

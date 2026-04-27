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

interface ApiCanteen {
  id: string;
  name: string;
  college: string | null;
  city: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  status: string | null;
  is_active: boolean;
  distance_km: number | null;
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
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const [activeNav, setActiveNav] = useState<"home" | "orders" | "rewards" | "profile">("home");
  const [walletBalance, setWalletBalance] = useState(0);
  const [activeOrder, setActiveOrder] = useState<ActiveOrder | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<string | null>(null);
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [locationSearch, setLocationSearch] = useState("");
  const [gpsStatus, setGpsStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [showAll, setShowAll] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // ── Live data from Phase 4 APIs ───────────────────────────────────
  const [apiCanteens, setApiCanteens] = useState<ApiCanteen[] | null>(null);
  const [colleges, setColleges] = useState<string[]>([]);

  // Auth guard — redirect unauthenticated users to login;
  // redirect privileged users (admin/vendor/worker) to their correct dashboards so they
  // are never stranded on the student page after a TOKEN_REFRESHED role-restore.
  useEffect(() => {
    if (loading) return;
    if (!user) { router.replace("/login?role=user"); return; }
    if (user.role === "super_admin" || user.role === "co_admin") { router.replace("/admin/dashboard"); return; }
    if (user.role === "vendor" || user.role === "canteen_admin") { router.replace("/vendor/dashboard"); return; }
    if (user.role === "worker") { router.replace("/worker/dashboard"); return; }
  }, [user, loading, router]);

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

  // Auto-focus search + reset GPS error state when picker opens
  useEffect(() => {
    if (showLocationPicker) {
      setLocationSearch("");
      setGpsStatus("idle");
      setTimeout(() => searchRef.current?.focus(), 150);
    }
  }, [showLocationPicker]);

  // ── Fetch colleges once ─────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    fetch("/api/canteens/colleges")
      .then(r => r.ok ? r.json() : { colleges: [] })
      .then((j: { colleges?: string[] }) => { if (!cancelled) setColleges(j.colleges ?? []); })
      .catch(() => { /* fallback to local LOCATIONS */ });
    return () => { cancelled = true; };
  }, []);

  // ── Fetch canteens whenever coords/college change ───────────────────────
  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (userCoords) {
      params.set("lat", String(userCoords.lat));
      params.set("lng", String(userCoords.lng));
      params.set("radius_km", String(MAX_RADIUS_KM));
    }
    if (selectedLocation && !showAll && colleges.includes(selectedLocation)) {
      params.set("college", selectedLocation);
    }
    fetch(`/api/canteens?${params.toString()}`)
      .then(r => r.ok ? r.json() : { canteens: [] })
      .then((j: { canteens?: ApiCanteen[] }) => { if (!cancelled) setApiCanteens(j.canteens ?? []); })
      .catch(() => { if (!cancelled) setApiCanteens([]); });
    return () => { cancelled = true; };
  }, [userCoords, selectedLocation, showAll, colleges]);

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
        setGpsStatus("success");
        handleSelectLocation(nearestArea);
      },
      () => setGpsStatus("error"),
      { timeout: 8000, maximumAge: 60000 }
    );
  };

  const handleLogout = async () => { try { await logout(); } catch { /* ignore */ } router.replace("/login"); };

  // Text search: only filter when there's a match; otherwise show all (fallback)
  // Use live colleges from API when available, else fall back to seed LOCATIONS.
  const baseLocations = colleges.length > 0 ? colleges : LOCATIONS;
  const searchTrimmed = locationSearch.trim();
  const matched = searchTrimmed
    ? baseLocations.filter(l => l.toLowerCase().includes(searchTrimmed.toLowerCase()))
    : baseLocations;
  const filteredLocations = matched.length > 0 ? matched : baseLocations;
  const noMatchFallback = searchTrimmed !== "" && matched.length === 0;

  // Build canteen list with distance attached.
  // Prefer live API data (already filtered + sorted server-side); fall back to seed.
  const baseCanteens = apiCanteens && apiCanteens.length > 0
    ? apiCanteens.map(c => ({
        id: c.id,
        name: c.name,
        desc: c.address ?? c.city ?? "",
        emoji: "\uD83C\uDF7D\uFE0F",
        status: (c.status as "open" | "busy" | "closed" | null) ?? "open",
        nextSlot: "",
        items: 0,
        rating: 4.5,
        location: c.college ?? c.city ?? "",
        lat: c.lat ?? 0,
        lng: c.lng ?? 0,
      }))
    : CANTEENS;
  const canteensWithDist = baseCanteens.map(c => ({
    ...c,
    distKm: userCoords && c.lat && c.lng ? haversineKm(userCoords.lat, userCoords.lng, c.lat, c.lng) : null,
  }));

  // Always enforce 10km radius when GPS is available.
  const inRadius = userCoords
    ? canteensWithDist.filter(c => (c.distKm ?? 0) <= MAX_RADIUS_KM)
    : canteensWithDist;

  const visibleCanteens = (() => {
    const pool = inRadius;
    if (showAll || !selectedLocation || selectedLocation === "All") {
      return userCoords
        ? [...pool].sort((a, b) => (a.distKm ?? 0) - (b.distKm ?? 0))
        : pool;
    }
    const areaFiltered = pool.filter(c => c.location === selectedLocation);
    return userCoords
      ? [...areaFiltered].sort((a, b) => (a.distKm ?? 0) - (b.distKm ?? 0))
      : areaFiltered;
  })();

  const isFiltered = !showAll && selectedLocation && selectedLocation !== "All";

  // Don't render anything while auth is loading or user is being redirected
  if (loading || !user) {
    return <div className="loading-screen"><div className="spinner" /></div>;
  }

  const locationLabel = selectedLocation
    ? (showAll ? "All campuses" : selectedLocation)
    : "Set location";

  return (
    <div className="app-shell">
      {/* ── Location picker bottom-sheet ── */}
      {showLocationPicker && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center" }}
          onClick={(e) => { if (e.target === e.currentTarget && selectedLocation) setShowLocationPicker(false); }}
        >
          <div style={{ background: "#fff", borderRadius: "20px 20px 0 0", padding: "1rem 1.25rem 2.5rem", width: "100%", maxWidth: 480, maxHeight: "90vh", overflowY: "auto" }}>
            {/* Drag handle */}
            <div style={{ width: 40, height: 4, background: "#e5e7eb", borderRadius: 99, margin: "0 auto 1rem" }} />

            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
              <div>
                <h3 style={{ fontSize: "1.1rem", fontWeight: 800, marginBottom: "0.15rem" }}>📍 Where are you?</h3>
                <p style={{ fontSize: "0.8rem", color: "var(--ink-3)" }}>We&apos;ll show canteens near your campus area.</p>
              </div>
              {selectedLocation && (
                <button
                  onClick={() => setShowLocationPicker(false)}
                  style={{ background: "none", border: "none", fontSize: "1.4rem", cursor: "pointer", color: "var(--ink-3)", lineHeight: 1 }}
                  aria-label="Close"
                >✕</button>
              )}
            </div>

            {/* GPS button — always shows normal text; error shown separately */}
            <button
              onClick={handleUseGPS}
              disabled={gpsStatus === "loading"}
              style={{
                width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem",
                background: "var(--blue-light)",
                border: "1.5px solid var(--blue)",
                borderRadius: 14, padding: "0.75rem 1rem", fontSize: "0.9rem", fontWeight: 700,
                color: "var(--blue)", cursor: gpsStatus === "loading" ? "not-allowed" : "pointer",
                opacity: gpsStatus === "loading" ? 0.7 : 1,
              }}
            >
              {gpsStatus === "loading" ? "⏳ Detecting your location…" : "🎯 Use my current location"}
            </button>

            {/* GPS error — shown as inline message, NOT on the button */}
            {gpsStatus === "error" && (
              <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginTop: "0.5rem", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "0.5rem 0.75rem" }}>
                <span style={{ fontSize: "0.95rem" }}>⚠️</span>
                <span style={{ fontSize: "0.78rem", color: "#dc2626" }}>Location access was denied. Enable location in your browser settings, or pick an area below.</span>
              </div>
            )}

            {/* Divider */}
            <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", margin: "1rem 0 0.75rem" }}>
              <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
              <span style={{ fontSize: "0.72rem", color: "var(--ink-3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>or pick your campus area</span>
              <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
            </div>

            {/* Search input */}
            <div style={{ position: "relative", marginBottom: "0.75rem" }}>
              <span style={{ position: "absolute", left: "0.75rem", top: "50%", transform: "translateY(-50%)", fontSize: "0.9rem", color: "var(--ink-3)" }}>🔍</span>
              <input
                ref={searchRef}
                type="text"
                placeholder="Search campus zone (e.g. Hostel, North Block)…"
                value={locationSearch}
                onChange={e => setLocationSearch(e.target.value)}
                style={{
                  width: "100%", border: "1.5px solid var(--border)", borderRadius: 12,
                  padding: "0.65rem 0.9rem 0.65rem 2.2rem",
                  fontSize: "0.88rem", outline: "none", boxSizing: "border-box",
                  background: "#f9fafb",
                }}
                onFocus={e => (e.target.style.borderColor = "var(--orange)")}
                onBlur={e => (e.target.style.borderColor = "var(--border)")}
              />
            </div>

            {/* No-match fallback notice */}
            {noMatchFallback && (
              <p style={{ fontSize: "0.78rem", color: "var(--ink-3)", marginBottom: "0.5rem", paddingLeft: "0.25rem" }}>
                No area matches &ldquo;{searchTrimmed}&rdquo; — showing all campus zones:
              </p>
            )}

            {/* Location options */}
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {filteredLocations.map(loc => (
                <button
                  key={loc}
                  onClick={() => handleSelectLocation(loc)}
                  style={{
                    background: selectedLocation === loc ? "var(--orange-light)" : "#f9fafb",
                    border: `1.5px solid ${selectedLocation === loc ? "var(--orange)" : "var(--border)"}`,
                    borderRadius: 12, padding: "0.7rem 1rem", fontSize: "0.9rem", fontWeight: 600,
                    color: selectedLocation === loc ? "var(--orange-dark)" : "var(--ink)",
                    cursor: "pointer", textAlign: "left", display: "flex", alignItems: "center", gap: "0.5rem",
                  }}
                >
                  <span style={{ fontSize: "1.1rem" }}>📍</span>
                  <span>{loc}</span>
                  {selectedLocation === loc && <span style={{ marginLeft: "auto", color: "var(--orange)" }}>✓</span>}
                </button>
              ))}
            </div>

            <button
              onClick={handleShowAll}
              style={{
                width: "100%", background: "none", border: "1.5px solid var(--border)", borderRadius: 12,
                padding: "0.7rem 1rem", fontSize: "0.85rem", fontWeight: 600, color: "var(--ink-3)",
                cursor: "pointer", textAlign: "center", marginTop: "0.75rem",
              }}
            >
              Show all canteens →
            </button>
          </div>
        </div>
      )}

      {/* ── Zomato-style location header (sticky, always visible at top) ── */}
      <div
        style={{
          position: "sticky", top: 0, zIndex: 40,
          background: "#fff",
          borderBottom: "1px solid var(--border)",
          padding: "0.6rem 1rem",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}
      >
        <button
          onClick={() => setShowLocationPicker(true)}
          style={{
            display: "flex", alignItems: "center", gap: "0.5rem", minWidth: 0,
            background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left",
          }}
        >
          <span style={{ color: "var(--orange)", fontSize: "1.1rem", flexShrink: 0 }}>📍</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: "0.68rem", color: "var(--ink-3)", fontWeight: 500, lineHeight: 1.2 }}>Delivering to</div>
            <div style={{ fontSize: "0.95rem", fontWeight: 800, color: "var(--ink)", display: "flex", alignItems: "center", gap: "0.25rem", lineHeight: 1.3 }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 180 }}>
                {locationLabel}
              </span>
              <span style={{ color: "var(--ink-3)", fontSize: "0.8rem", flexShrink: 0 }}>▾</span>
            </div>
          </div>
        </button>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <Link
            href="/dashboard/rewards"
            onClick={e => e.stopPropagation()}
            style={{ background: "var(--orange-light)", borderRadius: 999, padding: "0.3rem 0.7rem", fontSize: "0.78rem", fontWeight: 700, color: "var(--orange-dark)", textDecoration: "none" }}
          >
            {walletBalance > 0 ? `₹${walletBalance}` : "Top Up"}
          </Link>
          <button
            onClick={e => { e.stopPropagation(); handleLogout(); }}
            style={{ background: "none", border: "none", fontSize: "1.15rem", cursor: "pointer", padding: "0.2rem" }}
            title="Logout"
          >🚪</button>
          <Link href="/dashboard/support" onClick={e => e.stopPropagation()} title="Help & Support"
            style={{ fontSize: "1.15rem", textDecoration: "none", padding: "0.2rem" }}>🎧</Link>
        </div>
      </div>

      {/* ── Greeting row ── */}
      <div style={{ padding: "0.75rem 1rem 0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: "0.78rem", color: "var(--ink-3)" }}>Good morning 👋</div>
          <div style={{ fontSize: "1.05rem", fontWeight: 700, color: "var(--ink)" }}>
            {user?.displayName || user?.email?.split("@")[0] || "Guest"}
          </div>
        </div>
      </div>

      {/* ── Hero card ── */}
      <div className="hero-card">
        <div style={{ maxWidth: "60%", position: "relative", zIndex: 1 }}>
          <h2>Skip the queue.<br />Pre-order now.</h2>
          <p>Choose your meal, pick a slot, collect from your bin.</p>
          <button
            className="hero-cta"
            style={{ display: "inline-block", marginTop: "0.75rem", border: "none", cursor: "pointer" }}
            onClick={() => document.getElementById("canteens")?.scrollIntoView({ behavior: "smooth", block: "start" })}
          >
            Browse canteens ↓
          </button>
        </div>
      </div>

      {/* ── Active order floating button ── */}
      {activeOrder && (
        <Link
          href="/dashboard/order-status"
          style={{
            position: "fixed", bottom: 70, left: "50%", transform: "translateX(-50%)",
            zIndex: 50, maxWidth: 360, width: "calc(100% - 2rem)",
            background: "linear-gradient(135deg, #16a34a, #15803d)",
            color: "#fff", borderRadius: 16, padding: "0.7rem 1rem",
            display: "flex", alignItems: "center", justifyContent: "space-between",
            boxShadow: "0 4px 20px rgba(22,163,74,0.4)",
            textDecoration: "none",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
            <span style={{ fontSize: "1.2rem" }}>🍽️</span>
            <div>
              <div style={{ fontSize: "0.72rem", fontWeight: 600, opacity: 0.85, textTransform: "uppercase", letterSpacing: "0.03em" }}>Order in progress</div>
              <div style={{ fontSize: "0.88rem", fontWeight: 800 }}>{activeOrder.slot} · {activeOrder.bin}</div>
            </div>
          </div>
          <span style={{ fontSize: "0.82rem", fontWeight: 700, opacity: 0.9 }}>Track →</span>
        </Link>
      )}

      {/* ── Canteen list ── */}
      <div id="canteens">
        <div className="section-header">
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
            <h3>
              {userCoords
                ? (isFiltered ? `Canteens · ${selectedLocation}` : `Within ${MAX_RADIUS_KM} km`)
                : (isFiltered ? `Canteens · ${selectedLocation}` : "All Canteens")}
            </h3>
            {userCoords && (
              <span style={{ fontSize: "0.7rem", background: "var(--blue-light)", color: "var(--blue)", borderRadius: 999, padding: "0.15rem 0.5rem", fontWeight: 600 }}>
                📡 10 km
              </span>
            )}
          </div>
          {isFiltered && (
            <button
              onClick={handleShowAll}
              style={{ background: "none", border: "none", color: "var(--orange)", fontSize: "0.8rem", fontWeight: 600, cursor: "pointer", padding: "0.2rem 0.4rem" }}
            >
              See all
            </button>
          )}
        </div>

        <div className="canteen-list">
          {visibleCanteens.length === 0 ? (
            <div style={{ textAlign: "center", padding: "2rem 1rem", color: "var(--ink-3)" }}>
              <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>🍽️</div>
              <div style={{ fontWeight: 600 }}>
                {userCoords
                  ? `No canteens found within ${MAX_RADIUS_KM} km`
                  : "No canteens in this area"}
              </div>
              <p style={{ fontSize: "0.8rem", marginTop: "0.4rem" }}>Try a different location.</p>
              <button
                onClick={() => setShowLocationPicker(true)}
                style={{ marginTop: "0.75rem", background: "var(--orange)", color: "#fff", border: "none", borderRadius: 10, padding: "0.5rem 1.2rem", fontSize: "0.85rem", fontWeight: 600, cursor: "pointer" }}
              >
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

      {/* ── NoQx Pro soft-awareness banner ── */}
      <div style={{ margin: "0.5rem 1rem 1rem", background: "linear-gradient(135deg, #fff7ed 0%, #fef3c7 100%)", border: "1.5px solid #fed7aa", borderRadius: 16, padding: "0.85rem 1rem", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "0.78rem", fontWeight: 800, color: "#92400e", marginBottom: "0.1rem" }}>⚡ Skip queues every day</div>
          <div style={{ fontSize: "0.72rem", color: "#b45309", marginBottom: "0.15rem" }}>With 0/- convenience fee</div>
          <div style={{ fontSize: "0.75rem", fontWeight: 800, color: "#92400e" }}>Try Priority Pickup, Every Time →</div>
        </div>
        <a href="/dashboard/pro" style={{ background: "var(--orange)", color: "#fff", borderRadius: 10, padding: "0.45rem 0.8rem", fontSize: "0.75rem", fontWeight: 800, textDecoration: "none", whiteSpace: "nowrap", flexShrink: 0 }}>
          ₹49/mo →
        </a>
      </div>

      {/* ── Bottom navigation ── */}
      <nav className="bottom-nav">
        {(["home", "orders", "rewards", "profile"] as const).map(tab => {
          const icons: Record<string, string> = { home: "🏠", orders: "📦", rewards: "🎁", profile: "👤" };
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

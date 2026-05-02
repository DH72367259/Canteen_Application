"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { latestActiveOrder, readActiveOrders, writeActiveOrders } from "@/lib/activeOrdersClient";

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
  item_count?: number;
}

// Canteens are loaded live from /api/canteens (Phase 4) — no seed data.
const CANTEENS: { id: string; name: string; desc: string; emoji: string; status: string; nextSlot: string; items: number; rating: number; location: string; lat: number; lng: number }[] = [];

const LOCATIONS: string[] = [];
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
  const { user, session, loading } = useAuth();
  const router = useRouter();
  const [activeNav, setActiveNav] = useState<"home" | "orders" | "profile">("home");
  const [activeOrder, setActiveOrder] = useState<ActiveOrder | null>(null);
  const [selectedLocation, setSelectedLocation] = useState<string | null>(null);
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [locationSearch, setLocationSearch] = useState("");
  const [gpsStatus, setGpsStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [showAll, setShowAll] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // ── Live data from Phase 4 APIs ───────────────────────────────────
  const [apiCanteens, setApiCanteens] = useState<ApiCanteen[] | null>(() => {
    // SWR-style: hydrate from sessionStorage on first render so the canteen
    // grid paints instantly instead of waiting for the network round-trip.
    if (typeof window === "undefined") return null;
    try {
      const raw = sessionStorage.getItem("canteen_list_v1");
      if (!raw) return null;
      const { data, ts } = JSON.parse(raw);
      // 5-min freshness — older than that we still show but background-refresh.
      if (Date.now() - ts < 5 * 60 * 1000) return data as ApiCanteen[];
      return data as ApiCanteen[];
    } catch { return null; }
  });
  const [colleges, setColleges] = useState<string[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showNotifs, setShowNotifs] = useState(false);
  const [notifs, setNotifs] = useState<Array<{ id: string; title: string; body: string; created_at: string; is_read: boolean }>>([]);
  // Inline canteen-name search (PDF requirement: search bar after greeting)
  const [searchQuery, setSearchQuery] = useState("");

  // Live wall-clock in toolbar (PDF requirement: digital time on tool bar)
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const greeting = now.getHours() < 12 ? "Good morning" : now.getHours() < 17 ? "Good afternoon" : "Good evening";

  // Auth guard — redirect unauthenticated users to login;
  // redirect privileged users (admin/vendor/worker) to their correct dashboards so they
  // are never stranded on the student page after a TOKEN_REFRESHED role-restore.
  // We also check localStorage for a stored Supabase session before redirecting:
  // on slow mobile networks getSession() can take a few seconds, and we don't want to
  // bounce a returning student to /login while their session is still being restored.
  useEffect(() => {
    if (loading) return;
    if (!user) {
      // If a Supabase session token is sitting in localStorage but hasn't hydrated yet,
      // give the auth provider a moment to finish restoring it instead of redirecting.
      let hasStoredSession = false;
      try {
        // Storage key matches lib/supabase-client.ts (storageKey: 'canteen_auth_v2').
        const raw = localStorage.getItem("canteen_auth_v2");
        hasStoredSession = !!raw && raw.length > 20;
      } catch { /* SSR safe */ }
      if (hasStoredSession) return;
      router.replace("/login?role=user");
      return;
    }
    if (user.role === "super_admin" || user.role === "co_admin") { router.replace("/admin/dashboard"); return; }
    if (user.role === "vendor" || user.role === "canteen_admin") { router.replace("/vendor/dashboard"); return; }
    if (user.role === "worker") { router.replace("/worker/orders"); return; }
  }, [user, loading, router]);

  useEffect(() => {
    // Read the active-order banner from localStorage. Run on every uid change
    // and whenever the tab regains focus / the storage key changes (so a fresh
    // order placed in /dashboard/cart is immediately visible when the user
    // navigates back to /dashboard, even if Next router reuses the page from
    // bfcache and the component itself doesn't re-mount).
    const readActive = () => {
      try {
        // Cleanup + select latest active order for this user.
        const all = readActiveOrders(user?.uid ?? null);
        writeActiveOrders(all);
        const latest = latestActiveOrder(user?.uid ?? null);
        setActiveOrder((latest as typeof activeOrder) ?? null);
      } catch { setActiveOrder(null); }
    };
    readActive();
    const onStorage = (e: StorageEvent) => { if (e.key === "canteen_active_order" || e.key === null) readActive(); };
    const onFocus = () => readActive();
    const onPageShow = () => readActive();
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onPageShow);

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
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [user?.uid]);

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

  // ── Notifications: fetch unread count every 30s ─────────────────────────
  useEffect(() => {
    if (!session?.access_token) return;
    let cancelled = false;
    const fetchNotifs = async () => {
      try {
        const res = await fetch("/api/notifications", { headers: { Authorization: `Bearer ${session.access_token}` } });
        if (!res.ok) return;
        const j = await res.json();
        if (cancelled) return;
        setNotifs(j.notifications ?? []);
        setUnreadCount(j.unread_count ?? 0);
      } catch { /* ignore */ }
    };
    fetchNotifs();
    const iv = setInterval(fetchNotifs, 30_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [session?.access_token]);

  const handleOpenNotifs = async () => {
    setShowNotifs(true);
    const unreadIds = notifs.filter(n => !n.is_read).map(n => n.id);
    if (unreadIds.length === 0 || !session?.access_token) return;
    try {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ ids: unreadIds }),
      });
      setUnreadCount(0);
      setNotifs(prev => prev.map(n => ({ ...n, is_read: true })));
    } catch { /* ignore */ }
  };

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
      .then((j: { canteens?: ApiCanteen[] }) => {
        if (cancelled) return;
        const list = j.canteens ?? [];
        setApiCanteens(list);
        try { sessionStorage.setItem("canteen_list_v1", JSON.stringify({ data: list, ts: Date.now() })); } catch { /* ignore */ }
      })
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
        status: (c.is_active ? ((c.status as "open" | "busy" | "closed" | null) ?? "open") : "closed") as "open" | "busy" | "closed",
        isOnline: c.is_active,
        nextSlot: "",
        items: c.item_count ?? 0,
        rating: 4.5,
        location: c.college ?? c.city ?? "",
        lat: c.lat ?? 0,
        lng: c.lng ?? 0,
      }))
    : CANTEENS.map(c => ({ ...c, isOnline: c.status !== "closed" }));
  const canteensWithDist = baseCanteens.map(c => ({
    ...c,
    distKm: userCoords && c.lat && c.lng ? haversineKm(userCoords.lat, userCoords.lng, c.lat, c.lng) : null,
  }));

  // Always enforce 10km radius when GPS is available.
  const inRadius = userCoords
    ? canteensWithDist.filter(c => (c.distKm ?? 0) <= MAX_RADIUS_KM)
    : canteensWithDist;

  const visibleCanteens = (() => {
    let pool = inRadius;
    // Apply free-text search across canteen name, description, and location.
    // Matched as substring (case-insensitive) so users can find "Christ" via
    // "kengeri", a canteen via its address fragment, etc.
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      pool = pool.filter(c =>
        c.name.toLowerCase().includes(q) ||
        c.desc.toLowerCase().includes(q) ||
        c.location.toLowerCase().includes(q)
      );
    }
    if (showAll || !selectedLocation || selectedLocation === "All") {
      return userCoords
        ? [...pool].sort((a, b) => (a.distKm ?? 0) - (b.distKm ?? 0))
        : pool;
    }
    const areaFiltered = pool.filter(c => c.location === selectedLocation);
    // Graceful fallback: if the picked campus label doesn't exactly match any canteen's
    // college/city string (e.g. user picked a nearby zone but canteens are tagged with
    // the parent campus name), fall back to the full pool rather than rendering an empty
    // list. This prevents users from seeing "no canteens" when canteens do exist nearby.
    const effective = areaFiltered.length > 0 ? areaFiltered : pool;
    return userCoords
      ? [...effective].sort((a, b) => (a.distKm ?? 0) - (b.distKm ?? 0))
      : effective;
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
    // Force column layout: the global .app-shell becomes flex-direction:row
    // on desktop (for sidebar layouts), which would lay out every top-level
    // section of the user dashboard side-by-side and reflow whenever the
    // search input width changed. Inline override keeps everything stacked.
    <div className="app-shell" style={{ flexDirection: "column" }}>
      {/* ── Location picker bottom-sheet ── */}
      {showLocationPicker && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}
          onClick={(e) => { if (e.target === e.currentTarget && selectedLocation) setShowLocationPicker(false); }}
        >
          <div style={{ background: "#fff", borderRadius: "20px", padding: "1.25rem 1.25rem 1.5rem", width: "100%", maxWidth: 480, maxHeight: "85vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>
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
          {/* Live time clock removed from the user app per revised workflow.
              Vendor / admin / worker dashboards still show their own clock. */}
          <button
            onClick={e => { e.stopPropagation(); handleOpenNotifs(); }}
            title="Notifications"
            style={{ position: "relative", background: "none", border: "none", fontSize: "1.15rem", cursor: "pointer", padding: "0.2rem" }}
          >
            🔔
            {unreadCount > 0 && (
              <span style={{ position: "absolute", top: 0, right: 0, background: "#dc2626", color: "#fff", borderRadius: 999, fontSize: "0.6rem", fontWeight: 700, padding: "0.05rem 0.32rem", minWidth: 14, textAlign: "center", lineHeight: 1.4 }}>
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </button>
          <Link href="/dashboard/support" onClick={e => e.stopPropagation()} title="Help & Support"
            style={{ fontSize: "1.15rem", textDecoration: "none", padding: "0.2rem" }}>🎧</Link>
          <Link
            href="/dashboard/orders/stats"
            onClick={e => e.stopPropagation()}
            title="My order stats"
            aria-label="My order stats"
            style={{ fontSize: "1.15rem", textDecoration: "none", padding: "0.2rem" }}
          >📊</Link>
          <div style={{ textAlign: "right", lineHeight: 1.15, marginLeft: "0.4rem" }}>
            <div style={{ fontSize: "0.68rem", color: "var(--ink-3)", fontWeight: 500 }}>{greeting} 👋</div>
            <div style={{ fontSize: "0.9rem", fontWeight: 700, color: "var(--ink)", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {user?.displayName || user?.email?.split("@")[0] || "Guest"}
            </div>
          </div>
        </div>
      </div>

      {/* ── Inline canteen search (PDF requirement) ── */}
      <div style={{ padding: "1rem 1rem 0", display: "flex", justifyContent: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", background: "#f3f4f6", border: "1px solid var(--border)", borderRadius: 12, padding: "0.55rem 0.85rem", width: "100%", maxWidth: 520 }}>
          <span style={{ color: "var(--ink-3)", fontSize: "0.95rem" }} aria-hidden>🔍</span>
          <input
            ref={searchRef}
            type="search"
            placeholder="Search canteens or items…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{ flex: 1, border: "none", background: "transparent", outline: "none", fontSize: "0.88rem", color: "var(--ink)" }}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              aria-label="Clear search"
              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-3)", fontSize: "0.95rem" }}
            >✕</button>
          )}
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

      {/* ── Notifications panel ── */}
      {showNotifs && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 90, display: "flex", justifyContent: "flex-end" }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowNotifs(false); }}
        >
          <div style={{ background: "#fff", width: "100%", maxWidth: 380, height: "100%", padding: "1rem", overflowY: "auto", boxShadow: "-4px 0 20px rgba(0,0,0,0.1)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <h3 style={{ fontWeight: 800, fontSize: "1.05rem" }}>🔔 Notifications</h3>
              <button onClick={() => setShowNotifs(false)} style={{ background: "none", border: "none", fontSize: "1.4rem", cursor: "pointer", color: "var(--ink-3)" }}>✕</button>
            </div>
            {notifs.length === 0 ? (
              <p style={{ color: "var(--ink-3)", fontSize: "0.85rem", textAlign: "center", marginTop: "2rem" }}>No notifications yet.</p>
            ) : notifs.map(n => (
              <div key={n.id} style={{ padding: "0.75rem", marginBottom: "0.5rem", borderRadius: 10, background: n.is_read ? "#f9fafb" : "#fff7ed", border: `1px solid ${n.is_read ? "var(--border)" : "#fed7aa"}` }}>
                <div style={{ fontWeight: 700, fontSize: "0.88rem", marginBottom: "0.2rem" }}>{n.title}</div>
                <div style={{ fontSize: "0.8rem", color: "var(--ink-3)", marginBottom: "0.3rem" }}>{n.body}</div>
                <div style={{ fontSize: "0.7rem", color: "var(--ink-3)" }}>{new Date(n.created_at).toLocaleString()}</div>
              </div>
            ))}
          </div>
        </div>
      )}

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
          ) : visibleCanteens.map(c => {
            const offline = !c.isOnline || c.status === "closed";
            return offline ? (
              <div key={c.id} className="canteen-card canteen-card--offline" aria-disabled="true" title="This canteen is currently offline">
                <div className="canteen-icon">{c.emoji}</div>
                <div className="canteen-info">
                  <h4>{c.name}</h4>
                  <p>{c.desc}</p>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginTop: "0.35rem", flexWrap: "wrap" }}>
                    <span style={{ fontSize: "0.72rem", color: "var(--ink-3)" }}>Offline</span>
                    {c.distKm !== null && (
                      <>
                        <span style={{ color: "var(--border)" }}>·</span>
                        <span style={{ fontSize: "0.72rem", color: "var(--ink-3)" }}>📍 {formatDist(c.distKm)}</span>
                      </>
                    )}
                  </div>
                </div>
                <span className="canteen-badge badge-closed">Closed</span>
              </div>
            ) : (
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
            );
          })}
        </div>
      </div>

      {/* ── NoQx Pro soft-awareness banner — tap to view full Pro details (PDF requirement) ── */}
      <Link href="/dashboard/pro" style={{ textDecoration: "none" }}>
        <div style={{ margin: "0.5rem 1rem 1rem", background: "linear-gradient(135deg, #fff7ed 0%, #fef3c7 100%)", border: "1.5px solid #fed7aa", borderRadius: 16, padding: "0.85rem 1rem", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", cursor: "pointer" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: "0.78rem", fontWeight: 800, color: "#92400e", marginBottom: "0.1rem" }}>⚡ Skip queues every day</div>
            <div style={{ fontSize: "0.72rem", color: "#b45309", marginBottom: "0.15rem" }}>With 0/- convenience fee</div>
            <div style={{ fontSize: "0.75rem", fontWeight: 800, color: "#92400e" }}>Try Priority Pickup, Every Time →</div>
          </div>
        </div>
      </Link>

      {/* ── Bottom navigation ── */}
      <nav className="bottom-nav">
        {(["home", "orders", "profile"] as const).map(tab => {
          const icons: Record<string, string> = { home: "🏠", orders: "📦", profile: "👤" };
          const labels: Record<string, string> = { home: "Home", orders: "My Orders", profile: "Profile" };
          const links: Record<string, string> = { home: "/dashboard", orders: "/dashboard/orders", profile: "/dashboard/profile" };
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

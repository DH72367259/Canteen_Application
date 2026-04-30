"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import type { CanteenOrder } from "@/types/canteen";
import type { Session } from "@supabase/supabase-js";

type BinStatus = "placed" | "preparing" | "completed" | "delayed" | "empty";

interface Bin {
  id: string;
  number: number;
  status: BinStatus;
  orderId: string | null;
  customerName: string | null;
  slot: string | null;
  items: string | null;
  otp: string | null;
  rawOrderId?: string;
  binLabel?: string | null;
  binColor?: string | null;
  rawStatus?: string;
  placedAt?: string | null;
}



// Sidebar order per the revised workflow PDF: Live Orders, Prep Summary,
// Menu & Items, Slot Control, Time Slots, Bin Management, Sales,
// Earnings & Payouts, Logs, Settings, then Raise a Concern (logout sits
// in the toolbar, not the sidebar).
const NAV_ITEMS = [
  { id: "live",         icon: "📊", label: "Live Orders" },
  { id: "prep-summary", icon: "📋", label: "Prep Summary" },
  { id: "menu",         icon: "🍽️", label: "Menu & Items" },
  { id: "slot-control", icon: "🎚️", label: "Slot Control" },
  { id: "slots",        icon: "🕐", label: "Time Slots" },
  { id: "bins",         icon: "📦", label: "Bin Management" },
  { id: "sales",        icon: "💰", label: "Sales" },
  { id: "earnings",     icon: "💼", label: "Earnings & Payouts" },
  { id: "logs",         icon: "📝", label: "Logs" },
  { id: "settings",     icon: "⚙️", label: "Settings" },
  { id: "support",      icon: "🎧", label: "Raise a Concern" },
];

export default function VendorDashboard() {
  const router = useRouter();
  const { user, logout, session, loading } = useAuth();
  const [activeNav, setActiveNav] = useState("live");
  const [activeSlot, setActiveSlot] = useState("all");
  // Live Orders status filter — PDF page 14 vocabulary: Reserved / Occupied / Late Pickup
  const [statusFilter, setStatusFilter] = useState<"all" | "reserved" | "occupied" | "late">("all");
  // Live wall clock shown in the toolbar (updates every second)
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const [bins, setBins] = useState<Bin[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  // Total bin slots configured for this canteen (Slot Control → Max Bins).
  // Drives the "show every bin on Live Orders" grid (client request 2026-04-30
  // matching the screenshot mock). Defaults to 0 until slot_control loads so
  // the grid stays empty rather than showing 60 phantom bins.
  const [maxBins, setMaxBins] = useState<number>(0);
  const [selectedBin, setSelectedBin] = useState<Bin | null>(null);
  const [slotsConfigured, setSlotsConfigured] = useState<boolean>(() =>
    typeof window !== "undefined" && localStorage.getItem("vendor_slots_configured") === "true"
  );
  const [menuConfigured, setMenuConfigured] = useState<boolean>(() =>
    typeof window !== "undefined" && localStorage.getItem("vendor_menu_configured") === "true"
  );
  // Re-read the configured flags whenever the user navigates between sidebar
  // tabs so the topbar toggle reflects the latest Save action without a reload.
  const refreshConfigFlags = useCallback(() => {
    if (typeof window === "undefined") return;
    setSlotsConfigured(localStorage.getItem("vendor_slots_configured") === "true");
    setMenuConfigured(localStorage.getItem("vendor_menu_configured") === "true");
  }, []);
  const [otpInput, setOtpInput] = useState("");
  const [otpError, setOtpError] = useState<string | null>(null);
  const [otpSuccess, setOtpSuccess] = useState(false);
  const [canteenOpen, setCanteenOpen] = useState(false);
  const [toggleBusy, setToggleBusy] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const refreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Redirect if not vendor/canteen_admin
  // The double-check against a stored Supabase session prevents the
  // login-flicker bug: when a vendor first logs in, useAuth briefly returns
  // user=null between the explicit signIn() resolving and the profile being
  // hydrated. Without this guard the dashboard bounced to /login and the login
  // page bounced back — a visible double-flash. If the supabase session
  // cookie/localStorage is present, we wait instead of bouncing.
  useEffect(() => {
    if (loading) return; // wait for Supabase auth to settle
    if (!user) {
      // If a Supabase session exists in storage we are mid-hydration — wait,
      // don't bounce. The auth-context will deliver the user shortly.
      if (typeof window !== "undefined") {
        const keys = Object.keys(localStorage);
        const hasSupabaseSession = keys.some(k => k.startsWith("sb-") && k.endsWith("-auth-token"));
        if (hasSupabaseSession) return;
      }
      router.replace("/login");
      return;
    }
    if (user.role !== "vendor" && user.role !== "canteen_admin") {
      router.replace("/login");
    }
  }, [user, loading, router]);

  const handleToggleCanteen = async () => {
    if (toggleBusy) return;
    const next = !canteenOpen;
    // Gate: cannot turn ON unless BOTH menu and slot_control are configured.
    // Source of truth = server (/api/canteens/[id] returns menuReady +
    // slotsReady). Fall back to React state / localStorage if the readiness
    // probe fails so a transient network error never bricks the toggle.
    if (next) {
      let menuOk = menuConfigured;
      let slotsOk = slotsConfigured;
      const canteenId = user?.canteenId;
      if (canteenId && canteenId !== "demo") {
        try {
          const r = await fetch(`/api/canteens/${canteenId}`, { cache: "no-store" });
          if (r.ok) {
            const j = await r.json();
            if (typeof j?.menuReady  === "boolean") menuOk  = j.menuReady;
            if (typeof j?.slotsReady === "boolean") slotsOk = j.slotsReady;
            if (typeof window !== "undefined") {
              if (menuOk)  localStorage.setItem("vendor_menu_configured",  "true");
              if (slotsOk) localStorage.setItem("vendor_slots_configured", "true");
            }
            setMenuConfigured(menuOk);
            setSlotsConfigured(slotsOk);
          }
        } catch { /* fall through to cached values */ }
      }
      if (!slotsOk || !menuOk) {
        const missing: string[] = [];
        if (!menuOk)  missing.push("add at least one menu item (Menu & Items)");
        if (!slotsOk) missing.push("save your slot control (Slot Control → Save)");
        setToggleError(`Before going online, please ${missing.join(" and ")}.`);
        return;
      }
    }
    setToggleBusy(true);
    setToggleError(null);
    // Optimistic update
    setCanteenOpen(next);
    try {
      // user.canteenId is the canteen this vendor belongs to (populated by
      // fetchProfile -> AuthUser). Falls back to "demo" only when the auth
      // context hasn't hydrated yet — never for real vendors.
      const canteenId = user?.canteenId || "demo";
      // PRODUCTION-CRITICAL: read the access token from useAuth()'s `session`,
      // not `localStorage.getItem("supabase.auth.token")` which is the obsolete
      // Supabase v1 storage key. Under Supabase v2 that key is always empty,
      // so the toggle PATCH was silently skipped — the vendor saw their UI flip
      // but `canteens.is_active` in the DB never changed, leaving every canteen
      // card stuck on "Open" in the user app even when the vendor toggled OFF.
      const token = session?.access_token;
      if (canteenId !== "demo" && token) {
        const res = await fetch(`/api/canteens/${canteenId}/toggle`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ is_active: next }),
        });
        if (!res.ok) {
          const j = await res.json();
          throw new Error(j.error || "Server error");
        }
      }
    } catch (err) {
      // Revert on failure
      setCanteenOpen(!next);
      setToggleError(err instanceof Error ? err.message : "Could not update canteen status.");
    } finally {
      setToggleBusy(false);
    }
  };

  // Sync toggle state from the canteen row on mount so the vendor never sees
  // a stale "OFF" banner when their canteen is actually live (or vice versa).
  // Also pulls authoritative menuReady/slotsReady so the toggle gate doesn't
  // depend on per-browser localStorage flags (those break in fresh sessions).
  useEffect(() => {
    const canteenId = user?.canteenId;
    if (!canteenId || canteenId === "demo") return;
    let cancelled = false;
    fetch(`/api/canteens/${canteenId}`)
      .then(r => r.ok ? r.json() : null)
      .then(j => {
        if (cancelled || !j?.canteen) return;
        setCanteenOpen(!!j.canteen.is_active);
        if (typeof window !== "undefined") {
          if (j.menuReady)  { localStorage.setItem("vendor_menu_configured",  "true"); setMenuConfigured(true); }
          if (j.slotsReady) { localStorage.setItem("vendor_slots_configured", "true"); setSlotsConfigured(true); }
        }
      })
      .catch(() => { /* keep optimistic default */ });
    return () => { cancelled = true; };
  }, [user]);

  // Fetch real orders from DB and map to bins
  const fetchOrders = useCallback(async () => {
    const token = session?.access_token;
    if (!token) return;
    try {
      const res = await fetch("/api/orders", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const { orders } = await res.json();
      const active = (orders as CanteenOrder[]).filter(
        (o) => !["collected", "completed", "cancelled"].includes(o.rawStatus ?? o.status)
      );
      const mapped: Bin[] = active.map((o, idx) => ({
        id: o.id,
        number: parseInt(o.binLabel ?? String(idx + 1), 10) || idx + 1,
        status: o.rawStatus === "ready_for_pickup" || o.rawStatus === "placed_in_bin"
          ? "completed"
          : o.rawStatus === "preparing"
            ? "preparing"
            : (o.rawStatus === "placed" || o.rawStatus === "confirmed")
              ? "placed"
              : "empty",
        orderId: o.id.substring(0, 8).toUpperCase(),
        customerName: o.customerName || "Customer",
        slot: o.slotLabel ?? o.slotName ?? null,
        items: o.items.map((i) => `${i.name} ×${i.quantity}`).join(", ") || null,
        otp: o.otp ?? null,
        binLabel: o.binLabel ?? null,
        binColor: o.binColor ?? null,
        rawOrderId: o.id,
        rawStatus: o.rawStatus,
        placedAt: o.createdAt ?? null,
      }));
      // Only show bins that have an assigned order (no empty filler bins)
      mapped.sort((a, b) => a.number - b.number);
      setBins(mapped);
    } catch {
      // silently ignore
    } finally {
      setOrdersLoading(false);
    }
  }, [session?.access_token]);

  const handleMarkReady = useCallback(async (rawOrderId: string) => {
    const token = session?.access_token;
    if (!token) return;
    await fetch(`/api/orders/${rawOrderId}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ status: "ready_for_pickup" }),
    }).catch(() => {});
    await fetchOrders();
  }, [session?.access_token, fetchOrders]);

  const handleMarkCollected = useCallback(async (rawOrderId: string) => {
    const token = session?.access_token;
    if (!token) return;
    await fetch(`/api/orders/${rawOrderId}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ status: "collected" }),
    }).catch(() => {});
    await fetchOrders();
  }, [session?.access_token, fetchOrders]);

  // Auto-refresh every 30 seconds (reduced from 5s to lower DB load at scale)
  useEffect(() => {
    void fetchOrders();
    refreshRef.current = setInterval(fetchOrders, 30_000);
    return () => { if (refreshRef.current) clearInterval(refreshRef.current); };
  }, [fetchOrders]);

  // Fetch slot_control.max_bins so Live Orders can render every physical bin
  // (placed/preparing/completed/delayed/empty) instead of only bins that have
  // an active order. Refreshes when the user navigates back to Live Orders so
  // changes from Slot Control take effect without a page reload.
  useEffect(() => {
    const token = session?.access_token;
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/canteen/slot-control", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        if (!r.ok) return;
        const j = await r.json();
        const mb = Number(j?.slot_control?.max_bins);
        if (!cancelled && Number.isFinite(mb) && mb > 0) setMaxBins(mb);
      } catch { /* non-fatal */ }
    })();
    return () => { cancelled = true; };
  }, [session?.access_token, activeNav]);

  const handleBinClick = (bin: Bin) => {
    if (bin.status === "empty") return;
    setSelectedBin(bin);
    setOtpInput("");
    setOtpError(null);
    setOtpSuccess(false);
  };

  const handleOtpVerify = async () => {
    if (!selectedBin) return;
    if (otpInput !== selectedBin.otp) {
      setOtpError("Incorrect OTP. Try again.");
      return;
    }
    setOtpSuccess(true);
    if (selectedBin.rawOrderId) {
      await handleMarkCollected(selectedBin.rawOrderId);
    } else {
      setBins(prev => prev.map(b => b.id === selectedBin.id ? { ...b, status: "completed" } : b));
    }
    setTimeout(() => setSelectedBin(null), 1200);
  };

  const handleLogout = async () => { try { await logout(); } catch { /* ignore */ } router.replace("/login"); };

  // Show spinner while auth loads or while redirecting
  if (loading || !user) return <div className="loading-screen"><div className="spinner" /></div>;

  const slotBins = activeSlot === "all"
    ? bins
    : bins.filter(b => b.slot === activeSlot);

  // Per spec: only show bins that have an assigned order, and sort placed → preparing → just-now (bottom)
  const STATUS_ORDER: Record<BinStatus, number> = { placed: 0, preparing: 1, completed: 2, delayed: 3, empty: 99 };
  const visibleSlotBins = [...slotBins]
    .filter(b => b.status !== "empty" && !!b.orderId)
    .filter(b => {
      if (statusFilter === "all") return true;
      // PDF vocabulary mapping: just-placed / preparing → Reserved (kitchen has
      // it, food not in bin yet); completed (in bin, awaiting pickup) → Occupied;
      // delayed (past grace period) → Late Pickup.
      if (statusFilter === "reserved") return b.status === "placed" || b.status === "preparing";
      if (statusFilter === "occupied") return b.status === "completed";
      if (statusFilter === "late")     return b.status === "delayed";
      return true;
    })
    .sort((a, b) => {
      const sa = STATUS_ORDER[a.status]; const sb = STATUS_ORDER[b.status];
      if (sa !== sb) return sa - sb;
      // Within same status, newest ("just now") goes to the bottom
      const ta = a.placedAt ? Date.parse(a.placedAt) : 0;
      const tb = b.placedAt ? Date.parse(b.placedAt) : 0;
      return ta - tb;
    });

  // Full bin grid for Live Orders (client request 2026-04-30): show every
  // physical bin 1..maxBins. Bins with an active order use the order's
  // status; the rest render as "empty". Status filter narrows the visible
  // set including empty (which is filtered out unless the user chose "all").
  // Map active orders by bin number for O(1) lookup.
  const activeBinByNum = new Map<number, Bin>();
  for (const b of slotBins) {
    if (b.status !== "empty" && b.orderId) activeBinByNum.set(b.number, b);
  }
  const fullBinGrid: Bin[] = [];
  for (let i = 1; i <= maxBins; i++) {
    const active = activeBinByNum.get(i);
    if (active) {
      fullBinGrid.push(active);
    } else {
      fullBinGrid.push({
        id: `empty-${i}`,
        number: i,
        status: "empty",
        orderId: null,
        customerName: null,
        slot: null,
        items: null,
        otp: null,
        binLabel: null,
        binColor: null,
        placedAt: null,
      });
    }
  }
  const filteredFullGrid = fullBinGrid.filter(b => {
    if (statusFilter === "all") return true;
    if (statusFilter === "reserved") return b.status === "placed" || b.status === "preparing";
    if (statusFilter === "occupied") return b.status === "completed";
    if (statusFilter === "late")     return b.status === "delayed";
    return true;
  });

  const uniqueSlots = Array.from(new Set(bins.filter(b => b.slot).map(b => b.slot as string)));
  const stats = { total: bins.filter(b => b.status !== "empty").length, preparing: bins.filter(b => b.status === "preparing").length, completed: bins.filter(b => b.status === "completed").length, delayed: bins.filter(b => b.status === "delayed").length };

  return (
    <div className="web-shell">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="logo-badge">
            <span className="dot" />
            Canteen
          </div>
          <p>{user?.displayName || "My Canteen"}</p>
        </div>

        <nav className="sidebar-nav">
          {NAV_ITEMS.map(item => (
            <button
              key={item.id}
              className={`sidebar-link ${activeNav === item.id ? "active" : ""}`}
              onClick={() => { setActiveNav(item.id); refreshConfigFlags(); }}
            >
              <span className="icon">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <button className="sidebar-link" onClick={handleLogout} style={{ color: "#f87171" }}>
            <span className="icon">🚪</span>
            Logout
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="main-with-sidebar">
        {/* Topbar */}
        <div className="topbar">
          <div>
            <div style={{ fontWeight: 700 }}>
              {NAV_ITEMS.find(n => n.id === activeNav)?.label}
            </div>
            <div className="topbar-sub">Auto-refreshes every 5 seconds</div>
          </div>
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
            {/* Live time clock (PDF requirement: "Add Time in toolbar") */}
            <div
              title="Current time"
              style={{
                fontFamily: "monospace",
                fontSize: "0.85rem",
                fontWeight: 700,
                background: "#f1f5f9",
                color: "#0f172a",
                borderRadius: 8,
                padding: "0.3rem 0.6rem",
                border: "1px solid #cbd5e1",
                letterSpacing: "0.5px",
              }}
            >
              🕒 {now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false })}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span style={{ fontSize: "0.78rem", color: "var(--ink-3)", fontWeight: 600 }}>Canteen</span>
              {toggleError && <span style={{ fontSize: "0.72rem", color: "var(--red)", maxWidth: 220 }}>{toggleError}</span>}
              {(() => {
                const tip = canteenOpen
                  ? "Canteen is OPEN – click to close"
                  : "Canteen is CLOSED – click to open";
                return (
                  <label
                    className="toggle-switch"
                    title={tip}
                    style={{ opacity: toggleBusy ? 0.45 : 1, cursor: toggleBusy ? "not-allowed" : "pointer" }}
                  >
                    <input
                      type="checkbox"
                      checked={canteenOpen}
                      disabled={toggleBusy}
                      onChange={handleToggleCanteen}
                    />
                    <span className="toggle-track" />
                  </label>
                );
              })()}
              <span style={{ fontSize: "0.78rem", fontWeight: 700, color: canteenOpen ? "var(--green)" : "var(--red)" }}>
                {canteenOpen ? "Open" : "Closed"}
              </span>
            </div>
            <div style={{ fontSize: "0.82rem", background: canteenOpen ? "var(--green-light)" : "var(--red-light)", color: canteenOpen ? "#15803d" : "#b91c1c", borderRadius: 999, padding: "0.25rem 0.7rem", fontWeight: 600 }}>
              {canteenOpen ? "● Live" : "● Off"}
            </div>
          </div>
        </div>

        {activeNav === "live" && (
          <>
            {/* Stats row */}
            <div className="stats-row">
              <div className="stat-card">
                <div className="stat-num">{stats.total}</div>
                <div className="stat-label">Today&apos;s Orders</div>
              </div>
              <div className="stat-card">
                <div className="stat-num" style={{ color: "var(--yellow)" }}>{stats.preparing}</div>
                <div className="stat-label">Preparing</div>
              </div>
              <div className="stat-card">
                <div className="stat-num" style={{ color: "var(--green)" }}>{stats.completed}</div>
                <div className="stat-label">Completed</div>
              </div>
              <div className="stat-card">
                <div className="stat-num" style={{ color: "var(--red)" }}>{stats.delayed}</div>
                <div className="stat-label">Delayed</div>
              </div>
            </div>

            {/* Slot selector + status sorter (per PDF: Live Orders → pick a slot, sort by status) */}
            <div className="slot-tabs" style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "0.4rem" }}>
              {/* Slot dropdown — replaces the old "All Bins" pill so manager can
                  jump straight into a specific time-slot's bin view (PDF spec). */}
              <select
                value={activeSlot}
                onChange={e => setActiveSlot(e.target.value)}
                style={{
                  padding: "0.45rem 0.8rem", border: "1.5px solid var(--orange)", borderRadius: 8,
                  fontSize: "0.85rem", fontWeight: 700, background: "#fff7ed", color: "var(--orange-dark)",
                  cursor: "pointer", minWidth: 180,
                }}
                title="Select a slot to view its bins"
              >
                <option value="all">All slots ▾</option>
                {uniqueSlots.map(s => (
                  <option key={s} value={s}>{s} ▾</option>
                ))}
              </select>
              {/* Status sorter — PDF page 14: Reserved / Occupied / Late Pickup
                  (Empty bins live in the Bin Management tab; Live Orders only
                  shows bins that currently have an order). */}
              <div style={{ display: "flex", gap: "0.3rem", marginLeft: "auto", flexWrap: "wrap" }}>
                {([
                  { id: "reserved", label: "Reserved",     color: "var(--blue)" },
                  { id: "occupied", label: "Occupied",     color: "var(--green)" },
                  { id: "late",     label: "Late Pickup",  color: "var(--red)" },
                ] as const).map(opt => (
                  <button
                    key={opt.id}
                    onClick={() => setStatusFilter(prev => prev === opt.id ? "all" : opt.id)}
                    style={{
                      padding: "0.35rem 0.7rem",
                      borderRadius: 8,
                      border: statusFilter === opt.id ? `1.5px solid ${opt.color}` : "1.5px solid var(--border)",
                      background: statusFilter === opt.id ? `${opt.color}15` : "#fff",
                      color: statusFilter === opt.id ? opt.color : "var(--ink-2)",
                      fontWeight: 700,
                      fontSize: "0.78rem",
                      cursor: "pointer",
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Legend — PDF page 14 vocabulary */}
            <div style={{ padding: "0.5rem 1rem 0", display: "flex", gap: "1rem", fontSize: "0.75rem", color: "var(--ink-3)", flexWrap: "wrap" }}>
              <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: "var(--blue)", marginRight: 4 }} />Reserved</span>
              <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: "var(--green)", marginRight: 4 }} />Occupied</span>
              <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: "var(--red)", marginRight: 4 }} />Late Pickup</span>
            </div>

            {/* Bin grid — full grid showing every physical bin (1..maxBins).
                When the canteen has not configured a slot-control max yet,
                fall back to just the bins that have active orders. */}
            {ordersLoading ? (
              <div style={{ padding: "2rem", textAlign: "center", color: "var(--ink-3)" }}>Loading live orders…</div>
            ) : (maxBins === 0 && visibleSlotBins.length === 0) ? (
              <div className="empty-state" style={{ padding: "2.5rem", textAlign: "center", color: "var(--ink-3)" }}>
                <div style={{ fontSize: "2rem" }}>📦</div>
                <h3 style={{ fontWeight: 700, fontSize: "0.95rem", marginTop: "0.4rem" }}>No active orders</h3>
                <p style={{ fontSize: "0.82rem" }}>Configure Slot Control → Max Bins to display the full bin grid here.</p>
              </div>
            ) : (
            <div className="bin-grid">
              {(maxBins > 0 ? filteredFullGrid : visibleSlotBins).map(bin => {
                const badgeLabel =
                  bin.status === "placed" || bin.status === "preparing" ? "Reserved" :
                  bin.status === "completed" ? "Occupied" :
                  bin.status === "delayed"   ? "Late Pickup" :
                  "Empty";
                const badgeKey =
                  bin.status === "placed" || bin.status === "preparing" ? "reserved" :
                  bin.status === "completed" ? "occupied" :
                  bin.status === "delayed"   ? "late" :
                  "empty";
                return (
                <div
                  key={bin.id}
                  className={`bin-card ${bin.status}`}
                  onClick={() => bin.status !== "empty" && handleBinClick(bin)}
                  style={bin.status === "empty" ? { cursor: "default", opacity: 0.78 } : undefined}
                >
                  <span className={`bin-status-badge ${badgeKey}`}>{badgeLabel}</span>
                  <div className="bin-number">
                    {bin.status !== "empty" && <span className="bin-status-dot" />}
                    Bin #{bin.number}
                  </div>
                  {bin.orderId ? (
                    <>
                      <div className="bin-order-id">{bin.orderId}</div>
                      <div className="bin-customer">{bin.customerName}</div>
                      <div className="bin-slot">{bin.slot} · {bin.items}</div>
                      {(bin.status === "placed" || bin.status === "preparing") && bin.rawOrderId && (
                        <button
                          onClick={e => { e.stopPropagation(); handleMarkReady(bin.rawOrderId!); }}
                          style={{ marginTop: "0.4rem", fontSize: "0.7rem", fontWeight: 700, background: "var(--orange)", color: "#fff", border: "none", borderRadius: 6, padding: "0.2rem 0.5rem", cursor: "pointer" }}
                        >
                          ✓ Mark Ready
                        </button>
                      )}
                      {bin.status === "completed" && (
                        <div style={{ marginTop: "0.25rem", fontSize: "0.7rem", fontWeight: 700, color: "var(--green)", opacity: 0.9 }}>
                          Ready for pickup — tap to verify OTP
                        </div>
                      )}
                    </>
                  ) : (
                    <div style={{ fontSize: "0.78rem", color: "var(--ink-3)", marginTop: "0.25rem" }}>Available</div>
                  )}
                </div>
                );
              })}
            </div>
            )}
          </>
        )}

        {activeNav === "slot-control" && <VendorSlotControlView session={session} />}
        {activeNav === "prep-summary" && <VendorPrepSummaryView session={session} />}
        {activeNav === "menu" && <VendorMenuView session={session} />}
        {activeNav === "slots" && <VendorSlotsView />}
        {activeNav === "sales" && <VendorSalesView />}
        {activeNav === "earnings" && <VendorEarningsView session={session} />}
        {activeNav === "bins" && <VendorBinsView session={session} canteenId={user?.canteenId ?? null} />}
        {activeNav === "logs" && <VendorLogsView />}
        {activeNav === "settings" && <VendorSettingsView canteenOpen={canteenOpen} setCanteenOpen={setCanteenOpen} />}
        {activeNav === "support" && <VendorSupportView />}
      </main>

      {/* OTP Modal */}
      {selectedBin && (
        <div className="modal-overlay" onClick={() => setSelectedBin(null)}>
          <div className="modal-sheet" onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <h3>Verify OTP — Bin #{selectedBin.number}</h3>
              <button onClick={() => setSelectedBin(null)} style={{ background: "none", border: "none", fontSize: "1.2rem", cursor: "pointer", color: "var(--ink-3)" }}>✕</button>
            </div>

            <div className="card" style={{ background: "var(--bg)" }}>
              <div style={{ fontSize: "0.8rem", color: "var(--ink-3)" }}>Order</div>
              <div style={{ fontWeight: 700 }}>{selectedBin.orderId} · {selectedBin.customerName}</div>
              <div style={{ fontSize: "0.82rem", color: "var(--ink-2)", marginTop: "0.2rem" }}>{selectedBin.items} · {selectedBin.slot}</div>
            </div>

            {otpSuccess ? (
              <div style={{ textAlign: "center", padding: "1rem", color: "var(--green)", fontWeight: 700, fontSize: "1.1rem" }}>
                ✅ OTP Verified! Order marked complete.
              </div>
            ) : (
              <>
                <div>
                  <div className="form-label" style={{ marginBottom: "0.5rem" }}>Customer shows OTP — enter below</div>
                  <div className="otp-input-row">
                    {[0, 1, 2, 3].map(i => (
                      <input
                        key={i}
                        className="otp-digit"
                        type="text"
                        maxLength={1}
                        value={otpInput[i] || ""}
                        onChange={e => {
                          const val = e.target.value.replace(/\D/g, "");
                          const next = otpInput.split("");
                          next[i] = val;
                          setOtpInput(next.join("").slice(0, 4));
                          setOtpError(null);
                        }}
                      />
                    ))}
                  </div>
                  {otpError && <p className="error-msg">{otpError}</p>}
                </div>
                <button className="btn btn-primary btn-full" onClick={handleOtpVerify} disabled={otpInput.length < 4} style={{ padding: "0.8rem" }}>
                  Verify & Complete Order
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Sub-views ─── */

function VendorMenuView({ session }: { session: { access_token: string } | null }) {
  type MealType = "breakfast" | "lunch" | "dinner" | "packed_snacks";
  type ProductionType = "batch" | "made_to_order";
  type ServeType = "meals" | "snacks";
  type Item = {
    id: string; name: string; price: number; mealType: MealType;
    productionType: ProductionType; capacity: number; serveType: ServeType; enabled: boolean;
  };
  type FormState = {
    name: string; price: string; mealType: MealType;
    productionType: ProductionType; capacity: string; serveType: ServeType;
  };

  const MEAL_TYPES: { value: MealType; label: string }[] = [
    { value: "breakfast",     label: "Breakfast" },
    { value: "lunch",         label: "Lunch" },
    { value: "dinner",        label: "Dinner" },
    { value: "packed_snacks", label: "Packed snacks" },
  ];
  const MEAL_LABEL: Record<MealType, string> = {
    breakfast: "🌅 Breakfast", lunch: "☀️ Lunch", dinner: "🌙 Dinner", packed_snacks: "🥡 Packed snacks",
  };

  const CATEGORY_LABEL: Record<MealType, string> = {
    breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", packed_snacks: "Packed snacks",
  };
  const labelToMealType = (label?: string | null): MealType => {
    const norm = (label ?? "").toLowerCase();
    if (norm.startsWith("breakfast")) return "breakfast";
    if (norm.startsWith("dinner"))    return "dinner";
    if (norm.startsWith("snack") || norm.startsWith("packed")) return "packed_snacks";
    return "lunch";
  };

  // DB row shape returned by /api/canteen/menu
  type DbItem = {
    id: string; name: string; price: number; category: string | null;
    availability_type: string | null; quantity_per_slot: number | null;
    total_per_day: number | null; is_meal: boolean | null; is_available: boolean | null;
  };
  const fromDb = (r: DbItem): Item => {
    const productionType: ProductionType = r.availability_type === "slot_based" ? "made_to_order" : "batch";
    const capacity = productionType === "batch" ? (r.total_per_day ?? 0) : (r.quantity_per_slot ?? 0);
    return {
      id: r.id, name: r.name, price: Number(r.price ?? 0),
      mealType: labelToMealType(r.category),
      productionType, capacity,
      serveType: r.is_meal ? "meals" : "snacks",
      enabled: r.is_available !== false,
    };
  };
  const toDbBody = (it: Omit<Item, "id">) => ({
    name: it.name,
    price: it.price,
    category: CATEGORY_LABEL[it.mealType],
    availability_type: it.productionType === "made_to_order" ? "slot_based" : "batched_prepared",
    quantity_per_slot: it.productionType === "made_to_order" ? it.capacity : null,
    total_per_day:     it.productionType === "batch"          ? it.capacity : null,
    is_meal: it.serveType === "meals",
    is_available: it.enabled,
  });

  const [tab, setTab] = useState<MealType>("lunch");
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const authHeaders = useCallback((): Record<string, string> => {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (session?.access_token) h.Authorization = `Bearer ${session.access_token}`;
    return h;
  }, [session]);

  // Load items from DB on mount + whenever session arrives
  useEffect(() => {
    if (!session?.access_token) return;
    let cancelled = false;
    setLoading(true); setError(null);
    fetch("/api/canteen/menu", { headers: authHeaders() })
      .then(async r => {
        if (r.ok) return r.json();
        const j = await r.json().catch(() => ({}));
        return Promise.reject(j?.error || `HTTP ${r.status}`);
      })
      .then((j: { items: DbItem[] }) => { if (!cancelled) setItems((j.items ?? []).map(fromDb)); })
      .catch(e => { if (!cancelled) setError(typeof e === "string" ? `Failed to load menu: ${e}` : "Failed to load menu."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.access_token]);

  const [modal, setModal] = useState<{ item: Item | null } | null>(null);
  const emptyForm: FormState = { name: "", price: "", mealType: "lunch", productionType: "batch", capacity: "", serveType: "meals" };
  const [form, setForm] = useState<FormState>(emptyForm);
  const [savedFlash, setSavedFlash] = useState(false);

  // Mark menu as "configured" so the canteen ON toggle gate unlocks. The DB
  // is the source of truth; we additionally mirror to localStorage so the
  // topbar gate (which reads localStorage synchronously on mount) sees it.
  const handleSaveMenu = () => {
    if (typeof window === "undefined") return;
    if (items.length === 0) return;
    localStorage.setItem("vendor_menu_configured", "true");
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 3000);
  };

  const toggleItem = async (id: string) => {
    const target = items.find(i => i.id === id);
    if (!target) return;
    const next = !target.enabled;
    // optimistic
    setItems(prev => prev.map(i => i.id === id ? { ...i, enabled: next } : i));
    try {
      const res = await fetch(`/api/canteen/menu/${id}`, { method: "PATCH", headers: authHeaders(), body: JSON.stringify({ is_available: next }) });
      if (!res.ok) throw new Error("toggle failed");
    } catch {
      setItems(prev => prev.map(i => i.id === id ? { ...i, enabled: !next } : i));
      setError("Could not update item availability.");
    }
  };

  const openEdit = (item: Item) => {
    setModal({ item });
    setForm({
      name: item.name, price: String(item.price), mealType: item.mealType,
      productionType: item.productionType, capacity: String(item.capacity), serveType: item.serveType,
    });
  };

  const openAdd = () => {
    setModal({ item: null });
    setForm({ ...emptyForm, mealType: tab });
  };

  const saveModal = async () => {
    if (!form.name.trim()) return;
    if (busy) return;
    setBusy(true); setError(null);
    const draft: Omit<Item, "id"> = {
      name: form.name.trim(),
      price: Number(form.price) || 0,
      mealType: form.mealType,
      productionType: form.productionType,
      capacity: Number(form.capacity) || 0,
      serveType: form.serveType,
      enabled: modal?.item?.enabled ?? true,
    };
    try {
      if (modal?.item) {
        const res = await fetch(`/api/canteen/menu/${modal.item.id}`, {
          method: "PATCH", headers: authHeaders(), body: JSON.stringify(toDbBody(draft)),
        });
        const j = await res.json();
        if (!res.ok || !j.item) throw new Error(j.error || "Update failed");
        const updated = fromDb(j.item as DbItem);
        setItems(prev => prev.map(i => i.id === updated.id ? updated : i));
      } else {
        const res = await fetch("/api/canteen/menu", {
          method: "POST", headers: authHeaders(), body: JSON.stringify(toDbBody(draft)),
        });
        const j = await res.json();
        if (!res.ok || !j.item) throw new Error(j.error || "Create failed");
        const created = fromDb(j.item as DbItem);
        setItems(prev => [...prev, created]);
      }
      // Any change invalidates the saved flag — vendor must click Save Menu again.
      if (typeof window !== "undefined") localStorage.removeItem("vendor_menu_configured");
      setSavedFlash(false);
      setModal(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  };

  const removeItem = async (id: string) => {
    if (!confirm("Delete this item?")) return;
    const prev = items;
    setItems(p => p.filter(i => i.id !== id));
    try {
      const res = await fetch(`/api/canteen/menu/${id}`, { method: "DELETE", headers: authHeaders() });
      if (!res.ok) throw new Error("delete failed");
      if (typeof window !== "undefined") localStorage.removeItem("vendor_menu_configured");
      setSavedFlash(false);
    } catch {
      setItems(prev);
      setError("Could not delete item.");
    }
  };

  const visibleItems = items.filter(i => i.mealType === tab);

  return (
    <div className="page-content">
      <div className="page-header">
        <h2>Menu & Items</h2>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          {savedFlash && <span style={{ fontSize: "0.78rem", color: "var(--green)", fontWeight: 600 }}>✅ Menu saved!</span>}
          {loading && <span style={{ fontSize: "0.78rem", color: "var(--ink-3)" }}>Loading…</span>}
          {error && <span style={{ fontSize: "0.75rem", color: "var(--red)", maxWidth: 240 }}>{error}</span>}
          <button className="btn btn-ghost" style={{ fontSize: "0.85rem", padding: "0.5rem 1rem" }} onClick={openAdd} disabled={busy}>+ Add Item</button>
          <button
            className="btn btn-primary"
            style={{ fontSize: "0.85rem", padding: "0.5rem 1rem", opacity: items.length === 0 || busy ? 0.5 : 1 }}
            disabled={items.length === 0 || busy}
            onClick={handleSaveMenu}
            title={items.length === 0 ? "Add at least one item before saving" : "Save the menu so the canteen can be turned ON"}
          >
            Save Menu
          </button>
        </div>
      </div>

      <div className="meal-tabs" style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden", marginBottom: "1rem", display: "flex" }}>
        {MEAL_TYPES.map(m => (
          <button key={m.value} className={`meal-tab ${tab === m.value ? "active" : ""}`} onClick={() => setTab(m.value)} style={{ flex: 1 }}>
            {MEAL_LABEL[m.value]}
          </button>
        ))}
      </div>

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {visibleItems.length === 0 && (
          <div className="empty-state" style={{ padding: "2rem" }}>
            <span className="empty-icon">🍽️</span>
            <h3>No items for {MEAL_LABEL[tab]}</h3>
            <p>Add your first item using the button above</p>
          </div>
        )}
        {visibleItems.map((item, i) => (
          <div key={item.id} style={{ padding: "0.85rem 1rem", borderBottom: i < visibleItems.length - 1 ? "1px solid var(--border)" : "none", display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>{item.name}</div>
              <div style={{ fontSize: "0.78rem", color: "var(--ink-3)" }}>
                ₹{item.price} · {item.productionType === "batch" ? `Batch · ${item.capacity} plates` : `Made to order · ${item.capacity}/slot`}
                {" · "}{item.serveType === "meals" ? "🍽️ Meal (on plate)" : "🥡 Snack (no plate)"}
              </div>
            </div>
            <button className="btn btn-ghost" style={{ fontSize: "0.75rem", padding: "0.2rem 0.5rem" }} onClick={() => openEdit(item)}>✏ Edit</button>
            <button className="btn btn-ghost" style={{ fontSize: "0.75rem", padding: "0.2rem 0.5rem", color: "var(--red)" }} onClick={() => removeItem(item.id)}>✕</button>
            <label className="toggle-switch">
              <input type="checkbox" checked={item.enabled} onChange={() => toggleItem(item.id)} />
              <span className="toggle-track" />
            </label>
          </div>
        ))}
      </div>

      {modal !== null && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal-sheet" onClick={e => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "1rem" }}>
              <h3>{modal.item ? "Edit Item" : "Add New Item"}</h3>
              <button onClick={() => setModal(null)} style={{ background: "none", border: "none", fontSize: "1.2rem", cursor: "pointer" }}>✕</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <div>
                <label className="form-label">Item name</label>
                <input className="form-input" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Chicken Curry" />
              </div>
              <div>
                <label className="form-label">Type</label>
                <select className="form-input" value={form.mealType} onChange={e => setForm(p => ({ ...p, mealType: e.target.value as MealType }))}>
                  {MEAL_TYPES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
              <div>
                <label className="form-label">Price (₹)</label>
                <input className="form-input" type="number" value={form.price} onChange={e => setForm(p => ({ ...p, price: e.target.value }))} placeholder="e.g. 85" />
              </div>
              <div>
                <label className="form-label">Production type</label>
                <select className="form-input" value={form.productionType} onChange={e => setForm(p => ({ ...p, productionType: e.target.value as ProductionType }))}>
                  <option value="batch">Batch prepared</option>
                  <option value="made_to_order">Made to order</option>
                </select>
              </div>
              {form.productionType === "batch" ? (
                <div>
                  <label className="form-label">Total no. of plates</label>
                  <input className="form-input" type="number" value={form.capacity} onChange={e => setForm(p => ({ ...p, capacity: e.target.value }))} placeholder="e.g. 50" />
                </div>
              ) : (
                <div>
                  <label className="form-label">Total order per slot</label>
                  <input className="form-input" type="number" value={form.capacity} onChange={e => setForm(p => ({ ...p, capacity: e.target.value }))} placeholder="e.g. 10" />
                </div>
              )}
              <div>
                <label className="form-label">How it will be served</label>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  {([
                    { v: "meals",  l: "🍽️ Meal", d: "Given on plate" },
                    { v: "snacks", l: "🥡 Snack", d: "Not given on plate" },
                  ] as const).map(opt => (
                    <label key={opt.v} style={{
                      flex: 1, cursor: "pointer", border: `2px solid ${form.serveType === opt.v ? "var(--orange)" : "var(--border)"}`,
                      borderRadius: 10, padding: "0.6rem 0.7rem", background: form.serveType === opt.v ? "#fff7ed" : "var(--surface)",
                    }}>
                      <input type="radio" name="serveType" value={opt.v} checked={form.serveType === opt.v}
                        onChange={() => setForm(p => ({ ...p, serveType: opt.v }))}
                        style={{ marginRight: "0.4rem", accentColor: "var(--orange)" }} />
                      <strong style={{ fontSize: "0.85rem" }}>{opt.l}</strong>
                      <div style={{ fontSize: "0.72rem", color: "var(--ink-3)", marginLeft: "1.4rem" }}>{opt.d}</div>
                    </label>
                  ))}
                </div>
              </div>
              <button className="btn btn-primary btn-full" onClick={saveModal} style={{ marginTop: "0.5rem" }} disabled={busy}>
                {busy ? "Saving…" : (modal.item ? "Save Changes" : "Add Item")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function VendorSlotsView() {
  type Slot = { id: string; time: string; type: "Breakfast" | "Lunch" | "Dinner" | "Snacks"; capacity: number; booked: number; enabled: boolean };
  const INIT: Slot[] = [];
  const [slots, setSlots] = useState<Slot[]>(INIT);
  const [modal, setModal] = useState<Slot | null | false>(false); // null = add new
  const [form, setForm] = useState({ time: "", type: "Lunch" as Slot["type"], capacity: "" });
  const [saved, setSaved] = useState(false);

  const openEdit = (s: Slot) => { setModal(s); setForm({ time: s.time, type: s.type, capacity: String(s.capacity) }); };
  const openAdd = () => { setModal(null); setForm({ time: "", type: "Lunch", capacity: "" }); };
  const closeModal = () => setModal(false);

  const handleSaveConfiguration = () => {
    if (typeof window !== "undefined") {
      localStorage.setItem("vendor_slots_configured", "true");
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const saveModal = () => {
    if (!form.time.trim()) return;
    if (modal !== null && modal !== false) {
      setSlots(prev => prev.map(s => s.id === modal.id ? { ...s, time: form.time, type: form.type, capacity: Number(form.capacity) || s.capacity } : s));
    } else {
      setSlots(prev => [...prev, { id: `s${Date.now()}`, time: form.time, type: form.type, capacity: Number(form.capacity) || 20, booked: 0, enabled: true }]);
    }
    closeModal();
  };

  const toggleSlot = (id: string) => setSlots(prev => prev.map(s => s.id === id ? { ...s, enabled: !s.enabled } : s));
  const deleteSlot = (id: string) => setSlots(prev => prev.filter(s => s.id !== id));

  const typeTag: Record<Slot["type"], string> = { Breakfast: "tag-orange", Lunch: "tag-blue", Dinner: "tag-gray", Snacks: "tag-yellow" };

  return (
    <div className="page-content">
      <div className="page-header">
        <h2>Time Slots</h2>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          {saved && <span style={{ fontSize: "0.78rem", color: "var(--green)", fontWeight: 600 }}>✅ Configuration saved!</span>}
          <button className="btn btn-ghost" style={{ fontSize: "0.85rem", padding: "0.5rem 1rem" }} onClick={openAdd}>+ Add Slot</button>
          <button className="btn btn-primary" style={{ fontSize: "0.85rem", padding: "0.5rem 1rem" }} onClick={handleSaveConfiguration}>
            Save Configuration
          </button>
        </div>
      </div>
      <div style={{ background: "#fef9c3", border: "1.5px solid #fde68a", borderRadius: 10, padding: "0.6rem 0.9rem", fontSize: "0.78rem", color: "#92400e", marginBottom: "0.75rem" }}>
        ⚡ You must click <strong>Save Configuration</strong> before you can turn the canteen ON.
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>TIME</th><th>TYPE</th><th>CAPACITY</th><th>BOOKED</th><th>STATUS</th><th>ACTIONS</th></tr></thead>
          <tbody>
            {slots.map(s => (
              <tr key={s.id}>
                <td style={{ fontWeight: 600 }}>{s.time}</td>
                <td><span className={`tag ${typeTag[s.type]}`}>{s.type}</span></td>
                <td>{s.capacity}</td>
                <td>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                    <div style={{ flex: 1, height: 6, background: "var(--border)", borderRadius: 999, maxWidth: 80 }}>
                      <div style={{ width: `${Math.min((s.booked / s.capacity) * 100, 100)}%`, height: "100%", background: s.booked / s.capacity > 0.8 ? "var(--red)" : "var(--orange)", borderRadius: 999 }} />
                    </div>
                    <span style={{ fontSize: "0.78rem" }}>{s.booked}/{s.capacity}</span>
                  </div>
                </td>
                <td>
                  <label className="toggle-switch">
                    <input type="checkbox" checked={s.enabled} onChange={() => toggleSlot(s.id)} />
                    <span className="toggle-track" />
                  </label>
                </td>
                <td style={{ display: "flex", gap: "0.25rem" }}>
                  <button className="btn btn-ghost" style={{ fontSize: "0.75rem", padding: "0.2rem 0.4rem" }} onClick={() => openEdit(s)}>✏ Edit</button>
                  <button className="btn btn-ghost" style={{ fontSize: "0.75rem", padding: "0.2rem 0.4rem", color: "var(--red)" }} onClick={() => deleteSlot(s.id)}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal !== false && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-sheet" onClick={e => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "1rem" }}>
              <h3>{modal ? "Edit Slot" : "Add New Slot"}</h3>
              <button onClick={closeModal} style={{ background: "none", border: "none", fontSize: "1.2rem", cursor: "pointer" }}>✕</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <div>
                <label className="form-label">Time Range (e.g. 1:00 PM – 1:15 PM)</label>
                <input className="form-input" value={form.time} onChange={e => setForm(p => ({ ...p, time: e.target.value }))} placeholder="e.g. 2:00 PM – 2:15 PM" />
              </div>
              <div>
                <label className="form-label">Meal Type</label>
                <select className="form-input" value={form.type} onChange={e => setForm(p => ({ ...p, type: e.target.value as Slot["type"] }))}>
                  <option>Breakfast</option>
                  <option>Lunch</option>
                  <option>Snacks</option>
                  <option>Dinner</option>
                </select>
              </div>
              <div>
                <label className="form-label">Max Capacity (orders)</label>
                <input className="form-input" type="number" value={form.capacity} onChange={e => setForm(p => ({ ...p, capacity: e.target.value }))} placeholder="e.g. 25" />
              </div>
              <button className="btn btn-primary btn-full" onClick={saveModal} style={{ marginTop: "0.5rem" }}>
                {modal ? "Save Changes" : "Add Slot"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function VendorSalesView() {
  return (
    <div className="page-content">
      <div className="page-header"><h2>Sales & Earnings</h2></div>
      <div className="stats-row" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        <div className="stat-card"><div className="stat-num">₹0</div><div className="stat-label">Today</div></div>
        <div className="stat-card"><div className="stat-num">₹0</div><div className="stat-label">This Week</div></div>
        <div className="stat-card"><div className="stat-num">₹0</div><div className="stat-label">This Month</div></div>
      </div>
      <div className="empty-state" style={{ padding: "2rem", textAlign: "center", color: "var(--ink-3)" }}>
        <span className="empty-icon">📊</span>
        <h3>No sales yet</h3>
        <p>Sales will appear here once orders start coming in.</p>
      </div>
    </div>
  );
}

function VendorBinsView({ session, canteenId }: { session: Session | null; canteenId: string | null }) {
  // Physical bins are server-managed: provisioned by lib/binProvisioning when
  // slot_control.max_bins changes. This view is a *visualization* of the rack
  // grouped into the six color zones from the PDF (red / yellow / green /
  // blue / purple / orange) — not a CRUD form. To resize the rack the vendor
  // edits Max Bins in Slot Control, which auto-provisions/balances zones.
  type ApiBin = {
    id: string;
    bin_code: string;
    color: string | null;
    status: string | null;
    is_occupied: boolean;
    current_order_id: string | null;
    updated_at?: string;
  };
  type ApiOrder = {
    id: string;
    status: string;
    bin_id: string | null;
    pickup_slot?: string | null;
    profiles?: { name: string | null } | null;
    order_items?: Array<{ quantity: number; menu_items: { name: string; is_meal: boolean } | null }>;
  };

  const [bins, setBins] = useState<ApiBin[]>([]);
  const [orders, setOrders] = useState<ApiOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<{ bin: ApiBin; order: ApiOrder | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ZONES = ["red", "yellow", "green", "blue", "purple", "orange"] as const;
  const ZONE_LABEL: Record<string, string> = {
    red: "Red Zone", yellow: "Yellow Zone", green: "Green Zone",
    blue: "Blue Zone", purple: "Purple Zone", orange: "Orange Zone",
  };

  const refresh = useCallback(async () => {
    const token = session?.access_token;
    // canteenId is intentionally NOT required here — /api/canteen/live-orders
    // resolves the vendor's canteen server-side via authServer.ts (which
    // backfills profile.canteen_id when missing). Blocking on a possibly
    // stale client-side canteenId would leave the page stuck on "Loading
    // canteen…" indefinitely.
    if (!token) return;
    try {
      const res = await fetch("/api/canteen/live-orders", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error || `Failed to load bins (${res.status})`);
        return;
      }
      const j = await res.json();
      setBins(Array.isArray(j.bins) ? j.bins : []);
      setOrders(Array.isArray(j.orders) ? j.orders : []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, [session?.access_token]);

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 15_000);
    return () => clearInterval(t);
  }, [refresh]);

  const orderByBinId = useMemo(() => {
    const m = new Map<string, ApiOrder>();
    for (const o of orders) if (o.bin_id) m.set(o.bin_id, o);
    return m;
  }, [orders]);

  // Group bins by color zone, preserving numeric order within each zone.
  // ZONES is a module-level constant so it does not need to be in deps.
  const grouped = useMemo(() => {
    const g: Record<string, ApiBin[]> = {};
    for (const z of ZONES) g[z] = [];
    for (const b of bins) {
      const z = (b.color ?? "").toLowerCase();
      if (g[z]) g[z].push(b);
    }
    // Sort bins inside each zone by trailing number. Supports both new
    // canonical codes ("#RED001") and legacy codes ("RED-1").
    const num = (code: string) => {
      const m = code.match(/(\d+)\s*$/);
      return m ? Number(m[1]) : 0;
    };
    for (const z of ZONES) g[z].sort((a, b) => num(a.bin_code) - num(b.bin_code));
    return g;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bins]);



  const stats = useMemo(() => {
    const occupied = bins.filter(b => b.is_occupied).length;
    return { total: bins.length, occupied, free: bins.length - occupied };
  }, [bins]);

  // PDF page 14 bin states: Empty / Reserved / Occupied / Late Pickup.
  // - Empty:     bin has no order assigned
  // - Reserved:  order assigned, food still being prepared (worker hasn't placed)
  // - Occupied:  food is in the bin, awaiting customer pickup
  // - Late:      bin entered grace_bin / late_pickup state
  const tileStatus = (bin: ApiBin): "empty" | "reserved" | "occupied" | "late" => {
    if (bin.status === "late_pickup" || bin.status === "grace_bin") return "late";
    if (!bin.is_occupied) return "empty";
    const o = orderByBinId.get(bin.id);
    if (!o) return "reserved";
    if (o.status === "ready_for_pickup" || o.status === "placed_in_bin") return "occupied";
    return "reserved";
  };

  return (
    <div className="page-content">
      <div className="page-header">
        <h2>Bin Management</h2>
        <div style={{ fontSize: "0.78rem", color: "var(--ink-3)" }}>
          Adjust rack size via <strong>Slot Control → Max Bins</strong>
        </div>
      </div>

      <div className="stats-row" style={{ gridTemplateColumns: "repeat(3, 1fr)", marginBottom: "1rem" }}>
        <div className="stat-card"><div className="stat-num">{stats.total}</div><div className="stat-label">Total Bins</div></div>
        <div className="stat-card"><div className="stat-num" style={{ color: "var(--orange)" }}>{stats.occupied}</div><div className="stat-label">Occupied</div></div>
        <div className="stat-card"><div className="stat-num" style={{ color: "var(--green)" }}>{stats.free}</div><div className="stat-label">Free</div></div>
      </div>

      {error && (
        <div className="card" style={{ borderColor: "var(--red)", color: "var(--red)", marginBottom: "1rem" }}>
          {error}
        </div>
      )}

      {loading ? (
        <div className="card"><p style={{ color: "var(--ink-3)" }}>Loading bins…</p></div>
      ) : bins.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: "2rem" }}>
          <p style={{ fontWeight: 600, marginBottom: "0.4rem" }}>No bins provisioned yet.</p>
          <p style={{ fontSize: "0.82rem", color: "var(--ink-3)" }}>Open Slot Control and save Max Bins to provision the rack.</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
          {ZONES.map(zone => {
            const zoneBins = grouped[zone];
            if (!zoneBins.length) return null;
            const zoneOccupied = zoneBins.filter(b => b.is_occupied).length;
            return (
              <section key={zone} className={`bin-zone bin-zone-${zone}`}>
                <header className="bin-zone-header">
                  <span className={`bin-zone-swatch bin-zone-swatch-${zone}`} aria-hidden />
                  <h3>{ZONE_LABEL[zone]}</h3>
                  <span className="bin-zone-count">{zoneOccupied}/{zoneBins.length}</span>
                </header>
                <div className="bin-tile-grid">
                  {zoneBins.map(b => {
                    const st = tileStatus(b);
                    const order = orderByBinId.get(b.id) ?? null;
                    return (
                      <button
                        key={b.id}
                        type="button"
                        className={`bin-tile bin-tile-${zone} bin-tile-${st}`}
                        onClick={() => setSelected({ bin: b, order })}
                        title={`${b.bin_code} — ${st}`}
                      >
                        <span className="bin-tile-code">{b.bin_code}</span>
                        <span className="bin-tile-status">{st === "empty" ? "Empty" : st === "reserved" ? "Reserved" : st === "occupied" ? "Occupied" : "Late Pickup"}</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {selected && (
        <div className="modal-overlay" onClick={() => setSelected(null)}>
          <div className="modal-sheet" onClick={e => e.stopPropagation()} style={{ maxWidth: 380 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.8rem" }}>
              <h3>Bin {selected.bin.bin_code}</h3>
              <button onClick={() => setSelected(null)} style={{ background: "none", border: "none", fontSize: "1.2rem", cursor: "pointer", color: "var(--ink-3)" }}>✕</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", fontSize: "0.85rem" }}>
              <div><strong>Status:</strong> {selected.bin.is_occupied ? "Occupied" : "Empty"}</div>
              <div><strong>Zone:</strong> {selected.bin.color ?? "—"}</div>
              {selected.order ? (
                <>
                  <div><strong>Order:</strong> {selected.order.id.substring(0, 8).toUpperCase()}</div>
                  <div><strong>Customer:</strong> {selected.order.profiles?.name ?? "—"}</div>
                  <div><strong>Slot:</strong> {selected.order.pickup_slot ?? "—"}</div>
                  <div><strong>Stage:</strong> {selected.order.status}</div>
                  {selected.order.order_items && selected.order.order_items.length > 0 && (
                    <div>
                      <strong>Items:</strong>
                      <ul style={{ margin: "0.25rem 0 0 1rem", padding: 0 }}>
                        {selected.order.order_items.map((it, i) => (
                          <li key={i}>{it.menu_items?.name ?? "Item"} × {it.quantity}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              ) : selected.bin.is_occupied ? (
                <p style={{ color: "var(--ink-3)" }}>Bin marked occupied but no active order is linked. It will free automatically when collected.</p>
              ) : (
                <p style={{ color: "var(--ink-3)" }}>This bin is free and available for the next order.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function VendorLogsView() {
  const LOGS: { id: number; time: string; action: string; detail: string; actor: string; success: boolean }[] = [];
  const [filter, setFilter] = useState<"all" | "otp" | "menu" | "override">("all");

  const filtered = LOGS.filter(l => {
    if (filter === "otp") return l.action.toLowerCase().includes("otp");
    if (filter === "menu") return l.action.toLowerCase().includes("menu") || l.action.toLowerCase().includes("item");
    if (filter === "override") return l.action.toLowerCase().includes("override") || l.action.toLowerCase().includes("skip");
    return true;
  });

  return (
    <div className="page-content">
      <div className="page-header">
        <h2>Logs & Activity</h2>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {(["all", "otp", "menu", "override"] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)} className={`btn ${filter === f ? "btn-primary" : "btn-ghost"}`} style={{ fontSize: "0.78rem", padding: "0.3rem 0.6rem", textTransform: "capitalize" }}>{f === "override" ? "Overrides" : f.toUpperCase()}</button>
          ))}
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>TIME</th><th>ACTION</th><th>DETAIL</th><th>BY</th><th>RESULT</th></tr></thead>
          <tbody>
            {filtered.map(l => (
              <tr key={l.id}>
                <td style={{ fontSize: "0.78rem", color: "var(--ink-3)", whiteSpace: "nowrap" }}>{l.time}</td>
                <td><span className={`tag ${l.success ? "tag-blue" : "tag-orange"}`}>{l.action}</span></td>
                <td style={{ fontSize: "0.82rem", color: "var(--ink-2)" }}>{l.detail}</td>
                <td style={{ fontSize: "0.78rem", color: "var(--ink-3)" }}>{l.actor}</td>
                <td>{l.success ? <span style={{ color: "var(--green)", fontWeight: 700, fontSize: "0.8rem" }}>✓ OK</span> : <span style={{ color: "var(--red)", fontWeight: 700, fontSize: "0.8rem" }}>✗ Fail</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function VendorSettingsView({ canteenOpen, setCanteenOpen }: { canteenOpen: boolean; setCanteenOpen: (v: boolean) => void }) {
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [phone, setPhone] = useState("");
  const [saved, setSaved] = useState(false);

  // Operating hours — editable, stored in localStorage
  type HourRow = { day: string; opens: string; closes: string; active: boolean };
  const HOURS_KEY = "vendor_operating_hours";
  const DEFAULT_HOURS: HourRow[] = [
    { day: "Monday – Friday", opens: "", closes: "", active: false },
    { day: "Saturday",        opens: "", closes: "", active: false },
    { day: "Sunday",          opens: "", closes: "", active: false },
  ];
  const [hours, setHours] = useState<HourRow[]>(() => {
    if (typeof window === "undefined") return DEFAULT_HOURS;
    try { return JSON.parse(localStorage.getItem(HOURS_KEY) || "null") ?? DEFAULT_HOURS; }
    catch { return DEFAULT_HOURS; }
  });
  const [hoursSaved, setHoursSaved] = useState(false);

  const saveHours = () => {
    localStorage.setItem(HOURS_KEY, JSON.stringify(hours));
    setHoursSaved(true);
    setTimeout(() => setHoursSaved(false), 2000);
  };

  const save = () => { setSaved(true); setTimeout(() => setSaved(false), 2000); };

  // Format HH:MM to display as "7:30 AM"
  const fmt = (t: string) => {
    if (!t) return "—";
    const [hStr, mStr] = t.split(":");
    const h = parseInt(hStr, 10), m = parseInt(mStr, 10);
    const ampm = h < 12 ? "AM" : "PM";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${m.toString().padStart(2, "0")} ${ampm}`;
  };

  return (
    <div className="page-content">
      <div className="page-header"><h2>Settings</h2></div>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <h3 style={{ marginBottom: "1rem", fontSize: "0.9rem", fontWeight: 700 }}>Canteen Status</h3>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <label className="toggle-switch" style={{ transform: "scale(1.3)" }}>
            <input type="checkbox" checked={canteenOpen} onChange={() => setCanteenOpen(!canteenOpen)} />
            <span className="toggle-track" />
          </label>
          <div>
            <div style={{ fontWeight: 700, color: canteenOpen ? "var(--green)" : "var(--red)", fontSize: "1rem" }}>
              {canteenOpen ? "🟢 Canteen is OPEN" : "🔴 Canteen is CLOSED"}
            </div>
            <div style={{ fontSize: "0.78rem", color: "var(--ink-3)" }}>
              {canteenOpen ? "Users can browse and place orders" : "Orders are blocked for all users"}
            </div>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: "1rem" }}>
        <h3 style={{ marginBottom: "1rem", fontSize: "0.9rem", fontWeight: 700 }}>Canteen Profile</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <div>
            <label className="form-label">Canteen Name</label>
            <input className="form-input" value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div>
            <label className="form-label">Location / Block</label>
            <input className="form-input" value={location} onChange={e => setLocation(e.target.value)} />
          </div>
          <div>
            <label className="form-label">Contact Phone</label>
            <input className="form-input" value={phone} onChange={e => setPhone(e.target.value)} />
          </div>
          <button className="btn btn-primary" style={{ alignSelf: "flex-start", padding: "0.5rem 1.5rem" }} onClick={save}>
            {saved ? "✓ Saved!" : "Save Changes"}
          </button>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginBottom: "1rem", fontSize: "0.9rem", fontWeight: 700 }}>Operating Hours</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {hours.map((row, i) => (
            <div key={row.day} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: "0.5rem", alignItems: "center", padding: "0.5rem", background: "var(--surface-2)", borderRadius: 8 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: "0.82rem" }}>{row.day}</div>
                {row.active && <div style={{ fontSize: "0.72rem", color: "var(--ink-3)" }}>{fmt(row.opens)} – {fmt(row.closes)}</div>}
                {!row.active && <div style={{ fontSize: "0.72rem", color: "var(--red)" }}>Closed</div>}
              </div>
              <div>
                <label className="form-label" style={{ marginBottom: "0.2rem" }}>Opens</label>
                <input
                  className="form-input"
                  type="time"
                  value={row.opens}
                  disabled={!row.active}
                  onChange={e => setHours(prev => prev.map((r, j) => j === i ? { ...r, opens: e.target.value } : r))}
                  style={{ opacity: row.active ? 1 : 0.4 }}
                />
              </div>
              <div>
                <label className="form-label" style={{ marginBottom: "0.2rem" }}>Closes</label>
                <input
                  className="form-input"
                  type="time"
                  value={row.closes}
                  disabled={!row.active}
                  onChange={e => setHours(prev => prev.map((r, j) => j === i ? { ...r, closes: e.target.value } : r))}
                  style={{ opacity: row.active ? 1 : 0.4 }}
                />
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.25rem" }}>
                <label className="form-label" style={{ marginBottom: "0.2rem" }}>Open</label>
                <label className="toggle-switch" style={{ transform: "scale(1.05)" }}>
                  <input type="checkbox" checked={row.active} onChange={e => setHours(prev => prev.map((r, j) => j === i ? { ...r, active: e.target.checked } : r))} />
                  <span className="toggle-track" />
                </label>
              </div>
            </div>
          ))}
          <button className="btn btn-primary" style={{ alignSelf: "flex-start", padding: "0.5rem 1.5rem", marginTop: "0.25rem" }} onClick={saveHours}>
            {hoursSaved ? "✓ Saved!" : "Save Hours"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Vendor Support / Raise a Concern ─────────────────────────────────────────
interface VendorTicket {
  id: string; ticket_ref: string; category: string; subject: string;
  description: string; status: string; admin_notes: string | null; created_at: string;
}

function relativeTimeVendor(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000)    return "Just now";
  if (diff < 3600000)  return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function VendorSupportView() {
  const { session } = useAuth();
  const CATEGORIES = [
    { value: "payment_issue",   label: "💳 Payment / Settlement Issue", desc: "Settlement not received or incorrect amount" },
    { value: "order_not_found", label: "📦 Order Related Issue",        desc: "Order discrepancy or missing order" },
    { value: "otp_mismatch",    label: "🔑 OTP Verification Problem",   desc: "OTP not verifying correctly in system" },
    { value: "menu_issue",      label: "🍽️ Menu / Item Issue",           desc: "Menu items not saving or showing incorrectly" },
    { value: "app_bug",         label: "🐛 App / Dashboard Bug",        desc: "Dashboard malfunction or error" },
    { value: "other",           label: "💬 Other",                      desc: "Something else" },
  ];
  const STATUS_COLORS: Record<string, string> = {
    open: "#3b82f6", in_progress: "#f97316", escalated: "#ef4444",
    resolved: "#16a34a", closed: "#6b7280",
  };
  const STATUS_LABELS: Record<string, string> = {
    open: "Open", in_progress: "In Progress", escalated: "Escalated",
    resolved: "Resolved", closed: "Closed",
  };

  const [tab,        setTab]        = useState<"raise" | "track">("raise");
  const [category,   setCategory]   = useState("");
  const [subject,    setSubject]    = useState("");
  const [desc,       setDesc]       = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitErr,  setSubmitErr]  = useState<string | null>(null);
  const [submitted,  setSubmitted]  = useState<{ ticket_ref: string } | null>(null);
  const [tickets,    setTickets]    = useState<VendorTicket[]>([]);
  const [fetching,   setFetching]   = useState(false);
  const [selected,   setSelected]   = useState<VendorTicket | null>(null);

  const loadTickets = async () => {
    if (!session?.access_token) return;
    setFetching(true);
    try {
      const res = await fetch("/api/support", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const d = await res.json();
      if (res.ok) setTickets(d.tickets ?? []);
    } catch { /* ignore */ } finally { setFetching(false); }
  };

  useEffect(() => {
    if (tab === "track") void loadTickets();
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!category)        { setSubmitErr("Please select a category."); return; }
    if (!subject.trim())  { setSubmitErr("Please enter a subject."); return; }
    if (!desc.trim())     { setSubmitErr("Please describe the issue."); return; }
    if (!session?.access_token) { setSubmitErr("Not authenticated."); return; }
    setSubmitting(true); setSubmitErr(null);
    try {
      const res = await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ category, subject: subject.trim(), description: desc.trim() }),
      });
      const d = await res.json();
      if (!res.ok) { setSubmitErr(d.error ?? "Failed to submit."); return; }
      setSubmitted(d.ticket);
      setCategory(""); setSubject(""); setDesc("");
    } catch { setSubmitErr("Network error. Please try again."); } finally { setSubmitting(false); }
  }

  return (
    <div className="page-content">
      <div className="page-header">
        <h2>Raise a Concern</h2>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {(["raise", "track"] as const).map(t => (
            <button key={t} className={`btn ${tab === t ? "btn-primary" : "btn-ghost"}`}
              style={{ fontSize: "0.8rem" }} onClick={() => setTab(t)}>
              {t === "raise" ? "🆕 New Ticket" : `📋 My Tickets (${tickets.length})`}
            </button>
          ))}
        </div>
      </div>

      {tab === "raise" && (
        submitted ? (
          <div className="card" style={{ padding: "1.5rem", textAlign: "center", maxWidth: 480 }}>
            <div style={{ fontSize: "2.5rem", marginBottom: "0.5rem" }}>✅</div>
            <h3 style={{ fontWeight: 800, marginBottom: "0.5rem" }}>Ticket Submitted!</h3>
            <p style={{ color: "var(--ink-3)", marginBottom: "0.5rem" }}>
              Reference: <strong style={{ fontFamily: "monospace", color: "var(--orange)" }}>{submitted.ticket_ref}</strong>
            </p>
            <p style={{ fontSize: "0.85rem", color: "var(--ink-3)", marginBottom: "1rem" }}>
              Our admin team will review and respond within 24 hours.
            </p>
            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "center" }}>
              <button className="btn btn-primary" onClick={() => setSubmitted(null)}>Raise Another</button>
              <button className="btn btn-ghost" onClick={() => setTab("track")}>Track Tickets</button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={{ maxWidth: 540, display: "flex", flexDirection: "column", gap: "1.25rem" }}>
            <div>
              <label className="form-label" style={{ marginBottom: "0.6rem", display: "block" }}>Category *</label>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                {CATEGORIES.map(c => (
                  <label key={c.value} style={{
                    display: "flex", alignItems: "center", gap: "0.75rem",
                    border: `2px solid ${category === c.value ? "var(--orange)" : "var(--border)"}`,
                    borderRadius: 10, padding: "0.65rem 0.85rem", cursor: "pointer",
                    background: category === c.value ? "#fff7ed" : "var(--surface)",
                  }}>
                    <input type="radio" name="vendorcat" value={c.value} checked={category === c.value}
                      onChange={() => setCategory(c.value)} style={{ accentColor: "var(--orange)" }} />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: "0.88rem" }}>{c.label}</div>
                      <div style={{ fontSize: "0.74rem", color: "var(--ink-3)" }}>{c.desc}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="form-label">Subject *</label>
              <input type="text" className="form-input" value={subject} maxLength={200}
                onChange={e => setSubject(e.target.value)} placeholder="Brief summary of the issue" />
            </div>
            <div>
              <label className="form-label">Description *</label>
              <textarea className="form-input" rows={5} value={desc} maxLength={2000}
                onChange={e => setDesc(e.target.value)}
                placeholder="Describe the problem in detail — include date, timing, and what happened."
                style={{ resize: "vertical" }} />
              <div style={{ fontSize: "0.72rem", color: "var(--ink-3)", textAlign: "right", marginTop: "0.2rem" }}>{desc.length}/2000</div>
            </div>
            {submitErr && <div className="error-msg">{submitErr}</div>}
            <button type="submit" className="btn btn-primary" style={{ alignSelf: "flex-start", padding: "0.6rem 2rem" }} disabled={submitting}>
              {submitting ? "Submitting…" : "Submit Ticket"}
            </button>
          </form>
        )
      )}

      {tab === "track" && (
        <div>
          {fetching && <div style={{ color: "var(--ink-3)", padding: "1.5rem" }}>Loading…</div>}
          {!fetching && tickets.length === 0 && (
            <div className="empty-state">
              <span className="empty-icon">🎫</span>
              <h3>No tickets yet</h3>
              <p>Your submitted tickets will appear here.</p>
            </div>
          )}
          {!fetching && tickets.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>REF</th><th>SUBJECT</th><th>CATEGORY</th><th>STATUS</th><th>TIME</th><th></th></tr>
                </thead>
                <tbody>
                  {tickets.map(t => (
                    <tr key={t.id} style={{ cursor: "pointer" }} onClick={() => setSelected(t)}>
                      <td style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "var(--ink-3)" }}>{t.ticket_ref}</td>
                      <td style={{ fontWeight: 600, fontSize: "0.88rem" }}>{t.subject}</td>
                      <td style={{ fontSize: "0.78rem", color: "var(--ink-3)", textTransform: "capitalize" }}>{t.category.replace("_", " ")}</td>
                      <td>
                        <span style={{
                          fontSize: "0.72rem", fontWeight: 700, padding: "0.15rem 0.5rem", borderRadius: 20,
                          background: (STATUS_COLORS[t.status] ?? "#6b7280") + "18",
                          color: STATUS_COLORS[t.status] ?? "#6b7280",
                        }}>{STATUS_LABELS[t.status] ?? t.status}</span>
                      </td>
                      <td style={{ fontSize: "0.78rem", color: "var(--ink-3)" }}>{relativeTimeVendor(t.created_at)}</td>
                      <td style={{ fontSize: "0.78rem", color: "var(--blue)" }}>View →</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {selected && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 400, display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={e => { if (e.target === e.currentTarget) setSelected(null); }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: "1.5rem", width: 480, maxWidth: "90vw", maxHeight: "75vh", overflowY: "auto", boxShadow: "0 8px 40px rgba(0,0,0,0.2)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.75rem" }}>
              <span style={{ fontFamily: "monospace", fontSize: "0.78rem", color: "var(--ink-3)" }}>{selected.ticket_ref}</span>
              <button onClick={() => setSelected(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink-3)", fontSize: "1.2rem" }}>✕</button>
            </div>
            <h3 style={{ fontWeight: 800, fontSize: "1rem", marginBottom: "0.5rem" }}>{selected.subject}</h3>
            <div style={{ fontSize: "0.75rem", color: "var(--ink-3)", marginBottom: "0.75rem" }}>
              {selected.category.replace("_", " ")} · {relativeTimeVendor(selected.created_at)}
              <span style={{
                marginLeft: "0.5rem", fontWeight: 700, padding: "0.1rem 0.4rem", borderRadius: 10,
                background: (STATUS_COLORS[selected.status] ?? "#6b7280") + "18",
                color: STATUS_COLORS[selected.status] ?? "#6b7280",
              }}>{STATUS_LABELS[selected.status] ?? selected.status}</span>
            </div>
            <div style={{ background: "var(--surface)", borderRadius: 8, padding: "0.75rem", fontSize: "0.88rem", lineHeight: 1.6, marginBottom: "0.75rem" }}>
              {selected.description}
            </div>
            {selected.admin_notes && (
              <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 10, padding: "0.75rem", fontSize: "0.85rem", color: "#15803d" }}>
                <div style={{ fontWeight: 700, marginBottom: "0.25rem" }}>💬 Admin Response</div>
                {selected.admin_notes}
              </div>
            )}
            <button className="btn btn-ghost btn-full" style={{ marginTop: "1rem" }} onClick={() => setSelected(null)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Vendor Earnings View ─────────────────────────────────────────────────────
function VendorEarningsView({ session }: { session: { access_token: string } | null }) {
  const [periodStart, setPeriodStart] = useState<string>(() => new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10));
  const [periodEnd,   setPeriodEnd]   = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [data,        setData]        = useState<EarningsData | null>(null);
  const [loading,     setLoading]     = useState(false);
  const [err,         setErr]         = useState<string | null>(null);

  const fmt = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const load = async () => {
    if (!session?.access_token) return;
    setLoading(true); setErr(null);
    try {
      const res = await fetch(`/api/canteen/earnings?period_start=${periodStart}&period_end=${periodEnd}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error ?? "Failed to load"); return; }
      setData(d);
    } catch { setErr("Network error"); } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="page-content">
      <div className="page-header">
        <h2>💼 Earnings &amp; Payouts</h2>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
          <input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)}
            style={{ padding: "0.35rem 0.55rem", border: "1.5px solid var(--border)", borderRadius: 7, fontSize: "0.82rem" }} />
          <span style={{ fontSize: "0.8rem", color: "var(--ink-3)" }}>to</span>
          <input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)}
            style={{ padding: "0.35rem 0.55rem", border: "1.5px solid var(--border)", borderRadius: 7, fontSize: "0.82rem" }} />
          <button className="btn btn-ghost" style={{ fontSize: "0.8rem" }} onClick={load}>↻ Refresh</button>
        </div>
      </div>

      {loading && <div style={{ color: "var(--ink-3)", padding: "2rem", textAlign: "center" }}>Loading earnings…</div>}
      {!loading && err && <div className="error-msg">{err}</div>}

      {!loading && data && (
        <>
          {/* Platform fee info banner */}
          {data.platform_charges && (
            <div style={{ background: "#f0f7ff", border: "1px solid #cce0ff", borderRadius: 10, padding: "0.7rem 1rem", marginBottom: "1rem", fontSize: "0.8rem", color: "var(--blue)" }}>
              ℹ️ Current platform fee: {data.platform_charges.charge_pct}% + ₹{data.platform_charges.flat_charge} flat per order + {data.platform_charges.gst_pct}% GST on fee
            </div>
          )}

          {/* Summary cards */}
          <div className="dashboard-grid" style={{ marginBottom: "1.25rem" }}>
            {[
              { label: "Gross Collected",        value: fmt(data.summary.gross_collected),           color: "var(--ink)"    },
              { label: "Platform Fee Deducted",  value: `–${fmt(data.summary.total_platform_charges)}`, color: "var(--red)" },
              { label: "Net Earnings",           value: fmt(data.summary.net_earnings),               color: "var(--primary)", fw: 800 },
              { label: "Paid by Admin",          value: fmt(data.summary.total_paid_by_admin),        color: "var(--green)"  },
              { label: "Pending Payout",         value: fmt(data.summary.pending_payout),             color: data.summary.pending_payout > 0 ? "var(--orange)" : "var(--ink-3)" },
            ].map(c => (
              <div key={c.label} className="stat-card">
                <div className="stat-num" style={{ color: c.color, fontSize: "1.1rem", fontWeight: (c as { fw?: number }).fw ?? 600 }}>{c.value}</div>
                <div className="stat-label">{c.label}</div>
              </div>
            ))}
          </div>

          {/* Orders breakdown */}
          {data.orders && data.orders.length > 0 && (
            <div style={{ marginBottom: "1.5rem" }}>
              <h3 style={{ fontSize: "0.95rem", fontWeight: 700, marginBottom: "0.6rem" }}>Order Breakdown</h3>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>ORDER REF</th><th>DATE</th><th>AMOUNT</th><th>PLATFORM FEE</th><th>GST ON FEE</th><th>NET EARNED</th><th>STATUS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.orders.map((o: EarningsOrder) => (
                      <tr key={o.id}>
                        <td style={{ fontFamily: "monospace", fontSize: "0.75rem" }}>{o.id.slice(0, 8)}…</td>
                        <td style={{ fontSize: "0.78rem", color: "var(--ink-3)" }}>{new Date(o.created_at).toLocaleDateString("en-IN")}</td>
                        <td style={{ fontWeight: 600 }}>{fmt(o.gross)}</td>
                        <td style={{ color: "var(--red)", fontSize: "0.82rem" }}>{fmt(o.platform_fee)}</td>
                        <td style={{ color: "var(--ink-2)", fontSize: "0.82rem" }}>{fmt(o.gst_on_fee)}</td>
                        <td style={{ fontWeight: 700, color: "var(--green)" }}>{fmt(o.net_earnings)}</td>
                        <td><span className={`tag ${o.status === "completed" ? "tag-green" : o.status === "cancelled" ? "tag-red" : "tag-orange"}`} style={{ fontSize: "0.7rem" }}>{o.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Admin payment history */}
          {data.payment_history && data.payment_history.length > 0 && (
            <div>
              <h3 style={{ fontSize: "0.95rem", fontWeight: 700, marginBottom: "0.6rem" }}>Payments Received from Admin</h3>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>DATE</th><th>AMOUNT</th><th>MODE</th><th>REFERENCE</th><th>NOTES</th></tr></thead>
                  <tbody>
                    {data.payment_history.map((p: EarningsPayment) => (
                      <tr key={p.id}>
                        <td style={{ fontSize: "0.78rem" }}>{new Date(p.created_at).toLocaleDateString("en-IN")}</td>
                        <td style={{ fontWeight: 700, color: "var(--green)" }}>{fmt(p.amount_paid)}</td>
                        <td><span className="tag tag-blue" style={{ textTransform: "uppercase", fontSize: "0.7rem" }}>{p.payment_mode}</span></td>
                        <td style={{ fontSize: "0.75rem", fontFamily: "monospace", color: "var(--ink-3)" }}>{p.transaction_ref || "—"}</td>
                        <td style={{ fontSize: "0.75rem", color: "var(--ink-3)" }}>{p.notes || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {(!data.orders || data.orders.length === 0) && (!data.payment_history || data.payment_history.length === 0) && (
            <div style={{ textAlign: "center", color: "var(--ink-3)", padding: "3rem 1rem", fontSize: "0.9rem" }}>
              No earnings data for the selected period.
            </div>
          )}
        </>
      )}
    </div>
  );
}

interface EarningsData {
  canteen: { canteen_id: string; canteen_name: string };
  platform_charges: { charge_pct: number; flat_charge: number; gst_pct: number } | null;
  summary: { gross_collected: number; total_platform_charges: number; net_earnings: number; total_paid_by_admin: number; pending_payout: number };
  orders: EarningsOrder[];
  payment_history: EarningsPayment[];
  period_start: string; period_end: string;
}
interface EarningsOrder {
  id: string; created_at: string; gross: number; platform_fee: number;
  gst_on_fee: number; total_platform_charge: number; net_earnings: number; status: string;
}
interface EarningsPayment {
  id: string; amount_paid: number; payment_mode: string;
  transaction_ref: string | null; notes: string | null; created_at: string;
}
// Phase 3 vendor dashboard components — appended to page.tsx
// These rely on React hooks already imported at the top of page.tsx.

interface SlotControlState {
  canteen_id: string;
  max_bins: number;
  slot_duration_mins: number;
  morning_start: string; morning_end: string;
  afternoon_start: string; afternoon_end: string;
  evening_start: string; evening_end: string;
  grace_period_mins: number;
  extra_bin_fee_paise: number;
  meals_per_bin: number;
  snacks_per_bin: number;
  max_orders_per_slot: number;
  batched_prepared_cap: number;
  made_to_order_cap: number;
}
interface SlotControlResp {
  slot_control: SlotControlState;
  capacity: { maxBins: number; maxOrdersPerSlot: number; batchedPreparedCap: number; madeToOrderCap: number; bufferBins: number };
  windows: { morning: { start: string; end: string }[]; afternoon: { start: string; end: string }[]; evening: { start: string; end: string }[] };
}

function VendorSlotControlView({ session }: { session: { access_token: string } | null }) {
  const [data, setData] = useState<SlotControlResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [maxBinsInput, setMaxBinsInput] = useState<string>("");
  const [duration, setDuration] = useState<string>("15");
  const [saving, setSaving] = useState(false);
  const [morningStart, setMorningStart]     = useState("07:00");
  const [morningEnd, setMorningEnd]         = useState("11:00");
  const [afternoonStart, setAfternoonStart] = useState("11:30");
  const [afternoonEnd, setAfternoonEnd]     = useState("17:00");
  const [eveningStart, setEveningStart]     = useState("18:00");
  const [eveningEnd, setEveningEnd]         = useState("21:30");

  const load = useCallback(async () => {
    if (!session) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/canteen/slot-control", { headers: { Authorization: `Bearer ${session.access_token}` } });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Failed");
      setData(j); setMaxBinsInput(String(j.slot_control.max_bins));
      setDuration(String(j.slot_control.slot_duration_mins));
      setMorningStart(j.slot_control.morning_start.slice(0,5));
      setMorningEnd(j.slot_control.morning_end.slice(0,5));
      setAfternoonStart(j.slot_control.afternoon_start.slice(0,5));
      setAfternoonEnd(j.slot_control.afternoon_end.slice(0,5));
      setEveningStart(j.slot_control.evening_start.slice(0,5));
      setEveningEnd(j.slot_control.evening_end.slice(0,5));
    } catch (e) { setError(e instanceof Error ? e.message : "Error"); }
    finally { setLoading(false); }
  }, [session]);

  useEffect(() => { void load(); }, [load]);

  async function save() {
    if (!session) return;
    setSaving(true); setError(null);
    try {
      const res = await fetch("/api/canteen/slot-control", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          max_bins: Number(maxBinsInput),
          slot_duration_mins: Number(duration),
          morning_start:   morningStart   + ":00",
          morning_end:     morningEnd     + ":00",
          afternoon_start: afternoonStart + ":00",
          afternoon_end:   afternoonEnd   + ":00",
          evening_start:   eveningStart   + ":00",
          evening_end:     eveningEnd     + ":00",
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Save failed");
      setData(j);
    } catch (e) { setError(e instanceof Error ? e.message : "Error"); }
    finally { setSaving(false); }
  }

  if (loading) return <div className="page-content"><p>Loading slot control…</p></div>;
  if (!data) return <div className="page-content"><p style={{ color: "#dc2626" }}>{error ?? "No slot control row found for this canteen."}</p></div>;

  const sc = data.slot_control, cap = data.capacity, win = data.windows;
  const previewMaxOrders  = Math.floor((Number(maxBinsInput) || 0) * 0.75);
  const previewBatched    = Math.floor(previewMaxOrders * 0.7);
  const previewMadeToOrd  = previewMaxOrders - previewBatched;

  return (
    <div className="page-content">
      <div className="page-header">
        <h2>Slot Control</h2>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <span className="tag tag-gray" style={{ fontFamily: "monospace", fontSize: "0.75rem" }} title={`Canteen ID: ${sc.canteen_id}`}>
            Canteen ID: {sc.canteen_id.slice(0, 8)}…
          </span>
          <span className="tag tag-blue">Auto-derived caps</span>
        </div>
      </div>
      {error && <p style={{ color: "#dc2626", marginBottom: "0.5rem" }}>{error}</p>}

      <div className="dashboard-grid" style={{ marginBottom: "1.5rem" }}>
        <div className="stat-card"><div className="stat-num">{cap.maxBins}</div><div className="stat-label">Max bins (editable)</div></div>
        <div className="stat-card"><div className="stat-num" style={{ color: "var(--green)" }}>{cap.maxOrdersPerSlot}</div><div className="stat-label">Orders / slot (75%)</div></div>
        <div className="stat-card"><div className="stat-num" style={{ color: "var(--blue)" }}>{cap.batchedPreparedCap}</div><div className="stat-label">Batched cap (70%)</div></div>
        <div className="stat-card"><div className="stat-num" style={{ color: "var(--orange)" }}>{cap.madeToOrderCap}</div><div className="stat-label">Made-to-order cap (30%)</div></div>
        <div className="stat-card"><div className="stat-num" style={{ color: "#94a3b8" }}>{cap.bufferBins}</div><div className="stat-label">Buffer bins (25%)</div></div>
      </div>

      <div className="panel" style={{ marginBottom: "1.5rem" }}>
        <h3 style={{ marginTop: 0 }}>Adjust capacity</h3>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", alignItems: "flex-end" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
            <span style={{ fontSize: "0.78rem", fontWeight: 600 }}>Max bins</span>
            <input type="number" min={1} value={maxBinsInput} onChange={e => setMaxBinsInput(e.target.value)} style={{ padding: "0.55rem 0.75rem", border: "1px solid #cbd5e1", borderRadius: 8, width: 120 }} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
            <span style={{ fontSize: "0.78rem", fontWeight: 600 }}>Slot duration (min)</span>
            <select value={duration} onChange={e => setDuration(e.target.value)} style={{ padding: "0.55rem 0.75rem", border: "1px solid #cbd5e1", borderRadius: 8 }}>
              <option value="10">10</option><option value="15">15</option><option value="20">20</option>
            </select>
          </label>
          <button onClick={save} disabled={saving} style={{ background: "#f97316", color: "#fff", border: "none", borderRadius: 8, padding: "0.6rem 1.2rem", fontWeight: 700, cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.6 : 1 }}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
        <p style={{ fontSize: "0.78rem", color: "#64748b", marginTop: "0.85rem" }}>
          Caps update automatically: <strong>{previewMaxOrders}</strong> orders/slot,{" "}
          <strong>{previewBatched}</strong> batched, <strong>{previewMadeToOrd}</strong> made-to-order.
        </p>

        <div style={{ marginTop: "1.25rem", paddingTop: "1rem", borderTop: "1px solid #e5e7eb" }}>
          <h4 style={{ marginTop: 0, marginBottom: "0.6rem", fontSize: "0.92rem" }}>Service windows</h4>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0.85rem" }}>
            {[
              { label: "Morning",   from: morningStart,   setFrom: setMorningStart,   to: morningEnd,   setTo: setMorningEnd },
              { label: "Afternoon", from: afternoonStart, setFrom: setAfternoonStart, to: afternoonEnd, setTo: setAfternoonEnd },
              { label: "Evening",   from: eveningStart,   setFrom: setEveningStart,   to: eveningEnd,   setTo: setEveningEnd },
            ].map(w => (
              <div key={w.label} style={{ background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 8, padding: "0.6rem 0.75rem" }}>
                <div style={{ fontSize: "0.78rem", fontWeight: 700, marginBottom: "0.4rem", color: "#0f172a" }}>{w.label} slot</div>
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                  <input type="time" value={w.from} onChange={e => w.setFrom(e.target.value)} style={{ padding: "0.4rem 0.5rem", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: "0.85rem", flex: 1 }} />
                  <span style={{ color: "#64748b", fontSize: "0.8rem" }}>to</span>
                  <input type="time" value={w.to} onChange={e => w.setTo(e.target.value)} style={{ padding: "0.4rem 0.5rem", border: "1px solid #cbd5e1", borderRadius: 6, fontSize: "0.85rem", flex: 1 }} />
                </div>
              </div>
            ))}
          </div>
          <p style={{ fontSize: "0.74rem", color: "#64748b", marginTop: "0.6rem", marginBottom: 0 }}>
            💡 Time slots are auto-generated from these windows + slot duration. Click <strong>Save</strong> to apply.
          </p>
        </div>
      </div>

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Generated time slots</h3>
        {(["morning", "afternoon", "evening"] as const).map(period => {
          const slots = win[period];
          const range =
            period === "morning"   ? `${sc.morning_start.slice(0,5)} – ${sc.morning_end.slice(0,5)}` :
            period === "afternoon" ? `${sc.afternoon_start.slice(0,5)} – ${sc.afternoon_end.slice(0,5)}` :
                                     `${sc.evening_start.slice(0,5)} – ${sc.evening_end.slice(0,5)}`;
          return (
            <div key={period} style={{ marginBottom: "1rem" }}>
              <h4 style={{ textTransform: "capitalize", marginBottom: "0.4rem" }}>{period} ({range}) — {slots.length} slots</h4>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                {slots.map((s, i) => (
                  <span key={i} style={{ background: "#f1f5f9", padding: "0.3rem 0.55rem", borderRadius: 6, fontSize: "0.78rem", fontFamily: "monospace" }}>
                    {s.start}–{s.end}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface PrepSummaryItem { name: string; quantity: number; availabilityType: string; isMeal: boolean }
interface PrepSummarySlot { slot: string; batched: PrepSummaryItem[]; made_to_order: PrepSummaryItem[] }
interface PrepSummaryResp {
  slots: PrepSummarySlot[];
  caps: { batched_prepared_cap: number; made_to_order_cap: number; max_orders_per_slot: number; max_bins: number } | null;
  canteen_id?: string;
}

function VendorPrepSummaryView({ session }: { session: { access_token: string } | null }) {
  const [data, setData] = useState<PrepSummaryResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeSlot, setActiveSlot] = useState<string>("all");

  const load = useCallback(async () => {
    if (!session) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/canteen/prep-summary", { headers: { Authorization: `Bearer ${session.access_token}` } });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || "Failed");
      setData(j);
    } catch (e) { setError(e instanceof Error ? e.message : "Error"); }
    finally { setLoading(false); }
  }, [session]);

  useEffect(() => { void load(); const iv = setInterval(load, 30000); return () => clearInterval(iv); }, [load]);

  if (loading) return <div className="page-content"><p>Loading prep summary…</p></div>;
  if (error)   return <div className="page-content"><p style={{ color: "#dc2626" }}>{error}</p></div>;
  if (!data || data.slots.length === 0) {
    // Empty state still shows the slot selector pill per the revised PDF mock
    // ("1:00pm to 1:15pm ▼") so the manager can navigate slots even before any
    // orders arrive in this slot. The dropdown is populated from the time_slots
    // table via the prep-summary endpoint once orders exist.
    return (
      <div className="page-content">
        <div className="page-header">
          <h2>Prep Summary</h2>
          <button onClick={load} className="tag tag-blue" style={{ cursor: "pointer", border: "none" }}>↻ Refresh</button>
        </div>
        <div style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", padding: "0.55rem 1rem", border: "1.5px solid var(--orange)", borderRadius: 999, background: "#fff7ed", color: "var(--orange-dark)", fontWeight: 700, fontSize: "0.9rem" }}>
          <span>No active slot</span>
          <span>▾</span>
        </div>
        <p style={{ marginTop: "1rem", fontSize: "0.85rem", color: "var(--ink-3)" }}>
          No orders yet for any active slot. Once students place orders, this view will list what to prepare per slot.
        </p>
      </div>
    );
  }

  return (
    <div className="page-content">
      <div className="page-header">
        <h2>Prep Summary</h2>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
          {data.canteen_id && (
            <span className="tag tag-gray" style={{ fontFamily: "monospace", fontSize: "0.75rem" }} title={`Canteen ID: ${data.canteen_id}`}>
              Canteen ID: {data.canteen_id.slice(0, 8)}…
            </span>
          )}
          {data.slots.length > 1 && (
            <select
              value={activeSlot}
              onChange={e => setActiveSlot(e.target.value)}
              style={{ padding: "0.4rem 0.6rem", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: "0.82rem", fontWeight: 600, background: "#fff7ed", color: "var(--orange-dark)" }}
              title="Filter by slot"
            >
              <option value="all">All slots</option>
              {data.slots.map(s => <option key={s.slot} value={s.slot}>{s.slot}</option>)}
            </select>
          )}
          <button onClick={load} className="tag tag-blue" style={{ cursor: "pointer", border: "none" }}>↻ Refresh</button>
        </div>
      </div>
      {data.caps && (
        <p style={{ fontSize: "0.82rem", color: "#64748b", marginBottom: "1rem" }}>
          Caps: <strong>{data.caps.batched_prepared_cap}</strong> batched · <strong>{data.caps.made_to_order_cap}</strong> made-to-order · <strong>{data.caps.max_orders_per_slot}</strong> total per slot
        </p>
      )}
      {(activeSlot === "all" ? data.slots : data.slots.filter(s => s.slot === activeSlot)).map(slot => (
        <div key={slot.slot} className="panel" style={{ marginBottom: "1.25rem" }}>
          <h3 style={{ marginTop: 0 }}>Slot: {slot.slot}</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <PrepBucket title="Batched / Prepared" color="#3b82f6" items={slot.batched} />
            <PrepBucket title="Made to Order"      color="#f97316" items={slot.made_to_order} />
          </div>
        </div>
      ))}
    </div>
  );
}

function PrepBucket({ title, color, items }: { title: string; color: string; items: PrepSummaryItem[] }) {
  const total = items.reduce((s, i) => s + i.quantity, 0);
  return (
    <div style={{ border: `1px solid ${color}30`, borderRadius: 10, padding: "0.75rem 1rem", background: `${color}08` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.6rem" }}>
        <strong style={{ color }}>{title}</strong>
        <span style={{ fontSize: "0.78rem", color: "#64748b" }}>{total} items</span>
      </div>
      {items.length === 0 && <p style={{ fontSize: "0.82rem", color: "#94a3b8", margin: 0 }}>—</p>}
      {items.map((it, i) => (
        <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "0.3rem 0", borderBottom: i < items.length - 1 ? "1px solid #e2e8f0" : "none", fontSize: "0.88rem" }}>
          <span>{it.name} {it.isMeal && <span style={{ background: "#fef3c7", color: "#92400e", padding: "0.05rem 0.4rem", borderRadius: 4, fontSize: "0.68rem", marginLeft: "0.3rem" }}>MEAL</span>}</span>
          <strong>{it.quantity}</strong>
        </div>
      ))}
    </div>
  );
}

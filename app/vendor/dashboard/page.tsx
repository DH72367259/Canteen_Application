"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import type { CanteenOrder } from "@/types/canteen";

type BinStatus = "preparing" | "completed" | "delayed" | "empty";

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
}



const NAV_ITEMS = [
  { id: "live", icon: "📊", label: "Live Orders" },
  { id: "menu", icon: "🍽️", label: "Menu & Items" },
  { id: "slots", icon: "🕐", label: "Time Slots" },
  { id: "bins", icon: "📦", label: "Bin Management" },
  { id: "sales", icon: "💰", label: "Sales" },
  { id: "logs", icon: "📋", label: "Logs" },
  { id: "settings", icon: "⚙️", label: "Settings" },
];

export default function VendorDashboard() {
  const router = useRouter();
  const { user, logout, session } = useAuth();
  const [activeNav, setActiveNav] = useState("live");
  const [activeSlot, setActiveSlot] = useState("all");
  const [bins, setBins] = useState<Bin[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [selectedBin, setSelectedBin] = useState<Bin | null>(null);
  const [slotsConfigured, setSlotsConfigured] = useState(false);
  const [otpInput, setOtpInput] = useState("");
  const [otpError, setOtpError] = useState<string | null>(null);
  const [otpSuccess, setOtpSuccess] = useState(false);
  const [canteenOpen, setCanteenOpen] = useState(true);
  const [toggleBusy, setToggleBusy] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const refreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Redirect if not vendor/canteen_admin
  useEffect(() => {
    if (user && user.role !== "vendor" && user.role !== "canteen_admin") {
      router.push("/login");
    }
  }, [user, router]);

  // Load slots-configured flag from localStorage
  useEffect(() => {
    if (typeof window !== "undefined") {
      setSlotsConfigured(localStorage.getItem("vendor_slots_configured") === "true");
    }
  }, []);

  const handleToggleCanteen = async () => {
    if (toggleBusy) return;
    // Gate: cannot turn ON unless slots have been configured (check localStorage fresh)
    const next = !canteenOpen;
    const configured = typeof window !== "undefined" && localStorage.getItem("vendor_slots_configured") === "true";
    if (next && !configured) {
      setToggleError("Please configure and save your time slots first (Time Slots → Save Configuration).");
      return;
    }
    setSlotsConfigured(configured);
    setToggleBusy(true);
    setToggleError(null);
    // Optimistic update
    setCanteenOpen(next);
    try {
      // user.canteenId is the canteen this vendor belongs to.
      // Falls back to a placeholder if not yet wired to Supabase.
      const canteenId = (user as { canteenId?: string })?.canteenId || "demo";
      const session = typeof window !== "undefined"
        ? JSON.parse(localStorage.getItem("supabase.auth.token") || "{}")?.currentSession?.access_token
        : null;
      if (canteenId !== "demo" && session) {
        const res = await fetch(`/api/canteens/${canteenId}/toggle`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session}` },
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
          : o.rawStatus === "placed" || o.rawStatus === "confirmed" || o.rawStatus === "preparing"
            ? "preparing"
            : "empty",
        orderId: o.id.substring(0, 8).toUpperCase(),
        customerName: o.customerName || "Customer",
        slot: o.slotLabel ?? o.slotName ?? null,
        items: o.items.map((i) => `${i.name} ×${i.quantity}`).join(", ") || null,
        otp: o.otp ?? null,
        binLabel: o.binLabel ?? null,
        binColor: o.binColor ?? null,
        rawOrderId: o.id,
      }));
      // Fill remaining slots as empty bins
      const maxBin = 8;
      const usedNumbers = new Set(mapped.map((b) => b.number));
      for (let n = 1; n <= maxBin; n++) {
        if (!usedNumbers.has(n)) {
          mapped.push({ id: `empty-${n}`, number: n, status: "empty", orderId: null, customerName: null, slot: null, items: null, otp: null });
        }
      }
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

  // Auto-refresh every 5 seconds
  useEffect(() => {
    fetchOrders();
    refreshRef.current = setInterval(fetchOrders, 5_000);
    return () => { if (refreshRef.current) clearInterval(refreshRef.current); };
  }, [fetchOrders]);

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

  const handleLogout = async () => { await logout(); router.push("/login"); };

  const slotBins = activeSlot === "all"
    ? bins
    : bins.filter(b => !b.slot || b.slot === activeSlot || b.status === "empty");

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
          <p>{user?.displayName || "Central Canteen"}</p>
        </div>

        <nav className="sidebar-nav">
          {NAV_ITEMS.map(item => (
            <button
              key={item.id}
              className={`sidebar-link ${activeNav === item.id ? "active" : ""}`}
              onClick={() => setActiveNav(item.id)}
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
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span style={{ fontSize: "0.78rem", color: "var(--ink-3)", fontWeight: 600 }}>Canteen</span>
              {toggleError && <span style={{ fontSize: "0.72rem", color: "var(--red)", maxWidth: 180 }}>{toggleError}</span>}
              <label className="toggle-switch" title={!slotsConfigured && !canteenOpen ? "Save slot configuration first before turning ON" : canteenOpen ? "Canteen is OPEN – click to close" : "Canteen is CLOSED – click to open"} style={{ opacity: toggleBusy ? 0.6 : 1 }}>
                <input type="checkbox" checked={canteenOpen} disabled={toggleBusy} onChange={handleToggleCanteen} />
                <span className="toggle-track" />
              </label>
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

            {/* Slot tabs */}
            <div className="slot-tabs">
              <button
                className={`slot-tab ${activeSlot === "all" ? "active" : ""}`}
                onClick={() => setActiveSlot("all")}
              >
                All Bins
              </button>
              {uniqueSlots.map(s => (
                <button
                  key={s}
                  className={`slot-tab ${activeSlot === s ? "active" : ""}`}
                  onClick={() => setActiveSlot(s)}
                >
                  {s}
                </button>
              ))}
            </div>

            {/* Legend */}
            <div style={{ padding: "0.5rem 1rem 0", display: "flex", gap: "1rem", fontSize: "0.75rem", color: "var(--ink-3)" }}>
              <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: "var(--yellow)", marginRight: 4 }} />Preparing</span>
              <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: "var(--green)", marginRight: 4 }} />Completed</span>
              <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: "var(--red)", marginRight: 4 }} />Delayed</span>
              <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: "var(--border)", marginRight: 4 }} />Empty</span>
            </div>

            {/* Bin grid */}
            {ordersLoading ? (
              <div style={{ padding: "2rem", textAlign: "center", color: "var(--ink-3)" }}>Loading live orders…</div>
            ) : (
            <div className="bin-grid">
              {slotBins.map(bin => (
                <div
                  key={bin.id}
                  className={`bin-card ${bin.status}`}
                  onClick={() => handleBinClick(bin)}
                >
                  <div className="bin-number">
                    {bin.status !== "empty" && <span className="bin-status-dot" />}
                    Bin #{bin.number}
                  </div>
                  {bin.orderId ? (
                    <>
                      <div className="bin-order-id">{bin.orderId}</div>
                      <div className="bin-customer">{bin.customerName}</div>
                      <div className="bin-slot">{bin.slot} · {bin.items}</div>
                      {bin.status === "preparing" && bin.rawOrderId && (
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
                    <div style={{ fontSize: "0.78rem", color: "var(--ink-3)", marginTop: "0.25rem" }}>Empty · Available</div>
                  )}
                </div>
              ))}
            </div>
            )}
          </>
        )}

        {activeNav === "menu" && <VendorMenuView />}
        {activeNav === "slots" && <VendorSlotsView />}
        {activeNav === "sales" && <VendorSalesView />}
        {activeNav === "bins" && <VendorBinsView bins={bins} setBins={setBins} />}
        {activeNav === "logs" && <VendorLogsView />}
        {activeNav === "settings" && <VendorSettingsView canteenOpen={canteenOpen} setCanteenOpen={setCanteenOpen} />}
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

function VendorMenuView() {
  type MealType = "breakfast" | "lunch" | "dinner";
  type Item = { id: string; name: string; price: number; maxPerSlot: number; enabled: boolean };
  const [meal, setMeal] = useState<MealType>("lunch");
  const [items, setItems] = useState<Record<MealType, Item[]>>({
    breakfast: [
      { id: "b1", name: "Poha", price: 30, maxPerSlot: 20, enabled: true },
      { id: "b2", name: "Idli Sambhar", price: 45, maxPerSlot: 25, enabled: true },
      { id: "b3", name: "Paratha + Curd", price: 55, maxPerSlot: 15, enabled: false },
      { id: "b4", name: "Tea / Coffee", price: 15, maxPerSlot: 50, enabled: true },
    ],
    lunch: [
      { id: "l1", name: "Veg Thali", price: 90, maxPerSlot: 30, enabled: true },
      { id: "l2", name: "Paneer Butter Masala", price: 75, maxPerSlot: 20, enabled: true },
      { id: "l3", name: "Roti (2 pcs)", price: 20, maxPerSlot: 60, enabled: true },
      { id: "l4", name: "Chicken Curry", price: 110, maxPerSlot: 15, enabled: true },
      { id: "l5", name: "Lassi Sweet", price: 35, maxPerSlot: 25, enabled: false },
    ],
    dinner: [
      { id: "d1", name: "Dinner Thali", price: 80, maxPerSlot: 25, enabled: true },
      { id: "d2", name: "Khichdi", price: 55, maxPerSlot: 20, enabled: true },
      { id: "d3", name: "Egg Curry", price: 65, maxPerSlot: 12, enabled: false },
    ],
  });

  const [modal, setModal] = useState<{ item: Item | null } | null>(null);
  const [form, setForm] = useState({ name: "", price: "", maxPerSlot: "" });

  const toggleItem = (id: string) => {
    setItems(prev => ({ ...prev, [meal]: prev[meal].map(item => item.id === id ? { ...item, enabled: !item.enabled } : item) }));
  };

  const openEdit = (item: Item) => {
    setModal({ item });
    setForm({ name: item.name, price: String(item.price), maxPerSlot: String(item.maxPerSlot) });
  };

  const openAdd = () => {
    setModal({ item: null });
    setForm({ name: "", price: "", maxPerSlot: "" });
  };

  const saveModal = () => {
    if (!form.name.trim()) return;
    const newItem: Item = {
      id: modal?.item?.id ?? `${meal[0]}${Date.now()}`,
      name: form.name,
      price: Number(form.price) || 0,
      maxPerSlot: Number(form.maxPerSlot) || 10,
      enabled: modal?.item?.enabled ?? true,
    };
    if (modal?.item) {
      setItems(prev => ({ ...prev, [meal]: prev[meal].map(i => i.id === newItem.id ? newItem : i) }));
    } else {
      setItems(prev => ({ ...prev, [meal]: [...prev[meal], newItem] }));
    }
    setModal(null);
  };

  const removeItem = (id: string) => {
    setItems(prev => ({ ...prev, [meal]: prev[meal].filter(i => i.id !== id) }));
  };

  return (
    <div className="page-content">
      <div className="page-header">
        <h2>Menu & Items</h2>
        <button className="btn btn-primary" style={{ fontSize: "0.85rem", padding: "0.5rem 1rem" }} onClick={openAdd}>+ Add Item</button>
      </div>

      <div className="meal-tabs" style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden", marginBottom: "1rem" }}>
        {(["breakfast", "lunch", "dinner"] as const).map(m => (
          <button key={m} className={`meal-tab ${meal === m ? "active" : ""}`} onClick={() => setMeal(m)} style={{ flex: 1 }}>
            {m === "breakfast" ? "🌅 Breakfast" : m === "lunch" ? "☀️ Lunch" : "🌙 Dinner"}
          </button>
        ))}
      </div>

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {items[meal].length === 0 && (
          <div className="empty-state" style={{ padding: "2rem" }}>
            <span className="empty-icon">🍽️</span>
            <h3>No items for {meal}</h3>
            <p>Add your first item using the button above</p>
          </div>
        )}
        {items[meal].map((item, i) => (
          <div key={item.id} style={{ padding: "0.85rem 1rem", borderBottom: i < items[meal].length - 1 ? "1px solid var(--border)" : "none", display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>{item.name}</div>
              <div style={{ fontSize: "0.78rem", color: "var(--ink-3)" }}>₹{item.price} · Max {item.maxPerSlot}/slot</div>
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
          <div className="modal-sheet" onClick={e => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "1rem" }}>
              <h3>{modal.item ? "Edit Item" : "Add New Item"}</h3>
              <button onClick={() => setModal(null)} style={{ background: "none", border: "none", fontSize: "1.2rem", cursor: "pointer" }}>✕</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <div>
                <label className="form-label">Item Name</label>
                <input className="form-input" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Chicken Curry" />
              </div>
              <div>
                <label className="form-label">Price (₹)</label>
                <input className="form-input" type="number" value={form.price} onChange={e => setForm(p => ({ ...p, price: e.target.value }))} placeholder="e.g. 85" />
              </div>
              <div>
                <label className="form-label">Max orders per slot</label>
                <input className="form-input" type="number" value={form.maxPerSlot} onChange={e => setForm(p => ({ ...p, maxPerSlot: e.target.value }))} placeholder="e.g. 20" />
              </div>
              <p style={{ fontSize: "0.78rem", color: "var(--ink-3)" }}>Meal: <strong style={{ textTransform: "capitalize" }}>{meal}</strong> (change meal tab before adding)</p>
              <button className="btn btn-primary btn-full" onClick={saveModal} style={{ marginTop: "0.5rem" }}>
                {modal.item ? "Save Changes" : "Add Item"}
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
  const INIT: Slot[] = [
    { id: "s1", time: "8:00 AM – 8:30 AM",    type: "Breakfast", capacity: 20, booked: 12, enabled: true },
    { id: "s2", time: "12:30 PM – 12:45 PM",  type: "Lunch",     capacity: 30, booked: 28, enabled: true },
    { id: "s3", time: "1:00 PM – 1:15 PM",    type: "Lunch",     capacity: 30, booked: 18, enabled: true },
    { id: "s4", time: "1:30 PM – 1:45 PM",    type: "Lunch",     capacity: 25, booked: 6,  enabled: true },
    { id: "s5", time: "8:00 PM – 8:15 PM",    type: "Dinner",    capacity: 20, booked: 0,  enabled: false },
  ];
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
        <div className="stat-card"><div className="stat-num">₹3,240</div><div className="stat-label">Today</div></div>
        <div className="stat-card"><div className="stat-num">₹21,680</div><div className="stat-label">This Week</div></div>
        <div className="stat-card"><div className="stat-num">₹86,400</div><div className="stat-label">This Month</div></div>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>DATE</th><th>ORDERS</th><th>REVENUE</th><th>AVG ORDER</th></tr></thead>
          <tbody>
            {[
              { date: "Today", orders: 42, revenue: "₹3,240", avg: "₹77" },
              { date: "Yesterday", orders: 38, revenue: "₹2,940", avg: "₹77" },
              { date: "Mon", orders: 45, revenue: "₹3,510", avg: "₹78" },
              { date: "Sun", orders: 22, revenue: "₹1,760", avg: "₹80" },
              { date: "Sat", orders: 29, revenue: "₹2,260", avg: "₹78" },
            ].map(r => (
              <tr key={r.date}>
                <td>{r.date}</td>
                <td>{r.orders}</td>
                <td style={{ fontWeight: 700 }}>{r.revenue}</td>
                <td style={{ color: "var(--ink-3)" }}>{r.avg}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function VendorBinsView({ bins, setBins }: { bins: Bin[]; setBins: React.Dispatch<React.SetStateAction<Bin[]>> }) {
  const [adding, setAdding] = useState(false);
  const [newBinNum, setNewBinNum] = useState("");

  const addBin = () => {
    const num = parseInt(newBinNum);
    if (!num || bins.some(b => b.number === num)) return;
    setBins(prev => [...prev, { id: `b${Date.now()}`, number: num, status: "empty", orderId: null, customerName: null, slot: null, items: null, otp: null }]);
    setAdding(false);
    setNewBinNum("");
  };

  const clearBin = (id: string) => setBins(prev => prev.map(b => b.id === id ? { ...b, status: "empty", orderId: null, customerName: null, slot: null, items: null, otp: null } : b));
  const removeBin = (id: string) => setBins(prev => prev.filter(b => b.id !== id));

  const statusColor: Record<BinStatus, string> = { preparing: "var(--yellow)", completed: "var(--green)", delayed: "var(--red)", empty: "var(--border)" };

  return (
    <div className="page-content">
      <div className="page-header">
        <h2>Bin Management</h2>
        <button className="btn btn-primary" style={{ fontSize: "0.85rem", padding: "0.5rem 1rem" }} onClick={() => setAdding(true)}>+ Add Bin</button>
      </div>

      <div className="stats-row" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginBottom: "1rem" }}>
        {(["empty", "preparing", "completed", "delayed"] as BinStatus[]).map(s => (
          <div key={s} className="stat-card">
            <div className="stat-num" style={{ color: statusColor[s] }}>{bins.filter(b => b.status === s).length}</div>
            <div className="stat-label" style={{ textTransform: "capitalize" }}>{s}</div>
          </div>
        ))}
      </div>

      <div className="table-wrap">
        <table>
          <thead><tr><th>BIN #</th><th>STATUS</th><th>ORDER</th><th>CUSTOMER</th><th>SLOT</th><th>ITEMS</th><th>ACTIONS</th></tr></thead>
          <tbody>
            {bins.sort((a, b) => a.number - b.number).map(bin => (
              <tr key={bin.id}>
                <td style={{ fontWeight: 700, fontSize: "1rem" }}>#{bin.number}</td>
                <td>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem", fontSize: "0.82rem", fontWeight: 600 }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: statusColor[bin.status], display: "inline-block" }} />
                    <span style={{ textTransform: "capitalize" }}>{bin.status}</span>
                  </span>
                </td>
                <td style={{ fontSize: "0.82rem", fontFamily: "monospace" }}>{bin.orderId || "—"}</td>
                <td style={{ fontSize: "0.82rem" }}>{bin.customerName || "—"}</td>
                <td style={{ fontSize: "0.82rem", color: "var(--ink-3)" }}>{bin.slot || "—"}</td>
                <td style={{ fontSize: "0.78rem", color: "var(--ink-3)", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{bin.items || "—"}</td>
                <td style={{ display: "flex", gap: "0.25rem" }}>
                  {bin.status !== "empty" && (
                    <button className="btn btn-ghost" style={{ fontSize: "0.72rem", padding: "0.2rem 0.4rem", color: "var(--orange)" }} onClick={() => clearBin(bin.id)}>Clear</button>
                  )}
                  <button className="btn btn-ghost" style={{ fontSize: "0.72rem", padding: "0.2rem 0.4rem", color: "var(--red)" }} onClick={() => removeBin(bin.id)}>Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {adding && (
        <div className="modal-overlay" onClick={() => setAdding(false)}>
          <div className="modal-sheet" onClick={e => e.stopPropagation()} style={{ maxWidth: 300 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "1rem" }}>
              <h3>Add New Bin</h3>
              <button onClick={() => setAdding(false)} style={{ background: "none", border: "none", fontSize: "1.2rem", cursor: "pointer" }}>✕</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <div>
                <label className="form-label">Bin Number</label>
                <input className="form-input" type="number" value={newBinNum} onChange={e => setNewBinNum(e.target.value)} placeholder="e.g. 9" autoFocus />
              </div>
              <button className="btn btn-primary btn-full" onClick={addBin}>Add Bin</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function VendorLogsView() {
  const LOGS = [
    { id: 1, time: "1:05 PM", action: "OTP Verified", detail: "Bin #3 · ORD-104 · Rajan M. · OTP: 4291", actor: "Staff", success: true },
    { id: 2, time: "12:58 PM", action: "Item Hidden", detail: "Chicken Curry hidden from Lunch menu", actor: "Manager", success: true },
    { id: 3, time: "12:45 PM", action: "OTP Failed", detail: "Bin #1 · ORD-103 · Ananya S. · Wrong OTP attempt", actor: "Staff", success: false },
    { id: 4, time: "12:30 PM", action: "Slot Opened", detail: "1:30 PM Lunch slot opened – capacity 25", actor: "Manager", success: true },
    { id: 5, time: "12:15 PM", action: "Manual Override", detail: "Bin #4 → marked Completed (staff override)", actor: "Manager", success: true },
    { id: 6, time: "11:50 AM", action: "Order Skipped", detail: "ORD-099 · Dev P. · No-show after 20 min", actor: "System", success: false },
    { id: 7, time: "11:30 AM", action: "Menu Updated", detail: "Poha price changed ₹25 → ₹30", actor: "Manager", success: true },
    { id: 8, time: "10:00 AM", action: "Canteen Opened", detail: "Canteen status set to OPEN for the day", actor: "Manager", success: true },
  ];
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
  const [name, setName] = useState("Central Canteen");
  const [location, setLocation] = useState("Block A, Ground Floor");
  const [phone, setPhone] = useState("+91 90000 00000");
  const [saved, setSaved] = useState(false);

  const save = () => { setSaved(true); setTimeout(() => setSaved(false), 2000); };

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
        <div className="table-wrap">
          <table>
            <thead><tr><th>DAY</th><th>OPENS</th><th>CLOSES</th><th>STATUS</th></tr></thead>
            <tbody>
              {[
                { day: "Monday – Friday", opens: "7:30 AM", closes: "9:00 PM", active: true },
                { day: "Saturday",        opens: "8:00 AM", closes: "5:00 PM", active: true },
                { day: "Sunday",          opens: "—",       closes: "—",       active: false },
              ].map(r => (
                <tr key={r.day}>
                  <td style={{ fontWeight: 600 }}>{r.day}</td>
                  <td>{r.opens}</td>
                  <td>{r.closes}</td>
                  <td><span className={`tag ${r.active ? "tag-green" : "tag-gray"}`}>{r.active ? "Open" : "Closed"}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}



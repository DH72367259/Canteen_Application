"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

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
}

interface SlotStats { slot: string; total: number; preparing: number; completed: number; delayed: number; }

const INITIAL_BINS: Bin[] = [
  { id: "b1", number: 1, status: "completed", orderId: "ORD-103", customerName: "Ananya S.", slot: "12:30 PM", items: "Thali Veg", otp: "7821", },
  { id: "b2", number: 2, status: "preparing", orderId: "ORD-104", customerName: "Rajan M.", slot: "1:00 PM", items: "Paneer + Roti ×2", otp: "4291", },
  { id: "b3", number: 3, status: "preparing", orderId: "ORD-105", customerName: "Meera K.", slot: "1:00 PM", items: "Dal Rice, Papad", otp: "9034", },
  { id: "b4", number: 4, status: "delayed", orderId: "ORD-102", customerName: "Dev P.", slot: "12:30 PM", items: "Chicken Curry + Rice", otp: "3318", },
  { id: "b5", number: 5, status: "empty", orderId: null, customerName: null, slot: null, items: null, otp: null, },
  { id: "b6", number: 6, status: "preparing", orderId: "ORD-106", customerName: "Priya T.", slot: "1:00 PM", items: "Veg Thali", otp: "5523", },
  { id: "b7", number: 7, status: "completed", orderId: "ORD-101", customerName: "Amir H.", slot: "12:30 PM", items: "Idli ×4, Sambhar", otp: "1174", },
  { id: "b8", number: 8, status: "empty", orderId: null, customerName: null, slot: null, items: null, otp: null, },
];

const SLOT_STATS: SlotStats[] = [
  { slot: "12:30 PM", total: 8, preparing: 1, completed: 5, delayed: 2 },
  { slot: "1:00 PM", total: 12, preparing: 5, completed: 3, delayed: 1 },
  { slot: "1:30 PM", total: 6, preparing: 0, completed: 0, delayed: 0 },
  { slot: "2:00 PM", total: 4, preparing: 0, completed: 0, delayed: 0 },
];

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
  const { user, logout } = useAuth();
  const [activeNav, setActiveNav] = useState("live");
  const [activeSlot, setActiveSlot] = useState("1:00 PM");
  const [bins, setBins] = useState<Bin[]>(INITIAL_BINS);
  const [selectedBin, setSelectedBin] = useState<Bin | null>(null);
  const [otpInput, setOtpInput] = useState("");
  const [otpError, setOtpError] = useState<string | null>(null);
  const [otpSuccess, setOtpSuccess] = useState(false);
  const refreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Redirect if not vendor/canteen_admin
  useEffect(() => {
    if (user && user.role !== "vendor" && user.role !== "canteen_admin") {
      router.push("/login");
    }
  }, [user, router]);

  // Auto-refresh every 5s (mock: just simulate a new order occasionally)
  useEffect(() => {
    refreshRef.current = setInterval(() => {
      // In real app: fetch /api/vendor/orders and update bins
      // For demo, do nothing
    }, 5000);
    return () => { if (refreshRef.current) clearInterval(refreshRef.current); };
  }, []);

  const handleBinClick = (bin: Bin) => {
    if (bin.status === "empty") return;
    setSelectedBin(bin);
    setOtpInput("");
    setOtpError(null);
    setOtpSuccess(false);
  };

  const handleOtpVerify = () => {
    if (!selectedBin) return;
    if (otpInput !== selectedBin.otp) {
      setOtpError("Incorrect OTP. Try again.");
      return;
    }
    setBins(prev => prev.map(b => b.id === selectedBin.id ? { ...b, status: "completed" } : b));
    setOtpSuccess(true);
    setTimeout(() => setSelectedBin(null), 1200);
  };

  const handleLogout = async () => { await logout(); router.push("/login"); };

  const slotBins = bins.filter(b => !b.slot || b.slot === activeSlot || b.status === "empty");
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
            <h1 style={{ fontSize: "1.1rem", fontWeight: 700 }}>
              {NAV_ITEMS.find(n => n.id === activeNav)?.label}
            </h1>
            <div className="topbar-sub">Auto-refreshes every 5 seconds · Last updated just now</div>
          </div>
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
            <div style={{ fontSize: "0.82rem", background: "var(--green-light)", color: "#15803d", borderRadius: 999, padding: "0.25rem 0.7rem", fontWeight: 600 }}>
              ● Live
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
              {SLOT_STATS.map(s => (
                <button
                  key={s.slot}
                  className={`slot-tab ${activeSlot === s.slot ? "active" : ""}`}
                  onClick={() => setActiveSlot(s.slot)}
                >
                  {s.slot}
                  {s.total > 0 && (
                    <span style={{ marginLeft: "0.35rem", background: activeSlot === s.slot ? "rgba(255,255,255,0.25)" : "var(--border)", borderRadius: 999, padding: "0.05rem 0.4rem", fontSize: "0.7rem" }}>
                      {s.total}
                    </span>
                  )}
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
                      {bin.status !== "completed" && (
                        <div style={{ marginTop: "0.25rem", fontSize: "0.7rem", fontWeight: 700, textTransform: "uppercase", opacity: 0.7 }}>
                          {bin.status === "preparing" ? "Tap to verify OTP" : "⚠ Delayed"}
                        </div>
                      )}
                    </>
                  ) : (
                    <div style={{ fontSize: "0.78rem", color: "var(--ink-3)", marginTop: "0.25rem" }}>Empty · Available</div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        {activeNav === "menu" && <VendorMenuView />}
        {activeNav === "slots" && <VendorSlotsView />}
        {activeNav === "sales" && <VendorSalesView />}
        {(activeNav === "bins" || activeNav === "logs" || activeNav === "settings") && (
          <div className="page-content">
            <div className="empty-state">
              <span className="empty-icon">🔧</span>
              <h3>{NAV_ITEMS.find(n => n.id === activeNav)?.label}</h3>
              <p>This section is under development</p>
            </div>
          </div>
        )}
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
  const [meal, setMeal] = useState<"breakfast" | "lunch" | "dinner">("lunch");
  const [items, setItems] = useState({
    breakfast: [
      { id: "b1", name: "Poha", price: 30, enabled: true },
      { id: "b2", name: "Idli Sambhar", price: 45, enabled: true },
      { id: "b3", name: "Paratha + Curd", price: 55, enabled: false },
      { id: "b4", name: "Tea / Coffee", price: 15, enabled: true },
    ],
    lunch: [
      { id: "l1", name: "Veg Thali", price: 90, enabled: true },
      { id: "l2", name: "Paneer Butter Masala", price: 75, enabled: true },
      { id: "l3", name: "Roti (2 pcs)", price: 20, enabled: true },
      { id: "l4", name: "Chicken Curry", price: 110, enabled: true },
      { id: "l5", name: "Lassi Sweet", price: 35, enabled: false },
    ],
    dinner: [
      { id: "d1", name: "Dinner Thali", price: 80, enabled: true },
      { id: "d2", name: "Khichdi", price: 55, enabled: true },
      { id: "d3", name: "Egg Curry", price: 65, enabled: false },
    ],
  });

  const toggleItem = (id: string) => {
    setItems(prev => ({
      ...prev,
      [meal]: prev[meal].map(item => item.id === id ? { ...item, enabled: !item.enabled } : item),
    }));
  };

  return (
    <div className="page-content">
      <div className="page-header">
        <h2>Menu & Items</h2>
        <button className="btn btn-primary" style={{ fontSize: "0.85rem", padding: "0.5rem 1rem" }}>+ Add Item</button>
      </div>

      <div className="meal-tabs" style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden" }}>
        {(["breakfast", "lunch", "dinner"] as const).map(m => (
          <button key={m} className={`meal-tab ${meal === m ? "active" : ""}`} onClick={() => setMeal(m)} style={{ flex: 1 }}>
            {m === "breakfast" ? "🌅 Breakfast" : m === "lunch" ? "☀️ Lunch" : "🌙 Dinner"}
          </button>
        ))}
      </div>

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {items[meal].map((item, i) => (
          <div key={item.id} className="menu-toggle" style={{ padding: "0.85rem 1rem", borderBottom: i < items[meal].length - 1 ? "1px solid var(--border)" : "none" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>{item.name}</div>
              <div style={{ fontSize: "0.78rem", color: "var(--ink-3)" }}>₹{item.price}</div>
            </div>
            <label className="toggle-switch">
              <input type="checkbox" checked={item.enabled} onChange={() => toggleItem(item.id)} />
              <span className="toggle-track" />
            </label>
          </div>
        ))}
      </div>
    </div>
  );
}

function VendorSlotsView() {
  const slots = [
    { time: "8:00 AM – 8:30 AM", type: "Breakfast", capacity: 20, booked: 12, enabled: true },
    { time: "12:30 PM – 12:45 PM", type: "Lunch", capacity: 30, booked: 28, enabled: true },
    { time: "1:00 PM – 1:15 PM", type: "Lunch", capacity: 30, booked: 18, enabled: true },
    { time: "1:30 PM – 1:45 PM", type: "Lunch", capacity: 25, booked: 6, enabled: true },
    { time: "8:00 PM – 8:15 PM", type: "Dinner", capacity: 20, booked: 0, enabled: false },
  ];

  return (
    <div className="page-content">
      <div className="page-header">
        <h2>Time Slots</h2>
        <button className="btn btn-primary" style={{ fontSize: "0.85rem", padding: "0.5rem 1rem" }}>+ Add Slot</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>TIME</th><th>TYPE</th><th>CAPACITY</th><th>BOOKED</th><th>STATUS</th></tr></thead>
          <tbody>
            {slots.map(s => (
              <tr key={s.time}>
                <td style={{ fontWeight: 600 }}>{s.time}</td>
                <td><span className={`tag ${s.type === "Breakfast" ? "tag-orange" : s.type === "Lunch" ? "tag-blue" : "tag-gray"}`}>{s.type}</span></td>
                <td>{s.capacity}</td>
                <td>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                    <div style={{ flex: 1, height: 6, background: "var(--border)", borderRadius: 999, maxWidth: 80 }}>
                      <div style={{ width: `${(s.booked / s.capacity) * 100}%`, height: "100%", background: s.booked / s.capacity > 0.8 ? "var(--red)" : "var(--orange)", borderRadius: 999 }} />
                    </div>
                    <span style={{ fontSize: "0.78rem" }}>{s.booked}/{s.capacity}</span>
                  </div>
                </td>
                <td><span className={`tag ${s.enabled ? "tag-green" : "tag-gray"}`}>{s.enabled ? "Active" : "Disabled"}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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



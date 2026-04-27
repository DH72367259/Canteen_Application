"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

type AdminSection = "overview" | "canteens" | "users" | "managers" | "workers" | "cities" | "analytics" | "payments" | "support" | "notifications" | "account";

const ADMIN_NAV = [
  { id: "overview",  icon: "📊", label: "Dashboard" },
  { id: "canteens",  icon: "🏪", label: "Manage Canteens" },
  { id: "managers",  icon: "👨‍💼", label: "Canteen Managers" },
  { id: "workers",   icon: "🧑‍🍳", label: "Workers" },
  { id: "users",     icon: "👥", label: "All Users" },
  { id: "cities",    icon: "🏫", label: "Cities & Colleges" },
  { id: "analytics", icon: "📈", label: "Analytics" },
  { id: "payments",  icon: "💳", label: "Payments" },
  { id: "support",   icon: "🎧", label: "Support" },
  { id: "notifications", icon: "🔔", label: "Notifications" },
  { id: "account",   icon: "🔑", label: "My Account" },
];

export default function SuperAdminDashboard() {
  const router = useRouter();
  const { user, session, loading, logout } = useAuth();
  const [section, setSection] = useState<AdminSection>("overview");
  const isSuperAdmin = user?.role === "super_admin";

  useEffect(() => {
    if (loading) return; // wait for Supabase auth to settle
    if (!user) { router.replace("/login"); return; }
    if (user.role !== "super_admin" && user.role !== "co_admin") router.replace("/login");
  }, [user, loading, router]);

  const handleLogout = async () => { try { await logout(); } catch { /* ignore */ } router.replace("/login"); };

  // Show spinner while auth loads or while redirecting
  if (loading || !user) return <div className="loading-screen"><div className="spinner" /></div>;

  return (
    <div className="web-shell">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="logo-badge"><span className="dot" />Canteen Admin</div>
          <p>{isSuperAdmin ? "Super Administrator" : "Co-Administrator"}</p>
        </div>
        <nav className="sidebar-nav">
          {ADMIN_NAV.map(item => (
            <button key={item.id} className={`sidebar-link ${section === item.id ? "active" : ""}`} onClick={() => setSection(item.id as AdminSection)}>
              <span className="icon">{item.icon}</span>{item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <button className="sidebar-link" onClick={handleLogout} style={{ color: "#f87171" }}>
            <span className="icon">🚪</span>Logout
          </button>
        </div>
      </aside>

      <main className="main-with-sidebar">
        {section === "overview"  && <OverviewSection />}
        {section === "canteens"  && <CanteensSection />}
        {section === "managers"  && <ManagersSection isSuperAdmin={isSuperAdmin} session={session} />}
        {section === "workers"   && <WorkersSection isSuperAdmin={isSuperAdmin} session={session} />}
        {section === "users"     && <UsersSection isSuperAdmin={isSuperAdmin} session={session} />}
        {section === "analytics" && <AnalyticsSection />}
        {section === "payments"  && <PaymentsSection />}
        {section === "cities"    && <CitiesSection />}
        {section === "support"       && <SupportSection />}
        {section === "notifications" && <NotificationsSection session={session} isSuperAdmin={isSuperAdmin} />}
        {section === "account"       && <AccountSection />}
      </main>
    </div>
  );
}

function OverviewSection() {
  return (
    <div className="page-content">
      <div className="page-header"><h2>Platform Overview</h2><span className="tag tag-green">● Live</span></div>
      <div className="dashboard-grid">
        {[
          { icon: "🏪", label: "Active Canteens", value: "3", sub: "+1 this month", color: "var(--orange)" },
          { icon: "👥", label: "Total Users", value: "2,841", sub: "+128 this week", color: "var(--blue)" },
          { icon: "📦", label: "Orders Today", value: "1,248", sub: "₹96,240 revenue", color: "var(--green)" },
          { icon: "💰", label: "Canteen Cash Given", value: "₹14,220", sub: "rewards this month", color: "var(--yellow)" },
          { icon: "⭐", label: "Avg. Rating", value: "4.4", sub: "across all canteens", color: "var(--orange)" },
          { icon: "📱", label: "App Users", value: "1,922", sub: "iOS + Android", color: "var(--blue)" },
        ].map(s => (
          <div key={s.label} className="stat-card" style={{ textAlign: "left" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
              <span style={{ fontSize: "1.2rem" }}>{s.icon}</span>
              <span style={{ fontSize: "0.78rem", color: "var(--ink-3)", fontWeight: 600, textTransform: "uppercase" }}>{s.label}</span>
            </div>
            <div className="stat-num" style={{ color: s.color, textAlign: "left" }}>{s.value}</div>
            <div className="stat-label" style={{ textAlign: "left" }}>{s.sub}</div>
          </div>
        ))}
      </div>

      <h3 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "0.75rem" }}>Recent Activity</h3>
      <div className="table-wrap">
        <table>
          <thead><tr><th>TIME</th><th>EVENT</th><th>CANTEEN</th><th>DETAIL</th></tr></thead>
          <tbody>
            {[
              { time: "1:08 PM", event: "New Order", canteen: "IIT Bombay – Main", detail: "ORD-1248 · ₹145" },
              { time: "1:05 PM", event: "OTP Verified", canteen: "BITS Pilani", detail: "Bin #3 · Arjun S." },
              { time: "12:58 PM", event: "Menu Updated", canteen: "VIT Vellore", detail: "Chicken Curry OFF" },
              { time: "12:45 PM", event: "Slot Opened", canteen: "IIT Bombay – Main", detail: "1:30 PM slot (capacity 25)" },
              { time: "12:30 PM", event: "Settlement", canteen: "BITS Pilani", detail: "₹22,400 transferred" },
            ].map((r, i) => (
              <tr key={i}>
                <td style={{ color: "var(--ink-3)", fontSize: "0.8rem" }}>{r.time}</td>
                <td><span className="tag tag-orange">{r.event}</span></td>
                <td style={{ fontSize: "0.82rem" }}>{r.canteen}</td>
                <td style={{ fontSize: "0.82rem", color: "var(--ink-3)" }}>{r.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CanteensSection() {
  const { session } = useAuth();
  const INIT = [
    { id: "c1", name: "IIT Bombay – Main Canteen", college: "IIT Bombay", city: "Mumbai", address: "Main Gate Road, IIT Bombay, Powai", lat: "19.1334", lng: "72.9133", gmapLink: "https://maps.google.com/?q=19.1334,72.9133", status: "active" as const, orders: 1240, revenue: "₹1.2L" },
    { id: "c2", name: "BITS Pilani – Central Mess", college: "BITS Pilani", city: "Rajasthan", address: "BITS Pilani Campus, Pilani, Rajasthan", lat: "28.3670", lng: "75.5882", gmapLink: "https://maps.google.com/?q=28.3670,75.5882", status: "active" as const, orders: 890, revenue: "₹86K" },
    { id: "c3", name: "NIT Trichy – Block A Caf", college: "NIT Trichy", city: "Chennai", address: "NIT Campus, Tiruchirappalli", lat: "10.7639", lng: "78.8126", gmapLink: "https://maps.google.com/?q=10.7639,78.8126", status: "inactive" as const, orders: 0, revenue: "₹0" },
    { id: "c4", name: "VIT University – Canteen 2", college: "VIT Vellore", city: "Vellore", address: "VIT University, Vellore, Tamil Nadu", lat: "12.9693", lng: "79.1559", gmapLink: "https://maps.google.com/?q=12.9693,79.1559", status: "active" as const, orders: 560, revenue: "₹55K" },
  ];
  type Canteen = typeof INIT[number];
  const [canteens, setCanteens] = useState<Canteen[]>(INIT);
  const [editing, setEditing] = useState<Canteen | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", college: "", city: "", address: "", lat: "", lng: "", gmapLink: "", status: "active" as "active" | "inactive", email: "", password: "" });
  const [gmapParseError, setGmapParseError] = useState("");
  const [savingCanteen, setSavingCanteen] = useState(false);
  const [canteenApiError, setCanteenApiError] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Timings modal state
  type Timing = { day: string; opens: string; closes: string; active: boolean };
  const DEFAULT_TIMINGS: Timing[] = [
    { day: "Monday – Friday", opens: "07:30", closes: "21:00", active: true },
    { day: "Saturday",        opens: "08:00", closes: "17:00", active: true },
    { day: "Sunday",          opens: "08:00", closes: "17:00", active: false },
  ];
  const [timingsCanteen, setTimingsCanteen] = useState<Canteen | null>(null);
  const [timings, setTimings] = useState<Timing[]>(DEFAULT_TIMINGS);
  const [timingsSaved, setTimingsSaved] = useState(false);

  // Auto-extract lat/lng when a Google Maps URL is pasted
  const handleGmapLinkChange = (url: string) => {
    setForm(p => ({ ...p, gmapLink: url }));
    setGmapParseError("");
    if (!url.trim()) return;
    // Match /@lat,lng or ?q=lat,lng or &q=lat,lng patterns
    const patterns = [
      /@(-?\d+\.\d+),(-?\d+\.\d+)/,
      /[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/,
      /ll=(-?\d+\.\d+),(-?\d+\.\d+)/,
    ];
    for (const re of patterns) {
      const m = url.match(re);
      if (m) {
        setForm(p => ({ ...p, lat: m[1], lng: m[2], gmapLink: url }));
        return;
      }
    }
    setGmapParseError("Could not extract coordinates — enter lat/lng manually below.");
  };

  const openEdit = (c: Canteen) => {
    setEditing(c);
    setForm({ name: c.name, college: c.college, city: c.city, address: c.address, lat: c.lat, lng: c.lng, gmapLink: c.gmapLink, status: c.status, email: "", password: "" });
    setAdding(false);
    setGmapParseError("");
    setCanteenApiError("");
  };
  const openAdd = () => {
    setEditing(null);
    setForm({ name: "", college: "", city: "", address: "", lat: "", lng: "", gmapLink: "", status: "active", email: "", password: "" });
    setAdding(true);
    setGmapParseError("");
    setCanteenApiError("");
    setShowPassword(false);
  };
  const closeModal = () => { setEditing(null); setAdding(false); setGmapParseError(""); setCanteenApiError(""); };

  const saveEdit = async () => {
    if (!form.name.trim()) return;
    if (!form.lat.trim() || !form.lng.trim()) {
      setGmapParseError("Latitude and Longitude are required.");
      return;
    }
    if (adding) {
      if (!form.email.trim()) { setCanteenApiError("Login email is required."); return; }
      if (!form.password.trim() || form.password.length < 8) { setCanteenApiError("Password must be at least 8 characters."); return; }
      setSavingCanteen(true);
      setCanteenApiError("");
      try {
        const res = await fetch("/api/admin/canteens/create", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
          body: JSON.stringify({
            name: form.name, college: form.college, city: form.city, address: form.address,
            lat: form.lat, lng: form.lng, gmapLink: form.gmapLink,
            email: form.email, password: form.password,
          }),
        });
        const data = await res.json();
        if (!res.ok) { setCanteenApiError(data.error || "Failed to create canteen."); return; }
        setCanteens(prev => [...prev, { id: data.canteen.id, ...form, orders: 0, revenue: "₹0" }]);
        closeModal();
      } catch {
        setCanteenApiError("Network error — please try again.");
      } finally {
        setSavingCanteen(false);
      }
    } else if (editing) {
      setCanteens(prev => prev.map(c => c.id === editing.id ? { ...c, ...form } : c));
      closeModal();
    }
  };

  const toggleStatus = async (id: string) => {
    const canteen = canteens.find(c => c.id === id);
    if (!canteen) return;
    const next = canteen.status === "active" ? "inactive" : "active";
    // Optimistic update
    setCanteens(prev => prev.map(c => c.id === id ? { ...c, status: next } : c));
    try {
      if (session?.access_token) {
        const res = await fetch(`/api/canteens/${id}/toggle`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ is_active: next === "active" }),
        });
        if (!res.ok) throw new Error("API error");
      }
    } catch {
      // Revert on failure
      setCanteens(prev => prev.map(c => c.id === id ? { ...c, status: canteen.status } : c));
    }
  };

  return (
    <div className="page-content">
      <div className="page-header">
        <h2>Manage Canteens</h2>
        <button className="btn btn-primary" style={{ fontSize: "0.85rem", padding: "0.5rem 1rem" }} onClick={openAdd}>+ Add Canteen</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>CANTEEN</th><th>COLLEGE</th><th>CITY</th><th>LOCATION</th><th>ORDERS</th><th>REVENUE</th><th>STATUS</th><th>ACTIONS</th></tr></thead>
          <tbody>
            {canteens.map(c => (
              <tr key={c.id}>
                <td style={{ fontWeight: 600 }}>{c.name}</td>
                <td style={{ fontSize: "0.82rem" }}>{c.college}</td>
                <td style={{ fontSize: "0.82rem", color: "var(--ink-3)" }}>{c.city}</td>
                <td style={{ fontSize: "0.82rem" }}>
                  {c.gmapLink ? (
                    <a href={c.gmapLink} target="_blank" rel="noopener noreferrer" style={{ color: "var(--blue)", textDecoration: "none", fontWeight: 600 }} title={c.address}>
                      📍 {c.lat}, {c.lng}
                    </a>
                  ) : (
                    <span style={{ color: "var(--ink-3)" }}>—</span>
                  )}
                </td>
                <td>{c.orders.toLocaleString()}</td>
                <td style={{ fontWeight: 600 }}>{c.revenue}</td>
                <td>
                  <button
                    className={`tag ${c.status === "active" ? "tag-green" : "tag-gray"}`}
                    style={{ cursor: "pointer", background: "none", border: "none" }}
                    onClick={() => toggleStatus(c.id)}
                    title="Click to toggle"
                  >
                    {c.status === "active" ? "● Active" : "○ Inactive"}
                  </button>
                </td>
                <td style={{ display: "flex", gap: "0.4rem" }}>
                  <button className="btn btn-ghost" style={{ fontSize: "0.78rem", padding: "0.25rem 0.5rem" }} onClick={() => openEdit(c)}>Edit</button>
                  <button className="btn btn-ghost" style={{ fontSize: "0.78rem", padding: "0.25rem 0.5rem" }} onClick={() => { setTimingsCanteen(c); setTimings(DEFAULT_TIMINGS); setTimingsSaved(false); }}>🕐 Hours</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(editing || adding) && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-sheet" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "1rem" }}>
              <h3>{adding ? "Add New Canteen" : "Edit Canteen"}</h3>
              <button onClick={closeModal} style={{ background: "none", border: "none", fontSize: "1.2rem", cursor: "pointer" }}>✕</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", maxHeight: "70vh", overflowY: "auto", paddingRight: "0.25rem" }}>
              <div>
                <label className="form-label">Canteen Name *</label>
                <input className="form-input" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Main Canteen" />
              </div>
              <div>
                <label className="form-label">College / Institution *</label>
                <input className="form-input" value={form.college} onChange={e => setForm(p => ({ ...p, college: e.target.value }))} placeholder="e.g. IIT Bombay" />
              </div>
              <div>
                <label className="form-label">City *</label>
                <input className="form-input" value={form.city} onChange={e => setForm(p => ({ ...p, city: e.target.value }))} placeholder="e.g. Mumbai" />
              </div>
              <div>
                <label className="form-label">Full Address</label>
                <input className="form-input" value={form.address} onChange={e => setForm(p => ({ ...p, address: e.target.value }))} placeholder="e.g. Main Gate Road, IIT Bombay, Powai" />
              </div>

              {/* Google Maps URL — auto-extracts lat/lng */}
              <div>
                <label className="form-label">Google Maps Link <span style={{ fontWeight: 400, color: "var(--ink-3)", fontSize: "0.78rem" }}>(paste URL to auto-fill coordinates)</span></label>
                <input
                  className="form-input"
                  value={form.gmapLink}
                  onChange={e => handleGmapLinkChange(e.target.value)}
                  placeholder="https://maps.google.com/?q=19.1334,72.9133"
                />
                <p style={{ fontSize: "0.75rem", color: "var(--ink-3)", marginTop: "0.25rem" }}>
                  💡 In Google Maps: right-click the location → Copy coordinates, or share the map link here.
                </p>
                {gmapParseError && (
                  <p style={{ fontSize: "0.78rem", color: "var(--red)", marginTop: "0.2rem" }}>{gmapParseError}</p>
                )}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
                <div>
                  <label className="form-label">Latitude *</label>
                  <input className="form-input" value={form.lat} onChange={e => setForm(p => ({ ...p, lat: e.target.value }))} placeholder="e.g. 19.1334" />
                </div>
                <div>
                  <label className="form-label">Longitude *</label>
                  <input className="form-input" value={form.lng} onChange={e => setForm(p => ({ ...p, lng: e.target.value }))} placeholder="e.g. 72.9133" />
                </div>
              </div>
              {form.lat && form.lng && (
                <a
                  href={`https://maps.google.com/?q=${form.lat},${form.lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: "0.78rem", color: "var(--blue)", fontWeight: 600 }}
                >
                  🗺️ Preview on Google Maps →
                </a>
              )}

              <div>
                <label className="form-label">Status</label>
                <select className="form-input" value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value as "active" | "inactive" }))}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>

              {/* Login credentials — only when creating a new canteen */}
              {adding && (
                <>
                  <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "0.25rem 0" }} />
                  <p style={{ fontSize: "0.8rem", color: "var(--ink-3)", margin: 0 }}>
                    🔐 <strong>Manager login credentials</strong> — the canteen manager will use these to sign in. Password is static and never sent by email.
                  </p>
                  <div>
                    <label className="form-label">Login Email *</label>
                    <input className="form-input" type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} placeholder="e.g. iitbombay@canteen.app" autoComplete="off" />
                  </div>
                  <div>
                    <label className="form-label">Password * <span style={{ fontWeight: 400, color: "var(--ink-3)", fontSize: "0.78rem" }}>(min 8 characters)</span></label>
                    <div style={{ position: "relative" }}>
                      <input
                        className="form-input"
                        type={showPassword ? "text" : "password"}
                        value={form.password}
                        onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
                        placeholder="Create a static password"
                        autoComplete="new-password"
                        style={{ paddingRight: "2.5rem" }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(v => !v)}
                        style={{ position: "absolute", right: "0.6rem", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", fontSize: "1rem", color: "var(--ink-3)" }}
                      >
                        {showPassword ? "🙈" : "👁️"}
                      </button>
                    </div>
                  </div>
                </>
              )}

              {canteenApiError && (
                <p style={{ fontSize: "0.82rem", color: "var(--red)", margin: 0 }}>{canteenApiError}</p>
              )}

              <button className="btn btn-primary btn-full" onClick={saveEdit} disabled={savingCanteen} style={{ marginTop: "0.5rem" }}>
                {savingCanteen ? "Creating…" : adding ? "Create Canteen" : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Timings modal */}
      {timingsCanteen && (
        <div className="modal-overlay" onClick={() => setTimingsCanteen(null)}>
          <div className="modal-sheet" onClick={e => e.stopPropagation()} style={{ maxWidth: 460 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "1rem" }}>
              <h3>Operating Hours — {timingsCanteen.name}</h3>
              <button onClick={() => setTimingsCanteen(null)} style={{ background: "none", border: "none", fontSize: "1.2rem", cursor: "pointer" }}>✕</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {timings.map((t, i) => (
                <div key={t.day} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: "0.5rem", alignItems: "center", padding: "0.5rem", background: "var(--surface-2)", borderRadius: 8 }}>
                  <span style={{ fontWeight: 600, fontSize: "0.82rem" }}>{t.day}</span>
                  <div>
                    <label className="form-label" style={{ marginBottom: "0.2rem" }}>Opens</label>
                    <input className="form-input" type="time" value={t.opens} disabled={!t.active} onChange={e => setTimings(prev => prev.map((r, j) => j === i ? { ...r, opens: e.target.value } : r))} />
                  </div>
                  <div>
                    <label className="form-label" style={{ marginBottom: "0.2rem" }}>Closes</label>
                    <input className="form-input" type="time" value={t.closes} disabled={!t.active} onChange={e => setTimings(prev => prev.map((r, j) => j === i ? { ...r, closes: e.target.value } : r))} />
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.25rem" }}>
                    <label className="form-label" style={{ marginBottom: "0.2rem" }}>Open</label>
                    <label className="toggle-switch" style={{ transform: "scale(1.1)" }}>
                      <input type="checkbox" checked={t.active} onChange={e => setTimings(prev => prev.map((r, j) => j === i ? { ...r, active: e.target.checked } : r))} />
                      <span className="toggle-track" />
                    </label>
                  </div>
                </div>
              ))}
              <button
                className="btn btn-primary btn-full"
                style={{ marginTop: "0.5rem" }}
                onClick={() => { setTimingsSaved(true); setTimeout(() => setTimingsSaved(false), 2000); }}
              >
                {timingsSaved ? "✓ Saved!" : "Save Hours"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Shared API helper ──────────────────────────────────────────────────────
async function adminFetch(path: string, session: { access_token?: string } | null, opts?: RequestInit) {
  const token = session?.access_token ?? "";
  return fetch(path, {
    ...opts,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, ...(opts?.headers ?? {}) },
  });
}

// ── ManagersSection — onboard / offboard canteen managers ─────────────────
interface ManagerRow { uid: string; name: string; email: string; role: string; canteen_id: string | null; created_at: string; }

function ManagersSection({ isSuperAdmin, session }: { isSuperAdmin: boolean; session: { access_token?: string } | null }) {
  const [managers, setManagers] = useState<ManagerRow[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [search,   setSearch]   = useState("");

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ email: "", password: "", name: "", role: "canteen_admin", canteen_id: "" });
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Password reset modal
  const [resetTarget, setResetTarget] = useState<ManagerRow | null>(null);
  const [newPwd, setNewPwd] = useState("");
  const [resetBusy, setResetBusy] = useState(false);

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<ManagerRow | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const r = await adminFetch("/api/admin/users", session);
      const j = await r.json();
      if (!r.ok) { setError(j.error ?? "Failed to load"); return; }
      const staffRoles = ["canteen_admin", "vendor"];
      setManagers((j.users as ManagerRow[]).filter(u => staffRoles.includes(u.role)));
    } catch { setError("Network error"); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleCreate() {
    setFormBusy(true); setFormError(null);
    try {
      const r = await adminFetch("/api/admin/users", session, { method: "POST", body: JSON.stringify(form) });
      const j = await r.json();
      if (!r.ok) { setFormError(j.error ?? "Failed"); return; }
      setShowCreate(false); setForm({ email: "", password: "", name: "", role: "canteen_admin", canteen_id: "" });
      await load();
    } catch { setFormError("Network error"); }
    finally { setFormBusy(false); }
  }

  async function handleResetPassword() {
    if (!resetTarget) return;
    if (newPwd.length < 8) return;
    setResetBusy(true);
    try {
      const r = await adminFetch("/api/admin/users", session, { method: "PATCH", body: JSON.stringify({ uid: resetTarget.uid, new_password: newPwd }) });
      const j = await r.json();
      if (!r.ok) { alert(j.error ?? "Failed to reset password"); return; }
      setResetTarget(null); setNewPwd("");
      alert("Password reset successfully.");
    } catch { alert("Network error"); }
    finally { setResetBusy(false); }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      const r = await adminFetch("/api/admin/users", session, { method: "DELETE", body: JSON.stringify({ uid: deleteTarget.uid }) });
      const j = await r.json();
      if (!r.ok) { alert(j.error ?? "Failed to delete"); return; }
      setDeleteTarget(null); await load();
    } catch { alert("Network error"); }
  }

  const filtered = managers.filter(m =>
    m.name?.toLowerCase().includes(search.toLowerCase()) ||
    m.email?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="page-content">
      <div className="page-header">
        <h2>Canteen Managers</h2>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <input className="form-input" type="search" placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} style={{ width: 200 }} />
          {isSuperAdmin && <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ Onboard Manager</button>}
        </div>
      </div>

      {!isSuperAdmin && (
        <div style={{ background: "#fef3c7", border: "1px solid #fbbf24", borderRadius: 10, padding: "0.6rem 1rem", fontSize: "0.82rem", color: "#78350f", marginBottom: "1rem" }}>
          👁️ View-only mode — only super_admin can create, delete, or reset passwords.
        </div>
      )}

      {error && <p className="error-msg">{error}</p>}

      <div className="table-wrap">
        <table>
          <thead><tr><th>NAME</th><th>EMAIL</th><th>ROLE</th><th>CANTEEN</th><th>JOINED</th>{isSuperAdmin && <th>ACTIONS</th>}</tr></thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} style={{ textAlign: "center", padding: "2rem", color: "var(--ink-3)" }}>Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={6} style={{ textAlign: "center", padding: "2rem", color: "var(--ink-3)" }}>No managers found</td></tr>
            ) : filtered.map(m => (
              <tr key={m.uid}>
                <td style={{ fontWeight: 600 }}>{m.name || "—"}</td>
                <td style={{ fontSize: "0.82rem", color: "var(--ink-3)" }}>{m.email}</td>
                <td><span className="tag tag-blue">{m.role}</span></td>
                <td style={{ fontSize: "0.82rem" }}>{m.canteen_id ? m.canteen_id.slice(0, 8) + "…" : "—"}</td>
                <td style={{ fontSize: "0.78rem", color: "var(--ink-3)" }}>{m.created_at ? new Date(m.created_at).toLocaleDateString("en-IN") : "—"}</td>
                {isSuperAdmin && (
                  <td style={{ display: "flex", gap: "0.4rem" }}>
                    <button className="btn btn-ghost" style={{ fontSize: "0.78rem", padding: "0.25rem 0.5rem" }} onClick={() => { setResetTarget(m); setNewPwd(""); }}>🔑 Reset PW</button>
                    <button className="btn btn-ghost" style={{ fontSize: "0.78rem", padding: "0.25rem 0.5rem", color: "#ef4444" }} onClick={() => setDeleteTarget(m)}>🗑 Remove</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Create Manager Modal */}
      {showCreate && isSuperAdmin && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal-sheet" onClick={e => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "1rem" }}>
              <h3>Onboard New Manager</h3>
              <button onClick={() => setShowCreate(false)} style={{ background: "none", border: "none", fontSize: "1.2rem", cursor: "pointer" }}>✕</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <div><label className="form-label">Full Name</label><input className="form-input" placeholder="e.g. Ramesh Kumar" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} /></div>
              <div><label className="form-label">Login Email</label><input className="form-input" type="email" placeholder="manager@example.com" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} /></div>
              <div><label className="form-label">Password (min 8 chars)</label><input className="form-input" type="password" placeholder="Set a strong password" value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))} /></div>
              <div>
                <label className="form-label">Role</label>
                <select className="form-input" value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value }))}>
                  <option value="canteen_admin">Canteen Admin</option>
                  <option value="vendor">Vendor</option>
                </select>
              </div>
              <div><label className="form-label">Canteen ID (optional)</label><input className="form-input" placeholder="Paste canteen UUID" value={form.canteen_id} onChange={e => setForm(p => ({ ...p, canteen_id: e.target.value }))} /></div>
              {formError && <p className="error-msg">{formError}</p>}
              <button className="btn btn-primary btn-full" disabled={formBusy} onClick={handleCreate}>
                {formBusy ? "Creating…" : "Create & Onboard →"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {resetTarget && isSuperAdmin && (
        <div className="modal-overlay" onClick={() => setResetTarget(null)}>
          <div className="modal-sheet" onClick={e => e.stopPropagation()} style={{ maxWidth: 380 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "1rem" }}>
              <h3>Reset Password</h3>
              <button onClick={() => setResetTarget(null)} style={{ background: "none", border: "none", fontSize: "1.2rem", cursor: "pointer" }}>✕</button>
            </div>
            <p style={{ fontSize: "0.85rem", color: "var(--ink-3)", marginBottom: "0.75rem" }}>Setting new password for <strong>{resetTarget.name}</strong> ({resetTarget.email})</p>
            <input className="form-input" type="password" placeholder="New password (min 8 chars)" value={newPwd} onChange={e => setNewPwd(e.target.value)} style={{ marginBottom: "0.75rem" }} />
            <button className="btn btn-primary btn-full" disabled={resetBusy || newPwd.length < 8} onClick={handleResetPassword}>
              {resetBusy ? "Resetting…" : "Reset Password →"}
            </button>
          </div>
        </div>
      )}

      {/* Delete Confirm Modal */}
      {deleteTarget && isSuperAdmin && (
        <div className="modal-overlay" onClick={() => setDeleteTarget(null)}>
          <div className="modal-sheet" onClick={e => e.stopPropagation()} style={{ maxWidth: 360, textAlign: "center" }}>
            <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>⚠️</div>
            <h3>Remove Manager?</h3>
            <p style={{ fontSize: "0.85rem", color: "var(--ink-3)", margin: "0.5rem 0 1rem" }}>This will permanently delete <strong>{deleteTarget.name}</strong> and revoke their access. This cannot be undone.</p>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button className="btn btn-ghost btn-full" onClick={() => setDeleteTarget(null)}>Cancel</button>
              <button className="btn btn-primary btn-full" style={{ background: "#ef4444" }} onClick={handleDelete}>Yes, Remove</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── WorkersSection — create / manage workers assigned to canteens ────────────
interface WorkerRow { uid: string; name: string; email: string; role: string; canteen_id: string | null; created_at: string; }
interface CanteenOption { id: string; name: string; city: string; college: string; }

function WorkersSection({ isSuperAdmin, session }: { isSuperAdmin: boolean; session: { access_token?: string } | null }) {
  const [workers,   setWorkers]   = useState<WorkerRow[]>([]);
  const [canteens,  setCanteens]  = useState<CanteenOption[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);
  const [search,    setSearch]    = useState("");

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ email: "", password: "", name: "", canteen_id: "" });
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Edit canteen modal
  const [editTarget,   setEditTarget]   = useState<WorkerRow | null>(null);
  const [editCanteen,  setEditCanteen]  = useState("");
  const [editBusy,     setEditBusy]     = useState(false);

  // Reset password modal
  const [resetTarget, setResetTarget] = useState<WorkerRow | null>(null);
  const [newPwd, setNewPwd] = useState("");
  const [resetBusy, setResetBusy] = useState(false);

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<WorkerRow | null>(null);

  const canteenName = (id: string | null) => {
    if (!id) return "—";
    const c = canteens.find(c => c.id === id);
    return c ? `${c.name}` : id.slice(0, 8) + "…";
  };

  async function load() {
    setLoading(true); setError(null);
    try {
      const [usersRes, canteensRes] = await Promise.all([
        adminFetch("/api/admin/users", session),
        adminFetch("/api/admin/canteens", session),
      ]);
      const usersJ    = await usersRes.json();
      const canteensJ = await canteensRes.json();
      if (!usersRes.ok) { setError(usersJ.error ?? "Failed to load users"); return; }
      setWorkers((usersJ.users as WorkerRow[]).filter(u => u.role === "worker"));
      setCanteens(canteensJ.canteens ?? []);
    } catch { setError("Network error"); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleCreate() {
    if (!form.canteen_id) { setFormError("Please select a canteen."); return; }
    setFormBusy(true); setFormError(null);
    try {
      const r = await adminFetch("/api/admin/users", session, {
        method: "POST",
        body: JSON.stringify({ ...form, role: "worker" }),
      });
      const j = await r.json();
      if (!r.ok) { setFormError(j.error ?? "Failed to create worker"); return; }
      setShowCreate(false);
      setForm({ email: "", password: "", name: "", canteen_id: "" });
      await load();
    } catch { setFormError("Network error"); }
    finally { setFormBusy(false); }
  }

  async function handleEditCanteen() {
    if (!editTarget) return;
    setEditBusy(true);
    try {
      const r = await adminFetch("/api/admin/users", session, {
        method: "PATCH",
        body: JSON.stringify({ uid: editTarget.uid, canteen_id: editCanteen }),
      });
      const j = await r.json();
      if (!r.ok) { alert(j.error ?? "Failed to update canteen"); return; }
      setEditTarget(null);
      await load();
    } catch { alert("Network error"); }
    finally { setEditBusy(false); }
  }

  async function handleResetPassword() {
    if (!resetTarget || newPwd.length < 8) return;
    setResetBusy(true);
    try {
      const r = await adminFetch("/api/admin/users", session, {
        method: "PATCH",
        body: JSON.stringify({ uid: resetTarget.uid, new_password: newPwd }),
      });
      const j = await r.json();
      if (!r.ok) { alert(j.error ?? "Failed to reset password"); return; }
      setResetTarget(null); setNewPwd("");
      alert("Password reset successfully.");
    } catch { alert("Network error"); }
    finally { setResetBusy(false); }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      const r = await adminFetch("/api/admin/users", session, {
        method: "DELETE",
        body: JSON.stringify({ uid: deleteTarget.uid }),
      });
      const j = await r.json();
      if (!r.ok) { alert(j.error ?? "Failed to delete"); return; }
      setDeleteTarget(null);
      await load();
    } catch { alert("Network error"); }
  }

  const filtered = workers.filter(w =>
    w.name?.toLowerCase().includes(search.toLowerCase()) ||
    w.email?.toLowerCase().includes(search.toLowerCase()) ||
    canteenName(w.canteen_id).toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="page-content">
      <div className="page-header">
        <h2>🧑‍🍳 Workers</h2>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <input className="form-input" type="search" placeholder="Search…" value={search}
            onChange={e => setSearch(e.target.value)} style={{ width: 200 }} />
          {isSuperAdmin && (
            <button className="btn btn-primary" onClick={() => { setShowCreate(true); setFormError(null); }}>
              + Add Worker
            </button>
          )}
        </div>
      </div>

      {!isSuperAdmin && (
        <div style={{ background: "#fef3c7", border: "1px solid #fbbf24", borderRadius: 10, padding: "0.6rem 1rem", fontSize: "0.82rem", color: "#78350f", marginBottom: "1rem" }}>
          👁️ View-only mode — only super_admin can create, edit, or remove workers.
        </div>
      )}

      {error && <p className="error-msg">{error}</p>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>NAME</th><th>EMAIL</th><th>ASSIGNED CANTEEN</th><th>JOINED</th>
              {isSuperAdmin && <th>ACTIONS</th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} style={{ textAlign: "center", padding: "2rem", color: "var(--ink-3)" }}>Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={5} style={{ textAlign: "center", padding: "2rem", color: "var(--ink-3)" }}>No workers found</td></tr>
            ) : filtered.map(w => (
              <tr key={w.uid}>
                <td style={{ fontWeight: 600 }}>{w.name || "—"}</td>
                <td style={{ fontSize: "0.82rem", color: "var(--ink-3)" }}>{w.email}</td>
                <td>
                  {w.canteen_id ? (
                    <span className="tag tag-green" title={w.canteen_id}>{canteenName(w.canteen_id)}</span>
                  ) : (
                    <span className="tag" style={{ background: "#fee2e2", color: "#b91c1c" }}>⚠ Unassigned</span>
                  )}
                </td>
                <td style={{ fontSize: "0.78rem", color: "var(--ink-3)" }}>
                  {w.created_at ? new Date(w.created_at).toLocaleDateString("en-IN") : "—"}
                </td>
                {isSuperAdmin && (
                  <td style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                    <button className="btn btn-ghost" style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem" }}
                      onClick={() => { setEditTarget(w); setEditCanteen(w.canteen_id ?? ""); }}>🏪 Canteen</button>
                    <button className="btn btn-ghost" style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem" }}
                      onClick={() => { setResetTarget(w); setNewPwd(""); }}>🔑 Reset PW</button>
                    <button className="btn btn-ghost" style={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem", color: "#ef4444" }}
                      onClick={() => setDeleteTarget(w)}>🗑 Remove</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── Create Worker Modal ── */}
      {showCreate && isSuperAdmin && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal-sheet" onClick={e => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
              <h3 style={{ margin: 0 }}>Add New Worker</h3>
              <button onClick={() => setShowCreate(false)} style={{ background: "none", border: "none", fontSize: "1.2rem", cursor: "pointer" }}>✕</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
              <div>
                <label className="form-label">Full Name *</label>
                <input className="form-input" placeholder="e.g. Rahul Sharma"
                  value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
              </div>
              <div>
                <label className="form-label">Login Email *</label>
                <input className="form-input" type="email" placeholder="worker@canteen.com"
                  value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} />
              </div>
              <div>
                <label className="form-label">Password * <span style={{ fontWeight: 400, color: "var(--ink-3)", fontSize: "0.78rem" }}>(min 8 chars)</span></label>
                <input className="form-input" type="password" placeholder="Set a strong password"
                  value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))} />
              </div>
              <div>
                <label className="form-label">Assign to Canteen *</label>
                <select className="form-input" value={form.canteen_id}
                  onChange={e => setForm(p => ({ ...p, canteen_id: e.target.value }))}>
                  <option value="">— Select a canteen —</option>
                  {canteens.map(c => (
                    <option key={c.id} value={c.id}>{c.name} – {c.city}</option>
                  ))}
                </select>
                {canteens.length === 0 && (
                  <p style={{ fontSize: "0.78rem", color: "#f97316", marginTop: "0.3rem" }}>
                    No canteens found. Create a canteen first.
                  </p>
                )}
              </div>
              {formError && <p className="error-msg">{formError}</p>}
              <button className="btn btn-primary btn-full"
                disabled={formBusy || !form.name || !form.email || !form.password || !form.canteen_id}
                onClick={handleCreate}>
                {formBusy ? "Creating…" : "Create Worker →"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Canteen Assignment Modal ── */}
      {editTarget && isSuperAdmin && (
        <div className="modal-overlay" onClick={() => setEditTarget(null)}>
          <div className="modal-sheet" onClick={e => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <h3 style={{ margin: 0 }}>Change Canteen</h3>
              <button onClick={() => setEditTarget(null)} style={{ background: "none", border: "none", fontSize: "1.2rem", cursor: "pointer" }}>✕</button>
            </div>
            <p style={{ fontSize: "0.85rem", color: "var(--ink-3)", marginBottom: "0.75rem" }}>
              Worker: <strong>{editTarget.name}</strong>
            </p>
            <label className="form-label">Assign to Canteen</label>
            <select className="form-input" value={editCanteen}
              onChange={e => setEditCanteen(e.target.value)} style={{ marginBottom: "1rem" }}>
              <option value="">— Unassign —</option>
              {canteens.map(c => (
                <option key={c.id} value={c.id}>{c.name} – {c.city}</option>
              ))}
            </select>
            <button className="btn btn-primary btn-full" disabled={editBusy} onClick={handleEditCanteen}>
              {editBusy ? "Saving…" : "Save Assignment →"}
            </button>
          </div>
        </div>
      )}

      {/* ── Reset Password Modal ── */}
      {resetTarget && isSuperAdmin && (
        <div className="modal-overlay" onClick={() => setResetTarget(null)}>
          <div className="modal-sheet" onClick={e => e.stopPropagation()} style={{ maxWidth: 380 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
              <h3 style={{ margin: 0 }}>Reset Password</h3>
              <button onClick={() => setResetTarget(null)} style={{ background: "none", border: "none", fontSize: "1.2rem", cursor: "pointer" }}>✕</button>
            </div>
            <p style={{ fontSize: "0.85rem", color: "var(--ink-3)", marginBottom: "0.75rem" }}>
              Setting new password for <strong>{resetTarget.name}</strong> ({resetTarget.email})
            </p>
            <input className="form-input" type="password" placeholder="New password (min 8 chars)"
              value={newPwd} onChange={e => setNewPwd(e.target.value)} style={{ marginBottom: "0.75rem" }} />
            <button className="btn btn-primary btn-full"
              disabled={resetBusy || newPwd.length < 8} onClick={handleResetPassword}>
              {resetBusy ? "Resetting…" : "Reset Password →"}
            </button>
          </div>
        </div>
      )}

      {/* ── Delete Confirm Modal ── */}
      {deleteTarget && isSuperAdmin && (
        <div className="modal-overlay" onClick={() => setDeleteTarget(null)}>
          <div className="modal-sheet" onClick={e => e.stopPropagation()} style={{ maxWidth: 360, textAlign: "center" }}>
            <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>⚠️</div>
            <h3>Remove Worker?</h3>
            <p style={{ fontSize: "0.85rem", color: "var(--ink-3)", margin: "0.5rem 0 1.25rem" }}>
              This will permanently delete <strong>{deleteTarget.name}</strong> and revoke their login. Cannot be undone.
            </p>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button className="btn btn-ghost btn-full" onClick={() => setDeleteTarget(null)}>Cancel</button>
              <button className="btn btn-primary btn-full" style={{ background: "#ef4444" }} onClick={handleDelete}>
                Yes, Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── UsersSection — all platform users from Supabase ───────────────────────
function UsersSection({ isSuperAdmin, session }: { isSuperAdmin: boolean; session: { access_token?: string } | null }) {
  interface UserRow { uid: string; name: string; email: string; role: string; canteen_id: string | null; created_at: string; }
  const [users,   setUsers]   = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [search,  setSearch]  = useState("");

  // Create co-admin form
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ email: "", password: "", name: "" });
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Delete
  const [deleteTarget, setDeleteTarget] = useState<UserRow | null>(null);

  async function load() {
    setLoading(true); setError(null);
    try {
      const r = await adminFetch("/api/admin/users", session);
      const j = await r.json();
      if (!r.ok) { setError(j.error ?? "Failed to load"); return; }
      setUsers(j.users as UserRow[]);
    } catch { setError("Network error"); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleCreateCoAdmin() {
    setFormBusy(true); setFormError(null);
    try {
      const r = await adminFetch("/api/admin/users", session, {
        method: "POST",
        body: JSON.stringify({ ...form, role: "co_admin" }),
      });
      const j = await r.json();
      if (!r.ok) { setFormError(j.error ?? "Failed"); return; }
      setShowCreate(false); setForm({ email: "", password: "", name: "" }); await load();
    } catch { setFormError("Network error"); }
    finally { setFormBusy(false); }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      const r = await adminFetch("/api/admin/users", session, { method: "DELETE", body: JSON.stringify({ uid: deleteTarget.uid }) });
      const j = await r.json();
      if (!r.ok) { alert(j.error ?? "Failed"); return; }
      setDeleteTarget(null); await load();
    } catch { alert("Network error"); }
  }

  const filtered = users.filter(u =>
    u.name?.toLowerCase().includes(search.toLowerCase()) ||
    u.email?.toLowerCase().includes(search.toLowerCase()) ||
    u.role?.toLowerCase().includes(search.toLowerCase())
  );

  const roleTag: Record<string, string> = {
    super_admin: "tag-orange", co_admin: "tag-orange",
    canteen_admin: "tag-blue", vendor: "tag-blue",
    worker: "tag-yellow", user: "tag-gray",
  };

  return (
    <div className="page-content">
      <div className="page-header">
        <h2>All Users</h2>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <input className="form-input" type="search" placeholder="Search users…" value={search} onChange={e => setSearch(e.target.value)} style={{ width: 200 }} />
          {isSuperAdmin && <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ Add Co-Admin</button>}
        </div>
      </div>

      {!isSuperAdmin && (
        <div style={{ background: "#fef3c7", border: "1px solid #fbbf24", borderRadius: 10, padding: "0.6rem 1rem", fontSize: "0.82rem", color: "#78350f", marginBottom: "1rem" }}>
          👁️ View-only mode — only super_admin can create or delete users.
        </div>
      )}

      {error && <p className="error-msg">{error}</p>}

      <div className="table-wrap">
        <table>
          <thead><tr><th>NAME</th><th>EMAIL</th><th>ROLE</th><th>JOINED</th>{isSuperAdmin && <th>ACTION</th>}</tr></thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} style={{ textAlign: "center", padding: "2rem", color: "var(--ink-3)" }}>Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={5} style={{ textAlign: "center", padding: "2rem", color: "var(--ink-3)" }}>No users found</td></tr>
            ) : filtered.map(u => (
              <tr key={u.uid}>
                <td style={{ fontWeight: 600 }}>{u.name || "—"}</td>
                <td style={{ fontSize: "0.82rem", color: "var(--ink-3)" }}>{u.email || "—"}</td>
                <td><span className={`tag ${roleTag[u.role] ?? "tag-gray"}`}>{u.role}</span></td>
                <td style={{ fontSize: "0.78rem", color: "var(--ink-3)" }}>{u.created_at ? new Date(u.created_at).toLocaleDateString("en-IN") : "—"}</td>
                {isSuperAdmin && (
                  <td>
                    {u.role !== "super_admin" && (
                      <button className="btn btn-ghost" style={{ fontSize: "0.78rem", padding: "0.25rem 0.5rem", color: "#ef4444" }} onClick={() => setDeleteTarget(u)}>🗑 Delete</button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Create Co-Admin Modal */}
      {showCreate && isSuperAdmin && (
        <div className="modal-overlay" onClick={() => setShowCreate(false)}>
          <div className="modal-sheet" onClick={e => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "1rem" }}>
              <h3>Add Co-Admin</h3>
              <button onClick={() => setShowCreate(false)} style={{ background: "none", border: "none", fontSize: "1.2rem", cursor: "pointer" }}>✕</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <div><label className="form-label">Full Name</label><input className="form-input" placeholder="e.g. Priya Sharma" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} /></div>
              <div><label className="form-label">Login Email</label><input className="form-input" type="email" placeholder="coadmin@example.com" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} /></div>
              <div><label className="form-label">Password (min 8 chars)</label><input className="form-input" type="password" placeholder="Set a strong password" value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))} /></div>
              {formError && <p className="error-msg">{formError}</p>}
              <button className="btn btn-primary btn-full" disabled={formBusy} onClick={handleCreateCoAdmin}>
                {formBusy ? "Creating…" : "Create Co-Admin →"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm */}
      {deleteTarget && isSuperAdmin && (
        <div className="modal-overlay" onClick={() => setDeleteTarget(null)}>
          <div className="modal-sheet" onClick={e => e.stopPropagation()} style={{ maxWidth: 360, textAlign: "center" }}>
            <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>⚠️</div>
            <h3>Delete User?</h3>
            <p style={{ fontSize: "0.85rem", color: "var(--ink-3)", margin: "0.5rem 0 1rem" }}>Permanently delete <strong>{deleteTarget.name || deleteTarget.email}</strong>? This cannot be undone.</p>
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button className="btn btn-ghost btn-full" onClick={() => setDeleteTarget(null)}>Cancel</button>
              <button className="btn btn-primary btn-full" style={{ background: "#ef4444" }} onClick={handleDelete}>Yes, Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


function CitiesSection() {
  const INIT_CITIES = [
    { id: "city1", name: "Mumbai", state: "Maharashtra", colleges: 12, canteens: 8, active: true },
    { id: "city2", name: "Rajasthan", state: "Rajasthan", colleges: 5, canteens: 3, active: true },
    { id: "city3", name: "Chennai", state: "Tamil Nadu", colleges: 9, canteens: 6, active: true },
    { id: "city4", name: "Vellore", state: "Tamil Nadu", colleges: 3, canteens: 2, active: false },
    { id: "city5", name: "Delhi NCR", state: "Delhi", colleges: 18, canteens: 14, active: true },
  ];
  const INIT_COLLEGES = [
    { id: "col1", name: "IIT Bombay", city: "Mumbai", students: 8200, canteens: 4, active: true },
    { id: "col2", name: "BITS Pilani", city: "Rajasthan", students: 6500, canteens: 3, active: true },
    { id: "col3", name: "NIT Trichy", city: "Chennai", students: 5400, canteens: 2, active: true },
    { id: "col4", name: "VIT Vellore", city: "Vellore", students: 25000, canteens: 6, active: false },
  ];
  type City = typeof INIT_CITIES[number];
  type College = typeof INIT_COLLEGES[number];

  const [tab, setTab] = useState<"cities" | "colleges">("cities");
  const [cities, setCities] = useState<City[]>(INIT_CITIES);
  const [colleges, setColleges] = useState<College[]>(INIT_COLLEGES);
  const [modal, setModal] = useState<{ type: "city" | "college"; item: City | College | null } | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});

  const openAddCity = () => { setModal({ type: "city", item: null }); setForm({ name: "", state: "" }); };
  const openEditCity = (c: City) => { setModal({ type: "city", item: c }); setForm({ name: c.name, state: c.state }); };
  const openAddCollege = () => { setModal({ type: "college", item: null }); setForm({ name: "", city: "", students: "" }); };
  const openEditCollege = (c: College) => { setModal({ type: "college", item: c }); setForm({ name: c.name, city: c.city, students: String(c.students) }); };

  const saveModal = () => {
    if (modal?.type === "city") {
      if (modal.item) {
        setCities(prev => prev.map(c => c.id === (modal.item as City).id ? { ...c, name: form.name, state: form.state } : c));
      } else {
        setCities(prev => [...prev, { id: `city${Date.now()}`, name: form.name, state: form.state, colleges: 0, canteens: 0, active: true }]);
      }
    } else if (modal?.type === "college") {
      if (modal.item) {
        setColleges(prev => prev.map(c => c.id === (modal.item as College).id ? { ...c, name: form.name, city: form.city, students: Number(form.students) } : c));
      } else {
        setColleges(prev => [...prev, { id: `col${Date.now()}`, name: form.name, city: form.city, students: Number(form.students) || 0, canteens: 0, active: true }]);
      }
    }
    setModal(null);
  };

  return (
    <div className="page-content">
      <div className="page-header">
        <h2>Cities & Colleges</h2>
        <button className="btn btn-primary" style={{ fontSize: "0.85rem", padding: "0.5rem 1rem" }}
          onClick={tab === "cities" ? openAddCity : openAddCollege}>
          + Add {tab === "cities" ? "City" : "College"}
        </button>
      </div>

      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
        {(["cities", "colleges"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`btn ${tab === t ? "btn-primary" : "btn-ghost"}`}
            style={{ fontSize: "0.85rem", padding: "0.4rem 1rem", textTransform: "capitalize" }}>
            {t === "cities" ? "🏙 Cities" : "🎓 Colleges"}
          </button>
        ))}
      </div>

      {tab === "cities" && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>CITY</th><th>STATE</th><th>COLLEGES</th><th>CANTEENS</th><th>STATUS</th><th>ACTION</th></tr></thead>
            <tbody>
              {cities.map(c => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 600 }}>{c.name}</td>
                  <td style={{ fontSize: "0.82rem" }}>{c.state}</td>
                  <td>{c.colleges}</td>
                  <td>{c.canteens}</td>
                  <td>
                    <button
                      className={`tag ${c.active ? "tag-green" : "tag-gray"}`}
                      style={{ cursor: "pointer", background: "none", border: "none" }}
                      onClick={() => setCities(prev => prev.map(x => x.id === c.id ? { ...x, active: !x.active } : x))}
                    >{c.active ? "● Active" : "○ Inactive"}</button>
                  </td>
                  <td><button className="btn btn-ghost" style={{ fontSize: "0.78rem", padding: "0.25rem 0.5rem" }} onClick={() => openEditCity(c)}>Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "colleges" && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>COLLEGE</th><th>CITY</th><th>STUDENTS</th><th>CANTEENS</th><th>STATUS</th><th>ACTION</th></tr></thead>
            <tbody>
              {colleges.map(c => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 600 }}>{c.name}</td>
                  <td style={{ fontSize: "0.82rem" }}>{c.city}</td>
                  <td>{c.students.toLocaleString()}</td>
                  <td>{c.canteens}</td>
                  <td>
                    <button
                      className={`tag ${c.active ? "tag-green" : "tag-gray"}`}
                      style={{ cursor: "pointer", background: "none", border: "none" }}
                      onClick={() => setColleges(prev => prev.map(x => x.id === c.id ? { ...x, active: !x.active } : x))}
                    >{c.active ? "● Active" : "○ Inactive"}</button>
                  </td>
                  <td><button className="btn btn-ghost" style={{ fontSize: "0.78rem", padding: "0.25rem 0.5rem" }} onClick={() => openEditCollege(c)}>Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal-sheet" onClick={e => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "1rem" }}>
              <h3>{modal.item ? "Edit" : "Add"} {modal.type === "city" ? "City" : "College"}</h3>
              <button onClick={() => setModal(null)} style={{ background: "none", border: "none", fontSize: "1.2rem", cursor: "pointer" }}>✕</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <div>
                <label className="form-label">{modal.type === "city" ? "City" : "College"} Name</label>
                <input className="form-input" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Enter name" />
              </div>
              {modal.type === "city" && (
                <div>
                  <label className="form-label">State</label>
                  <input className="form-input" value={form.state} onChange={e => setForm(p => ({ ...p, state: e.target.value }))} placeholder="e.g. Maharashtra" />
                </div>
              )}
              {modal.type === "college" && (
                <>
                  <div>
                    <label className="form-label">City</label>
                    <input className="form-input" value={form.city} onChange={e => setForm(p => ({ ...p, city: e.target.value }))} placeholder="e.g. Mumbai" />
                  </div>
                  <div>
                    <label className="form-label">Student Count</label>
                    <input className="form-input" type="number" value={form.students} onChange={e => setForm(p => ({ ...p, students: e.target.value }))} placeholder="e.g. 8000" />
                  </div>
                </>
              )}
              <button className="btn btn-primary btn-full" onClick={saveModal} style={{ marginTop: "0.5rem" }}>
                {modal.item ? "Save Changes" : `Add ${modal.type === "city" ? "City" : "College"}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SupportSection() {
  const { session } = useAuth();
  const [tickets,      setTickets]      = useState<SupportTicket[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [err,          setErr]          = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [selected,     setSelected]     = useState<SupportTicket | null>(null);
  const [adminNotes,   setAdminNotes]   = useState("");
  const [updating,     setUpdating]     = useState(false);

  const load = async () => {
    if (!session?.access_token) return;
    setLoading(true); setErr(null);
    try {
      const url = filterStatus === "all" ? "/api/support" : `/api/support?status=${filterStatus}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${session.access_token}` } });
      const d = await res.json();
      if (!res.ok) { setErr(d.error ?? "Failed"); return; }
      setTickets(d.tickets ?? []);
    } catch { setErr("Network error"); } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [filterStatus, session?.access_token]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateTicket = async (id: string, patch: Record<string, string>) => {
    if (!session?.access_token) return;
    setUpdating(true);
    try {
      const res = await fetch(`/api/support/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify(patch),
      });
      const d = await res.json();
      if (res.ok) {
        setTickets(prev => prev.map(t => t.id === id ? { ...t, ...d.ticket } : t));
        if (selected?.id === id) setSelected(prev => prev ? { ...prev, ...d.ticket } : null);
      }
    } finally { setUpdating(false); }
  };

  const saveNotes = () => {
    if (!selected) return;
    updateTicket(selected.id, { admin_notes: adminNotes });
  };

  const openTicket = (t: SupportTicket) => {
    setSelected(t);
    setAdminNotes(t.admin_notes ?? "");
  };

  const priorityColor: Record<string, string> = { critical: "var(--red)", high: "var(--orange)", medium: "var(--yellow)", low: "var(--ink-3)" };
  const statusTag: Record<string, string> = { open: "tag-blue", in_progress: "tag-orange", escalated: "tag-orange", resolved: "tag-green", closed: "tag-green" };
  const categoryLabel: Record<string, string> = {
    payment_issue: "Payment Issue", order_not_found: "Order Not Found",
    otp_mismatch: "OTP Mismatch", vendor_refused: "Vendor Refused",
    refund_request: "Refund Request", menu_issue: "Menu Issue",
    app_bug: "App Bug", other: "Other",
  };

  const counts = {
    open: tickets.filter(t => t.status === "open").length,
    escalated: tickets.filter(t => t.status === "escalated").length,
    resolved: tickets.filter(t => ["resolved", "closed"].includes(t.status)).length,
  };

  return (
    <div className="page-content">
      <div className="page-header">
        <h2>Complaints &amp; Escalations</h2>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <button className="btn btn-ghost" style={{ fontSize: "0.78rem" }} onClick={load}>↻</button>
          {(["all", "open", "in_progress", "escalated", "resolved"] as const).map(s => (
            <button key={s} onClick={() => setFilterStatus(s)} className={`btn ${filterStatus === s ? "btn-primary" : "btn-ghost"}`}
              style={{ fontSize: "0.75rem", padding: "0.3rem 0.6rem", textTransform: "capitalize" }}>
              {s === "in_progress" ? "In Progress" : s}
            </button>
          ))}
        </div>
      </div>

      <div className="stats-row" style={{ gridTemplateColumns: "repeat(3, 1fr)", marginBottom: "1rem" }}>
        <div className="stat-card"><div className="stat-num" style={{ color: "var(--red)" }}>{counts.open}</div><div className="stat-label">Open Tickets</div></div>
        <div className="stat-card"><div className="stat-num" style={{ color: "var(--orange)" }}>{counts.escalated}</div><div className="stat-label">Escalated</div></div>
        <div className="stat-card"><div className="stat-num" style={{ color: "var(--green)" }}>{counts.resolved}</div><div className="stat-label">Resolved</div></div>
      </div>

      {loading && <div style={{ color: "var(--ink-3)", padding: "2rem", textAlign: "center" }}>Loading tickets…</div>}
      {!loading && err && <div className="error-msg">{err}</div>}

      {!loading && !err && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>REF</th><th>BY</th><th>CATEGORY</th><th>SUBJECT</th><th>CANTEEN</th><th>PRIORITY</th><th>STATUS</th><th>TIME</th><th>ACTIONS</th></tr></thead>
            <tbody>
              {tickets.map(t => (
                <tr key={t.id} style={{ cursor: "pointer" }} onClick={() => openTicket(t)}>
                  <td style={{ fontSize: "0.75rem", fontFamily: "monospace", color: "var(--ink-3)" }}>{t.ticket_ref}</td>
                  <td style={{ fontWeight: 600, fontSize: "0.82rem" }}>{(t.raised_profile as { name?: string } | null)?.name ?? "—"}<div style={{ fontSize: "0.68rem", color: "var(--ink-3)", textTransform: "capitalize" }}>{t.raised_by_role}</div></td>
                  <td><span className="tag tag-blue" style={{ fontSize: "0.68rem" }}>{categoryLabel[t.category] ?? t.category}</span></td>
                  <td style={{ fontSize: "0.82rem", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.subject}</td>
                  <td style={{ fontSize: "0.75rem", color: "var(--ink-3)" }}>{(t.canteen as { name?: string } | null)?.name ?? "—"}</td>
                  <td><span style={{ fontSize: "0.72rem", fontWeight: 700, color: priorityColor[t.priority], textTransform: "uppercase" }}>{t.priority}</span></td>
                  <td><span className={`tag ${statusTag[t.status] ?? "tag-yellow"}`} style={{ textTransform: "capitalize" }}>{t.status.replace("_", " ")}</span></td>
                  <td style={{ fontSize: "0.72rem", color: "var(--ink-3)" }}>{relativeTime(t.created_at)}</td>
                  <td style={{ display: "flex", gap: "0.25rem" }}>
                    {t.status === "open" && (
                      <button className="btn btn-ghost" style={{ fontSize: "0.68rem", padding: "0.15rem 0.4rem", color: "var(--orange)" }}
                        onClick={e => { e.stopPropagation(); updateTicket(t.id, { status: "in_progress" }); }}>In Progress</button>
                    )}
                    {["open","in_progress"].includes(t.status) && (
                      <button className="btn btn-ghost" style={{ fontSize: "0.68rem", padding: "0.15rem 0.4rem", color: "var(--orange)" }}
                        onClick={e => { e.stopPropagation(); updateTicket(t.id, { status: "escalated" }); }}>Escalate</button>
                    )}
                    {t.status !== "resolved" && t.status !== "closed" && (
                      <button className="btn btn-ghost" style={{ fontSize: "0.68rem", padding: "0.15rem 0.4rem", color: "var(--green)" }}
                        onClick={e => { e.stopPropagation(); updateTicket(t.id, { status: "resolved" }); }}>Resolve</button>
                    )}
                  </td>
                </tr>
              ))}
              {tickets.length === 0 && (
                <tr><td colSpan={9} style={{ textAlign: "center", color: "var(--ink-3)", padding: "2rem" }}>No tickets found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Ticket Detail Modal ── */}
      {selected && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={e => { if (e.target === e.currentTarget) setSelected(null); }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: "1.5rem", width: 520, maxWidth: "92vw", maxHeight: "80vh", overflowY: "auto", boxShadow: "0 8px 40px rgba(0,0,0,0.2)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1rem" }}>
              <div>
                <div style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "var(--ink-3)" }}>{selected.ticket_ref}</div>
                <h3 style={{ fontWeight: 800, fontSize: "1.05rem", margin: "0.2rem 0" }}>{selected.subject}</h3>
                <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                  <span className={`tag ${statusTag[selected.status]}`} style={{ textTransform: "capitalize" }}>{selected.status.replace("_"," ")}</span>
                  <span style={{ fontSize: "0.72rem", fontWeight: 700, color: priorityColor[selected.priority], textTransform: "uppercase" }}>{selected.priority}</span>
                  <span className="tag tag-blue" style={{ fontSize: "0.68rem" }}>{categoryLabel[selected.category] ?? selected.category}</span>
                </div>
              </div>
              <button onClick={() => setSelected(null)} style={{ background: "none", border: "none", fontSize: "1.2rem", cursor: "pointer", color: "var(--ink-3)" }}>✕</button>
            </div>

            <div style={{ marginBottom: "0.75rem" }}>
              <div style={{ fontSize: "0.72rem", color: "var(--ink-3)", fontWeight: 600, marginBottom: "0.25rem", textTransform: "uppercase" }}>Raised by</div>
              <div style={{ fontSize: "0.85rem" }}>{(selected.raised_profile as { name?: string; email?: string } | null)?.name ?? "Unknown"} <span style={{ color: "var(--ink-3)" }}>· {selected.raised_by_role} · {relativeTime(selected.created_at)}</span></div>
            </div>

            {(selected.canteen as { name?: string } | null)?.name && (
              <div style={{ marginBottom: "0.75rem" }}>
                <div style={{ fontSize: "0.72rem", color: "var(--ink-3)", fontWeight: 600, marginBottom: "0.25rem", textTransform: "uppercase" }}>Canteen</div>
                <div style={{ fontSize: "0.85rem" }}>{(selected.canteen as { name?: string }).name}</div>
              </div>
            )}

            <div style={{ marginBottom: "1rem" }}>
              <div style={{ fontSize: "0.72rem", color: "var(--ink-3)", fontWeight: 600, marginBottom: "0.25rem", textTransform: "uppercase" }}>Description</div>
              <div style={{ fontSize: "0.88rem", background: "var(--surface)", borderRadius: 8, padding: "0.65rem", lineHeight: 1.6 }}>{selected.description}</div>
            </div>

            <div style={{ marginBottom: "1rem" }}>
              <div style={{ fontSize: "0.72rem", color: "var(--ink-3)", fontWeight: 600, marginBottom: "0.4rem", textTransform: "uppercase" }}>Admin Notes</div>
              <textarea rows={3} value={adminNotes} onChange={e => setAdminNotes(e.target.value)}
                placeholder="Add internal notes here…"
                style={{ width: "100%", padding: "0.55rem", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: "0.85rem", resize: "vertical", boxSizing: "border-box" }} />
              <button className="btn btn-ghost" style={{ fontSize: "0.78rem", marginTop: "0.35rem" }} disabled={updating} onClick={saveNotes}>
                {updating ? "Saving…" : "Save Notes"}
              </button>
            </div>

            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              {selected.status !== "resolved" && selected.status !== "closed" && (
                <button className="btn btn-primary" style={{ fontSize: "0.82rem" }} disabled={updating}
                  onClick={() => updateTicket(selected.id, { status: "resolved", admin_notes: adminNotes })}>
                  ✓ Mark Resolved
                </button>
              )}
              {selected.status === "open" && (
                <button className="btn btn-ghost" style={{ fontSize: "0.82rem", color: "var(--orange)" }} disabled={updating}
                  onClick={() => updateTicket(selected.id, { status: "escalated" })}>Escalate</button>
              )}
              {selected.status === "open" && (
                <button className="btn btn-ghost" style={{ fontSize: "0.82rem" }} disabled={updating}
                  onClick={() => updateTicket(selected.id, { status: "in_progress" })}>Mark In Progress</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface SupportTicket {
  id: string; ticket_ref: string; raised_by_role: string;
  category: string; subject: string; description: string;
  priority: string; status: string; admin_notes: string | null;
  created_at: string; resolved_at: string | null;
  raised_profile: unknown; canteen: unknown;
}
function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000)     return "Just now";
  if (diff < 3600000)   return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000)  return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}



function AnalyticsSection() {
  const revenueData = [
    { month: "Nov", value: 148000 },
    { month: "Dec", value: 192000 },
    { month: "Jan", value: 176000 },
    { month: "Feb", value: 214000 },
    { month: "Mar", value: 198000 },
    { month: "Apr", value: 240000 },
  ];
  const ordersData = [
    { month: "Nov", value: 9200 },
    { month: "Dec", value: 11800 },
    { month: "Jan", value: 10600 },
    { month: "Feb", value: 13400 },
    { month: "Mar", value: 12200 },
    { month: "Apr", value: 14820 },
  ];
  const canteenShare = [
    { name: "IIT Bombay – Main", pct: 42, color: "#f97316" },
    { name: "BITS Pilani – Mess", pct: 33, color: "#3b82f6" },
    { name: "VIT Vellore – Caf 2", pct: 25, color: "#22c55e" },
  ];
  const topItems = [
    { name: "Veg Thali", orders: 4820, revenue: "₹72,300", canteen: "IIT Bombay" },
    { name: "Masala Dosa", orders: 3940, revenue: "₹59,100", canteen: "VIT Vellore" },
    { name: "Chicken Curry", orders: 3210, revenue: "₹96,300", canteen: "BITS Pilani" },
    { name: "Cold Coffee", orders: 2890, revenue: "₹57,800", canteen: "IIT Bombay" },
    { name: "Samosa (2 pc)", orders: 2640, revenue: "₹26,400", canteen: "VIT Vellore" },
  ];

  const maxRev = Math.max(...revenueData.map(d => d.value));
  const maxOrd = Math.max(...ordersData.map(d => d.value));

  // Build SVG polyline points for revenue line chart
  const chartW = 480, chartH = 120, padX = 10;
  const revPoints = revenueData.map((d, i) => {
    const x = padX + (i / (revenueData.length - 1)) * (chartW - padX * 2);
    const y = chartH - (d.value / maxRev) * (chartH - 16) - 4;
    return `${x},${y}`;
  }).join(" ");

  // Donut chart helpers
  const donutR = 52, donutCX = 64, donutCY = 64, circumference = 2 * Math.PI * donutR;
  let cumulativePct = 0;
  const donutSegments = canteenShare.map(seg => {
    const dash = (seg.pct / 100) * circumference;
    const offset = circumference - cumulativePct / 100 * circumference;
    cumulativePct += seg.pct;
    return { ...seg, dash, offset };
  });

  return (
    <div className="page-content">
      <div className="page-header"><h2>Platform Analytics</h2><span className="tag tag-green">● Live</span></div>

      {/* KPI row */}
      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-num">₹2.4L</div>
          <div className="stat-label">Revenue This Month</div>
          <div style={{ fontSize: "0.75rem", color: "var(--green)", marginTop: 2 }}>▲ 21% vs last month</div>
        </div>
        <div className="stat-card">
          <div className="stat-num">14,820</div>
          <div className="stat-label">Orders This Month</div>
          <div style={{ fontSize: "0.75rem", color: "var(--green)", marginTop: 2 }}>▲ 18% vs last month</div>
        </div>
        <div className="stat-card">
          <div className="stat-num">2,841</div>
          <div className="stat-label">Active Users</div>
          <div style={{ fontSize: "0.75rem", color: "var(--green)", marginTop: 2 }}>▲ 128 new this week</div>
        </div>
        <div className="stat-card">
          <div className="stat-num" style={{ color: "var(--green)" }}>4.4★</div>
          <div className="stat-label">Avg Platform Rating</div>
          <div style={{ fontSize: "0.75rem", color: "var(--ink-3)", marginTop: 2 }}>across 3 canteens</div>
        </div>
      </div>

      {/* Revenue line chart + Donut side by side */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 260px", gap: "1rem", marginBottom: "1rem" }}>

        {/* Revenue line chart */}
        <div className="card" style={{ padding: "1.25rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
            <div style={{ fontWeight: 700, fontSize: "0.95rem" }}>Monthly Revenue (₹)</div>
            <span style={{ fontSize: "0.75rem", color: "var(--ink-3)" }}>Last 6 months</span>
          </div>
          <svg viewBox={`0 0 ${chartW} ${chartH + 24}`} style={{ width: "100%", height: 140, overflow: "visible" }}>
            {/* Grid lines */}
            {[0, 0.25, 0.5, 0.75, 1].map(t => {
              const y = chartH - t * (chartH - 16) - 4;
              return (
                <g key={t}>
                  <line x1={padX} y1={y} x2={chartW - padX} y2={y} stroke="#e5e7eb" strokeWidth="1" />
                  <text x={padX - 2} y={y + 4} fontSize="8" fill="#9ca3af" textAnchor="end">
                    {t === 0 ? "0" : `₹${(t * maxRev / 1000).toFixed(0)}k`}
                  </text>
                </g>
              );
            })}
            {/* Area fill */}
            <defs>
              <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#f97316" stopOpacity="0.2" />
                <stop offset="100%" stopColor="#f97316" stopOpacity="0" />
              </linearGradient>
            </defs>
            <polygon
              points={`${padX},${chartH - 4} ${revPoints} ${chartW - padX},${chartH - 4}`}
              fill="url(#revGrad)"
            />
            {/* Line */}
            <polyline points={revPoints} fill="none" stroke="#f97316" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
            {/* Dots + month labels */}
            {revenueData.map((d, i) => {
              const x = padX + (i / (revenueData.length - 1)) * (chartW - padX * 2);
              const y = chartH - (d.value / maxRev) * (chartH - 16) - 4;
              return (
                <g key={i}>
                  <circle cx={x} cy={y} r="4" fill="#f97316" />
                  <text x={x} y={chartH + 16} fontSize="9" fill="#6b7280" textAnchor="middle">{d.month}</text>
                  <text x={x} y={y - 8} fontSize="8" fill="#f97316" textAnchor="middle">₹{(d.value / 1000).toFixed(0)}k</text>
                </g>
              );
            })}
          </svg>
        </div>

        {/* Donut chart */}
        <div className="card" style={{ padding: "1.25rem" }}>
          <div style={{ fontWeight: 700, fontSize: "0.95rem", marginBottom: "0.75rem" }}>Revenue by Canteen</div>
          <svg viewBox="0 0 128 128" style={{ width: 128, height: 128, display: "block", margin: "0 auto" }}>
            {donutSegments.map((seg, i) => (
              <circle
                key={i}
                cx={donutCX} cy={donutCY} r={donutR}
                fill="none"
                stroke={seg.color}
                strokeWidth="20"
                strokeDasharray={`${seg.dash} ${circumference - seg.dash}`}
                strokeDashoffset={seg.offset}
                style={{ transform: "rotate(-90deg)", transformOrigin: `${donutCX}px ${donutCY}px` }}
              />
            ))}
            <text x={donutCX} y={donutCY - 4} textAnchor="middle" fontSize="11" fontWeight="700" fill="#111">₹2.4L</text>
            <text x={donutCX} y={donutCY + 10} textAnchor="middle" fontSize="7" fill="#6b7280">total</text>
          </svg>
          <div style={{ marginTop: "0.75rem", display: "flex", flexDirection: "column", gap: "0.35rem" }}>
            {canteenShare.map(seg => (
              <div key={seg.name} style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.72rem" }}>
                <span style={{ width: 10, height: 10, borderRadius: "50%", background: seg.color, flexShrink: 0 }} />
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{seg.name}</span>
                <strong>{seg.pct}%</strong>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Orders bar chart */}
      <div className="card" style={{ padding: "1.25rem", marginBottom: "1rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
          <div style={{ fontWeight: 700, fontSize: "0.95rem" }}>Monthly Orders</div>
          <span style={{ fontSize: "0.75rem", color: "var(--ink-3)" }}>Last 6 months</span>
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: "0.5rem", height: 100 }}>
          {ordersData.map((d, i) => {
            const pct = d.value / maxOrd;
            const isLast = i === ordersData.length - 1;
            return (
              <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: "0.25rem" }}>
                <span style={{ fontSize: "0.65rem", color: isLast ? "var(--orange)" : "var(--ink-3)", fontWeight: isLast ? 700 : 400 }}>
                  {(d.value / 1000).toFixed(1)}k
                </span>
                <div style={{
                  width: "100%", background: isLast ? "var(--orange)" : "#e5e7eb",
                  height: `${pct * 72}px`, borderRadius: "4px 4px 0 0",
                  transition: "height 0.3s"
                }} />
                <span style={{ fontSize: "0.7rem", color: "var(--ink-3)" }}>{d.month}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Top selling items */}
      <div className="card" style={{ padding: "1.25rem" }}>
        <div style={{ fontWeight: 700, fontSize: "0.95rem", marginBottom: "0.75rem" }}>🏆 Top Selling Items</div>
        <div className="table-wrap" style={{ margin: 0 }}>
          <table>
            <thead>
              <tr><th>#</th><th>ITEM</th><th>CANTEEN</th><th>ORDERS</th><th>REVENUE</th><th>SHARE</th></tr>
            </thead>
            <tbody>
              {topItems.map((item, i) => {
                const maxOrders = topItems[0].orders;
                const pct = Math.round((item.orders / maxOrders) * 100);
                return (
                  <tr key={i}>
                    <td style={{ color: "var(--ink-3)", fontWeight: 600 }}>{i + 1}</td>
                    <td style={{ fontWeight: 600 }}>{item.name}</td>
                    <td style={{ fontSize: "0.8rem", color: "var(--ink-3)" }}>{item.canteen}</td>
                    <td>{item.orders.toLocaleString()}</td>
                    <td style={{ fontWeight: 700, color: "var(--green)" }}>{item.revenue}</td>
                    <td style={{ minWidth: 80 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                        <div style={{ flex: 1, height: 6, background: "#f3f4f6", borderRadius: 3 }}>
                          <div style={{ width: `${pct}%`, height: "100%", background: "var(--orange)", borderRadius: 3 }} />
                        </div>
                        <span style={{ fontSize: "0.7rem", color: "var(--ink-3)" }}>{pct}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function PaymentsSection() {
  const { session } = useAuth();
  const [tab, setTab] = useState<"settlements" | "bank_details" | "weekly_report" | "fee_settings">("settlements");

  // ── Settlements tab ──
  const [data,    setData]    = useState<SettlementRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [err,     setErr]     = useState<string | null>(null);
  const [settle,  setSettle]  = useState<SettlementRow | null>(null); // pay modal

  // ── Pay modal ──
  const [payFull,  setPayFull]  = useState(true);
  const [payAmt,   setPayAmt]   = useState("");
  const [payMode,  setPayMode]  = useState("upi");
  const [payRef,   setPayRef]   = useState("");
  const [payNotes, setPayNotes] = useState("");
  const [paying,   setPaying]   = useState(false);
  const [payErr,   setPayErr]   = useState<string | null>(null);
  const [payOk,    setPayOk]    = useState(false);

  // ── Bank details tab ──
  const [bankCanteenId, setBankCanteenId] = useState("");
  const [bankDetails,   setBankDetails]   = useState<BankDetails | null>(null);
  const [bankForm,      setBankForm]      = useState({ account_name: "", account_no: "", ifsc_code: "", bank_name: "", upi_id: "", gpay_number: "" });
  const [bankLoading,   setBankLoading]   = useState(false);
  const [bankErr,       setBankErr]       = useState<string | null>(null);
  const [bankOk,        setBankOk]        = useState(false);

  // ── Weekly report tab ──
  const [weeks,         setWeeks]         = useState(8);
  const [report,        setReport]        = useState<{ weeks: WeekRow[]; totals: Record<string, number> } | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportErr,     setReportErr]     = useState<string | null>(null);

  // ── Fee config tab ──
  const [feeConfig,  setFeeConfig]  = useState<FeeConfig>({ charge_pct: 2, flat_charge: 0, gst_pct: 18 });
  const [feeLoading, setFeeLoading] = useState(false);
  const [feeSaving,  setFeeSaving]  = useState(false);
  const [feeErr,     setFeeErr]     = useState<string | null>(null);
  const [feeOk,      setFeeOk]      = useState(false);

  const fmt = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtPct = (n: number) => `${n.toFixed(2)}%`;

  // ── Load settlements ──
  const loadSettlements = async () => {
    if (!session?.access_token) return;
    setLoading(true); setErr(null);
    try {
      const res = await fetch("/api/admin/settlements", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const d = await res.json();
      if (!res.ok) { setErr(d.error ?? "Failed to load"); return; }
      setData(d.canteens ?? []);
    } catch { setErr("Network error"); } finally { setLoading(false); }
  };
  useEffect(() => { loadSettlements(); }, [session?.access_token]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Open pay modal ──
  const openPay = (row: SettlementRow) => {
    setSettle(row);
    setPayFull(true);
    setPayAmt(String(row.amount_remaining > 0 ? row.amount_remaining.toFixed(2) : row.net_payable.toFixed(2)));
    setPayMode("upi");
    setPayRef(""); setPayNotes(""); setPayErr(null); setPayOk(false);
  };

  // ── Submit manual payment ──
  const handlePay = async () => {
    if (!settle || !session?.access_token) return;
    const amt = payFull ? settle.amount_remaining : Number(payAmt);
    if (!amt || isNaN(amt) || amt <= 0) { setPayErr("Enter a valid amount."); return; }
    setPaying(true); setPayErr(null); setPayOk(false);
    try {
      const res = await fetch("/api/admin/settlements/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          canteen_id:      settle.canteen_id,
          amount_paid:     amt,
          payment_mode:    payMode,
          transaction_ref: payRef   || undefined,
          notes:           payNotes || undefined,
          period_start:    new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10),
          period_end:      new Date().toISOString().slice(0, 10),
          gross_amount:    settle.gross_amount,
          platform_charge: settle.platform_charge_amount,
          gst_on_charge:   settle.gst_on_charge,
          net_payable:     settle.net_payable,
        }),
      });
      const d = await res.json();
      if (!res.ok) { setPayErr(d.error ?? "Failed"); setPaying(false); return; }
      setPayOk(true);
      setTimeout(() => { setSettle(null); setPayOk(false); loadSettlements(); }, 1500);
    } catch { setPayErr("Network error"); } finally { setPaying(false); }
  };

  // ── Load bank details for a canteen ──
  const loadBankDetails = async (cid: string) => {
    if (!cid || !session?.access_token) return;
    setBankLoading(true); setBankErr(null);
    try {
      const res = await fetch(`/api/admin/canteen-bank?canteen_id=${cid}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const d = await res.json();
      if (!res.ok) { setBankErr(d.error ?? "Failed"); return; }
      const bd: BankDetails | null = d.bank_details?.[0] ?? null;
      setBankDetails(bd);
      setBankForm({
        account_name: bd?.account_name ?? "",
        account_no:   bd?.account_no   ?? "",
        ifsc_code:    bd?.ifsc_code    ?? "",
        bank_name:    bd?.bank_name    ?? "",
        upi_id:       bd?.upi_id       ?? "",
        gpay_number:  bd?.gpay_number  ?? "",
      });
    } catch { setBankErr("Network error"); } finally { setBankLoading(false); }
  };

  const handleBankSave = async () => {
    if (!bankCanteenId || !session?.access_token) return;
    setBankLoading(true); setBankErr(null); setBankOk(false);
    try {
      const res = await fetch("/api/admin/canteen-bank", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ canteen_id: bankCanteenId, ...bankForm, ifsc_code: bankForm.ifsc_code.toUpperCase() }),
      });
      const d = await res.json();
      if (!res.ok) { setBankErr(d.error ?? "Failed"); setBankLoading(false); return; }
      setBankOk(true);
      setBankDetails(d.bank_details);
      // refresh settlements so bank_details inline shows updated
      loadSettlements();
      setTimeout(() => setBankOk(false), 3000);
    } catch { setBankErr("Network error"); } finally { setBankLoading(false); }
  };

  // ── Load weekly report ──
  const loadReport = async () => {
    if (!session?.access_token) return;
    setReportLoading(true); setReportErr(null);
    try {
      const res = await fetch(`/api/admin/settlements/weekly-report?weeks=${weeks}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const d = await res.json();
      if (!res.ok) { setReportErr(d.error ?? "Failed"); return; }
      setReport(d);
    } catch { setReportErr("Network error"); } finally { setReportLoading(false); }
  };
  useEffect(() => { if (tab === "weekly_report") loadReport(); }, [tab, weeks]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load fee config ──
  useEffect(() => {
    if (tab !== "fee_settings" || !session?.access_token) return;
    setFeeLoading(true);
    fetch("/api/admin/platform-charges", { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then(r => r.json())
      .then(d => {
        if (d.platform_charges) setFeeConfig({ charge_pct: d.platform_charges.charge_pct ?? 2, flat_charge: d.platform_charges.flat_charge ?? 0, gst_pct: d.platform_charges.gst_pct ?? 18 });
      })
      .finally(() => setFeeLoading(false));
  }, [tab, session?.access_token]);

  const handleFeeSave = async () => {
    if (!session?.access_token) return;
    setFeeSaving(true); setFeeErr(null); setFeeOk(false);
    try {
      const res = await fetch("/api/admin/platform-charges", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify(feeConfig),
      });
      const d = await res.json();
      if (!res.ok) { setFeeErr(d.error ?? "Failed"); return; }
      setFeeOk(true);
      setTimeout(() => setFeeOk(false), 3000);
    } catch { setFeeErr("Network error"); } finally { setFeeSaving(false); }
  };

  // ── Summary stats ──
  const total_gross   = (data ?? []).reduce((s, r) => s + r.gross_amount, 0);
  const total_net     = (data ?? []).reduce((s, r) => s + r.net_payable, 0);
  const total_paid    = (data ?? []).reduce((s, r) => s + r.amount_paid, 0);
  const total_pending = (data ?? []).reduce((s, r) => s + r.amount_remaining, 0);

  const statusTag: Record<string, string>   = { paid: "tag-green", partial: "tag-orange", pending: "tag-yellow" };
  const statusLabel: Record<string, string> = { paid: "Settled",   partial: "Partial",    pending: "Pending" };

  const SUB_TABS = [
    { id: "settlements",   label: "💳 Settlements" },
    { id: "bank_details",  label: "🏦 Bank Details" },
    { id: "weekly_report", label: "📊 Weekly Report" },
    { id: "fee_settings",  label: "⚙️ Fee Settings" },
  ] as const;

  return (
    <div className="page-content">
      <div className="page-header">
        <h2>Payments &amp; Settlements</h2>
        <button className="btn btn-ghost" style={{ fontSize: "0.8rem" }} onClick={loadSettlements}>↻ Refresh</button>
      </div>

      {/* Sub-tab nav */}
      <div style={{ display: "flex", gap: "0.25rem", marginBottom: "1.25rem", borderBottom: "2px solid var(--border)", paddingBottom: "0.5rem", flexWrap: "wrap" }}>
        {SUB_TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ padding: "0.4rem 0.9rem", border: "none", background: "none", cursor: "pointer", fontSize: "0.82rem", fontWeight: tab === t.id ? 700 : 400,
              color: tab === t.id ? "var(--primary)" : "var(--ink-3)",
              borderBottom: tab === t.id ? "2px solid var(--primary)" : "2px solid transparent",
              marginBottom: "-2px", borderRadius: "4px 4px 0 0" }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ═══════════════ SETTLEMENTS TAB ═══════════════ */}
      {tab === "settlements" && (
        <>
          {/* Summary cards */}
          {data && (
            <div className="dashboard-grid" style={{ marginBottom: "1.25rem" }}>
              {[
                { label: "Gross Collected",   value: fmt(total_gross),              color: "var(--ink)"    },
                { label: "Platform Earnings", value: fmt(total_gross - total_net),  color: "var(--blue)"   },
                { label: "Net Payable",       value: fmt(total_net),                color: "var(--orange)" },
                { label: "Paid Out",          value: fmt(total_paid),               color: "var(--green)"  },
                { label: "Pending Payout",    value: fmt(total_pending),            color: "var(--red)"    },
              ].map(c => (
                <div key={c.label} className="stat-card">
                  <div className="stat-num" style={{ color: c.color, fontSize: "1.15rem" }}>{c.value}</div>
                  <div className="stat-label">{c.label}</div>
                </div>
              ))}
            </div>
          )}

          {loading && <div style={{ color: "var(--ink-3)", padding: "2rem", textAlign: "center" }}>Loading settlements…</div>}
          {!loading && err && <div className="error-msg">{err}</div>}
          {!loading && data && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>CANTEEN</th><th>ORDERS</th><th>GROSS</th>
                    <th>PLATFORM FEE</th><th>NET PAYABLE</th>
                    <th>PAID</th><th>PENDING</th><th>BANK / UPI</th><th>STATUS</th><th>ACTION</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map(r => {
                    const bd = r.bank_details;
                    return (
                      <tr key={r.canteen_id}>
                        <td style={{ fontWeight: 600 }}>{r.canteen_name}
                          <div style={{ fontSize: "0.7rem", color: "var(--ink-3)" }}>{r.city}</div>
                        </td>
                        <td style={{ fontSize: "0.82rem" }}>{r.completed_orders} / {r.total_orders}</td>
                        <td style={{ fontWeight: 600 }}>{fmt(r.gross_amount)}</td>
                        <td style={{ color: "var(--red)" }}>{fmt(r.platform_charge_amount)}</td>
                        <td style={{ fontWeight: 700 }}>{fmt(r.net_payable)}</td>
                        <td style={{ color: "var(--green)" }}>{fmt(r.amount_paid)}</td>
                        <td style={{ color: r.amount_remaining > 0 ? "var(--red)" : "var(--ink-3)" }}>{fmt(r.amount_remaining)}</td>
                        <td style={{ fontSize: "0.72rem" }}>
                          {bd ? (
                            <span title={`${bd.account_name} | ${bd.account_no} | ${bd.ifsc_code}`}>
                              {bd.upi_id ? <span style={{ color: "var(--blue)" }}>📲 {bd.upi_id.slice(0, 14)}{bd.upi_id.length > 14 ? "…" : ""}</span> : null}
                              {bd.upi_id && bd.account_no ? <br /> : null}
                              {bd.account_no ? <span style={{ color: "var(--ink-2)" }}>🏦 {bd.account_no.slice(-4).padStart(bd.account_no.length, "•")}</span> : null}
                            </span>
                          ) : <span style={{ color: "var(--ink-3)" }}>—</span>}
                        </td>
                        <td><span className={`tag ${statusTag[r.payment_status] ?? "tag-yellow"}`}>{statusLabel[r.payment_status] ?? r.payment_status}</span></td>
                        <td>
                          {r.amount_remaining > 0 ? (
                            <button className="btn btn-primary" style={{ fontSize: "0.72rem", padding: "0.25rem 0.65rem" }} onClick={() => openPay(r)}>
                              💸 Pay
                            </button>
                          ) : r.net_payable > 0 ? (
                            <span style={{ fontSize: "0.72rem", color: "var(--green)" }}>✓ Settled</span>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                  {data.length === 0 && (
                    <tr><td colSpan={10} style={{ textAlign: "center", color: "var(--ink-3)", padding: "2rem" }}>No settlement data.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Payment history */}
          {!loading && data && data.some(r => r.payments && r.payments.length > 0) && (
            <div style={{ marginTop: "1.5rem" }}>
              <h3 style={{ fontSize: "0.95rem", fontWeight: 700, marginBottom: "0.75rem" }}>Payment History</h3>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>DATE</th><th>CANTEEN</th><th>AMOUNT</th><th>MODE</th><th>REF / UTR</th><th>NOTES</th></tr></thead>
                  <tbody>
                    {data.flatMap(r =>
                      (r.payments ?? []).map((p: PaymentRecord) => (
                        <tr key={p.id}>
                          <td style={{ fontSize: "0.78rem" }}>{new Date(p.created_at).toLocaleDateString("en-IN")}</td>
                          <td style={{ fontSize: "0.82rem" }}>{r.canteen_name}</td>
                          <td style={{ fontWeight: 700, color: "var(--green)" }}>{fmt(p.amount_paid)}</td>
                          <td><span className="tag tag-blue" style={{ textTransform: "uppercase", fontSize: "0.7rem" }}>{p.payment_mode}</span></td>
                          <td style={{ fontSize: "0.75rem", fontFamily: "monospace", color: "var(--ink-3)" }}>{p.transaction_ref || "—"}</td>
                          <td style={{ fontSize: "0.75rem", color: "var(--ink-3)" }}>{p.notes || "—"}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* ═══════════════ BANK DETAILS TAB ═══════════════ */}
      {tab === "bank_details" && (
        <div style={{ maxWidth: 560 }}>
          <div style={{ marginBottom: "1rem" }}>
            <label style={{ fontSize: "0.8rem", fontWeight: 700, display: "block", marginBottom: "0.4rem" }}>Select Canteen</label>
            <select
              value={bankCanteenId}
              onChange={e => { setBankCanteenId(e.target.value); setBankDetails(null); setBankForm({ account_name: "", account_no: "", ifsc_code: "", bank_name: "", upi_id: "", gpay_number: "" }); setBankErr(null); setBankOk(false); if (e.target.value) loadBankDetails(e.target.value); }}
              style={{ padding: "0.55rem 0.8rem", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: "0.88rem", width: "100%" }}>
              <option value="">— Choose a canteen —</option>
              {(data ?? []).map(r => <option key={r.canteen_id} value={r.canteen_id}>{r.canteen_name} ({r.city})</option>)}
            </select>
          </div>

          {bankLoading && <div style={{ color: "var(--ink-3)", padding: "1rem" }}>Loading…</div>}

          {bankCanteenId && !bankLoading && (
            <>
              <div style={{ background: "var(--bg-2, #f7f7fa)", borderRadius: 12, padding: "1.1rem", marginBottom: "1rem" }}>
                <div style={{ fontWeight: 700, fontSize: "0.88rem", marginBottom: "0.75rem", color: "var(--ink-2)" }}>🏦 Bank Account</div>
                {[
                  { key: "account_name", label: "Account Holder Name *", placeholder: "Full name as per bank" },
                  { key: "account_no",   label: "Account Number *",       placeholder: "e.g. 1234567890" },
                  { key: "ifsc_code",    label: "IFSC Code *",             placeholder: "e.g. HDFC0001234" },
                  { key: "bank_name",    label: "Bank Name",               placeholder: "e.g. HDFC Bank" },
                ].map(f => (
                  <div key={f.key} style={{ marginBottom: "0.6rem" }}>
                    <label style={{ fontSize: "0.72rem", fontWeight: 600, display: "block", marginBottom: "0.2rem" }}>{f.label}</label>
                    <input type="text" placeholder={f.placeholder} value={(bankForm as Record<string, string>)[f.key]}
                      onChange={e => setBankForm(p => ({ ...p, [f.key]: e.target.value }))}
                      style={{ width: "100%", padding: "0.5rem", border: "1.5px solid var(--border)", borderRadius: 7, fontSize: "0.87rem", boxSizing: "border-box" }} />
                  </div>
                ))}
              </div>

              <div style={{ background: "var(--bg-2, #f7f7fa)", borderRadius: 12, padding: "1.1rem", marginBottom: "1rem" }}>
                <div style={{ fontWeight: 700, fontSize: "0.88rem", marginBottom: "0.75rem", color: "var(--ink-2)" }}>📲 UPI Details</div>
                {[
                  { key: "upi_id",      label: "UPI ID",      placeholder: "e.g. name@upi or phone@paytm" },
                  { key: "gpay_number", label: "GPay Number", placeholder: "10-digit mobile number linked to GPay" },
                ].map(f => (
                  <div key={f.key} style={{ marginBottom: "0.6rem" }}>
                    <label style={{ fontSize: "0.72rem", fontWeight: 600, display: "block", marginBottom: "0.2rem" }}>{f.label}</label>
                    <input type="text" placeholder={f.placeholder} value={(bankForm as Record<string, string>)[f.key]}
                      onChange={e => setBankForm(p => ({ ...p, [f.key]: e.target.value }))}
                      style={{ width: "100%", padding: "0.5rem", border: "1.5px solid var(--border)", borderRadius: 7, fontSize: "0.87rem", boxSizing: "border-box" }} />
                  </div>
                ))}
              </div>

              {bankErr && <div className="error-msg" style={{ marginBottom: "0.5rem" }}>{bankErr}</div>}
              {bankOk  && <div style={{ color: "var(--green)", fontWeight: 600, fontSize: "0.85rem", marginBottom: "0.5rem" }}>✓ Bank details saved!</div>}

              <button className="btn btn-primary" disabled={bankLoading} onClick={handleBankSave} style={{ width: "100%" }}>
                {bankLoading ? "Saving…" : "💾 Save Bank / UPI Details"}
              </button>

              {bankDetails && (
                <div style={{ marginTop: "0.75rem", fontSize: "0.75rem", color: "var(--ink-3)", textAlign: "center" }}>
                  Last saved — IFSC: {bankDetails.ifsc_code} | A/C: ****{bankDetails.account_no.slice(-4)}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ═══════════════ WEEKLY REPORT TAB ═══════════════ */}
      {tab === "weekly_report" && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1rem" }}>
            <label style={{ fontSize: "0.82rem", fontWeight: 600 }}>Show last</label>
            <select value={weeks} onChange={e => setWeeks(Number(e.target.value))}
              style={{ padding: "0.4rem 0.6rem", border: "1.5px solid var(--border)", borderRadius: 7, fontSize: "0.85rem" }}>
              {[4, 8, 12, 26].map(w => <option key={w} value={w}>{w} weeks</option>)}
            </select>
            <button className="btn btn-ghost" style={{ fontSize: "0.8rem" }} onClick={loadReport}>↻ Refresh</button>
          </div>

          {reportLoading && <div style={{ color: "var(--ink-3)", padding: "2rem", textAlign: "center" }}>Loading report…</div>}
          {!reportLoading && reportErr && <div className="error-msg">{reportErr}</div>}

          {!reportLoading && report && (
            <>
              {/* Totals */}
              <div className="dashboard-grid" style={{ marginBottom: "1.25rem" }}>
                {[
                  { label: "Gross Collected",    value: fmt(report.totals.gross         ?? 0), color: "var(--ink)"    },
                  { label: "Platform Fees",      value: fmt(report.totals.platform_fee  ?? 0), color: "var(--blue)"   },
                  { label: "GST on Fees",        value: fmt(report.totals.gst_on_fee    ?? 0), color: "var(--ink-2)"  },
                  { label: "Total Platform Rev", value: fmt(report.totals.total_platform_earnings ?? 0), color: "var(--primary)" },
                  { label: "Net Payable",        value: fmt(report.totals.net_payable   ?? 0), color: "var(--orange)" },
                  { label: "Amount Paid",        value: fmt(report.totals.amount_paid   ?? 0), color: "var(--green)"  },
                  { label: "Pending",            value: fmt(report.totals.amount_pending ?? 0), color: "var(--red)"  },
                ].map(c => (
                  <div key={c.label} className="stat-card">
                    <div className="stat-num" style={{ color: c.color, fontSize: "1.05rem" }}>{c.value}</div>
                    <div className="stat-label">{c.label}</div>
                  </div>
                ))}
              </div>

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>WEEK</th><th>ORDERS</th><th>GROSS</th><th>PLATFORM FEE</th>
                      <th>GST</th><th>TOTAL PLATFORM REV</th><th>NET PAYABLE</th><th>PAID</th><th>PENDING</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.weeks.map((w: WeekRow) => (
                      <tr key={w.week_start}>
                        <td style={{ fontSize: "0.78rem", whiteSpace: "nowrap" }}>
                          {new Date(w.week_start).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                          {" – "}
                          {new Date(w.week_end).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                        </td>
                        <td style={{ fontSize: "0.82rem" }}>{w.completed_orders} / {w.total_orders}</td>
                        <td>{fmt(w.gross)}</td>
                        <td style={{ color: "var(--red)" }}>{fmt(w.platform_fee)}</td>
                        <td style={{ color: "var(--ink-2)", fontSize: "0.82rem" }}>{fmt(w.gst_on_fee)}</td>
                        <td style={{ fontWeight: 700, color: "var(--primary)" }}>{fmt(w.total_platform_earnings)}</td>
                        <td>{fmt(w.net_payable)}</td>
                        <td style={{ color: "var(--green)" }}>{fmt(w.amount_paid)}</td>
                        <td style={{ color: w.amount_pending > 0 ? "var(--red)" : "var(--ink-3)" }}>{fmt(w.amount_pending)}</td>
                      </tr>
                    ))}
                    {report.weeks.length === 0 && (
                      <tr><td colSpan={9} style={{ textAlign: "center", color: "var(--ink-3)", padding: "1.5rem" }}>No data yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}

      {/* ═══════════════ FEE SETTINGS TAB ═══════════════ */}
      {tab === "fee_settings" && (
        <div style={{ maxWidth: 400 }}>
          {feeLoading && <div style={{ color: "var(--ink-3)", padding: "1rem" }}>Loading…</div>}
          {!feeLoading && (
            <>
              <div style={{ background: "var(--bg-2, #f7f7fa)", borderRadius: 12, padding: "1.25rem", marginBottom: "1rem" }}>
                <div style={{ fontWeight: 700, fontSize: "0.9rem", marginBottom: "1rem" }}>Platform Charge Configuration</div>
                <p style={{ fontSize: "0.78rem", color: "var(--ink-3)", marginBottom: "1rem" }}>
                  For each order: Final platform fee = (order_value × charge_pct / 100) + flat_charge. GST is applied on top of that fee.
                  Net payable to canteen = gross − total_platform_fee.
                </p>
                {[
                  { key: "charge_pct",  label: "Charge %",          unit: "%",         placeholder: "e.g. 2" },
                  { key: "flat_charge", label: "Flat Charge per Order", unit: "₹",      placeholder: "e.g. 0 or 2" },
                  { key: "gst_pct",     label: "GST on Platform Fee",  unit: "%",       placeholder: "e.g. 18" },
                ].map(f => (
                  <div key={f.key} style={{ marginBottom: "0.75rem" }}>
                    <label style={{ fontSize: "0.78rem", fontWeight: 600, display: "block", marginBottom: "0.3rem" }}>{f.label} ({f.unit})</label>
                    <input type="number" min="0" step="0.01" placeholder={f.placeholder}
                      value={(feeConfig as unknown as Record<string, number>)[f.key]}
                      onChange={e => setFeeConfig(p => ({ ...p, [f.key]: Number(e.target.value) }))}
                      style={{ width: "100%", padding: "0.5rem", border: "1.5px solid var(--border)", borderRadius: 7, fontSize: "0.9rem", boxSizing: "border-box" }} />
                  </div>
                ))}

                <div style={{ fontSize: "0.78rem", color: "var(--ink-3)", background: "#fff", borderRadius: 8, padding: "0.6rem 0.8rem", marginTop: "0.5rem" }}>
                  Preview on ₹100 order: platform fee = {fmtPct(feeConfig.charge_pct)} × ₹100 + ₹{feeConfig.flat_charge.toFixed(2)} = ₹{(100 * feeConfig.charge_pct / 100 + feeConfig.flat_charge).toFixed(2)}, GST = ₹{((100 * feeConfig.charge_pct / 100 + feeConfig.flat_charge) * feeConfig.gst_pct / 100).toFixed(2)}
                </div>
              </div>

              {feeErr && <div className="error-msg" style={{ marginBottom: "0.5rem" }}>{feeErr}</div>}
              {feeOk  && <div style={{ color: "var(--green)", fontWeight: 600, fontSize: "0.85rem", marginBottom: "0.5rem" }}>✓ Saved!</div>}

              <button className="btn btn-primary" style={{ width: "100%" }} disabled={feeSaving} onClick={handleFeeSave}>
                {feeSaving ? "Saving…" : "💾 Save Fee Configuration"}
              </button>
            </>
          )}
        </div>
      )}

      {/* ═══════════════ PAY MODAL ═══════════════ */}
      {settle && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}
          onClick={e => { if (e.target === e.currentTarget) setSettle(null); }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: "1.5rem", width: 460, maxWidth: "96vw", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 8px 40px rgba(0,0,0,0.22)" }}>
            <h3 style={{ fontWeight: 800, fontSize: "1.05rem", marginBottom: "0.15rem" }}>💸 Pay {settle.canteen_name}</h3>
            <p style={{ fontSize: "0.8rem", color: "var(--ink-3)", marginBottom: "1.1rem" }}>{settle.city}</p>

            {/* Fee breakdown */}
            <div style={{ background: "#f8f9fb", borderRadius: 10, padding: "0.9rem 1rem", marginBottom: "1.1rem", fontSize: "0.82rem" }}>
              {[
                { label: "Gross Collected",  value: fmt(settle.gross_amount),         color: "var(--ink)"   },
                { label: "Platform Fee",     value: `–${fmt(settle.platform_charge_amount)}`, color: "var(--red)" },
                { label: "GST on Fee",       value: `–${fmt(settle.gst_on_charge)}`,   color: "var(--red)"   },
                { label: "Net Payable",      value: fmt(settle.net_payable),           color: "var(--primary)", fw: 700 },
                { label: "Already Paid",     value: `–${fmt(settle.amount_paid)}`,     color: "var(--green)" },
                { label: "Remaining",        value: fmt(settle.amount_remaining),      color: "var(--orange)", fw: 800 },
              ].map(item => (
                <div key={item.label} style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.3rem" }}>
                  <span style={{ color: "var(--ink-3)" }}>{item.label}</span>
                  <span style={{ color: item.color, fontWeight: (item as { fw?: number }).fw ?? 500 }}>{item.value}</span>
                </div>
              ))}
            </div>

            {/* Bank / UPI details */}
            {settle.bank_details && (
              <div style={{ background: "#f0f7ff", border: "1px solid #cce0ff", borderRadius: 10, padding: "0.9rem 1rem", marginBottom: "1rem", fontSize: "0.82rem" }}>
                <div style={{ fontWeight: 700, marginBottom: "0.5rem", color: "var(--blue)" }}>Bank / UPI Details</div>
                {settle.bank_details.upi_id && (
                  <div style={{ marginBottom: "0.5rem" }}>
                    <span style={{ color: "var(--ink-2)" }}>UPI:</span>{" "}
                    <span style={{ fontFamily: "monospace", fontWeight: 600 }}>{settle.bank_details.upi_id}</span>
                    {" "}
                    <a href={`upi://pay?pa=${encodeURIComponent(settle.bank_details.upi_id)}&pn=${encodeURIComponent(settle.canteen_name)}&am=${payFull ? settle.amount_remaining : (Number(payAmt) || settle.amount_remaining)}&cu=INR`}
                      target="_blank" rel="noopener noreferrer"
                      style={{ marginLeft: "0.5rem", background: "var(--primary)", color: "#fff", padding: "0.2rem 0.6rem", borderRadius: 6, fontSize: "0.72rem", textDecoration: "none", fontWeight: 700 }}>
                      Open UPI App
                    </a>
                  </div>
                )}
                {settle.bank_details.gpay_number && (
                  <div style={{ marginBottom: "0.4rem" }}>
                    <span style={{ color: "var(--ink-2)" }}>GPay:</span>{" "}
                    <span style={{ fontFamily: "monospace" }}>{settle.bank_details.gpay_number}</span>
                  </div>
                )}
                {settle.bank_details.account_no && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem", marginTop: "0.3rem", paddingTop: "0.4rem", borderTop: "1px solid #cce0ff" }}>
                    <div><span style={{ color: "var(--ink-2)" }}>Account:</span> <span style={{ fontFamily: "monospace" }}>{settle.bank_details.account_no}</span></div>
                    <div><span style={{ color: "var(--ink-2)" }}>IFSC:</span> <span style={{ fontFamily: "monospace" }}>{settle.bank_details.ifsc_code}</span></div>
                    {settle.bank_details.bank_name && <div><span style={{ color: "var(--ink-2)" }}>Bank:</span> {settle.bank_details.bank_name}</div>}
                    <div><span style={{ color: "var(--ink-2)" }}>Name:</span> {settle.bank_details.account_name}</div>
                  </div>
                )}
              </div>
            )}
            {!settle.bank_details && (
              <div style={{ background: "#fff8e1", border: "1px solid #ffe082", borderRadius: 10, padding: "0.75rem", marginBottom: "1rem", fontSize: "0.8rem", color: "#7a5f00" }}>
                ⚠️ No bank/UPI details on file. Go to the <strong>Bank Details</strong> tab to add them.
              </div>
            )}

            {/* Amount */}
            <div style={{ marginBottom: "0.75rem" }}>
              <label style={{ fontSize: "0.78rem", fontWeight: 600, display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.35rem" }}>
                <input type="checkbox" checked={payFull} onChange={e => { setPayFull(e.target.checked); if (e.target.checked) setPayAmt(String(settle.amount_remaining.toFixed(2))); }}
                  style={{ width: 15, height: 15 }} />
                Pay full remaining amount ({fmt(settle.amount_remaining)})
              </label>
              {!payFull && (
                <input type="number" min="1" step="0.01" placeholder="Custom amount (₹)" value={payAmt}
                  onChange={e => setPayAmt(e.target.value)}
                  style={{ width: "100%", padding: "0.5rem", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: "0.9rem", boxSizing: "border-box" }} />
              )}
            </div>

            {/* Payment mode */}
            <div style={{ marginBottom: "0.75rem" }}>
              <label style={{ fontSize: "0.78rem", fontWeight: 600, display: "block", marginBottom: "0.3rem" }}>Payment Mode *</label>
              <select value={payMode} onChange={e => setPayMode(e.target.value)}
                style={{ width: "100%", padding: "0.5rem", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: "0.88rem" }}>
                <option value="upi">UPI</option>
                <option value="bank_transfer">Bank Transfer (NEFT / RTGS / IMPS)</option>
                <option value="cash">Cash</option>
                <option value="other">Other</option>
              </select>
            </div>

            {/* UTR ref */}
            <div style={{ marginBottom: "0.75rem" }}>
              <label style={{ fontSize: "0.78rem", fontWeight: 600, display: "block", marginBottom: "0.3rem" }}>Transaction Ref / UTR (recommended)</label>
              <input type="text" placeholder="e.g. UTR1234567890 or Txn ID" value={payRef} onChange={e => setPayRef(e.target.value)}
                style={{ width: "100%", padding: "0.5rem", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: "0.88rem", boxSizing: "border-box" }} />
            </div>

            {/* Notes */}
            <div style={{ marginBottom: "1rem" }}>
              <label style={{ fontSize: "0.78rem", fontWeight: 600, display: "block", marginBottom: "0.3rem" }}>Notes (optional)</label>
              <input type="text" placeholder="e.g. July week 2 settlement" value={payNotes} onChange={e => setPayNotes(e.target.value)}
                style={{ width: "100%", padding: "0.5rem", border: "1.5px solid var(--border)", borderRadius: 8, fontSize: "0.88rem", boxSizing: "border-box" }} />
            </div>

            {payErr && <div className="error-msg" style={{ marginBottom: "0.75rem" }}>{payErr}</div>}
            {payOk  && <div style={{ color: "var(--green)", fontWeight: 700, fontSize: "0.9rem", marginBottom: "0.75rem" }}>✓ Payment recorded successfully!</div>}

            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button className="btn btn-primary" style={{ flex: 1 }} disabled={paying || payOk} onClick={handlePay}>
                {paying ? "Recording…" : "✅ Record Payment"}
              </button>
              <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setSettle(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface BankDetails {
  account_name: string; account_no: string; ifsc_code: string; bank_name: string | null;
  upi_id: string | null; gpay_number: string | null;
}
interface SettlementRow {
  canteen_id: string; canteen_name: string; city: string;
  total_orders: number; completed_orders: number;
  gross_amount: number; platform_charge_amount: number; gst_on_charge: number;
  net_payable: number; amount_paid: number; amount_remaining: number;
  payment_status: string; payments: PaymentRecord[];
  bank_details: BankDetails | null;
}
interface PaymentRecord {
  id: string; amount_paid: number; payment_mode: string;
  transaction_ref: string | null; notes: string | null; created_at: string;
}
interface WeekRow {
  week_start: string; week_end: string; total_orders: number; completed_orders: number;
  gross: number; platform_fee: number; gst_on_fee: number;
  total_platform_earnings: number; net_payable: number; amount_paid: number; amount_pending: number;
}
interface FeeConfig { id?: string; charge_pct: number; flat_charge: number; gst_pct: number; }


// ─── Account / Change Password ────────────────────────────────────────────────
function AccountSection() {
  const { session } = useAuth();
  const [newPwd,     setNewPwd]     = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [showPwd,    setShowPwd]    = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [msg,        setMsg]        = useState<{ type: "success" | "error"; text: string } | null>(null);

  const handleChange = async () => {
    setMsg(null);
    if (!newPwd)              { setMsg({ type: "error", text: "Please enter a new password." }); return; }
    if (newPwd.length < 8)    { setMsg({ type: "error", text: "Password must be at least 8 characters." }); return; }
    if (newPwd !== confirmPwd){ setMsg({ type: "error", text: "Passwords do not match." }); return; }
    if (!session?.access_token){ setMsg({ type: "error", text: "You are not logged in. Please refresh." }); return; }

    setSaving(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ password: newPwd }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg({ type: "error", text: data.error || "Failed to update password." });
      } else {
        setMsg({ type: "success", text: "Password updated successfully!" });
        setNewPwd("");
        setConfirmPwd("");
      }
    } catch {
      setMsg({ type: "error", text: "Network error — please try again." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-content">
      <div className="page-header"><h2>My Account</h2></div>
      <div className="card" style={{ maxWidth: 440 }}>
        <h3 style={{ marginBottom: "1rem", fontSize: "0.9rem", fontWeight: 700 }}>Change Password</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <div>
            <label className="form-label">New Password <span style={{ fontWeight: 400, color: "var(--ink-3)", fontSize: "0.78rem" }}>(min 8 characters)</span></label>
            <div style={{ position: "relative" }}>
              <input
                className="form-input"
                type={showPwd ? "text" : "password"}
                value={newPwd}
                onChange={e => setNewPwd(e.target.value)}
                placeholder="Enter new password"
                autoComplete="new-password"
                style={{ paddingRight: "2.5rem" }}
              />
              <button
                type="button"
                onClick={() => setShowPwd(v => !v)}
                style={{ position: "absolute", right: "0.6rem", top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", fontSize: "1rem", color: "var(--ink-3)" }}
              >
                {showPwd ? "🙈" : "👁️"}
              </button>
            </div>
          </div>
          <div>
            <label className="form-label">Confirm New Password</label>
            <input
              className="form-input"
              type={showPwd ? "text" : "password"}
              value={confirmPwd}
              onChange={e => setConfirmPwd(e.target.value)}
              placeholder="Re-enter new password"
              autoComplete="new-password"
            />
          </div>
          {msg && (
            <p style={{ fontSize: "0.85rem", color: msg.type === "success" ? "var(--green)" : "var(--red)", margin: 0 }}>
              {msg.type === "success" ? "✓ " : "⚠ "}{msg.text}
            </p>
          )}
          <button className="btn btn-primary" style={{ alignSelf: "flex-start", padding: "0.5rem 1.5rem" }} onClick={handleChange} disabled={saving}>
            {saving ? "Updating…" : "Update Password"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── NOTIFICATIONS SECTION ────────────────────────────────────────────────────
interface NotificationRecord {
  id: string;
  title: string;
  body: string;
  recipient_type: string;
  recipient_id: string | null;
  created_at: string;
}

function NotificationsSection({ session, isSuperAdmin }: { session: { access_token?: string } | null; isSuperAdmin: boolean }) {
  const [title, setTitle]         = useState("");
  const [message, setMessage]     = useState("");
  const [recipientType, setType]  = useState("all");
  const [recipientId, setRid]     = useState("");
  const [sending, setSending]     = useState(false);
  const [msg, setMsg]             = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [history, setHistory]     = useState<NotificationRecord[]>([]);
  const [loadingHist, setLoadingH]= useState(true);

  const fetchHistory = async () => {
    if (!session?.access_token) return;
    try {
      const res = await fetch("/api/notifications", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = await res.json();
      setHistory(data.notifications ?? []);
    } catch { /* ignore */ }
    finally { setLoadingH(false); }
  };

  useEffect(() => { fetchHistory(); }, []); // eslint-disable-line

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !message.trim()) return;
    if ((recipientType === "canteen" || recipientType === "user") && !recipientId.trim()) {
      setMsg({ type: "error", text: "Please enter the recipient ID." });
      return;
    }
    setSending(true); setMsg(null);
    try {
      const res = await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({
          title: title.trim(),
          message: message.trim(),
          recipient_type: recipientType,
          recipient_id: (recipientType === "canteen" || recipientType === "user") ? recipientId.trim() : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to send.");
      setMsg({ type: "success", text: "Notification sent successfully!" });
      setTitle(""); setMessage(""); setRid("");
      fetchHistory();
    } catch (err) {
      setMsg({ type: "error", text: err instanceof Error ? err.message : "Failed to send notification." });
    } finally { setSending(false); }
  };

  const RECIPIENT_OPTS = [
    { value: "all",          label: "All Users & Canteens" },
    { value: "all_users",    label: "All Users only" },
    { value: "all_canteens", label: "All Canteens only" },
    { value: "canteen",      label: "Specific Canteen (by ID)" },
    { value: "user",         label: "Specific User (by ID)" },
  ];

  const needsId = recipientType === "canteen" || recipientType === "user";

  return (
    <div className="page-content">
      <div className="page-header">
        <h2>🔔 Push Notifications</h2>
        <span className="tag tag-blue">Broadcast</span>
      </div>

      {/* Send Form */}
      <div className="card" style={{ maxWidth: 560, marginBottom: "2rem" }}>
        <h3 style={{ fontSize: "0.95rem", fontWeight: 700, marginBottom: "1.25rem" }}>Send a Notification</h3>
        <form onSubmit={handleSend} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div>
            <label className="form-label">Title</label>
            <input
              className="form-input"
              type="text"
              maxLength={120}
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Canteen closed today"
              required
            />
          </div>
          <div>
            <label className="form-label">Message</label>
            <textarea
              className="form-input"
              rows={3}
              maxLength={500}
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder="Enter your message…"
              required
              style={{ resize: "vertical", fontFamily: "inherit" }}
            />
          </div>
          <div>
            <label className="form-label">Send To</label>
            <select
              className="form-input"
              value={recipientType}
              onChange={e => { setType(e.target.value); setRid(""); }}
            >
              {RECIPIENT_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          {needsId && (
            <div>
              <label className="form-label">{recipientType === "canteen" ? "Canteen ID" : "User ID"}</label>
              <input
                className="form-input"
                type="text"
                value={recipientId}
                onChange={e => setRid(e.target.value)}
                placeholder={`Paste the ${recipientType === "canteen" ? "canteen" : "user"} UUID here`}
                required
              />
            </div>
          )}
          {msg && (
            <p style={{ fontSize: "0.85rem", color: msg.type === "success" ? "var(--green)" : "var(--red)", margin: 0 }}>
              {msg.type === "success" ? "✓ " : "⚠ "}{msg.text}
            </p>
          )}
          <button
            type="submit"
            className="btn btn-primary"
            style={{ alignSelf: "flex-start", padding: "0.55rem 1.75rem" }}
            disabled={sending || !isSuperAdmin}
          >
            {sending ? "Sending…" : "📤 Send Notification"}
          </button>
          {!isSuperAdmin && (
            <p style={{ fontSize: "0.78rem", color: "var(--ink-3)", margin: 0 }}>
              Only super admins can send notifications.
            </p>
          )}
        </form>
      </div>

      {/* History */}
      <div className="card">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
          <h3 style={{ fontSize: "0.95rem", fontWeight: 700, margin: 0 }}>Recent Notifications</h3>
          <button className="btn btn-secondary" onClick={fetchHistory} style={{ fontSize: "0.78rem", padding: "0.3rem 0.75rem" }}>↻ Refresh</button>
        </div>
        {loadingHist ? (
          <div style={{ textAlign: "center", padding: "2rem", color: "var(--ink-3)", fontSize: "0.85rem" }}>Loading…</div>
        ) : history.length === 0 ? (
          <div style={{ textAlign: "center", padding: "2rem", color: "var(--ink-3)", fontSize: "0.85rem" }}>No notifications sent yet.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.65rem" }}>
            {history.map(n => (
              <div key={n.id} style={{ background: "var(--surface-2, #f8fafc)", borderRadius: 10, padding: "0.85rem 1rem", border: "1px solid var(--border, #e2e8f0)" }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "0.75rem" }}>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontWeight: 700, fontSize: "0.92rem", margin: "0 0 0.2rem" }}>{n.title}</p>
                    <p style={{ fontSize: "0.84rem", color: "var(--ink-2, #64748b)", margin: "0 0 0.5rem" }}>{n.body}</p>
                    <span style={{ fontSize: "0.72rem", background: "#e0e7ff", color: "#4338ca", borderRadius: 6, padding: "0.15rem 0.5rem", fontWeight: 600 }}>
                      {RECIPIENT_OPTS.find(o => o.value === n.recipient_type)?.label ?? n.recipient_type}
                    </span>
                  </div>
                  <span style={{ fontSize: "0.72rem", color: "var(--ink-3, #94a3b8)", whiteSpace: "nowrap" as const, marginTop: "0.1rem" }}>
                    {new Date(n.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}


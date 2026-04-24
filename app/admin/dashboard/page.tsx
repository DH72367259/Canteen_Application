"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

type AdminSection = "overview" | "canteens" | "users" | "cities" | "analytics" | "payments" | "support";

const ADMIN_NAV = [
  { id: "overview",  icon: "📊", label: "Dashboard" },
  { id: "canteens",  icon: "🏪", label: "Manage Canteens" },
  { id: "users",     icon: "👥", label: "All Users" },
  { id: "cities",    icon: "🏫", label: "Cities & Colleges" },
  { id: "analytics", icon: "📈", label: "Analytics" },
  { id: "payments",  icon: "💳", label: "Payments" },
  { id: "support",   icon: "🎧", label: "Support" },
];

export default function SuperAdminDashboard() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const [section, setSection] = useState<AdminSection>("overview");

  useEffect(() => {
    if (user && user.role !== "super_admin") router.push("/login");
  }, [user, router]);

  const handleLogout = async () => { await logout(); router.push("/login"); };

  return (
    <div className="web-shell">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="logo-badge"><span className="dot" />Canteen Admin</div>
          <p>Super Administrator</p>
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
        {section === "overview" && <OverviewSection />}
        {section === "canteens" && <CanteensSection />}
        {section === "users" && <UsersSection />}
        {section === "analytics" && <AnalyticsSection />}
        {section === "payments" && <PaymentsSection />}
        {section === "cities" && <CitiesSection />}
        {section === "support" && <SupportSection />}
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
  const [form, setForm] = useState({ name: "", college: "", city: "", address: "", lat: "", lng: "", gmapLink: "", status: "active" as "active" | "inactive" });
  const [gmapParseError, setGmapParseError] = useState("");

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
    setForm({ name: c.name, college: c.college, city: c.city, address: c.address, lat: c.lat, lng: c.lng, gmapLink: c.gmapLink, status: c.status });
    setAdding(false);
    setGmapParseError("");
  };
  const openAdd = () => {
    setEditing(null);
    setForm({ name: "", college: "", city: "", address: "", lat: "", lng: "", gmapLink: "", status: "active" });
    setAdding(true);
    setGmapParseError("");
  };
  const closeModal = () => { setEditing(null); setAdding(false); setGmapParseError(""); };

  const saveEdit = () => {
    if (!form.name.trim()) return;
    if (!form.lat.trim() || !form.lng.trim()) {
      setGmapParseError("Latitude and Longitude are required.");
      return;
    }
    if (editing) {
      setCanteens(prev => prev.map(c => c.id === editing.id ? { ...c, ...form } : c));
    } else {
      setCanteens(prev => [...prev, { id: `c${Date.now()}`, ...form, orders: 0, revenue: "₹0" }]);
    }
    closeModal();
  };

  const toggleStatus = async (id: string) => {
    const canteen = canteens.find(c => c.id === id);
    if (!canteen) return;
    const next = canteen.status === "active" ? "inactive" : "active";
    // Optimistic update
    setCanteens(prev => prev.map(c => c.id === id ? { ...c, status: next } : c));
    try {
      const session = typeof window !== "undefined"
        ? JSON.parse(localStorage.getItem("supabase.auth.token") || "{}")?.currentSession?.access_token
        : null;
      if (session) {
        const res = await fetch(`/api/canteens/${id}/toggle`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session}` },
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
                <td>
                  <button className="btn btn-ghost" style={{ fontSize: "0.78rem", padding: "0.25rem 0.5rem" }} onClick={() => openEdit(c)}>Edit</button>
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
              <button className="btn btn-primary btn-full" onClick={saveEdit} style={{ marginTop: "0.5rem" }}>
                {adding ? "Create Canteen" : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function UsersSection() {
  const INIT = [
    { id: "u1", name: "Arjun Sharma", phone: "+91 98765 43210", college: "IIT Bombay", orders: 28, rewards: "₹42", joined: "Jun 2025", role: "user" },
    { id: "u2", name: "Priya Menon", phone: "+91 90123 45678", college: "BITS Pilani", orders: 14, rewards: "₹18", joined: "Jul 2025", role: "user" },
    { id: "u3", name: "Karan Das", phone: "+91 87654 32109", college: "NIT Trichy", orders: 6, rewards: "₹8", joined: "Jul 2025", role: "worker" },
    { id: "u4", name: "Sneha Joshi", phone: "+91 81234 56789", college: "VIT Vellore", orders: 35, rewards: "₹62", joined: "May 2025", role: "canteen_admin" },
    { id: "u5", name: "Rohan Kumar", phone: "+91 77654 32100", college: "IIT Bombay", orders: 52, rewards: "₹88", joined: "Apr 2025", role: "user" },
  ];
  const [users, setUsers] = useState(INIT);
  const [search, setSearch] = useState("");
  const [editUser, setEditUser] = useState<typeof INIT[number] | null>(null);
  const [form, setForm] = useState({ name: "", phone: "", college: "", role: "user" });

  const filtered = users.filter(u =>
    u.name.toLowerCase().includes(search.toLowerCase()) ||
    u.phone.includes(search) ||
    u.college.toLowerCase().includes(search.toLowerCase())
  );

  const openEdit = (u: typeof INIT[number]) => { setEditUser(u); setForm({ name: u.name, phone: u.phone, college: u.college, role: u.role }); };
  const saveEdit = () => {
    if (editUser) setUsers(prev => prev.map(u => u.id === editUser.id ? { ...u, ...form } : u));
    setEditUser(null);
  };

  return (
    <div className="page-content">
      <div className="page-header">
        <h2>All Users</h2>
        <input className="form-input" type="search" placeholder="Search users…" value={search} onChange={e => setSearch(e.target.value)} style={{ width: 220 }} />
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>USER</th><th>PHONE</th><th>COLLEGE</th><th>ROLE</th><th>ORDERS</th><th>REWARDS</th><th>JOINED</th><th>ACTION</th></tr></thead>
          <tbody>
            {filtered.map(u => (
              <tr key={u.id}>
                <td style={{ fontWeight: 600 }}>{u.name}</td>
                <td style={{ fontSize: "0.82rem", color: "var(--ink-3)" }}>{u.phone}</td>
                <td style={{ fontSize: "0.82rem" }}>{u.college}</td>
                <td><span className={`tag ${u.role === "super_admin" ? "tag-orange" : u.role === "canteen_admin" || u.role === "vendor" ? "tag-blue" : u.role === "worker" ? "tag-yellow" : "tag-gray"}`}>{u.role}</span></td>
                <td>{u.orders}</td>
                <td style={{ color: "var(--green)", fontWeight: 600 }}>{u.rewards}</td>
                <td style={{ fontSize: "0.78rem", color: "var(--ink-3)" }}>{u.joined}</td>
                <td><button className="btn btn-ghost" style={{ fontSize: "0.78rem", padding: "0.25rem 0.5rem" }} onClick={() => openEdit(u)}>Edit</button></td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--ink-3)", padding: "2rem" }}>No users found</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {editUser && (
        <div className="modal-overlay" onClick={() => setEditUser(null)}>
          <div className="modal-sheet" onClick={e => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "1rem" }}>
              <h3>Edit User</h3>
              <button onClick={() => setEditUser(null)} style={{ background: "none", border: "none", fontSize: "1.2rem", cursor: "pointer" }}>✕</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              <div>
                <label className="form-label">Name</label>
                <input className="form-input" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
              </div>
              <div>
                <label className="form-label">Phone</label>
                <input className="form-input" value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} />
              </div>
              <div>
                <label className="form-label">College</label>
                <input className="form-input" value={form.college} onChange={e => setForm(p => ({ ...p, college: e.target.value }))} />
              </div>
              <div>
                <label className="form-label">Role</label>
                <select className="form-input" value={form.role} onChange={e => setForm(p => ({ ...p, role: e.target.value }))}>
                  <option value="user">User</option>
                  <option value="worker">Worker</option>
                  <option value="canteen_admin">Canteen Admin</option>
                  <option value="vendor">Vendor</option>
                  <option value="super_admin">Super Admin</option>
                </select>
              </div>
              <button className="btn btn-primary btn-full" onClick={saveEdit} style={{ marginTop: "0.5rem" }}>Save Changes</button>
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
  const TICKETS = [
    { id: "T001", user: "Arjun Sharma", issue: "OTP mismatch – order not collected", canteen: "IIT Bombay – Main", priority: "high", status: "open", time: "2 hrs ago" },
    { id: "T002", user: "Priya Menon", issue: "Payment deducted but order not placed", canteen: "BITS Pilani", priority: "critical", status: "open", time: "4 hrs ago" },
    { id: "T003", user: "Karan Das", issue: "Menu item not available at slot", canteen: "NIT Trichy", priority: "medium", status: "resolved", time: "1 day ago" },
    { id: "T004", user: "Sneha Joshi", issue: "Rewards not credited after order", canteen: "VIT Vellore", priority: "low", status: "resolved", time: "2 days ago" },
    { id: "T005", user: "Rohan Kumar", issue: "Wrong item placed in bin", canteen: "IIT Bombay – Main", priority: "high", status: "escalated", time: "30 mins ago" },
  ];
  type StatusType = "open" | "resolved" | "escalated";
  const [tickets, setTickets] = useState(TICKETS);
  const [filterStatus, setFilterStatus] = useState<"all" | StatusType>("all");

  const filtered = filterStatus === "all" ? tickets : tickets.filter(t => t.status === filterStatus);

  const resolve = (id: string) => setTickets(prev => prev.map(t => t.id === id ? { ...t, status: "resolved" } : t));
  const escalate = (id: string) => setTickets(prev => prev.map(t => t.id === id ? { ...t, status: "escalated" } : t));

  const priorityColor: Record<string, string> = { critical: "var(--red)", high: "var(--orange)", medium: "var(--yellow)", low: "var(--ink-3)" };
  const statusTag: Record<string, string> = { open: "tag-blue", resolved: "tag-green", escalated: "tag-orange" };

  const counts = { open: tickets.filter(t => t.status === "open").length, escalated: tickets.filter(t => t.status === "escalated").length };

  return (
    <div className="page-content">
      <div className="page-header">
        <h2>Complaints & Escalations</h2>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {(["all", "open", "escalated", "resolved"] as const).map(s => (
            <button key={s} onClick={() => setFilterStatus(s)} className={`btn ${filterStatus === s ? "btn-primary" : "btn-ghost"}`} style={{ fontSize: "0.78rem", padding: "0.3rem 0.7rem", textTransform: "capitalize" }}>{s}</button>
          ))}
        </div>
      </div>

      <div className="stats-row" style={{ gridTemplateColumns: "repeat(3, 1fr)", marginBottom: "1rem" }}>
        <div className="stat-card">
          <div className="stat-num" style={{ color: "var(--red)" }}>{counts.open}</div>
          <div className="stat-label">Open Tickets</div>
        </div>
        <div className="stat-card">
          <div className="stat-num" style={{ color: "var(--orange)" }}>{counts.escalated}</div>
          <div className="stat-label">Escalated</div>
        </div>
        <div className="stat-card">
          <div className="stat-num" style={{ color: "var(--green)" }}>{tickets.filter(t => t.status === "resolved").length}</div>
          <div className="stat-label">Resolved</div>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead><tr><th>ID</th><th>USER</th><th>ISSUE</th><th>CANTEEN</th><th>PRIORITY</th><th>STATUS</th><th>TIME</th><th>ACTIONS</th></tr></thead>
          <tbody>
            {filtered.map(t => (
              <tr key={t.id}>
                <td style={{ fontSize: "0.78rem", fontFamily: "monospace", color: "var(--ink-3)" }}>{t.id}</td>
                <td style={{ fontWeight: 600 }}>{t.user}</td>
                <td style={{ fontSize: "0.82rem", maxWidth: 200 }}>{t.issue}</td>
                <td style={{ fontSize: "0.78rem", color: "var(--ink-3)" }}>{t.canteen}</td>
                <td><span style={{ fontSize: "0.75rem", fontWeight: 700, color: priorityColor[t.priority], textTransform: "uppercase" }}>{t.priority}</span></td>
                <td><span className={`tag ${statusTag[t.status]}`}>{t.status}</span></td>
                <td style={{ fontSize: "0.78rem", color: "var(--ink-3)" }}>{t.time}</td>
                <td style={{ display: "flex", gap: "0.25rem" }}>
                  {t.status !== "resolved" && (
                    <button className="btn btn-ghost" style={{ fontSize: "0.72rem", padding: "0.2rem 0.4rem", color: "var(--green)" }} onClick={() => resolve(t.id)}>Resolve</button>
                  )}
                  {t.status === "open" && (
                    <button className="btn btn-ghost" style={{ fontSize: "0.72rem", padding: "0.2rem 0.4rem", color: "var(--orange)" }} onClick={() => escalate(t.id)}>Escalate</button>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--ink-3)", padding: "2rem" }}>No tickets found</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
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
  return (
    <div className="page-content">
      <div className="page-header"><h2>Payments & Settlements</h2></div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>DATE</th><th>CANTEEN</th><th>ORDERS</th><th>GROSS</th><th>PLATFORM FEE</th><th>NET</th><th>STATUS</th></tr></thead>
          <tbody>
            {[
              { date: "Jul 28, 2025", canteen: "IIT Bombay – Main", orders: 42, gross: "₹3,240", fee: "₹162", net: "₹3,078", status: "settled" },
              { date: "Jul 27, 2025", canteen: "BITS Pilani – Mess", orders: 38, gross: "₹2,940", fee: "₹147", net: "₹2,793", status: "settled" },
              { date: "Jul 28, 2025", canteen: "VIT Vellore – Caf 2", orders: 24, gross: "₹1,880", fee: "₹94", net: "₹1,786", status: "pending" },
            ].map((r, i) => (
              <tr key={i}>
                <td style={{ fontSize: "0.82rem", color: "var(--ink-3)" }}>{r.date}</td>
                <td style={{ fontSize: "0.82rem" }}>{r.canteen}</td>
                <td>{r.orders}</td>
                <td style={{ fontWeight: 600 }}>{r.gross}</td>
                <td style={{ color: "var(--red)" }}>{r.fee}</td>
                <td style={{ fontWeight: 700, color: "var(--green)" }}>{r.net}</td>
                <td><span className={`tag ${r.status === "settled" ? "tag-green" : "tag-yellow"}`}>{r.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}



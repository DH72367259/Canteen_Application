"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000)     return "Just now";
  if (diff < 3600000)   return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000)  return `${Math.floor(diff / 3600000)}h ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

const CATEGORIES = [
  { value: "payment_issue",   label: "💳 Payment Issue",       desc: "Money deducted but order not placed" },
  { value: "order_not_found", label: "📦 Order Not Found",     desc: "Order missing from My Orders" },
  { value: "otp_mismatch",    label: "🔑 OTP Mismatch",        desc: "OTP rejected at canteen counter" },
  { value: "vendor_refused",  label: "🚫 Vendor Refused",      desc: "Staff refused to accept the order" },
  { value: "refund_request",  label: "↩️ Refund Request",      desc: "Request a refund for a failed order" },
  { value: "menu_issue",      label: "🍽️ Menu / Item Issue",    desc: "Wrong item, unavailable item served" },
  { value: "app_bug",         label: "🐛 App Bug",             desc: "App crashes or works incorrectly" },
  { value: "other",           label: "💬 Other",               desc: "Something else" },
];

const STATUS_COLORS: Record<string, string> = {
  open: "#3b82f6", in_progress: "#f97316", escalated: "#ef4444",
  resolved: "#16a34a", closed: "#6b7280",
};
const STATUS_LABELS: Record<string, string> = {
  open: "Open", in_progress: "In Progress", escalated: "Escalated",
  resolved: "Resolved", closed: "Closed",
};
const CATEGORY_LABELS: Record<string, string> = {
  payment_issue: "Payment Issue", order_not_found: "Order Not Found",
  otp_mismatch: "OTP Mismatch", vendor_refused: "Vendor Refused",
  refund_request: "Refund Request", menu_issue: "Menu / Item Issue",
  app_bug: "App Bug", other: "Other",
};

interface Ticket {
  id: string; ticket_ref: string; category: string;
  subject: string; description: string; priority: string;
  status: string; admin_notes: string | null;
  created_at: string; resolved_at: string | null;
}

export default function StudentSupportPage() {
  const router = useRouter();
  const { user, session, loading } = useAuth();
  const [tab,       setTab]       = useState<"raise" | "track">("raise");
  const [category,  setCategory]  = useState("");
  const [subject,   setSubject]   = useState("");
  const [desc,      setDesc]      = useState("");
  const [orderId,   setOrderId]   = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<Ticket | null>(null);
  const [tickets,   setTickets]   = useState<Ticket[]>([]);
  const [fetching,  setFetching]  = useState(false);
  const [selected,  setSelected]  = useState<Ticket | null>(null);

  useEffect(() => {
    if (!loading && !user) router.replace("/login?role=user");
  }, [user, loading, router]);

  const loadTickets = useCallback(async () => {
    if (!session?.access_token) return;
    setFetching(true);
    try {
      const res = await fetch("/api/support", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const d = await res.json();
      if (res.ok) setTickets(d.tickets ?? []);
    } catch { /* ignore */ } finally { setFetching(false); }
  }, [session?.access_token]);

  useEffect(() => {
    if (tab === "track") loadTickets();
  }, [tab, loadTickets]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!category) { setSubmitErr("Please select a category."); return; }
    if (!subject.trim()) { setSubmitErr("Please enter a subject."); return; }
    if (!desc.trim()) { setSubmitErr("Please describe your issue."); return; }
    if (!session?.access_token) { setSubmitErr("You must be signed in."); return; }

    setSubmitting(true); setSubmitErr(null);
    try {
      const res = await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          category,
          subject:     subject.trim(),
          description: desc.trim(),
          order_id:    orderId.trim() || undefined,
        }),
      });
      const d = await res.json();
      if (!res.ok) { setSubmitErr(d.error ?? "Failed to submit."); return; }
      setSubmitted(d.ticket);
      setCategory(""); setSubject(""); setDesc(""); setOrderId("");
    } catch { setSubmitErr("Network error. Please try again."); } finally { setSubmitting(false); }
  }

  if (loading) return <div className="page-loading"><div className="spinner" /></div>;

  return (
    <div className="app-shell">
      <div className="app-topbar">
        <button onClick={() => router.back()} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "1.1rem", color: "var(--ink-3)" }}>←</button>
        <h1 style={{ fontSize: "1.05rem", fontWeight: 700 }}>Help &amp; Support</h1>
        <div />
      </div>

      {/* Tabs */}
      <div className="slot-tabs" style={{ gap: "0.4rem", position: "sticky", top: 56, zIndex: 10, background: "var(--bg)", padding: "0.4rem 1rem" }}>
        {(["raise", "track"] as const).map(t => (
          <button key={t} className={`slot-tab ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>
            {t === "raise" ? "🆕 Raise a Concern" : `📋 My Tickets (${tickets.length})`}
          </button>
        ))}
      </div>

      <div style={{ padding: "0.75rem 1rem 6rem" }}>

        {/* ── RAISE TAB ── */}
        {tab === "raise" && (
          <>
            {submitted ? (
              <div className="card" style={{ padding: "1.25rem", textAlign: "center" }}>
                <div style={{ fontSize: "2.5rem", marginBottom: "0.5rem" }}>✅</div>
                <h2 style={{ fontWeight: 800, fontSize: "1.05rem", marginBottom: "0.25rem" }}>Ticket Submitted!</h2>
                <p style={{ fontSize: "0.85rem", color: "var(--ink-3)", marginBottom: "0.75rem" }}>
                  Your reference number is <strong style={{ fontFamily: "monospace", color: "var(--orange)" }}>{submitted.ticket_ref}</strong>
                </p>
                <p style={{ fontSize: "0.8rem", color: "var(--ink-3)", marginBottom: "1rem" }}>
                  Our team will review your issue and respond within 24 hours. Track it in the My Tickets tab.
                </p>
                <div style={{ display: "flex", gap: "0.5rem", justifyContent: "center", flexWrap: "wrap" }}>
                  <button className="btn btn-primary" onClick={() => { setSubmitted(null); }}>Raise Another</button>
                  <button className="btn btn-outline" onClick={() => setTab("track")}>Track Tickets</button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>

                {/* Category */}
                <section>
                  <h2 style={{ fontSize: "0.82rem", fontWeight: 700, color: "var(--ink-3)", textTransform: "uppercase", marginBottom: "0.75rem" }}>
                    What&apos;s the issue?
                  </h2>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                    {CATEGORIES.map(c => (
                      <label key={c.value} style={{
                        display: "flex", alignItems: "center", gap: "0.75rem",
                        border: `2px solid ${category === c.value ? "var(--orange)" : "var(--border)"}`,
                        borderRadius: 12, padding: "0.75rem 0.9rem", cursor: "pointer",
                        background: category === c.value ? "#fff7ed" : "#fff",
                      }}>
                        <input type="radio" name="category" value={c.value} checked={category === c.value}
                          onChange={() => setCategory(c.value)} style={{ accentColor: "var(--orange)", flexShrink: 0 }} />
                        <div>
                          <div style={{ fontWeight: 600, fontSize: "0.88rem" }}>{c.label}</div>
                          <div style={{ fontSize: "0.74rem", color: "var(--ink-3)" }}>{c.desc}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                </section>

                {/* Subject */}
                <section>
                  <label style={{ fontSize: "0.82rem", fontWeight: 700, color: "var(--ink-3)", textTransform: "uppercase", display: "block", marginBottom: "0.5rem" }}>
                    Subject *
                  </label>
                  <input type="text" value={subject} maxLength={200}
                    onChange={e => setSubject(e.target.value)}
                    placeholder="Brief summary of your issue"
                    style={{ width: "100%", padding: "0.65rem", border: "1.5px solid var(--border)", borderRadius: 10, fontSize: "0.9rem", boxSizing: "border-box" }} />
                </section>

                {/* Description */}
                <section>
                  <label style={{ fontSize: "0.82rem", fontWeight: 700, color: "var(--ink-3)", textTransform: "uppercase", display: "block", marginBottom: "0.5rem" }}>
                    Description *
                  </label>
                  <textarea rows={5} value={desc} maxLength={2000}
                    onChange={e => setDesc(e.target.value)}
                    placeholder="Describe exactly what happened — include time, canteen name, and any relevant details."
                    style={{ width: "100%", padding: "0.65rem", border: "1.5px solid var(--border)", borderRadius: 10, fontSize: "0.88rem", resize: "vertical", boxSizing: "border-box" }} />
                  <div style={{ fontSize: "0.72rem", color: "var(--ink-3)", textAlign: "right", marginTop: "0.2rem" }}>{desc.length}/2000</div>
                </section>

                {/* Optional order reference */}
                <section>
                  <label style={{ fontSize: "0.82rem", fontWeight: 700, color: "var(--ink-3)", textTransform: "uppercase", display: "block", marginBottom: "0.5rem" }}>
                    Order ID (optional)
                  </label>
                  <input type="text" value={orderId}
                    onChange={e => setOrderId(e.target.value)}
                    placeholder="e.g. from My Orders page"
                    style={{ width: "100%", padding: "0.65rem", border: "1.5px solid var(--border)", borderRadius: 10, fontSize: "0.88rem", boxSizing: "border-box" }} />
                </section>

                {submitErr && <p className="error-msg">{submitErr}</p>}

                <button type="submit" className="btn btn-primary btn-full" disabled={submitting} style={{ padding: "0.9rem", fontSize: "0.95rem", fontWeight: 700 }}>
                  {submitting ? "Submitting…" : "Submit Ticket"}
                </button>
              </form>
            )}
          </>
        )}

        {/* ── TRACK TAB ── */}
        {tab === "track" && (
          <>
            {fetching && <div style={{ textAlign: "center", padding: "2rem", color: "var(--ink-3)" }}>Loading…</div>}
            {!fetching && tickets.length === 0 && (
              <div className="empty-state">
                <span className="empty-icon">🎫</span>
                <h3>No tickets yet</h3>
                <p>Raise a concern and it will appear here.</p>
                <button className="btn btn-primary" style={{ marginTop: "0.5rem" }} onClick={() => setTab("raise")}>Raise a Concern</button>
              </div>
            )}
            {tickets.map(t => (
              <div key={t.id} className="card" style={{ padding: "0.9rem", marginBottom: "0.65rem", cursor: "pointer" }} onClick={() => setSelected(t)}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.3rem" }}>
                  <div style={{ fontFamily: "monospace", fontSize: "0.72rem", color: "var(--ink-3)" }}>{t.ticket_ref}</div>
                  <span style={{
                    fontSize: "0.7rem", fontWeight: 700, borderRadius: 20, padding: "0.15rem 0.5rem",
                    background: (STATUS_COLORS[t.status] ?? "#6b7280") + "18",
                    color: STATUS_COLORS[t.status] ?? "#6b7280",
                    textTransform: "capitalize",
                  }}>{STATUS_LABELS[t.status] ?? t.status}</span>
                </div>
                <div style={{ fontWeight: 700, fontSize: "0.9rem", marginBottom: "0.15rem" }}>{t.subject}</div>
                <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ fontSize: "0.72rem", background: "#f3f4f6", borderRadius: 6, padding: "0.1rem 0.4rem", color: "var(--ink-3)" }}>
                    {CATEGORY_LABELS[t.category] ?? t.category}
                  </span>
                  <span style={{ fontSize: "0.72rem", color: "var(--ink-3)" }}>{relativeTime(t.created_at)}</span>
                </div>
                {t.admin_notes && (
                  <div style={{ marginTop: "0.5rem", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: "0.45rem 0.65rem", fontSize: "0.78rem", color: "#15803d" }}>
                    💬 <strong>Team response:</strong> {t.admin_notes}
                  </div>
                )}
              </div>
            ))}
          </>
        )}
      </div>

      {/* Ticket detail sheet */}
      {selected && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 200, display: "flex", alignItems: "flex-end", justifyContent: "center" }}
          onClick={e => { if (e.target === e.currentTarget) setSelected(null); }}>
          <div style={{ background: "#fff", borderRadius: "20px 20px 0 0", padding: "1.25rem", width: "100%", maxWidth: 480, maxHeight: "75vh", overflowY: "auto" }}>
            <div style={{ width: 36, height: 4, background: "#e5e7eb", borderRadius: 2, margin: "0 auto 1rem" }} />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
              <div style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "var(--ink-3)" }}>{selected.ticket_ref}</div>
              <span style={{
                fontSize: "0.72rem", fontWeight: 700, borderRadius: 20, padding: "0.2rem 0.6rem",
                background: (STATUS_COLORS[selected.status] ?? "#6b7280") + "18",
                color: STATUS_COLORS[selected.status] ?? "#6b7280",
              }}>{STATUS_LABELS[selected.status] ?? selected.status}</span>
            </div>
            <h3 style={{ fontWeight: 800, fontSize: "1rem", marginBottom: "0.5rem" }}>{selected.subject}</h3>
            <div style={{ fontSize: "0.75rem", color: "var(--ink-3)", marginBottom: "0.75rem" }}>
              {CATEGORY_LABELS[selected.category]} · {relativeTime(selected.created_at)}
            </div>
            <div style={{ background: "var(--surface)", borderRadius: 8, padding: "0.75rem", fontSize: "0.88rem", lineHeight: 1.6, marginBottom: "0.75rem" }}>
              {selected.description}
            </div>
            {selected.admin_notes && (
              <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 10, padding: "0.75rem", fontSize: "0.85rem", color: "#15803d" }}>
                <div style={{ fontWeight: 700, marginBottom: "0.25rem" }}>💬 Team Response</div>
                {selected.admin_notes}
              </div>
            )}
            {selected.resolved_at && (
              <div style={{ fontSize: "0.72rem", color: "var(--ink-3)", marginTop: "0.5rem" }}>
                Resolved on {new Date(selected.resolved_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
              </div>
            )}
            <button className="btn btn-outline btn-full" style={{ marginTop: "1rem" }} onClick={() => setSelected(null)}>Close</button>
          </div>
        </div>
      )}

      {/* Bottom nav */}
      <nav className="bottom-nav">
        {[
          { tab: "home",    icon: "🏠", label: "Home",      href: "/dashboard" },
          { tab: "orders",  icon: "📦", label: "My Orders", href: "/dashboard/orders" },
          { tab: "profile", icon: "👤", label: "Profile",   href: "/dashboard/profile" },
        ].map(item => (
          <Link key={item.tab} href={item.href} className="bottom-nav-item">
            <span className="nav-icon">{item.icon}</span>
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}

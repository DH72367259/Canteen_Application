"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

// ─── Types ─────────────────────────────────────────────────────────────────

interface BankDetails {
  canteen_id: string;
  account_name: string;
  account_no: string;
  ifsc_code: string;
  bank_name?: string;
  upi_id?: string;
  gpay_number?: string;
}

interface PaymentRecord {
  id: string;
  canteen_id: string;
  amount_paid: number;
  payment_mode: string;
  transaction_ref?: string;
  notes?: string;
  period_start: string;
  period_end: string;
  net_payable: number;
  gross_amount: number;
  created_at: string;
}

interface CanteenSettlement {
  canteen_id: string;
  canteen_name: string;
  city?: string;
  college?: string;
  total_orders: number;
  completed_orders: number;
  cancelled_orders: number;
  pending_orders: number;
  gross_amount: number;
  charge_pct: number;
  flat_charge: number;
  platform_fee_amount?: number;
  platform_charge_amount: number;
  gst_on_charge: number;
  extra_bin_charge_amount?: number;
  convenience_charge_amount?: number;
  total_admin_earnings?: number;
  net_payable: number;
  amount_paid: number;
  amount_remaining: number;
  payment_status: "pending" | "partial" | "paid";
  payments: PaymentRecord[];
  bank_details: BankDetails | null;
}

interface SummaryStats {
  total_collected: number;
  total_platform_fees?: number;
  total_gst_on_fees?: number;
  total_extra_bin_charges?: number;
  total_convenience_and_other_charges?: number;
  total_pro_revenue?: number;
  total_platform_earnings: number;
  total_admin_earnings?: number;
  total_net_payable: number;
  total_paid: number;
  total_remaining: number;
  total_orders: number;
  total_completed: number;
  total_cancelled: number;
}

interface PlatformCharges {
  id?: string;
  charge_pct: number;
  flat_charge: number;
  gst_pct: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────
const fmt = (n: number) => new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n);
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

export default function SettlementsPage() {
  const router = useRouter();
  const { user, session, loading } = useAuth();

  // Period
  const today = new Date().toISOString().split("T")[0];
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split("T")[0];
  const [periodStart, setPeriodStart] = useState(monthStart);
  const [periodEnd,   setPeriodEnd]   = useState(today);
  const [quickPeriod, setQuickPeriod] = useState<"today" | "week" | "month" | "custom">("month");

  // Data
  const [canteens,     setCanteens]     = useState<CanteenSettlement[]>([]);
  const [stats,        setStats]        = useState<SummaryStats | null>(null);
  const [charges,      setCharges]      = useState<PlatformCharges | null>(null);
  const [fetching,     setFetching]     = useState(true);
  const [error,        setError]        = useState<string | null>(null);

  // Modals
  const [payModal,     setPayModal]     = useState<CanteenSettlement | null>(null);
  const [bankModal,    setBankModal]    = useState<CanteenSettlement | null>(null);
  const [chargesModal, setChargesModal] = useState(false);
  const [histModal,    setHistModal]    = useState<CanteenSettlement | null>(null);
  const [expandedId,   setExpandedId]   = useState<string | null>(null);

  // Pay form
  const [payAmount,    setPayAmount]    = useState("");
  const [payMode,      setPayMode]      = useState("upi");
  const [payRef,       setPayRef]       = useState("");
  const [payNotes,     setPayNotes]     = useState("");
  const [payBusy,      setPayBusy]      = useState(false);
  const [payError,     setPayError]     = useState("");

  // Bank form
  const [bankForm,     setBankForm]     = useState<Partial<BankDetails>>({});
  const [bankBusy,     setBankBusy]     = useState(false);
  const [bankError,    setBankError]    = useState("");

  // Charges form
  const [chargesForm,  setChargesForm]  = useState<Partial<PlatformCharges>>({});
  const [chargesBusy,  setChargesBusy]  = useState(false);

  // Auth guard
  useEffect(() => {
    if (!loading && !user) router.push("/login");
    if (!loading && user && user.role !== "super_admin") router.push("/");
  }, [user, loading, router]);

  // Fetch
  const fetchData = useCallback(async () => {
    if (!session?.access_token) { setFetching(false); return; }
    setFetching(true); setError(null);
    try {
      const res = await fetch(`/api/admin/settlements?period_start=${periodStart}&period_end=${periodEnd}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const d = await res.json();
      if (!res.ok) { setError(d.error ?? "Failed to load."); setFetching(false); return; }
      setCanteens(d.canteens ?? []);
      setStats(d.summary_stats ?? null);
      setCharges(d.platform_charges ?? null);
    } catch { setError("Network error. Please refresh."); }
    finally { setFetching(false); }
  }, [session?.access_token, periodStart, periodEnd]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Quick period buttons
  function applyQuickPeriod(p: "today" | "week" | "month" | "custom") {
    setQuickPeriod(p);
    const end = today;
    const now = new Date();
    if (p === "today")  { setPeriodStart(today);    setPeriodEnd(end); }
    if (p === "week")   { const s = new Date(now.getTime() - 7 * 86400000); setPeriodStart(s.toISOString().split("T")[0]); setPeriodEnd(end); }
    if (p === "month")  { setPeriodStart(monthStart); setPeriodEnd(end); }
  }

  // ── Pay modal submit ──
  async function handlePay() {
    if (!payModal || !session?.access_token) return;
    const amt = Number(payAmount);
    if (!amt || amt <= 0) { setPayError("Enter a valid amount."); return; }
    if (amt > payModal.amount_remaining + 0.01) { setPayError(`Max payable is ₹${fmt(payModal.amount_remaining)}.`); return; }
    setPayBusy(true); setPayError("");
    try {
      const res = await fetch("/api/admin/settlements/pay", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          canteen_id:     payModal.canteen_id,
          amount_paid:    amt,
          payment_mode:   payMode,
          transaction_ref: payRef || null,
          notes:          payNotes || null,
          period_start:   periodStart,
          period_end:     periodEnd,
          gross_amount:   payModal.gross_amount,
          platform_charge: payModal.platform_charge_amount,
          gst_on_charge:  payModal.gst_on_charge,
          net_payable:    payModal.net_payable,
        }),
      });
      const d = await res.json();
      if (!res.ok) { setPayError(d.error ?? "Payment failed."); }
      else { setPayModal(null); setPayAmount(""); setPayRef(""); setPayNotes(""); fetchData(); }
    } catch { setPayError("Network error."); }
    finally { setPayBusy(false); }
  }

  // ── Bank modal submit ──
  async function handleSaveBank() {
    if (!bankModal || !session?.access_token) return;
    if (!bankForm.account_name || !bankForm.account_no || !bankForm.ifsc_code) { setBankError("Account name, number and IFSC are required."); return; }
    setBankBusy(true); setBankError("");
    try {
      const res = await fetch("/api/admin/canteen-bank", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ canteen_id: bankModal.canteen_id, ...bankForm }),
      });
      const d = await res.json();
      if (!res.ok) { setBankError(d.error ?? "Save failed."); }
      else { setBankModal(null); setBankForm({}); fetchData(); }
    } catch { setBankError("Network error."); }
    finally { setBankBusy(false); }
  }

  // ── Platform charges submit ──
  async function handleSaveCharges() {
    if (!session?.access_token) return;
    setChargesBusy(true);
    try {
      await fetch("/api/admin/platform-charges", {
        method: "PATCH",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify(chargesForm),
      });
      setChargesModal(false); fetchData();
    } catch { /* ignore */ }
    finally { setChargesBusy(false); }
  }

  if (loading) return <div className="page-loading"><div className="spinner" /></div>;
  if (!user || user.role !== "super_admin") return null;

  const PSTATUS_COLORS: Record<string, string> = { paid: "#15803d", partial: "#d97706", pending: "#dc2626" };
  const PSTATUS_BG:     Record<string, string> = { paid: "#f0fdf4", partial: "#fffbeb", pending: "#fef2f2" };

  return (
    <div style={{ minHeight: "100vh", background: "#f9fafb", fontFamily: "system-ui, sans-serif" }}>
      {/* ── Header ── */}
      <div style={{ background: "#fff", borderBottom: "1px solid #e5e7eb", padding: "1rem 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 50 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <Link href="/system/dashboard" style={{ color: "var(--ink-3)", textDecoration: "none", fontSize: "1.2rem" }}>←</Link>
          <div>
            <h1 style={{ fontSize: "1.1rem", fontWeight: 800, margin: 0 }}>💸 Settlement Dashboard</h1>
            <p style={{ fontSize: "0.72rem", color: "var(--ink-3)", margin: 0 }}>Admin → Canteen Payment Management</p>
          </div>
        </div>
        <button onClick={() => { setChargesForm(charges ?? {}); setChargesModal(true); }}
          style={{ background: "#fff7ed", border: "1.5px solid #fed7aa", borderRadius: 10, padding: "0.4rem 0.85rem", fontSize: "0.78rem", fontWeight: 700, color: "#9a3412", cursor: "pointer" }}>
          ⚙️ Platform Charges
        </button>
      </div>

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "1.25rem 1rem" }}>

        {/* ── Period selector ── */}
        <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #e5e7eb", padding: "0.85rem 1rem", marginBottom: "1rem" }}>
          <div style={{ display: "flex", gap: "0.4rem", marginBottom: "0.6rem", flexWrap: "wrap" }}>
            {(["today", "week", "month", "custom"] as const).map(p => (
              <button key={p} onClick={() => applyQuickPeriod(p)}
                style={{ borderRadius: 8, padding: "0.35rem 0.75rem", fontSize: "0.78rem", fontWeight: 600, cursor: "pointer",
                  background: quickPeriod === p ? "var(--orange)" : "#f3f4f6",
                  color: quickPeriod === p ? "#fff" : "var(--ink-3)", border: "none" }}>
                {p === "today" ? "Today" : p === "week" ? "Last 7 days" : p === "month" ? "This month" : "Custom"}
              </button>
            ))}
          </div>
          {quickPeriod === "custom" && (
            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)}
                style={{ flex: 1, border: "1px solid #e5e7eb", borderRadius: 8, padding: "0.4rem 0.65rem", fontSize: "0.85rem" }} />
              <span style={{ color: "var(--ink-3)", fontSize: "0.8rem" }}>to</span>
              <input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)}
                style={{ flex: 1, border: "1px solid #e5e7eb", borderRadius: 8, padding: "0.4rem 0.65rem", fontSize: "0.85rem" }} />
              <button onClick={fetchData} style={{ background: "var(--orange)", color: "#fff", border: "none", borderRadius: 8, padding: "0.4rem 0.85rem", fontSize: "0.82rem", fontWeight: 700, cursor: "pointer" }}>
                Apply
              </button>
            </div>
          )}
        </div>

        {/* ── Summary stats ── */}
        {stats && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: "0.65rem", marginBottom: "1rem" }}>
            {[
              { label: "Collected",           value: `₹${fmt(stats.total_collected)}`,         color: "#15803d", bg: "#f0fdf4" },
              { label: "Platform Fee",        value: `₹${fmt(stats.total_platform_fees ?? 0)}`, color: "#2563eb", bg: "#eff6ff" },
              { label: "GST on Fee",          value: `₹${fmt(stats.total_gst_on_fees ?? 0)}`,   color: "#334155", bg: "#f1f5f9" },
              { label: "Extra-bin Charges",   value: `₹${fmt(stats.total_extra_bin_charges ?? 0)}`, color: "#9a3412", bg: "#fff7ed" },
              { label: "Convenience Fee",     value: `₹${fmt(stats.total_convenience_and_other_charges ?? 0)}`, color: "#7c3aed", bg: "#f5f3ff" },
              { label: "Pro Revenue",         value: `₹${fmt(stats.total_pro_revenue ?? 0)}`, color: "#0f766e", bg: "#ecfeff" },
              { label: "Platform (Order) Total", value: `₹${fmt(stats.total_platform_earnings)}`, color: "#0f766e", bg: "#ecfeff" },
              { label: "Total Admin Earnings", value: `₹${fmt(stats.total_admin_earnings ?? stats.total_platform_earnings)}`, color: "#1d4ed8", bg: "#eff6ff" },
              { label: "Net Payable",         value: `₹${fmt(stats.total_net_payable)}`,       color: "#0369a1", bg: "#eff6ff" },
              { label: "Paid Out",            value: `₹${fmt(stats.total_paid)}`,              color: "#d97706", bg: "#fffbeb" },
              { label: "Still Pending",       value: `₹${fmt(stats.total_remaining)}`,         color: "#dc2626", bg: "#fef2f2" },
              { label: "Total Orders",        value: String(stats.total_orders),               color: "var(--ink)", bg: "#fff" },
              { label: "Completed",           value: String(stats.total_completed),            color: "#15803d", bg: "#f0fdf4" },
              { label: "Cancelled",           value: String(stats.total_cancelled),            color: "#dc2626", bg: "#fef2f2" },
            ].map(s => (
              <div key={s.label} style={{ background: s.bg, border: "1px solid #e5e7eb", borderRadius: 12, padding: "0.6rem 0.85rem" }}>
                <div style={{ fontSize: "0.68rem", color: "var(--ink-3)", marginBottom: "0.2rem", fontWeight: 600, textTransform: "uppercase" }}>{s.label}</div>
                <div style={{ fontSize: "1.05rem", fontWeight: 800, color: s.color }}>{s.value}</div>
              </div>
            ))}
          </div>
        )}

        {/* ── Platform charges banner ── */}
        {charges && (
          <div style={{ background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 12, padding: "0.55rem 0.85rem", marginBottom: "1rem", fontSize: "0.76rem", color: "#9a3412", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>⚙️ Platform charge: <strong>{charges.charge_pct}%</strong> of gross
              {charges.flat_charge > 0 && ` + ₹${charges.flat_charge} flat/order`}
              {" · "}GST on charge: <strong>{charges.gst_pct}%</strong>
            </span>
            <button onClick={() => { setChargesForm(charges); setChargesModal(true); }}
              style={{ background: "none", border: "1px solid #fed7aa", borderRadius: 6, padding: "0.2rem 0.5rem", fontSize: "0.72rem", cursor: "pointer", color: "#9a3412" }}>
              Edit
            </button>
          </div>
        )}

        {error && <p style={{ color: "var(--red)", padding: "0.5rem 1rem" }}>⚠️ {error}</p>}
        {fetching && <div style={{ textAlign: "center", padding: "2rem", color: "var(--ink-3)" }}>Loading settlements…</div>}

        {/* ── Canteen cards ── */}
        {!fetching && canteens.map(canteen => {
          const expanded = expandedId === canteen.canteen_id;
          const paidPct = canteen.net_payable > 0 ? Math.min(100, (canteen.amount_paid / canteen.net_payable) * 100) : 0;
          return (
            <div key={canteen.canteen_id} style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 16, marginBottom: "0.85rem", overflow: "hidden" }}>
              {/* Card header */}
              <div style={{ padding: "1rem 1rem 0.5rem", borderBottom: expanded ? "1px solid #f3f4f6" : "none" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: "1rem" }}>{canteen.canteen_name}</div>
                    {canteen.college && <div style={{ fontSize: "0.72rem", color: "var(--ink-3)" }}>{canteen.college} · {canteen.city}</div>}
                  </div>
                  <span style={{ background: PSTATUS_BG[canteen.payment_status], color: PSTATUS_COLORS[canteen.payment_status], border: `1px solid ${PSTATUS_COLORS[canteen.payment_status]}30`, borderRadius: 20, padding: "0.2rem 0.6rem", fontSize: "0.7rem", fontWeight: 700, textTransform: "capitalize" }}>
                    {canteen.payment_status}
                  </span>
                </div>

                {/* Order stats */}
                <div style={{ display: "flex", gap: "1rem", marginTop: "0.5rem", fontSize: "0.75rem" }}>
                  <span style={{ color: "var(--ink-3)" }}>📦 {canteen.total_orders} orders</span>
                  <span style={{ color: "#15803d" }}>✅ {canteen.completed_orders} completed</span>
                  <span style={{ color: "#dc2626" }}>❌ {canteen.cancelled_orders} cancelled</span>
                  {canteen.pending_orders > 0 && <span style={{ color: "#d97706" }}>⏳ {canteen.pending_orders} pending</span>}
                </div>

                {/* Financial breakdown */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "0.5rem", marginTop: "0.65rem" }}>
                  <div style={{ background: "#f9fafb", borderRadius: 10, padding: "0.5rem 0.65rem" }}>
                    <div style={{ fontSize: "0.66rem", color: "var(--ink-3)", fontWeight: 600 }}>GROSS REVENUE</div>
                    <div style={{ fontSize: "0.92rem", fontWeight: 800 }}>₹{fmt(canteen.gross_amount)}</div>
                  </div>
                  <div style={{ background: "#fff7ed", borderRadius: 10, padding: "0.5rem 0.65rem" }}>
                    <div style={{ fontSize: "0.66rem", color: "#9a3412", fontWeight: 600 }}>ADMIN-RETAINED CHARGES</div>
                    <div style={{ fontSize: "0.64rem", color: "#7c2d12", lineHeight: 1.35 }}>
                      <div>Platform: ₹{fmt(canteen.platform_fee_amount ?? 0)}</div>
                      <div>GST: ₹{fmt(canteen.gst_on_charge ?? 0)}</div>
                      <div>Extra-bin: ₹{fmt(canteen.extra_bin_charge_amount ?? 0)}</div>
                      <div>Convenience/Other: ₹{fmt(canteen.convenience_charge_amount ?? 0)}</div>
                    </div>
                    <div style={{ fontSize: "0.86rem", fontWeight: 800, color: "#9a3412", marginTop: "0.2rem" }}>
                      -₹{fmt(canteen.total_admin_earnings ?? canteen.platform_charge_amount)}
                    </div>
                  </div>
                  <div style={{ background: "#eff6ff", borderRadius: 10, padding: "0.5rem 0.65rem" }}>
                    <div style={{ fontSize: "0.66rem", color: "#1d4ed8", fontWeight: 600 }}>NET PAYABLE</div>
                    <div style={{ fontSize: "0.92rem", fontWeight: 800, color: "#1d4ed8" }}>₹{fmt(canteen.net_payable)}</div>
                  </div>
                </div>

                {/* Payment progress */}
                {canteen.net_payable > 0 && (
                  <div style={{ marginTop: "0.65rem" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.72rem", color: "var(--ink-3)", marginBottom: "0.25rem" }}>
                      <span>Paid: <strong style={{ color: "#15803d" }}>₹{fmt(canteen.amount_paid)}</strong></span>
                      <span>Remaining: <strong style={{ color: canteen.amount_remaining > 0 ? "#dc2626" : "#15803d" }}>₹{fmt(canteen.amount_remaining)}</strong></span>
                    </div>
                    <div style={{ background: "#e5e7eb", borderRadius: 99, height: 6, overflow: "hidden" }}>
                      <div style={{ background: paidPct >= 100 ? "#16a34a" : "#f97316", height: "100%", borderRadius: 99, width: `${paidPct}%`, transition: "width 0.3s" }} />
                    </div>
                  </div>
                )}

                {/* Action buttons */}
                <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.65rem", flexWrap: "wrap" }}>
                  {canteen.amount_remaining > 0 && (
                    <button onClick={() => { setPayModal(canteen); setPayAmount(String(canteen.amount_remaining)); setPayMode("upi"); setPayRef(""); setPayNotes(""); setPayError(""); }}
                      style={{ background: "var(--orange)", color: "#fff", border: "none", borderRadius: 10, padding: "0.4rem 0.9rem", fontSize: "0.8rem", fontWeight: 700, cursor: "pointer" }}>
                      💰 Pay ₹{fmt(canteen.amount_remaining)}
                    </button>
                  )}
                  <button onClick={() => { setBankModal(canteen); setBankForm(canteen.bank_details ?? { canteen_id: canteen.canteen_id }); setBankError(""); }}
                    style={{ background: "#f3f4f6", color: "var(--ink-2)", border: "1px solid #e5e7eb", borderRadius: 10, padding: "0.4rem 0.9rem", fontSize: "0.8rem", fontWeight: 600, cursor: "pointer" }}>
                    🏦 {canteen.bank_details ? "Edit Bank Details" : "Add Bank Details"}
                  </button>
                  {canteen.payments.length > 0 && (
                    <button onClick={() => setHistModal(canteen)}
                      style={{ background: "#eff6ff", color: "#1d4ed8", border: "1px solid #bfdbfe", borderRadius: 10, padding: "0.4rem 0.9rem", fontSize: "0.8rem", fontWeight: 600, cursor: "pointer" }}>
                      📋 History ({canteen.payments.length})
                    </button>
                  )}
                  <button onClick={() => setExpandedId(expanded ? null : canteen.canteen_id)}
                    style={{ background: "none", border: "1px solid #e5e7eb", borderRadius: 10, padding: "0.4rem 0.9rem", fontSize: "0.8rem", cursor: "pointer", color: "var(--ink-3)" }}>
                    {expanded ? "Hide details ▲" : "Details ▼"}
                  </button>
                </div>
              </div>

              {/* Expanded: bank details */}
              {expanded && (
                <div style={{ padding: "0.75rem 1rem", background: "#f9fafb", fontSize: "0.8rem" }}>
                  <strong style={{ fontSize: "0.76rem", color: "var(--ink-3)" }}>BANK / PAYMENT DETAILS</strong>
                  {canteen.bank_details ? (
                    <div style={{ marginTop: "0.4rem", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.3rem 1rem" }}>
                      {[
                        ["Account Name", canteen.bank_details.account_name],
                        ["Account No",   canteen.bank_details.account_no],
                        ["IFSC Code",    canteen.bank_details.ifsc_code],
                        ["Bank Name",    canteen.bank_details.bank_name || "—"],
                        ["UPI ID",       canteen.bank_details.upi_id || "—"],
                        ["GPay Number",  canteen.bank_details.gpay_number || "—"],
                      ].map(([k, v]) => (
                        <div key={k}>
                          <span style={{ color: "var(--ink-3)", fontSize: "0.68rem" }}>{k}: </span>
                          <span style={{ fontWeight: 600, fontFamily: "monospace" }}>{v}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p style={{ color: "var(--ink-3)", marginTop: "0.4rem" }}>No bank details added yet.</p>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {!fetching && canteens.length === 0 && (
          <div style={{ textAlign: "center", padding: "3rem", color: "var(--ink-3)" }}>
            <div style={{ fontSize: "2.5rem" }}>🏪</div>
            <p>No canteens found for this period.</p>
          </div>
        )}
      </div>

      {/* ─── PAY MODAL ─────────────────────────────────────────── */}
      {payModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 200, display: "flex", alignItems: "flex-end", justifyContent: "center" }}
          onClick={e => { if (e.target === e.currentTarget) setPayModal(null); }}>
          <div style={{ background: "#fff", borderRadius: "20px 20px 0 0", padding: "1.25rem 1.25rem 2.5rem", width: "100%", maxWidth: 520 }}>
            <div style={{ width: 40, height: 4, background: "#e5e7eb", borderRadius: 99, margin: "0 auto 1rem" }} />
            <h3 style={{ fontWeight: 800, marginBottom: "0.25rem" }}>Pay {payModal.canteen_name}</h3>
            <p style={{ fontSize: "0.78rem", color: "var(--ink-3)", marginBottom: "1rem" }}>
              Net payable: ₹{fmt(payModal.net_payable)} · Remaining: ₹{fmt(payModal.amount_remaining)} · Period: {periodStart} → {periodEnd}
            </p>

            {/* Amount */}
            <label style={{ fontSize: "0.8rem", fontWeight: 600, display: "block", marginBottom: "0.25rem" }}>Amount to Pay (₹)</label>
            <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem" }}>
              <button onClick={() => setPayAmount(String(payModal.amount_remaining))}
                style={{ background: payAmount === String(payModal.amount_remaining) ? "var(--orange)" : "#f3f4f6", color: payAmount === String(payModal.amount_remaining) ? "#fff" : "var(--ink)", border: "none", borderRadius: 8, padding: "0.4rem 0.75rem", fontSize: "0.78rem", fontWeight: 700, cursor: "pointer" }}>
                Full ₹{fmt(payModal.amount_remaining)}
              </button>
              <button onClick={() => setPayAmount(String(Math.round(payModal.amount_remaining / 2)))}
                style={{ background: "#f3f4f6", color: "var(--ink)", border: "none", borderRadius: 8, padding: "0.4rem 0.75rem", fontSize: "0.78rem", fontWeight: 600, cursor: "pointer" }}>
                Half ₹{fmt(payModal.amount_remaining / 2)}
              </button>
            </div>
            <input type="number" placeholder="Enter amount" value={payAmount} onChange={e => setPayAmount(e.target.value)} min={1} max={payModal.amount_remaining}
              style={{ width: "100%", border: "1.5px solid #e5e7eb", borderRadius: 10, padding: "0.65rem 0.85rem", fontSize: "0.95rem", marginBottom: "0.65rem", boxSizing: "border-box" }} />

            {/* Payment mode */}
            <label style={{ fontSize: "0.8rem", fontWeight: 600, display: "block", marginBottom: "0.25rem" }}>Payment Mode</label>
            <div style={{ display: "flex", gap: "0.4rem", marginBottom: "0.65rem", flexWrap: "wrap" }}>
              {[["upi", "UPI / GPay"], ["bank_transfer", "Bank Transfer"], ["cash", "Cash"], ["other", "Other"]].map(([val, lbl]) => (
                <button key={val} onClick={() => setPayMode(val)}
                  style={{ borderRadius: 8, padding: "0.35rem 0.65rem", fontSize: "0.78rem", fontWeight: 600, cursor: "pointer", border: "1px solid " + (payMode === val ? "var(--orange)" : "#e5e7eb"), background: payMode === val ? "#fff7ed" : "#f9fafb", color: payMode === val ? "var(--orange)" : "var(--ink-3)" }}>
                  {lbl}
                </button>
              ))}
            </div>

            {/* Transaction ref */}
            <label style={{ fontSize: "0.8rem", fontWeight: 600, display: "block", marginBottom: "0.25rem" }}>Transaction Reference (optional)</label>
            <input type="text" placeholder="UPI transaction ID / bank ref / cheque no" value={payRef} onChange={e => setPayRef(e.target.value)}
              style={{ width: "100%", border: "1.5px solid #e5e7eb", borderRadius: 10, padding: "0.55rem 0.85rem", fontSize: "0.85rem", marginBottom: "0.65rem", boxSizing: "border-box" }} />

            {/* Notes */}
            <label style={{ fontSize: "0.8rem", fontWeight: 600, display: "block", marginBottom: "0.25rem" }}>Notes (optional)</label>
            <textarea placeholder="e.g. Weekly settlement for May 3rd week" value={payNotes} onChange={e => setPayNotes(e.target.value)} rows={2}
              style={{ width: "100%", border: "1.5px solid #e5e7eb", borderRadius: 10, padding: "0.55rem 0.85rem", fontSize: "0.85rem", marginBottom: "0.65rem", resize: "none", boxSizing: "border-box" }} />

            {payError && <p style={{ color: "#dc2626", fontSize: "0.78rem", marginBottom: "0.5rem" }}>⚠️ {payError}</p>}

            <button onClick={handlePay} disabled={payBusy || !payAmount || Number(payAmount) <= 0}
              style={{ width: "100%", background: "var(--orange)", color: "#fff", border: "none", borderRadius: 12, padding: "0.85rem", fontSize: "0.95rem", fontWeight: 800, cursor: "pointer", opacity: payBusy ? 0.7 : 1, marginBottom: "0.5rem" }}>
              {payBusy ? "Recording…" : `✅ Record Payment of ₹${payAmount || "—"} to ${payModal.canteen_name}`}
            </button>
            <button onClick={() => setPayModal(null)} style={{ width: "100%", background: "none", border: "1px solid #e5e7eb", borderRadius: 12, padding: "0.65rem", fontSize: "0.85rem", cursor: "pointer", color: "var(--ink-3)" }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ─── BANK DETAILS MODAL ─────────────────────────────────── */}
      {bankModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 200, display: "flex", alignItems: "flex-end", justifyContent: "center" }}
          onClick={e => { if (e.target === e.currentTarget) setBankModal(null); }}>
          <div style={{ background: "#fff", borderRadius: "20px 20px 0 0", padding: "1.25rem 1.25rem 2.5rem", width: "100%", maxWidth: 520, maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ width: 40, height: 4, background: "#e5e7eb", borderRadius: 99, margin: "0 auto 1rem" }} />
            <h3 style={{ fontWeight: 800, marginBottom: "1rem" }}>🏦 Bank Details — {bankModal.canteen_name}</h3>

            {[
              { key: "account_name", label: "Account Holder Name *", ph: "e.g. Main Canteen Pvt Ltd" },
              { key: "account_no",   label: "Account Number *",       ph: "e.g. 0012345678901" },
              { key: "ifsc_code",    label: "IFSC Code *",           ph: "e.g. SBIN0001234" },
              { key: "bank_name",    label: "Bank Name",              ph: "e.g. State Bank of India" },
              { key: "upi_id",       label: "UPI ID",                 ph: "e.g. canteen@okicici" },
              { key: "gpay_number",  label: "GPay / Phone Number",   ph: "e.g. 9876543210" },
            ].map(f => (
              <div key={f.key} style={{ marginBottom: "0.65rem" }}>
                <label style={{ fontSize: "0.78rem", fontWeight: 600, display: "block", marginBottom: "0.2rem" }}>{f.label}</label>
                <input type="text" placeholder={f.ph} value={(bankForm as Record<string, string>)[f.key] || ""}
                  onChange={e => setBankForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                  style={{ width: "100%", border: "1.5px solid #e5e7eb", borderRadius: 10, padding: "0.6rem 0.85rem", fontSize: "0.88rem", boxSizing: "border-box" }} />
              </div>
            ))}

            {bankError && <p style={{ color: "#dc2626", fontSize: "0.78rem", marginBottom: "0.5rem" }}>⚠️ {bankError}</p>}
            <button onClick={handleSaveBank} disabled={bankBusy}
              style={{ width: "100%", background: "var(--orange)", color: "#fff", border: "none", borderRadius: 12, padding: "0.8rem", fontSize: "0.92rem", fontWeight: 800, cursor: "pointer", opacity: bankBusy ? 0.7 : 1, marginBottom: "0.5rem" }}>
              {bankBusy ? "Saving…" : "Save Bank Details"}
            </button>
            <button onClick={() => setBankModal(null)} style={{ width: "100%", background: "none", border: "1px solid #e5e7eb", borderRadius: 12, padding: "0.65rem", fontSize: "0.85rem", cursor: "pointer", color: "var(--ink-3)" }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ─── PAYMENT HISTORY MODAL ──────────────────────────────── */}
      {histModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 200, overflow: "auto", display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "5vh" }}
          onClick={e => { if (e.target === e.currentTarget) setHistModal(null); }}>
          <div style={{ background: "#fff", borderRadius: 20, padding: "1.5rem", width: "94%", maxWidth: 560, maxHeight: "85vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "1rem" }}>
              <h3 style={{ fontWeight: 800, margin: 0 }}>📋 Payment History — {histModal.canteen_name}</h3>
              <button onClick={() => setHistModal(null)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "1.2rem", color: "var(--ink-3)" }}>✕</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
              {histModal.payments.map(p => (
                <div key={p.id} style={{ background: "#f9fafb", borderRadius: 12, padding: "0.75rem 0.85rem", border: "1px solid #e5e7eb" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: "0.88rem" }}>₹{fmt(p.amount_paid)}</div>
                      <div style={{ fontSize: "0.72rem", color: "var(--ink-3)" }}>{fmtDate(p.created_at)}</div>
                    </div>
                    <span style={{ background: "#f0fdf4", color: "#15803d", border: "1px solid #bbf7d0", borderRadius: 20, padding: "0.15rem 0.5rem", fontSize: "0.68rem", fontWeight: 700, textTransform: "uppercase" }}>
                      {p.payment_mode.replace("_", " ")}
                    </span>
                  </div>
                  {p.transaction_ref && (
                    <div style={{ marginTop: "0.3rem", fontSize: "0.72rem", color: "var(--ink-3)", fontFamily: "monospace" }}>
                      Ref: {p.transaction_ref}
                    </div>
                  )}
                  {p.notes && <div style={{ marginTop: "0.2rem", fontSize: "0.72rem", color: "var(--ink-3)" }}>{p.notes}</div>}
                  <div style={{ marginTop: "0.3rem", fontSize: "0.68rem", color: "var(--ink-3)" }}>
                    For period: {p.period_start} to {p.period_end}
                    {" · "}Net payable was ₹{fmt(p.net_payable)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ─── PLATFORM CHARGES MODAL ─────────────────────────────── */}
      {chargesModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}
          onClick={e => { if (e.target === e.currentTarget) setChargesModal(false); }}>
          <div style={{ background: "#fff", borderRadius: 20, padding: "1.5rem", width: "100%", maxWidth: 400 }}>
            <h3 style={{ fontWeight: 800, marginBottom: "0.5rem" }}>⚙️ Platform Charges Config</h3>
            <p style={{ fontSize: "0.78rem", color: "var(--ink-3)", marginBottom: "1rem" }}>
              These charges are deducted from the canteen&apos;s gross revenue before you pay them. GST is charged on top of your platform fee.
            </p>

            {[
              { key: "charge_pct",  label: "Platform charge (%)",         ph: "e.g. 2",  suffix: "% of gross revenue" },
              { key: "flat_charge", label: "Flat charge per order (₹)",   ph: "e.g. 0",  suffix: "₹ per completed order" },
              { key: "gst_pct",     label: "GST on platform charge (%)",  ph: "e.g. 18", suffix: "% (18% standard)" },
            ].map(f => (
              <div key={f.key} style={{ marginBottom: "0.75rem" }}>
                <label style={{ fontSize: "0.78rem", fontWeight: 600, display: "block", marginBottom: "0.2rem" }}>{f.label}</label>
                <input type="number" min={0} max={100} placeholder={f.ph}
                  value={(chargesForm as Record<string, number | undefined>)[f.key] ?? ""}
                  onChange={e => setChargesForm(prev => ({ ...prev, [f.key]: Number(e.target.value) }))}
                  style={{ width: "100%", border: "1.5px solid #e5e7eb", borderRadius: 10, padding: "0.6rem 0.85rem", fontSize: "0.95rem", boxSizing: "border-box" }} />
                <div style={{ fontSize: "0.68rem", color: "var(--ink-3)", marginTop: "0.15rem" }}>{f.suffix}</div>
              </div>
            ))}

            <div style={{ background: "#fffbeb", border: "1px solid #fde047", borderRadius: 10, padding: "0.5rem 0.75rem", fontSize: "0.72rem", color: "#713f12", marginBottom: "0.85rem" }}>
              💡 Example with 2% charge, GST 18%: ₹1000 order → ₹20 platform fee + ₹3.60 GST = <strong>₹976.40</strong> paid to canteen
            </div>

            <button onClick={handleSaveCharges} disabled={chargesBusy}
              style={{ width: "100%", background: "var(--orange)", color: "#fff", border: "none", borderRadius: 12, padding: "0.8rem", fontSize: "0.92rem", fontWeight: 800, cursor: "pointer", opacity: chargesBusy ? 0.7 : 1, marginBottom: "0.5rem" }}>
              {chargesBusy ? "Saving…" : "Save Charges"}
            </button>
            <button onClick={() => setChargesModal(false)} style={{ width: "100%", background: "none", border: "1px solid #e5e7eb", borderRadius: 12, padding: "0.65rem", fontSize: "0.85rem", cursor: "pointer", color: "var(--ink-3)" }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

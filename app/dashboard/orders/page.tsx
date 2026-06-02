"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { latestActiveOrder, readActiveOrders, writeActiveOrders } from "@/lib/activeOrdersClient";

// ─── Types ──────────────────────────────────────────────────────────────────

interface OrderItem { itemId: string; name: string; unitPrice: number; quantity: number; lineTotal: number; }
interface DbOrder {
  id: string; uid: string; items: OrderItem[]; total: number; status: string; rawStatus?: string;
  createdAt: string; canteenId?: string; canteenName?: string; paymentId?: string;
}
interface GstInvoice {
  invoice_number: string; invoice_date: string; order_id: string; order_status: string;
  seller: { name: string; address: string; gstin: string | null };
  customer: { name: string; email: string };
  canteen: { name: string; city: string; college: string };
  items: { name: string; quantity: number; unit_price: number; taxable_amount: number; cgst_2_5: number; sgst_2_5: number; total: number }[];
  subtotal: number; total_cgst: number; total_sgst: number; grand_total: number; payment_id: string | null; gst_note: string | null;
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function relativeDate(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000)      return "Just now";
  if (diff < 3_600_000)   return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000)  return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 172_800_000) return "Yesterday";
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

const STATUS_LABEL: Record<string, string>  = {
  placed: "Placed", confirmed: "Confirmed", preparing: "Preparing",
  ready_for_placement: "Ready to place", placed_in_bin: "In bin",
  ready_for_pickup: "Ready ✅", collected: "Collected", cancelled: "Cancelled",
  late_pickup_pending: "Late Pickup ⚠️",
  late_pickup: "Late Pickup ⚠️",
};
const STATUS_COLOR: Record<string, string> = {
  collected: "#15803d", ready_for_pickup: "#d97706", cancelled: "#dc2626",
  late_pickup_pending: "#b45309",
  late_pickup: "#b45309",
};

// ─── Main component ──────────────────────────────────────────────────────────
export default function MyOrdersPage() {
  const router = useRouter();
  const { user, session, loading } = useAuth();

  const [dbOrders,     setDbOrders]     = useState<DbOrder[]>([]);
  const [fetching,     setFetching]     = useState(true);
  const [tab,          setTab]          = useState<"orders" | "history">("orders");
  const [invoiceOrder, setInvoiceOrder] = useState<string | null>(null);
  const [invoice,      setInvoice]      = useState<GstInvoice | null>(null);
  const [invLoading,   setInvLoading]   = useState(false);
  const [reorderMsg,   setReorderMsg]   = useState<string | null>(null);

  // Auth guard — same pattern as /dashboard: never bounce to /login while a
  // Supabase session token is sitting in localStorage waiting to hydrate, and
  // always send the user to the student login screen with the correct role param.
  useEffect(() => {
    if (loading) return;
    if (user) return;
    let hasStoredSession = false;
    try {
      const raw = localStorage.getItem("canteen_auth_v2");
      hasStoredSession = !!raw && raw.length > 20;
    } catch { /* SSR safe */ }
    if (hasStoredSession) return;
    router.replace("/login?role=user");
  }, [user, loading, router]);

  // Fetch orders from DB
  const fetchOrders = useCallback(async () => {
    if (!session?.access_token) { setFetching(false); return; }
    try {
      const res = await fetch("/api/orders", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const d = await res.json();
      if (res.ok) setDbOrders((d.orders ?? []) as DbOrder[]);
    } catch { /* ignore */ } finally { setFetching(false); }
  }, [session?.access_token]);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  // ── Reorder ──────────────────────────────────────────────────
  function handleReorder(order: DbOrder) {
    if (!order.items || order.items.length === 0) { setReorderMsg("No items found for this order."); return; }
    if (!order.canteenId) { setReorderMsg("Cannot reorder — canteen info missing."); return; }
    const cartParam = order.items
      .map(i => `${i.itemId}:${encodeURIComponent(i.name)}:${i.unitPrice}:${i.quantity}`)
      .join(",");
    const url = `/dashboard/cart?canteenId=${order.canteenId}&canteenName=${encodeURIComponent(order.canteenName ?? "Canteen")}&cart=${cartParam}`;
    router.push(url);
  }

  // ── View Invoice ──────────────────────────────────────────────
  async function handleViewInvoice(orderId: string) {
    if (!session?.access_token) return;
    setInvoiceOrder(orderId); setInvoice(null); setInvLoading(true);
    try {
      const res = await fetch(`/api/orders/${orderId}/invoice`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const d = await res.json();
      if (res.ok) setInvoice(d);
    } catch { /* ignore */ } finally { setInvLoading(false); }
  }

  // Active order banner is shown ONLY on /dashboard and /dashboard/order-status
  // (per client spec: OTP must never appear on the My Orders page, and the user
  // must NOT have a self-serve "Mark as collected" button — only canteen staff can
  // mark an order picked up). Keep a compact pointer instead so the user can jump
  // back to the live status screen.
  const [hasActiveOrder, setHasActiveOrder] = useState<{ id: string; slot: string } | null>(null);
  useEffect(() => {
    try {
      const all = readActiveOrders(user?.uid ?? null);
      writeActiveOrders(all);
      const latest = latestActiveOrder(user?.uid ?? null);
      if (!latest) { setHasActiveOrder(null); return; }
      setHasActiveOrder({ id: latest.id, slot: latest.slot ?? "Upcoming" });
    } catch { /* ignore */ }
  }, [user?.uid]);

  const completed = dbOrders.filter(o => o.rawStatus === "collected" || o.status === "completed");
  const active    = dbOrders.filter(o => !["collected", "cancelled"].includes(o.rawStatus ?? o.status) && o.rawStatus !== "completed");

  if (loading) return <div className="page-loading"><div className="spinner" /></div>;

  return (
    <div className="app-shell">
      {/* Top bar */}
      <div className="app-topbar">
        <button onClick={() => router.back()} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "1.1rem", color: "var(--ink-3)" }}>←</button>
        <h1 style={{ fontSize: "1.05rem", fontWeight: 700 }}>My Orders</h1>
        <div />
      </div>

      {/* Tab switcher */}
      <div className="slot-tabs" style={{ gap: "0.4rem", position: "sticky", top: 56, zIndex: 10, background: "var(--bg)", paddingTop: "0.25rem", paddingBottom: "0.25rem" }}>
        {(["orders", "history"] as const).map(t => (
          <button key={t} className={`slot-tab ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>
            {t === "orders" ? `Active (${active.length})` : `History (${completed.length})`}
          </button>
        ))}
      </div>

      {reorderMsg && (
        <div style={{ margin: "0.5rem 1rem", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "0.5rem 0.75rem", fontSize: "0.8rem", color: "#dc2626", display: "flex", justifyContent: "space-between" }}>
          {reorderMsg}
          <button onClick={() => setReorderMsg(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "#dc2626" }}>✕</button>
        </div>
      )}

      <div style={{ padding: "0.75rem 1rem", display: "flex", flexDirection: "column", gap: "0.75rem", paddingBottom: "5rem" }}>

        {/* ── ACTIVE ORDERS TAB ── */}
        {tab === "orders" && (
          <>
            {/* Compact pointer to /dashboard/order-status (OTP + Mark-Picked
                live ONLY there, per client spec). No OTP, no "Mark as collected"
                button on this page — those are wrong placement. */}
            {hasActiveOrder && (
              <Link href={`/dashboard/order-status?id=${hasActiveOrder.id}`} className="card" style={{ padding: "0.85rem", display: "flex", justifyContent: "space-between", alignItems: "center", textDecoration: "none", color: "inherit", border: "1.5px solid var(--orange)", background: "#fff7ed" }}>
                <div>
                  <div style={{ fontSize: "0.7rem", fontWeight: 800, color: "var(--orange)", textTransform: "uppercase", letterSpacing: "0.05em" }}>Order in progress</div>
                  <div style={{ fontWeight: 700, fontSize: "0.92rem", marginTop: "0.15rem" }}>{hasActiveOrder.slot}</div>
                  <div style={{ fontSize: "0.72rem", color: "var(--ink-3)", marginTop: "0.1rem" }}>Tap to view bin & OTP</div>
                </div>
                <span style={{ fontSize: "1.3rem", color: "var(--orange)" }}>›</span>
              </Link>
            )}

            {/* DB active orders */}
            {fetching && <p style={{ color: "var(--ink-3)", fontSize: "0.85rem" }}>Loading…</p>}
            {!fetching && active.length === 0 && !hasActiveOrder && (
              <div className="empty-state">
                <span className="empty-icon">📦</span>
                <h3>No active orders</h3>
                <p>Your active orders will appear here after checkout.</p>
                <Link href="/dashboard" className="btn btn-primary" style={{ marginTop: "0.5rem" }}>Browse canteens</Link>
              </div>
            )}
            {active.map(o => (
              <OrderCard key={o.id} order={o} onReorder={handleReorder} onInvoice={handleViewInvoice} showReorder={false} showTrack={true} />
            ))}
          </>
        )}

        {/* ── HISTORY TAB ── */}
        {tab === "history" && (
          <>
            {fetching && <p style={{ color: "var(--ink-3)", fontSize: "0.85rem" }}>Loading…</p>}
            {!fetching && completed.length === 0 && (
              <div className="empty-state">
                <span className="empty-icon">🧾</span>
                <h3>No order history</h3>
                <p>Your completed orders will appear here.</p>
                <Link href="/dashboard" className="btn btn-primary" style={{ marginTop: "0.5rem" }}>Place an order</Link>
              </div>
            )}
            {completed.map(o => (
              <OrderCard key={o.id} order={o} onReorder={handleReorder} onInvoice={handleViewInvoice} showReorder={true} />
            ))}
          </>
        )}
      </div>

      {/* ── Bottom nav ── */}
      <nav className="bottom-nav">
        {[
          { tab: "home",    icon: "🏠", label: "Home",    href: "/dashboard" },
          { tab: "orders",  icon: "📊", label: "Stats",   href: "/dashboard/orders/stats" },
          { tab: "profile", icon: "👤", label: "Profile", href: "/dashboard/profile" },
        ].map(item => (
          <Link key={item.tab} href={item.href} className={`bottom-nav-item ${item.tab === "home" ? "active" : ""}`}>
            <span className="nav-icon">{item.icon}</span>
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>

      {/* ── GST Invoice Modal ── */}
      {invoiceOrder && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 200, overflow: "auto", display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "5vh" }}
          onClick={e => { if (e.target === e.currentTarget) { setInvoiceOrder(null); setInvoice(null); } }}>
          <div style={{ background: "#fff", borderRadius: 20, padding: "1.5rem", width: "94%", maxWidth: 520, maxHeight: "90vh", overflowY: "auto", margin: "0 1rem 2rem" }}>
            {invLoading && <div style={{ textAlign: "center", padding: "2rem", color: "var(--ink-3)" }}>Generating invoice…</div>}
            {!invLoading && invoice && (
              <>
                {/* Invoice header */}
                <div style={{ textAlign: "center", marginBottom: "1rem", paddingBottom: "0.75rem", borderBottom: "2px dashed #e5e7eb" }}>
                  <div style={{ fontWeight: 900, fontSize: "1.1rem", color: "var(--orange)" }}>NoQx Canteen Invoice</div>
                  <div style={{ fontSize: "0.75rem", color: "var(--ink-3)", marginTop: "0.2rem" }}>Invoice #{invoice.invoice_number}</div>
                  <div style={{ fontSize: "0.72rem", color: "var(--ink-3)" }}>{new Date(invoice.invoice_date).toLocaleString("en-IN")}</div>
                </div>

                {/* Seller info */}
                <div style={{ marginBottom: "0.75rem", fontSize: "0.74rem", color: "var(--ink-3)" }}>
                  <span style={{ fontWeight: 700, color: "var(--ink)" }}>{invoice.seller.name}</span>
                  {" · "}{invoice.seller.address}
                  {invoice.seller.gstin && <span style={{ marginLeft: "0.5rem", background: "#f0fdf4", color: "#166534", borderRadius: 4, padding: "0.1rem 0.35rem", fontWeight: 700, fontSize: "0.7rem" }}>GSTIN: {invoice.seller.gstin}</span>}
                </div>

                {/* Canteen & customer */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem", marginBottom: "0.75rem", fontSize: "0.76rem" }}>
                  <div>
                    <div style={{ fontWeight: 600, color: "var(--ink-3)", fontSize: "0.66rem", textTransform: "uppercase", marginBottom: "0.2rem" }}>Canteen</div>
                    <div style={{ fontWeight: 700 }}>{invoice.canteen.name}</div>
                    {invoice.canteen.college && <div style={{ color: "var(--ink-3)" }}>{invoice.canteen.college}</div>}
                    {invoice.canteen.city && <div style={{ color: "var(--ink-3)" }}>{invoice.canteen.city}</div>}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, color: "var(--ink-3)", fontSize: "0.66rem", textTransform: "uppercase", marginBottom: "0.2rem" }}>Billed To</div>
                    <div style={{ fontWeight: 700 }}>{invoice.customer.name}</div>
                    {invoice.customer.email && <div style={{ color: "var(--ink-3)", wordBreak: "break-all" }}>{invoice.customer.email}</div>}
                  </div>
                </div>

                {/* Items table */}
                <div style={{ marginBottom: "0.75rem" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "3fr 1fr 1fr 1fr", gap: "0.25rem 0.5rem", fontSize: "0.65rem", fontWeight: 700, color: "var(--ink-3)", textTransform: "uppercase", paddingBottom: "0.3rem", borderBottom: "1px solid #e5e7eb", marginBottom: "0.35rem" }}>
                    <span>Item</span><span style={{ textAlign: "right" }}>Qty</span><span style={{ textAlign: "right" }}>Rate</span><span style={{ textAlign: "right" }}>Amount</span>
                  </div>
                  {invoice.items.map((item, i) => (
                    <div key={i} style={{ display: "grid", gridTemplateColumns: "3fr 1fr 1fr 1fr", gap: "0.25rem 0.5rem", fontSize: "0.75rem", alignItems: "center", paddingBottom: "0.25rem" }}>
                      <span style={{ fontWeight: 600 }}>{item.name}</span>
                      <span style={{ textAlign: "right" }}>{item.quantity}</span>
                      <span style={{ textAlign: "right" }}>₹{item.unit_price.toFixed(2)}</span>
                      <span style={{ textAlign: "right" }}>₹{item.taxable_amount.toFixed(2)}</span>
                    </div>
                  ))}
                </div>

                {/* Tax summary */}
                <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: "0.5rem", fontSize: "0.76rem" }}>
                  {invoice.total_cgst > 0 ? (
                    <>
                      {[
                        ["Subtotal (before tax)",  `₹${invoice.subtotal.toFixed(2)}`],
                        ["CGST @ 2.5%",            `₹${invoice.total_cgst.toFixed(2)}`],
                        ["SGST @ 2.5%",            `₹${invoice.total_sgst.toFixed(2)}`],
                      ].map(([k, v]) => (
                        <div key={k} style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.2rem" }}>
                          <span style={{ color: "var(--ink-3)" }}>{k}</span>
                          <span>{v}</span>
                        </div>
                      ))}
                    </>
                  ) : (
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.2rem" }}>
                      <span style={{ color: "var(--ink-3)" }}>Subtotal</span>
                      <span>₹{invoice.subtotal.toFixed(2)}</span>
                    </div>
                  )}
                  <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800, fontSize: "0.88rem", borderTop: "2px solid #e5e7eb", paddingTop: "0.4rem", marginTop: "0.2rem" }}>
                    <span>Grand Total</span>
                    <span style={{ color: "var(--orange)" }}>₹{invoice.grand_total.toFixed(2)}</span>
                  </div>
                </div>

                {/* Payment ref */}
                {invoice.payment_id && (
                  <div style={{ marginTop: "0.5rem", fontSize: "0.68rem", color: "var(--ink-3)", fontFamily: "monospace" }}>
                    Payment ID: {invoice.payment_id}
                  </div>
                )}

                {/* GST note — only shown when GST was actually charged */}
                {invoice.gst_note && (
                  <div style={{ marginTop: "0.5rem", fontSize: "0.65rem", color: "var(--ink-3)", lineHeight: 1.5, paddingTop: "0.5rem", borderTop: "1px dashed #e5e7eb" }}>
                    {invoice.gst_note}
                  </div>
                )}

                <button onClick={() => { setInvoiceOrder(null); setInvoice(null); }}
                  style={{ width: "100%", marginTop: "1rem", background: "#f3f4f6", border: "none", borderRadius: 12, padding: "0.7rem", fontSize: "0.88rem", fontWeight: 700, cursor: "pointer" }}>
                  Close
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Order card sub-component ─────────────────────────────────────────────────
function OrderCard({ order, onReorder, onInvoice, showReorder, showTrack }: {
  order: DbOrder;
  onReorder: (o: DbOrder) => void;
  onInvoice: (id: string) => void;
  showReorder: boolean;
  showTrack?: boolean;
}) {
  const rawSt = order.rawStatus ?? order.status;
  const statusLabel = STATUS_LABEL[rawSt] ?? rawSt;
  const statusColor = STATUS_COLOR[rawSt] ?? "var(--ink-2)";

  return (
    <div className="card" style={{ padding: "0.85rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.4rem" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: "0.88rem", fontFamily: "monospace" }}>{order.id.slice(-8).toUpperCase()}</div>
          <div style={{ fontSize: "0.72rem", color: "var(--ink-3)" }}>
            {order.canteenName || "Canteen"} · {relativeDate(order.createdAt)}
          </div>
        </div>
        <span style={{ fontSize: "0.72rem", fontWeight: 700, color: statusColor, background: statusColor + "18", borderRadius: 20, padding: "0.2rem 0.55rem" }}>
          {statusLabel}
        </span>
      </div>

      {/* Items */}
      {order.items && order.items.length > 0 ? (
        <div style={{ fontSize: "0.78rem", color: "var(--ink-2)", margin: "0.35rem 0" }}>
          {order.items.map((item, i) => (
            <span key={i}>{item.name} ×{item.quantity}{i < order.items.length - 1 ? " · " : ""}</span>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: "0.78rem", color: "var(--ink-3)", margin: "0.35rem 0" }}>Items not available</div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "0.4rem" }}>
        <div style={{ fontWeight: 800, color: "var(--orange)", fontSize: "0.95rem" }}>₹{order.total}</div>
        {order.paymentId && (
          <span style={{ fontSize: "0.68rem", color: "var(--ink-3)", fontFamily: "monospace" }}>
            {order.paymentId === "FREE" ? "Free order" : `ID:…${order.paymentId.slice(-8)}`}
          </span>
        )}
      </div>

      {/* Track Order — full-width prominent button for active orders */}
      {showTrack && (
        <Link
          href={`/dashboard/order-status?id=${order.id}`}
          style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.4rem", marginTop: "0.65rem", background: "#1e293b", color: "#fff", borderRadius: 10, padding: "0.6rem", fontSize: "0.82rem", fontWeight: 700, textDecoration: "none" }}
        >
          📍 Track Order
          <span style={{ fontSize: "0.7rem", opacity: 0.75 }}>›</span>
        </Link>
      )}

      {/* Action buttons */}
      <div style={{ display: "flex", gap: "0.5rem", marginTop: showTrack ? "0.45rem" : "0.6rem" }}>
        <button onClick={() => onInvoice(order.id)}
          style={{ flex: 1, background: "#f3f4f6", border: "1px solid #e5e7eb", borderRadius: 8, padding: "0.4rem", fontSize: "0.75rem", fontWeight: 600, cursor: "pointer", color: "var(--ink-2)" }}>
          🧾 View Invoice (GST)
        </button>
        {showReorder && (
          <button onClick={() => onReorder(order)}
            style={{ flex: 1, background: "#fff7ed", border: "1.5px solid var(--orange)", borderRadius: 8, padding: "0.4rem", fontSize: "0.75rem", fontWeight: 700, cursor: "pointer", color: "var(--orange)" }}>
            🔁 Reorder
          </button>
        )}
      </div>
    </div>
  );
}


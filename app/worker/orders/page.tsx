"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

interface WorkerOrder {
  id: string;
  status: string;
  bin_label?: string | null;
  bin_color?: string | null;
  pickup_slot?: string | null;
  customer_name?: string | null;
  items: { name: string; quantity: number }[];
  bin_assignments?: { binIndex: number; binLabel: string; binColor: string; items: { name: string; quantity: number; isMeal?: boolean }[] }[];
}

interface SlotAggregate {
  slot: string;
  itemTotals: Array<{ name: string; quantity: number }>;
  binPlans: Array<{
    binLabel: string;
    binColor: string;
    orderId: string;
    studentName: string;
    items: Array<{ name: string; quantity: number }>;
  }>;
}

const BIN_COLORS: Record<string, string> = {
  red: "#ef4444", blue: "#3b82f6", green: "#22c55e",
  yellow: "#eab308", purple: "#a855f7", orange: "#f97316",
};

const ACTIVE_STATUSES = ["placed", "confirmed", "preparing", "ready_for_placement", "placed_in_bin", "ready_for_pickup"];

function tint(hex: string, alpha: string): string {
  if (!hex.startsWith("#") || hex.length !== 7) return `${hex}${alpha}`;
  return `${hex}${alpha}`;
}

function parseSlotRange(label: string): { startMin: number; endMin: number } | null {
  const m = label.match(
    /^(\d{1,2}):(\d{2})\s*(AM|PM)\s*[-–]\s*(\d{1,2}):(\d{2})\s*(AM|PM)$/i,
  );
  if (!m) return null;
  const toMin = (h: number, mn: number, period: string) => {
    let hr = h;
    if (period.toUpperCase() === "PM" && hr !== 12) hr += 12;
    if (period.toUpperCase() === "AM" && hr === 12) hr = 0;
    return hr * 60 + mn;
  };
  return {
    startMin: toMin(parseInt(m[1]), parseInt(m[2]), m[3]),
    endMin: toMin(parseInt(m[4]), parseInt(m[5]), m[6]),
  };
}

function getNowISTMin(): number {
  const now = new Date();
  const istMs = now.getTime() + 5.5 * 60 * 60 * 1000;
  const ist = new Date(istMs);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

// Orders tab: show late, current, or slots starting within the next 60 min (unchanged).
function isOrderRelevant(slotLabel: string | null | undefined): boolean {
  if (!slotLabel) return true;
  const range = parseSlotRange(slotLabel);
  if (!range) return true;
  const now = getNowISTMin();
  const isLate     = range.endMin <= now;
  const isCurrent  = range.startMin <= now && range.endMin > now;
  const isUpcoming = range.startMin > now && range.startMin <= now + 60;
  return isLate || isCurrent || isUpcoming;
}

// Prep tab: show only the immediately upcoming slot (within 15 min before start)
// or the currently active slot. Past/ended slots are excluded so the worker
// only sees what to prepare next — not stale info from previous slots.
function isPrepRelevant(slotLabel: string | null | undefined): boolean {
  if (!slotLabel) return true;
  const range = parseSlotRange(slotLabel);
  if (!range) return true;
  const now = getNowISTMin();
  const isCurrent  = range.startMin <= now && range.endMin > now;
  const isUpcoming = range.startMin > now && range.startMin <= now + 15;
  return isCurrent || isUpcoming;
}

function aggregateBySlot(orders: WorkerOrder[]): SlotAggregate[] {
  const bySlot = new Map<string, SlotAggregate>();

  for (const order of orders) {
    const slot = order.pickup_slot ?? "Unknown";
    const found = bySlot.get(slot) ?? { slot, itemTotals: [], binPlans: [] };

    const itemMap = new Map<string, number>(found.itemTotals.map((it) => [it.name, it.quantity]));
    for (const item of order.items) {
      itemMap.set(item.name, (itemMap.get(item.name) ?? 0) + item.quantity);
    }
    found.itemTotals = Array.from(itemMap.entries())
      .map(([name, quantity]) => ({ name, quantity }))
      .sort((a, b) => b.quantity - a.quantity);

    const assignments =
      order.bin_assignments && order.bin_assignments.length > 0
        ? order.bin_assignments.map((a) => ({
            binLabel: a.binLabel,
            binColor: a.binColor,
            items: a.items.map((it) => ({ name: it.name, quantity: it.quantity })),
          }))
        : [{ binLabel: order.bin_label ?? "⏳ Pending", binColor: order.bin_color ?? "orange", items: order.items }];

    for (const a of assignments) {
      found.binPlans.push({
        binLabel: a.binLabel,
        binColor: a.binColor,
        orderId: order.id,
        studentName: order.customer_name ?? "Unknown",
        items: a.items,
      });
    }

    bySlot.set(slot, found);
  }

  return Array.from(bySlot.values())
    .map((slot) => ({ ...slot, binPlans: slot.binPlans.sort((a, b) => a.binLabel.localeCompare(b.binLabel)) }))
    .sort((a, b) => a.slot.localeCompare(b.slot));
}

export default function WorkerOrdersPage() {
  const router = useRouter();
  const { user, session, loading, logout } = useAuth();
  const [orders, setOrders]         = useState<WorkerOrder[]>([]);
  const [fetching, setFetching]     = useState(true);
  const [updating, setUpdating]     = useState<string | null>(null);
  const [activeSlot, setActiveSlot] = useState<string>("__all__");
  const [tab, setTab]               = useState<"orders" | "prep">("orders");
  const [otpModal, setOtpModal]     = useState<string | null>(null);
  const [otpInput, setOtpInput]     = useState("");
  const [otpSubmitting, setOtpSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.push("/login");
    if (!loading && user && user.role !== "worker") router.push("/");
  }, [user, loading, router]);

  useEffect(() => {
    if (!session || !user?.role) return;
    let aborted = false;

    async function fetchOrders() {
      try {
        const res = await fetch("/api/orders?worker=true", {
          headers: { Authorization: `Bearer ${session!.access_token}` },
        });
        const data = await res.json();
        if (!aborted) {
          type ApiCanteenOrder = {
            id: string;
            customerName?: string;
            status?: string;
            rawStatus?: string;
            binLabel?: string | null;
            binColor?: string | null;
            slotLabel?: string | null;
            pickupSlot?: string | null;
            items?: { name: string; quantity: number }[];
            binAssignments?: { binIndex: number; binLabel: string; binColor: string; items: { name: string; quantity: number; isMeal?: boolean }[] }[];
          };
          const mapped: WorkerOrder[] = ((data.orders ?? []) as ApiCanteenOrder[])
            .filter((o) => {
              const raw = o.rawStatus ?? o.status ?? "";
              return ACTIVE_STATUSES.includes(raw);
            })
            .map((o) => ({
              id: o.id,
              status: o.rawStatus ?? o.status ?? "placed",
              bin_label: o.binLabel ?? null,
              bin_color: o.binColor ?? null,
              pickup_slot: o.slotLabel ?? o.pickupSlot ?? null,
              customer_name: o.customerName ?? null,
              items: o.items ?? [],
              bin_assignments: o.binAssignments,
            }));
          setOrders(mapped);
          setFetching(false);
        }
      } catch { if (!aborted) setFetching(false); }
    }

    fetchOrders();
    const interval = setInterval(fetchOrders, 5000);
    return () => { aborted = true; clearInterval(interval); };
  }, [session, user]);

  async function updateStatus(orderId: string, status: string) {
    if (!session) return;
    setUpdating(orderId);
    try {
      await fetch(`/api/orders/${orderId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ status }),
      });
      setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, status } : o)));
    } finally { setUpdating(null); }
  }

  async function verifyOtp(orderId: string) {
    if (!session || otpInput.length < 4) return;
    setOtpSubmitting(true);
    try {
      const res = await fetch(`/api/orders/${orderId}/verify-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ otp: otpInput }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Verification failed");
      setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, status: "collected" } : o)));
      setOtpModal(null);
      setOtpInput("");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Error verifying OTP");
    } finally { setOtpSubmitting(false); }
  }

  // Orders tab: same wide window as before (late + current + 60-min upcoming)
  const relevantOrders = orders.filter((o) => isOrderRelevant(o.pickup_slot));
  const slots = [...new Set(relevantOrders.map((o) => o.pickup_slot).filter((s): s is string => Boolean(s)))].sort();
  const displayedOrders = activeSlot === "__all__"
    ? relevantOrders
    : relevantOrders.filter((o) => o.pickup_slot === activeSlot);

  // Prep tab: only the immediately upcoming slot (15-min window, no past slots)
  const prepOrders = orders.filter((o) => isPrepRelevant(o.pickup_slot));
  const prepSummary = aggregateBySlot(prepOrders);
  const selectedSummary = prepSummary[0] ?? null;

  if (loading || fetching) return <div className="page-loading"><div className="spinner" /></div>;

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      {/* Top bar */}
      <div style={{ background: "#1e293b", color: "#fff", padding: "0.75rem 1rem", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontWeight: 700, fontSize: "1rem" }}>Canteen-Application · Orders</div>
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", fontSize: "0.82rem" }}>
          <span style={{ color: "#94a3b8" }}>{new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>
          <button
            onClick={() => logout().then(() => router.push("/login"))}
            style={{ background: "none", border: "1px solid #475569", color: "#94a3b8", borderRadius: 8, padding: "0.35rem 0.65rem", cursor: "pointer", fontSize: "0.78rem" }}
          >
            Logout
          </button>
        </div>
      </div>

      {/* Slot dropdown — orders tab only */}
      {tab === "orders" && (
        <div style={{ background: "#fff", borderBottom: "1px solid var(--border)", padding: "0.6rem 1rem", display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <label htmlFor="slot-select" style={{ fontSize: "0.8rem", fontWeight: 700, color: "#475569", whiteSpace: "nowrap" }}>Slot:</label>
          <select
            id="slot-select"
            value={activeSlot}
            onChange={(e) => setActiveSlot(e.target.value)}
            style={{ flex: 1, padding: "0.45rem 0.7rem", borderRadius: 10, border: "1.5px solid #cbd5e1", background: "#f8fafc", fontSize: "0.85rem", fontWeight: 600, color: "#0f172a", cursor: "pointer", outline: "none", appearance: "auto" }}
          >
            <option value="__all__">All relevant ({relevantOrders.length})</option>
            {slots.map((slot) => (
              <option key={slot} value={slot}>{slot} ({relevantOrders.filter((o) => o.pickup_slot === slot).length})</option>
            ))}
          </select>
          {orders.length !== relevantOrders.length && (
            <span style={{ fontSize: "0.74rem", color: "#94a3b8", whiteSpace: "nowrap" }}>{orders.length - relevantOrders.length} hidden (future)</span>
          )}
        </div>
      )}

      {/* Content */}
      <div style={{ padding: "1rem", paddingBottom: "5rem" }}>

        {/* ── ORDERS TAB (unchanged from original) ── */}
        {tab === "orders" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
            {displayedOrders.length === 0 && (
              <div style={{ textAlign: "center", color: "var(--ink-3)", padding: "3rem 0", fontSize: "0.9rem" }}>
                No orders for this slot.
              </div>
            )}
            {displayedOrders.map((order) => {
              const assignments =
                order.bin_assignments && order.bin_assignments.length > 0
                  ? order.bin_assignments
                  : [{ binIndex: 1, binLabel: order.bin_label ?? "⏳ Pending", binColor: order.bin_color ?? "orange", items: order.items }];

              return (
                <div key={order.id} style={{ background: "#fff", borderRadius: 16, boxShadow: "0 3px 10px rgba(0,0,0,0.09)", border: "1px solid #e2e8f0", overflow: "hidden" }}>
                  <div style={{ padding: "0.75rem 0.85rem", borderBottom: "1px solid #e2e8f0", background: "#f8fafc" }}>
                    <div style={{ fontWeight: 800, color: "#0f172a", fontSize: "0.95rem" }}>Student: {order.customer_name || "Unknown"}</div>
                    <div style={{ fontSize: "0.78rem", color: "#64748b", marginTop: 2 }}>
                      Order #{order.id.slice(-8).toUpperCase()} · Slot {order.pickup_slot ?? "—"}
                    </div>
                  </div>

                  <div style={{ padding: "0.75rem", display: "grid", gap: "0.65rem" }}>
                    {assignments.map((a) => {
                      const binColor = BIN_COLORS[a.binColor] ?? "#f97316";
                      return (
                        <div key={`${order.id}-${a.binIndex}-${a.binLabel}`} style={{ border: `2px solid ${binColor}`, borderRadius: 14, background: tint(binColor, "18"), overflow: "hidden" }}>
                          <div style={{ background: binColor, color: "#fff", padding: "0.45rem 0.7rem", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.6rem" }}>
                            <span style={{ fontWeight: 900, fontSize: "1.02rem" }}>Bin {a.binLabel}</span>
                            <span style={{ fontSize: "0.72rem", opacity: 0.92 }}>Order {order.id.slice(-8).toUpperCase()}</span>
                          </div>
                          <div style={{ padding: "0.55rem 0.7rem" }}>
                            {a.items.map((it, idx) => (
                              <div key={`${it.name}-${idx}`} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.92rem", fontWeight: 700, padding: "0.18rem 0", borderBottom: idx < a.items.length - 1 ? "1px dashed #cbd5e1" : "none" }}>
                                <span>{it.name}</span>
                                <span style={{ color: "#b45309" }}>x{it.quantity}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div style={{ padding: "0 0.75rem 0.75rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                    {(order.status === "confirmed" || order.status === "preparing" || order.status === "ready_for_placement") && (
                      <button
                        disabled={updating === order.id}
                        onClick={() => {
                          if (confirm(`Are you sure the order is placed in the correct bin?\n\nBin: ${order.bin_label || "Unknown"}`)) {
                            updateStatus(order.id, "placed_in_bin");
                          }
                        }}
                        style={{ background: "#eab308", color: "#000", border: "none", borderRadius: 10, padding: "0.7rem", fontWeight: 700, fontSize: "0.9rem", cursor: "pointer" }}
                      >
                        {updating === order.id ? "..." : "🟡 Placed in Bin"}
                      </button>
                    )}
                    {order.status === "placed_in_bin" && (
                      <button
                        onClick={() => { setOtpModal(order.id); setOtpInput(""); }}
                        style={{ background: "#dcfce7", color: "#166534", border: "1.5px solid #86efac", borderRadius: 10, padding: "0.6rem 0.75rem", fontSize: "0.82rem", fontWeight: 700, cursor: "pointer" }}
                      >
                        🔐 Enter OTP to Complete
                      </button>
                    )}
                    {order.status === "ready_for_pickup" && (
                      <div style={{ background: "#dbeafe", borderRadius: 10, padding: "0.6rem 0.75rem", fontSize: "0.82rem", color: "#164e63", fontWeight: 700, textAlign: "center" }}>
                        ✓ Order Completed
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── PREP TAB — only shows the next upcoming slot (15-min window) ── */}
        {tab === "prep" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
            {!selectedSummary && (
              <div style={{ textAlign: "center", color: "var(--ink-3)", padding: "3rem 0", fontSize: "0.9rem" }}>
                No upcoming orders yet — prep info appears 15 min before the next slot.
              </div>
            )}
            {selectedSummary && (
              <>
                {/* Slot header */}
                <div style={{ background: "#dcfce7", border: "1.5px solid #86efac", borderRadius: 10, padding: "0.55rem 0.9rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span style={{ fontSize: "1.1rem" }}>⏰</span>
                  <span style={{ fontWeight: 800, fontSize: "0.9rem", color: "#166534" }}>
                    PREP NOW — {selectedSummary.slot}
                  </span>
                  <span style={{ marginLeft: "auto", fontSize: "0.78rem", color: "#64748b", fontWeight: 600 }}>
                    {prepOrders.filter((o) => o.pickup_slot === selectedSummary.slot).length} orders
                  </span>
                </div>

                {/* Item totals */}
                <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, boxShadow: "0 2px 8px rgba(0,0,0,0.06)", overflow: "hidden" }}>
                  <div style={{ background: "#0f172a", color: "#fff", padding: "0.7rem 0.9rem" }}>
                    <div style={{ fontWeight: 800, fontSize: "0.9rem" }}>What to Prepare</div>
                    <div style={{ fontSize: "0.76rem", opacity: 0.85 }}>Total quantities for this slot</div>
                  </div>
                  <div style={{ padding: "0.75rem 0.9rem" }}>
                    {selectedSummary.itemTotals.map((it, idx) => (
                      <div key={`${it.name}-${idx}`} style={{ display: "flex", justifyContent: "space-between", padding: "0.32rem 0", borderBottom: idx < selectedSummary.itemTotals.length - 1 ? "1px solid #e2e8f0" : "none", fontWeight: 700 }}>
                        <span>{it.name}</span>
                        <span style={{ color: "#ea580c" }}>{it.quantity}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Bin placement plan */}
                <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, boxShadow: "0 2px 8px rgba(0,0,0,0.06)", overflow: "hidden" }}>
                  <div style={{ background: "#f8fafc", padding: "0.7rem 0.9rem", borderBottom: "1px solid #e2e8f0" }}>
                    <div style={{ fontWeight: 800, fontSize: "0.9rem", color: "#0f172a" }}>Bin Placement Plan</div>
                    <div style={{ fontSize: "0.76rem", color: "#64748b" }}>Which items go into which bins</div>
                  </div>
                  <div style={{ padding: "0.75rem" }}>
                    {selectedSummary.binPlans.length === 0 && (
                      <div style={{ color: "#64748b", fontSize: "0.84rem" }}>Bins will be assigned at slot start time.</div>
                    )}
                    {selectedSummary.binPlans.map((bp, idx) => {
                      const c = BIN_COLORS[bp.binColor] ?? "#f97316";
                      return (
                        <div key={`${bp.orderId}-${bp.binLabel}-${idx}`} style={{ border: `1.5px solid ${c}`, borderRadius: 12, marginBottom: "0.55rem", overflow: "hidden" }}>
                          <div style={{ background: tint(c, "20"), padding: "0.45rem 0.65rem", display: "flex", justifyContent: "space-between", gap: "0.5rem", fontSize: "0.78rem" }}>
                            <strong style={{ color: c }}>Bin {bp.binLabel}</strong>
                            <span style={{ color: "#334155" }}>Order #{bp.orderId.slice(-8).toUpperCase()} · {bp.studentName}</span>
                          </div>
                          <div style={{ padding: "0.5rem 0.65rem" }}>
                            {bp.items.map((it, i) => (
                              <div key={`${it.name}-${i}`} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.86rem", fontWeight: 700, borderBottom: i < bp.items.length - 1 ? "1px dashed #cbd5e1" : "none", padding: "0.2rem 0" }}>
                                <span>{it.name}</span>
                                <span>x{it.quantity}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Bottom nav — inline styles so desktop media-query doesn't hide it */}
      <div style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 430, background: "var(--surface,#fff)", borderTop: "1px solid var(--border,#e2e8f0)", display: "flex", zIndex: 30, paddingBottom: "env(safe-area-inset-bottom,0.5rem)" }}>
        {([
          { key: "orders", label: "Orders",   icon: "📦" },
          { key: "prep",   label: "Prep Plan", icon: "📊" },
        ] as { key: "orders"|"prep"; label: string; icon: string }[]).map(({ key, label, icon }) => (
          <button key={key} onClick={() => setTab(key)}
            style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: "0.2rem", padding: "0.5rem 0", background: "none", border: "none", cursor: "pointer", fontSize: "0.65rem", fontWeight: 600, color: tab === key ? "var(--orange,#f97316)" : "var(--ink-3,#64748b)" }}>
            <span style={{ fontSize: "1.35rem" }}>{icon}</span>{label}
          </button>
        ))}
        <button onClick={() => router.push("/worker/bins")}
          style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: "0.2rem", padding: "0.5rem 0", background: "none", border: "none", cursor: "pointer", fontSize: "0.65rem", fontWeight: 600, color: "var(--ink-3,#64748b)" }}>
          <span style={{ fontSize: "1.35rem" }}>🧺</span>Bins
        </button>
      </div>

      {/* OTP Verification Modal */}
      {otpModal && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}
          onClick={() => !otpSubmitting && (setOtpModal(null), setOtpInput(""))}
        >
          <div
            style={{ background: "#fff", borderRadius: 16, padding: "1.5rem", width: "90%", maxWidth: 320, boxShadow: "0 10px 40px rgba(0,0,0,0.2)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: "0.9rem", fontWeight: 700, color: "var(--ink-3)", marginBottom: "0.5rem", textTransform: "uppercase" }}>
              Order ID: {otpModal.slice(-8).toUpperCase()}
            </div>
            <h3 style={{ margin: "0.5rem 0 1rem", fontSize: "1.1rem", fontWeight: 800 }}>Enter OTP</h3>
            <input
              type="text"
              inputMode="numeric"
              maxLength={4}
              value={otpInput}
              onChange={(e) => setOtpInput(e.target.value.replace(/\D/g, ""))}
              placeholder="0000"
              autoFocus
              disabled={otpSubmitting}
              style={{ display: "block", width: "100%", padding: "0.8rem", fontSize: "1.8rem", letterSpacing: "0.3rem", textAlign: "center", border: "2px solid var(--border)", borderRadius: 12, marginBottom: "1rem", fontWeight: 700, boxSizing: "border-box" }}
            />
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button
                onClick={() => !otpSubmitting && (setOtpModal(null), setOtpInput(""))}
                disabled={otpSubmitting}
                style={{ flex: 1, padding: "0.7rem", border: "1.5px solid #e5e7eb", background: "#f3f4f6", borderRadius: 10, fontWeight: 700, cursor: otpSubmitting ? "not-allowed" : "pointer", opacity: otpSubmitting ? 0.5 : 1 }}
              >
                Cancel
              </button>
              <button
                onClick={() => verifyOtp(otpModal)}
                disabled={otpInput.length < 4 || otpSubmitting}
                style={{ flex: 1, padding: "0.7rem", background: otpInput.length < 4 ? "#e5e7eb" : "#16a34a", color: otpInput.length < 4 ? "var(--ink-3)" : "#fff", border: "none", borderRadius: 10, fontWeight: 700, cursor: otpInput.length < 4 ? "not-allowed" : "pointer" }}
              >
                {otpSubmitting ? "Verifying..." : "Verify"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

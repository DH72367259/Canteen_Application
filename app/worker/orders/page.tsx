"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

interface WorkerOrder {
  id: string;
  /** Raw lifecycle status (placed | confirmed | preparing | ready_for_placement | placed_in_bin | ready_for_pickup | collected | cancelled). */
  status: string;
  /** First-bin label e.g. "#BLU002" — actual physical bin code. */
  bin_label?: string | null;
  bin_color?: string | null;
  pickup_slot?: string | null;
  customer_name?: string | null;
  items: { name: string; quantity: number }[];
  /** Per-bin breakdown for multi-bin orders (Phase 7). */
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

function aggregateBySlot(orders: WorkerOrder[]): SlotAggregate[] {
  const bySlot = new Map<string, SlotAggregate>();

  for (const order of orders) {
    const slot = order.pickup_slot ?? "Unknown";
    const found = bySlot.get(slot) ?? {
      slot,
      itemTotals: [],
      binPlans: [],
    };

    const itemMap = new Map<string, number>(found.itemTotals.map((it) => [it.name, it.quantity]));
    for (const item of order.items) {
      itemMap.set(item.name, (itemMap.get(item.name) ?? 0) + item.quantity);
    }
    found.itemTotals = Array.from(itemMap.entries())
      .map(([name, quantity]) => ({ name, quantity }))
      .sort((a, b) => b.quantity - a.quantity);

    const assignments = order.bin_assignments && order.bin_assignments.length > 0
      ? order.bin_assignments.map((a) => ({
          binLabel: a.binLabel,
          binColor: a.binColor,
          items: a.items.map((it) => ({ name: it.name, quantity: it.quantity })),
        }))
      : [{
          binLabel: order.bin_label ?? "Unassigned",
          binColor: order.bin_color ?? "orange",
          items: order.items,
        }];

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
    .map((slot) => ({
      ...slot,
      binPlans: slot.binPlans.sort((a, b) => a.binLabel.localeCompare(b.binLabel)),
    }))
    .sort((a, b) => a.slot.localeCompare(b.slot));
}

export default function WorkerOrdersPage() {
  const router = useRouter();
  const { user, session, loading, logout } = useAuth();
  const [orders, setOrders]         = useState<WorkerOrder[]>([]);
  const [fetching, setFetching]     = useState(true);
  const [updating, setUpdating]     = useState<string | null>(null);
  const [activeSlot, setActiveSlot] = useState<string | null>(null);
  const [tab, setTab]               = useState<"orders" | "prep">("orders");

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
          // /api/orders returns CanteenOrder objects (camelCase, mapped status).
          // We need the RAW status for transition buttons, plus the actual bin
          // label/colour, slot label, and per-bin assignments. Without this
          // mapping the worker sees the order but gets no action button (the
          // mapped status `received` matched none of our cases) and no bin
          // header (bin_number was always undefined).
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
          if (mapped.length > 0) {
            setActiveSlot(mapped[0].pickup_slot ?? null);
          }
          setFetching(false);
        }
      } catch { if (!aborted) setFetching(false); }
    }

    fetchOrders();
    const interval = setInterval(fetchOrders, 5000); // refresh every 5s
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
      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status } : o));
    } finally { setUpdating(null); }
  }

  const slots = [...new Set(orders.map(o => o.pickup_slot).filter(Boolean))];
  const slotOrders = activeSlot ? orders.filter(o => o.pickup_slot === activeSlot) : orders;
  const slotSummary = aggregateBySlot(slotOrders);
  const selectedSummary = activeSlot
    ? slotSummary.find((s) => s.slot === activeSlot) ?? null
    : slotSummary[0] ?? null;

  if (loading || fetching) return <div className="page-loading"><div className="spinner" /></div>;

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      {/* Top bar */}
      <div style={{ background: "#1e293b", color: "#fff", padding: "0.75rem 1rem", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontWeight: 700, fontSize: "1rem" }}>Canteen-Application · Orders</div>
        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", fontSize: "0.82rem" }}>
          <span style={{ color: "#94a3b8" }}>{new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>
          <button onClick={() => logout().then(() => router.push("/login"))} style={{ background: "none", border: "1px solid #475569", color: "#94a3b8", borderRadius: 8, padding: "0.35rem 0.65rem", cursor: "pointer", fontSize: "0.78rem" }}>Logout</button>
        </div>
      </div>

      {/* Slot filter */}
      {slots.length > 0 && (
        <div style={{ display: "flex", gap: "0.5rem", padding: "0.75rem 1rem", overflowX: "auto", background: "#fff", borderBottom: "1px solid var(--border)" }}>
          <button onClick={() => setActiveSlot(null)} style={{ padding: "0.4rem 0.85rem", borderRadius: 20, border: "none", background: !activeSlot ? "var(--orange)" : "#f3f4f6", color: !activeSlot ? "#fff" : "var(--ink-3)", fontWeight: 600, fontSize: "0.8rem", cursor: "pointer", flexShrink: 0 }}>
            All ({orders.length})
          </button>
          {slots.map(slot => (
            <button key={slot} onClick={() => setActiveSlot(slot!)} style={{ padding: "0.4rem 0.85rem", borderRadius: 20, border: "none", background: activeSlot === slot ? "var(--orange)" : "#f3f4f6", color: activeSlot === slot ? "#fff" : "var(--ink-3)", fontWeight: 600, fontSize: "0.8rem", cursor: "pointer", flexShrink: 0 }}>
              {slot} ({orders.filter(o => o.pickup_slot === slot).length})
            </button>
          ))}
        </div>
      )}

      {/* Orders list */}
      <div style={{ padding: "1rem", paddingBottom: "5rem" }}>
        {tab === "orders" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
            {slotOrders.length === 0 && <div style={{ textAlign: "center", color: "var(--ink-3)", padding: "3rem 0", fontSize: "0.9rem" }}>No orders for this slot.</div>}
            {slotOrders.map(order => {
              const assignments = order.bin_assignments && order.bin_assignments.length > 0
                ? order.bin_assignments
                : [{
                    binIndex: 1,
                    binLabel: order.bin_label ?? "Unassigned",
                    binColor: order.bin_color ?? "orange",
                    items: order.items,
                  }];

              return (
                <div key={order.id} style={{ background: "#fff", borderRadius: 16, boxShadow: "0 3px 10px rgba(0,0,0,0.09)", border: "1px solid #e2e8f0", overflow: "hidden" }}>
                  <div style={{ padding: "0.75rem 0.85rem", borderBottom: "1px solid #e2e8f0", background: "#f8fafc" }}>
                    <div style={{ fontWeight: 800, color: "#0f172a", fontSize: "0.95rem" }}>Student: {order.customer_name || "Unknown"}</div>
                    <div style={{ fontSize: "0.78rem", color: "#64748b", marginTop: 2 }}>Order #{order.id.slice(-6).toUpperCase()} · Slot {order.pickup_slot ?? "—"}</div>
                  </div>

                  <div style={{ padding: "0.75rem", display: "grid", gap: "0.65rem" }}>
                    {assignments.map((a) => {
                      const binColor = BIN_COLORS[a.binColor] ?? "#f97316";
                      return (
                        <div key={`${order.id}-${a.binIndex}-${a.binLabel}`} style={{ border: `2px solid ${binColor}`, borderRadius: 14, background: tint(binColor, "18"), overflow: "hidden" }}>
                          <div style={{ background: binColor, color: "#fff", padding: "0.45rem 0.7rem", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.6rem" }}>
                            <span style={{ fontWeight: 900, fontSize: "1.02rem" }}>Bin {a.binLabel}</span>
                            <span style={{ fontSize: "0.72rem", opacity: 0.92 }}>Order {order.id.slice(-6).toUpperCase()}</span>
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
                    {order.status === "placed" && (
                      <button disabled={updating === order.id} onClick={() => updateStatus(order.id, "preparing")} style={{ background: "#3b82f6", color: "#fff", border: "none", borderRadius: 10, padding: "0.7rem", fontWeight: 700, fontSize: "0.9rem", cursor: "pointer" }}>
                        {updating === order.id ? "..." : "Accept Order -> Start Preparing"}
                      </button>
                    )}
                    {order.status === "confirmed" && (
                      <button disabled={updating === order.id} onClick={() => updateStatus(order.id, "preparing")} style={{ background: "#ef4444", color: "#fff", border: "none", borderRadius: 10, padding: "0.7rem", fontWeight: 700, fontSize: "0.9rem", cursor: "pointer" }}>
                        {updating === order.id ? "..." : "Start Preparing"}
                      </button>
                    )}
                    {order.status === "preparing" && (
                      <button disabled={updating === order.id} onClick={() => updateStatus(order.id, "ready_for_placement")} style={{ background: "#eab308", color: "#fff", border: "none", borderRadius: 10, padding: "0.7rem", fontWeight: 700, fontSize: "0.9rem", cursor: "pointer" }}>
                        {updating === order.id ? "..." : "Mark Preparing -> Ready to Place"}
                      </button>
                    )}
                    {order.status === "ready_for_placement" && (
                      <button disabled={updating === order.id} onClick={() => updateStatus(order.id, "placed_in_bin")} style={{ background: "#22c55e", color: "#fff", border: "none", borderRadius: 10, padding: "0.7rem", fontWeight: 900, fontSize: "0.95rem", cursor: "pointer" }}>
                        {updating === order.id ? "..." : "Placed in Bin (double verify)"}
                      </button>
                    )}
                    {["placed_in_bin", "ready_for_pickup"].includes(order.status) && (
                      <div style={{ background: "#dcfce7", borderRadius: 10, padding: "0.5rem 0.75rem", fontSize: "0.82rem", color: "#166534", fontWeight: 700, textAlign: "center" }}>
                        In bin and ready for pickup (manager verifies OTP)
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {tab === "prep" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
            {!selectedSummary && (
              <div style={{ textAlign: "center", color: "var(--ink-3)", padding: "3rem 0", fontSize: "0.9rem" }}>
                No active orders for prep planning.
              </div>
            )}
            {selectedSummary && (
              <>
                <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, boxShadow: "0 2px 8px rgba(0,0,0,0.06)", overflow: "hidden" }}>
                  <div style={{ background: "#0f172a", color: "#fff", padding: "0.7rem 0.9rem" }}>
                    <div style={{ fontWeight: 800, fontSize: "0.9rem" }}>Slot Prep Totals · {selectedSummary.slot}</div>
                    <div style={{ fontSize: "0.76rem", opacity: 0.85 }}>Holistic quantity view (example: chapati 10, rice 5)</div>
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

                <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 14, boxShadow: "0 2px 8px rgba(0,0,0,0.06)", overflow: "hidden" }}>
                  <div style={{ background: "#f8fafc", padding: "0.7rem 0.9rem", borderBottom: "1px solid #e2e8f0" }}>
                    <div style={{ fontWeight: 800, fontSize: "0.9rem", color: "#0f172a" }}>Bin Placement Plan</div>
                    <div style={{ fontSize: "0.76rem", color: "#64748b" }}>Which items go into which bins for this slot</div>
                  </div>
                  <div style={{ padding: "0.75rem" }}>
                    {selectedSummary.binPlans.length === 0 && <div style={{ color: "#64748b", fontSize: "0.84rem" }}>No bin assignments available.</div>}
                    {selectedSummary.binPlans.map((bp, idx) => {
                      const c = BIN_COLORS[bp.binColor] ?? "#f97316";
                      return (
                        <div key={`${bp.orderId}-${bp.binLabel}-${idx}`} style={{ border: `1.5px solid ${c}`, borderRadius: 12, marginBottom: "0.55rem", overflow: "hidden" }}>
                          <div style={{ background: tint(c, "20"), padding: "0.45rem 0.65rem", display: "flex", justifyContent: "space-between", gap: "0.5rem", fontSize: "0.78rem" }}>
                            <strong style={{ color: c }}>Bin {bp.binLabel}</strong>
                            <span style={{ color: "#334155" }}>Order #{bp.orderId.slice(-6).toUpperCase()} · {bp.studentName}</span>
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

      {/* Bottom nav */}
      <div className="bottom-nav">
        <button className={`nav-item ${tab === "orders" ? "active" : ""}`} onClick={() => setTab("orders")}>📦<span>Orders</span></button>
        <button className={`nav-item ${tab === "prep" ? "active" : ""}`} onClick={() => setTab("prep")}>📊<span>Prep Plan</span></button>
        <button className="nav-item" onClick={() => router.push("/worker/bins")}>🧺<span>Bins</span></button>
      </div>
    </div>
  );
}

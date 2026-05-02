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

const BIN_COLORS: Record<string, string> = {
  red: "#ef4444", blue: "#3b82f6", green: "#22c55e",
  yellow: "#eab308", purple: "#a855f7", orange: "#f97316",
};

export default function WorkerOrdersPage() {
  const router = useRouter();
  const { user, session, loading, logout } = useAuth();
  const [orders, setOrders]         = useState<WorkerOrder[]>([]);
  const [fetching, setFetching]     = useState(true);
  const [updating, setUpdating]     = useState<string | null>(null);
  const [activeSlot, setActiveSlot] = useState<string | null>(null);

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
              return !["collected", "completed", "cancelled"].includes(raw);
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
      <div style={{ padding: "1rem", display: "flex", flexDirection: "column", gap: "0.75rem", paddingBottom: "5rem" }}>
        {slotOrders.length === 0 && <div style={{ textAlign: "center", color: "var(--ink-3)", padding: "3rem 0", fontSize: "0.9rem" }}>No orders for this slot.</div>}
        {slotOrders.map(order => {
          const binColor = BIN_COLORS[order.bin_color ?? "orange"] ?? "#f97316";
          const assignments = order.bin_assignments ?? [];
          const multiBin = assignments.length > 1;
          return (
            <div key={order.id} style={{ background: "#fff", borderRadius: 14, boxShadow: "0 1px 4px rgba(0,0,0,0.08)", overflow: "hidden" }}>
              {/* Bin header — show actual bin code (e.g. #BLU002) instead of a
                  numeric placeholder. For multi-bin orders we show "+N more". */}
              {order.bin_label && (
                <div style={{ background: binColor, padding: "0.5rem 0.75rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span style={{ color: "#fff", fontWeight: 900, fontSize: "1.25rem" }}>{order.bin_label}{multiBin ? ` +${assignments.length - 1}` : ""}</span>
                  <span style={{ color: "rgba(255,255,255,0.85)", fontSize: "0.78rem" }}>#{order.id.slice(-6).toUpperCase()} · {order.pickup_slot}</span>
                </div>
              )}
              <div style={{ padding: "0.75rem" }}>
                <div style={{ fontSize: "0.78rem", color: "var(--ink-3)", fontWeight: 700, marginBottom: "0.35rem" }}>
                  Student: {order.customer_name || "Unknown"} · Dishes: {order.items.reduce((sum, i) => sum + i.quantity, 0)}
                </div>
                {/* Items — for multi-bin orders show the per-bin breakdown so
                    the worker knows what to put in each physical bin. */}
                {multiBin ? (
                  assignments.map((a) => (
                    <div key={a.binIndex} style={{ borderTop: a.binIndex > 1 ? "1px dashed var(--border)" : "none", padding: "0.4rem 0" }}>
                      <div style={{ fontSize: "0.75rem", fontWeight: 700, color: BIN_COLORS[a.binColor] ?? "#475569", marginBottom: 4 }}>
                        {a.binLabel}
                      </div>
                      {a.items.map((it, i) => (
                        <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.92rem", fontWeight: 600, padding: "0.15rem 0" }}>
                          <span>{it.name}</span>
                          <span style={{ color: "var(--orange)" }}>×{it.quantity}</span>
                        </div>
                      ))}
                    </div>
                  ))
                ) : (
                  order.items.map((item, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: "1rem", fontWeight: 700, padding: "0.2rem 0", borderBottom: i < order.items.length - 1 ? "1px solid var(--border)" : "none" }}>
                      <span>{item.name}</span>
                      <span style={{ color: "var(--orange)" }}>×{item.quantity}</span>
                    </div>
                  ))
                )}

                {/* Status actions */}
                <div style={{ marginTop: "0.75rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  {order.status === "placed" && (
                    <button disabled={updating === order.id} onClick={() => updateStatus(order.id, "preparing")} style={{ background: "#3b82f6", color: "#fff", border: "none", borderRadius: 10, padding: "0.7rem", fontWeight: 700, fontSize: "0.9rem", cursor: "pointer" }}>
                      {updating === order.id ? "..." : "Accept Order → Start Preparing"}
                    </button>
                  )}
                  {order.status === "confirmed" && (
                    <button disabled={updating === order.id} onClick={() => updateStatus(order.id, "preparing")} style={{ background: "#ef4444", color: "#fff", border: "none", borderRadius: 10, padding: "0.7rem", fontWeight: 700, fontSize: "0.9rem", cursor: "pointer" }}>
                      {updating === order.id ? "..." : "To Prepare → Next order"}
                    </button>
                  )}
                  {order.status === "preparing" && (
                    <button disabled={updating === order.id} onClick={() => updateStatus(order.id, "ready_for_placement")} style={{ background: "#eab308", color: "#fff", border: "none", borderRadius: 10, padding: "0.7rem", fontWeight: 700, fontSize: "0.9rem", cursor: "pointer" }}>
                      {updating === order.id ? "..." : "Mark Preparing → Ready to Place"}
                    </button>
                  )}
                  {order.status === "ready_for_placement" && (
                    <button disabled={updating === order.id} onClick={() => updateStatus(order.id, "placed_in_bin")} style={{ background: "#22c55e", color: "#fff", border: "none", borderRadius: 10, padding: "0.7rem", fontWeight: 900, fontSize: "0.95rem", cursor: "pointer" }}>
                      {updating === order.id ? "..." : `✅ Placed (double verify) → ${order.bin_label ?? "bin"}`}
                    </button>
                  )}
                  {["placed_in_bin", "ready_for_pickup"].includes(order.status) && (
                    <div style={{ background: "var(--green-light)", borderRadius: 10, padding: "0.5rem 0.75rem", fontSize: "0.82rem", color: "var(--green)", fontWeight: 600, textAlign: "center" }}>
                      ✅ In Bin — ready for pickup (manager verifies OTP)
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Bottom nav */}
      <div className="bottom-nav">
        <button className="nav-item active">📦<span>Orders</span></button>
        <button className="nav-item" onClick={() => router.push("/worker/bins")}>🧺<span>Bins</span></button>
      </div>
    </div>
  );
}

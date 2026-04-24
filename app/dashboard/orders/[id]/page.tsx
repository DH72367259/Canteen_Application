"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

type OrderStatus =
  | "placed" | "confirmed" | "preparing" | "ready_for_placement"
  | "placed_in_bin" | "ready_for_pickup" | "collected" | "cancelled";

interface OrderDetail {
  id: string;
  status: OrderStatus;
  total_amount: number;
  otp?: string;
  bin_number?: number;
  bin_color?: string;
  pickup_slot?: string;
  items: { name: string; quantity: number; unit_price: number }[];
  created_at: string;
}

const STATUS_STEPS: { key: OrderStatus; label: string; emoji: string }[] = [
  { key: "placed",              label: "Order Placed",        emoji: "📋" },
  { key: "confirmed",           label: "Accepted by Canteen", emoji: "✅" },
  { key: "preparing",           label: "Preparing",           emoji: "👨‍🍳" },
  { key: "ready_for_placement", label: "Ready for Bin",       emoji: "📦" },
  { key: "placed_in_bin",       label: "Placed in Bin",       emoji: "🗃️" },
  { key: "ready_for_pickup",    label: "Ready for Pickup",    emoji: "🔔" },
  { key: "collected",           label: "Collected",           emoji: "🎉" },
];

function statusIndex(s: OrderStatus) { return STATUS_STEPS.findIndex(step => step.key === s); }

const BIN_COLORS: Record<string, string> = {
  red: "#ef4444", blue: "#3b82f6", green: "#22c55e",
  yellow: "#eab308", purple: "#a855f7", orange: "#f97316",
};

export default function OrderTrackingPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const { user, session, loading } = useAuth();
  const [order, setOrder]       = useState<OrderDetail | null>(null);
  const [fetching, setFetching] = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [showOtp, setShowOtp]   = useState(false);

  useEffect(() => {
    if (!loading && !user) router.push("/login");
  }, [user, loading, router]);

  useEffect(() => {
    if (!id || !session) return;
    let aborted = false;

    async function fetchOrder() {
      try {
        const res = await fetch(`/api/orders/${id}`, {
          headers: { Authorization: `Bearer ${session!.access_token}` },
        });
        if (!res.ok) throw new Error("Order not found.");
        const data = await res.json();
        if (!aborted) { setOrder(data.order ?? data); setFetching(false); }
      } catch (e: unknown) {
        if (!aborted) { setError(e instanceof Error ? e.message : "Failed to load order."); setFetching(false); }
      }
    }

    fetchOrder();
    const interval = setInterval(fetchOrder, 8000);
    return () => { aborted = true; clearInterval(interval); };
  }, [id, session]);

  if (loading || fetching) return <div className="page-loading"><div className="spinner" /></div>;
  if (error) return (
    <div className="app-shell" style={{ padding: "2rem 1rem", textAlign: "center" }}>
      <p style={{ color: "var(--red)", marginBottom: "1rem" }}>{error}</p>
      <button className="btn btn-outline" onClick={() => router.back()}>← Back</button>
    </div>
  );
  if (!order) return null;

  const currentIndex = statusIndex(order.status);
  const isCancelled  = order.status === "cancelled";
  const isCollected  = order.status === "collected";
  const showBin      = ["placed_in_bin", "ready_for_pickup", "collected"].includes(order.status);
  const binColor     = BIN_COLORS[order.bin_color ?? "orange"] ?? "#f97316";

  return (
    <div className="app-shell">
      <div className="app-topbar">
        <button onClick={() => router.back()} style={{ background: "none", border: "none", fontSize: "1.2rem", cursor: "pointer", padding: "0.25rem" }}>←</button>
        <span style={{ fontWeight: 700, fontSize: "1rem" }}>Track Order</span>
        <span style={{ fontSize: "0.75rem", color: "var(--ink-3)" }}>#{order.id.slice(-6).toUpperCase()}</span>
      </div>

      <div style={{ padding: "1rem", display: "flex", flexDirection: "column", gap: "1rem", paddingBottom: "5rem" }}>

        {isCancelled && (
          <div style={{ background: "var(--red-light)", border: "1px solid var(--red)", borderRadius: 12, padding: "1rem", textAlign: "center" }}>
            <div style={{ fontSize: "2rem" }}>❌</div>
            <div style={{ fontWeight: 700, color: "var(--red)" }}>Order Cancelled</div>
            <div style={{ fontSize: "0.82rem", color: "var(--ink-3)", marginTop: "0.25rem" }}>Refund will be processed within 5–7 business days.</div>
          </div>
        )}

        {isCollected && (
          <div style={{ background: "var(--green-light)", border: "1px solid var(--green)", borderRadius: 12, padding: "1rem", textAlign: "center" }}>
            <div style={{ fontSize: "2.5rem" }}>🎉</div>
            <div style={{ fontWeight: 700, color: "var(--green)", fontSize: "1.1rem" }}>Enjoy your meal!</div>
          </div>
        )}

        {showBin && order.bin_number && (
          <div style={{ background: binColor, borderRadius: 16, padding: "1.25rem", textAlign: "center", color: "#fff" }}>
            <div style={{ fontSize: "0.85rem", fontWeight: 600, opacity: 0.9 }}>Your Bin</div>
            <div style={{ fontSize: "3.5rem", fontWeight: 900, lineHeight: 1 }}>{order.bin_number}</div>
            <div style={{ fontSize: "0.82rem", opacity: 0.9, marginTop: "0.25rem" }}>Collect from Bin {order.bin_number} at the pickup area</div>
            {order.otp && !isCollected && (
              <div style={{ marginTop: "0.75rem" }}>
                {showOtp ? (
                  <div style={{ background: "rgba(255,255,255,0.25)", borderRadius: 12, padding: "0.75rem" }}>
                    <div style={{ fontSize: "0.72rem", opacity: 0.85, marginBottom: "0.25rem" }}>Show this OTP to canteen staff</div>
                    <div style={{ fontSize: "2rem", fontWeight: 900, letterSpacing: "0.4rem" }}>{order.otp}</div>
                  </div>
                ) : (
                  <button onClick={() => setShowOtp(true)} style={{ background: "rgba(255,255,255,0.2)", border: "2px solid rgba(255,255,255,0.6)", borderRadius: 10, padding: "0.6rem 1.25rem", color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: "0.9rem" }}>
                    🔐 Show OTP
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {!isCancelled && (
          <div style={{ background: "#fff", borderRadius: 16, padding: "1.25rem", boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
            <h3 style={{ fontSize: "0.95rem", marginBottom: "1rem" }}>Live Status</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {STATUS_STEPS.map((step, i) => {
                const done    = i <= currentIndex;
                const current = i === currentIndex;
                return (
                  <div key={step.key} style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                    <div style={{ width: 36, height: 36, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", background: done ? "var(--orange)" : "#f3f4f6", color: done ? "#fff" : "var(--ink-3)", fontSize: "1rem", flexShrink: 0, boxShadow: current ? "0 0 0 3px rgba(249,115,22,0.3)" : "none" }}>
                      {step.emoji}
                    </div>
                    <div>
                      <div style={{ fontWeight: current ? 700 : 500, fontSize: "0.88rem", color: done ? "var(--ink)" : "var(--ink-3)" }}>{step.label}</div>
                      {current && <div style={{ fontSize: "0.72rem", color: "var(--orange)", fontWeight: 600 }}>← Current status</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div style={{ background: "#fff", borderRadius: 16, padding: "1.25rem", boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
          <h3 style={{ fontSize: "0.95rem", marginBottom: "0.75rem" }}>Order Summary</h3>
          {order.pickup_slot && <div style={{ fontSize: "0.82rem", color: "var(--ink-3)", marginBottom: "0.75rem" }}>⏰ Pickup slot: <strong>{order.pickup_slot}</strong></div>}
          {order.items.map((item, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.88rem", padding: "0.35rem 0", borderBottom: i < order.items.length - 1 ? "1px solid var(--border)" : "none" }}>
              <span>{item.name} <span style={{ color: "var(--ink-3)" }}>×{item.quantity}</span></span>
              <span style={{ fontWeight: 600 }}>₹{item.unit_price * item.quantity}</span>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, marginTop: "0.75rem", paddingTop: "0.75rem", borderTop: "1px solid var(--border)" }}>
            <span>Total</span><span>₹{order.total_amount}</span>
          </div>
        </div>
      </div>

      <div className="bottom-nav">
        <button className="nav-item" onClick={() => router.push("/dashboard")}>🏠<span>Home</span></button>
        <button className="nav-item active">📦<span>Orders</span></button>
        <button className="nav-item" onClick={() => router.push("/dashboard/rewards")}>💰<span>Rewards</span></button>
        <button className="nav-item" onClick={() => router.push("/dashboard/profile")}>👤<span>Profile</span></button>
      </div>
    </div>
  );
}




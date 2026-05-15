"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import dynamic from "next/dynamic";

const OrderQRCode = dynamic(() => import("@/components/OrderQRCode"), { ssr: false });

// ── Types ─────────────────────────────────────────────────────────────────────

interface OrderItem { name: string; qty?: number; quantity?: number; unitPrice?: number; }
interface BinAssignment { binIndex: number; binLabel: string; binColor: string; items: { name: string; quantity: number }[]; }

interface Order {
  id: string;
  rawStatus?: string;
  status?: string;
  otp?: string;
  binLabel?: string;
  binColor?: string;
  slotLabel?: string;
  pickupSlot?: string;
  items?: OrderItem[];
  binAssignments?: BinAssignment[];
  canteenName?: string;
  createdAt?: string;
  total?: number;
  binCount?: number;
}

// ── Status progression ─────────────────────────────────────────────────────────

const STATUS_ORDER = [
  "placed",
  "confirmed",
  "preparing",
  "ready_for_placement",
  "placed_in_bin",
  "ready_for_pickup",
  "late_pickup",
  "collected",
] as const;

const STEP_DEFS = [
  { label: "Order Placed",       icon: "✅", statuses: ["placed"] as string[] },
  { label: "Confirmed by Canteen", icon: "👨‍🍳", statuses: ["confirmed"] as string[] },
  { label: "Being Prepared",     icon: "🍳", statuses: ["preparing", "ready_for_placement"] as string[] },
  { label: "Placed in Your Bin", icon: "📦", statuses: ["placed_in_bin", "ready_for_pickup", "late_pickup"] as string[] },
  { label: "Collected",          icon: "🎉", statuses: ["collected"] as string[] },
];

function statusRank(s: string): number {
  const i = STATUS_ORDER.indexOf(s as typeof STATUS_ORDER[number]);
  return i === -1 ? 0 : i;
}

function getStepState(step: typeof STEP_DEFS[number], currentStatus: string): "done" | "active" | "pending" {
  const rank = statusRank(currentStatus);
  const stepRank = Math.min(...step.statuses.map(statusRank));
  if (rank >= stepRank + 1) return "done"; // fully past this step
  if (step.statuses.includes(currentStatus)) return "active";
  // If rank >= stepRank it's active; if step is the first "done" check again
  if (rank >= stepRank) return "active";
  return "pending";
}

const BIN_COLOR_MAP: Record<string, string> = {
  red: "#ef4444", blue: "#3b82f6", green: "#22c55e",
  yellow: "#eab308", purple: "#a855f7", orange: "#f97316",
};
function binHex(color?: string) { return BIN_COLOR_MAP[color?.toLowerCase() ?? ""] ?? "#f97316"; }

// ── Inner component (uses useSearchParams) ─────────────────────────────────────

function OrderStatusContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { session } = useAuth();

  const orderId = searchParams.get("id");
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchOrder = async (token: string, id: string) => {
    try {
      // Use the list API — student gets their own orders, all fields mapped
      const res = await fetch("/api/orders", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) { setError("Could not load order."); return; }
      const data = await res.json() as { orders?: Order[] };
      const found = (data.orders ?? []).find((o) => o.id === id);
      if (found) {
        setOrder(found);
        setError(null);
      } else {
        setError("Order not found.");
      }
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!orderId) { router.replace("/dashboard"); return; }
    if (!session?.access_token) return;

    fetchOrder(session.access_token, orderId);
    pollRef.current = setInterval(() => fetchOrder(session.access_token, orderId), 10_000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, session?.access_token]);

  // After collected → wait 5s then go home
  const currentStatus = order?.rawStatus ?? order?.status ?? "placed";
  useEffect(() => {
    if (currentStatus === "collected" || currentStatus === "cancelled") {
      const t = setTimeout(() => router.replace("/dashboard"), 5_000);
      return () => clearTimeout(t);
    }
  }, [currentStatus, router]);

  if (loading) return <div className="loading-screen"><div className="spinner" /></div>;
  if (error || !order) {
    return (
      <div style={{ padding: "2rem", textAlign: "center" }}>
        <div style={{ fontSize: "2rem", marginBottom: "1rem" }}>😕</div>
        <div style={{ fontWeight: 700, marginBottom: "0.5rem" }}>Order not found</div>
        <div style={{ color: "var(--ink-3)", fontSize: "0.85rem", marginBottom: "1.5rem" }}>{error}</div>
        <Link href="/dashboard" style={{ color: "var(--orange)", fontWeight: 700, textDecoration: "none" }}>← Back to Home</Link>
      </div>
    );
  }

  const rank = statusRank(currentStatus);
  const isLatePickup = currentStatus === "late_pickup";
  const showOtp   = ["placed_in_bin", "ready_for_pickup", "late_pickup"].includes(currentStatus);
  const showBin   = rank >= statusRank("placed_in_bin");
  const isCollected = currentStatus === "collected";

  const slot  = order.slotLabel ?? order.pickupSlot ?? "";
  const items = order.items ?? [];
  const binColor = binHex(order.binColor);

  // ── Collected screen ──
  if (isCollected) {
    return (
      <div className="app-shell" style={{ alignItems: "center", justifyContent: "center", textAlign: "center", background: "linear-gradient(160deg, #f0fdf4, #dcfce7)", minHeight: "100dvh" }}>
        <div style={{ fontSize: "4rem", marginBottom: "1rem" }}>✅</div>
        <h2 style={{ fontWeight: 900, fontSize: "1.4rem", color: "#15803d", marginBottom: "0.5rem" }}>Enjoy your meal!</h2>
        <p style={{ color: "#166534", fontSize: "0.9rem" }}>Returning to home in a few seconds…</p>
      </div>
    );
  }

  return (
    <div className="app-shell" style={{ flexDirection: "column", minHeight: "100dvh", background: "#f8fafc" }}>
      {/* Top bar */}
      <div style={{ position: "sticky", top: 0, zIndex: 40, background: "#fff", borderBottom: "1px solid var(--border)", padding: "0.75rem 1rem", display: "flex", alignItems: "center", gap: "0.75rem" }}>
        <Link href="/dashboard" style={{ color: "var(--ink-3)", textDecoration: "none", fontSize: "1.1rem", lineHeight: 1 }}>←</Link>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: "0.7rem", color: "var(--ink-3)", fontWeight: 500 }}>Order #{order.id.slice(-8).toUpperCase()}</div>
          <div style={{ fontSize: "0.95rem", fontWeight: 800 }}>{order.canteenName ?? "Tracking your order"}</div>
        </div>
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#22c55e", animation: "pulse 1.5s infinite" }} />
      </div>

      <div style={{ padding: "1rem", display: "flex", flexDirection: "column", gap: "1rem", paddingBottom: "5rem" }}>

        {/* ── Status tracker ── */}
        <div style={{ background: "#fff", borderRadius: 16, padding: "1.25rem 1rem", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
          <div style={{ fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", color: "var(--ink-3)", marginBottom: "1.25rem", letterSpacing: "0.04em" }}>
            Order Status
          </div>
          <div style={{ position: "relative" }}>
            <div style={{ position: "absolute", left: 13, top: 14, bottom: 14, width: 2, background: "var(--border)", zIndex: 0 }} />
            {STEP_DEFS.map((step, i) => {
              const state = getStepState(step, currentStatus);
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: "0.85rem", padding: "0.6rem 0", position: "relative", zIndex: 1 }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
                    background: state === "done" ? "#22c55e" : state === "active" ? "var(--orange)" : "#e5e7eb",
                    border: state === "active" ? "2.5px solid var(--orange)" : "none",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: state === "done" ? "0.9rem" : "0.8rem",
                    color: state === "pending" ? "#9ca3af" : "#fff",
                    transition: "background 0.4s",
                  }}>
                    {state === "done" ? "✓" : state === "active" ? step.icon : "○"}
                  </div>
                  <div>
                    <div style={{ fontSize: "0.9rem", fontWeight: state === "active" ? 800 : state === "done" ? 600 : 500, color: state === "pending" ? "var(--ink-3)" : "var(--ink)", transition: "all 0.3s" }}>
                      {step.label}
                    </div>
                    {state === "active" && (
                      <div style={{ fontSize: "0.72rem", color: "var(--orange)", fontWeight: 600 }}>In progress…</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Slot & canteen info ── */}
        <div style={{ background: "#fff", borderRadius: 16, padding: "1rem", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
          <div style={{ fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", color: "var(--ink-3)", marginBottom: "0.6rem" }}>Pickup Details</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
            {slot && <div style={{ fontSize: "0.9rem", fontWeight: 700 }}>🕐 {slot}</div>}
            {order.canteenName && <div style={{ fontSize: "0.85rem", color: "var(--ink-3)" }}>📍 {order.canteenName}</div>}
            {order.total != null && <div style={{ fontSize: "0.85rem", color: "var(--ink-3)" }}>💰 ₹{order.total}</div>}
          </div>
        </div>

        {/* ── Late pickup banner ── */}
        {isLatePickup && (
          <div style={{ background: "#fffbeb", border: "1.5px solid #f59e0b", borderRadius: 14, padding: "0.85rem 1rem", display: "flex", gap: "0.6rem", alignItems: "flex-start" }}>
            <span style={{ fontSize: "1.3rem", lineHeight: 1 }}>⚠️</span>
            <div>
              <div style={{ fontWeight: 800, fontSize: "0.88rem", color: "#92400e" }}>Your slot ended — but your food is still here!</div>
              <div style={{ fontSize: "0.78rem", color: "#78350f", marginTop: "0.3rem", lineHeight: 1.5 }}>
                The canteen has moved your food to a separate area. Show the QR code below to the canteen staff to collect your order anytime today.
              </div>
            </div>
          </div>
        )}

        {/* ── QR + OTP section — only when bin is assigned and ready ── */}
        {showOtp && (
          <div style={{ background: "#fff", borderRadius: 16, padding: "1.25rem", boxShadow: "0 2px 8px rgba(0,0,0,0.06)", border: "2px solid var(--orange)" }}>
            <div style={{ textAlign: "center", marginBottom: "1rem" }}>
              <div style={{ fontWeight: 900, fontSize: "1.1rem", color: "#15803d" }}>
                {isLatePickup ? "🍱 Food is waiting for you!" : "🎉 Your order is ready!"}
              </div>
              <div style={{ fontSize: "0.78rem", color: "var(--ink-3)", marginTop: "0.2rem" }}>
                Show this QR code to the canteen staff
              </div>
            </div>

            {/* Primary: rotating QR code */}
            <OrderQRCode orderId={order.id} token={session?.access_token ?? ""} size={220} />

            {/* Divider */}
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", margin: "1rem 0 0.75rem" }}>
              <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
              <span style={{ fontSize: "0.72rem", color: "var(--ink-3)", whiteSpace: "nowrap" }}>or use backup OTP</span>
              <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
            </div>

            {/* Fallback: OTP digits */}
            {order.otp && (
              <div style={{ display: "flex", gap: "0.5rem", justifyContent: "center" }}>
                {order.otp.toString().padStart(4, "0").split("").map((d, i) => (
                  <div key={i} style={{ width: 48, height: 56, borderRadius: 12, border: "2px solid #e5e7eb", background: "#f8fafc", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.6rem", fontWeight: 900, color: "#64748b" }}>
                    {d}
                  </div>
                ))}
              </div>
            )}

            <div style={{ fontSize: "0.7rem", color: "var(--ink-3)", textAlign: "center", marginTop: "0.6rem" }}>
              QR refreshes automatically every 30 seconds
            </div>
          </div>
        )}

        {/* ── Bin indicator — when bin is assigned ── */}
        {showBin && order.binLabel && (
          <div style={{ background: "#fff", borderRadius: 16, padding: "1rem", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
            <div style={{ fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", color: "var(--ink-3)", marginBottom: "0.75rem" }}>Your Bin</div>
            <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
              <div style={{ width: 60, height: 60, borderRadius: 16, background: binColor, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: "1.4rem", boxShadow: `0 4px 16px ${binColor}55`, flexShrink: 0 }}>
                {order.binLabel}
              </div>
              <div>
                <div style={{ fontWeight: 800, fontSize: "0.95rem" }}>Bin {order.binLabel}</div>
                {order.binCount && order.binCount > 1 && <div style={{ fontSize: "0.78rem", color: "var(--ink-3)" }}>📦 {order.binCount} bins total</div>}
              </div>
            </div>
            {/* Multi-bin breakdown */}
            {order.binAssignments && order.binAssignments.length > 1 && (
              <div style={{ marginTop: "0.75rem", borderTop: "1px solid var(--border)", paddingTop: "0.75rem" }}>
                {order.binAssignments.map((b) => (
                  <div key={b.binIndex} style={{ marginBottom: "0.5rem" }}>
                    <div style={{ fontWeight: 700, fontSize: "0.82rem", color: binHex(b.binColor), marginBottom: "0.2rem" }}>Bin {b.binLabel}</div>
                    {b.items.map((it, j) => (
                      <div key={j} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", color: "var(--ink-3)", paddingLeft: "0.5rem" }}>
                        <span>{it.name}</span><span>×{it.quantity}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Items list ── */}
        {items.length > 0 && (
          <div style={{ background: "#fff", borderRadius: 16, padding: "1rem", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
            <div style={{ fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", color: "var(--ink-3)", marginBottom: "0.6rem" }}>What you ordered</div>
            {items.map((it, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.4rem 0", borderBottom: i < items.length - 1 ? "1px solid var(--border)" : "none", fontSize: "0.88rem" }}>
                <span style={{ fontWeight: 600 }}>{it.name}</span>
                <span style={{ color: "var(--ink-3)", fontWeight: 500 }}>×{it.qty ?? it.quantity ?? 1}</span>
              </div>
            ))}
          </div>
        )}

        {/* ── Info banner for early states ── */}
        {!showOtp && !isCollected && (
          <div style={{ background: "var(--blue-light)", border: "1px solid #bfdbfe", borderRadius: 12, padding: "0.75rem 1rem", fontSize: "0.8rem", color: "#1d4ed8" }}>
            🔔 This page refreshes every 10 seconds. QR code and bin number will appear here once your order is placed in the bin.
          </div>
        )}

      </div>

      {/* Bottom nav */}
      <nav className="bottom-nav">
        {[
          { icon: "🏠", label: "Home",      href: "/dashboard" },
          { icon: "📦", label: "My Orders", href: "/dashboard/orders" },
          { icon: "👤", label: "Profile",   href: "/dashboard/profile" },
        ].map(item => (
          <Link key={item.href} href={item.href} className="bottom-nav-item">
            <span className="nav-icon">{item.icon}</span>
            <span>{item.label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}

// ── Page export wraps in Suspense (required for useSearchParams in App Router) ──

export default function OrderStatusPage() {
  return (
    <Suspense fallback={<div className="loading-screen"><div className="spinner" /></div>}>
      <OrderStatusContent />
    </Suspense>
  );
}

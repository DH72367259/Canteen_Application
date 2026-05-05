"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { latestActiveOrder, readActiveOrders, removeActiveOrder, upsertActiveOrder, writeActiveOrders } from "@/lib/activeOrdersClient";

interface OrderData {
  id: string;
  bin: string;
  binCode?: string;
  otp: string;
  slot: string;
  items: string;
  itemsList?: { name: string; qty: number; price: number }[];
  canteen?: string;
  status: string;
  paymentId?: string;
  total?: number;
  // Phase 7: per-bin breakdown
  bins?: Array<{
    binIndex: number;
    binLabel: string;
    binCode: string;
    binColor: string;
    items: Array<{ name: string; quantity: number; isMeal?: boolean }>;
  }>;
  binCount?: number;
  extraBinFeePaise?: number;
}

type Phase = "preparing" | "ready" | "collected";

// Map raw API status → our UI phase
function toPhase(rawStatus: string): Phase {
  if (["collected", "completed"].includes(rawStatus)) return "collected";
  if (["ready_for_pickup", "placed_in_bin", "ready_for_placement"].includes(rawStatus)) return "ready";
  return "preparing";
}

const BIN_COLORS: Record<string, string> = {
  RED: "#ef4444", YEL: "#f59e0b", GRE: "#22c55e",
  BLU: "#3b82f6", PUR: "#a855f7", ORA: "#f97316",
};

function getBinColor(binCode?: string) {
  if (!binCode) return "#f97316";
  const prefix = binCode.replace("#", "").substring(0, 3).toUpperCase();
  return BIN_COLORS[prefix] || "#f97316";
}

export default function OrderStatusPage() {
  const router = useRouter();
  const { session } = useAuth();
  const [order, setOrder] = useState<OrderData | null>(null);
  const [activeOrders, setActiveOrders] = useState<OrderData[]>([]);
  const [phase, setPhase] = useState<Phase>("preparing");
  const [countdown, setCountdown] = useState(3);
  const [readyTime] = useState(() => {
    const d = new Date(Date.now() + 15 * 60 * 1000);
    return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
  });
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load active order from localStorage
  useEffect(() => {
    try {
      const all = readActiveOrders(session?.user?.id ?? null) as OrderData[];
      writeActiveOrders(all);
      const latest = latestActiveOrder(session?.user?.id ?? null) as OrderData | null;
      if (!latest) { router.replace("/dashboard"); return; }
      setActiveOrders(all);
      setOrder(latest);
      setPhase(toPhase(latest.status || "preparing"));
    } catch {
      router.replace("/dashboard");
    }
  }, [router, session?.user?.id]);

  // Poll real order status from DB every 10 seconds
  useEffect(() => {
    if (!order?.id || phase === "collected") return;
    // Only poll if we have a real Supabase UUID (not a local ORD-xxx id)
    const isRealId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(order.id);
    if (!isRealId) return;

    const token = session?.access_token;
    if (!token) return;

    const poll = async () => {
      try {
        const res = await fetch(`/api/orders/${order.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const { order: dbOrder } = await res.json();
        if (!dbOrder) return;

        const newPhase = toPhase(dbOrder.status || "placed");
        const updated: OrderData = {
          ...order,
          status: dbOrder.status,
          otp: dbOrder.otp ?? order.otp,
          bin: dbOrder.bin_label ? `Bin ${dbOrder.bin_label}` : order.bin,
          binCode: dbOrder.bin_color
            ? `#${dbOrder.bin_color.substring(0, 3).toUpperCase()}${dbOrder.bin_label ?? ""}`
            : order.binCode,
        };
        setOrder(updated);
        upsertActiveOrder(updated);
        setActiveOrders(readActiveOrders(session?.user?.id ?? null) as OrderData[]);
        setPhase(newPhase);

        if (newPhase === "collected") {
          if (pollRef.current) clearInterval(pollRef.current);
        }
      } catch {
        // silently ignore poll errors
      }
    };

    poll(); // immediate first poll
    pollRef.current = setInterval(poll, 10_000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order?.id, session?.access_token, phase]);

  // Countdown after "collected" → redirect home
  useEffect(() => {
    if (phase !== "collected" || !order) return;
    if (countdown <= 0) {
      const rest = removeActiveOrder(order.id, session?.user?.id ?? null) as OrderData[];
      setActiveOrders(rest);
      if (rest.length > 0) {
        const next = rest[0];
        setOrder(next);
        setPhase(toPhase(next.status || "preparing"));
        setCountdown(3);
        return;
      }
      router.replace("/dashboard");
      return;
    }
    const t = setTimeout(() => setCountdown(c => c - 1), 1_000);
    return () => clearTimeout(t);
  }, [phase, countdown, order, router, session?.user?.id]);

  const handleMarkCollected = useCallback(async () => {
    if (!order) return;
    // Try to update DB status for real orders
    const isRealId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(order.id);
    if (isRealId && session?.access_token) {
      await fetch(`/api/orders/${order.id}/status`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ status: "collected" }),
      }).catch(() => {});
    }
    const updated = { ...order, status: "collected" };
    upsertActiveOrder(updated);
    setOrder(updated);
    setPhase("collected");
  }, [order, session?.access_token]);

  if (!order) {
    return <div className="loading-screen"><div className="spinner" /></div>;
  }

  // ── Collected screen (3-second splash) ──
  if (phase === "collected") {
    return (
      <div
        className="app-shell"
        style={{
          alignItems: "center", justifyContent: "center", textAlign: "center",
          background: "linear-gradient(160deg, #f0fdf4 0%, #dcfce7 100%)",
          minHeight: "100dvh",
        }}
      >
        <div style={{ fontSize: "4rem", marginBottom: "1rem" }}>✅</div>
        <h2 style={{ fontWeight: 900, fontSize: "1.4rem", color: "#15803d", marginBottom: "0.5rem" }}>
          Order collected
        </h2>
        <p style={{ color: "#166534", fontSize: "0.95rem", marginBottom: "2rem" }}>
          Hope you enjoyed your meal.
        </p>
        <div style={{ fontSize: "0.8rem", color: "#4ade80" }}>
          Returning home in {countdown}s…
        </div>
      </div>
    );
  }

  const binColor = getBinColor(order.binCode);

  // ── Ready screen (locked navigation) ──
  if (phase === "ready") {
    const otpDigits = order.otp.toString().padStart(4, "0").split("");
    return (
      <div
        className="app-shell"
        style={{ paddingBottom: 0, background: "#fafafa", minHeight: "100dvh" }}
      >
        {/* Locked top bar */}
        <div style={{ position: "sticky", top: 0, zIndex: 40, background: "#fff", borderBottom: "1px solid var(--border)", padding: "0.7rem 1rem", display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#22c55e", flexShrink: 0, animation: "pulse 1.5s infinite" }} />
          <div>
            <div style={{ fontSize: "0.78rem", color: "var(--ink-3)", fontWeight: 500 }}>Collect your order</div>
            <div style={{ fontSize: "0.95rem", fontWeight: 800 }}>{order.canteen || "Canteen"}</div>
          </div>
        </div>

        <div style={{ padding: "1.25rem 1rem", display: "flex", flexDirection: "column", gap: "1rem", paddingBottom: "2rem" }}>
          {activeOrders.length > 1 && (
            <div className="card" style={{ padding: "0.65rem", display: "flex", gap: "0.4rem", overflowX: "auto" }}>
              {activeOrders.map((o) => {
                const isActive = o.id === order.id;
                return (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => { setOrder(o); setPhase(toPhase(o.status || "preparing")); }}
                    style={{
                      border: "none",
                      borderRadius: 999,
                      padding: "0.35rem 0.7rem",
                      background: isActive ? "var(--orange)" : "#f1f5f9",
                      color: isActive ? "#fff" : "var(--ink-2)",
                      fontSize: "0.72rem",
                      fontWeight: 700,
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {`#${o.id.slice(-6).toUpperCase()} · ${o.slot || "Slot"}`}
                  </button>
                );
              })}
            </div>
          )}

          {/* "Your order is ready" heading */}
          <div style={{ textAlign: "center", padding: "0.5rem 0" }}>
            <h2 style={{ fontWeight: 900, fontSize: "1.3rem", color: "#15803d", marginBottom: "0.25rem" }}>
              Your order is ready 🎉
            </h2>
            <p style={{ fontSize: "0.85rem", color: "var(--ink-3)", fontWeight: 600 }}>
              Collect Your Order and tell OTP if asked
            </p>
          </div>

          {/* Bin number */}
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "0.75rem", color: "var(--ink-3)", fontWeight: 600, textTransform: "uppercase", marginBottom: "0.5rem" }}>Your Bin</div>
            <div
              style={{
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                width: 80, height: 80, borderRadius: 20,
                background: binColor, color: "#fff",
                fontSize: "2rem", fontWeight: 900,
                boxShadow: `0 8px 24px ${binColor}55`,
              }}
            >
              {order.bin.replace("Bin ", "")}
            </div>
            {order.binCode && (
              <div style={{ fontSize: "0.72rem", color: "var(--ink-3)", marginTop: "0.4rem", fontFamily: "monospace" }}>{order.binCode}</div>
            )}
          </div>

          {/* OTP */}
          <div className="card" style={{ padding: "1rem", textAlign: "center" }}>
            <div style={{ fontSize: "0.72rem", color: "var(--ink-3)", fontWeight: 600, textTransform: "uppercase", marginBottom: "0.75rem" }}>
              Your OTP
            </div>
            <div style={{ display: "flex", gap: "0.6rem", justifyContent: "center" }}>
              {otpDigits.map((d, i) => (
                <div
                  key={i}
                  style={{
                    width: 52, height: 60, borderRadius: 12,
                    border: "2px solid var(--orange)", background: "#fff7ed",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: "1.8rem", fontWeight: 900, color: "var(--orange)",
                  }}
                >
                  {d}
                </div>
              ))}
            </div>
            <div style={{ fontSize: "0.7rem", color: "var(--ink-3)", marginTop: "0.6rem" }}>
              Staff will verify by checking your app or asking OTP
            </div>
          </div>

          {/* Items list */}
          <div className="card" style={{ padding: "0.85rem" }}>
            <div style={{ fontSize: "0.72rem", color: "var(--ink-3)", fontWeight: 600, textTransform: "uppercase", marginBottom: "0.6rem" }}>Order Items</div>
            {(order.itemsList ?? order.items.split(", ").map(s => ({ name: s, qty: 1, price: 0 }))).map((item, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.4rem 0", borderBottom: i < (order.itemsList?.length ?? 1) - 1 ? "1px solid var(--border)" : "none", fontSize: "0.88rem" }}>
                <span style={{ fontWeight: 600 }}>{typeof item === "string" ? item : item.name}</span>
                {typeof item !== "string" && <span style={{ color: "var(--ink-3)" }}>×{item.qty}</span>}
              </div>
            ))}
          </div>

          {/* Phase 7: per-bin breakdown for multi-bin orders */}
          {order.bins && order.bins.length > 1 && (
            <div className="card" style={{ padding: "0.85rem", border: "1.5px solid #f97316" }}>
              <div style={{ fontSize: "0.72rem", color: "#9a3412", fontWeight: 700, textTransform: "uppercase", marginBottom: "0.6rem" }}>
                📦 Pickup from {order.bins.length} bins
              </div>
              {order.bins.map((b) => (
                <div key={b.binIndex} style={{ marginBottom: "0.6rem", paddingBottom: "0.6rem", borderBottom: b.binIndex < order.bins!.length ? "1px dashed var(--border)" : "none" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.3rem" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: 8, background: getBinColor(`#${(b.binColor || "BLU").substring(0,3).toUpperCase()}${b.binLabel}`), color: "#fff", fontWeight: 800, fontSize: "0.8rem" }}>{b.binIndex}</span>
                    <span style={{ fontWeight: 700, fontSize: "0.88rem" }}>Bin {b.binLabel}</span>
                  </div>
                  {b.items.map((it, j) => (
                    <div key={j} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.84rem", paddingLeft: "0.4rem", color: "var(--ink-3)" }}>
                      <span>{it.name}</span>
                      <span>×{it.quantity}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

        </div>
      </div>
    );
  }

  // ── Preparing screen (user can navigate) ──
  return (
    <div className="app-shell">
      <div className="topbar">
        <Link href="/dashboard" style={{ background: "none", border: "none", cursor: "pointer", fontSize: "1.1rem", color: "var(--ink-3)", textDecoration: "none" }}>←</Link>
        <h1 style={{ fontSize: "1rem", fontWeight: 700 }}>Order Accepted</h1>
        <div />
      </div>

      <div style={{ padding: "1rem 1rem 6rem", display: "flex", flexDirection: "column", gap: "1rem" }}>

        {/* Status card */}
        <div style={{ textAlign: "center", padding: "1.5rem 1rem" }}>
          <div style={{ fontSize: "3rem", marginBottom: "0.5rem" }}>🍳</div>
          <h2 style={{ fontWeight: 900, fontSize: "1.2rem", marginBottom: "0.25rem" }}>Order Accepted</h2>
          <p style={{ color: "var(--ink-3)", fontSize: "0.85rem", marginBottom: "0.5rem" }}>
            Order Ready by <strong>{readyTime}</strong>
          </p>
          <p style={{ color: "var(--ink-3)", fontSize: "0.82rem" }}>
            📍 Bin and OTP will appear when ready
          </p>
        </div>

        {/* Progress steps */}
        <div className="card" style={{ padding: "1rem" }}>
          <div style={{ fontSize: "0.72rem", color: "var(--ink-3)", fontWeight: 600, textTransform: "uppercase", marginBottom: "1rem" }}>Status</div>
          <div style={{ position: "relative" }}>
            {/* Track line */}
            <div style={{ position: "absolute", left: 10, top: 12, bottom: 12, width: 2, background: "var(--border)", zIndex: 0 }} />
            {[
              { label: "Order placed",           done: true,  active: false },
              { label: "Preparing your order…",  done: false, active: true  },
              { label: "Ready for pickup",        done: false, active: false },
            ].map((step, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.5rem 0", position: "relative", zIndex: 1 }}>
                <div style={{
                  width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
                  background: step.done ? "var(--orange)" : step.active ? "var(--orange-light)" : "#e5e7eb",
                  border: step.active ? "2.5px solid var(--orange)" : "none",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: "0.72rem", color: step.done ? "#fff" : "var(--ink-3)",
                }}>
                  {step.done ? "✓" : ""}
                </div>
                <span style={{
                  fontSize: "0.88rem", fontWeight: step.active ? 700 : 500,
                  color: step.done || step.active ? "var(--ink)" : "var(--ink-3)",
                }}>
                  {step.label}
                  {step.active && (
                    <span style={{ marginLeft: "0.5rem", fontSize: "0.7rem", color: "var(--orange)", fontWeight: 600 }}>
                      In progress…
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Order info */}
        <div className="card" style={{ padding: "0.85rem" }}>
          <div style={{ fontSize: "0.72rem", color: "var(--ink-3)", fontWeight: 600, textTransform: "uppercase", marginBottom: "0.5rem" }}>Order Details</div>
          <div style={{ fontSize: "0.8rem", color: "var(--ink-3)", marginBottom: "0.25rem" }}>#{order.id}</div>
          <div style={{ fontSize: "0.88rem", fontWeight: 600, marginBottom: "0.25rem" }}>{order.slot}</div>
          <div style={{ fontSize: "0.8rem", color: "var(--ink-3)" }}>{order.items}</div>
          {order.bins && order.bins.length > 1 && (
            <div style={{ marginTop: "0.5rem", fontSize: "0.78rem", color: "#9a3412", fontWeight: 600 }}>
              📦 This order will be in {order.bins.length} pickup bins.
            </div>
          )}
        </div>

        {/* Phase 7: per-bin breakdown for multi-bin orders (preparing screen) */}
        {order.bins && order.bins.length > 1 && (
          <div className="card" style={{ padding: "0.85rem", border: "1.5px solid #fed7aa", background: "#fff7ed" }}>
            <div style={{ fontSize: "0.72rem", color: "#9a3412", fontWeight: 700, textTransform: "uppercase", marginBottom: "0.6rem" }}>
              📦 Bin breakdown
            </div>
            {order.bins.map((b, i) => (
              <div key={b.binIndex} style={{ marginBottom: "0.5rem", paddingBottom: "0.5rem", borderBottom: i < order.bins!.length - 1 ? "1px dashed #fed7aa" : "none" }}>
                <div style={{ fontWeight: 700, fontSize: "0.86rem", color: "#9a3412", marginBottom: "0.2rem" }}>Bin {b.binLabel}</div>
                {b.items.map((it, j) => (
                  <div key={j} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.82rem", paddingLeft: "0.4rem", color: "#7c2d12" }}>
                    <span>{it.name}</span>
                    <span>×{it.quantity}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* Info */}
        <div style={{ background: "var(--blue-light)", border: "1px solid #bfdbfe", borderRadius: 12, padding: "0.75rem 1rem", fontSize: "0.8rem", color: "#1d4ed8" }}>
          🔔 We&apos;ll notify you when your order is ready to collect. You can navigate freely — the tracking button will appear on home.
        </div>

        {/* Cancellation policy notice — per revised workflow:
            once payment is successful the canteen prepares strictly per
            slot, so cancellation is disabled to avoid food waste. */}
        <div style={{ background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 12, padding: "0.75rem 1rem", fontSize: "0.8rem", color: "#9a3412" }}>
          ⚠️ Order confirmed. Cancellation is not available because the canteen will prepare based on your selected slot.
        </div>

        {/* Cancel button — only enabled before the prep batch starts
            (slot_start - slot_duration). Backend re-validates the cutoff. */}
        <button
          onClick={async () => {
            if (!order || !session?.access_token) return;
            if (!confirm("Cancel this order? This is only possible before the canteen starts preparing your slot.")) return;
            try {
              const res = await fetch(`/api/orders/${order.id}/status`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
                body: JSON.stringify({ status: "cancelled" }),
              });
              const j = await res.json().catch(() => ({}));
              if (!res.ok) {
                alert(j.error || "Could not cancel order.");
                return;
              }
              removeActiveOrder(order.id, session?.user?.id ?? null);
              router.replace("/dashboard");
            } catch {
              alert("Network error. Try again.");
            }
          }}
          style={{ background: "#fff", border: "1.5px solid #ef4444", color: "#ef4444", borderRadius: 12, padding: "0.7rem 1rem", fontSize: "0.88rem", fontWeight: 700, cursor: "pointer" }}
        >
          Cancel order
        </button>

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

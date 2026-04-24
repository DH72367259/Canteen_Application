"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

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
}

type Phase = "preparing" | "ready" | "collected";

// Map raw API status → our UI phase
function toPhase(rawStatus: string): Phase {
  if (["collected", "completed"].includes(rawStatus)) return "collected";
  if (["ready_for_pickup", "placed_in_bin", "ready_for_placement"].includes(rawStatus)) return "ready";
  return "preparing";
}

const BIN_COLORS: Record<string, string> = {
  RED: "#ef4444", BLU: "#3b82f6", GRN: "#22c55e", YEL: "#f59e0b",
};

function getBinColor(binCode?: string) {
  if (!binCode) return "#f97316";
  const prefix = binCode.replace("#", "").substring(0, 3).toUpperCase();
  return BIN_COLORS[prefix] || "#f97316";
}

export default function OrderStatusPage() {
  const router = useRouter();
  const [order, setOrder] = useState<OrderData | null>(null);
  const [phase, setPhase] = useState<Phase>("preparing");
  const [countdown, setCountdown] = useState(3);
  const [readyTime] = useState(() => {
    const d = new Date(Date.now() + 15 * 60 * 1000);
    return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
  });

  // Load active order from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem("canteen_active_order");
      if (!raw) { router.replace("/dashboard"); return; }
      const data = JSON.parse(raw) as OrderData;
      setOrder(data);
      setPhase(toPhase(data.status || "preparing"));
    } catch {
      router.replace("/dashboard");
    }
  }, [router]);

  // Demo: auto-progress status for simulation (poll every 15s in prod)
  useEffect(() => {
    if (!order) return;
    // In production: poll /api/orders/[id] every 15 seconds
    // For now: auto-advance from preparing → ready after 20s (demo only)
    if (phase === "preparing") {
      const t = setTimeout(() => {
        setPhase("ready");
        const updated = { ...order, status: "ready_for_pickup" };
        setOrder(updated);
        localStorage.setItem("canteen_active_order", JSON.stringify(updated));
      }, 20_000);
      return () => clearTimeout(t);
    }
  }, [order, phase]);

  // Countdown after "collected" → redirect home
  useEffect(() => {
    if (phase !== "collected") return;
    if (countdown <= 0) {
      localStorage.removeItem("canteen_active_order");
      router.replace("/dashboard");
      return;
    }
    const t = setTimeout(() => setCountdown(c => c - 1), 1_000);
    return () => clearTimeout(t);
  }, [phase, countdown, router]);

  const handleMarkCollected = useCallback(() => {
    if (!order) return;
    const updated = { ...order, status: "collected" };
    localStorage.setItem("canteen_active_order", JSON.stringify(updated));
    setOrder(updated);
    setPhase("collected");
  }, [order]);

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
              Collect your order and tell OTP if asked
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

          {/* Mark collected */}
          <button
            onClick={handleMarkCollected}
            className="btn btn-primary btn-full"
            style={{ padding: "0.9rem", fontSize: "1rem", fontWeight: 800 }}
          >
            ✅ Mark as Collected
          </button>
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
        </div>

        {/* Info */}
        <div style={{ background: "var(--blue-light)", border: "1px solid #bfdbfe", borderRadius: 12, padding: "0.75rem 1rem", fontSize: "0.8rem", color: "#1d4ed8" }}>
          🔔 We&apos;ll notify you when your order is ready to collect. You can navigate freely — the tracking button will appear on home.
        </div>

      </div>

      {/* Bottom nav */}
      <nav className="bottom-nav">
        {[
          { icon: "🏠", label: "Home",      href: "/dashboard" },
          { icon: "📦", label: "My Orders", href: "/dashboard/orders" },
          { icon: "⭐", label: "Pro",        href: "/dashboard/pro" },
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

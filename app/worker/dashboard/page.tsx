"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import dynamic from "next/dynamic";

const QRScanner = dynamic(() => import("@/components/QRScanner"), { ssr: false });

// ─── Types ────────────────────────────────────────────────────────────────────
interface OrderItem { name: string; quantity: number }
interface WorkerOrder {
  id: string;
  status: string;       // mapped enum (from CanteenOrder.status)
  rawStatus?: string;   // raw DB status: confirmed, preparing, ready_for_placement, placed_in_bin…
  binLabel?: string;    // bin_code e.g. "A1"
  binColor?: string;    // color e.g. "red"
  binId?: string;
  pickupSlot?: string;  // time slot name e.g. "Lunch"
  slotLabel?: string;   // display label e.g. "1:00 PM - 1:15 PM" (from orders.slot_label)
  items: OrderItem[];
  createdAt?: string;
  // legacy snake_case aliases (from old bins API, kept for fallback)
  bin_code?: string; bin_color?: string; bin_number?: number; bin_id?: string;
  pickup_slot?: string; created_at?: string;
  // Phase 7: per-bin breakdown
  binCount?: number;
  binAssignments?: Array<{
    binIndex: number;
    binLabel: string;
    binColor: string;
    items: Array<{ name: string; quantity: number; isMeal?: boolean }>;
  }>;
}
interface BinDetail {
  id: string; bin_code: string | number; color: string;
  status: "empty" | "occupied" | "overdue" | "grace_expired" | "late_pickup";
  order_count: number;
}
interface PrepItem { name: string; quantity: number }
interface PrepSlot { slot: string; startTime?: string | null; items: PrepItem[] }

// Parse "1:00 PM - 1:15 PM" → minutes from midnight for the start time (label fallback)
function parseSlotStartMins(label: string): number | null {
  const m = label.match(/^(\d+):(\d+)\s*(AM|PM)/i);
  if (!m) return null;
  let h = parseInt(m[1]); const min = parseInt(m[2]);
  const pm = m[3].toUpperCase() === "PM";
  if (pm && h !== 12) h += 12;
  if (!pm && h === 12) h = 0;
  return h * 60 + min;
}

// Returns start minutes for a slot: prefers DB start_time ("HH:MM:SS"), falls back to label parse
function slotStartMins(s: PrepSlot): number | null {
  if (s.startTime) {
    const parts = s.startTime.split(":");
    if (parts.length >= 2) {
      const h = parseInt(parts[0]); const m = parseInt(parts[1]);
      if (!isNaN(h) && !isNaN(m)) return h * 60 + m;
    }
  }
  return parseSlotStartMins(s.slot);
}

// Auto-pick which slot to show in prep summary:
// Priority 1 — next slot starting within 15 min (prep ahead)
// Priority 2 — current active slot (started within last 45 min)
// Fallback    — first slot
function pickAutoSlot(slots: PrepSlot[]): string | null {
  if (!slots.length) return null;
  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();

  const withDiff = slots.map(s => ({ slot: s.slot, diff: slotStartMins(s) }))
    .filter((x): x is { slot: string; diff: number } => x.diff !== null)
    .map(x => ({ ...x, diff: x.diff - nowMins }));

  // Next slot starting within 15 min
  const upcoming = withDiff.filter(x => x.diff > 0 && x.diff <= 15).sort((a, b) => a.diff - b.diff);
  if (upcoming.length) return upcoming[0].slot;

  // Current active slot (started within last 45 min)
  const active = withDiff.filter(x => x.diff <= 0 && x.diff >= -45).sort((a, b) => b.diff - a.diff);
  if (active.length) return active[0].slot;

  return slots[0].slot;
}

const BIN_COLORS: Record<string, string> = {
  red: "#ef4444", blue: "#3b82f6", green: "#22c55e",
  yellow: "#eab308", purple: "#a855f7", orange: "#f97316",
};

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function WorkerApp() {
  const router = useRouter();
  const { user, session, loading, logout } = useAuth();
  const [tab, setTab] = useState<"orders" | "bins" | "prep">("orders");

  const wrongRoleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (loading) return;
    if (!user) {
      if (typeof window !== "undefined") {
        const stored = localStorage.getItem("canteen_auth_v2");
        if (stored && stored.length > 20) return;
      }
      if (wrongRoleTimerRef.current) { clearTimeout(wrongRoleTimerRef.current); wrongRoleTimerRef.current = null; }
      router.replace("/worker/login");
      return;
    }
    if (user.role === "worker") {
      if (wrongRoleTimerRef.current) { clearTimeout(wrongRoleTimerRef.current); wrongRoleTimerRef.current = null; }
      return;
    }
    if (wrongRoleTimerRef.current) return;
    wrongRoleTimerRef.current = setTimeout(() => {
      wrongRoleTimerRef.current = null;
      const role = user.role;
      if (role === "vendor" || role === "canteen_admin") router.replace("/vendor/dashboard");
      else if (role === "super_admin" || role === "co_admin") router.replace("/admin/dashboard");
      else router.replace("/worker/login");
    }, 400);
  }, [user, loading, router]);

  if (loading || !user || user.role !== "worker") {
    return <div style={{ minHeight: "100vh", background: "#1e293b", display: "flex", alignItems: "center", justifyContent: "center" }}><div className="spinner" style={{ borderTopColor: "#f97316" }} /></div>;
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9", display: "flex", flexDirection: "column" }}>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.88; transform: scale(0.995); }
        }
      `}</style>
      <TopBar onLogout={() => logout().then(() => router.replace("/worker/login"))} />
      <div style={{ flex: 1, overflowY: "auto", paddingBottom: "4.5rem" }}>
        {tab === "orders" && <OrdersTab session={session} />}
        {tab === "bins"   && <BinsTab session={session} />}
        {tab === "prep"   && <PrepTab session={session} />}
      </div>
      <BottomNav tab={tab} onChange={setTab} />
    </div>
  );
}

function TopBar({ onLogout }: { onLogout: () => void }) {
  const [time, setTime] = useState(() => new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }));
  useEffect(() => {
    const t = setInterval(() => setTime(new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })), 30000);
    return () => clearInterval(t);
  }, []);
  return (
    <div style={{ background: "linear-gradient(135deg, #1e293b 0%, #0f172a 100%)", color: "#fff", padding: "0.75rem 1rem", display: "flex", alignItems: "center", justifyContent: "space-between", boxShadow: "0 2px 8px rgba(0,0,0,0.25)", position: "sticky", top: 0, zIndex: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <span style={{ fontSize: "1.2rem" }}>🧑‍🍳</span>
        <span style={{ fontWeight: 800, fontSize: "0.95rem" }}>Worker Portal</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
        <span style={{ fontFamily: "monospace", fontSize: "1rem", fontWeight: 700, background: "rgba(255,255,255,0.1)", padding: "0.2rem 0.6rem", borderRadius: 6 }}>{time}</span>
        <button onClick={onLogout} style={{ background: "rgba(239,68,68,0.2)", border: "1px solid rgba(239,68,68,0.4)", color: "#fca5a5", borderRadius: 8, padding: "0.35rem 0.65rem", cursor: "pointer", fontSize: "0.75rem", fontWeight: 600 }}>Logout</button>
      </div>
    </div>
  );
}

function BottomNav({ tab, onChange }: { tab: string; onChange: (t: "orders" | "bins" | "prep") => void }) {
  const items = [
    { id: "orders" as const, icon: "📦", label: "Orders" },
    { id: "bins"   as const, icon: "🧺", label: "Bin Verify" },
    { id: "prep"   as const, icon: "📊", label: "Prep Summary" },
  ];
  return (
    <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "#fff", borderTop: "1px solid #e2e8f0", display: "flex", zIndex: 30, boxShadow: "0 -4px 12px rgba(0,0,0,0.08)", gap: "0.5rem", padding: "0.5rem" }}>
      {items.map(item => (
        <button key={item.id} onClick={() => onChange(item.id)} style={{ flex: 1, padding: "1rem 0.5rem", background: tab === item.id ? "#fef3c7" : "none", border: tab === item.id ? "2px solid #f97316" : "1px solid #e2e8f0", borderRadius: 12, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: "0.4rem", color: tab === item.id ? "#f97316" : "#94a3b8", fontWeight: tab === item.id ? 700 : 500, fontSize: "0.8rem", transition: "all 0.2s ease" }}>
          <span style={{ fontSize: "1.6rem" }}>{item.icon}</span>{item.label}
        </button>
      ))}
    </div>
  );
}

// ─── ORDERS TAB ───────────────────────────────────────────────────────────────
function OrdersTab({ session }: { session: { access_token: string } | null }) {
  const [slotGroups, setSlotGroups]     = useState<{ slot: string; orders: WorkerOrder[] }[]>([]);
  const [awaitingOtp, setAwaitingOtp]   = useState<WorkerOrder[]>([]);
  const [latePickup, setLatePickup]     = useState<WorkerOrder[]>([]);
  const [updating, setUpdating]         = useState<string | null>(null);
  const [confirmPlace, setConfirmPlace] = useState<WorkerOrder | null>(null);
  const [fetching, setFetching]         = useState(true);

  const fetchOrders = useCallback(async () => {
    if (!session) return;
    try {
      const res = await fetch("/api/orders?worker=true", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = await res.json();
      const all: WorkerOrder[] = data.orders ?? [];

      const PREP   = ["confirmed", "preparing", "ready_for_placement"];
      const PICKUP = ["placed_in_bin", "ready_for_pickup"];
      const LATE   = ["late_pickup"];

      const prepOrders = all
        .filter(o => PREP.includes(o.rawStatus ?? o.status))
        .sort((a, b) => new Date(a.createdAt ?? a.created_at ?? 0).getTime() - new Date(b.createdAt ?? b.created_at ?? 0).getTime());
      const pickupOrders = all
        .filter(o => PICKUP.includes(o.rawStatus ?? o.status))
        .sort((a, b) => new Date(a.createdAt ?? a.created_at ?? 0).getTime() - new Date(b.createdAt ?? b.created_at ?? 0).getTime());
      const lateOrders = all
        .filter(o => LATE.includes(o.rawStatus ?? o.status))
        .sort((a, b) => new Date(a.createdAt ?? a.created_at ?? 0).getTime() - new Date(b.createdAt ?? b.created_at ?? 0).getTime());

      // Group all prep orders by slot so worker can see all upcoming work
      const slotMap = new Map<string, WorkerOrder[]>();
      for (const o of prepOrders) {
        const slot = o.pickupSlot ?? o.pickup_slot ?? "Unknown Slot";
        if (!slotMap.has(slot)) slotMap.set(slot, []);
        slotMap.get(slot)!.push(o);
      }
      setSlotGroups(
        Array.from(slotMap.entries())
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([slot, orders]) => ({ slot, orders }))
      );
      setAwaitingOtp(pickupOrders);
      setLatePickup(lateOrders);
    } catch { /* retry */ }
    finally { setFetching(false); }
  }, [session]);

  useEffect(() => {
    fetchOrders();
    const iv = setInterval(fetchOrders, 5000);
    return () => clearInterval(iv);
  }, [fetchOrders]);

  async function updateStatus(orderId: string, status: string) {
    if (!session) return;
    setUpdating(orderId);
    try {
      await fetch(`/api/orders/${orderId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ status }),
      });
      await fetchOrders();
    } finally { setUpdating(null); }
  }

  if (fetching) return <LoadingState label="Loading orders…" />;

  const totalPrep = slotGroups.reduce((sum, g) => sum + g.orders.length, 0);

  return (
    <div style={{ padding: "1rem" }}>
      {/* Late pickup alert — pulsing banner, shown FIRST so worker sees it immediately */}
      {latePickup.length > 0 && (
        <div style={{ background: "#dc2626", borderRadius: 12, padding: "0.75rem 1rem", marginBottom: "0.85rem", display: "flex", alignItems: "center", gap: "0.65rem", animation: "pulse 1.5s ease-in-out infinite", boxShadow: "0 4px 18px rgba(220,38,38,0.45)" }}>
          <span style={{ fontSize: "1.5rem" }}>🔔</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: "0.95rem", color: "#fff" }}>
              {latePickup.length} Late Pickup Order{latePickup.length !== 1 ? "s" : ""}
            </div>
            <div style={{ fontSize: "0.78rem", color: "rgba(255,255,255,0.88)", marginTop: "0.1rem" }}>
              ⚠️ Move food from the physical bin to the late pickup counter now
            </div>
          </div>
        </div>
      )}

      {/* Summary banner — shows total orders + slot count, refreshes every 5s */}
      <div style={{ background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 10, padding: "0.55rem 0.85rem", marginBottom: "0.75rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontWeight: 700, fontSize: "0.85rem", color: "#9a3412" }}>
          {totalPrep > 0
            ? `${totalPrep} order${totalPrep !== 1 ? "s" : ""} to prepare · ${slotGroups.length} slot${slotGroups.length !== 1 ? "s" : ""}`
            : awaitingOtp.length > 0 ? "All prepared — awaiting pickup" : latePickup.length > 0 ? "Slot ended — handle late pickups below" : "All caught up!"}
        </span>
        <span style={{ fontSize: "0.68rem", color: "#c2410c", fontWeight: 600 }}>↻ 5s</span>
      </div>

      {/* Empty state */}
      {slotGroups.length === 0 && awaitingOtp.length === 0 && (
        <div style={{ textAlign: "center", padding: "4rem 1rem", color: "#64748b" }}>
          <div style={{ fontSize: "3rem", marginBottom: "0.75rem" }}>✅</div>
          <div style={{ fontWeight: 700, fontSize: "1rem" }}>All prepared!</div>
          <div style={{ fontSize: "0.82rem", marginTop: "0.35rem" }}>Waiting for next orders.</div>
        </div>
      )}

      {/* Slot-by-slot queue — worker sees all upcoming slots so he can prep ahead */}
      {slotGroups.map(({ slot, orders }) => (
        <div key={slot} style={{ marginBottom: "1.25rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem", borderBottom: "2px solid #e2e8f0", paddingBottom: "0.35rem" }}>
            <span style={{ fontWeight: 800, fontSize: "0.9rem", color: "#1e293b" }}>{slot}</span>
            <span style={{ background: "#f1f5f9", borderRadius: 20, padding: "0.1rem 0.5rem", fontSize: "0.72rem", fontWeight: 600, color: "#475569" }}>
              {orders.length} order{orders.length !== 1 ? "s" : ""}
            </span>
          </div>
          {orders.map(order => (
            <WorkerOrderCard
              key={order.id}
              order={order}
              updating={updating === order.id}
              onUpdateStatus={updateStatus}
              onConfirmPlace={() => setConfirmPlace(order)}
            />
          ))}
        </div>
      ))}

      <AwaitingOtpList orders={awaitingOtp} session={session} onUpdated={fetchOrders} />
      <LatePickupList orders={latePickup} session={session} onUpdated={fetchOrders} />

      {/* Placement confirm modal */}
      {confirmPlace && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: "1.5rem" }}>
          <div style={{ background: "#fff", borderRadius: 20, padding: "1.75rem 1.5rem", maxWidth: 340, width: "100%", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
            <div style={{ textAlign: "center", marginBottom: "1.25rem" }}>
              <div style={{ fontSize: "2.5rem", marginBottom: "0.5rem" }}>✅</div>
              <h3 style={{ fontSize: "1.1rem", fontWeight: 800, margin: "0 0 0.35rem" }}>Confirm Placement</h3>
              <p style={{ fontSize: "0.88rem", color: "#64748b", margin: 0 }}>
                Confirm food placed in <strong>Bin {confirmPlace.binLabel ?? String(confirmPlace.bin_code ?? "?")}</strong>?
              </p>
            </div>
            <button
              onClick={() => { const id = confirmPlace.id; setConfirmPlace(null); updateStatus(id, "placed_in_bin"); }}
              style={{ width: "100%", padding: "0.85rem", background: "#22c55e", color: "#fff", border: "none", borderRadius: 12, fontWeight: 700, fontSize: "1rem", cursor: "pointer", marginBottom: "0.5rem" }}
            >
              Yes, Placed in Bin {confirmPlace.binLabel ?? String(confirmPlace.bin_code ?? "?")}
            </button>
            <button onClick={() => setConfirmPlace(null)} style={{ width: "100%", padding: "0.65rem", background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: "0.88rem" }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

// Compact per-order card for the worker slot-by-slot queue
function WorkerOrderCard({
  order, updating, onUpdateStatus, onConfirmPlace,
}: {
  order: WorkerOrder;
  updating: boolean;
  onUpdateStatus: (id: string, status: string) => void;
  onConfirmPlace: () => void;
}) {
  const rawStatus = order.rawStatus ?? order.status;
  const binLabel  = order.binLabel ?? (order.bin_code ? String(order.bin_code) : null);
  const hasBin    = !!binLabel;
  const colorKey  = order.binColor ?? order.bin_color ?? "orange";
  const binColor  = BIN_COLORS[colorKey] ?? "#f97316";
  const isReady   = rawStatus === "ready_for_placement";

  return (
    <div style={{ background: "#fff", borderRadius: 14, boxShadow: "0 2px 8px rgba(0,0,0,0.07)", overflow: "hidden", marginBottom: "0.65rem", borderLeft: hasBin ? `4px solid ${binColor}` : "4px solid #e2e8f0" }}>
      {/* Header: order ID + bin badge */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0.55rem 0.75rem", borderBottom: "1px solid #f1f5f9" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={{ fontSize: "0.72rem", fontWeight: 800, fontFamily: "monospace", color: "#64748b" }}>#{order.id.slice(-8).toUpperCase()}</span>
          {(order.binCount ?? 1) > 1 && (
            <span style={{ fontSize: "0.68rem", background: "#fff7ed", color: "#9a3412", border: "1px solid #fed7aa", borderRadius: 6, padding: "0.1rem 0.3rem", fontWeight: 700 }}>📦 {order.binCount} bins</span>
          )}
        </div>
        {hasBin ? (
          <div style={{ background: binColor, color: "#fff", borderRadius: 8, padding: "0.15rem 0.55rem", fontSize: "0.78rem", fontWeight: 800 }}>{binLabel}</div>
        ) : (
          <div style={{ background: "#fef3c7", color: "#92400e", border: "1px solid #fbbf24", borderRadius: 8, padding: "0.15rem 0.5rem", fontSize: "0.7rem", fontWeight: 700 }}>⏳ Bin pending</div>
        )}
      </div>
      {/* Items list */}
      <div style={{ padding: "0.45rem 0.75rem", fontSize: "0.82rem", color: "#475569", lineHeight: 1.5 }}>
        {order.items.map((item, i) => (
          <span key={i}>{item.name} ×{item.quantity}{i < order.items.length - 1 ? " · " : ""}</span>
        ))}
      </div>
      {/* Actions */}
      {!isReady && (
        <div style={{ display: "flex", gap: "0.4rem", padding: "0 0.75rem 0.6rem" }}>
          <button onClick={() => onUpdateStatus(order.id, "ready_for_placement")} disabled={updating} style={{ flex: 1, fontSize: "0.75rem", fontWeight: 700, background: "#eab308", color: "#fff", border: "none", borderRadius: 8, padding: "0.45rem", cursor: updating ? "not-allowed" : "pointer", opacity: updating ? 0.6 : 1 }}>✓ Ready</button>
          <button onClick={() => onUpdateStatus(order.id, "skip")} disabled={updating} style={{ fontSize: "0.75rem", fontWeight: 600, background: "#f1f5f9", color: "#64748b", border: "none", borderRadius: 8, padding: "0.45rem 0.65rem", cursor: updating ? "not-allowed" : "pointer", opacity: updating ? 0.6 : 1 }}>Skip</button>
        </div>
      )}
      {isReady && hasBin && (
        <div style={{ padding: "0 0.75rem 0.6rem" }}>
          <button onClick={onConfirmPlace} disabled={updating} style={{ width: "100%", fontSize: "0.82rem", fontWeight: 800, background: "#22c55e", color: "#fff", border: "none", borderRadius: 8, padding: "0.55rem", cursor: updating ? "not-allowed" : "pointer", opacity: updating ? 0.6 : 1 }}>
            📦 Place in Bin {binLabel}
          </button>
        </div>
      )}
      {isReady && !hasBin && (
        <div style={{ padding: "0 0.75rem 0.6rem" }}>
          <div style={{ background: "#fef3c7", border: "1px solid #fbbf24", borderRadius: 8, padding: "0.4rem 0.65rem", fontSize: "0.75rem", color: "#92400e", fontStyle: "italic", textAlign: "center" as const }}>
            Ready — bin assigned automatically at slot start
          </div>
        </div>
      )}
    </div>
  );
}


function AwaitingOtpList({ orders, session, onUpdated }: { orders: WorkerOrder[]; session: { access_token: string } | null; onUpdated: () => void | Promise<void> }) {
  if (orders.length === 0) return null;
  return (
    <div style={{ marginTop: "1.25rem" }}>
      <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "#64748b", letterSpacing: "0.05em", margin: "0 0 0.5rem 0.25rem" }}>
        AWAITING OTP PICKUP ({orders.length})
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.65rem" }}>
        {orders.map(o => (
          <AwaitingOtpRow key={o.id} order={o} session={session} onDone={onUpdated} />
        ))}
      </div>
    </div>
  );
}

function AwaitingOtpRow({ order, session, onDone }: { order: WorkerOrder; session: { access_token: string } | null; onDone: () => void | Promise<void> }) {
  const [otp, setOtp]         = useState("");
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const colorKey = order.binColor ?? order.bin_color ?? "orange";
  const binBg    = BIN_COLORS[colorKey] ?? "#f97316";
  const binCode  = order.binLabel ?? order.bin_code ?? `#${order.bin_number ?? "?"}`;
  const binCount = order.binAssignments?.length ?? order.binCount ?? 1;

  async function verifyOtp() {
    if (!session || otp.length < 4) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/orders/${order.id}/verify-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ otp }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Verification failed");
      setOtp("");
      await onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally { setBusy(false); }
  }

  async function verifyQr(payload: string) {
    setScanning(false);
    if (!session) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/orders/${order.id}/verify-qr`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ qrPayload: payload }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "QR verification failed");
      await onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "QR scan failed");
    } finally { setBusy(false); }
  }

  return (
    <>
      {scanning && <QRScanner onScanned={verifyQr} onClose={() => setScanning(false)} onManualOtp={() => setScanning(false)} />}
      <div style={{ background: "#fff", borderRadius: 14, boxShadow: "0 2px 8px rgba(0,0,0,0.07)", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.65rem", padding: "0.6rem 0.75rem", background: binBg }}>
          <span style={{ color: "#fff", fontWeight: 900, fontSize: "1.05rem" }}>{binCode}{binCount > 1 ? ` +${binCount - 1}` : ""}</span>
          <span style={{ color: "rgba(255,255,255,0.85)", fontSize: "0.72rem", flex: 1 }}>#{order.id.slice(-8).toUpperCase()} · {order.pickupSlot ?? order.pickup_slot ?? "—"}</span>
          <span style={{ color: "#fff", fontSize: "0.7rem", background: "rgba(0,0,0,0.18)", padding: "0.15rem 0.45rem", borderRadius: 999, fontWeight: 700 }}>In bin</span>
        </div>
        <div style={{ padding: "0.6rem 0.75rem 0.75rem" }}>
          <div style={{ fontSize: "0.78rem", color: "#475569", marginBottom: "0.5rem" }}>
            {order.items.map(i => `${i.name}×${i.quantity}`).join(", ")}
          </div>
          {/* Primary: QR scan button */}
          <button
            onClick={() => { setScanning(true); setError(null); }}
            disabled={busy}
            style={{ width: "100%", padding: "0.65rem", background: "#1e293b", color: "#fff", border: "none", borderRadius: 10, fontWeight: 800, fontSize: "0.9rem", cursor: "pointer", marginBottom: "0.5rem", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.4rem" }}
          >
            📷 Scan QR Code
          </button>
          {/* Fallback: OTP */}
          <div style={{ fontSize: "0.7rem", color: "#94a3b8", textAlign: "center", margin: "0.3rem 0" }}>or enter backup OTP</div>
          <div style={{ display: "flex", gap: "0.4rem" }}>
            <input
              type="text" inputMode="numeric" maxLength={6} value={otp}
              onChange={e => { setOtp(e.target.value.replace(/\D/g, "")); setError(null); }}
              placeholder="OTP"
              style={{ flex: 1, padding: "0.6rem 0.75rem", fontSize: "1.05rem", letterSpacing: "0.25rem", fontWeight: 700, textAlign: "center", border: "1.5px solid #e2e8f0", borderRadius: 10 }}
            />
            <button
              onClick={verifyOtp} disabled={busy || otp.length < 4}
              style={{ padding: "0 1rem", background: otp.length < 4 ? "#e5e7eb" : "#22c55e", color: otp.length < 4 ? "#94a3b8" : "#fff", border: "none", borderRadius: 10, fontWeight: 800, fontSize: "0.85rem", cursor: otp.length < 4 ? "default" : "pointer" }}
            >
              {busy ? "…" : "Verify"}
            </button>
          </div>
          {error && <div style={{ fontSize: "0.75rem", color: "#dc2626", marginTop: "0.4rem" }}>{error}</div>}
        </div>
      </div>
    </>
  );
}

// ─── LATE PICKUP LIST ─────────────────────────────────────────────────────────
// Slot expired → order moved to late_pickup automatically.
// Worker needs to move the food from the physical bin to the late pickup counter,
// then enter OTP when the student arrives.
function LatePickupList({ orders, session, onUpdated }: { orders: WorkerOrder[]; session: { access_token: string } | null; onUpdated: () => void | Promise<void> }) {
  if (orders.length === 0) return null;
  return (
    <div style={{ marginTop: "1.25rem" }}>
      <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "#b91c1c", letterSpacing: "0.05em", margin: "0 0 0.6rem 0.25rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
        <span style={{ background: "#fee2e2", color: "#b91c1c", border: "1.5px solid #fca5a5", borderRadius: 6, padding: "0.1rem 0.5rem" }}>🔴 LATE PICKUP ({orders.length})</span>
        <span style={{ fontWeight: 500, fontSize: "0.72rem", color: "#64748b" }}>Move food from bin → late pickup counter, then enter OTP</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        {orders.map(o => (
          <LatePickupRow key={o.id} order={o} session={session} onDone={onUpdated} />
        ))}
      </div>
    </div>
  );
}

function LatePickupRow({ order, session, onDone }: { order: WorkerOrder; session: { access_token: string } | null; onDone: () => void | Promise<void> }) {
  const [otp, setOtp]         = useState("");
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  const binCode  = order.binLabel ?? order.bin_code ?? null;
  const colorKey = order.binColor ?? order.bin_color ?? "orange";
  const binBg    = BIN_COLORS[colorKey] ?? "#f97316";
  const slotText = order.pickupSlot ?? order.pickup_slot ?? order.slotLabel ?? "—";

  async function verifyOtp() {
    if (!session || otp.length < 4) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/orders/${order.id}/verify-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ otp }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Verification failed");
      setOtp("");
      await onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally { setBusy(false); }
  }

  async function verifyQr(payload: string) {
    setScanning(false);
    if (!session) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/orders/${order.id}/verify-qr`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ qrPayload: payload }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "QR verification failed");
      await onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "QR scan failed");
    } finally { setBusy(false); }
  }

  return (
    <>
      {scanning && <QRScanner onScanned={verifyQr} onClose={() => setScanning(false)} onManualOtp={() => setScanning(false)} />}
      <div style={{ background: "#fff", borderRadius: 14, overflow: "hidden", border: "2px solid #dc2626", boxShadow: "0 4px 14px rgba(220,38,38,0.18)" }}>
        {/* Header — red strip with bin + slot */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.65rem", padding: "0.6rem 0.75rem", background: "#dc2626" }}>
          {binCode && (
            <div style={{ background: binBg, color: "#fff", border: "2px solid rgba(255,255,255,0.5)", borderRadius: 8, padding: "0.2rem 0.65rem", fontSize: "0.82rem", fontWeight: 900 }}>{binCode}</div>
          )}
          <span style={{ color: "#fff", fontWeight: 600, fontSize: "0.75rem", flex: 1 }}>
            #{order.id.slice(-8).toUpperCase()} · {slotText}
          </span>
          <span style={{ background: "rgba(255,255,255,0.2)", color: "#fff", borderRadius: 999, padding: "0.15rem 0.5rem", fontSize: "0.68rem", fontWeight: 700 }}>LATE</span>
        </div>

        {/* Worker action instruction */}
        <div style={{ margin: "0.65rem 0.75rem 0.35rem", background: "#fef2f2", border: "1.5px solid #fca5a5", borderRadius: 10, padding: "0.55rem 0.7rem", display: "flex", alignItems: "flex-start", gap: "0.5rem" }}>
          <span style={{ fontSize: "1.2rem" }}>⚠️</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: "0.82rem", color: "#991b1b" }}>
              {binCode ? `Move food from ${binCode} to the late pickup counter` : "Move food to the late pickup counter"}
            </div>
            <div style={{ fontSize: "0.73rem", color: "#b91c1c", marginTop: "0.15rem" }}>
              Then scan the student&apos;s QR code when they arrive
            </div>
          </div>
        </div>

        {/* Items */}
        <div style={{ padding: "0.3rem 0.75rem 0.45rem", fontSize: "0.82rem", color: "#475569" }}>
          {order.items.map((i, idx) => `${i.name} ×${i.quantity}${idx < order.items.length - 1 ? " · " : ""}`)}
        </div>

        {/* Primary: QR scan */}
        <div style={{ padding: "0 0.75rem 0.75rem" }}>
          <button
            onClick={() => { setScanning(true); setError(null); }}
            disabled={busy}
            style={{ width: "100%", padding: "0.65rem", background: "#dc2626", color: "#fff", border: "none", borderRadius: 10, fontWeight: 800, fontSize: "0.9rem", cursor: "pointer", marginBottom: "0.5rem", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.4rem" }}
          >
            📷 Scan QR Code
          </button>
          {/* Fallback OTP */}
          <div style={{ fontSize: "0.7rem", color: "#94a3b8", textAlign: "center", margin: "0.3rem 0" }}>or enter backup OTP</div>
          <div style={{ display: "flex", gap: "0.4rem" }}>
            <input
              type="text" inputMode="numeric" maxLength={6} value={otp}
              onChange={e => { setOtp(e.target.value.replace(/\D/g, "")); setError(null); }}
              placeholder="Enter OTP"
              style={{ flex: 1, padding: "0.6rem 0.75rem", fontSize: "1.05rem", letterSpacing: "0.25rem", fontWeight: 700, textAlign: "center" as const, border: "1.5px solid #fca5a5", borderRadius: 10 }}
            />
            <button
              onClick={verifyOtp} disabled={busy || otp.length < 4}
              style={{ padding: "0 1rem", background: otp.length < 4 ? "#e5e7eb" : "#22c55e", color: otp.length < 4 ? "#94a3b8" : "#fff", border: "none", borderRadius: 10, fontWeight: 800, fontSize: "0.85rem", cursor: otp.length < 4 ? "default" : "pointer" }}
            >
              {busy ? "…" : "Verify"}
            </button>
          </div>
          {error && <div style={{ fontSize: "0.75rem", color: "#dc2626", marginTop: "0.4rem" }}>{error}</div>}
        </div>
      </div>
    </>
  );
}

// ─── BINS TAB ─────────────────────────────────────────────────────────────────
function BinsTab({ session }: { session: { access_token: string } | null }) {
  const [bins, setBins]         = useState<BinDetail[]>([]);
  const [fetching, setFetching] = useState(true);
  const [selected, setSelected] = useState<BinDetail | null>(null);
  const [msg, setMsg]           = useState<string | null>(null);
  const [busy, setBusy]         = useState(false);
  const [showOtp, setShowOtp]   = useState(false);
  const [otp, setOtp]           = useState("");

  const fetchBins = useCallback(async () => {
    if (!session) return;
    try {
      const res  = await fetch("/api/bins", { headers: { Authorization: `Bearer ${session.access_token}` } });
      const data = await res.json();
      setBins(data.bins ?? []);
    } catch { /* ignore */ }
    finally { setFetching(false); }
  }, [session]);

  useEffect(() => { fetchBins(); const iv = setInterval(fetchBins, 5000); return () => clearInterval(iv); }, [fetchBins]);

  async function handleMarkPicked(bin: BinDetail) {
    if (!session) return;
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(`/api/bins/${bin.id}/mark-picked`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setMsg("✅ Bin marked empty"); setSelected(null);
      setBins(prev => prev.map(b => b.id === bin.id ? { ...b, status: "empty" as const, order_count: 0 } : b));
    } catch (e) { setMsg(`❌ ${e instanceof Error ? e.message : "Error"}`); }
    finally { setBusy(false); }
  }

  async function handleVerifyOtp(bin: BinDetail) {
    if (!session || otp.length < 4) return;
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(`/api/bins/${bin.id}/verify-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ otp }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "OTP failed");
      setMsg("✅ OTP verified — collected!"); setOtp(""); setShowOtp(false); setSelected(null);
      setBins(prev => prev.map(b => b.id === bin.id ? { ...b, status: "empty" as const, order_count: 0 } : b));
    } catch (e) { setMsg(`❌ ${e instanceof Error ? e.message : "Error"}`); }
    finally { setBusy(false); }
  }

  if (fetching) return <LoadingState label="Loading bins…" />;

  return (
    <div style={{ padding: "1rem" }}>
      <h3 style={{ fontSize: "0.78rem", fontWeight: 700, color: "#64748b", marginBottom: "0.75rem", letterSpacing: "0.05em" }}>BINS ({bins.length})</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.65rem" }}>
        {bins.map(bin => {
          const isOccupied = bin.status !== "empty";
          const isOverdue  = ["overdue", "grace_expired", "late_pickup"].includes(bin.status);
          const bg = isOccupied ? (isOverdue ? "#ef4444" : (BIN_COLORS[bin.color] ?? "#f97316")) : "#e5e7eb";
          return (
            <button key={bin.id} onClick={() => { if (isOccupied) { setSelected(bin); setMsg(null); setOtp(""); setShowOtp(false); } }} style={{ background: bg, borderRadius: 14, padding: "0.85rem 0.5rem", textAlign: "center" as const, border: isOverdue ? "2px solid #fca5a5" : "none", cursor: isOccupied ? "pointer" : "default", opacity: isOccupied ? 1 : 0.45, boxShadow: isOccupied ? `0 3px 10px ${bg}40` : "none" }}>
              <div style={{ color: isOccupied ? "#fff" : "#94a3b8", fontWeight: 900, fontSize: "1.75rem", lineHeight: 1 }}>{bin.bin_code}</div>
              {bin.order_count > 0 && <div style={{ color: "rgba(255,255,255,0.85)", fontSize: "0.65rem", marginTop: "0.2rem" }}>{bin.order_count}</div>}
            </button>
          );
        })}
      </div>
      {bins.length === 0 && <div style={{ textAlign: "center", color: "#94a3b8", padding: "3rem 0", fontSize: "0.88rem" }}>No bins found.</div>}

      {selected && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 50, padding: "1rem" }}>
          <div style={{ background: "#fff", borderRadius: 20, padding: "1.5rem", width: "100%", maxWidth: 420 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
              <h3 style={{ fontSize: "1.1rem", fontWeight: 800, margin: 0 }}>Bin {selected.bin_code}</h3>
              <button onClick={() => { setSelected(null); setMsg(null); }} style={{ background: "#f1f5f9", border: "none", borderRadius: 8, padding: "0.3rem 0.6rem", cursor: "pointer", fontSize: "0.78rem", color: "#64748b" }}>✕</button>
            </div>
            <p style={{ fontSize: "0.85rem", color: "#64748b", marginBottom: "1rem" }}>No. of items: <strong>{selected.order_count}</strong></p>
            {msg && <p style={{ fontSize: "0.82rem", color: msg.startsWith("✅") ? "#16a34a" : "#dc2626", marginBottom: "0.75rem", textAlign: "center" }}>{msg}</p>}
            {showOtp ? (
              <div>
                <input type="text" inputMode="numeric" maxLength={6} value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, ""))} placeholder="Enter OTP" style={{ width: "100%", padding: "0.85rem", fontSize: "1.5rem", textAlign: "center" as const, letterSpacing: "0.3rem", fontWeight: 700, border: "2px solid #e2e8f0", borderRadius: 12, marginBottom: "0.75rem", boxSizing: "border-box" as const }} />
                <button onClick={() => handleVerifyOtp(selected)} disabled={busy || otp.length < 4} style={{ width: "100%", padding: "0.85rem", background: "#1e293b", color: "#fff", border: "none", borderRadius: 12, fontWeight: 700, cursor: "pointer", marginBottom: "0.5rem" }}>{busy ? "Verifying…" : "Verify OTP"}</button>
                <button onClick={() => setShowOtp(false)} style={{ width: "100%", padding: "0.5rem", background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: "0.85rem" }}>Back</button>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                <button onClick={() => handleMarkPicked(selected)} disabled={busy} style={{ width: "100%", padding: "0.85rem", background: "#22c55e", color: "#fff", border: "none", borderRadius: 12, fontWeight: 700, cursor: busy ? "not-allowed" : "pointer", boxShadow: "0 4px 12px rgba(34,197,94,0.3)" }}>{busy ? "Processing…" : "Picked ✓"}</button>
                <button onClick={() => { setShowOtp(true); setMsg(null); }} style={{ width: "100%", padding: "0.75rem", background: "#f1f5f9", border: "none", borderRadius: 12, fontWeight: 600, fontSize: "0.88rem", cursor: "pointer", color: "#475569" }}>Verify OTP (optional)</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── PREP SUMMARY TAB ─────────────────────────────────────────────────────────
function PrepTab({ session }: { session: { access_token: string } | null }) {
  const [slots, setSlots]       = useState<PrepSlot[]>([]);
  const [activeSlot, setActive] = useState<string | null>(null);
  const [fetching, setFetching] = useState(true);

  const fetchPrep = useCallback(async () => {
    if (!session) return;
    try {
      const res = await fetch("/api/canteen/prep-summary", { headers: { Authorization: `Bearer ${session.access_token}` } });
      const data = await res.json();
      const result: PrepSlot[] = (data.slots ?? []).map((s: any) => {
        const combined = [...(s.batched ?? []), ...(s.made_to_order ?? [])];
        return { slot: s.slot, startTime: s.start_time ?? null, items: combined.sort((a: any, b: any) => b.quantity - a.quantity) };
      });
      setSlots(result);
      // Always auto-select the right slot based on current time
      const auto = pickAutoSlot(result);
      if (auto) setActive(auto);
    } catch { /* ignore */ }
    finally { setFetching(false); }
  }, [session]);

  // Refresh data every 30s
  useEffect(() => { fetchPrep(); const iv = setInterval(fetchPrep, 30_000); return () => clearInterval(iv); }, [fetchPrep]);

  // Re-evaluate which slot to show every minute (auto-switches at 15-min mark without data refresh)
  useEffect(() => {
    const tick = setInterval(() => {
      setSlots(prev => {
        const auto = pickAutoSlot(prev);
        if (auto) setActive(auto);
        return prev;
      });
    }, 60_000);
    return () => clearInterval(tick);
  }, []);

  if (fetching) return <LoadingState label="Loading prep summary…" />;

  const now = new Date();
  const nowMins = now.getHours() * 60 + now.getMinutes();
  const isNextSlot = (s: PrepSlot): boolean => {
    const start = slotStartMins(s);
    if (start === null) return false;
    const diff = start - nowMins;
    return diff > 0 && diff <= 15;
  };

  const current = slots.find(s => s.slot === activeSlot);

  return (
    <div style={{ padding: "1rem" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.75rem" }}>
        <h2 style={{ fontSize: "1rem", fontWeight: 800, margin: 0 }}>Prep Summary</h2>
        <span style={{ fontSize: "0.72rem", color: "#94a3b8" }}>Auto-updates every 30s</span>
      </div>

      {/* Next-slot alert banner */}
      {current && isNextSlot(current) && (
        <div style={{ background: "#fff7ed", border: "1.5px solid #f97316", borderRadius: 10, padding: "0.5rem 0.75rem", marginBottom: "0.75rem", fontSize: "0.8rem", color: "#c2410c", fontWeight: 600 }}>
          ⏰ Start preparing — <strong>{current.slot}</strong> slot begins in {Math.round(((slotStartMins(current) ?? nowMins) - nowMins))} min
        </div>
      )}

      {slots.length > 0 && (
        <div style={{ display: "flex", gap: "0.5rem", overflowX: "auto", marginBottom: "1rem", paddingBottom: "0.25rem" }}>
          {slots.map(s => (
            <button key={s.slot} onClick={() => setActive(s.slot)} style={{ flexShrink: 0, padding: "0.4rem 0.85rem", borderRadius: 20, border: "none", background: activeSlot === s.slot ? "#f97316" : "#e2e8f0", color: activeSlot === s.slot ? "#fff" : "#64748b", fontWeight: 600, fontSize: "0.78rem", cursor: "pointer" }}>
              {isNextSlot(s) ? "🔜 " : ""}{s.slot}
            </button>
          ))}
        </div>
      )}

      {current ? (
        <div style={{ background: "#fff", borderRadius: 16, boxShadow: "0 2px 8px rgba(0,0,0,0.08)", overflow: "hidden" }}>
          <div style={{ background: "#f97316", padding: "0.75rem 1rem" }}>
            <div style={{ color: "#fff", fontWeight: 700, fontSize: "0.9rem" }}>Slot: {current.slot}</div>
            <div style={{ color: "rgba(255,255,255,0.8)", fontSize: "0.75rem" }}>Total: {current.items.reduce((s, i) => s + i.quantity, 0)} items to prepare</div>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr style={{ background: "#f8fafc" }}>
              <th style={{ padding: "0.65rem 1rem", textAlign: "left", fontSize: "0.75rem", fontWeight: 700, color: "#64748b", borderBottom: "1px solid #e2e8f0" }}>ITEM</th>
              <th style={{ padding: "0.65rem 1rem", textAlign: "right", fontSize: "0.75rem", fontWeight: 700, color: "#64748b", borderBottom: "1px solid #e2e8f0" }}>QTY</th>
            </tr></thead>
            <tbody>{current.items.map((item, i) => (
              <tr key={i} style={{ borderBottom: i < current.items.length - 1 ? "1px solid #f1f5f9" : "none" }}>
                <td style={{ padding: "0.75rem 1rem", fontSize: "0.9rem", fontWeight: 600 }}>{item.name}</td>
                <td style={{ padding: "0.75rem 1rem", textAlign: "right", fontWeight: 800, fontSize: "1rem", color: "#f97316" }}>{item.quantity}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : (
        <div style={{ textAlign: "center", color: "#94a3b8", padding: "3rem 0", fontSize: "0.88rem" }}>
          <div style={{ fontSize: "2.5rem", marginBottom: "0.5rem" }}>📊</div>
          No active orders to summarize.
        </div>
      )}
    </div>
  );
}

function LoadingState({ label }: { label: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "4rem 1rem", gap: "0.75rem" }}>
      <div className="spinner" style={{ borderTopColor: "#f97316", width: 32, height: 32, borderWidth: 3 }} />
      <span style={{ fontSize: "0.82rem", color: "#94a3b8" }}>{label}</span>
    </div>
  );
}


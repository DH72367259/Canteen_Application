"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

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
  items: OrderItem[];
  createdAt?: string;
  // legacy snake_case aliases (from old bins API, kept for fallback)
  bin_code?: string; bin_color?: string; bin_number?: number; bin_id?: string;
  pickup_slot?: string; created_at?: string;
}
interface BinDetail {
  id: string; bin_code: string | number; color: string;
  status: "empty" | "occupied" | "overdue" | "grace_expired" | "late_pickup";
  order_count: number;
}
interface PrepItem { name: string; quantity: number }
interface PrepSlot { slot: string; items: PrepItem[] }

const BIN_COLORS: Record<string, string> = {
  red: "#ef4444", blue: "#3b82f6", green: "#22c55e",
  yellow: "#eab308", purple: "#a855f7", orange: "#f97316",
};

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function WorkerApp() {
  const router = useRouter();
  const { user, session, loading, logout } = useAuth();
  const [tab, setTab] = useState<"orders" | "bins" | "prep">("orders");

  useEffect(() => {
    if (!loading && !user) router.replace("/worker/login");
    if (!loading && user && user.role !== "worker") router.replace("/");
  }, [user, loading, router]);

  if (loading || !user || user.role !== "worker") {
    return <div style={{ minHeight: "100vh", background: "#1e293b", display: "flex", alignItems: "center", justifyContent: "center" }}><div className="spinner" style={{ borderTopColor: "#f97316" }} /></div>;
  }

  return (
    <div style={{ minHeight: "100vh", background: "#f1f5f9", display: "flex", flexDirection: "column" }}>
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
    <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "#fff", borderTop: "1px solid #e2e8f0", display: "flex", zIndex: 30, boxShadow: "0 -4px 12px rgba(0,0,0,0.08)" }}>
      {items.map(item => (
        <button key={item.id} onClick={() => onChange(item.id)} style={{ flex: 1, padding: "0.65rem 0.25rem 0.5rem", background: "none", border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: "0.2rem", color: tab === item.id ? "#f97316" : "#94a3b8", fontWeight: tab === item.id ? 700 : 500, fontSize: "0.68rem" }}>
          <span style={{ fontSize: "1.3rem" }}>{item.icon}</span>{item.label}
        </button>
      ))}
    </div>
  );
}

// ─── ORDERS TAB ───────────────────────────────────────────────────────────────
function OrdersTab({ session }: { session: { access_token: string } | null }) {
  const [currentOrder, setCurrent]    = useState<WorkerOrder | null>(null);
  const [latePickup, setLatePickup]   = useState<WorkerOrder | null>(null);
  const [prepSlot, setPrepSlot]       = useState<string | null>(null);
  const [remaining, setRemaining]     = useState(0);
  const [updating, setUpdating]       = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [fetching, setFetching]       = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchOrders = useCallback(async () => {
    if (!session) return;
    try {
      const res = await fetch("/api/orders?worker=true", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = await res.json();
      const all: WorkerOrder[] = data.orders ?? [];
      const slotLabel = computePrepSlot(new Date());
      setPrepSlot(slotLabel);
      const isLate = (o: WorkerOrder) => {
        const st = o.rawStatus ?? o.status;
        return st === "placed_in_bin" || st === "ready_for_pickup";
      };
      const late = all.find(o => isLate(o));
      setLatePickup(late ?? null);
      const ACTIVE = ["confirmed", "preparing", "ready_for_placement"];
      const pending = all
        .filter(o => ACTIVE.includes(o.rawStatus ?? o.status))
        .sort((a, b) => new Date(a.createdAt ?? a.created_at ?? 0).getTime() - new Date(b.createdAt ?? b.created_at ?? 0).getTime());
      setCurrent(pending[0] ?? null);
      setRemaining(pending.length);
    } catch { /* retry */ }
    finally { setFetching(false); }
  }, [session]);

  useEffect(() => {
    fetchOrders();
    pollRef.current = setInterval(fetchOrders, 15000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchOrders]);

  async function updateStatus(orderId: string, status: string) {
    if (!session) return;
    setUpdating(true);
    try {
      await fetch(`/api/orders/${orderId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ status }),
      });
      await fetchOrders();
    } finally { setUpdating(false); }
  }

  if (fetching) return <LoadingState label="Loading orders…" />;

  if (latePickup) {
    const colorKey = latePickup.binColor ?? latePickup.bin_color ?? "orange";
    const binColor = BIN_COLORS[colorKey] ?? "#f97316";
    const binCode = latePickup.binLabel ?? latePickup.bin_code ?? latePickup.bin_number ?? "?";
    return (
      <div style={{ padding: "1rem" }}>
        <SlotBanner label="⚠️ Late Pickup — Action Required" color="#ef4444" bg="#fef2f2" />
        <OrderCard order={latePickup} binColor={binColor} binCode={binCode} footer={
          <div style={{ padding: "0 0.75rem 0.75rem" }}>
            <div style={{ fontSize: "0.8rem", color: "#64748b", marginBottom: "0.5rem", textAlign: "center" }}>Collect Item from Bin {binCode}</div>
            <button onClick={() => updateStatus(latePickup.id, "grace_bin")} disabled={updating} style={{ width: "100%", background: "#ef4444", color: "#fff", border: "none", borderRadius: 12, padding: "0.85rem", fontWeight: 700, cursor: "pointer", boxShadow: "0 4px 12px rgba(239,68,68,0.3)" }}>
              {updating ? "Processing…" : "Removed (bin → grace bin)"}
            </button>
          </div>
        } />
      </div>
    );
  }

  if (!currentOrder) {
    return (
      <div style={{ padding: "1rem" }}>
        {prepSlot && <SlotBanner label={`Now Prepare ${prepSlot}`} />}
        <div style={{ textAlign: "center", padding: "4rem 1rem", color: "#64748b" }}>
          <div style={{ fontSize: "3rem", marginBottom: "0.75rem" }}>✅</div>
          <div style={{ fontWeight: 700, fontSize: "1rem" }}>All orders prepared!</div>
          <div style={{ fontSize: "0.82rem", marginTop: "0.35rem" }}>Next orders will appear automatically.</div>
        </div>
      </div>
    );
  }

  const colorKey = currentOrder.binColor ?? currentOrder.bin_color ?? "orange";
  const binColor  = BIN_COLORS[colorKey] ?? "#f97316";
  const binCode   = currentOrder.binLabel ?? currentOrder.bin_code ?? currentOrder.bin_number ?? "?";
  const isReady   = (currentOrder.rawStatus ?? currentOrder.status) === "ready_for_placement";

  return (
    <div style={{ padding: "1rem" }}>
      {prepSlot && <SlotBanner label={`Now Prepare ${prepSlot}`} />}
      <div style={{ fontSize: "0.8rem", color: "#64748b", fontWeight: 600, marginBottom: "0.5rem" }}>
        Orders remaining: <strong style={{ color: "#1e293b" }}>{remaining}</strong>
      </div>
      <OrderCard order={currentOrder} binColor={binColor} binCode={binCode} footer={
        <div style={{ padding: "0 0.75rem 0.75rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {!isReady && (
            <button onClick={() => updateStatus(currentOrder.id, "preparing")} disabled={updating} style={{ background: "#ef4444", color: "#fff", border: "none", borderRadius: 12, padding: "0.8rem", fontWeight: 700, cursor: updating ? "not-allowed" : "pointer", opacity: updating ? 0.6 : 1 }}>
              To Prepare → Next order
            </button>
          )}
          {!isReady && (
            <button onClick={() => updateStatus(currentOrder.id, "ready_for_placement")} disabled={updating} style={{ background: "#eab308", color: "#fff", border: "none", borderRadius: 12, padding: "0.8rem", fontWeight: 700, cursor: updating ? "not-allowed" : "pointer", opacity: updating ? 0.6 : 1 }}>
              Ready to Place
            </button>
          )}
          {isReady && (
            <button onClick={() => setShowConfirm(true)} disabled={updating} style={{ background: "#22c55e", color: "#fff", border: "none", borderRadius: 12, padding: "0.9rem", fontWeight: 800, fontSize: "1rem", cursor: "pointer", boxShadow: "0 4px 12px rgba(34,197,94,0.35)" }}>
              {updating ? "Updating…" : "Placed (double verify)"}
            </button>
          )}
        </div>
      } />

      {showConfirm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50, padding: "1.5rem" }}>
          <div style={{ background: "#fff", borderRadius: 20, padding: "1.75rem 1.5rem", maxWidth: 340, width: "100%", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
            <div style={{ textAlign: "center", marginBottom: "1.25rem" }}>
              <div style={{ fontSize: "2.5rem", marginBottom: "0.5rem" }}>✅</div>
              <h3 style={{ fontSize: "1.1rem", fontWeight: 800, margin: "0 0 0.35rem" }}>Confirm Placement</h3>
              <p style={{ fontSize: "0.88rem", color: "#64748b", margin: 0 }}>Confirm food placed in <strong>Bin {binCode}</strong>?</p>
            </div>
            <button onClick={() => { setShowConfirm(false); updateStatus(currentOrder.id, "placed_in_bin"); }} style={{ width: "100%", padding: "0.85rem", background: "#22c55e", color: "#fff", border: "none", borderRadius: 12, fontWeight: 700, fontSize: "1rem", cursor: "pointer", marginBottom: "0.5rem" }}>
              Yes, Placed in Bin {binCode}
            </button>
            <button onClick={() => setShowConfirm(false)} style={{ width: "100%", padding: "0.65rem", background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: "0.88rem" }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

function computePrepSlot(now: Date): string {
  const h = now.getHours(), m = now.getMinutes();
  const totalMin = h * 60 + m + 15;
  const slotStart = Math.floor(totalMin / 15) * 15;
  const slotEnd   = slotStart + 15;
  const fmt = (mins: number) => {
    const hh = Math.floor(mins / 60) % 24, mm = mins % 60;
    const ampm = hh >= 12 ? "pm" : "am";
    return `${hh > 12 ? hh - 12 : hh || 12}:${String(mm).padStart(2, "0")}${ampm}`;
  };
  return `${fmt(slotStart)} to ${fmt(slotEnd)}`;
}

function SlotBanner({ label, color = "#f97316", bg = "#fff7ed" }: { label: string; color?: string; bg?: string }) {
  return (
    <div style={{ background: bg, border: `1.5px solid ${color}30`, borderRadius: 10, padding: "0.55rem 0.85rem", marginBottom: "0.75rem", fontSize: "0.82rem", fontWeight: 700, color }}>
      {label}
    </div>
  );
}

function OrderCard({ order, binColor, binCode, footer }: { order: WorkerOrder; binColor: string; binCode: string | number; footer: React.ReactNode }) {
  return (
    <div style={{ background: "#fff", borderRadius: 18, boxShadow: "0 4px 16px rgba(0,0,0,0.1)", overflow: "hidden", marginBottom: "1rem" }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "1.25rem 1rem 0.75rem" }}>
        <div style={{ width: 80, height: 80, borderRadius: 18, background: binColor, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 900, fontSize: "2.5rem", boxShadow: `0 6px 20px ${binColor}50` }}>
          {binCode}
        </div>
        {(order.binLabel ?? order.bin_code) && <div style={{ fontSize: "0.72rem", color: "#94a3b8", marginTop: "0.3rem", letterSpacing: "0.08em" }}>#{String(order.binLabel ?? order.bin_code ?? "").toUpperCase()}</div>}
      </div>
      <div style={{ background: "#fef9ef", margin: "0 0.75rem 0.75rem", borderRadius: 12, border: "1px solid #fde68a", padding: "0.5rem 0.75rem" }}>
        {order.items.map((item, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.4rem 0", borderBottom: i < order.items.length - 1 ? "1px solid #fde68a" : "none" }}>
            <div style={{ width: 36, height: 36, borderRadius: 8, background: "#e5e7eb", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "1.1rem", flexShrink: 0 }}>🍽️</div>
            <span style={{ flex: 1, fontWeight: 600, fontSize: "0.95rem" }}>{item.name}</span>
            <span style={{ fontWeight: 800, fontSize: "1rem", color: "#1e293b" }}>×{item.quantity}</span>
          </div>
        ))}
      </div>
      {footer}
    </div>
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

  useEffect(() => { fetchBins(); const iv = setInterval(fetchBins, 15000); return () => clearInterval(iv); }, [fetchBins]);

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
      const res  = await fetch("/api/orders?worker=true", { headers: { Authorization: `Bearer ${session.access_token}` } });
      const data = await res.json();
      const orders: WorkerOrder[] = data.orders ?? [];
      const slotMap: Record<string, Record<string, number>> = {};
      for (const order of orders) {
        if (!["confirmed", "preparing", "ready_for_placement"].includes(order.rawStatus ?? order.status)) continue;
        const k = order.pickupSlot ?? order.pickup_slot ?? "Unknown";
        if (!slotMap[k]) slotMap[k] = {};
        for (const item of order.items) slotMap[k][item.name] = (slotMap[k][item.name] ?? 0) + item.quantity;
      }
      const result: PrepSlot[] = Object.entries(slotMap).map(([slot, itemMap]) => ({ slot, items: Object.entries(itemMap).map(([name, quantity]) => ({ name, quantity })).sort((a, b) => b.quantity - a.quantity) }));
      setSlots(result);
      if (!activeSlot && result.length) setActive(result[0].slot);
    } catch { /* ignore */ }
    finally { setFetching(false); }
  }, [session, activeSlot]);

  useEffect(() => { fetchPrep(); const iv = setInterval(fetchPrep, 30000); return () => clearInterval(iv); }, [fetchPrep]);

  if (fetching) return <LoadingState label="Loading prep summary…" />;
  const current = slots.find(s => s.slot === activeSlot);

  return (
    <div style={{ padding: "1rem" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
        <h2 style={{ fontSize: "1rem", fontWeight: 800, margin: 0 }}>Prep Summary</h2>
        <button onClick={fetchPrep} style={{ background: "#f1f5f9", border: "none", borderRadius: 8, padding: "0.35rem 0.7rem", cursor: "pointer", fontSize: "0.75rem", color: "#64748b", fontWeight: 600 }}>↻ Refresh</button>
      </div>
      {slots.length > 0 && (
        <div style={{ display: "flex", gap: "0.5rem", overflowX: "auto", marginBottom: "1rem", paddingBottom: "0.25rem" }}>
          {slots.map(s => (
            <button key={s.slot} onClick={() => setActive(s.slot)} style={{ flexShrink: 0, padding: "0.4rem 0.85rem", borderRadius: 20, border: "none", background: activeSlot === s.slot ? "#f97316" : "#e2e8f0", color: activeSlot === s.slot ? "#fff" : "#64748b", fontWeight: 600, fontSize: "0.78rem", cursor: "pointer" }}>{s.slot}</button>
          ))}
        </div>
      )}
      {current ? (
        <div style={{ background: "#fff", borderRadius: 16, boxShadow: "0 2px 8px rgba(0,0,0,0.08)", overflow: "hidden" }}>
          <div style={{ background: "#f97316", padding: "0.75rem 1rem" }}>
            <div style={{ color: "#fff", fontWeight: 700, fontSize: "0.9rem" }}>Slot: {current.slot}</div>
            <div style={{ color: "rgba(255,255,255,0.8)", fontSize: "0.75rem" }}>Total: {current.items.reduce((s, i) => s + i.quantity, 0)} items</div>
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


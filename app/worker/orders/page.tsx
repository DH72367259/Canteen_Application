"use client";

import { useEffect, useRef, useState } from "react";
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

const ACTIVE_STATUSES = ["placed", "confirmed", "preparing", "ready_for_placement", "placed_in_bin", "ready_for_pickup", "late_pickup"];

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

// Orders tab: show current slot or slots starting within the next 60 min.
function isOrderRelevant(slotLabel: string | null | undefined): boolean {
  if (!slotLabel) return true;
  const range = parseSlotRange(slotLabel);
  if (!range) return true;
  const now = getNowISTMin();
  const isCurrent  = range.startMin <= now && range.endMin > now;
  const isUpcoming = range.startMin > now && range.startMin <= now + 60;
  return isCurrent || isUpcoming;
}

// Late Pickup tab: slot has ended but student hasn't collected yet.
function isLatePickup(slotLabel: string | null | undefined): boolean {
  if (!slotLabel) return false;
  const range = parseSlotRange(slotLabel);
  if (!range) return false;
  return range.endMin <= getNowISTMin();
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
    // Sort by actual start time (numeric), NOT alphabetically — "1:00 PM" must come before "12:00 PM"
    .sort((a, b) => {
      const aMin = parseSlotRange(a.slot)?.startMin ?? 9999;
      const bMin = parseSlotRange(b.slot)?.startMin ?? 9999;
      return aMin - bMin;
    });
}

// Pick which prep slot to show: prefer the NEXT slot starting within 15 min
// (so workers start preparing early) over the currently active slot.
function pickBestPrepSlot(summaries: SlotAggregate[]): SlotAggregate | null {
  if (!summaries.length) return null;
  const now = getNowISTMin();
  // Priority 1 — upcoming slot starting within 15 min
  const upcoming = summaries.find(s => {
    const r = parseSlotRange(s.slot);
    return r ? r.startMin > now && r.startMin <= now + 15 : false;
  });
  if (upcoming) return upcoming;
  // Priority 2 — currently active slot (started, not yet ended)
  const active = summaries.find(s => {
    const r = parseSlotRange(s.slot);
    return r ? r.startMin <= now && r.endMin > now : false;
  });
  return active ?? summaries[0];
}

export default function WorkerOrdersPage() {
  const router = useRouter();
  const { user, session, loading, logout } = useAuth();
  const [orders, setOrders]         = useState<WorkerOrder[]>([]);
  const [fetching, setFetching]     = useState(true);
  const [updating, setUpdating]     = useState<string | null>(null);
  const [activeSlot, setActiveSlot] = useState<string>("__all__");
  const [tab, setTab]               = useState<"orders" | "prep" | "late">("orders");
  const [otpModal, setOtpModal]     = useState<string | null>(null);
  const [otpInput, setOtpInput]     = useState("");
  const [otpSubmitting, setOtpSubmitting] = useState(false);
  const [modalMode, setModalMode]   = useState<"otp" | "qr">("otp");
  const [qrError, setQrError]       = useState<string | null>(null);
  const [qrRetryKey, setQrRetryKey] = useState(0);
  const qrInstanceRef               = useRef<{ stop: () => Promise<void>; clear: () => void } | null>(null);
  // Late-pickup auto-switch: tracks whether the current late-tab session was
  // triggered by the banner (vs a manual tab click). The 45s auto-return only
  // runs for banner-triggered switches.
  const [autoReturnSecsLeft, setAutoReturnSecsLeft] = useState<number | null>(null);
  const autoReturnTimerRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const isAutoSwitchedRef   = useRef(false);
  const prevLateCountRef    = useRef(0);

  useEffect(() => {
    if (!loading && !user) router.push("/login");
    // Only redirect if role is fully resolved — prevents flicker during auth
    if (!loading && user && user.role && user.role !== "worker") router.push("/worker/login");
  }, [user, loading, router]);

  // ── Late-pickup auto-switch helpers ──────────────────────────────────────
  function clearAutoReturn() {
    if (autoReturnTimerRef.current) {
      clearInterval(autoReturnTimerRef.current);
      autoReturnTimerRef.current = null;
    }
    setAutoReturnSecsLeft(null);
    isAutoSwitchedRef.current = false;
  }

  function startAutoReturn(secs = 45) {
    clearAutoReturn();
    isAutoSwitchedRef.current = true;
    setAutoReturnSecsLeft(secs);
    let remaining = secs;
    autoReturnTimerRef.current = setInterval(() => {
      remaining -= 1;
      setAutoReturnSecsLeft(remaining);
      if (remaining <= 0) {
        clearAutoReturn();
        setTab("orders");
      }
    }, 1000);
  }

  function switchToLateBanner() {
    setTab("late");
    startAutoReturn(45);
  }

  function switchBackManually() {
    clearAutoReturn();
    setTab("orders");
  }

  // Cleanup on unmount
  useEffect(() => () => clearAutoReturn(), []);

  // Auto-switch: watch the orders state directly (can't reference computed `lateOrders`
  // because it's declared after the early-return guard which must follow all hooks).
  // When late orders first appear while on the orders tab, auto-switch + start countdown.
  useEffect(() => {
    const count = orders.filter(
      (o) => o.status === "late_pickup" ||
             (isLatePickup(o.pickup_slot) && ["placed_in_bin", "ready_for_pickup", "confirmed", "preparing"].includes(o.status))
    ).length;
    const prev = prevLateCountRef.current;
    prevLateCountRef.current = count;

    if (count > 0 && prev === 0 && tab === "orders") {
      // Late orders just appeared — auto-switch and start the 45s countdown
      switchToLateBanner();
    } else if (count === 0) {
      // All resolved — cancel any running countdown so it doesn't fire later
      clearAutoReturn();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, tab]);

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
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Verification failed");
      setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, status: "collected" } : o)));
      setOtpModal(null);
      setOtpInput("");
    } catch (e) {
      alert(e instanceof Error ? e.message : "Error verifying OTP");
    } finally { setOtpSubmitting(false); }
  }

  // Start QR camera scanner inside the modal when in QR mode.
  // qrRetryKey increments on "Try Again" to force a fresh camera start.
  useEffect(() => {
    if (!otpModal || modalMode !== "qr" || !session) return;
    let cancelled = false;

    async function startQr() {
      // Stop & clear any previous instance before creating a new one
      const prev = qrInstanceRef.current;
      if (prev) {
        try { await prev.stop(); prev.clear(); } catch { /* ignore */ }
        qrInstanceRef.current = null;
      }

      // Do NOT pre-check navigator.permissions — on Android Chrome it returns
      // "denied" for sites never visited, even when permission can still be granted.
      // Instead detect denial from the actual getUserMedia error below.
      const { Html5Qrcode } = await import("html5-qrcode");

      // Wait for the DOM element to appear (it may be freshly mounted after retry)
      let el: HTMLElement | null = null;
      for (let attempt = 0; attempt < 15; attempt++) {
        el = document.getElementById("modal-qr-reader");
        if (el) break;
        await new Promise(r => setTimeout(r, 50));
      }
      if (!el || cancelled) return;

      const qr = new Html5Qrcode("modal-qr-reader");
      qrInstanceRef.current = qr;

      const onDecoded = async (decodedText: string) => {
        if (cancelled) return;
        const parts = decodedText.split("|");
        if (parts.length !== 4 || parts[0] !== "NOQX") return;
        cancelled = true;
        try { await qr.stop(); qr.clear(); } catch { /* ignore */ }
        qrInstanceRef.current = null;
        setOtpSubmitting(true);
        try {
          const res = await fetch(`/api/orders/${otpModal}/verify-qr`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${session!.access_token}` },
            body: JSON.stringify({ qrPayload: decodedText }),
          });
          const data = await res.json() as { error?: string };
          if (!res.ok) throw new Error(data.error ?? "QR verification failed");
          setOrders((prev) => prev.map((o) => (o.id === otpModal ? { ...o, status: "collected" } : o)));
          setOtpModal(null);
          setOtpInput("");
          setModalMode("otp");
        } catch (e: unknown) {
          setQrError(e instanceof Error ? e.message : "QR verification failed");
        } finally {
          setOtpSubmitting(false);
        }
      };

      const config = { fps: 10, qrbox: { width: 200, height: 200 } };

      let started = false;

      const isPermDenied = (e: unknown) =>
        e instanceof Error && (e.name === "NotAllowedError" || /permission|denied|not allowed/i.test(e.message));

      // Strategy 1: enumerate real hardware camera IDs — triggers getUserMedia so
      // Chrome shows the permission dialog on first visit on any Android device.
      try {
        const cameras = await Html5Qrcode.getCameras();
        if (cameras.length > 0 && !cancelled) {
          const sorted = [
            ...cameras.filter(c => /back|rear|environment/i.test(c.label)),
            ...cameras.filter(c => !/back|rear|environment/i.test(c.label)),
          ];
          for (const cam of sorted) {
            if (cancelled) break;
            try {
              await qr.start(cam.id, config, onDecoded, () => {});
              started = true;
              break;
            } catch { continue; }
          }
        }
      } catch (e) {
        if (isPermDenied(e) && !cancelled) {
          setQrError("Camera permission blocked. In Chrome tap ⋮ → Site settings → Camera → Allow, then tap Try Again.");
          return;
        }
      }

      // Strategy 2: constraint-based fallback
      if (!started && !cancelled) {
        for (const c of [{ facingMode: { ideal: "environment" } }, {}] as MediaTrackConstraints[]) {
          if (cancelled) break;
          try {
            await qr.start(c, config, onDecoded, () => {});
            started = true;
            break;
          } catch (e) {
            if (isPermDenied(e) && !cancelled) {
              setQrError("Camera permission blocked. In Chrome tap ⋮ → Site settings → Camera → Allow, then tap Try Again.");
              return;
            }
          }
        }
      }

      if (!started && !cancelled) {
        setQrError("Camera unavailable. Allow camera access and tap Try Again.");
      }
    }

    void startQr();

    return () => {
      cancelled = true;
      const qr = qrInstanceRef.current;
      if (qr) {
        qr.stop().catch(() => {}).finally(() => { try { qr.clear(); } catch { /* ignore */ } });
        qrInstanceRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otpModal, modalMode, session, qrRetryKey]);

  function closeModal() {
    const qr = qrInstanceRef.current;
    if (qr) {
      qr.stop().catch(() => {}).finally(() => { try { qr.clear(); } catch { /* ignore */ } });
      qrInstanceRef.current = null;
    }
    setOtpModal(null);
    setOtpInput("");
    setModalMode("otp");
    setQrError(null);
  }

  // Orders tab: current slot + 60-min upcoming (never late_pickup — those go to Late tab)
  const relevantOrders = orders.filter((o) => o.status !== "late_pickup" && isOrderRelevant(o.pickup_slot));
  const slots = [...new Set(relevantOrders.map((o) => o.pickup_slot).filter((s): s is string => Boolean(s)))].sort();
  const displayedOrders = activeSlot === "__all__"
    ? relevantOrders
    : relevantOrders.filter((o) => o.pickup_slot === activeSlot);

  // Prep tab: only the immediately upcoming slot (15-min window, no past slots)
  const prepOrders = orders.filter((o) => isPrepRelevant(o.pickup_slot));
  const prepSummary = aggregateBySlot(prepOrders);
  const selectedSummary = pickBestPrepSlot(prepSummary);

  // Late Pickup tab: DB status is late_pickup, OR slot has ended with an active status
  // (the second arm catches orders that are transitioning before the next auto-update runs)
  const lateOrders = orders.filter(
    (o) => o.status === "late_pickup" ||
           (isLatePickup(o.pickup_slot) && ["placed_in_bin", "ready_for_pickup", "confirmed", "preparing"].includes(o.status))
  );

  if (loading || fetching) return <div className="page-loading"><div className="spinner" /></div>;

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      {/* Top bar */}
      <div style={{ background: "#1e293b", color: "#fff", padding: "0.75rem 1rem", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
          {tab !== "orders" && (
            <button
              onClick={switchBackManually}
              style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: "1.1rem", padding: "0 0.1rem", lineHeight: 1, display: "flex", alignItems: "center" }}
              aria-label="Back to Orders"
            >
              ←
            </button>
          )}
          <div style={{ fontWeight: 700, fontSize: "1rem" }}>
            {tab === "orders" ? "Orders" : tab === "prep" ? "Prep Plan" : "Late Pickup"}
          </div>
          {tab === "late" && autoReturnSecsLeft !== null && (
            <span style={{ fontSize: "0.7rem", color: "#94a3b8", marginLeft: "0.25rem" }}>
              (back in {autoReturnSecsLeft}s)
            </span>
          )}
        </div>
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

      {/* Late-pickup alert banner — shown on the orders tab when late orders exist.
          Tapping it manually switches to the Late Pickup tab and starts the 45s countdown. */}
      {tab === "orders" && lateOrders.length > 0 && (
        <button
          onClick={switchToLateBanner}
          style={{
            width: "100%", display: "flex", alignItems: "center", gap: "0.6rem",
            background: "#fef2f2", borderTop: "1.5px solid #fca5a5", borderBottom: "1.5px solid #fca5a5",
            border: "none", padding: "0.65rem 1rem", cursor: "pointer", textAlign: "left",
          }}
        >
          <span style={{ fontSize: "1.25rem" }}>⚠️</span>
          <span style={{ flex: 1, fontWeight: 800, fontSize: "0.88rem", color: "#b91c1c" }}>
            {lateOrders.length} order{lateOrders.length !== 1 ? "s" : ""} past pickup time — tap to view
          </span>
          <span style={{ fontSize: "0.75rem", color: "#dc2626", fontWeight: 700 }}>→</span>
        </button>
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
                    <div style={{ fontWeight: 800, color: "#0f172a", fontSize: "0.95rem" }}>
                      Student: {order.customer_name && !/^[0-9a-f]{8}-/i.test(order.customer_name)
                        ? order.customer_name
                        : `#${order.id.slice(-8).toUpperCase()}`}
                    </div>
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
                        onClick={() => { setOtpModal(order.id); setOtpInput(""); setModalMode("otp"); }}
                        style={{ background: "#dcfce7", color: "#166534", border: "1.5px solid #86efac", borderRadius: 10, padding: "0.6rem 0.75rem", fontSize: "0.82rem", fontWeight: 700, cursor: "pointer" }}
                      >
                        🔐 Verify OTP / Scan QR to Complete
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
              </>
            )}
          </div>
        )}

        {/* ── LATE PICKUP TAB — slot has ended, student hasn't collected ── */}
        {tab === "late" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
            {lateOrders.length === 0 ? (
              <div style={{ textAlign: "center", color: "var(--ink-3)", padding: "3rem 0", fontSize: "0.9rem" }}>
                ✅ No late pickups right now.
              </div>
            ) : (
              <>
                <div style={{ background: "#fef2f2", border: "1.5px solid #fca5a5", borderRadius: 10, padding: "0.55rem 0.9rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span style={{ fontSize: "1.1rem" }}>⚠️</span>
                  <span style={{ fontWeight: 800, fontSize: "0.9rem", color: "#b91c1c" }}>
                    {lateOrders.length} order{lateOrders.length !== 1 ? "s" : ""} past pickup time
                  </span>
                  <span style={{ marginLeft: "auto", fontSize: "0.75rem", color: "#64748b" }}>Scan QR or enter OTP</span>
                </div>

                {lateOrders.map((order) => {
                  const assignments =
                    order.bin_assignments && order.bin_assignments.length > 0
                      ? order.bin_assignments
                      : [{ binIndex: 1, binLabel: order.bin_label ?? "⏳ Pending", binColor: order.bin_color ?? "orange", items: order.items }];

                  return (
                    <div key={order.id} style={{ background: "#fff", borderRadius: 16, boxShadow: "0 3px 10px rgba(0,0,0,0.09)", border: "1.5px solid #fca5a5", overflow: "hidden" }}>
                      <div style={{ padding: "0.75rem 0.85rem", borderBottom: "1px solid #fee2e2", background: "#fef2f2" }}>
                        <div style={{ fontWeight: 800, color: "#b91c1c", fontSize: "0.95rem" }}>
                          {order.customer_name && !/^[0-9a-f]{8}-/i.test(order.customer_name)
                            ? order.customer_name
                            : `#${order.id.slice(-8).toUpperCase()}`}
                        </div>
                        <div style={{ fontSize: "0.78rem", color: "#64748b", marginTop: 2 }}>
                          Order #{order.id.slice(-8).toUpperCase()} · Slot {order.pickup_slot ?? "—"} · <span style={{ color: "#dc2626", fontWeight: 700 }}>LATE</span>
                        </div>
                      </div>

                      {/* Direct handover: slot closed, no bin was assigned */}
                      {["confirmed", "preparing"].includes(order.status) ? (
                        <>
                          <div style={{ margin: "0 0.75rem", padding: "0.65rem 0.75rem", background: "#fff7ed", border: "1.5px dashed #f97316", borderRadius: 12 }}>
                            <div style={{ fontSize: "0.78rem", fontWeight: 700, color: "#c2410c", marginBottom: "0.4rem" }}>
                              🚫 No bin assigned — slot has closed. Hand food directly to student.
                            </div>
                            {order.items.map((it, idx) => (
                              <div key={`${it.name}-${idx}`} style={{ display: "flex", justifyContent: "space-between", fontSize: "0.92rem", fontWeight: 700, padding: "0.18rem 0", borderBottom: idx < order.items.length - 1 ? "1px dashed #fed7aa" : "none" }}>
                                <span>{it.name}</span>
                                <span style={{ color: "#b45309" }}>x{it.quantity}</span>
                              </div>
                            ))}
                          </div>
                          <div style={{ padding: "0.65rem 0.75rem 0.75rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                            <button
                              onClick={() => { clearAutoReturn(); setOtpModal(order.id); setOtpInput(""); setModalMode("otp"); }}
                              style={{ width: "100%", background: "#dc2626", color: "#fff", border: "none", borderRadius: 10, padding: "0.7rem", fontWeight: 700, fontSize: "0.9rem", cursor: "pointer" }}
                            >
                              🔐 Verify OTP / Scan QR to Complete
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                          <div style={{ padding: "0.75rem", display: "grid", gap: "0.65rem" }}>
                            {assignments.map((a) => {
                              const binColor = BIN_COLORS[a.binColor] ?? "#f97316";
                              return (
                                <div key={`${order.id}-${a.binIndex}-${a.binLabel}`} style={{ border: `2px solid ${binColor}`, borderRadius: 14, background: tint(binColor, "18"), overflow: "hidden" }}>
                                  <div style={{ background: binColor, color: "#fff", padding: "0.45rem 0.7rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
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
                          <div style={{ padding: "0 0.75rem 0.75rem" }}>
                            <button
                              onClick={() => { clearAutoReturn(); setOtpModal(order.id); setOtpInput(""); setModalMode("otp"); }}
                              style={{ width: "100%", background: "#dc2626", color: "#fff", border: "none", borderRadius: 10, padding: "0.7rem", fontWeight: 700, fontSize: "0.9rem", cursor: "pointer" }}
                            >
                              🔐 Verify OTP / Scan QR to Complete
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </>
            )}
          </div>
        )}
      </div>

      {/* Bottom nav — inline styles so desktop media-query doesn't hide it */}
      <div style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 430, background: "var(--surface,#fff)", borderTop: "1px solid var(--border,#e2e8f0)", display: "flex", zIndex: 30, paddingBottom: "env(safe-area-inset-bottom,0.5rem)" }}>
        {([
          { key: "orders", label: "Orders",      icon: "📦" },
          { key: "prep",   label: "Prep Plan",   icon: "📊" },
          { key: "late",   label: "Late Pickup", icon: "⚠️" },
        ] as { key: "orders"|"prep"|"late"; label: string; icon: string }[]).map(({ key, label, icon }) => (
          <button key={key} onClick={() => { if (key !== "late") clearAutoReturn(); setTab(key); }}
            style={{
              flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: "0.2rem",
              padding: "0.5rem 0", background: "none", border: "none", cursor: "pointer",
              fontSize: "0.65rem", fontWeight: 600,
              color: tab === key
                ? (key === "late" ? "#dc2626" : "var(--orange,#f97316)")
                : "var(--ink-3,#64748b)",
              position: "relative",
            }}>
            <span style={{ fontSize: "1.35rem" }}>{icon}</span>
            {label}
            {key === "late" && lateOrders.length > 0 && (
              <span style={{ position: "absolute", top: 4, right: "50%", transform: "translateX(200%)", background: "#dc2626", color: "#fff", borderRadius: 99, fontSize: "0.6rem", fontWeight: 900, padding: "1px 5px", lineHeight: 1.4 }}>
                {lateOrders.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* OTP / QR Verification Modal */}
      {otpModal && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: "1rem" }}
          onClick={() => !otpSubmitting && closeModal()}
        >
          <div
            style={{ background: "#fff", borderRadius: 20, padding: "1.25rem", width: "100%", maxWidth: 340, boxShadow: "0 10px 40px rgba(0,0,0,0.25)" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Order ID + close */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
              <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>
                Order #{otpModal.slice(-8).toUpperCase()}
              </span>
              <button onClick={() => !otpSubmitting && closeModal()} style={{ background: "none", border: "none", fontSize: "1.2rem", cursor: "pointer", color: "#94a3b8", lineHeight: 1 }}>✕</button>
            </div>

            {/* Mode tabs */}
            <div style={{ display: "flex", background: "#f1f5f9", borderRadius: 10, padding: 3, gap: 3, marginBottom: "1rem" }}>
              {(["otp", "qr"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => {
                    setQrError(null); setOtpInput("");
                    if (m === "qr") {
                      // getUserMedia MUST be called synchronously in the click handler —
                      // no await before it — so Chrome on Android keeps the user-gesture
                      // context and shows the permission dialog on first use.
                      navigator.mediaDevices?.getUserMedia({ video: true })
                        .then(s => s.getTracks().forEach(t => t.stop()))
                        .catch(() => {});
                    }
                    setModalMode(m);
                  }}
                  disabled={otpSubmitting}
                  style={{
                    flex: 1, padding: "0.5rem 0", border: "none", borderRadius: 8, cursor: "pointer",
                    fontWeight: 700, fontSize: "0.8rem",
                    background: modalMode === m ? "#1e293b" : "transparent",
                    color: modalMode === m ? "#fff" : "#64748b",
                  }}
                >
                  {m === "otp" ? "🔢 OTP" : "📷 Scan QR"}
                </button>
              ))}
            </div>

            {/* OTP mode */}
            {modalMode === "otp" && (
              <>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={otpInput}
                  onChange={(e) => setOtpInput(e.target.value.replace(/\D/g, ""))}
                  placeholder="0 0 0 0"
                  autoFocus
                  disabled={otpSubmitting}
                  style={{ display: "block", width: "100%", padding: "0.9rem", fontSize: "2rem", letterSpacing: "0.35rem", textAlign: "center", border: "2px solid var(--border)", borderRadius: 12, marginBottom: "1rem", fontWeight: 700, boxSizing: "border-box" }}
                />
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button
                    onClick={() => !otpSubmitting && closeModal()}
                    disabled={otpSubmitting}
                    style={{ flex: 1, padding: "0.7rem", border: "1.5px solid #e5e7eb", background: "#f3f4f6", borderRadius: 10, fontWeight: 700, cursor: "pointer" }}
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
              </>
            )}

            {/* QR scan mode */}
            {modalMode === "qr" && (
              <>
                <p style={{ fontSize: "0.78rem", color: "#64748b", textAlign: "center", marginBottom: "0.75rem" }}>
                  {qrError ? "" : "Point camera at student's QR code"}
                </p>

                {/* Keep the div always mounted so html5-qrcode can find it on retry */}
                <div
                  id="modal-qr-reader"
                  style={{
                    width: "100%", borderRadius: 12, overflow: "hidden",
                    border: `2px solid ${qrError ? "#fca5a5" : "#e2e8f0"}`,
                    background: "#000", minHeight: qrError ? 0 : 220,
                    display: qrError ? "none" : "block",
                  }}
                />

                {qrError && (
                  <div style={{ textAlign: "center", padding: "0.5rem 0 0.25rem" }}>
                    <p style={{ color: "#dc2626", fontWeight: 700, fontSize: "0.85rem", marginBottom: "1rem", lineHeight: 1.5 }}>
                      {qrError}
                    </p>
                    <div style={{ display: "flex", gap: "0.5rem", justifyContent: "center", flexWrap: "wrap" }}>
                      <button
                        onClick={() => {
                          // Synchronous getUserMedia call to re-trigger permission dialog
                          navigator.mediaDevices?.getUserMedia({ video: true })
                            .then(s => s.getTracks().forEach(t => t.stop()))
                            .catch(() => {});
                          setQrError(null);
                          setQrRetryKey(k => k + 1);
                        }}
                        style={{ padding: "0.6rem 1.2rem", background: "#1e293b", color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, cursor: "pointer", fontSize: "0.85rem" }}
                      >
                        Try Again
                      </button>
                      <button
                        onClick={() => { setModalMode("otp"); setQrError(null); }}
                        style={{ padding: "0.6rem 1.2rem", background: "#f97316", color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, cursor: "pointer", fontSize: "0.85rem" }}
                      >
                        Use OTP Instead
                      </button>
                    </div>
                  </div>
                )}

                {otpSubmitting && (
                  <p style={{ textAlign: "center", marginTop: "0.75rem", color: "#64748b", fontWeight: 600, fontSize: "0.85rem" }}>
                    Verifying...
                  </p>
                )}

                <button
                  onClick={() => !otpSubmitting && closeModal()}
                  style={{ width: "100%", marginTop: "0.85rem", padding: "0.65rem", border: "1.5px solid #e5e7eb", background: "#f3f4f6", borderRadius: 10, fontWeight: 700, cursor: "pointer", fontSize: "0.88rem" }}
                >
                  Cancel
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

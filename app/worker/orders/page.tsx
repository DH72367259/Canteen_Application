"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import QRCameraScanner from "@/components/QRCameraScanner";
import { requestRearCamera } from "@/lib/camera";

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

const ACTIVE_STATUSES = ["placed", "confirmed", "preparing", "ready_for_placement", "placed_in_bin", "ready_for_pickup", "late_pickup_pending", "late_pickup"];

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
// In batched_only mode the slot is just internal bookkeeping — orders
// are never "late" because the slot ended. Only the 5-min after-bin
// timer (server-side releaseStalePlacedInBinOrders) marks them late
// via DB status. The caller must pass slotMode so this client-side
// override doesn't fire spuriously in batched_only.
function isLatePickup(slotLabel: string | null | undefined, slotMode: "both" | "batched_only" = "both"): boolean {
  if (slotMode === "batched_only") return false;
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

// ── BINS TAB + ORDERS-SEARCH HELPERS ────────────────────────────────────
// Additive helpers for the new Bins tab and search-by-anything box in the
// Orders tab. Pure functions — no side effects on existing flow.

type BinAssignmentFlat = {
  orderId: string;
  customerName: string;
  binLabel: string;
  binColor: string;
  items: { name: string; quantity: number }[];
  status: string;
  pickupSlot: string | null;
};

function flattenBins(orders: WorkerOrder[]): BinAssignmentFlat[] {
  const out: BinAssignmentFlat[] = [];
  for (const o of orders) {
    const assignments = o.bin_assignments && o.bin_assignments.length > 0
      ? o.bin_assignments
      : [{ binIndex: 1, binLabel: o.bin_label ?? "—", binColor: o.bin_color ?? "orange", items: o.items }];
    for (const a of assignments) {
      out.push({
        orderId: o.id,
        customerName: o.customer_name && !/^[0-9a-f]{8}-/i.test(o.customer_name)
          ? o.customer_name
          : `#${o.id.slice(-8).toUpperCase()}`,
        binLabel: a.binLabel,
        binColor: a.binColor,
        items: a.items,
        status: o.status,
        pickupSlot: o.pickup_slot ?? null,
      });
    }
  }
  return out;
}

/**
 * Matches an order against a free-text search query. Returns true when
 * ANY of these contains/equals the query (case-insensitive):
 *   - customer name (substring)
 *   - order ID last-4 / last-8 (endsWith)
 *   - bin label (substring)
 *   - bin color name (substring — "red", "blue", etc.)
 *   - any item name (substring)
 *   - any bin-assignment label / color / item name (multi-bin orders)
 */
function matchesSearch(order: WorkerOrder, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (order.customer_name && order.customer_name.toLowerCase().includes(q)) return true;
  const idLower = order.id.toLowerCase();
  if (idLower.includes(q) || idLower.endsWith(q)) return true;
  if (order.bin_label && order.bin_label.toLowerCase().includes(q)) return true;
  if (order.bin_color && order.bin_color.toLowerCase().includes(q)) return true;
  for (const it of order.items ?? []) {
    if (it.name.toLowerCase().includes(q)) return true;
  }
  for (const ba of order.bin_assignments ?? []) {
    if (ba.binLabel.toLowerCase().includes(q)) return true;
    if (ba.binColor.toLowerCase().includes(q)) return true;
    for (const it of ba.items ?? []) {
      if (it.name.toLowerCase().includes(q)) return true;
    }
  }
  return false;
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
  const [slotMode, setSlotMode]     = useState<"both" | "batched_only">("both");
  const [fetching, setFetching]     = useState(true);
  const [updating, setUpdating]     = useState<string | null>(null);
  const [activeSlot, setActiveSlot] = useState<string>("__all__");
  const [tab, setTab]               = useState<"orders" | "bins" | "prep" | "late">("orders");
  // ── New: Bins-tab color filter + Orders-tab free-text search ─────────────
  const [binColorFilter, setBinColorFilter] = useState<string>("__all__");
  const [searchQuery, setSearchQuery]       = useState<string>("");
  const [otpModal, setOtpModal]     = useState<string | null>(null);
  const [otpInput, setOtpInput]     = useState("");
  const [otpSubmitting, setOtpSubmitting] = useState(false);
  const [modalMode, setModalMode]   = useState<"otp" | "qr">("otp");
  const [qrRetryKey, setQrRetryKey] = useState(0);
  const [qrVerifyError, setQrVerifyError] = useState<string | null>(null);
  const [otpError, setOtpError]           = useState<string | null>(null);
  const streamPromiseRef            = useRef<Promise<MediaStream> | null>(null);
  // Late-pickup auto-switch: tracks whether the current late-tab session was
  // triggered by the banner (vs a manual tab click). The 45s auto-return only
  // runs for banner-triggered switches.
  const [autoReturnSecsLeft, setAutoReturnSecsLeft] = useState<number | null>(null);
  const autoReturnTimerRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const isAutoSwitchedRef   = useRef(false);
  const prevLateCountRef    = useRef(0);

  useEffect(() => {
    if (!loading && !user) router.push("/worker/login");
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
      (o) => o.status === "late_pickup" || o.status === "late_pickup_pending" ||
             (isLatePickup(o.pickup_slot, slotMode) && ["placed_in_bin", "ready_for_pickup", "confirmed", "preparing"].includes(o.status))
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
          if (data.slot_mode === "batched_only" || data.slot_mode === "both") {
            setSlotMode(data.slot_mode);
          }
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

  // Worker confirms they have physically shifted the food from the bin to the
  // late pickup counter. Server flips status: late_pickup_pending → late_pickup
  // AND frees the bin so the next student can be assigned to it.
  async function markShifted(orderId: string) {
    if (!session) return;
    setUpdating(orderId);
    try {
      const res = await fetch(`/api/orders/${orderId}/clear-bin`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.ok) {
        setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, status: "late_pickup", bin_label: null } : o)));
      }
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
      setOtpError(null);
    } catch (e) {
      setOtpError(e instanceof Error ? e.message : "Error verifying OTP");
    } finally { setOtpSubmitting(false); }
  }

  // Called by QRCameraScanner when a valid NOQX QR payload is detected.
  const handleQrScanned = useCallback(async (decodedText: string) => {
    const parts = decodedText.split("|");
    if (parts.length !== 4 || parts[0] !== "NOQX") return; // not our QR
    if (!otpModal || !session) return;
    setOtpSubmitting(true);
    try {
      const res = await fetch(`/api/orders/${otpModal}/verify-qr`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ qrPayload: decodedText }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "QR verification failed");
      setOrders((prev) => prev.map((o) => (o.id === otpModal ? { ...o, status: "collected" } : o)));
      setOtpModal(null);
      setOtpInput("");
      setModalMode("otp");
      setQrVerifyError(null);
      streamPromiseRef.current = null;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "QR verification failed";
      setQrVerifyError(msg);
    } finally {
      setOtpSubmitting(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otpModal, session]);

  function closeModal() {
    streamPromiseRef.current = null;
    setOtpModal(null);
    setOtpInput("");
    setModalMode("otp");
    setQrVerifyError(null);
    setOtpError(null);
  }

  // Orders tab: current slot + 60-min upcoming (never late_pickup or late_pickup_pending —
  // those belong to the Late Pickup tab so the worker can shift them).
  const relevantOrders = orders.filter(
    (o) => o.status !== "late_pickup" &&
           o.status !== "late_pickup_pending" &&
           isOrderRelevant(o.pickup_slot),
  );
  const slots = [...new Set(relevantOrders.map((o) => o.pickup_slot).filter((s): s is string => Boolean(s)))].sort();
  const slotFilteredOrders = activeSlot === "__all__"
    ? relevantOrders
    : relevantOrders.filter((o) => o.pickup_slot === activeSlot);
  // Apply free-text search on top of slot filter — Orders tab only.
  const displayedOrders = slotFilteredOrders.filter((o) => matchesSearch(o, searchQuery));

  // ── Bins tab: flattened per-bin view of the same relevant orders ────────
  // Uses the SAME pool as Orders so a worker switching tabs sees consistent
  // state. Color filter is a UI-only concern; filtering happens after flatten.
  const flatBins = flattenBins(slotFilteredOrders);
  const availableColors = [...new Set(flatBins.map((b) => b.binColor))].sort();
  const filteredBins = binColorFilter === "__all__"
    ? flatBins
    : flatBins.filter((b) => b.binColor === binColorFilter);

  // Prep tab: only the immediately upcoming slot (15-min window, no past slots)
  const prepOrders = orders.filter((o) => isPrepRelevant(o.pickup_slot));
  const prepSummary = aggregateBySlot(prepOrders);
  const selectedSummary = pickBestPrepSlot(prepSummary);

  // Late Pickup tab: DB status is late_pickup or late_pickup_pending (sweep moved
  // an uncollected placed_in_bin order — worker now needs to physically shift it),
  // OR the slot has ended with an active status (`both` mode client-side fallback
  // before the next server sweep runs).
  const lateOrders = orders.filter(
    (o) => o.status === "late_pickup" ||
           o.status === "late_pickup_pending" ||
           (isLatePickup(o.pickup_slot, slotMode) && ["placed_in_bin", "ready_for_pickup", "confirmed", "preparing"].includes(o.status))
  );

  if (loading || fetching) return <div className="page-loading"><div className="spinner" /></div>;

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      {/* Top bar — sticky + safe-area-inset-top so Android status bar (Capacitor
          WebView fills the screen including under it) doesn't clip "Orders | time | Logout". */}
      <div style={{
        background: "#1e293b", color: "#fff",
        padding: "calc(env(safe-area-inset-top, 0) + 0.75rem) 1rem 0.75rem",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        position: "sticky", top: 0, zIndex: 20,
      }}>
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
          <img
            src="/icons/icon-192.png"
            alt=""
            style={{ width: 28, height: 28, borderRadius: 6, objectFit: "cover", flexShrink: 0 }}
          />
          <div style={{ fontWeight: 700, fontSize: "1rem" }}>
            {tab === "orders" ? "Orders" : tab === "bins" ? "Bins" : tab === "prep" ? "Prep Plan" : "Late Pickup"}
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
            onClick={() => logout().then(() => router.push("/worker/login"))}
            style={{ background: "none", border: "1px solid #475569", color: "#94a3b8", borderRadius: 8, padding: "0.35rem 0.65rem", cursor: "pointer", fontSize: "0.78rem" }}
          >
            Logout
          </button>
        </div>
      </div>

      {/* Slot dropdown + search — orders tab only */}
      {tab === "orders" && (
        <div style={{ background: "#fff", borderBottom: "1px solid var(--border)", padding: "0.55rem 1rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {/* Free-text search — matches name / order ID / bin label / bin color / item name */}
          <div style={{ position: "relative" }}>
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="🔍 Search: student name, order #, bin number, color, or item"
              style={{ width: "100%", padding: "0.5rem 0.75rem", paddingRight: searchQuery ? "2rem" : "0.75rem", borderRadius: 10, border: "1.5px solid #cbd5e1", background: "#f8fafc", fontSize: "0.85rem", color: "#0f172a", outline: "none", boxSizing: "border-box" }}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: "1rem", lineHeight: 1, padding: "0.15rem 0.4rem" }}
                aria-label="Clear search"
              >
                ✕
              </button>
            )}
          </div>
          {/* Slot picker */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
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
          {/* Search result hint */}
          {searchQuery && (
            <div style={{ fontSize: "0.75rem", color: "#64748b" }}>
              {displayedOrders.length} of {slotFilteredOrders.length} {slotFilteredOrders.length === 1 ? "order" : "orders"} match &quot;{searchQuery}&quot;
            </div>
          )}
        </div>
      )}

      {/* Color filter chips — bins tab only */}
      {tab === "bins" && (
        <div style={{ background: "#fff", borderBottom: "1px solid var(--border)", padding: "0.55rem 1rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.55rem" }}>
            <label htmlFor="bin-slot-select" style={{ fontSize: "0.78rem", fontWeight: 700, color: "#475569", whiteSpace: "nowrap" }}>Slot:</label>
            <select
              id="bin-slot-select"
              value={activeSlot}
              onChange={(e) => setActiveSlot(e.target.value)}
              style={{ flex: 1, padding: "0.4rem 0.65rem", borderRadius: 10, border: "1.5px solid #cbd5e1", background: "#f8fafc", fontSize: "0.82rem", fontWeight: 600, color: "#0f172a", cursor: "pointer", outline: "none", appearance: "auto" }}
            >
              <option value="__all__">All relevant ({relevantOrders.length})</option>
              {slots.map((slot) => (
                <option key={slot} value={slot}>{slot} ({relevantOrders.filter((o) => o.pickup_slot === slot).length})</option>
              ))}
            </select>
          </div>
          <div style={{ display: "flex", gap: "0.4rem", overflowX: "auto", paddingBottom: "0.15rem" }}>
            <button
              onClick={() => setBinColorFilter("__all__")}
              style={{
                flex: "0 0 auto", display: "flex", alignItems: "center", gap: "0.35rem",
                padding: "0.35rem 0.7rem", borderRadius: 999, fontSize: "0.78rem", fontWeight: 700,
                border: "1.5px solid " + (binColorFilter === "__all__" ? "#0f172a" : "#cbd5e1"),
                background: binColorFilter === "__all__" ? "#0f172a" : "#fff",
                color: binColorFilter === "__all__" ? "#fff" : "#0f172a", cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              All ({flatBins.length})
            </button>
            {availableColors.map((color) => {
              const swatch = BIN_COLORS[color] ?? "#94a3b8";
              const count = flatBins.filter((b) => b.binColor === color).length;
              const active = binColorFilter === color;
              return (
                <button
                  key={color}
                  onClick={() => setBinColorFilter(color)}
                  style={{
                    flex: "0 0 auto", display: "flex", alignItems: "center", gap: "0.35rem",
                    padding: "0.35rem 0.7rem", borderRadius: 999, fontSize: "0.78rem", fontWeight: 700,
                    border: `1.5px solid ${swatch}`,
                    background: active ? swatch : "#fff",
                    color: active ? "#fff" : "#0f172a", cursor: "pointer",
                    whiteSpace: "nowrap", textTransform: "capitalize",
                  }}
                >
                  <span style={{ width: 12, height: 12, borderRadius: 3, background: swatch, display: "inline-block", border: active ? "1px solid rgba(255,255,255,0.7)" : "none" }} />
                  {color} ({count})
                </button>
              );
            })}
          </div>
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

        {/* ── BINS TAB — grid view, filterable by color ── */}
        {tab === "bins" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
            {filteredBins.length === 0 ? (
              <div style={{ textAlign: "center", color: "var(--ink-3)", padding: "3rem 0", fontSize: "0.9rem" }}>
                {flatBins.length === 0
                  ? "No bins assigned yet for the current slot."
                  : `No bins with ${binColorFilter} color — try a different filter.`}
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: "0.7rem" }}>
                {filteredBins.map((bin, idx) => {
                  const swatch = BIN_COLORS[bin.binColor] ?? "#f97316";
                  const canVerify = bin.status === "placed_in_bin";
                  return (
                    <div
                      key={`${bin.orderId}-${bin.binLabel}-${idx}`}
                      style={{ background: "#fff", border: `2px solid ${swatch}`, borderRadius: 14, overflow: "hidden", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}
                    >
                      <div style={{ background: swatch, color: "#fff", padding: "0.5rem 0.6rem", textAlign: "center" }}>
                        <div style={{ fontSize: "1.05rem", fontWeight: 900, letterSpacing: "0.02em" }}>Bin {bin.binLabel}</div>
                        <div style={{ fontSize: "0.62rem", opacity: 0.92, textTransform: "uppercase", letterSpacing: "0.08em", marginTop: 1 }}>{bin.binColor}</div>
                      </div>
                      <div style={{ padding: "0.55rem 0.6rem" }}>
                        <div style={{ fontSize: "0.82rem", fontWeight: 800, color: "#0f172a", marginBottom: "0.18rem", lineHeight: 1.25 }}>
                          {bin.customerName}
                        </div>
                        <div style={{ fontSize: "0.66rem", color: "#64748b", marginBottom: "0.4rem", fontFamily: "ui-monospace, SFMono-Regular, monospace" }}>
                          #{bin.orderId.slice(-8).toUpperCase()}
                        </div>
                        <div style={{ borderTop: "1px dashed #e2e8f0", paddingTop: "0.35rem", marginBottom: canVerify ? "0.45rem" : 0 }}>
                          {bin.items.map((it, i) => (
                            <div key={i} style={{ fontSize: "0.74rem", fontWeight: 600, color: "#1e293b", display: "flex", justifyContent: "space-between", padding: "0.1rem 0" }}>
                              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "70%" }}>{it.name}</span>
                              <span style={{ color: "#b45309", fontWeight: 700 }}>x{it.quantity}</span>
                            </div>
                          ))}
                        </div>
                        {canVerify && (
                          <button
                            onClick={() => { setOtpModal(bin.orderId); setOtpInput(""); setModalMode("otp"); }}
                            style={{ width: "100%", background: "#dcfce7", border: "1.5px solid #86efac", color: "#166534", borderRadius: 8, padding: "0.5rem", fontSize: "0.74rem", fontWeight: 800, cursor: "pointer", lineHeight: 1.2 }}
                          >
                            🔐 Verify OTP / QR
                          </button>
                        )}
                        {bin.status === "ready_for_pickup" && (
                          <div style={{ fontSize: "0.7rem", textAlign: "center", color: "#1d4ed8", fontWeight: 700, padding: "0.3rem 0" }}>
                            ✓ Collected
                          </div>
                        )}
                        {(bin.status === "confirmed" || bin.status === "preparing" || bin.status === "ready_for_placement") && (
                          <div style={{ fontSize: "0.66rem", textAlign: "center", color: "#92400e", fontWeight: 700, padding: "0.25rem 0", background: "#fffbeb", borderRadius: 6 }}>
                            {bin.status === "preparing" ? "👨‍🍳 Preparing" : bin.status === "ready_for_placement" ? "🟡 Ready to place" : "⏳ Awaiting prep"}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
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
                          Order #{order.id.slice(-8).toUpperCase()} · Slot {order.pickup_slot ?? "—"} · <span style={{ color: "#dc2626", fontWeight: 700 }}>
                            {order.status === "late_pickup_pending" ? "SHIFT TO COUNTER" : "LATE"}
                          </span>
                        </div>
                      </div>

                      {/* late_pickup_pending: 5-min timer expired, bin still occupied.
                          Worker must physically move food to the late-pickup counter,
                          then tap "Mark Shifted" — that frees the bin and flips status
                          to late_pickup so the student can show their QR to collect. */}
                      {order.status === "late_pickup_pending" ? (
                        <>
                          <div style={{ padding: "0.75rem", display: "grid", gap: "0.65rem" }}>
                            {assignments.map((a) => {
                              const binColor = BIN_COLORS[a.binColor] ?? "#f97316";
                              return (
                                <div key={`${order.id}-${a.binIndex}-${a.binLabel}`} style={{ border: `2px solid ${binColor}`, borderRadius: 14, background: tint(binColor, "18"), overflow: "hidden" }}>
                                  <div style={{ background: binColor, color: "#fff", padding: "0.45rem 0.7rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                    <span style={{ fontWeight: 900, fontSize: "1.02rem" }}>Bin {a.binLabel}</span>
                                    <span style={{ fontSize: "0.72rem", opacity: 0.92 }}>Pickup expired</span>
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
                            <div style={{ background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 10, padding: "0.55rem 0.7rem", fontSize: "0.78rem", color: "#9a3412", fontWeight: 600, lineHeight: 1.35 }}>
                              📦 Shift the food from this bin to the late-pickup counter, then tap below to free the bin.
                            </div>
                            <button
                              disabled={updating === order.id}
                              onClick={() => {
                                if (confirm("Confirm you have moved this order's food to the late pickup counter? This will free the bin for the next student.")) {
                                  clearAutoReturn();
                                  markShifted(order.id);
                                }
                              }}
                              style={{ width: "100%", background: "#0f766e", color: "#fff", border: "none", borderRadius: 10, padding: "0.7rem", fontWeight: 700, fontSize: "0.9rem", cursor: "pointer" }}
                            >
                              {updating === order.id ? "Shifting…" : "📦 Mark Shifted to Late Counter"}
                            </button>
                          </div>
                        </>
                      ) : ["confirmed", "preparing"].includes(order.status) ? (
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
      <div style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 430, background: "var(--surface,#fff)", borderTop: "1px solid var(--border,#e2e8f0)", display: "flex", zIndex: 30, paddingBottom: "env(safe-area-inset-bottom,0.5rem)", pointerEvents: "none" }}>
        {([
          { key: "orders", label: "Orders",      icon: "📦" },
          { key: "bins",   label: "Bins",        icon: "🎨" },
          { key: "prep",   label: "Prep Plan",   icon: "📊" },
          { key: "late",   label: "Late Pickup", icon: "⚠️" },
        ] as { key: "orders"|"bins"|"prep"|"late"; label: string; icon: string }[]).map(({ key, label, icon }) => (
          <button key={key} onClick={() => { if (key !== "late") clearAutoReturn(); setTab(key); }}
            style={{
              flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: "0.2rem",
              padding: "0.5rem 0", background: "none", border: "none", cursor: "pointer",
              fontSize: "0.65rem", fontWeight: 600, pointerEvents: "auto",
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
                    setOtpInput("");
                    setQrVerifyError(null);
                    setOtpError(null);
                    if (m === "qr") {
                      // Start getUserMedia synchronously in the click handler —
                      // Chrome Android requires this to show the permission dialog.
                      // Store the Promise so QRCameraScanner can use the stream directly.
                      try {
                        // Use the most permissive constraint — works across
                        // every browser. Rear-camera upgrade happens after.
                        streamPromiseRef.current = navigator.mediaDevices ? requestRearCamera() : null;
                      } catch {
                        streamPromiseRef.current = null;
                      }
                      setQrRetryKey(k => k + 1);
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
                  onChange={(e) => { setOtpInput(e.target.value.replace(/\D/g, "")); setOtpError(null); }}
                  placeholder="0 0 0 0"
                  autoFocus
                  disabled={otpSubmitting}
                  style={{ display: "block", width: "100%", padding: "0.9rem", fontSize: "2rem", letterSpacing: "0.35rem", textAlign: "center", border: `2px solid ${otpError ? "#fca5a5" : "var(--border)"}`, borderRadius: 12, marginBottom: otpError ? "0.5rem" : "1rem", fontWeight: 700, boxSizing: "border-box" }}
                />
                {otpError && (
                  <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 10, padding: "0.6rem 0.75rem", marginBottom: "0.85rem", textAlign: "center" }}>
                    <p style={{ color: "#dc2626", fontWeight: 700, fontSize: "0.82rem", margin: 0 }}>❌ {otpError}</p>
                  </div>
                )}
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
                {/* Inline QR verification error */}
                {qrVerifyError ? (
                  <>
                    <div style={{ background: "#fef2f2", border: "1.5px solid #fca5a5", borderRadius: 12, padding: "1rem", marginBottom: "0.85rem", textAlign: "center" }}>
                      <div style={{ fontSize: "1.75rem", marginBottom: "0.35rem" }}>❌</div>
                      <p style={{ color: "#dc2626", fontWeight: 700, fontSize: "0.88rem", margin: 0, lineHeight: 1.5 }}>
                        {qrVerifyError}
                      </p>
                    </div>
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      <button
                        onClick={() => {
                          setQrVerifyError(null);
                          try {
                            streamPromiseRef.current = navigator.mediaDevices ? requestRearCamera() : null;
                          } catch {
                            streamPromiseRef.current = null;
                          }
                          setQrRetryKey(k => k + 1);
                        }}
                        style={{ flex: 1, padding: "0.65rem", border: "none", background: "#1e293b", color: "#fff", borderRadius: 10, fontWeight: 700, cursor: "pointer", fontSize: "0.82rem" }}
                      >
                        Scan Again
                      </button>
                      <button
                        onClick={() => { setQrVerifyError(null); setModalMode("otp"); }}
                        style={{ flex: 1, padding: "0.65rem", border: "1.5px solid #e5e7eb", background: "#f3f4f6", borderRadius: 10, fontWeight: 700, cursor: "pointer", fontSize: "0.82rem" }}
                      >
                        Use OTP Instead
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p style={{ fontSize: "0.78rem", color: "#64748b", textAlign: "center", marginBottom: "0.75rem" }}>
                      Point camera at student&apos;s QR code
                    </p>

                    <QRCameraScanner
                      key={qrRetryKey}
                      streamPromise={streamPromiseRef.current}
                      onScanned={handleQrScanned}
                    />

                    {otpSubmitting && (
                      <p style={{ textAlign: "center", marginTop: "0.75rem", color: "#64748b", fontWeight: 600, fontSize: "0.85rem" }}>
                        Verifying...
                      </p>
                    )}

                    <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.85rem" }}>
                      <button
                        onClick={() => {
                          try {
                            streamPromiseRef.current = navigator.mediaDevices ? requestRearCamera() : null;
                          } catch {
                            streamPromiseRef.current = null;
                          }
                          setQrRetryKey(k => k + 1);
                        }}
                        disabled={otpSubmitting}
                        style={{ flex: 1, padding: "0.65rem", border: "none", background: "#1e293b", color: "#fff", borderRadius: 10, fontWeight: 700, cursor: "pointer", fontSize: "0.82rem" }}
                      >
                        Try Again
                      </button>
                      <button
                        onClick={() => !otpSubmitting && closeModal()}
                        style={{ flex: 1, padding: "0.65rem", border: "1.5px solid #e5e7eb", background: "#f3f4f6", borderRadius: 10, fontWeight: 700, cursor: "pointer", fontSize: "0.82rem" }}
                      >
                        Cancel
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

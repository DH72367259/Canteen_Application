"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { getCurrentMealPeriod, categoryToMealPeriod, mealLabel, DEFAULT_WINDOWS, type MealWindows } from "@/lib/mealPeriod";

// Canteen + menu data is loaded from Supabase per canteen — no seed data.
const CANTEEN_INFO: Record<string, { name: string; emoji: string; desc: string; status: "open" | "busy" | "closed" }> = {};

type MenuItem = {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  is_meal: boolean;
  is_sold_out?: boolean;
  availability_type?: string;
  quantity_per_slot?: number | null;
  total_per_day?: number | null;
  image_url?: string | null;
};

type CartItem = { id: string; name: string; price: number; qty: number };

interface LiveCanteenInfo {
  name: string;
  status: "open" | "busy" | "closed";
  isActive: boolean;
  desc: string;
}

export default function CanteenMenuPage() {
  const params = useParams();
  const router = useRouter();
  const canteenId = (params.canteenId as string) || "c1";

  // ── Live canteen info (server truth) ──────────────────────────────
  // We always fetch the canteen's current is_active/status from the API so a
  // student who navigates directly to /dashboard/menu/<id> for an offline
  // canteen sees the closed banner and cannot order — even if they bypass
  // the dashboard's grey-card guard.
  const [live, setLive] = useState<LiveCanteenInfo | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/canteens/${canteenId}`)
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then(j => {
        if (cancelled) return;
        const c = j.canteen;
        setLive({
          name:     c.name ?? "Canteen",
          status:   (c.is_active ? (c.status ?? "open") : "closed") as "open" | "busy" | "closed",
          isActive: !!c.is_active,
          desc:     c.address ?? c.college ?? c.city ?? "",
        });
      })
      .catch(() => { if (!cancelled) setLiveError("Could not load canteen info."); });
    return () => { cancelled = true; };
  }, [canteenId]);

  const fallback = CANTEEN_INFO[canteenId] || { name: "Canteen", emoji: "🍽️", desc: "", status: "open" as const };
  const info = live
    ? { name: live.name, emoji: "🍽️", desc: live.desc, status: live.status }
    : fallback;
  const isClosed = info.status === "closed";

  // ── Live menu items (server truth) ────────────────────────────────
  const [items, setItems] = useState<MenuItem[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>("All");
  const [menuLoading, setMenuLoading] = useState(true);
  const [menuError, setMenuError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setMenuLoading(true);
    fetch(`/api/canteens/${canteenId}/menu`)
      .then(async r => {
        if (r.ok) return r.json();
        // Surface the actual server reason so we can debug "Failed to load
        // menu items" complaints without needing server logs.
        const j = await r.json().catch(() => ({}));
        throw new Error(j?.error || `HTTP ${r.status}`);
      })
      .then((j: { items: MenuItem[]; categories: string[] }) => {
        if (cancelled) return;
        setItems(j.items ?? []);
        setCategories(["All", ...(j.categories ?? [])]);
        setMenuError(null);
      })
      .catch((err: Error) => { if (!cancelled) setMenuError(`Could not load menu items: ${err.message}`); })
      .finally(() => { if (!cancelled) setMenuLoading(false); });
    return () => { cancelled = true; };
  }, [canteenId]);

  const visibleItems = activeCategory === "All"
    ? items
    : items.filter(i => i.category === activeCategory);

  // ── Dynamic meal windows from the canteen's slot_control ───────────────
  // The vendor sets their own breakfast/lunch/dinner times via Slot and Bin
  // Control. We poll every 60s so a vendor's window edit lands on the
  // student menu without a page reload.
  const [mealWindows, setMealWindows] = useState<MealWindows>(DEFAULT_WINDOWS);
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch(`/api/canteens/${canteenId}/meal-windows`)
        .then(r => r.ok ? r.json() : null)
        .then(j => { if (!cancelled && j?.windows) setMealWindows(j.windows); })
        .catch(() => {});
    };
    load();
    const id = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [canteenId]);

  // ── Meal-period gating (client request 2026-04-30) ────────────────────
  // Only show items whose vendor-assigned category matches the current meal
  // window. Items the vendor never tagged (no recognisable category) stay
  // visible so legacy menus aren't accidentally hidden. We re-derive the
  // window every minute so it ticks over without a reload.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  const currentMeal = getCurrentMealPeriod(now, mealWindows);
  const mealFilteredItems = currentMeal
    ? visibleItems.filter(i => {
        const m = categoryToMealPeriod(i.category);
        return m === null || m === currentMeal;
      })
    : visibleItems;
  const hiddenByMeal = currentMeal ? visibleItems.length - mealFilteredItems.length : 0;

  const [cart, setCart] = useState<CartItem[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [slotOptions, setSlotOptions] = useState<Array<{ id: string; label: string }>>([]);
  const [itemAvailability, setItemAvailability] = useState<Record<string, { isAvailable: boolean; reason: string }>>({});

  // Fetch slots and item availability
  useEffect(() => {
    if (!canteenId) return;
    let cancelled = false;
    async function fetchSlotsAndAvailability() {
      try {
        const res = await fetch(`/api/slots?canteenId=${encodeURIComponent(canteenId)}`);
        const json = await res.json();
        if (!cancelled && Array.isArray(json.slots)) {
          setSlotOptions(json.slots);
          const first = json.slots.find((s: any) => s.available);
          if (first) setSelectedSlot(first.id);
        }
      } catch { /* ignore */ }
    }
    fetchSlotsAndAvailability();
    return () => { cancelled = true; };
  }, [canteenId]);

  // Check availability for current slot
  useEffect(() => {
    if (!canteenId || !selectedSlot || items.length === 0) {
      setItemAvailability({});
      return;
    }
    const slotLabel = slotOptions.find(s => s.id === selectedSlot)?.label;
    if (!slotLabel) return;

    let cancelled = false;
    async function checkAvailability() {
      try {
        const res = await fetch("/api/cart/check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            canteen_id: canteenId,
            slot: slotLabel,
            items: items.map(item => ({ id: item.id, quantity: 1 })),
          }),
        });
        const json = await res.json();
        if (!cancelled) {
          const avail: Record<string, { isAvailable: boolean; reason: string }> = {};
          for (const item of items) {
            const isSoldOut = item.is_sold_out || false;
            const isBatchedFull = item.availability_type === "batched_prepared" && json.slot_capacity &&
              json.slot_capacity.batchedPreparedCap > 0 &&
              json.slot_capacity.batchedPreparedCap <= (json.slot_orders_used || 0);
            const isMadeToOrderFull = item.availability_type !== "batched_prepared" && json.slot_capacity &&
              json.slot_capacity.madeToOrderCap > 0 &&
              json.slot_capacity.madeToOrderCap <= (json.slot_orders_used || 0);

            avail[item.id] = {
              isAvailable: !isSoldOut && !isBatchedFull && !isMadeToOrderFull,
              reason: isSoldOut ? "Sold out" : isBatchedFull ? "Batched orders full" : isMadeToOrderFull ? "Made-to-order full" : "",
            };
          }
          setItemAvailability(avail);
        }
      } catch { /* ignore */ }
    }
    checkAvailability();
    return () => { cancelled = true; };
  }, [canteenId, selectedSlot, items, slotOptions]);

  const addItem = (item: { id: string; name: string; price: number }) => {
    if (isClosed || !itemAvailability[item.id]?.isAvailable) return;
    setCart(prev => {
      const existing = prev.find(c => c.id === item.id);
      if (existing) return prev.map(c => c.id === item.id ? { ...c, qty: c.qty + 1 } : c);
      return [...prev, { ...item, qty: 1 }];
    });
  };

  const removeItem = (id: string) => {
    setCart(prev => prev
      .map(c => c.id === id ? { ...c, qty: c.qty - 1 } : c)
      .filter(c => c.qty > 0)
    );
  };

  const cartTotal = cart.reduce((s, c) => s + c.price * c.qty, 0);
  const cartCount = cart.reduce((s, c) => s + c.qty, 0);

  // Encode cart into URL query params so the cart page receives the items
  const cartQuery = cart
    .map(c => `${c.id}:${encodeURIComponent(c.name)}:${c.price}:${c.qty}`)
    .join(",");
  const cartHref = `/dashboard/cart?cart=${cartQuery}&canteenId=${canteenId}&canteenName=${encodeURIComponent(info.name)}`;

  const statusColor = info.status === "open" ? "var(--green)" : info.status === "busy" ? "var(--yellow)" : "var(--ink-3)";
  const statusLabel = info.status === "open" ? "Open" : info.status === "busy" ? "Busy" : "Closed";

  return (
    <div className="app-shell">
      {/* Top bar */}
      <div className="topbar">
        <button onClick={() => router.back()} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "1.1rem", color: "var(--ink-3)" }}>←</button>
        <div style={{ flex: 1, marginLeft: "0.5rem" }}>
          <div style={{ fontWeight: 700, fontSize: "1rem" }}>{info.emoji} {info.name}</div>
          <div style={{ fontSize: "0.72rem", color: "var(--ink-3)" }}>{info.desc}</div>
        </div>
        <span style={{ fontSize: "0.72rem", fontWeight: 700, padding: "0.2rem 0.6rem", borderRadius: 999, background: info.status === "open" ? "var(--green-light)" : info.status === "busy" ? "var(--yellow-light)" : "#f3f4f6", color: statusColor }}>
          ● {statusLabel}
        </span>
      </div>

      {/* Closed banner */}
      {isClosed && (
        <div style={{ margin: "0.75rem 1rem 0", background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 14, padding: "0.85rem 1rem", display: "flex", gap: "0.6rem", alignItems: "center" }}>
          <span style={{ fontSize: "1.3rem" }}>🔒</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: "0.9rem", color: "#991b1b" }}>Canteen is currently closed</div>
            <div style={{ fontSize: "0.78rem", color: "#b91c1c", marginTop: "0.15rem" }}>Orders are not being accepted right now. Please check back later.</div>
          </div>
        </div>
      )}
      {liveError && !live && (
        <div style={{ margin: "0.75rem 1rem 0", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 14, padding: "0.6rem 0.85rem", fontSize: "0.78rem", color: "#92400e" }}>
          ⚠️ {liveError} Showing limited info.
        </div>
      )}

      {/* Category tabs (driven by live menu) */}
      {categories.length > 1 && (
        <div className="meal-tabs" style={{ overflowX: "auto", whiteSpace: "nowrap" }}>
          {categories.map(cat => (
            <button
              key={cat}
              className={`meal-tab ${activeCategory === cat ? "active" : ""}`}
              onClick={() => setActiveCategory(cat)}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {/* Menu items */}
      <div style={{ padding: "0.75rem 1rem", display: "flex", flexDirection: "column", gap: "0.6rem", paddingBottom: cartCount > 0 ? "8rem" : "5rem" }}>
        {currentMeal && (
          <div style={{ background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 12, padding: "0.55rem 0.85rem", fontSize: "0.78rem", color: "#9a3412", display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <span style={{ fontSize: "1rem" }}>⏰</span>
            <span>Showing <strong>{mealLabel(currentMeal, mealWindows[currentMeal])}</strong> menu only{hiddenByMeal > 0 ? ` · ${hiddenByMeal} item${hiddenByMeal === 1 ? "" : "s"} hidden until their meal window` : ""}.</span>
          </div>
        )}
        {menuLoading && (
          <div style={{ textAlign: "center", color: "var(--ink-3)", padding: "2rem 0", fontSize: "0.85rem" }}>Loading menu…</div>
        )}
        {!menuLoading && menuError && (
          <div style={{ textAlign: "center", color: "#b91c1c", padding: "1.5rem 0", fontSize: "0.85rem" }}>{menuError}</div>
        )}
        {!menuLoading && !menuError && mealFilteredItems.length === 0 && (
          <div style={{ textAlign: "center", color: "var(--ink-3)", padding: "2.5rem 0", fontSize: "0.9rem" }}>
            <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>🍽️</div>
            {currentMeal && visibleItems.length > 0
              ? `No ${currentMeal} items available right now.`
              : "No items available right now."}
          </div>
        )}
        {mealFilteredItems.map(item => {
          const inCart = cart.find(c => c.id === item.id);
          const availability = itemAvailability[item.id] || { isAvailable: true, reason: "" };
          // Use is_sold_out flag from server if available, otherwise rely on real-time availability
          const isServerSoldOut = item.is_sold_out ?? false;
          const isRealtimeSoldOut = !availability.isAvailable;
          const isOutOfStock = isServerSoldOut || isRealtimeSoldOut;
          const opacity = isClosed || isOutOfStock ? 0.65 : 1;

          // Determine item state
          let itemState: "available" | "out_of_stock" | "not_available" = "available";
          let statusBadgeLabel = "✓ Available";
          let statusBadgeColor = "#ecfdf5";
          let statusBadgeTextColor = "#15803d";
          let statusBadgeBorder = "#a7f3d0";
          let buttonLabel = "ADD";
          let buttonDisabled = isClosed || isOutOfStock;

          if (isClosed) {
            itemState = "not_available";
            statusBadgeLabel = "🔒 Canteen Closed";
            statusBadgeColor = "#fef2f2";
            statusBadgeTextColor = "#991b1b";
            statusBadgeBorder = "#fca5a5";
            buttonLabel = "CLOSED";
          } else if (isOutOfStock) {
            // Distinguish between manager-flagged sold out vs slot capacity exhausted
            if (isServerSoldOut && !isRealtimeSoldOut) {
              // Manager explicitly marked as sold out
              itemState = "out_of_stock";
              statusBadgeLabel = "⛔ Out of Stock";
              statusBadgeColor = "#fee2e2";
              statusBadgeTextColor = "#b91c1c";
              statusBadgeBorder = "#fca5a5";
              buttonLabel = "OUT OF STOCK";
            } else if (isRealtimeSoldOut && !isServerSoldOut) {
              // Slot capacity or daily cap exhausted
              itemState = "not_available";
              statusBadgeLabel = "⏰ Not Available Now";
              statusBadgeColor = "#fef3c7";
              statusBadgeTextColor = "#92400e";
              statusBadgeBorder = "#fde68a";
              buttonLabel = "NOT NOW";
            } else {
              // Both flagged as sold out
              itemState = "out_of_stock";
              statusBadgeLabel = "⛔ Out of Stock";
              statusBadgeColor = "#fee2e2";
              statusBadgeTextColor = "#b91c1c";
              statusBadgeBorder = "#fca5a5";
              buttonLabel = "OUT OF STOCK";
            }
          }

          return (
            <div key={item.id} className="card" style={{ display: "flex", gap: "0.75rem", alignItems: "center", opacity }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", marginBottom: "0.15rem" }}>
                  <span style={{ fontWeight: 700, fontSize: "0.9rem" }}>{item.name}</span>
                  {item.is_meal && <span style={{ fontSize: "0.65rem", color: "var(--orange)", fontWeight: 700 }}>🍽️ MEAL</span>}
                </div>
                <div style={{ fontSize: "0.75rem", color: "var(--ink-3)", marginBottom: "0.25rem" }}>{item.description}</div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap", marginBottom: "0.25rem" }}>
                  <span style={{ fontSize: "0.68rem", fontWeight: 700, padding: "0.2rem 0.5rem", borderRadius: 999, background: statusBadgeColor, color: statusBadgeTextColor, border: `1px solid ${statusBadgeBorder}` }}>
                    {statusBadgeLabel}
                  </span>
                  {item.quantity_per_slot && (
                    <span style={{ fontSize: "0.65rem", color: "var(--ink-3)" }}>
                      Max {item.quantity_per_slot}/slot
                    </span>
                  )}
                </div>
                <div style={{ fontWeight: 700, fontSize: "0.9rem" }}>₹{item.price}</div>
              </div>
              <div>
                {buttonDisabled ? (
                  <button disabled className="btn btn-outline" style={{ padding: "0.35rem 0.75rem", fontSize: "0.82rem", opacity: 0.5, cursor: "not-allowed", color: itemState === "out_of_stock" ? "#b91c1c" : undefined }}>
                    {buttonLabel}
                  </button>
                ) : !inCart ? (
                  <button onClick={() => addItem(item)} className="btn btn-outline" style={{ padding: "0.35rem 0.75rem", fontSize: "0.82rem" }}>ADD</button>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <button onClick={() => removeItem(item.id)} style={{ width: 30, height: 30, borderRadius: "50%", border: "1.5px solid var(--orange)", background: "none", color: "var(--orange)", fontSize: "1.1rem", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>−</button>
                    <span style={{ fontWeight: 700, fontSize: "0.9rem", minWidth: 16, textAlign: "center" }}>{inCart.qty}</span>
                    <button onClick={() => addItem(item)} style={{ width: 30, height: 30, borderRadius: "50%", border: "1.5px solid var(--orange)", background: "var(--orange)", color: "#fff", fontSize: "1.1rem", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>+</button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Cart bar */}
      {cartCount > 0 && !isClosed && (
        <div style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 430, padding: "0.75rem 1rem", background: "var(--surface)", borderTop: "1px solid var(--border)", zIndex: 35 }}>
          <Link href={cartHref} style={{ textDecoration: "none" }}>
            <button className="btn btn-primary btn-full" style={{ padding: "0.85rem", fontSize: "0.95rem", display: "flex", justifyContent: "space-between" }}>
              <span>🛒 {cartCount} item{cartCount > 1 ? "s" : ""} in cart</span>
              <span>₹{cartTotal} →</span>
            </button>
          </Link>
        </div>
      )}
    </div>
  );
}

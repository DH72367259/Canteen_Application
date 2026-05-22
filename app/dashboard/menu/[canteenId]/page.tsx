"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { getCurrentMealPeriod, itemMealPeriods, type MealWindows } from "@/lib/mealPeriod";
import { useAuth } from "@/lib/auth-context";

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
  /** Server-computed: portions left today (or for the current slot,
   *  whichever cap is configured). null = no cap set = unlimited. */
  remaining?: number | null;
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
  const { session } = useAuth();
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
    const load = (showLoading: boolean) => {
      if (showLoading) setMenuLoading(true);
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
        .catch((err: Error) => { if (!cancelled && showLoading) setMenuError(`Could not load menu items: ${err.message}`); })
        .finally(() => { if (!cancelled && showLoading) setMenuLoading(false); });
    };
    load(true);
    // Poll every 10s so the "X left" badge ticks down as other students
    // place orders. Cloudflare caches at the edge for 2s so the burst
    // cost is negligible. Silent refresh — doesn't flash the loading
    // spinner.
    const interval = setInterval(() => load(false), 10_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [canteenId]);

  const visibleItems = activeCategory === "All"
    ? items
    : items.filter(i => i.category === activeCategory);

  // ── Dynamic meal windows from the canteen's slot_control ───────────────
  // The CANTEEN MANAGER is the single source of truth: morning/afternoon/
  // evening times set in Slot & Bin Control flow through /api/canteens/{id}/
  // meal-windows and drive the student menu's time-based item filter.
  // We intentionally initialise mealWindows to null (NOT a hardcoded default)
  // so that during the brief load window we don't accidentally filter items
  // using stale defaults the manager might not be using. While null → no
  // filtering happens; all items show. Once the API responds, filtering
  // engages with the manager's exact times. Polled every 60 s so window
  // edits in the manager app appear without the student reloading.
  const [mealWindows, setMealWindows] = useState<MealWindows | null>(null);
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

  // ── Time-window filtering ─────────────────────────────────────────────
  // The vendor's morning/afternoon/evening windows decide which categorised
  // items show at a given hour. Snacks/packed_snacks are ALWAYS visible
  // (the vendor only removes them when out of stock or when the canteen is
  // closed) — those serve as the "anytime" menu. Items whose category
  // doesn't resolve to a meal period (null) are treated as anytime too so
  // we don't accidentally hide custom categories.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Filtering is skipped entirely until the manager's windows arrive — that
  // way no item is incorrectly hidden based on a hardcoded default.
  const currentPeriod = mealWindows ? getCurrentMealPeriod(now, mealWindows) : null;

  // Helper: is this item allowed at the current time? Uses itemMealPeriods
  // which considers BOTH category and is_meal flag — so a "Meals" item
  // tagged is_meal=true (e.g. biryani) is hidden during breakfast even if
  // the user picks the "Meals" tab.
  const isItemAllowedNow = (item: { category: string; is_meal?: boolean }) => {
    if (!currentPeriod) return true;  // outside any meal window → canteen-open guard decides
    const allowed = itemMealPeriods(item.category, item.is_meal);
    return allowed.includes(currentPeriod);
  };

  const mealFilteredItems = !mealWindows
    ? visibleItems
    : visibleItems.filter(isItemAllowedNow);

  // Category tabs should also respect the current period — hide "Lunch" at
  // breakfast time, hide "Meals" at breakfast time (since meals are
  // lunch/dinner), etc. Compute which categories have at least one item
  // showing right now; "All" is always available.
  const categoriesVisibleNow = mealWindows
    ? categories.filter(cat => cat === "All" || items.some(i => i.category === cat && isItemAllowedNow(i)))
    : categories;
  // If the user is sitting on a tab whose category just timed out (e.g.
  // they were on "Lunch" at 10:59 and now it's 11:00 → lunch hides nothing
  // but the case where they were on "Breakfast" at 10:59 → now they should
  // see Lunch items), snap back to "All" so they don't see an empty list.
  useEffect(() => {
    if (!mealWindows) return;
    if (activeCategory !== "All" && !categoriesVisibleNow.includes(activeCategory)) {
      setActiveCategory("All");
    }
    // categoriesVisibleNow is derived; safe to depend on activeCategory + currentPeriod
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPeriod, mealWindows]);

  const CART_KEY = `menu_cart_${canteenId}`;

  const [cart, setCart] = useState<CartItem[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const saved = localStorage.getItem(CART_KEY);
      return saved ? (JSON.parse(saved) as CartItem[]) : [];
    } catch { return []; }
  });

  // Persist cart to localStorage whenever it changes
  useEffect(() => {
    try {
      if (cart.length > 0) localStorage.setItem(CART_KEY, JSON.stringify(cart));
      else localStorage.removeItem(CART_KEY);
    } catch { /* ignore */ }
  }, [cart, CART_KEY]);

  const addItem = (item: { id: string; name: string; price: number }) => {
    if (isClosed) return;
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
    <div className="app-shell" style={{ flexDirection: "column" }}>
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

      {/* Active orders intentionally NOT shown here — the home page (floating
          carousel) and the Stats tab already surface this. Repeating it on
          every canteen menu page was noisy. */}

      {/* Category sub-tabs — only show tabs whose items are allowed at the
          current meal period. "All" always shown. */}
      {categoriesVisibleNow.length > 1 && (
        <div style={{ display: "flex", overflowX: "auto", gap: "0.4rem", padding: "0.5rem 1rem", scrollbarWidth: "none" }}>
          {categoriesVisibleNow.map(cat => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              style={{
                flex: "0 0 auto",
                padding: "0.3rem 0.75rem",
                fontSize: "0.75rem",
                fontWeight: 600,
                borderRadius: 999,
                border: `1.5px solid ${activeCategory === cat ? "var(--orange)" : "var(--border)"}`,
                background: activeCategory === cat ? "var(--orange-light)" : "#f9fafb",
                color: activeCategory === cat ? "var(--orange-dark)" : "var(--ink-3)",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {/* Menu items */}
      <div style={{ padding: "0.75rem 1rem", display: "flex", flexDirection: "column", gap: "0.6rem", paddingBottom: cartCount > 0 ? "8rem" : "5rem" }}>
        {menuLoading && (
          <div style={{ textAlign: "center", color: "var(--ink-3)", padding: "2rem 0", fontSize: "0.85rem" }}>Loading menu…</div>
        )}
        {!menuLoading && menuError && (
          <div style={{ textAlign: "center", color: "#b91c1c", padding: "1.5rem 0", fontSize: "0.85rem" }}>{menuError}</div>
        )}
        {!menuLoading && !menuError && mealFilteredItems.length === 0 && (
          <div style={{ textAlign: "center", color: "var(--ink-3)", padding: "2.5rem 0", fontSize: "0.9rem" }}>
            <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>🍽️</div>
            {"No items available right now."}
          </div>
        )}
        {mealFilteredItems.map(item => {
          const inCart = cart.find(c => c.id === item.id);
          const isServerSoldOut = item.is_sold_out ?? false;
          const isOutOfStock = isClosed || isServerSoldOut;
          const opacity = isOutOfStock ? 0.65 : 1;

          // Determine item state
          let itemState: "available" | "out_of_stock" | "not_available" = "available";
          let statusBadgeLabel = "✓ Available";
          let statusBadgeColor = "#ecfdf5";
          let statusBadgeTextColor = "#15803d";
          let statusBadgeBorder = "#a7f3d0";
          let buttonLabel = "ADD";
          let buttonDisabled = isOutOfStock;

          if (isClosed) {
            itemState = "not_available";
            statusBadgeLabel = "🔒 Canteen Closed";
            statusBadgeColor = "#fef2f2";
            statusBadgeTextColor = "#991b1b";
            statusBadgeBorder = "#fca5a5";
            buttonLabel = "CLOSED";
          } else if (isServerSoldOut) {
            itemState = "out_of_stock";
            statusBadgeLabel = "⛔ Out of Stock";
            statusBadgeColor = "#fee2e2";
            statusBadgeTextColor = "#b91c1c";
            statusBadgeBorder = "#fca5a5";
            buttonLabel = "OUT OF STOCK";
          } else if (typeof item.remaining === "number" && item.remaining > 0) {
            // Live inventory count — ticks down within ~10s as other
            // students place orders. Below 5 portions: red urgency.
            // Below 15: amber heads-up. Otherwise: subtle green.
            if (item.remaining <= 5) {
              statusBadgeLabel = `⚡ Only ${item.remaining} left`;
              statusBadgeColor = "#fef2f2";
              statusBadgeTextColor = "#b91c1c";
              statusBadgeBorder = "#fca5a5";
            } else if (item.remaining <= 15) {
              statusBadgeLabel = `${item.remaining} left today`;
              statusBadgeColor = "#fffbeb";
              statusBadgeTextColor = "#a16207";
              statusBadgeBorder = "#fde68a";
            } else {
              statusBadgeLabel = `${item.remaining} available`;
              // keep default green
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
        <div style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 430, padding: "0.75rem 1rem", background: "var(--surface)", borderTop: "1px solid var(--border)", zIndex: 35, pointerEvents: "none" }}>
          <Link href={cartHref} style={{ textDecoration: "none", pointerEvents: "auto" }}>
            <button className="btn btn-primary btn-full" style={{ padding: "0.85rem", fontSize: "0.95rem", display: "flex", justifyContent: "space-between", pointerEvents: "auto" }}>
              <span>🛒 {cartCount} item{cartCount > 1 ? "s" : ""} in cart</span>
              <span>₹{cartTotal} →</span>
            </button>
          </Link>
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

// Canteen + menu data is loaded from Supabase per canteen — no seed data.
const CANTEEN_INFO: Record<string, { name: string; emoji: string; desc: string; status: "open" | "busy" | "closed" }> = {};

type MenuItem = {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  is_meal: boolean;
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
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then((j: { items: MenuItem[]; categories: string[] }) => {
        if (cancelled) return;
        setItems(j.items ?? []);
        setCategories(["All", ...(j.categories ?? [])]);
        setMenuError(null);
      })
      .catch(() => { if (!cancelled) setMenuError("Could not load menu items."); })
      .finally(() => { if (!cancelled) setMenuLoading(false); });
    return () => { cancelled = true; };
  }, [canteenId]);

  const visibleItems = activeCategory === "All"
    ? items
    : items.filter(i => i.category === activeCategory);

  const [cart, setCart] = useState<CartItem[]>([]);

  const addItem = (item: { id: string; name: string; price: number }) => {
    if (isClosed) return; // guard: never add to closed canteen
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
        {menuLoading && (
          <div style={{ textAlign: "center", color: "var(--ink-3)", padding: "2rem 0", fontSize: "0.85rem" }}>Loading menu…</div>
        )}
        {!menuLoading && menuError && (
          <div style={{ textAlign: "center", color: "#b91c1c", padding: "1.5rem 0", fontSize: "0.85rem" }}>{menuError}</div>
        )}
        {!menuLoading && !menuError && visibleItems.length === 0 && (
          <div style={{ textAlign: "center", color: "var(--ink-3)", padding: "2.5rem 0", fontSize: "0.9rem" }}>
            <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>🍽️</div>
            No items available right now.
          </div>
        )}
        {visibleItems.map(item => {
          const inCart = cart.find(c => c.id === item.id);
          return (
            <div key={item.id} className="card" style={{ display: "flex", gap: "0.75rem", alignItems: "center", opacity: isClosed ? 0.6 : 1 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", marginBottom: "0.15rem" }}>
                  <span style={{ fontWeight: 700, fontSize: "0.9rem" }}>{item.name}</span>
                  {item.is_meal && <span style={{ fontSize: "0.65rem", color: "var(--orange)", fontWeight: 700 }}>MEAL</span>}
                </div>
                <div style={{ fontSize: "0.75rem", color: "var(--ink-3)", marginBottom: "0.25rem" }}>{item.description}</div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap", marginBottom: "0.25rem" }}>
                  <span style={{ fontSize: "0.68rem", fontWeight: 700, padding: "0.1rem 0.4rem", borderRadius: 999, background: "#ecfdf5", color: "#15803d", border: "1px solid #a7f3d0" }}>
                    ⚡ Available in next slot
                  </span>
                </div>
                <div style={{ fontWeight: 700, fontSize: "0.9rem" }}>₹{item.price}</div>
              </div>
              <div>
                {isClosed ? (
                  <button disabled className="btn btn-outline" style={{ padding: "0.35rem 0.75rem", fontSize: "0.82rem", opacity: 0.45, cursor: "not-allowed" }}>ADD</button>
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

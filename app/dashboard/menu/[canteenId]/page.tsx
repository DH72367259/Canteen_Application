"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

const CANTEEN_INFO: Record<string, { name: string; emoji: string; desc: string; status: "open" | "busy" | "closed" }> = {
  c1: { name: "Main Canteen",       emoji: "🍱", desc: "Breakfast · Lunch · Dinner",  status: "open"   },
  c2: { name: "Snack Corner",       emoji: "☕", desc: "Snacks · Tea · Coffee",        status: "busy"   },
  c3: { name: "Hostel Mess",        emoji: "🥘", desc: "Breakfast · Dinner",           status: "open"   },
  c4: { name: "Ground Floor Cafe",  emoji: "🥗", desc: "All Day Dining",              status: "closed" },
};

const MENU: Record<string, { id: string; name: string; price: number; desc: string; veg: boolean; category: string }[]> = {
  breakfast: [
    { id: "b1", name: "Poha", price: 30, desc: "Flattened rice with peas, onion & lemon", veg: true, category: "breakfast" },
    { id: "b2", name: "Idli Sambhar (4 pcs)", price: 45, desc: "Soft idli with hot sambhar and chutney", veg: true, category: "breakfast" },
    { id: "b3", name: "Paratha with Curd", price: 55, desc: "Butter paratha with fresh curd & pickle", veg: true, category: "breakfast" },
    { id: "b4", name: "Tea / Coffee", price: 15, desc: "Freshly brewed hot beverage", veg: true, category: "breakfast" },
  ],
  lunch: [
    { id: "l1", name: "Thali – Veg", price: 90, desc: "Dal, 2 sabzi, rice, roti, papad, pickle", veg: true, category: "lunch" },
    { id: "l2", name: "Paneer Butter Masala", price: 75, desc: "Rich tomato gravy with cottage cheese", veg: true, category: "lunch" },
    { id: "l3", name: "Roti (2 pcs)", price: 20, desc: "Freshly made whole wheat roti", veg: true, category: "lunch" },
    { id: "l4", name: "Chicken Curry", price: 110, desc: "Spiced chicken curry with gravy", veg: false, category: "lunch" },
    { id: "l5", name: "Lassi (Sweet)", price: 35, desc: "Chilled sweet lassi", veg: true, category: "lunch" },
  ],
  dinner: [
    { id: "d1", name: "Dinner Thali", price: 80, desc: "Dal, 1 sabzi, rice, roti, dessert", veg: true, category: "dinner" },
    { id: "d2", name: "Khichdi", price: 55, desc: "Comforting moong dal khichdi with ghee", veg: true, category: "dinner" },
    { id: "d3", name: "Egg Curry", price: 65, desc: "Spiced egg curry with 2 eggs", veg: false, category: "dinner" },
  ],
};

type CartItem = { id: string; name: string; price: number; qty: number };

export default function CanteenMenuPage() {
  const params = useParams();
  const router = useRouter();
  const canteenId = (params.canteenId as string) || "c1";
  const info = CANTEEN_INFO[canteenId] || CANTEEN_INFO.c1;
  const isClosed = info.status === "closed";

  const [meal, setMeal] = useState<"breakfast" | "lunch" | "dinner">("lunch");
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

      {/* Meal tabs */}
      <div className="meal-tabs">
        {(["breakfast", "lunch", "dinner"] as const).map(m => (
          <button key={m} className={`meal-tab ${meal === m ? "active" : ""}`} onClick={() => setMeal(m)}>
            {m === "breakfast" ? "🌅 Breakfast" : m === "lunch" ? "☀️ Lunch" : "🌙 Dinner"}
          </button>
        ))}
      </div>

      {/* Menu items */}
      <div style={{ padding: "0.75rem 1rem", display: "flex", flexDirection: "column", gap: "0.6rem", paddingBottom: cartCount > 0 ? "8rem" : "5rem" }}>
        {MENU[meal].map(item => {
          const inCart = cart.find(c => c.id === item.id);
          return (
            <div key={item.id} className="card" style={{ display: "flex", gap: "0.75rem", alignItems: "center", opacity: isClosed ? 0.6 : 1 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", marginBottom: "0.15rem" }}>
                  <span style={{ width: 10, height: 10, borderRadius: "50%", border: `2px solid ${item.veg ? "var(--green)" : "var(--red)"}`, backgroundColor: item.veg ? "var(--green)" : "var(--red)", flexShrink: 0 }} />
                  <span style={{ fontWeight: 700, fontSize: "0.9rem" }}>{item.name}</span>
                </div>
                <div style={{ fontSize: "0.75rem", color: "var(--ink-3)", marginBottom: "0.25rem" }}>{item.desc}</div>
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

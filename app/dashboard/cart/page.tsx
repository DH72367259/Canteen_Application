"use client";

import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useAuth } from "@/lib/auth-context";

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Razorpay: new (opts: any) => { open(): void };
  }
}

interface CartItem { id: string; name: string; price: number; qty: number; }

const SLOTS = [
  { id: "s1", label: "12:30 PM", available: true  },
  { id: "s2", label: "1:00 PM",  available: true  },
  { id: "s3", label: "1:30 PM",  available: true  },
  { id: "s4", label: "2:00 PM",  available: false },
];

function loadRazorpay(): Promise<boolean> {
  return new Promise(resolve => {
    if (typeof window !== "undefined" && window.Razorpay) { resolve(true); return; }
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload  = () => resolve(true);
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
}

function CartContent() {
  const router  = useRouter();
  const params  = useSearchParams();
  const { user } = useAuth();

  const canteenId   = params.get("canteenId")  || "";
  const canteenName = params.get("canteenName") ? decodeURIComponent(params.get("canteenName")!) : "Canteen";

  const [cart, setCart] = useState<CartItem[]>(() => {
    const raw = params.get("cart");
    if (!raw) return [];
    return raw.split(",").map(chunk => {
      const parts = chunk.split(":");
      return { id: parts[0], name: decodeURIComponent(parts[1] || ""), price: Number(parts[2]), qty: Number(parts[3]) };
    }).filter(c => c.id && c.qty > 0 && !isNaN(c.price));
  });

  const [slot,        setSlot]        = useState<string | null>(null);
  const [walletBal]                   = useState(12);
  const [useWallet,   setUseWallet]   = useState(false);
  const [isPro,       setIsPro]       = useState(false);
  const [showProCard, setShowProCard] = useState(true);
  const [busy,        setBusy]        = useState(false);
  const [error,       setError]       = useState<string | null>(null);

  useEffect(() => {
    const proStatus = localStorage.getItem("noqx_pro_active");
    if (proStatus === "true") setIsPro(true);
  }, []);

  const convFee    = isPro ? 0 : 4;
  const subtotal   = cart.reduce((s, c) => s + c.price * c.qty, 0);
  const walletDisc = useWallet ? Math.min(walletBal, subtotal) : 0;
  const payable    = Math.max(0, subtotal + convFee - walletDisc);

  function updateQty(id: string, delta: number) {
    setCart(prev => prev.map(c => c.id === id ? { ...c, qty: c.qty + delta } : c).filter(c => c.qty > 0));
  }

  async function finaliseOrder(paymentId: string) {
    const otp      = String(Math.floor(1000 + Math.random() * 9000));
    const bin      = `Bin ${Math.floor(Math.random() * 8) + 1}`;
    const binCode  = `#${["RED", "BLU", "GRN", "YEL"][Math.floor(Math.random() * 4)]}0${Math.floor(Math.random() * 8) + 1}`;
    const orderId  = `ORD-${Date.now().toString(36).toUpperCase()}`;
    const slotLabel = SLOTS.find(s => s.id === slot)?.label || "";

    const orderData = {
      id: orderId, bin, binCode, otp, slot: slotLabel,
      items: cart.map(c => `${c.name} x${c.qty}`).join(", "),
      itemsList: cart.map(c => ({ name: c.name, qty: c.qty, price: c.price })),
      canteen: canteenName, status: "preparing",
      paymentId, total: payable,
    };

    localStorage.setItem("canteen_active_order", JSON.stringify(orderData));

    const txns = JSON.parse(localStorage.getItem("canteen_transactions") || "[]");
    txns.unshift({
      orderId, paymentId, amount: payable, canteen: canteenName,
      items: cart.map(c => `${c.name} x${c.qty}`).join(", "),
      slot: slotLabel, bin, status: "paid", refundStatus: null,
      timestamp: new Date().toISOString(),
    });
    localStorage.setItem("canteen_transactions", JSON.stringify(txns.slice(0, 100)));

    setBusy(false);
    router.push("/dashboard/order-status");
  }

  async function handleCheckout() {
    if (!slot)            { setError("Please choose a pickup time slot."); return; }
    if (cart.length === 0) { setError("Your cart is empty."); return; }
    setBusy(true);
    setError(null);

    if (payable === 0) { await finaliseOrder("WALLET"); return; }

    const loaded = await loadRazorpay();
    if (!loaded) {
      setError("Payment gateway failed to load. Check your internet connection.");
      setBusy(false);
      return;
    }

    let orderData: { orderId: string; amount: number; currency: string; keyId: string };
    try {
      const res = await fetch("/api/payments/razorpay-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: payable, canteenId, userId: user?.uid || "guest", slotId: slot }),
      });
      const json = await res.json();
      if (!res.ok || !json.orderId) {
        setError(json.error || "Could not initiate payment. Please try again.");
        setBusy(false);
        return;
      }
      orderData = json;
    } catch {
      setError("Network error. Please try again.");
      setBusy(false);
      return;
    }

    const rzp = new window.Razorpay({
      key:         orderData.keyId,
      amount:      orderData.amount,
      currency:    orderData.currency,
      name:        "Canteen-Application",
      description: `Order from ${canteenName}`,
      order_id:    orderData.orderId,
      prefill:     { name: user?.displayName || "", email: user?.email || "" },
      theme:       { color: "#f97316" },
      modal: {
        ondismiss: () => {
          setBusy(false);
          setError("Payment was cancelled. Your cart is still saved.");
        },
      },
      handler: async (resp: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => {
        try {
          const verifyRes = await fetch("/api/payments/razorpay-verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              razorpay_order_id:   resp.razorpay_order_id,
              razorpay_payment_id: resp.razorpay_payment_id,
              razorpay_signature:  resp.razorpay_signature,
            }),
          });
          const vd = await verifyRes.json();
          if (!verifyRes.ok || !vd.success) {
            await fetch("/api/payments/razorpay-refund", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ paymentId: resp.razorpay_payment_id, amount: payable, reason: "order_not_confirmed" }),
            });
            setError("Payment received but could not be confirmed. A full refund has been initiated automatically and will reach you within 5-7 business days.");
            setBusy(false);
            return;
          }
          await finaliseOrder(resp.razorpay_payment_id);
        } catch {
          setError("Verification error. If money was debited, it will be auto-refunded within 5-7 business days. Payment ID: " + resp.razorpay_payment_id);
          setBusy(false);
        }
      },
    });
    rzp.open();
  }

  if (cart.length === 0) {
    return (
      <div className="app-shell" style={{ alignItems: "center", justifyContent: "center", textAlign: "center", padding: "3rem 1rem" }}>
        <div style={{ fontSize: "3rem", marginBottom: "0.75rem" }}>🛒</div>
        <h2 style={{ fontWeight: 800, marginBottom: "0.5rem" }}>Your cart is empty</h2>
        <p style={{ color: "var(--ink-3)", marginBottom: "1.5rem", fontSize: "0.9rem" }}>Browse a canteen and add items to get started.</p>
        <button className="btn btn-primary" onClick={() => router.push("/dashboard")}>Browse Canteens</button>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="topbar">
        <button onClick={() => router.back()} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "1.2rem", color: "var(--ink-3)", padding: "0.25rem" }}>←</button>
        <h1 style={{ fontSize: "1rem", fontWeight: 700 }}>Checkout · {canteenName}</h1>
        <div />
      </div>

      <div style={{ padding: "0 1rem 7rem", display: "flex", flexDirection: "column", gap: "1rem" }}>

        <section>
          <h2 style={{ fontSize: "0.82rem", fontWeight: 700, color: "var(--ink-3)", textTransform: "uppercase", marginBottom: "0.6rem" }}>Your Items</h2>
          {cart.map(item => (
            <div key={item.id} className="card" style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.75rem", marginBottom: "0.5rem" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: "0.9rem" }}>{item.name}</div>
                <div style={{ fontSize: "0.8rem", color: "var(--ink-3)" }}>₹{item.price} × {item.qty}</div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <button onClick={() => updateQty(item.id, -1)} style={{ width: 28, height: 28, borderRadius: "50%", border: "1.5px solid var(--orange)", background: "none", color: "var(--orange)", fontSize: "1rem", cursor: "pointer" }}>−</button>
                <span style={{ fontWeight: 700, minWidth: 16, textAlign: "center" }}>{item.qty}</span>
                <button onClick={() => updateQty(item.id, +1)} style={{ width: 28, height: 28, borderRadius: "50%", border: "none", background: "var(--orange)", color: "#fff", fontSize: "1rem", cursor: "pointer" }}>+</button>
              </div>
              <div style={{ fontWeight: 800, fontSize: "0.95rem", minWidth: 44, textAlign: "right" }}>₹{item.price * item.qty}</div>
            </div>
          ))}
        </section>

        <section>
          <h2 style={{ fontSize: "0.82rem", fontWeight: 700, color: "var(--ink-3)", textTransform: "uppercase", marginBottom: "0.6rem" }}>Pickup Time Slot</h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
            {SLOTS.map(s => (
              <button key={s.id} disabled={!s.available} onClick={() => setSlot(s.id)}
                style={{ padding: "0.5rem 0.9rem", borderRadius: 10, border: `1.5px solid ${slot === s.id ? "var(--orange)" : "var(--border)"}`, background: slot === s.id ? "var(--orange)" : "var(--surface)", color: slot === s.id ? "#fff" : s.available ? "var(--ink)" : "var(--ink-3)", fontWeight: 600, fontSize: "0.85rem", cursor: s.available ? "pointer" : "not-allowed", opacity: s.available ? 1 : 0.45 }}>
                {s.label}{!s.available && <span style={{ fontSize: "0.7rem", marginLeft: 4 }}>Full</span>}
              </button>
            ))}
          </div>
        </section>

        {walletBal > 0 && (
          <section className="card" style={{ padding: "0.85rem" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: "0.9rem" }}>🎁 Use Canteen Cash</div>
                <div style={{ fontSize: "0.78rem", color: "var(--ink-3)" }}>₹{walletBal} available</div>
              </div>
              <button onClick={() => setUseWallet(w => !w)}
                style={{ width: 44, height: 24, borderRadius: 12, border: "none", cursor: "pointer", background: useWallet ? "var(--orange)" : "var(--border)", position: "relative", transition: "background 0.2s" }}>
                <span style={{ position: "absolute", top: 2, width: 20, height: 20, borderRadius: "50%", background: "#fff", transition: "left 0.2s", left: useWallet ? 22 : 2 }} />
              </button>
            </div>
            {useWallet && <div style={{ fontSize: "0.8rem", color: "var(--green)", marginTop: "0.5rem" }}>−₹{walletDisc} deducted from your wallet</div>}
          </section>
        )}

        {/* ── NoQx Pro card (non-Pro users only) ── */}
        {!isPro && showProCard && (
          <section style={{ background: "linear-gradient(135deg, #fff7ed, #fef3c7)", border: "2px solid #f97316", borderRadius: 16, padding: "1rem", position: "relative" }}>
            <button
              onClick={() => setShowProCard(false)}
              style={{ position: "absolute", top: "0.5rem", right: "0.6rem", background: "none", border: "none", fontSize: "1rem", color: "var(--ink-3)", cursor: "pointer", lineHeight: 1 }}
              aria-label="Dismiss"
            >✕</button>
            <div style={{ fontWeight: 800, fontSize: "0.95rem", color: "#92400e", marginBottom: "0.25rem" }}>💎 NoQx Pro</div>
            <div style={{ fontSize: "0.8rem", color: "#b45309", marginBottom: "0.75rem" }}>
              Skip queues all month · Pay ₹0 convenience fee per order · Just ₹49/month
            </div>
            <div style={{ fontSize: "0.72rem", color: "#92400e", marginBottom: "0.75rem", background: "#fef9c3", borderRadius: 8, padding: "0.35rem 0.6rem", display: "inline-block" }}>
              💡 You&apos;ll save ₹40+ this month
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <a
                href="/dashboard/pro"
                style={{ display: "block", textAlign: "center", background: "var(--orange)", color: "#fff", borderRadius: 12, padding: "0.65rem", fontSize: "0.9rem", fontWeight: 800, textDecoration: "none" }}
              >
                Get Pro & Save →
              </a>
              <button
                onClick={() => setShowProCard(false)}
                style={{ background: "none", border: "1.5px solid #f97316", borderRadius: 12, padding: "0.55rem", fontSize: "0.82rem", fontWeight: 600, color: "#c2410c", cursor: "pointer" }}
              >
                Continue without · ₹4 convenience fee
              </button>
            </div>
          </section>
        )}

        <section className="card" style={{ padding: "0.85rem" }}>
          <h2 style={{ fontSize: "0.82rem", fontWeight: 700, color: "var(--ink-3)", textTransform: "uppercase", marginBottom: "0.75rem" }}>Bill Summary</h2>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.88rem", marginBottom: "0.4rem" }}>
            <span>Subtotal</span><span>₹{subtotal}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.88rem", marginBottom: "0.4rem" }}>
            <span style={{ color: isPro ? "var(--green)" : "var(--ink)" }}>
              ⚡ Convenience fee {isPro && <span style={{ fontSize: "0.72rem", color: "var(--green)" }}>(Pro — free)</span>}
            </span>
            <span style={{ color: isPro ? "var(--green)" : "var(--ink)" }}>{isPro ? "₹0" : `₹${convFee}`}</span>
          </div>
          {useWallet && walletDisc > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.88rem", color: "var(--green)", marginBottom: "0.4rem" }}>
              <span>Canteen Cash</span><span>−₹{walletDisc}</span>
            </div>
          )}
          <div style={{ height: 1, background: "var(--border)", margin: "0.5rem 0" }} />
          <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800, fontSize: "1rem" }}>
            <span>Total Payable</span><span style={{ color: "var(--orange)" }}>₹{payable}</span>
          </div>
          <div style={{ fontSize: "0.72rem", color: "var(--ink-3)", marginTop: "0.35rem" }}>Online payment only · No cash accepted</div>
        </section>

        <section className="card" style={{ padding: "0.85rem" }}>
          <div style={{ fontSize: "0.78rem", color: "var(--ink-3)", marginBottom: "0.5rem", fontWeight: 600 }}>ACCEPTED PAYMENTS</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
            {["UPI / GPay / PhonePe", "Credit / Debit Card", "Net Banking", "Wallets"].map(m => (
              <span key={m} style={{ fontSize: "0.75rem", padding: "0.3rem 0.65rem", borderRadius: 8, border: "1px solid var(--border)", color: "var(--ink-3)" }}>{m}</span>
            ))}
          </div>
          <div style={{ fontSize: "0.7rem", color: "var(--ink-3)", marginTop: "0.5rem" }}>
            Secured by Razorpay · If payment fails, refund is processed automatically within 5–7 business days.
          </div>
        </section>

        {error && <p className="error-msg">{error}</p>}
      </div>

      <div style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 480, padding: "0.75rem 1rem", background: "var(--surface)", borderTop: "1px solid var(--border)", zIndex: 35 }}>
        <button className="btn btn-primary btn-full" disabled={busy || cart.length === 0} onClick={handleCheckout}
          style={{ padding: "0.9rem", fontSize: "1rem", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem" }}>
          {busy ? "Processing…" : payable === 0 ? "Place Order (Wallet)" : `Pay ₹${payable} via Razorpay →`}
        </button>
      </div>
    </div>
  );
}

export default function CartPage() {
  return (
    <Suspense fallback={<div className="loading-screen"><div className="spinner" /></div>}>
      <CartContent />
    </Suspense>
  );
}

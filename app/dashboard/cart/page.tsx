"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useAuth } from "@/lib/auth-context";
import { upsertActiveOrder } from "@/lib/activeOrdersClient";

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Razorpay: new (opts: any) => { open(): void };
  }
}

interface CartItem { id: string; name: string; price: number; qty: number; }
interface SlotOption { id: string; label: string; available: boolean; is_full: boolean; }
interface CartCheck {
  slot_available: boolean;
  slot_full: boolean;
  slot_orders_used: number;
  slot_capacity: { maxOrdersPerSlot: number };
  bin_plan: { bins: { binIndex: number }[] };
  requires_extra_bin: boolean;
  extra_fee_paise: number;
}

function loadRazorpay(): Promise<boolean> {
  return new Promise(resolve => {
    if (typeof window === "undefined") { resolve(false); return; }
    if (window.Razorpay) { resolve(true); return; }
    // Reuse an in-flight script tag if a previous call is still pending,
    // otherwise the second click would inject a second copy and Razorpay
    // would race-init. Idempotent loader pattern.
    const SCRIPT_ID = "razorpay-checkout-js";
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      if ((existing as HTMLScriptElement & { _loaded?: boolean })._loaded) { resolve(true); return; }
      existing.addEventListener("load", () => resolve(!!window.Razorpay), { once: true });
      existing.addEventListener("error", () => resolve(false), { once: true });
      return;
    }
    let attempts = 0;
    const tryLoad = () => {
      attempts++;
      const script = document.createElement("script");
      script.id = SCRIPT_ID;
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.async = true;
      script.crossOrigin = "anonymous";
      script.onload = () => {
        (script as HTMLScriptElement & { _loaded?: boolean })._loaded = true;
        resolve(!!window.Razorpay);
      };
      script.onerror = () => {
        // Drop the failed tag so the next attempt starts clean.
        script.remove();
        if (attempts < 3) {
          setTimeout(tryLoad, 600 * attempts);
        } else {
          resolve(false);
        }
      };
      document.head.appendChild(script);
    };
    tryLoad();
  });
}

function CartContent() {
  const router  = useRouter();
  const params  = useSearchParams();
  const { user, session } = useAuth();

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
  const [slots,       setSlots]       = useState<SlotOption[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(true);
  // Real-time slot availability: maps slot.id → whether it has capacity for current cart
  const [slotCapacity, setSlotCapacity] = useState<Record<string, { available: boolean; ordersUsed: number; maxCapacity: number }>>({});
  // Wallet / Canteen-cash payments removed from the user app per revised
  // workflow. State hooks deleted to avoid unused-variable lint errors.
  const [isPro,       setIsPro]       = useState(false);
  // "go_pro" = user selected the ₹69/mo upsell; "skip" = continue without (pay ₹4)
  const [proChoice,   setProChoice]   = useState<"go_pro" | "skip">("skip");
  const [busy,        setBusy]        = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const [cartCheck,   setCartCheck]   = useState<CartCheck | null>(null);
  // Phase 7: extra-bin popup acknowledgement. The PDF requires a confirm step
  // when an order needs >1 bin, so the student knows about the +₹2/bin fee
  // before they're charged.
  const [showExtraBinModal, setShowExtraBinModal] = useState(false);
  const slotCapacityRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const proStatus = localStorage.getItem("noqx_pro_active");
    if (proStatus === "true") setIsPro(true);
  }, []);

  // Preload Razorpay checkout.js as soon as the cart mounts so the click on
  // "Pay" feels instant and we surface CDN failures (network/CSP/AdBlock) up
  // We no longer eagerly preload the Razorpay SDK — it's only loaded if the
  // server says we're not in PAYMENT_TEST_MODE (see handleCheckout below).
  // This avoids a noisy "Couldn't load Razorpay" error when the SDK is
  // unreachable but the server is in test mode anyway.

  // ── Fetch live slots from canteen, auto-refresh every 60s ──────────────
  useEffect(() => {
    if (!canteenId) return;
    let cancelled = false;
    async function fetchSlots() {
      setSlotsLoading(true);
      try {
        const res = await fetch(`/api/slots?canteenId=${encodeURIComponent(canteenId)}`);
        const json = await res.json();
        if (!cancelled && Array.isArray(json.slots)) {
          setSlots(json.slots);
          // Auto-select first available slot if current selection is gone
          setSlot(prev => {
            const stillValid = json.slots.some((s: SlotOption) => s.id === prev && s.available);
            if (stillValid) return prev;
            const first = json.slots.find((s: SlotOption) => s.available);
            return first ? first.id : null;
          });
        }
      } finally {
        if (!cancelled) setSlotsLoading(false);
      }
    }
    fetchSlots();
    const timer = setInterval(fetchSlots, 60_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [canteenId]);

  // ── Real-time slot capacity checking (2 seconds) ─────────────────────────────
  // Check each slot to see if current cart fits. Disable slots that are full.
  useEffect(() => {
    if (!canteenId || cart.length === 0 || !session?.access_token) {
      setSlotCapacity({});
      return;
    }

    const checkSlotCapacity = async () => {
      try {
        const capacityMap: Record<string, { available: boolean; ordersUsed: number; maxCapacity: number }> = {};

        // Check each slot for current cart
        for (const slotOption of slots) {
          const res = await fetch("/api/cart/check", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
            body: JSON.stringify({
              canteen_id: canteenId,
              slot: slotOption.label,
              items: cart.map(c => ({ id: c.id, quantity: c.qty })),
            }),
          });

          if (res.ok) {
            const data = await res.json();
            capacityMap[slotOption.id] = {
              available: !data.slot_full && !data.requires_extra_bin,
              ordersUsed: data.slot_orders_used || 0,
              maxCapacity: data.slot_capacity?.maxOrdersPerSlot || 0,
            };
          }
        }

        setSlotCapacity(capacityMap);
      } catch {
        // Silently ignore errors, keep showing previous state
      }
    };

    checkSlotCapacity();
    slotCapacityRef.current = setInterval(checkSlotCapacity, 2_000);

    return () => {
      if (slotCapacityRef.current) clearInterval(slotCapacityRef.current);
    };
  }, [canteenId, cart, slots, session?.access_token]);

  // ── Pre-checkout cart check: slot fullness + extra-bin plan ────────────
  useEffect(() => {
    if (!canteenId || !slot || cart.length === 0 || !session?.access_token) {
      setCartCheck(null);
      return;
    }
    const slotLabel = slots.find(s => s.id === slot)?.label;
    if (!slotLabel) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/cart/check", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({
            canteen_id: canteenId,
            slot: slotLabel,
            items: cart.map(c => ({ id: c.id, quantity: c.qty })),
          }),
        });
        if (!cancelled && res.ok) setCartCheck(await res.json());
      } catch { /* non-fatal */ }
    })();
    return () => { cancelled = true; };
  }, [canteenId, slot, slots, cart, session?.access_token]);

  // Convenience fee waiver: existing Pro members AND students who are
  // bundling a Pro subscription with this checkout (proChoice === "go_pro")
  // both get ₹0 convenience fee. Per revised workflow: "When selected
  // 69/month convenience fee must be zero (must only pay Items price + Pro price)".
  const proSelectedNow = !isPro && proChoice === "go_pro";
  const convFee    = (isPro || proSelectedNow) ? 0 : 4;
  const proAddon   = proSelectedNow ? 69 : 0;
  const subtotal   = cart.reduce((s, c) => s + c.price * c.qty, 0);
  const extraBinFee = cartCheck ? Math.round(cartCheck.extra_fee_paise / 100) : 0;
  const payable    = Math.max(0, subtotal + convFee + extraBinFee + proAddon);

  function updateQty(id: string, delta: number) {
    setCart(prev => prev.map(c => c.id === id ? { ...c, qty: c.qty + delta } : c).filter(c => c.qty > 0));
  }

  async function finaliseOrder(
    paymentId: string,
    razorpayOrderId?: string,
    razorpaySignature?: string
  ) {
    const slotLabel = slots.find(s => s.id === slot)?.label || "";

    // Create the order in Supabase via API
    let orderId: string;
    let otp: string;
    let bin: string;
    let binCode: string;
    let responseBins: Array<{ binIndex: number; binLabel: string; binCode: string; binColor: string; items: Array<{ name: string; quantity: number; isMeal?: boolean }> }> | undefined;
    let responseBinCount = 1;
    let responseExtraFeePaise = 0;

    try {
      const res = await fetch("/api/orders/place", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          canteenId,
          cartItems: cart,
          total: payable,
          slotLabel,
          paymentId,
          razorpayOrderId,
          razorpaySignature,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.orderId) {
        console.error("Place order error:", json);
        setError("Failed to confirm order. Please contact canteen staff.");
        setBusy(false);
        return;
      }
      orderId = json.orderId;
      otp = json.otp;
      // PDF page 10: bin codes are canonical "#RED001" / "#GRE004" — the API
      // returns the row's bin_code as `binLabel`, so we use it as-is for both
      // the friendly bin display and the monospace bin code chip.
      bin = `Bin ${json.binLabel}`;
      binCode = json.binCode ?? json.binLabel ?? "";
      // Phase 7: persist per-bin breakdown for the order-status screen.
      responseBins = Array.isArray(json.bins) ? json.bins : undefined;
      responseBinCount = Number(json.binCount) || (responseBins?.length ?? 1);
      responseExtraFeePaise = Number(json.extraBinFeePaise) || 0;
    } catch (err) {
      console.error("Place order network error:", err);
      setError("Network error placing order. Please try again.");
      setBusy(false);
      return;
    }

    const orderData = {
      id: orderId, bin, binCode, otp, slot: slotLabel,
      items: cart.map(c => `${c.name} x${c.qty}`).join(", "),
      itemsList: cart.map(c => ({ name: c.name, qty: c.qty, price: c.price })),
      canteen: canteenName, status: "preparing",
      paymentId, total: payable,
      // Phase 7: per-bin breakdown shown on /dashboard/order-status
      bins: responseBins,
      binCount: responseBinCount,
      extraBinFeePaise: responseExtraFeePaise,
      // Bug fix: tag with the placing user's uid so a different (or deleted)
      // user signing in on the same browser doesn't inherit this banner.
      uid: user?.uid ?? null,
    };

    upsertActiveOrder(orderData);

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
    if (cartCheck?.slot_full) { setError("This slot just filled up. Please pick another."); return; }

    // Phase 7: extra-bin acknowledgement gate. If the cart needs >1 bin and
    // the modal hasn't been confirmed yet, show it instead of proceeding to
    // payment. The user picks Continue (sets ack → re-runs handleCheckout)
    // or Adjust Order (closes the modal, lets them edit quantities).
    if (cartCheck?.requires_extra_bin && !showExtraBinModal && !busy) {
      // Re-open the modal only if the user hasn't already passed it. We use
      // a transient "ack" via clearing requires_extra_bin in a ref-style
      // boolean: the simplest route is a sessionStorage flag keyed on cart
      // signature so re-renders don't re-prompt.
      const sig = `${canteenId}:${cart.map(c => `${c.id}x${c.qty}`).join(",")}:${slot}`;
      const acked = typeof window !== "undefined" && sessionStorage.getItem("extra_bin_ack") === sig;
      if (!acked) {
        setShowExtraBinModal(true);
        return;
      }
    }

    setBusy(true);
    setError(null);

    if (payable === 0) { await finaliseOrder("FREE"); return; }

    // 1. Create the Razorpay (or test-mode) order FIRST. The server tells us
    //    whether we're in test mode — if we are, we skip loading the SDK
    //    entirely so a blocked CDN / ad-blocker doesn't break testing.
    let orderData: { orderId: string; amount: number; currency: string; keyId: string; testMode?: boolean };
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

    // ── DUMMY MODE ─────────────────────────────────────────────────────────
    // The server returns testMode=true when PAYMENT_TEST_MODE is on (or no
    // Razorpay keys are configured). Skip the checkout popup entirely and
    // simulate a successful payment so end-to-end flows can be exercised.
    if (orderData.testMode) {
      const fakePaymentId = `pay_test_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      const fakeSignature = "test_sig";
      try {
        const verifyRes = await fetch("/api/payments/razorpay-verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            razorpay_order_id:   orderData.orderId,
            razorpay_payment_id: fakePaymentId,
            razorpay_signature:  fakeSignature,
          }),
        });
        const vd = await verifyRes.json();
        if (!verifyRes.ok || !vd.success) {
          setError("Test payment verification failed.");
          setBusy(false);
          return;
        }
        if (proAddon > 0 && session?.access_token) {
          try {
            await fetch("/api/subscriptions", {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
              body: JSON.stringify({ paymentId: fakePaymentId, amount: 69 }),
            });
            const expiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
            localStorage.setItem("noqx_pro_active", "true");
            localStorage.setItem("noqx_pro_expires", expiry);
          } catch { /* webhook will reconcile */ }
        }
        await finaliseOrder(fakePaymentId, orderData.orderId, fakeSignature);
      } catch {
        setError("Test payment failed unexpectedly.");
        setBusy(false);
      }
      return;
    }

    // 2. Real Razorpay path — only here do we need the SDK.
    const loaded = await loadRazorpay();
    if (!loaded) {
      setError("Couldn't load Razorpay. This is usually caused by an ad-blocker or unstable network — please disable any blocker for this site, check your connection, and try again.");
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
          // If user opted into Pro at checkout, activate the subscription
          // server-side BEFORE finalising the order so the conv-fee waiver
          // and Pro badge apply immediately to subsequent orders.
          if (proAddon > 0 && session?.access_token) {
            try {
              await fetch("/api/subscriptions", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
                body: JSON.stringify({ paymentId: resp.razorpay_payment_id, amount: 69 }),
              });
              const expiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
              localStorage.setItem("noqx_pro_active", "true");
              localStorage.setItem("noqx_pro_expires", expiry);
            } catch { /* non-fatal: webhook will reconcile */ }
          }
          await finaliseOrder(resp.razorpay_payment_id, resp.razorpay_order_id, resp.razorpay_signature);
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
          <h2 style={{ fontSize: "0.82rem", fontWeight: 700, color: "var(--ink-3)", textTransform: "uppercase", marginBottom: "0.6rem" }}>Choose ready time</h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
            {slotsLoading ? (
              <span style={{ fontSize: "0.82rem", color: "var(--ink-3)" }}>Loading slots…</span>
            ) : slots.length === 0 ? (
              <span style={{ fontSize: "0.82rem", color: "var(--orange)", fontWeight: 600 }}>No slots available right now. Check back later.</span>
            ) : slots.map(s => {
              const capacity = slotCapacity[s.id];
              const isFull = capacity && !capacity.available;
              const isDisabled = !s.available || isFull;

              return (
                <div key={s.id} style={{ position: "relative" }}>
                  <button
                    disabled={isDisabled}
                    onClick={() => setSlot(s.id)}
                    title={isFull ? "Not enough bins for your order" : s.label}
                    style={{
                      padding: "0.65rem 0.9rem",
                      borderRadius: 10,
                      border: `1.5px solid ${slot === s.id ? "var(--orange)" : isFull ? "#d1d5db" : "var(--border)"}`,
                      background: slot === s.id ? "var(--orange)" : isFull ? "#f9fafb" : "var(--surface)",
                      color: slot === s.id ? "#fff" : isFull ? "#9ca3af" : "var(--ink)",
                      fontWeight: 600,
                      fontSize: "0.85rem",
                      cursor: isDisabled ? "not-allowed" : "pointer",
                      opacity: isDisabled ? 0.5 : 1,
                      transition: "all 0.2s ease",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: "0.25rem",
                      minWidth: "80px",
                    }}
                  >
                    <span>{s.label}</span>
                    {capacity && (
                      <span style={{ fontSize: "0.68rem", opacity: 0.7, fontWeight: 500 }}>
                        {capacity.ordersUsed}/{capacity.maxCapacity} bins
                      </span>
                    )}
                  </button>
                  {isFull && (
                    <div style={{
                      position: "absolute",
                      top: "-20px",
                      left: "50%",
                      transform: "translateX(-50%)",
                      background: "#dc2626",
                      color: "#fff",
                      padding: "0.25rem 0.5rem",
                      borderRadius: "4px",
                      fontSize: "0.65rem",
                      fontWeight: 700,
                      whiteSpace: "nowrap",
                      zIndex: 10,
                    }}>
                      FULL 🔴
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Show available slots hint */}
          {cart.length > 0 && Object.values(slotCapacity).some(c => !c.available) && (
            <div style={{ marginTop: "0.75rem", padding: "0.6rem 0.75rem", background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: 8, fontSize: "0.78rem", color: "#92400e" }}>
              <strong>💡 Tip:</strong> Reduce order quantity to enable more slots. Current order doesn't fit in {Object.values(slotCapacity).filter(c => !c.available).length} slots.
            </div>
          )}
        </section>

        {/* ── Slot full / extra-bin notices ────────────────────────────── */}
        {cartCheck?.slot_full && (
          <div className="card" style={{ padding: "0.85rem", border: "1.5px solid #dc2626", background: "#fef2f2" }}>
            <div style={{ fontWeight: 700, color: "#991b1b", marginBottom: "0.25rem" }}>⚠️ Slot just filled up</div>
            <div style={{ fontSize: "0.82rem", color: "#7f1d1d" }}>
              {cartCheck.slot_orders_used}/{cartCheck.slot_capacity.maxOrdersPerSlot} orders booked. Please pick a different slot to continue.
            </div>
          </div>
        )}
        {cartCheck?.requires_extra_bin && !cartCheck.slot_full && (
          <div className="card" style={{ padding: "0.85rem", border: "1.5px solid #f97316", background: "#fff7ed" }}>
            <div style={{ fontWeight: 700, color: "#9a3412", marginBottom: "0.25rem" }}>
              📦 Your order needs {cartCheck.bin_plan.bins.length} pickup bins
            </div>
            <div style={{ fontSize: "0.82rem", color: "#7c2d12" }}>
              An extra-bin fee of <strong>₹{extraBinFee}</strong> will be added at checkout.
            </div>
          </div>
        )}

        {/* Wallet/Canteen-Cash UI removed — payments are direct via Razorpay UPI/Card. */}

        {/* ── NoQx Pro upsell (radio choice, non-Pro users only) ── */}
        {!isPro && (
          <section className="card" style={{ padding: "1rem", border: "2px solid #f97316" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.75rem" }}>
              <span style={{ fontSize: "1rem" }}>💎</span>
              <span style={{ fontWeight: 800, fontSize: "0.95rem", color: "#92400e" }}>NoQx Pro</span>
            </div>

            {/* Go Pro option */}
            <label
              style={{
                display: "flex", alignItems: "flex-start", gap: "0.75rem",
                border: `2px solid ${proChoice === "go_pro" ? "#f97316" : "var(--border)"}`,
                borderRadius: 12, padding: "0.85rem", marginBottom: "0.5rem",
                cursor: "pointer", background: proChoice === "go_pro" ? "#fff7ed" : "#fff",
              }}
            >
              <input
                type="radio"
                name="pro_choice"
                value="go_pro"
                checked={proChoice === "go_pro"}
                onChange={() => setProChoice("go_pro")}
                style={{ marginTop: 2, accentColor: "#f97316", flexShrink: 0 }}
              />
              <div>
                <div style={{ fontWeight: 700, fontSize: "0.88rem", color: "var(--ink)" }}>
                  Go Pro &amp; Save
                </div>
                <div style={{ fontSize: "0.78rem", color: "var(--ink-3)", marginTop: "0.15rem" }}>
                  Skip queues all month · Pay ₹0 convenience fee per order
                </div>
                <div style={{ fontWeight: 800, fontSize: "0.88rem", color: "#f97316", marginTop: "0.2rem" }}>
                  Just ₹69/month
                </div>
                {proChoice === "go_pro" && (
                  <div style={{ fontSize: "0.72rem", color: "#16a34a", marginTop: "0.3rem", fontWeight: 600 }}>
                    💡 You&apos;ll save ₹40+ this month
                  </div>
                )}
              </div>
            </label>

            {/* Continue without option */}
            <label
              style={{
                display: "flex", alignItems: "flex-start", gap: "0.75rem",
                border: `2px solid ${proChoice === "skip" ? "var(--border)" : "var(--border)"}`,
                borderRadius: 12, padding: "0.7rem 0.85rem",
                cursor: "pointer", background: "#fff",
              }}
            >
              <input
                type="radio"
                name="pro_choice"
                value="skip"
                checked={proChoice === "skip"}
                onChange={() => setProChoice("skip")}
                style={{ marginTop: 2, accentColor: "#f97316", flexShrink: 0 }}
              />
              <div style={{ display: "flex", flex: 1, justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: "0.85rem", color: "var(--ink-3)", fontWeight: 500 }}>
                  Continue without
                </span>
                <span style={{ fontWeight: 700, fontSize: "0.85rem", color: "var(--ink)" }}>₹4 fee</span>
              </div>
            </label>
          </section>
        )}

        <section className="card" style={{ padding: "0.85rem" }}>
          <h2 style={{ fontSize: "0.82rem", fontWeight: 700, color: "var(--ink-3)", textTransform: "uppercase", marginBottom: "0.75rem" }}>Bill Summary</h2>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.88rem", marginBottom: "0.4rem" }}>
            <span>Subtotal</span><span>₹{subtotal}</span>
          </div>
          {extraBinFee > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.88rem", marginBottom: "0.4rem", color: "#9a3412" }}>
              <span>Extra-bin fee</span><span>+₹{extraBinFee}</span>
            </div>
          )}
          <div style={{ marginBottom: "0.4rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.88rem" }}>
              <span style={{ color: isPro ? "var(--green)" : "var(--ink)" }}>
                ⚡ Convenience fee {isPro && <span style={{ fontSize: "0.72rem", color: "var(--green)" }}>(Pro — free)</span>}
              </span>
              <span style={{ color: isPro ? "var(--green)" : "var(--ink)" }}>{isPro ? "₹0" : `₹${convFee}`}</span>
            </div>
            {!isPro && (
              <div style={{ fontSize: "0.7rem", color: "var(--green)", marginTop: "0.15rem" }}>
                Pro users pay ₹0
              </div>
            )}
          </div>
          {/* Wallet/Canteen-Cash bill row removed. */}
          {proAddon > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.88rem", marginBottom: "0.4rem", color: "#f97316" }}>
              <span>💎 NoQx Pro (1 month)</span><span>+₹{proAddon}</span>
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
          {busy ? "Processing…" : (!isPro && proChoice === "go_pro") ? "Get Pro & Save →" : payable === 0 ? "Place Order (Wallet)" : `Pay ₹${payable} via Razorpay →`}
        </button>
      </div>

      {/* ── Phase 7: Extra-bin acknowledgement modal ─────────────────────
          PDF requires this exact prompt before the user is charged. */}
      {showExtraBinModal && cartCheck?.requires_extra_bin && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: "1.5rem" }}>
          <div className="card" style={{ maxWidth: 360, width: "100%", padding: "1.4rem 1.25rem", background: "#fff", borderRadius: 18, boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
            <div style={{ textAlign: "center", marginBottom: "1rem" }}>
              <div style={{ fontSize: "2.5rem", marginBottom: "0.5rem" }}>📦</div>
              <h3 style={{ fontWeight: 800, fontSize: "1.05rem", marginBottom: "0.4rem", color: "#9a3412" }}>
                Extra pickup bin needed
              </h3>
              <p style={{ fontSize: "0.86rem", color: "var(--ink-3)", lineHeight: 1.4 }}>
                Larger orders may need an additional pickup bin for safe and faster collection.
              </p>
            </div>

            <div style={{ background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 12, padding: "0.7rem 0.85rem", marginBottom: "1rem", fontSize: "0.82rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.3rem" }}>
                <span style={{ color: "#7c2d12" }}>Bins required</span>
                <strong style={{ color: "#9a3412" }}>{cartCheck.bin_plan.bins.length}</strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "#7c2d12" }}>Extra-bin fee</span>
                <strong style={{ color: "#9a3412" }}>+₹{extraBinFee}</strong>
              </div>
            </div>

            <button
              onClick={() => {
                if (typeof window !== "undefined") {
                  const sig = `${canteenId}:${cart.map(c => `${c.id}x${c.qty}`).join(",")}:${slot ?? ""}`;
                  sessionStorage.setItem("extra_bin_ack", sig);
                }
                setShowExtraBinModal(false);
                // Re-trigger checkout immediately after ack
                setTimeout(() => { void handleCheckout(); }, 0);
              }}
              className="btn btn-primary btn-full"
              style={{ padding: "0.8rem", fontSize: "0.95rem", fontWeight: 800, marginBottom: "0.5rem" }}
            >
              Continue (pay +₹{extraBinFee})
            </button>
            <button
              onClick={() => { setShowExtraBinModal(false); setBusy(false); }}
              style={{ width: "100%", background: "none", border: "1.5px solid var(--border)", color: "var(--ink)", borderRadius: 12, padding: "0.7rem", fontWeight: 700, fontSize: "0.9rem", cursor: "pointer" }}
            >
              Adjust Order
            </button>
          </div>
        </div>
      )}
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

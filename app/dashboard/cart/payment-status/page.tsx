"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

type Status = "checking" | "success" | "failed";

function PaymentStatusContent() {
  const router = useRouter();
  const params = useSearchParams();
  // PhonePe passes the txnId we embedded in the redirectUrl
  const txnId = params.get("txnId");

  const [status, setStatus] = useState<Status>("checking");
  const [orderId, setOrderId] = useState("");
  const [bin, setBin]         = useState("");
  const [otp, setOtp]         = useState("");

  useEffect(() => {
    if (!txnId) { setStatus("failed"); return; }

    fetch(`/api/payments/phonepe-verify?txnId=${encodeURIComponent(txnId)}`)
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          const newOrderId = `ORD-${Date.now().toString(36).toUpperCase()}`;
          const newOtp     = String(Math.floor(100000 + Math.random() * 900000));
          const newBin     = `Bin #${Math.floor(Math.random() * 10) + 1}`;

          setOrderId(newOrderId);
          setOtp(newOtp);
          setBin(newBin);

          // Persist active order so dashboard shows it
          const stored = localStorage.getItem("canteen_pending_order");
          let items = "Your order";
          let slot  = "";
          if (stored) {
            try {
              const p = JSON.parse(stored);
              items = p.items || items;
              slot  = p.slot  || slot;
            } catch { /* ignore */ }
            localStorage.removeItem("canteen_pending_order");
          }

          localStorage.setItem("canteen_active_order", JSON.stringify({
            id: newOrderId, bin: newBin, otp: newOtp, items, slot,
          }));
          setStatus("success");
        } else {
          setStatus("failed");
        }
      })
      .catch(() => setStatus("failed"));
  }, [txnId]);

  /* ── Checking ── */
  if (status === "checking") {
    return (
      <div className="app-shell" style={{ alignItems: "center", justifyContent: "center", gap: "1rem" }}>
        <div className="spinner" />
        <p style={{ color: "var(--ink-3)", fontSize: "0.9rem" }}>Verifying your payment…</p>
      </div>
    );
  }

  /* ── Success ── */
  if (status === "success") {
    return (
      <div className="app-shell" style={{ alignItems: "center", justifyContent: "center", textAlign: "center", padding: "2rem 1rem" }}>
        <div style={{ fontSize: "3rem", marginBottom: "0.75rem" }}>✅</div>
        <h2 style={{ fontWeight: 900, fontSize: "1.3rem", marginBottom: "0.25rem" }}>Payment Successful!</h2>
        <p style={{ color: "var(--ink-3)", marginBottom: "1.5rem", fontSize: "0.9rem" }}>
          Order <strong>{orderId}</strong> is being prepared.
        </p>

        <div className="card" style={{ width: "100%", maxWidth: 320, marginBottom: "1.25rem", textAlign: "left" }}>
          <div style={{ fontSize: "0.72rem", color: "var(--ink-3)", fontWeight: 600, textTransform: "uppercase", marginBottom: "0.5rem" }}>
            Pickup Details
          </div>
          <div style={{ fontSize: "1.6rem", fontWeight: 900, color: "var(--orange)", letterSpacing: 4, marginBottom: "0.25rem" }}>
            {bin}
          </div>
          <div style={{ fontSize: "0.82rem", color: "var(--ink-3)" }}>Show this OTP to the vendor:</div>
          <div style={{ fontSize: "2.2rem", fontWeight: 900, letterSpacing: 8, color: "var(--ink)", marginTop: "0.25rem" }}>
            {otp}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", width: "100%", maxWidth: 320 }}>
          <button className="btn btn-primary btn-full" onClick={() => router.push("/dashboard/orders")}>
            View My Orders
          </button>
          <button className="btn btn-outline btn-full" onClick={() => router.push("/dashboard")}>
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  /* ── Failed ── */
  return (
    <div className="app-shell" style={{ alignItems: "center", justifyContent: "center", textAlign: "center", padding: "2rem 1rem" }}>
      <div style={{ fontSize: "3rem", marginBottom: "0.75rem" }}>❌</div>
      <h2 style={{ fontWeight: 900, fontSize: "1.3rem", marginBottom: "0.25rem" }}>Payment Failed</h2>
      <p style={{ color: "var(--ink-3)", marginBottom: "1.5rem", fontSize: "0.9rem" }}>
        Your payment could not be processed. No amount was deducted.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", width: "100%", maxWidth: 320 }}>
        <button className="btn btn-primary btn-full" onClick={() => router.back()}>Try Again</button>
        <button className="btn btn-outline btn-full" onClick={() => router.push("/dashboard")}>Go to Home</button>
      </div>
    </div>
  );
}

export default function PaymentStatusPage() {
  return (
    <Suspense fallback={<div className="loading-screen"><div className="spinner" /></div>}>
      <PaymentStatusContent />
    </Suspense>
  );
}

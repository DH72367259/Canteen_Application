"use client";

import { useState } from "react";

interface Props {
  orderId:    string;
  orderRef?:  string;
  amount?:    number;
  authToken:  string;
  onClose:    () => void;
  onSuccess?: (result: {
    refundStatus: "processed" | "failed" | "pending" | "not_required";
    refundId:     string | null;
  }) => void;
}

const PRESETS = [
  "Item out of stock",
  "Equipment failure (oven / fryer / etc.)",
  "Canteen closing early",
  "Duplicate order",
  "Customer requested cancellation",
] as const;

/**
 * Cancel-order modal used by both the canteen-admin (vendor) dashboard and
 * the platform admin dashboard. Mandatory reason — either pick a preset or
 * type a custom one. Calls POST /api/orders/{id}/cancel which auto-refunds
 * the Razorpay payment when applicable.
 */
export default function CancelOrderModal({ orderId, orderRef, amount, authToken, onClose, onSuccess }: Props) {
  const [reason, setReason] = useState("");
  const [busy,   setBusy]   = useState(false);
  const [error,  setError]  = useState<string | null>(null);
  const [result, setResult] = useState<{ status: string; id: string | null; error: string | null } | null>(null);

  const submit = async () => {
    const finalReason = reason.trim();
    if (!finalReason) {
      setError("Please select or type a reason — this is mandatory.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/orders/${orderId}/cancel`, {
        method:  "POST",
        headers: {
          "Content-Type":  "application/json",
          Authorization:   `Bearer ${authToken}`,
        },
        body: JSON.stringify({ reason: finalReason }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error || "Failed to cancel order.");
        setBusy(false);
        return;
      }
      const refund = json.refund || {};
      setResult({ status: refund.status, id: refund.id, error: refund.error });
      onSuccess?.({ refundStatus: refund.status, refundId: refund.id });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={busy ? undefined : onClose}>
      <div className="modal-sheet" onClick={e => e.stopPropagation()} style={{ maxWidth: 440 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.6rem" }}>
          <h3 style={{ margin: 0 }}>Cancel order {orderRef ?? orderId.slice(0, 8).toUpperCase()}</h3>
          <button onClick={onClose} disabled={busy} style={{ background: "none", border: "none", fontSize: "1.2rem", cursor: busy ? "not-allowed" : "pointer", color: "var(--ink-3)" }}>✕</button>
        </div>

        {!result ? (
          <>
            <p style={{ fontSize: "0.82rem", color: "var(--ink-2)", marginBottom: "0.75rem" }}>
              The student will see your reason on their order page. Any payment{amount ? ` of ₹${amount.toFixed(0)}` : ""} will be auto-refunded via Razorpay.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", marginBottom: "0.75rem" }}>
              {PRESETS.map(p => (
                <button
                  key={p}
                  onClick={() => setReason(p)}
                  style={{
                    textAlign: "left",
                    padding: "0.5rem 0.75rem",
                    border: reason === p ? "1.5px solid var(--orange)" : "1px solid var(--border)",
                    borderRadius: 8,
                    background: reason === p ? "#fff7ed" : "#fff",
                    cursor: "pointer",
                    fontSize: "0.82rem",
                  }}
                >{p}</button>
              ))}
            </div>

            <div style={{ marginBottom: "0.75rem" }}>
              <label style={{ display: "block", fontSize: "0.78rem", color: "var(--ink-3)", marginBottom: "0.25rem" }}>
                Or type your own reason <span style={{ color: "var(--red)" }}>*</span>
              </label>
              <textarea
                value={reason}
                onChange={e => { setReason(e.target.value); setError(null); }}
                rows={2}
                maxLength={280}
                placeholder="e.g. Power outage in kitchen, food safety concern, etc."
                style={{ width: "100%", padding: "0.5rem", border: "1px solid var(--border)", borderRadius: 8, fontSize: "0.85rem", fontFamily: "inherit", resize: "vertical" }}
              />
              <div style={{ fontSize: "0.7rem", color: "var(--ink-3)", textAlign: "right" }}>{reason.length}/280</div>
            </div>

            {error && <p className="error-msg" style={{ marginBottom: "0.5rem" }}>{error}</p>}

            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button onClick={onClose} disabled={busy}
                style={{ flex: 1, padding: "0.6rem", background: "#fff", border: "1px solid var(--border)", borderRadius: 8, cursor: busy ? "not-allowed" : "pointer", fontWeight: 600 }}>
                Keep order
              </button>
              <button onClick={submit} disabled={busy || !reason.trim()}
                style={{ flex: 1, padding: "0.6rem", background: "var(--red)", color: "#fff", border: "none", borderRadius: 8, cursor: (busy || !reason.trim()) ? "not-allowed" : "pointer", fontWeight: 700, opacity: (busy || !reason.trim()) ? 0.6 : 1 }}>
                {busy ? "Cancelling…" : "Cancel + refund"}
              </button>
            </div>
          </>
        ) : (
          <>
            <div style={{ background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 10, padding: "0.75rem", marginBottom: "0.75rem" }}>
              <strong style={{ color: "#15803d" }}>✓ Order cancelled.</strong>
              <div style={{ fontSize: "0.82rem", color: "var(--ink-2)", marginTop: "0.4rem" }}>
                {result.status === "processed" && (
                  <>Refund of ₹{amount?.toFixed(0) ?? "—"} initiated. Razorpay refund ID: <span style={{ fontFamily: "monospace" }}>{result.id}</span></>
                )}
                {result.status === "failed" && (
                  <>⚠️ Order cancelled but auto-refund failed: {result.error}. Process manually from the Razorpay dashboard.</>
                )}
                {result.status === "pending" && (
                  <>Razorpay credentials missing on server — refund must be processed manually.</>
                )}
                {result.status === "not_required" && (
                  <>No payment was charged for this order — nothing to refund.</>
                )}
              </div>
            </div>
            <button onClick={onClose}
              style={{ width: "100%", padding: "0.6rem", background: "var(--orange)", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 700 }}>
              Done
            </button>
          </>
        )}
      </div>
    </div>
  );
}

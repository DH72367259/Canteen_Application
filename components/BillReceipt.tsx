"use client";

/**
 * BillReceipt — thermal-printer-optimised receipt for canteen managers.
 *
 * Designed for 80mm thermal printers (width ≈ 302px).
 * Clicking "Print" triggers window.print() which uses the @media print CSS
 * defined below. Works via browser print dialog → any WiFi/USB thermal printer.
 *
 * Hardware recommendations:
 *   Budget: Xprinter XP-Q80I    (~₹3,500) — WiFi, 80mm, ESC/POS compatible
 *   Reliable: Epson TM-T82IIIL  (~₹12,000) — WiFi+LAN, 80mm, industry standard
 */

import { useEffect, useRef } from "react";

interface OrderItem {
  name: string;
  quantity: number;
  unitPrice?: number;
}

interface Props {
  orderId: string;
  studentName?: string;
  studentPhone?: string;
  canteenName?: string;
  slotLabel?: string;
  binLabel?: string;
  items: OrderItem[];
  totalAmount: number;
  createdAt?: string;
  onClose: () => void;
}

function formatTime(iso?: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
  });
}

export default function BillReceipt({
  orderId,
  studentName,
  studentPhone,
  canteenName,
  slotLabel,
  binLabel,
  items,
  totalAmount,
  createdAt,
  onClose,
}: Props) {
  const printAreaRef = useRef<HTMLDivElement>(null);
  const shortId = orderId.slice(-8).toUpperCase();

  function doPrint() {
    window.print();
  }

  // Inject print-specific CSS on mount
  useEffect(() => {
    const style = document.createElement("style");
    style.id = "bill-print-style";
    style.textContent = `
      @media print {
        body > *:not(#bill-print-root) { display: none !important; }
        #bill-print-root {
          display: block !important;
          width: 80mm;
          max-width: 80mm;
          margin: 0;
          padding: 0;
          font-family: 'Courier New', Courier, monospace;
          font-size: 11pt;
          color: #000;
          background: #fff;
        }
        .bill-no-print { display: none !important; }
        .bill-divider { border-top: 1px dashed #000; margin: 4px 0; }
      }
    `;
    document.head.appendChild(style);
    return () => { document.getElementById("bill-print-style")?.remove(); };
  }, []);

  const totalItems = items.reduce((s, i) => s + i.quantity, 0);

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9998,
      background: "rgba(0,0,0,0.7)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: "1rem",
    }}>
      {/* Modal */}
      <div style={{ background: "#fff", borderRadius: 16, maxWidth: 420, width: "100%", overflow: "hidden", boxShadow: "0 8px 40px rgba(0,0,0,0.35)" }}>
        {/* Modal header */}
        <div className="bill-no-print" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "1rem 1.25rem", borderBottom: "1px solid #e5e7eb" }}>
          <span style={{ fontWeight: 800, fontSize: "1rem" }}>🖨️ Print Bill</span>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: "1.3rem", cursor: "pointer", color: "#64748b" }}>×</button>
        </div>

        {/* Receipt — this section gets printed */}
        <div id="bill-print-root" ref={printAreaRef} style={{ padding: "1rem", fontFamily: "'Courier New', Courier, monospace", fontSize: "0.82rem", lineHeight: 1.6, color: "#000" }}>
          {/* Header */}
          <div style={{ textAlign: "center", marginBottom: "0.5rem" }}>
            <div style={{ fontWeight: 900, fontSize: "1rem", letterSpacing: 1 }}>{canteenName ?? "CANTEEN"}</div>
            <div style={{ fontSize: "0.7rem", color: "#475569" }}>NoQx Order Receipt</div>
          </div>

          <div className="bill-divider" style={{ borderTop: "1px dashed #000", margin: "6px 0" }} />

          {/* Order meta */}
          <div>
            <div><strong>Order #:</strong> {shortId}</div>
            {createdAt && <div><strong>Time:</strong> {formatTime(createdAt)}</div>}
            {slotLabel && <div><strong>Slot:</strong> {slotLabel}</div>}
            {binLabel  && <div><strong>Bin:</strong>  {binLabel}</div>}
          </div>

          <div className="bill-divider" style={{ borderTop: "1px dashed #000", margin: "6px 0" }} />

          {/* Student info */}
          {(studentName || studentPhone) && (
            <>
              <div>
                {studentName  && <div><strong>Student:</strong> {studentName}</div>}
                {studentPhone && <div><strong>Phone:</strong>   {studentPhone}</div>}
              </div>
              <div className="bill-divider" style={{ borderTop: "1px dashed #000", margin: "6px 0" }} />
            </>
          )}

          {/* Items */}
          <div style={{ marginBottom: "0.25rem" }}>
            <div style={{ fontWeight: 700, marginBottom: "0.2rem" }}>ITEMS ({totalItems}):</div>
            <div style={{ borderTop: "1px solid #000", borderBottom: "1px solid #000", padding: "4px 0" }}>
              {items.map((item, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>{item.name} ×{item.quantity}</span>
                  {item.unitPrice != null && (
                    <span>₹{(item.unitPrice * item.quantity).toFixed(0)}</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Total */}
          <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 900, fontSize: "1rem", marginTop: "0.4rem" }}>
            <span>TOTAL</span>
            <span>₹{totalAmount}</span>
          </div>

          <div className="bill-divider" style={{ borderTop: "1px dashed #000", margin: "8px 0" }} />

          <div style={{ textAlign: "center", fontSize: "0.7rem", color: "#64748b" }}>
            Attach to Bin {binLabel ?? "—"} · Thank you!
          </div>
        </div>

        {/* Action buttons */}
        <div className="bill-no-print" style={{ display: "flex", gap: "0.75rem", padding: "1rem 1.25rem", borderTop: "1px solid #e5e7eb" }}>
          <button
            onClick={onClose}
            style={{ flex: 1, padding: "0.75rem", background: "#f1f5f9", border: "none", borderRadius: 10, fontWeight: 600, fontSize: "0.9rem", cursor: "pointer" }}
          >
            Close
          </button>
          <button
            onClick={doPrint}
            style={{ flex: 2, padding: "0.75rem", background: "#1e293b", color: "#fff", border: "none", borderRadius: 10, fontWeight: 800, fontSize: "0.9rem", cursor: "pointer" }}
          >
            🖨️ Print
          </button>
        </div>
      </div>
    </div>
  );
}

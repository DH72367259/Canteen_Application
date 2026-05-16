"use client";

/**
 * QRScanner — camera-based QR scanner for workers.
 *
 * Uses html5-qrcode under the hood (works on Android Chrome + iOS Safari).
 * Opens the rear camera by default.
 *
 * Props:
 *   onScanned(payload)  — called once with the raw QR string
 *   onClose()           — called when user dismisses the scanner
 *   width               — scanner preview width (default 280)
 */

import { useEffect, useRef, useState } from "react";

interface Props {
  onScanned: (payload: string) => void;
  onClose: () => void;
  width?: number;
}

const SCANNER_EL_ID = "noqx-qr-scanner-region";

export default function QRScanner({ onScanned, onClose, width = 280 }: Props) {
  const scannerRef = useRef<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const calledBack = useRef(false);

  useEffect(() => {
    let destroyed = false;
    calledBack.current = false;
    setScanning(false);
    setError(null);

    async function init() {
      // Tear down any previous instance
      const prev = scannerRef.current as { stop?: () => Promise<void>; clear?: () => void } | null;
      if (prev?.stop) {
        try { await prev.stop(); if (prev.clear) prev.clear(); } catch { /* ignore */ }
        scannerRef.current = null;
      }

      // Wait for DOM element to be present
      let el: HTMLElement | null = null;
      for (let i = 0; i < 15; i++) {
        el = document.getElementById(SCANNER_EL_ID);
        if (el) break;
        await new Promise(r => setTimeout(r, 50));
      }
      if (!el || destroyed) return;

      const { Html5Qrcode } = await import("html5-qrcode");
      const scanner = new Html5Qrcode(SCANNER_EL_ID);
      scannerRef.current = scanner;

      const config = { fps: 10, qrbox: { width: Math.round(width * 0.7), height: Math.round(width * 0.7) } };
      const onDecoded = (decodedText: string) => {
        if (calledBack.current || destroyed) return;
        calledBack.current = true;
        scanner.stop().catch(() => {}).finally(() => { onScanned(decodedText); });
      };

      // Try rear camera, fall back to any camera on OverconstrainedError
      const constraints: MediaTrackConstraints[] = [
        { facingMode: { ideal: "environment" } },
        { facingMode: "user" },
        {},
      ];
      let started = false;
      for (const c of constraints) {
        if (destroyed) break;
        try {
          await scanner.start(c, config, onDecoded, () => { /* per-frame errors normal */ });
          started = true;
          break;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          if (/overconstrained|not.*satisfi/i.test(msg)) continue;
          break;
        }
      }

      if (!destroyed) {
        if (started) {
          setScanning(true);
        } else {
          setError("Camera access denied. Please allow camera permission in browser settings, then tap Try Again.");
        }
      }
    }

    void init();

    return () => {
      destroyed = true;
      const s = scannerRef.current as { stop?: () => Promise<void>; clear?: () => void } | null;
      if (s?.stop) s.stop().catch(() => {}).finally(() => { try { if (s.clear) s.clear(); } catch { /* ignore */ } });
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryKey]);

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      background: "rgba(0,0,0,0.85)",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
    }}>
      {/* Header */}
      <div style={{ color: "#fff", fontWeight: 800, fontSize: "1rem", marginBottom: "1rem", letterSpacing: 0.02 }}>
        📷 Scan Student&apos;s QR Code
      </div>

      {/* Scanner area */}
      <div style={{
        background: "#000", borderRadius: 16, overflow: "hidden",
        width: width, minHeight: width,
        position: "relative",
        border: scanning ? "2px solid #22c55e" : "2px solid #64748b",
      }}>
        <div id={SCANNER_EL_ID} style={{ width, height: width }} />

        {!scanning && !error && (
          <div style={{
            position: "absolute", inset: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#94a3b8", fontSize: "0.85rem",
          }}>
            Starting camera…
          </div>
        )}
      </div>

      {/* Error + retry */}
      {error && (
        <div style={{
          marginTop: "1rem", background: "#fef2f2",
          border: "1px solid #fca5a5",
          borderRadius: 10, padding: "0.75rem 1rem",
          maxWidth: 280, fontSize: "0.85rem", color: "#dc2626", textAlign: "center",
        }}>
          <div style={{ marginBottom: "0.75rem", lineHeight: 1.5 }}>{error}</div>
          <button
            onClick={() => setRetryKey(k => k + 1)}
            style={{ padding: "0.45rem 1.2rem", background: "#1e293b", color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, cursor: "pointer", fontSize: "0.82rem" }}
          >
            Try Again
          </button>
        </div>
      )}

      {/* Hint */}
      {scanning && !error && (
        <div style={{ color: "#94a3b8", fontSize: "0.78rem", marginTop: "0.75rem", textAlign: "center", maxWidth: 280 }}>
          Point at the QR code on the student&apos;s phone
        </div>
      )}

      {/* Cancel */}
      <button
        onClick={onClose}
        style={{
          marginTop: "1.5rem", padding: "0.75rem 2rem",
          background: "#1e293b", color: "#fff",
          border: "1.5px solid #334155",
          borderRadius: 12, fontWeight: 700, fontSize: "0.9rem",
          cursor: "pointer",
        }}
      >
        Cancel
      </button>
    </div>
  );
}

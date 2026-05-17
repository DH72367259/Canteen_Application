"use client";

/**
 * QRScanner — camera-based QR scanner for workers.
 *
 * Permission flow (Android Chrome root-level fix):
 *   Step 0: Explicit getUserMedia() call — this is the ONLY reliable way to
 *           trigger the Android Chrome permission dialog. Without this, the
 *           html5-qrcode init may silently fail without ever prompting the user.
 *   Step 1: If denied → show Android step-by-step instructions + "Type OTP Instead"
 *   Step 2: If granted → initialize html5-qrcode using hardware camera IDs (Strategy 1)
 *           or constraint-based fallback (Strategy 2)
 *
 * Props:
 *   onScanned(payload)  — called once with the raw QR string
 *   onClose()           — called when user dismisses the scanner
 *   onManualOtp?()      — if provided, shows "Type OTP Instead" button in error states
 *   width               — scanner preview width (default 280)
 */

import { useEffect, useRef, useState } from "react";

interface Props {
  onScanned: (payload: string) => void;
  onClose: () => void;
  onManualOtp?: () => void;
  width?: number;
}

type Phase =
  | "requesting"   // Showing "Requesting camera permission…" while getUserMedia runs
  | "denied"       // Permission explicitly blocked — show Android instructions
  | "unavailable"  // No camera hardware / HTTPS missing / not supported
  | "starting"     // Permission granted, initializing html5-qrcode
  | "scanning"     // Actively scanning — green border
  | "error";       // Scanner failed after permission granted

const SCANNER_EL_ID = "noqx-qr-scanner-region";

export default function QRScanner({ onScanned, onClose, onManualOtp, width = 280 }: Props) {
  const scannerRef  = useRef<unknown>(null);
  const calledBack  = useRef(false);
  const [phase, setPhase]     = useState<Phase>("requesting");
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let destroyed = false;
    calledBack.current = false;
    setPhase("requesting");

    async function init() {
      // Tear down any previous html5-qrcode instance
      const prev = scannerRef.current as { stop?: () => Promise<void>; clear?: () => void } | null;
      if (prev?.stop) {
        try { await prev.stop(); if (prev.clear) prev.clear(); } catch { /* ignore */ }
        scannerRef.current = null;
      }

      // ── Step 0: Explicit permission request ──────────────────────────────
      // navigator.mediaDevices.getUserMedia is the ONLY call that triggers the
      // native Android Chrome camera permission dialog. html5-qrcode's getCameras()
      // and start() do NOT reliably trigger it on all Android brands/versions.
      if (!navigator.mediaDevices?.getUserMedia) {
        if (!destroyed) setPhase("unavailable");
        return;
      }

      // Pre-check via Permissions API (Chrome/Android) — if already denied,
      // skip getUserMedia entirely to avoid showing the permission dialog again
      // on every reload. iOS Safari doesn't support this, so we try/catch.
      try {
        const perm = await navigator.permissions.query({ name: "camera" as PermissionName });
        if (perm.state === "denied") {
          if (!destroyed) setPhase("denied");
          return;
        }
      } catch { /* Permissions API not supported — proceed with getUserMedia */ }

      let testStream: MediaStream | null = null;
      try {
        testStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
        });
        // Permission granted — release the test stream immediately;
        // html5-qrcode will open its own stream below.
        testStream.getTracks().forEach((t) => t.stop());
        testStream = null;
      } catch (rawErr) {
        if (destroyed) return;
        const err = rawErr as DOMException;
        const isDenied =
          err.name === "NotAllowedError" ||
          err.name === "PermissionDeniedError" ||
          err.message?.toLowerCase().includes("permission denied");
        setPhase(isDenied ? "denied" : "unavailable");
        return;
      }

      // ── Step 1: Initialize html5-qrcode ─────────────────────────────────
      if (destroyed) return;
      setPhase("starting");

      // Wait for DOM element (React may not have committed yet)
      let el: HTMLElement | null = null;
      for (let i = 0; i < 20; i++) {
        el = document.getElementById(SCANNER_EL_ID);
        if (el) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      if (!el || destroyed) return;

      const { Html5Qrcode } = await import("html5-qrcode");
      const scanner = new Html5Qrcode(SCANNER_EL_ID);
      scannerRef.current = scanner;

      const config = {
        fps: 10,
        qrbox: { width: Math.round(width * 0.7), height: Math.round(width * 0.7) },
      };
      const onDecoded = (decodedText: string) => {
        if (calledBack.current || destroyed) return;
        calledBack.current = true;
        scanner.stop().catch(() => {}).finally(() => { onScanned(decodedText); });
      };

      let started = false;

      // Strategy 1: enumerate real hardware camera IDs — most reliable across
      // Samsung, Realme, Vivo, Redmi (bypasses facingMode constraint quirks)
      try {
        const cameras = await Html5Qrcode.getCameras();
        if (cameras.length > 0 && !destroyed) {
          const sorted = [
            ...cameras.filter((c) => /back|rear|environment/i.test(c.label)),
            ...cameras.filter((c) => !/back|rear|environment/i.test(c.label)),
          ];
          for (const cam of sorted) {
            if (destroyed) break;
            try {
              await scanner.start(cam.id, config, onDecoded, () => {});
              started = true;
              break;
            } catch { continue; }
          }
        }
      } catch { /* fall through to Strategy 2 */ }

      // Strategy 2: constraint-based fallback
      if (!started && !destroyed) {
        for (const c of [
          { facingMode: { ideal: "environment" } },
          {},
        ] as MediaTrackConstraints[]) {
          if (destroyed) break;
          try {
            await scanner.start(c, config, onDecoded, () => {});
            started = true;
            break;
          } catch { continue; }
        }
      }

      if (!destroyed) setPhase(started ? "scanning" : "error");
    }

    void init();

    return () => {
      destroyed = true;
      const s = scannerRef.current as { stop?: () => Promise<void>; clear?: () => void } | null;
      if (s?.stop) {
        s.stop().catch(() => {}).finally(() => { try { if (s.clear) s.clear(); } catch { /* ignore */ } });
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryKey]);

  // ── Shared button styles ───────────────────────────────────────────────
  const btnBase: React.CSSProperties = {
    padding: "0.5rem 1rem", border: "none", borderRadius: 8,
    fontWeight: 700, cursor: "pointer", fontSize: "0.82rem",
  };
  const btnDark:   React.CSSProperties = { ...btnBase, background: "#1e293b", color: "#fff" };
  const btnOrange: React.CSSProperties = { ...btnBase, background: "#f97316", color: "#fff" };
  const btnGreen:  React.CSSProperties = { ...btnBase, background: "#16a34a", color: "#fff" };

  // "Type OTP Instead" — closes scanner so the worker sees the text input below
  const manualOtpBtn = (
    <button onClick={onManualOtp ?? onClose} style={btnGreen}>
      Type OTP Instead
    </button>
  );

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      background: "rgba(0,0,0,0.88)",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      padding: "1rem",
    }}>
      {/* Header */}
      <div style={{ color: "#fff", fontWeight: 800, fontSize: "1rem", marginBottom: "1rem" }}>
        Scan Student&apos;s QR Code
      </div>

      {/* ── DENIED STATE: Android step-by-step instructions ── */}
      {phase === "denied" && (
        <div style={{
          background: "#fef2f2", border: "1.5px solid #fca5a5",
          borderRadius: 14, padding: "1.1rem 1.2rem",
          maxWidth: 320, fontSize: "0.85rem", color: "#1e293b",
        }}>
          <div style={{ fontWeight: 800, fontSize: "0.95rem", color: "#dc2626", marginBottom: "0.6rem" }}>
            Camera permission blocked
          </div>
          <div style={{ lineHeight: 1.7, marginBottom: "0.9rem" }}>
            To allow camera access on Android Chrome:
            <ol style={{ margin: "0.5rem 0 0", paddingLeft: "1.2rem" }}>
              <li>Tap the <strong>lock icon</strong> in the address bar</li>
              <li>Tap <strong>Permissions</strong></li>
              <li>Set <strong>Camera</strong> to <em>Allow</em></li>
              <li>Tap <strong>Reload Page</strong> below</li>
            </ol>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", justifyContent: "center" }}>
            <button onClick={() => setRetryKey((k) => k + 1)} style={btnOrange}>
              Try Again
            </button>
            {manualOtpBtn}
          </div>
        </div>
      )}

      {/* ── UNAVAILABLE STATE ── */}
      {phase === "unavailable" && (
        <div style={{
          background: "#fef2f2", border: "1.5px solid #fca5a5",
          borderRadius: 14, padding: "1rem 1.2rem",
          maxWidth: 300, fontSize: "0.85rem", color: "#dc2626", textAlign: "center",
        }}>
          <div style={{ marginBottom: "0.75rem", lineHeight: 1.5 }}>
            Camera not available on this device. Make sure you&apos;re on HTTPS and the camera is not in use by another app.
          </div>
          <div style={{ display: "flex", gap: "0.5rem", justifyContent: "center", flexWrap: "wrap" }}>
            <button onClick={() => setRetryKey((k) => k + 1)} style={btnDark}>
              Try Again
            </button>
            {manualOtpBtn}
          </div>
        </div>
      )}

      {/* ── ERROR STATE (permission ok but scanner failed) ── */}
      {phase === "error" && (
        <div style={{
          background: "#fef2f2", border: "1.5px solid #fca5a5",
          borderRadius: 14, padding: "1rem 1.2rem",
          maxWidth: 300, fontSize: "0.85rem", color: "#dc2626", textAlign: "center",
        }}>
          <div style={{ marginBottom: "0.75rem", lineHeight: 1.5 }}>
            Could not start the camera scanner. Try again or enter the OTP manually.
          </div>
          <div style={{ display: "flex", gap: "0.5rem", justifyContent: "center", flexWrap: "wrap" }}>
            <button onClick={() => setRetryKey((k) => k + 1)} style={btnDark}>
              Try Again
            </button>
            {manualOtpBtn}
          </div>
        </div>
      )}

      {/* ── REQUESTING / STARTING STATE ── */}
      {(phase === "requesting" || phase === "starting") && (
        <div style={{
          background: "#1e293b", borderRadius: 14, padding: "1rem 1.5rem",
          color: "#94a3b8", fontSize: "0.85rem", textAlign: "center",
        }}>
          {phase === "requesting"
            ? "Requesting camera permission…"
            : "Starting camera…"}
          <div style={{ marginTop: "0.5rem", fontSize: "0.75rem", color: "#64748b" }}>
            {phase === "requesting" && "Please tap Allow when your browser asks"}
          </div>
        </div>
      )}

      {/* ── SCANNER VIDEO AREA (shown during starting + scanning) ── */}
      {(phase === "starting" || phase === "scanning") && (
        <div style={{
          background: "#000", borderRadius: 16, overflow: "hidden",
          width: width, minHeight: width,
          marginTop: phase === "scanning" ? 0 : "1rem",
          border: phase === "scanning" ? "2px solid #22c55e" : "2px solid #64748b",
        }}>
          <div id={SCANNER_EL_ID} style={{ width, height: width }} />
        </div>
      )}

      {/* ── SCANNING HINT ── */}
      {phase === "scanning" && (
        <div style={{
          color: "#94a3b8", fontSize: "0.78rem",
          marginTop: "0.75rem", textAlign: "center", maxWidth: 280,
        }}>
          Point at the QR code on the student&apos;s phone
        </div>
      )}

      {/* ── CANCEL ── */}
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

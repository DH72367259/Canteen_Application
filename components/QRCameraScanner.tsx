"use client";

/**
 * QRCameraScanner — native camera QR scanner.
 *
 * Self-sufficient: if no `streamPromise` is passed, shows a "Tap to start camera"
 * button that calls getUserMedia() inside the click handler. This is the ONLY
 * reliable way to trigger the Android Chrome permission dialog (it must run in
 * a user-gesture context).
 *
 * The parent can also pass a streamPromise directly when the camera was already
 * requested from another click handler (e.g. when the user taps the "Scan QR"
 * tab — the getUserMedia call must happen in that same click handler too).
 *
 * Retry never reloads the page (that would lose the auth session and bounce
 * the user to /login). Instead it re-runs getUserMedia in-place.
 */

import { useEffect, useRef, useState, useCallback } from "react";

interface Props {
  streamPromise: Promise<MediaStream> | null;
  onScanned: (text: string) => void;
  /** Optional callback when user gives up and wants to switch to OTP entry. */
  onManualOtp?: () => void;
}

export default function QRCameraScanner({ streamPromise: externalPromise, onScanned, onManualOtp }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Internal stream promise — used when the user taps "Start camera" inside this
  // component. Takes precedence over externalPromise (which may have been
  // consumed/rejected on a prior render).
  const [internalPromise, setInternalPromise] = useState<Promise<MediaStream> | null>(null);
  // Bumped to force the streamPromise effect to re-run on retry without reloading.
  const [attemptKey, setAttemptKey] = useState(0);

  const activePromise = internalPromise ?? externalPromise;

  const startCamera = useCallback(() => {
    setError(null);
    setReady(false);
    // Defensive checks BEFORE calling getUserMedia — gives the user a clear
    // reason instead of a generic NotAllowedError.
    if (typeof window === "undefined" || !window.isSecureContext) {
      setError("Camera requires HTTPS. This page must be served over a secure connection. Use OTP instead.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      // Brave (Shields strict mode) and some embedded browsers strip
      // navigator.mediaDevices entirely. Tell the user how to fix it.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const isBrave = !!(navigator as any).brave;
      if (isBrave) {
        setError("Brave Shields is blocking camera access. Tap the Brave lion icon in the address bar → set Shields to 'Down for this site' → Reload. Or use OTP instead.");
      } else {
        setError("This browser does not expose camera APIs. Try Chrome (Android) / Safari (iOS), or use OTP instead.");
      }
      return;
    }
    try {
      // MUST be called synchronously inside the click handler — otherwise
      // Chrome Android won't show the permission dialog.
      const p = navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
      });
      setInternalPromise(p);
      setAttemptKey((k) => k + 1);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown";
      setError(`Cannot access camera: ${msg}. Use OTP instead.`);
    }
  }, []);

  useEffect(() => {
    if (!activePromise) return;

    let alive = true;
    let stream: MediaStream | null = null;
    let rafId: number | null = null;

    activePromise
      .then((s) => {
        if (!alive) { s.getTracks().forEach((t) => t.stop()); return; }
        stream = s;

        const video = videoRef.current;
        if (!video) { s.getTracks().forEach((t) => t.stop()); return; }

        video.srcObject = s;
        video.play().catch(() => {});
        setReady(true);

        if (!("BarcodeDetector" in window)) {
          setError("QR scanning not supported on this browser — use OTP instead.");
          return;
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const detector = new (window as any).BarcodeDetector({ formats: ["qr_code"] });

        const scan = async () => {
          if (!alive) return;
          try {
            if (video.readyState >= 2) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const codes: any[] = await detector.detect(video);
              if (codes.length > 0 && alive) {
                alive = false;
                onScanned(String(codes[0].rawValue));
                return;
              }
            }
          } catch { /* ignore per-frame errors */ }
          if (alive) rafId = requestAnimationFrame(() => { void scan(); });
        };

        video.onloadedmetadata = () => { void scan(); };
        if (video.readyState >= 2) void scan();
      })
      .catch(async (e) => {
        if (!alive) return;
        const name = e instanceof Error ? e.name : "";
        const msg  = e instanceof Error ? e.message : String(e);

        // ── Progressive fallback for OverconstrainedError ─────────────────
        // Some Android devices (especially ones without a real "environment"
        // facing camera) reject the strict facingMode constraint. Retry once
        // with no constraints before giving up.
        if (name === "OverconstrainedError" || name === "NotReadableError") {
          try {
            const fallback = await navigator.mediaDevices.getUserMedia({ video: true });
            if (!alive) { fallback.getTracks().forEach((t) => t.stop()); return; }
            stream = fallback;
            const video = videoRef.current;
            if (video) {
              video.srcObject = fallback;
              video.play().catch(() => {});
              setReady(true);
            }
            return;
          } catch { /* fall through to error UI */ }
        }

        // ── Permission-denied: distinguish Brave from Chrome/Safari ─────
        if (name === "NotAllowedError" || /denied|not allowed|permission/i.test(msg)) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const isBrave = !!(navigator as any).brave;
          if (isBrave) {
            setError(
              "Camera blocked by Brave Shields. Tap the 🦁 lion icon in the address bar → set Shields to 'Down for this site' → Reload. If that doesn't help, open Site settings → Camera → Allow. Or use OTP instead.",
            );
          } else {
            setError(
              "Camera access was blocked. Tap the lock icon in the address bar → Permissions → Camera → Allow, then tap Try Again below. If the prompt never appeared, try opening the site in Chrome.",
            );
          }
          return;
        }
        if (name === "NotFoundError") {
          setError("No camera found on this device. Use OTP instead.");
          return;
        }
        if (name === "NotReadableError") {
          setError("Camera is in use by another app (e.g. WhatsApp video call). Close it and tap Try Again, or use OTP.");
          return;
        }
        setError(`Camera error: ${msg || name || "unknown"}. Tap Try Again or use OTP.`);
      });

    return () => {
      alive = false;
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePromise, attemptKey]);

  // ── No active stream yet → show a Tap-to-Start button ────────────────────
  // This is the entry point after a page reload or first mount. The button
  // click provides the user-gesture context needed by getUserMedia on Android.
  if (!activePromise && !error) {
    return (
      <div style={{
        padding: "1.5rem 1.1rem",
        background: "#1e293b",
        borderRadius: 12,
        textAlign: "center",
      }}>
        <div style={{ fontSize: "2.5rem", marginBottom: "0.5rem" }}>📷</div>
        <p style={{ color: "#cbd5e1", fontSize: "0.86rem", margin: "0 0 1rem", lineHeight: 1.5 }}>
          Tap the button below to start the camera.
          <br />
          Allow camera permission when your browser asks.
        </p>
        <button
          onClick={startCamera}
          style={{
            padding: "0.75rem 1.5rem",
            background: "#f97316",
            color: "#fff",
            border: "none",
            borderRadius: 12,
            fontWeight: 800,
            fontSize: "0.95rem",
            cursor: "pointer",
            width: "100%",
          }}
        >
          📷 Start Camera
        </button>
        {onManualOtp && (
          <button
            onClick={onManualOtp}
            style={{
              marginTop: "0.6rem",
              padding: "0.6rem 1.2rem",
              background: "transparent",
              color: "#cbd5e1",
              border: "1.5px solid #475569",
              borderRadius: 10,
              fontWeight: 600,
              fontSize: "0.85rem",
              cursor: "pointer",
              width: "100%",
            }}
          >
            Use OTP Instead
          </button>
        )}
      </div>
    );
  }

  // ── Error state ─────────────────────────────────────────────────────────
  // Retry re-runs getUserMedia in-place (no page reload, no logout risk).
  if (error) {
    return (
      <div style={{ padding: "1.1rem", background: "#fef2f2", borderRadius: 12, border: "1.5px solid #fca5a5", textAlign: "center" }}>
        <div style={{ fontSize: "1.75rem", marginBottom: "0.4rem" }}>📷</div>
        <p style={{ color: "#dc2626", fontWeight: 700, fontSize: "0.83rem", margin: "0 0 0.9rem", lineHeight: 1.55 }}>
          {error}
        </p>
        <div style={{ display: "flex", gap: "0.5rem", flexDirection: "column" }}>
          <button
            onClick={startCamera}
            style={{
              padding: "0.65rem 1rem",
              background: "#1e293b",
              color: "#fff",
              border: "none",
              borderRadius: 10,
              fontWeight: 700,
              cursor: "pointer",
              fontSize: "0.85rem",
            }}
          >
            🔄 Try Again
          </button>
          {onManualOtp && (
            <button
              onClick={onManualOtp}
              style={{
                padding: "0.6rem 1rem",
                background: "transparent",
                color: "#dc2626",
                border: "1.5px solid #fca5a5",
                borderRadius: 10,
                fontWeight: 600,
                cursor: "pointer",
                fontSize: "0.82rem",
              }}
            >
              Use OTP Instead
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ position: "relative", borderRadius: 12, overflow: "hidden", background: "#000", minHeight: 220 }}>
      {!ready && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div className="spinner" />
        </div>
      )}
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        style={{ width: "100%", display: "block", maxHeight: 300, objectFit: "cover" }}
      />
      {ready && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
          <div style={{ width: 170, height: 170, border: "2.5px solid rgba(255,255,255,0.85)", borderRadius: 10, boxShadow: "0 0 0 2000px rgba(0,0,0,0.35)" }} />
        </div>
      )}
    </div>
  );
}

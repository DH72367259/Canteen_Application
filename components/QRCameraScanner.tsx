"use client";

/**
 * QRCameraScanner — native camera QR scanner.
 *
 * Designed to work on ANY desktop or mobile browser that supports getUserMedia:
 * Chrome, Edge, Brave, Opera, Firefox, Samsung Internet, Safari.
 *
 * Strategy:
 *   1. Tap "Start Camera" → call getUserMedia({ video: true }) FIRST. No
 *      facingMode constraint — this is the most permissive call and succeeds
 *      on every browser/device combo that has any usable camera.
 *   2. Once we have a stream, try (best-effort) to switch tracks to a rear
 *      ("environment") camera via applyConstraints. If that fails we keep
 *      the original stream — the user can still scan, they just point the
 *      front camera at the QR.
 *   3. On NotAllowedError we detect the browser engine and show step-by-step
 *      guidance for the user's actual browser instead of generic text.
 *
 * Retry never reloads the page (that would lose the auth session and bounce
 * the user to /login). It re-runs getUserMedia in-place.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { requestRearCamera } from "@/lib/camera";

type BrowserKind = "brave" | "chrome" | "edge" | "opera" | "firefox" | "safari" | "samsung" | "unknown";

function detectBrowser(): BrowserKind {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((navigator as any).brave?.isBrave) return "brave";
  if (/Edg\//.test(ua))                  return "edge";
  if (/OPR\/|Opera/.test(ua))            return "opera";
  if (/SamsungBrowser/.test(ua))         return "samsung";
  if (/Firefox\//.test(ua))              return "firefox";
  if (/Chrome\//.test(ua))               return "chrome";
  if (/Safari\//.test(ua))               return "safari";
  return "unknown";
}

// Permission-recovery steps formatted as a multi-line string. We render
// with white-space: pre-wrap so each \n becomes a real line break on the
// phone — much easier to read than a wall of text.
//
// Modern browsers DO NOT have a "Permissions" menu, and Chrome Android
// often hides the lock icon entirely (it's replaced by a small tune/info
// icon). So the primary path for every browser is the 3-dot menu →
// Settings → Site settings → Camera, which is reliable across versions.
// The lock-icon shortcut is offered as an optional faster path.
function permissionStepsFor(b: BrowserKind): string {
  const lines: string[] = ["Camera was blocked. To fix it:"];

  const sysApp = (() => {
    switch (b) {
      case "brave":    return "Brave";
      case "chrome":   return "Chrome";
      case "edge":     return "Microsoft Edge";
      case "opera":    return "Opera";
      case "samsung":  return "Samsung Internet";
      case "firefox":  return "Firefox";
      default:         return "the browser";
    }
  })();

  if (b === "brave") {
    // Brave's distinct UI — Shields is the usual culprit.
    lines.push(
      "1. Tap the 🦁 lion icon in the address bar → toggle 'Shields' OFF for this site → Reload.",
      "2. If it still says blocked: 3-dot menu (bottom right) → Settings → Site settings → Camera → find this site → Allow.",
      "3. System permission: Android Settings → Apps → Brave → Permissions → Camera → Allow.",
      "4. Reload the page and tap Start Camera again.",
    );
  } else if (b === "safari") {
    lines.push(
      "1. Open the iOS Settings app (not Safari).",
      "2. Scroll down and tap Safari.",
      "3. Tap 'Settings for Websites' → Camera.",
      "4. Find this site in the list → tap → Allow.",
      "5. Return to Safari and Reload.",
    );
  } else {
    // Chrome / Edge / Opera / Samsung / Firefox / unknown — modern Android.
    // 3-dot menu is the universal reliable path (no lock-icon assumption).
    lines.push(
      "1. Tap the 3-dot menu at the top right of the browser.",
      "2. Tap 'Settings'.",
      "3. Scroll down and tap 'Site settings' (sometimes under Advanced).",
      "4. Tap 'Camera'.",
      "5. Find this site (canteenapplication-staging…) in the list, tap it, choose Allow.",
      "   If the site isn't in the list yet, scroll up to 'Blocked' — it might be there. Tap it → Allow.",
      `6. Also check the system permission: Android Settings → Apps → ${sysApp} → Permissions → Camera → Allow.`,
      "7. Reload the page and tap Start Camera again.",
    );
  }
  // Universal fallback for the stuck case (default-deny got remembered).
  lines.push(
    "",
    "Still stuck? Clear and retry:",
    "→ 3-dot menu → Settings → Site settings → All sites → find this site → 'Clear & reset' → Reload → Start Camera. That fires the permission prompt fresh.",
  );
  return lines.join("\n");
}

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
      const b = detectBrowser();
      setError(
        b === "brave"
          ? "Brave Shields is hiding the camera API for this site. Tap the 🦁 lion icon → set Shields to 'Down for this site' → Reload. Or use OTP."
          : `This browser does not expose the camera API. ${permissionStepsFor(b)}`,
      );
      return;
    }
    try {
      // requestRearCamera() asks for the back camera first
      // (facingMode: exact "environment"). If the device lacks a rear cam
      // it falls back to {video: true}. The synchronous call into
      // getUserMedia keeps the user-gesture context that mobile browsers
      // require for the permission dialog.
      const p = requestRearCamera();
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
      .then(async (s) => {
        if (!alive) { s.getTracks().forEach((t) => t.stop()); return; }
        stream = s;
        // No post-stream applyConstraints needed — requestRearCamera() now
        // asks for the rear cam up-front with facingMode: exact "environment".

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
        const browser = detectBrowser();

        // Permission denied — happens on every browser when the user blocks
        // it OR (Brave) when Shields silently blocks the API. The helper
        // returns a multi-line numbered list, so we render it with
        // white-space: pre-wrap (see the error <p> below). Final sentence
        // offers OTP as the bail-out.
        if (name === "NotAllowedError" || name === "SecurityError" ||
            /denied|not allowed|permission/i.test(msg)) {
          setError(`${permissionStepsFor(browser)}\n\nOr just use the OTP option above instead.`);
          return;
        }
        if (name === "NotFoundError" || name === "DevicesNotFoundError") {
          setError("No camera found on this device. Use OTP instead.");
          return;
        }
        if (name === "NotReadableError" || name === "TrackStartError") {
          setError("Camera is in use by another app (e.g. WhatsApp video call). Close it and tap Try Again, or use OTP.");
          return;
        }
        if (name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError") {
          // Shouldn't happen with our {video:true} call, but if a device
          // somehow rejects it, fall back even further.
          setError(`Camera constraints not supported on this device. Try Again or use OTP. (${msg})`);
          return;
        }
        if (name === "TypeError") {
          // navigator.mediaDevices missing — usually HTTPS or in-app browser.
          setError(`The camera API isn't available in this browser. ${permissionStepsFor(browser)} Or use OTP instead.`);
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
        {/* whiteSpace: pre-wrap honours the \n line breaks from
            permissionStepsFor() so the numbered steps render as a
            readable list instead of a wall of text. textAlign:left
            makes the numbered steps line up vertically. */}
        <p style={{
          color: "#dc2626",
          fontWeight: 600,
          fontSize: "0.78rem",
          margin: "0 0 0.9rem",
          lineHeight: 1.5,
          whiteSpace: "pre-wrap",
          textAlign: "left",
        }}>
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

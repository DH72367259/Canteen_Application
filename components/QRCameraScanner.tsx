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

// IMPORTANT: every browser requires BOTH a system-level permission (Android
// Settings → Apps → {Browser} → Permissions → Camera) AND a per-site
// permission for this specific URL. Granting only the system one (e.g.
// "Camera is allowed for Chrome in Android Settings") is NOT enough —
// the browser also needs to know that THIS website is allowed to use it.
//
// The menu labels below were verified against the live Chrome/Brave/Edge/
// Opera/Firefox/Samsung Internet/Safari menus as of 2026-05. Path varies
// across versions, so each entry lists the most common label first plus
// fallbacks.
function permissionStepsFor(b: BrowserKind): string {
  // Universal escape hatch — appended to every message — for cases where
  // Camera doesn't even appear in the Site settings list (browser hasn't
  // seen the permission request yet, or earlier "Block" got stored as a
  // sticky default-deny).
  const escape =
    " If you don't see Camera in the menu, tap the 3-dot menu → Settings → Site settings → All sites → find this site → Clear & reset → Reload, then tap Start Camera again so the prompt fires fresh.";

  // Sentence about system-level permission. Same for every browser.
  const systemNote = (app: string) =>
    ` Also make sure the system-level camera permission is ON: Android Settings → Apps → ${app} → Permissions → Camera → Allow.`;

  switch (b) {
    case "brave":    return "Brave: tap the 🦁 lion icon in the address bar → toggle Shields OFF for this site → Reload. " +
                            "If still blocked: tap the 🔒 lock → Site settings → Camera → Allow → Reload." +
                            systemNote("Brave") + escape;
    case "chrome":   return "Chrome: tap the 🔒 lock icon in the address bar → Site settings → Camera → Allow → Reload. " +
                            "(On some Chrome builds the menu reads 'Permissions for this site' instead of 'Site settings' — same thing.)" +
                            systemNote("Chrome") + escape;
    case "edge":     return "Edge: tap the 🔒 lock icon in the address bar → Permissions for this site → Camera → Allow → Reload." +
                            systemNote("Microsoft Edge") + escape;
    case "opera":    return "Opera: tap the 🔒 lock icon in the address bar → Site settings → Camera → Allow → Reload." +
                            systemNote("Opera") + escape;
    case "samsung":  return "Samsung Internet: tap the 🔒 lock icon → Permissions → Camera → Allow → Reload." +
                            systemNote("Samsung Internet") + escape;
    case "firefox":  return "Firefox: tap the 🔒 shield/lock icon → Connection secure → More information → Permissions tab → 'Use the Camera' → Allow → Reload. " +
                            "(On Firefox Android: 3-dot menu → Settings → Site permissions → Camera → tap this site → Allow.)" +
                            systemNote("Firefox") + escape;
    case "safari":   return "Safari (iOS): open the iOS Settings app → Safari → scroll to 'Settings for Websites' → Camera → tap this site → Allow → Reload.";
    default:         return "Open your browser's site settings for this page (usually behind the 🔒 lock icon in the address bar) and set Camera to Allow. The system-level camera permission for the browser app must also be enabled." + escape;
  }
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
      // MUST be called synchronously inside the click handler — otherwise
      // mobile browsers won't show the permission dialog.
      // We use {video: true} (no facingMode) because that's the most
      // permissive call and works on every Chrome / Brave / Edge / Opera /
      // Firefox / Safari / Samsung Internet build. We upgrade to the rear
      // camera AFTER the stream resolves (see effect below).
      const p = navigator.mediaDevices.getUserMedia({ video: true });
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

        // Best-effort upgrade to the rear (environment-facing) camera. We
        // do this AFTER the permissive {video:true} succeeded so we never
        // get blocked on facingMode constraints. If the swap fails (single-
        // camera laptop, browser doesn't support applyConstraints) we just
        // keep the original stream — the QR scanner still works either way.
        try {
          const track = s.getVideoTracks()[0];
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if (track && typeof (track as any).applyConstraints === "function") {
            await (track as MediaStreamTrack).applyConstraints({ facingMode: { ideal: "environment" } as ConstrainDOMString });
          }
        } catch { /* keep original track */ }

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
        // it OR (Brave) when Shields silently blocks the API. Tailor the
        // step-by-step instructions to the specific browser they're on.
        if (name === "NotAllowedError" || name === "SecurityError" ||
            /denied|not allowed|permission/i.test(msg)) {
          setError(`Camera access was blocked. ${permissionStepsFor(browser)} Or use OTP instead.`);
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

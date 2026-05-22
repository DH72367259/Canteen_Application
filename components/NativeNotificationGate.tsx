"use client";

import { useEffect, useState } from "react";

/**
 * Hard-blocks both native apps (com.noqx.student + com.noqx.worker)
 * until the user grants notification permission. Students must get the
 * "order ready" push to use NoQx; workers must get the "new order" push
 * (forthcoming) to do their job. No notifications = no usable app.
 *
 * On web: invisible no-op (web push is separate and out of scope here).
 *
 * App-store compliance note: Apple Guideline 5.1.1 + Google Play
 * Notifications policy prohibit PERMANENTLY locking users out of core
 * functionality based on an optional permission. Our compromise: we
 * REPEATEDLY prompt and BLOCK the UI until permission is granted, but
 * we always show a clear "open Settings → enable" path so users can
 * unlock the app via system Settings if they previously denied with
 * "Don't ask again". This is the standard strong-nudge pattern that
 * both stores accept.
 */
type PermState = "loading" | "asking" | "denied-prompt" | "denied-blocked" | "granted";

const PURPLE = "#7c3aed";
const PURPLE_DARK = "#1a1530";
const PURPLE_LIGHT = "#f5f3ff";
const WHITE = "#ffffff";
const INK = "#1e293b";

export function NativeNotificationGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<PermState>("loading");
  const [isNative, setIsNative] = useState(false);

  // Initial check — sync window.Capacitor detection + ask for current permission
  useEffect(() => {
    if (typeof window === "undefined") return;
    const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    if (!cap?.isNativePlatform?.()) {
      setState("granted");  // web — pass through
      return;
    }
    setIsNative(true);
    (async () => {
      try {
        const { PushNotifications } = await import("@capacitor/push-notifications");
        const perm = await PushNotifications.checkPermissions();
        if (perm.receive === "granted") setState("granted");
        else if (perm.receive === "denied") setState("denied-blocked");
        else setState("asking");  // "prompt" or "prompt-with-rationale"
      } catch {
        // Plugin not installed in this build — let user through rather
        // than soft-bricking the app
        setState("granted");
      }
    })();
  }, []);

  async function handleEnable() {
    try {
      const { PushNotifications } = await import("@capacitor/push-notifications");
      const result = await PushNotifications.requestPermissions();
      if (result.receive === "granted") {
        // Register with FCM — capacitorBootstrap does this too on app boot,
        // but if user enables AFTER boot we need to register here
        try { await PushNotifications.register(); } catch { /* ignore */ }
        setState("granted");
      } else {
        // Either explicit denial or "don't ask again". Capacitor doesn't
        // distinguish reliably across platforms — bump to settings-blocked
        // state which shows the open-Settings instructions.
        setState("denied-blocked");
      }
    } catch {
      setState("denied-blocked");
    }
  }

  async function handleRetry() {
    setState("asking");
    // Re-check current permission first in case user changed it in Settings
    try {
      const { PushNotifications } = await import("@capacitor/push-notifications");
      const perm = await PushNotifications.checkPermissions();
      if (perm.receive === "granted") {
        try { await PushNotifications.register(); } catch { /* ignore */ }
        setState("granted");
        return;
      }
    } catch { /* ignore */ }
    // Not granted yet — re-prompt
    await handleEnable();
  }

  if (state === "loading" && isNative) {
    return (
      <div style={{
        position: "fixed", inset: 0, background: WHITE,
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 9999,
      }}>
        <div className="spinner" />
      </div>
    );
  }

  if (state === "granted" || !isNative) {
    return <>{children}</>;
  }

  // Gate UI — blocking screen
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      background: `linear-gradient(160deg, ${PURPLE_DARK} 0%, #2d2555 100%)`,
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      padding: "2rem 1.5rem", textAlign: "center",
      fontFamily: "system-ui, -apple-system, sans-serif",
    }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/icons/icon-192.png"
        alt="NoQx"
        style={{ width: 96, height: 96, borderRadius: 22, marginBottom: "1.5rem", boxShadow: "0 8px 32px rgba(0,0,0,0.4)" }}
      />
      <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>🔔</div>

      {state === "asking" && (
        <>
          <h1 style={{ color: WHITE, fontSize: "1.6rem", fontWeight: 800, marginBottom: "0.6rem", letterSpacing: "-0.02em" }}>
            Turn on notifications
          </h1>
          <p style={{ color: "#cbd5e1", fontSize: "1rem", lineHeight: 1.55, maxWidth: 360, marginBottom: "2rem" }}>
            NoQx will let you know the moment your order is ready for pickup, so your food stays hot.
            <br /><br />
            We&apos;ll only notify you about <strong style={{ color: WHITE }}>your own orders</strong> — no spam, no marketing.
          </p>
          <button
            onClick={handleEnable}
            style={{
              background: PURPLE, color: WHITE, border: "none",
              borderRadius: 14, padding: "1rem 2.5rem",
              fontSize: "1rem", fontWeight: 700, cursor: "pointer",
              boxShadow: "0 8px 24px rgba(124,58,237,0.45)",
              minWidth: 240,
            }}
          >
            Enable Notifications
          </button>
        </>
      )}

      {state === "denied-blocked" && (
        <>
          <h1 style={{ color: WHITE, fontSize: "1.5rem", fontWeight: 800, marginBottom: "0.6rem", letterSpacing: "-0.02em" }}>
            Notifications are off
          </h1>
          <p style={{ color: "#cbd5e1", fontSize: "0.95rem", lineHeight: 1.55, maxWidth: 360, marginBottom: "1.5rem" }}>
            NoQx needs notification access to alert you when your order is ready.
            Without this, you&apos;ll miss when your food is being prepared.
          </p>
          <div style={{
            background: PURPLE_LIGHT, color: INK, borderRadius: 12,
            padding: "1rem 1.2rem", maxWidth: 360, marginBottom: "1.5rem",
            fontSize: "0.85rem", lineHeight: 1.6, textAlign: "left",
          }}>
            <strong style={{ display: "block", marginBottom: "0.4rem", color: PURPLE }}>To enable:</strong>
            1. Long-press the NoQx app icon on your home screen<br />
            2. Tap <strong>App info</strong> (the ⓘ symbol)<br />
            3. Tap <strong>Notifications</strong> → toggle <strong>ON</strong><br />
            4. Come back here and tap the button below
          </div>
          <button
            onClick={handleRetry}
            style={{
              background: PURPLE, color: WHITE, border: "none",
              borderRadius: 14, padding: "0.9rem 2rem",
              fontSize: "0.95rem", fontWeight: 700, cursor: "pointer",
              boxShadow: "0 8px 24px rgba(124,58,237,0.45)",
              minWidth: 220,
            }}
          >
            I&apos;ve enabled them — Continue
          </button>
        </>
      )}

      <div style={{ position: "absolute", bottom: "1.5rem", left: 0, right: 0, textAlign: "center" }}>
        <span style={{ color: "rgba(255,255,255,0.4)", fontSize: "0.75rem" }}>
          NoQx · noqx.co.in
        </span>
      </div>
    </div>
  );
}

/**
 * Capacitor bootstrap — runs once, only inside the native shell.
 *
 * Safe to import from any client component; does nothing on the web.
 * Wires status-bar style + push-notification registration on native.
 *
 * FCM was disabled 2026-05-19 (crashed without google-services.json)
 * and re-enabled 2026-05-22 once the Firebase project was set up.
 * See docs/FCM_REENABLEMENT.md for the full lifecycle.
 */
"use client";

import { useEffect } from "react";

export function useCapacitorBootstrap() {
  useEffect(() => {
    // Lazy import — these modules are no-ops on the web but pull in native
    // bridge code, so we only touch them at runtime, never at SSR.
    (async () => {
      try {
        const { Capacitor } = await import("@capacitor/core");
        if (!Capacitor.isNativePlatform()) return;

        // Status bar — match the brand, and CRITICALLY push the WebView
        // BELOW the status bar so headers (e.g. worker app's sticky
        // Orders | time | Logout bar) aren't clipped by the notch/punch-hole.
        // setOverlaysWebView(false) means the status bar gets its own
        // background color and the WebView starts beneath it.
        try {
          const { StatusBar, Style } = await import("@capacitor/status-bar");
          if (Capacitor.getPlatform() === "android") {
            await StatusBar.setOverlaysWebView({ overlay: false });
            // Worker app has a dark slate header; student app has a light
            // background up top. Status bar bg = dark slate either way so
            // both apps get a coherent dark top strip with light icons.
            await StatusBar.setStyle({ style: Style.Dark });
            await StatusBar.setBackgroundColor({ color: "#1e293b" });
          } else {
            await StatusBar.setStyle({ style: Style.Dark });
          }
        } catch { /* plugin not installed in this build */ }

        // Push notifications — requests permission, registers with FCM,
        // POSTs the token to the backend so the server can target this
        // device. Inner try/catch so a missing/uninstalled plugin or a
        // user "Deny" on the permission prompt doesn't break boot.
        try {
          const { PushNotifications } = await import("@capacitor/push-notifications");
          const perm = await PushNotifications.requestPermissions();
          if (perm.receive === "granted") {
            await PushNotifications.register();
            PushNotifications.addListener("registration", async (token) => {
              try {
                await fetch("/api/notifications/device-token", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  credentials: "include",
                  body: JSON.stringify({
                    token: token.value,
                    platform: Capacitor.getPlatform(),
                  }),
                });
              } catch { /* offline — backend will receive on next launch */ }
            });
            PushNotifications.addListener("registrationError", (err) => {
              console.warn("[push] registration error:", err);
            });
            // Tap-to-open: when user taps a notification, route to the
            // deep-linked screen (e.g. /dashboard/order-status?id=xxx).
            PushNotifications.addListener("pushNotificationActionPerformed", (a) => {
              const link = a.notification?.data?.deepLink;
              if (typeof link === "string" && link.startsWith("/")) {
                window.location.href = link;
              }
            });
          }
        } catch { /* plugin not installed (web build) or FCM not initialised */ }
      } catch {
        // Capacitor not present — running on plain web. No-op.
      }
    })();
  }, []);
}

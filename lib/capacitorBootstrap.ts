/**
 * Capacitor bootstrap — runs once, only inside the native shell.
 *
 * Safe to import from any client component; does nothing on the web.
 * Wires up: status-bar styling, push-notifications registration, and
 * surfaces the device push token so the backend can save it for
 * targeted notifications (order-ready, refund-processed, etc.).
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

        // Status bar — match the orange brand
        try {
          const { StatusBar, Style } = await import("@capacitor/status-bar");
          await StatusBar.setStyle({ style: Style.Dark });
          if (Capacitor.getPlatform() === "android") {
            await StatusBar.setBackgroundColor({ color: "#ffffff" });
          }
        } catch { /* plugin not installed in this build */ }

        // Push notifications — request permission then register
        try {
          const { PushNotifications } = await import("@capacitor/push-notifications");
          const perm = await PushNotifications.checkPermissions();
          let granted = perm.receive === "granted";
          if (!granted) {
            const req = await PushNotifications.requestPermissions();
            granted = req.receive === "granted";
          }
          if (granted) {
            await PushNotifications.register();
            PushNotifications.addListener("registration", async (token) => {
              // Best-effort: ship the token to the backend so we can target this device.
              // Endpoint not yet implemented; silently no-op on 404.
              try {
                await fetch("/api/notifications/device-token", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ token: token.value, platform: Capacitor.getPlatform() }),
                });
              } catch { /* offline — try again next launch */ }
            });
          }
        } catch { /* plugin not installed */ }
      } catch {
        // Capacitor not present — running on plain web. No-op.
      }
    })();
  }, []);
}

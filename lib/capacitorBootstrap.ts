/**
 * Capacitor bootstrap — runs once, only inside the native shell.
 *
 * Safe to import from any client component; does nothing on the web.
 * Currently wires up only the status-bar style.
 *
 * Push notifications were intentionally removed 2026-05-19 because the
 * @capacitor/push-notifications v8 plugin requires Firebase Cloud Messaging
 * (google-services.json) at the native level. Without that config, the
 * Android Firebase SDK throws during MainActivity.onCreate and the app
 * crashes BEFORE any JS runs — try/catch here cannot save it.
 *
 * Re-add when FCM is properly set up:
 *   1. Create Firebase project, register both Android packages
 *      (com.noqx.student + com.noqx.worker)
 *   2. Download google-services.json for each app
 *   3. Commit them into android/app/ and mobile-worker/android/app/
 *      (NOT the secret API keys — just the public client config)
 *   4. Reinstate @capacitor/push-notifications in both package.json files
 *   5. Restore the registration block below (see git log for the version
 *      that previously lived here)
 *   6. Build the /api/notifications/device-token endpoint server-side
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
      } catch {
        // Capacitor not present — running on plain web. No-op.
      }
    })();
  }, []);
}

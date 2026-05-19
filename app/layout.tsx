import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import { ServiceWorkerRegistrar } from "@/components/ServiceWorkerRegistrar";
import { UpdateBanner, ForceUpdateGate } from "@/components/UpdateGate";
import { CapacitorBoot } from "@/components/CapacitorBoot";
import { DisableDevTools } from "@/components/DisableDevTools";
import { NativeStudentGuard } from "@/components/NativeStudentGuard";
import { StuckLoadingRecovery } from "@/components/StuckLoadingRecovery";

export const metadata: Metadata = {
  title: "Canteen-Application",
  description: "Skip the queue. Order food from your college canteen.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Canteen-Application",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/icons/icon-144.png", sizes: "144x144" },
      { url: "/icons/icon-152.png", sizes: "152x152" },
      { url: "/icons/icon-192.png", sizes: "192x192" },
    ],
  },
};

export const viewport: Viewport = {
  themeColor: "#ff6b35",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="Canteen-Application" />
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
        <link rel="apple-touch-startup-image" href="/icons/icon-512.png" />
        {/* Establish connection to Supabase before any JS runs — cuts ~200-400ms on cold loads */}
        <link rel="preconnect" href="https://dpycfyeiyhzvwbythcrp.supabase.co" />
        <link rel="dns-prefetch" href="https://dpycfyeiyhzvwbythcrp.supabase.co" />
      </head>
      <body>
        <DisableDevTools />
        <ServiceWorkerRegistrar />
        <CapacitorBoot />
        <AuthProvider>
          <NativeStudentGuard>
            <ForceUpdateGate>
              <UpdateBanner />
              {/* Recovery banner that surfaces only when auth-context's
                  loading stays true past 10s — gives users a one-tap
                  escape from stale-cookie hangs (Brave cookie partitioning,
                  corrupted Supabase session token, etc.). Invisible
                  otherwise. */}
              <StuckLoadingRecovery />
              {children}
            </ForceUpdateGate>
          </NativeStudentGuard>
        </AuthProvider>
      </body>
    </html>
  );
}

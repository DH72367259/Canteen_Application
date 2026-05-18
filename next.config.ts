import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-DNS-Prefetch-Control",   value: "on" },
  { key: "X-Frame-Options",           value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options",    value: "nosniff" },
  { key: "Referrer-Policy",           value: "strict-origin-when-cross-origin" },
  // Permissions-Policy gates which browser APIs the page is ALLOWED to
  // use, even before the user grants permission. () = blocked entirely,
  // (self) = page may request the API (browser then asks the user).
  //   camera=(self):  worker QR scanner needs this. Without it,
  //                   getUserMedia rejects with NotAllowedError no matter
  //                   what Chrome Site settings say. THIS WAS THE ROOT
  //                   CAUSE of "camera blocked even when permission is
  //                   granted" — fixed 2026-05-18.
  //   microphone=():  not needed anywhere; keep disabled.
  //   geolocation=(self): user app's "Use my current location" button.
  { key: "Permissions-Policy",        value: "camera=(self), microphone=(), geolocation=(self)" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://apis.google.com https://checkout.razorpay.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self' https://*.supabase.co https://api.razorpay.com https://lumberjack.razorpay.com",
      "script-src-elem 'self' 'unsafe-inline' https://checkout.razorpay.com",
      "frame-src https://api.razorpay.com https://checkout.razorpay.com",
      "worker-src 'self' blob:",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  output: "standalone",
  compress: true,
  poweredByHeader: false,
  experimental: {
    // Tree-shake large packages — reduces JS bundle size and speeds up initial parse
    optimizePackageImports: ["@supabase/supabase-js", "lucide-react"],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;

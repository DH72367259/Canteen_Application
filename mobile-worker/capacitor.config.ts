import type { CapacitorConfig } from '@capacitor/cli';

/**
 * NoQx Worker — Android-only native shell for canteen workers.
 *
 * Same strategy as the student app at /capacitor.config.ts: serverUrl
 * points at the live Railway deployment so the Next.js codebase serves
 * both web and native. NativeWorkerGuard signs out any non-worker role
 * that opens this app.
 *
 * Initial URL is /worker/login because workers don't need the public
 * landing — they go straight to login.
 */
const SERVER_URL = process.env.CAPACITOR_SERVER_URL ?? 'https://noqx.up.railway.app/worker/login';

const config: CapacitorConfig = {
  appId: 'com.noqx.worker',
  appName: 'NoQx Worker',
  webDir: 'public',
  server: {
    url: SERVER_URL,
    cleartext: false,
    androidScheme: 'https',
    allowNavigation: [
      'noqx.up.railway.app',
      '*.supabase.co',
      'api.razorpay.com',
      'checkout.razorpay.com',
      'lumberjack.razorpay.com',
    ],
  },
  android: {
    backgroundColor: '#ffffff',
    allowMixedContent: false,
    // Workers scan QR codes — captureInput true lets the WebView own gesture handling
    captureInput: true,
    webContentsDebuggingEnabled: false,
    minWebViewVersion: 80,
  },
  plugins: {
    PushNotifications: {
      // Order-ready, new-order, cancelled notifications matter for kitchen staff
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#ffffff',
    },
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: '#2563eb',  // worker brand: blue (student is orange)
      androidSplashResourceName: 'splash',
      showSpinner: false,
    },
  },
};

export default config;

import type { CapacitorConfig } from '@capacitor/cli';

/**
 * NoQx Student — native iOS + Android shell for students only.
 *
 * Strategy: serverUrl points at the live Railway deployment so the same
 * Next.js codebase serves both web and native. The NativeStudentGuard
 * component in the app signs out any non-student role that opens this app
 * and shows a "Student app only" screen.
 *
 * CURRENTLY POINTS AT STAGING. Before shipping to Play Store / TestFlight,
 * switch SERVER_URL to https://canteenapplication-production.up.railway.app
 * (or rebuild with CAPACITOR_SERVER_URL=... env var).
 *
 * To test against a local dev server:
 *   CAPACITOR_SERVER_URL=http://192.168.x.x:3000 npx cap sync
 */
const SERVER_URL = process.env.CAPACITOR_SERVER_URL ?? 'https://canteenapplication-staging.up.railway.app';

const config: CapacitorConfig = {
  appId: 'com.noqx.student',
  appName: 'NoQx Student',
  webDir: 'public',                          // not used at runtime (serverUrl wins) but required by CLI
  server: {
    url: SERVER_URL,
    cleartext: false,
    androidScheme: 'https',
    iosScheme: 'https',
    allowNavigation: [
      'canteenapplication-staging.up.railway.app',
      'canteenapplication-production.up.railway.app',
      '*.supabase.co',
      'api.razorpay.com',
      'checkout.razorpay.com',
      'lumberjack.razorpay.com',
    ],
  },
  ios: {
    contentInset: 'always',
    limitsNavigationsToAppBoundDomains: false,
    backgroundColor: '#ffffff',
    preferredContentMode: 'mobile',
  },
  android: {
    backgroundColor: '#ffffff',
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
    minWebViewVersion: 80,
  },
  plugins: {
    // PushNotifications removed until FCM (google-services.json) is configured.
    // Without FCM the Android Firebase SDK crashes during MainActivity.onCreate.
    // See lib/capacitorBootstrap.ts for re-enable instructions.
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#ffffff',
    },
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#7c3aed',
      androidSplashResourceName: 'splash',
      showSpinner: false,
    },
  },
};

export default config;

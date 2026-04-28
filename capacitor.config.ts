import type { CapacitorConfig } from '@capacitor/cli';

/**
 * NoQx mobile shell — wraps the live Railway web app inside iOS + Android.
 *
 * Strategy: serverUrl points at the production web deployment so the same
 * Next.js codebase serves both web and native (no static export, all server
 * routes including Razorpay endpoints work). Native shell adds:
 *   - Push notifications (FCM / APNs)
 *   - Status bar styling
 *   - Network reachability
 *   - Encrypted Preferences (Keychain on iOS, EncryptedSharedPreferences on Android)
 *
 * To switch apps to a development build pointing at localhost, override
 * CAPACITOR_SERVER_URL before running `npx cap sync`.
 */
const SERVER_URL = process.env.CAPACITOR_SERVER_URL ?? 'https://noqx.up.railway.app';

const config: CapacitorConfig = {
  appId: 'com.noqx.app',
  appName: 'NoQx',
  webDir: 'public',                          // not used at runtime (serverUrl wins) but required by CLI
  server: {
    url: SERVER_URL,
    cleartext: false,                        // production = HTTPS only
    androidScheme: 'https',
    iosScheme: 'https',
    allowNavigation: [
      'noqx.up.railway.app',
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
  },
  android: {
    backgroundColor: '#ffffff',
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#ffffff',
    },
  },
};

export default config;

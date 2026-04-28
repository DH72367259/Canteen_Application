# NoQx — Mobile (iOS + Android) shell

The web app at https://noqx.up.railway.app is the source of truth. The
iOS and Android apps are thin Capacitor wrappers around that production
URL — same Next.js codebase, same Razorpay flow, same Supabase auth — plus
native push notifications, status-bar styling, and Keychain/Encrypted
storage for tokens.

## One-time bootstrap (per developer machine)

Native folders (`ios/`, `android/`) are NOT committed because they
contain absolute Xcode/Gradle paths and bloat the repo. Each developer
runs the `cap add` step once locally.

### macOS (iOS + Android)

```bash
# 1. Install Xcode (App Store) and Android Studio (https://developer.android.com/studio)
# 2. Install CocoaPods (one-off)
sudo gem install cocoapods

# 3. From the repo root:
npm install
npm run cap:add:ios          # creates ios/ — DO NOT COMMIT
npm run cap:add:android      # creates android/ — DO NOT COMMIT
npm run cap:sync             # copies web assets + plugin pods/gradle
```

### Run on a device

```bash
npm run cap:open:ios         # opens Xcode → Run on simulator/device
npm run cap:open:android     # opens Android Studio → Run on emulator/device
```

## Pointing at a different backend

By default the apps load `https://noqx.up.railway.app`. To run against
localhost (e.g. for plugin debugging):

```bash
CAPACITOR_SERVER_URL=http://192.168.1.42:3000 npm run cap:sync
```

Then re-run `cap open ios` / `cap open android`. Note: iOS will reject
plain `http://` unless you also flip `cleartext: true` and add an ATS
exception — only do this in dev builds.

## Push notifications

* **iOS:** Add the `Push Notifications` capability in Xcode and upload
  your APNs auth key to Firebase (App > Project Settings > Cloud
  Messaging).
* **Android:** Drop `google-services.json` into `android/app/` after
  creating the Firebase project.

The mobile shell (`lib/capacitorBootstrap.ts`) requests permission on
launch, registers the device, and POSTs the token to
`/api/notifications/device-token`. Tokens are stored in the
`device_tokens` table (migration `phase5_device_tokens.sql`).

## Release builds

* **iOS:** Xcode → Product → Archive → Distribute via App Store Connect.
* **Android:** `cd android && ./gradlew bundleRelease` produces an
  `.aab` ready for the Play Console.

The two GitHub Actions workflows in `.github/workflows/` document the
TestFlight + Play Store internal-track upload pipelines (require
secrets to be configured before they will run).

## Why a remote-URL shell instead of a static export?

The Next.js app uses ~30+ server routes (Razorpay, Supabase admin
client, settlements). A static export would lose all of them. Loading
the live web app inside the native shell keeps one codebase, one
deploy pipeline, and lets us push UI changes to phones the same instant
they ship to the web.

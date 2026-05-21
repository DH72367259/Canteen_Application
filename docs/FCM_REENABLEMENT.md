# FCM (Push Notifications) Re-enablement Guide

Push notifications were intentionally removed 2026-05-19 (commit `a23682c`)
because both Android apps crashed on launch without `google-services.json`.
This doc is the step-by-step to safely re-enable them once Firebase is
configured.

**Scope:** Android only for v1 — iOS push needs APNs setup which requires
the Apple Developer Program. Add that later.

---

## Why this is in a separate doc

The codebase already has FCM **scaffold** in place:
- `android/build.gradle` keeps the `com.google.gms:google-services:4.4.2` classpath
- `android/app/build.gradle` has a conditional `apply plugin` based on file presence
- `lib/capacitorBootstrap.ts` has a docstring listing the exact restore steps
- `capacitor.config.ts` is ready to accept a `PushNotifications` plugin config

Everything is staged for a clean re-enable. **Do not skip any step** —
the original crash happened because the Firebase SDK initialises in
`MainActivity.onCreate` BEFORE any JS runs, so try/catch can't save you.

---

## Prerequisites (operator)

- [ ] Firebase project created at https://console.firebase.google.com
- [ ] Both Android apps registered in the Firebase console:
  - Package: `com.noqx.student` — display name: "NoQx"
  - Package: `com.noqx.worker` — display name: "NoQx Worker"
- [ ] `google-services.json` downloaded for BOTH apps (one file each — they
      contain different `client_id` values)
- [ ] FCM enabled in the Firebase project (Cloud Messaging API)
- [ ] A Firebase Admin SDK service-account JSON downloaded (for the server
      side — needs `firebase-admin` SDK to send pushes)

---

## Step 1 — Drop google-services.json into both apps

```bash
# From repo root, after operator has the 2 files in ~/Downloads:
cp ~/Downloads/student-google-services.json android/app/google-services.json
cp ~/Downloads/worker-google-services.json  mobile-worker/android/app/google-services.json

# Verify both files are committed to git:
git add android/app/google-services.json mobile-worker/android/app/google-services.json
git status   # confirm both staged
```

⚠️ `google-services.json` is **public client config** (safe to commit) —
not a secret. The dangerous file is the Admin SDK service-account JSON,
which never goes in the repo.

---

## Step 2 — Reinstall the @capacitor/push-notifications plugin

Both apps need the plugin in their package.json:

```bash
# Student app
npm install @capacitor/push-notifications@^8.0.0

# Worker app
cd mobile-worker
npm install @capacitor/push-notifications@^8.0.0
cd ..
```

Verify:
```bash
grep '"@capacitor/push-notifications"' package.json mobile-worker/package.json
# expect both to show ^8.0.0
```

---

## Step 3 — Restore the registration code in capacitorBootstrap.ts

Open `lib/capacitorBootstrap.ts` and add this block INSIDE the existing
`useEffect`, after the StatusBar block:

```typescript
// Push notifications — only registers on native, no-op on web.
try {
  const { PushNotifications } = await import("@capacitor/push-notifications");
  const perm = await PushNotifications.requestPermissions();
  if (perm.receive === "granted") {
    await PushNotifications.register();
    PushNotifications.addListener("registration", async (token) => {
      // POST token to backend so we can send pushes to this device
      try {
        await fetch("/api/notifications/device-token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: token.value, platform: Capacitor.getPlatform() }),
        });
      } catch { /* offline — backend will retry on next launch */ }
    });
    PushNotifications.addListener("registrationError", (err) => {
      console.error("Push registration failed:", err);
    });
  }
} catch { /* plugin not installed (web build) — silent */ }
```

Also update the docstring at the top of the file to remove the "removed
2026-05-19" warning since FCM is now wired up.

---

## Step 4 — Add the PushNotifications plugin config to capacitor.config.ts

Both files need the same plugin block. Example for student
(`capacitor.config.ts`):

```typescript
plugins: {
  SplashScreen: { /* existing config */ },
  PushNotifications: {
    presentationOptions: ["badge", "sound", "alert"],
  },
}
```

Repeat in `mobile-worker/capacitor.config.ts`.

---

## Step 5 — Build the `/api/notifications/device-token` endpoint

The server needs to:
1. Receive the device token from the app
2. Look up the user from the session cookie
3. Upsert into a `device_tokens` table

Create `app/api/notifications/device-token/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase-server";

export async function POST(req: Request) {
  const supabase = createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { token, platform } = await req.json();
  if (!token) return NextResponse.json({ error: "token required" }, { status: 400 });

  const { error } = await supabase
    .from("device_tokens")
    .upsert({
      user_id: user.id,
      token,
      platform,
      last_seen_at: new Date().toISOString(),
    }, { onConflict: "token" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
```

Schema migration (`supabase/migrations/phase11_device_tokens.sql`):

```sql
CREATE TABLE IF NOT EXISTS public.device_tokens (
  token text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('android', 'ios', 'web')),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX device_tokens_user_id_idx ON public.device_tokens(user_id);

-- RLS: users can only see/manage their own tokens
ALTER TABLE public.device_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY device_tokens_own ON public.device_tokens
  FOR ALL USING (auth.uid() = user_id);
```

Remember to add the migration block to `supabase/SUPABASE_SETUP.sql` for
fresh-install consistency.

---

## Step 6 — Server-side sender (when an order changes status)

Install `firebase-admin`:
```bash
npm install firebase-admin
```

Add `lib/fcm.ts`:
```typescript
import admin from "firebase-admin";
import { createAdminClient } from "@/lib/supabase-admin";

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(
      JSON.parse(process.env.FIREBASE_ADMIN_SDK_JSON!)
    ),
  });
}

export async function sendPushToUser(userId: string, title: string, body: string) {
  const db = createAdminClient();
  const { data: tokens } = await db
    .from("device_tokens")
    .select("token")
    .eq("user_id", userId);
  if (!tokens?.length) return;

  await admin.messaging().sendEachForMulticast({
    tokens: tokens.map(t => t.token),
    notification: { title, body },
    android: { priority: "high" },
  });
}
```

Wire it into the order-status webhook / cron / status-change handler
(wherever the order transitions to `ready_for_pickup`).

Set `FIREBASE_ADMIN_SDK_JSON` env var in Railway (paste the entire JSON
contents as a single line).

---

## Step 7 — Build + test

```bash
# Sync changes into native projects
npx cap sync android
cd mobile-worker && npx cap sync android && cd ..

# Build APKs
# (use the existing CI workflows: android-internal.yml + android-worker-internal.yml,
# environment: staging)
```

**Test the crash regression first** — install BOTH staging APKs on a real
device. They must launch without crashing. (The whole reason FCM was
removed was the launch crash.)

**Then test the registration flow:**
1. Open app → grant notification permission when prompted
2. Check Railway logs for `POST /api/notifications/device-token` 200
3. Verify a row appears in `device_tokens` table in Supabase
4. From a server-side script (or admin tool), call `sendPushToUser(your_user_id, "test", "hello")`
5. Confirm the notification arrives on the device

---

## Rollback (if FCM re-enable breaks anything)

```bash
git revert HEAD     # the FCM re-enable commit
git push origin dev:main
```

The conditional `apply plugin: 'com.google.gms.google-services'` in
build.gradle means simply DELETING the `google-services.json` file would
also revert behaviour to "no FCM init, no crash" — but doing a git revert
is cleaner.

---

## Notes for iOS (later)

iOS push needs:
- Apple Developer Program enrolment ($99/yr)
- An APNs key from developer.apple.com
- Same `google-services.json` registered AGAIN on the iOS side (Firebase
  console → iOS app)
- A `GoogleService-Info.plist` dropped into `ios/App/App/`
- The iOS Podfile already supports the Firebase pod — no changes needed
- In Xcode: enable Push Notifications + Background Modes capabilities

Plan: ship Android push for v1, add iOS push in v1.1.

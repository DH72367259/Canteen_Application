# How to Install the NoQx APK on Android

The short version of how to install an `.apk` file on Android when the
app isn't published to the Play Store yet. Aimed at the canteen
operator + the client doing acceptance testing.

> Time required: ~3 minutes.

---

## 1. Download the APK

You'll receive a link like:
```
https://github.com/DH72367259/Canteen_Application/actions/runs/26200725287
```

Open it on the Android phone (or download on a laptop first, then
transfer via USB / email-to-yourself).

### From a GitHub Actions run:
1. Scroll to the **Artifacts** section at the bottom of the page
2. Click `noqx-student-staging.apk` (or `production` variant)
3. It downloads as a `.zip` — extract on your phone with any file manager
   (e.g. Google Files). The `.apk` is inside.

### From Google Drive / WhatsApp / email:
Just download as normal. Phone saves it to `Downloads/`.

---

## 2. Allow installs from "unknown sources" (one-time per phone)

Android blocks `.apk` installs by default. You need to allow it for the
app you're installing FROM (usually your file manager or browser).

**Recent Android (10+):**
1. Tap the APK file → Android shows: *"For your security, your phone
   is not allowed to install unknown apps from this source."*
2. Tap **Settings** in the dialog
3. Toggle **"Allow from this source"** to ON
4. Press back → tap **Install**

**Older Android (7-9):**
1. Settings → Security → toggle **"Unknown sources"** ON
2. Open file manager → tap APK → Install

⚠️ After installation, turn the toggle OFF again — keeps you safe
from sideloading malware later.

---

## 3. Install

1. Tap **Install** in the system dialog
2. Wait 10-20 seconds
3. **Tap "Open"** when prompted, OR find the NoQx icon on your home
   screen / app drawer

---

## 4. First-launch sanity check

When the app opens, verify all of these:

- [ ] **Splash screen** is purple `#7c3aed` (student) or blue (worker)
- [ ] **Logo** is the NoQx mark — NQX letters with glittering stars
      around them
- [ ] **Login screen title** says "NoQx" (not "Canteen-Application")
- [ ] **Student app**: only ONE login option visible (no "Canteen Login"
      tab)
- [ ] **Worker app**: title says "Worker Portal · NoQx Worker · Staff Login"
- [ ] Login screen has the purple "Send Verification Code" button (student)
      or orange "Sign In" (worker)

If ALL of the above match, the build is correct.

---

## 5. Common gotchas

| Symptom | Fix |
|---|---|
| "App not installed" with no detail | A previous version with a different signing cert is installed. Uninstall the old version first, then retry. |
| "Parsing error: there was a problem parsing the package" | The `.apk` file is corrupted (incomplete download). Re-download. |
| App icon appears but tapping it does nothing / crashes | Old build from before commit `a23682c` (push notifications crash). Use the latest APK. |
| App opens but stays blank / white | The web app at noqx.co.in is down. Check https://noqx.co.in in a browser. |
| Login button does nothing | The phone has no internet, or the corporate firewall blocks `noqx.co.in`. Toggle Wi-Fi off / try mobile data. |

---

## 6. Uninstalling

Long-press the NoQx app icon → **Uninstall** → confirm.

Settings → Apps → NoQx / NoQx Worker → Storage → Clear data also wipes
the saved login (useful when switching test accounts).

---

## 7. Staging vs Production APK — which is which?

| If the artifact name ends with… | The app talks to… | Use it for… |
|---|---|---|
| `-staging.apk` | https://canteenapplication-staging.up.railway.app | Internal QA / client preview testing |
| `-production.apk` | https://noqx.co.in | Public release / app store upload |

⚠️ Don't install BOTH at the same time on one phone — they share a
package name and the second will replace the first.

The login email + cart + everything else lives in different Supabase
projects between staging and prod, so accounts created on staging do
NOT work in production and vice versa.

---

## 8. For the client (acceptance testing checklist)

Once installed, please verify the following and report back to the
operator (`+91 70199 86046`):

- [ ] App icon looks correct (NoQx mark with glittering visible)
- [ ] Splash screen color matches brand
- [ ] Login page renders correctly (purple, "NoQx" title)
- [ ] Sign-up flow works: create an account with your real email →
      receive OTP within 30 seconds → verify
- [ ] Place a test order (use Razorpay test card `4111 1111 1111 1111`
      with any future expiry + any 3-digit CVV — this won't charge
      real money)
- [ ] Cancel the order → confirm refund "succeeded" in receipt
- [ ] Sign out → sign back in with same credentials
- [ ] Close the app → re-open → confirm you're still signed in

Anything that doesn't work as expected, screenshot and send to the
operator.

# Screenshot Capture Guide

What to capture, in what order, for the store listings. Run through this on a
real Android phone (Play Store) AND on the iOS simulator at iPhone 6.7"
(App Store).

## Required counts

| Store | Min | Max | Aspect / size |
|---|---|---|---|
| Play Store (Student) | 2 | 8 | 9:16, 1080×1920 or higher |
| Play Store (Worker) | 2 | 8 | 9:16, 1080×1920 or higher |
| App Store (Student, iPhone 6.7") | 3 | 10 | 1290×2796 portrait (iPhone 16 Pro Max) |
| App Store (Student, iPhone 6.5", optional) | 3 | 10 | 1242×2688 portrait |

If 6.7" is provided, App Store auto-scales for smaller devices; 5.5" no
longer required as of 2026.

## Test data needed before capturing

Sign in as the seeded student account against PRODUCTION, with:
- The seeded canteen visible (NoQx Demo Canteen, ID `7e431e40-44e8-...`)
- A "Masala Dosa" item in cart at slot 1:00–1:15 PM
- At least one completed order in history for the "Order History" shot
- The bin-status screen in `placed_in_bin` state for the OTP shot
  (run a real test order — get to "Your bin is ready" state)

## NoQx Student — the 6 shots to capture (in order)

| # | Screen | Path to reach | Caption (overlay text — optional) |
|---|---|---|---|
| 1 | Canteen list / home | `/dashboard` after login | "Pick your canteen" |
| 2 | Menu with live availability | `/dashboard/menu/{canteenId}` | "Browse the live menu" |
| 3 | Cart + slot picker | Add item → cart icon | "Pick your 15-min pickup slot" |
| 4 | Razorpay payment screen | Click "Place order" (use test card 4111 1111 1111 1111) | "Pay securely via Razorpay" |
| 5 | Order status — Preparing | `/dashboard/order-status` while order is `preparing` | "Watch your meal being prepared" |
| 6 | Bin OTP / pickup screen | `/dashboard/order-status` when order is `placed_in_bin` | "Show OTP at the counter" |

Optional 7th/8th: Order history list, Profile page.

## NoQx Worker — the 4 shots to capture

| # | Screen | Path | Caption |
|---|---|---|---|
| 1 | Live queue | Worker login → Orders tab | "Live queue, sorted by slot" |
| 2 | Prep summary | Worker dashboard → Prep tab | "What to make next" |
| 3 | OTP verify | Tap an order → "Verify OTP" | "Verify pickup in 2 taps" |
| 4 | Bin assignment | Bins tab | "Bin-level slot tracking" |

## How to capture

### Android (Play Store)
1. Plug phone into Mac, enable USB debugging
2. Open Chrome → `chrome://inspect` → find the WebView running NoQx
3. Click "Inspect" → use DevTools device-mode preview
4. **OR** simpler: on the phone, use Settings → Screenshots:
   - Power + Volume Down to capture
   - Files end up in `Pictures/Screenshots/`
5. `adb pull /sdcard/Pictures/Screenshots/ ~/Downloads/noqx-shots/`
6. Resize to 1080×1920 if needed: `sips -z 1920 1080 *.png`
7. Drop into `store-listing/android/screenshots/`

### iOS (App Store)
1. Open Xcode → Simulator → choose **iPhone 16 Pro Max** (6.9", 1290×2796)
2. Open Safari in simulator → `https://noqx.co.in/login` and reproduce flows
   - (or build the app to simulator: `npx cap run ios`)
3. ⌘+S in simulator (File → Save Screen) — saves to Desktop
4. Drop into `store-listing/ios/screenshots/`

## Captioning (recommended but optional)

Both stores allow either raw screenshots or framed/captioned ones. Captioned
screenshots perform 30-40% better in install conversion but require design
work.

**Cheap option:** use https://previewed.app or https://hotpot.ai/templates/app-store-screenshots
to add a phone frame + 1-line caption. Pick one of those, paste the 6
captions from the table above, export PNG.

**Free DIY option:** open the raw screenshot in Preview, add a 300px purple
(`#7c3aed`) band at top with white caption text, export. Looks utilitarian
but acceptable for v1.

## Verification before upload

- [ ] All shots are at the EXACT required pixel size (Play Store rejects
      undersized; App Store rejects wrong aspect)
- [ ] No status bar with low battery / debug overlays / personal info
- [ ] No staging URL visible in any screen
- [ ] Razorpay shot uses test mode but shows correct INR currency + amount
- [ ] OTP shot shows a fake OTP (not a real one — they're 6-digit)
- [ ] Caption text (if any) is legible at thumbnail size

## Folder structure when done

```
store-listing/
├── android/
│   ├── ic_launcher-512.png
│   └── screenshots/
│       ├── 01-canteen-list.png
│       ├── 02-menu.png
│       ├── 03-cart.png
│       ├── 04-payment.png
│       ├── 05-preparing.png
│       └── 06-pickup-otp.png
└── ios/
    ├── AppIcon-1024.png
    └── screenshots/
        ├── 01-canteen-list.png  (1290×2796)
        ├── 02-menu.png
        ├── 03-cart.png
        ├── 04-payment.png
        ├── 05-preparing.png
        └── 06-pickup-otp.png
```

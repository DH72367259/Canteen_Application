"""Regenerate every app icon size from a single source image.

Run from repo root after updating ~/Downloads/<source>.png OR
resources/icon-source.png.

Outputs (all derived from the same source, no padding/cropping — what
you see in the source is what ships):

  resources/icon.png                    1024x1024 (Capacitor master)
  public/icons/icon-{72..512}.png       8 web/PWA sizes
  android/app/src/main/res/mipmap-{m,h,xh,xxh,xxxh}dpi/
    ic_launcher.png                     legacy launcher (pre-API 26)
    ic_launcher_round.png               round-mask launcher
    ic_launcher_foreground.png          adaptive icon foreground
  ios-overrides/AppIcon.appiconset/icon-{20..1024}.png   13 iOS sizes
  store-listing/android/ic_launcher-512.png    Play Store icon
  store-listing/ios/AppIcon-1024.png            App Store icon
  store-listing/feature-graphic/feature-1024x500.png + promo-1080x1920.png
"""
from PIL import Image
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent
SOURCE = Path.home() / "Downloads" / "NoQx_logo_1 (1).png"
PURPLE = (124, 58, 237)            # #7c3aed brand purple
PURPLE_DARK = (26, 21, 48)         # #1a1530 logo starfield bg
WHITE = (255, 255, 255)

if not SOURCE.exists():
    print(f"ERROR: source not found at {SOURCE}", file=sys.stderr)
    sys.exit(1)

src = Image.open(SOURCE).convert("RGBA")
print(f"Source: {SOURCE.name} {src.size} mode={src.mode}")

def square(img, size):
    """Resize to exactly size×size using high-quality resampling."""
    return img.resize((size, size), Image.LANCZOS)

# ── 1. Capacitor master ──
master_1024 = square(src, 1024)
out = ROOT / "resources" / "icon.png"
out.parent.mkdir(parents=True, exist_ok=True)
master_1024.save(out, "PNG")
print(f"wrote {out}")

# ── 2. Web / PWA icons ──
web_sizes = [72, 96, 128, 144, 152, 192, 384, 512]
for s in web_sizes:
    out = ROOT / "public" / "icons" / f"icon-{s}.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    square(src, s).save(out, "PNG")
print(f"wrote {len(web_sizes)} web icons in public/icons/")

# ── 3. Android launcher icons ──
# Density buckets: mdpi=48, hdpi=72, xhdpi=96, xxhdpi=144, xxxhdpi=192
android_buckets = {
    "mdpi":    48,
    "hdpi":    72,
    "xhdpi":   96,
    "xxhdpi":  144,
    "xxxhdpi": 192,
}
# Adaptive-icon safe zone is the center 66dp of a 108dp canvas (~61%).
# To guarantee the NQX letters never clip under any launcher mask (round,
# rounded-square, teardrop, etc.) we shrink the source so it occupies
# only the center INNER_RATIO of the foreground canvas, with the
# launcher's adaptive BACKGROUND (#1a1530 dark purple) filling the rest.
# At INNER_RATIO=0.62 the letters are at ~37% of canvas (very safe) and
# the source's outer glittering reaches the safe-zone edge — visible
# under typical round masks, partially clipped at extreme corners.
INNER_RATIO = 0.62
for density, base_size in android_buckets.items():
    res_dir = ROOT / "android" / "app" / "src" / "main" / "res" / f"mipmap-{density}"
    res_dir.mkdir(parents=True, exist_ok=True)

    # Legacy (square) launcher — pre-API 26 phones + some launchers + the
    # task-switcher thumbnail. No mask applied, so source at full canvas.
    square(src, base_size).save(res_dir / "ic_launcher.png", "PNG")
    # Round launcher — Android applies the round mask itself.
    square(src, base_size).save(res_dir / "ic_launcher_round.png", "PNG")
    # Adaptive foreground — 108dp × 108dp at the density's px ratio
    # (2.25× base_size). Source is composited at INNER_RATIO of canvas
    # on the dark-purple background so the launcher's runtime mask can
    # crop the empty edges without touching the letters or most glittering.
    fg_size = int(base_size * 2.25)
    inner_size = int(fg_size * INNER_RATIO)
    fg = Image.new("RGBA", (fg_size, fg_size), PURPLE_DARK + (255,))
    inner = src.resize((inner_size, inner_size), Image.LANCZOS)
    offset = (fg_size - inner_size) // 2
    fg.paste(inner, (offset, offset), inner)
    fg.save(res_dir / "ic_launcher_foreground.png", "PNG")
print(f"wrote 5 densities × 3 variants in android/app/src/main/res/mipmap-* (foreground at {int(INNER_RATIO*100)}% safe-zone)")

# ── 4. iOS app icons ──
ios_sizes = [20, 29, 40, 58, 60, 76, 80, 87, 120, 152, 167, 180, 1024]
ios_dir = ROOT / "ios-overrides" / "AppIcon.appiconset"
ios_dir.mkdir(parents=True, exist_ok=True)
for s in ios_sizes:
    # iOS doesn't allow transparency on the 1024x1024 — flatten onto dark bg
    if s == 1024:
        canvas = Image.new("RGB", (1024, 1024), PURPLE_DARK)
        resized = square(src, 1024)
        canvas.paste(resized, (0, 0), resized)
        canvas.save(ios_dir / f"icon-{s}.png", "PNG")
    else:
        square(src, s).save(ios_dir / f"icon-{s}.png", "PNG")
print(f"wrote {len(ios_sizes)} iOS icons in ios-overrides/AppIcon.appiconset/")

# ── 5. Store listing icons ──
store_dir = ROOT / "store-listing"
(store_dir / "android").mkdir(parents=True, exist_ok=True)
(store_dir / "ios").mkdir(parents=True, exist_ok=True)
(store_dir / "feature-graphic").mkdir(parents=True, exist_ok=True)

# Play Store: 512x512, no transparency
play = Image.new("RGB", (512, 512), PURPLE_DARK)
play.paste(square(src, 512), (0, 0), square(src, 512))
play.save(store_dir / "android" / "ic_launcher-512.png", "PNG")

# App Store: 1024x1024, no transparency
appstore = Image.new("RGB", (1024, 1024), PURPLE_DARK)
appstore.paste(square(src, 1024), (0, 0), square(src, 1024))
appstore.save(store_dir / "ios" / "AppIcon-1024.png", "PNG")
print("wrote store-listing/{android,ios}/ icons")

# ── 6. Feature graphic 1024x500 (Play Store) ──
W, H = 1024, 500
fg = Image.new("RGB", (W, H), PURPLE)
# Gradient
from PIL import ImageDraw, ImageFont
draw = ImageDraw.Draw(fg)
for x in range(W):
    t = x / W
    r = int(PURPLE[0] * (1 - 0.25 * t))
    g = int(PURPLE[1] * (1 - 0.25 * t))
    b = int(PURPLE[2] * (1 - 0.25 * t))
    draw.line([(x, 0), (x, H)], fill=(r, g, b))

# Logo on the left
target_h = 360
ratio = target_h / src.height
new_w = int(src.width * ratio)
logo_resized = src.resize((new_w, target_h), Image.LANCZOS)
lx = 60
ly = (H - target_h) // 2
fg.paste(logo_resized, (lx, ly), logo_resized)

def _font(sz):
    for cand in ("/System/Library/Fonts/SFNS.ttf",
                 "/System/Library/Fonts/Helvetica.ttc",
                 "/Library/Fonts/Arial.ttf"):
        try: return ImageFont.truetype(cand, sz)
        except: continue
    return ImageFont.load_default()

font_title = _font(64)
font_sub = _font(28)
tx = lx + new_w + 40
ty = 160
draw.text((tx, ty), "NoQx", fill=WHITE, font=font_title)
draw.text((tx, ty + 80), "Skip the queue.", fill=WHITE, font=font_sub)
draw.text((tx, ty + 118), "Pre-order. Pickup.", fill=WHITE, font=font_sub)
fg.save(store_dir / "feature-graphic" / "feature-1024x500.png", "PNG")

# ── 7. Promo 1080x1920 ──
PW, PH = 1080, 1920
pr = Image.new("RGB", (PW, PH), PURPLE)
prdraw = ImageDraw.Draw(pr)
for y in range(PH):
    t = y / PH
    r = int(PURPLE[0] * (1 - 0.35 * t))
    g = int(PURPLE[1] * (1 - 0.35 * t))
    b = int(PURPLE[2] * (1 - 0.35 * t))
    prdraw.line([(0, y), (PW, y)], fill=(r, g, b))

target = 600
prlogo = square(src, target)
lx = (PW - target) // 2
ly = 220
pr.paste(prlogo, (lx, ly), prlogo)

pf_title = _font(120)
pf_sub = _font(56)
bbox = prdraw.textbbox((0, 0), "NoQx", font=pf_title)
tw = bbox[2] - bbox[0]
prdraw.text(((PW - tw) // 2, ly + target + 60), "NoQx", fill=WHITE, font=pf_title)
sub = "Pre-order canteen meals"
bbox = prdraw.textbbox((0, 0), sub, font=pf_sub)
sw = bbox[2] - bbox[0]
prdraw.text(((PW - sw) // 2, ly + target + 220), sub, fill=WHITE, font=pf_sub)
pr.save(store_dir / "feature-graphic" / "promo-1080x1920.png", "PNG")
print("wrote feature-graphic/{feature,promo}.png")

print("\nDONE. All icons regenerated from", SOURCE.name)
print(f"Master: resources/icon.png  ·  {len(web_sizes) + 5*3 + len(ios_sizes) + 2} sized variants")

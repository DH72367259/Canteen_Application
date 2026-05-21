"""Generate Play Store + App Store listing assets from the existing brand source.

Produces:
- store-listing/android/ic_launcher-512.png        (Play Store icon)
- store-listing/ios/AppIcon-1024.png               (App Store icon)
- store-listing/feature-graphic/feature-1024x500.png (Play Store feature graphic)
- store-listing/feature-graphic/promo-1080x1920.png  (Optional store promo)

Re-run any time the brand changes.
"""
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC_ICON = ROOT / "resources" / "icon.png"          # 1024x1024, 2x-padded
SRC_LOGO = Path.home() / "Downloads" / "NoQx_logo_.png"  # 500x500 client-supplied
PURPLE = (124, 58, 237)            # #7c3aed
PURPLE_DARK = (26, 21, 48)         # #1a1530 (logo starfield)
WHITE = (255, 255, 255)

OUT_ANDROID = ROOT / "store-listing" / "android"
OUT_IOS = ROOT / "store-listing" / "ios"
OUT_FEATURE = ROOT / "store-listing" / "feature-graphic"

def play_store_icon():
    """Play Store icon: 512x512, no transparency, brand background."""
    src = Image.open(SRC_ICON).convert("RGBA")
    canvas = Image.new("RGB", (512, 512), PURPLE_DARK)
    resized = src.resize((512, 512), Image.LANCZOS)
    canvas.paste(resized, (0, 0), resized)
    out = OUT_ANDROID / "ic_launcher-512.png"
    canvas.save(out, "PNG")
    print(f"wrote {out}")

def app_store_icon():
    """App Store icon: 1024x1024, no transparency, brand background."""
    src = Image.open(SRC_ICON).convert("RGBA")
    canvas = Image.new("RGB", (1024, 1024), PURPLE_DARK)
    canvas.paste(src, (0, 0), src)
    out = OUT_IOS / "AppIcon-1024.png"
    canvas.save(out, "PNG")
    print(f"wrote {out}")

def _font(size):
    for cand in (
        "/System/Library/Fonts/SFNS.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
        "/Library/Fonts/Arial.ttf",
    ):
        try:
            return ImageFont.truetype(cand, size)
        except Exception:
            continue
    return ImageFont.load_default()

def feature_graphic():
    """Play Store feature graphic: 1024x500, brand banner."""
    W, H = 1024, 500
    canvas = Image.new("RGB", (W, H), PURPLE)
    draw = ImageDraw.Draw(canvas)

    # Subtle gradient by drawing a darker right-third
    for x in range(W):
        t = x / W
        r = int(PURPLE[0] * (1 - 0.25 * t))
        g = int(PURPLE[1] * (1 - 0.25 * t))
        b = int(PURPLE[2] * (1 - 0.25 * t))
        draw.line([(x, 0), (x, H)], fill=(r, g, b))

    # Logo on the left
    logo = Image.open(SRC_ICON).convert("RGBA")
    target_h = 360
    ratio = target_h / logo.height
    new_w = int(logo.width * ratio)
    logo_resized = logo.resize((new_w, target_h), Image.LANCZOS)
    lx = 60
    ly = (H - target_h) // 2
    canvas.paste(logo_resized, (lx, ly), logo_resized)

    # Text on the right
    font_title = _font(64)
    font_sub = _font(28)
    tx = lx + new_w + 40
    ty = 160
    draw.text((tx, ty), "NoQx", fill=WHITE, font=font_title)
    draw.text((tx, ty + 80), "Skip the queue.", fill=WHITE, font=font_sub)
    draw.text((tx, ty + 118), "Pre-order. Pickup.", fill=WHITE, font=font_sub)

    out = OUT_FEATURE / "feature-1024x500.png"
    canvas.save(out, "PNG", quality=95)
    print(f"wrote {out}")

def promo_graphic():
    """Optional 9:16 promo for store sliders: 1080x1920."""
    W, H = 1080, 1920
    canvas = Image.new("RGB", (W, H), PURPLE)
    draw = ImageDraw.Draw(canvas)

    # Vertical gradient
    for y in range(H):
        t = y / H
        r = int(PURPLE[0] * (1 - 0.35 * t))
        g = int(PURPLE[1] * (1 - 0.35 * t))
        b = int(PURPLE[2] * (1 - 0.35 * t))
        draw.line([(0, y), (W, y)], fill=(r, g, b))

    # Logo center-top
    logo = Image.open(SRC_ICON).convert("RGBA")
    target = 600
    logo_resized = logo.resize((target, target), Image.LANCZOS)
    lx = (W - target) // 2
    ly = 220
    canvas.paste(logo_resized, (lx, ly), logo_resized)

    font_title = _font(120)
    font_sub = _font(56)
    title = "NoQx"
    bbox = draw.textbbox((0, 0), title, font=font_title)
    tw = bbox[2] - bbox[0]
    draw.text(((W - tw) // 2, ly + target + 60), title, fill=WHITE, font=font_title)
    sub = "Pre-order canteen meals"
    bbox = draw.textbbox((0, 0), sub, font=font_sub)
    sw = bbox[2] - bbox[0]
    draw.text(((W - sw) // 2, ly + target + 220), sub, fill=WHITE, font=font_sub)

    out = OUT_FEATURE / "promo-1080x1920.png"
    canvas.save(out, "PNG", quality=95)
    print(f"wrote {out}")

if __name__ == "__main__":
    OUT_ANDROID.mkdir(parents=True, exist_ok=True)
    OUT_IOS.mkdir(parents=True, exist_ok=True)
    OUT_FEATURE.mkdir(parents=True, exist_ok=True)
    play_store_icon()
    app_store_icon()
    feature_graphic()
    promo_graphic()
    print("\nDone. Outputs in store-listing/")

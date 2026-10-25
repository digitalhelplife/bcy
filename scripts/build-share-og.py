#!/usr/bin/env python3
"""Generate the social-card / favicon assets referenced by game-sharing.json.

These are intentionally simple brand assets built from the existing wordmark and app icon; no third-party art.
Run: python3 scripts/build-share-og.py
"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
BRAND = ROOT / 'public/assets/brand/brand_wordmark.webp'
ICON = ROOT / 'public/assets/brand/app_icon.webp'
OUT = ROOT / 'public/assets/share'
PAPER = (246, 240, 228, 255)
INK = (66, 91, 70, 255)
WOOD = (201, 166, 107, 255)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    og = Image.new('RGBA', (1200, 630), PAPER)
    d = ImageDraw.Draw(og)
    d.rounded_rectangle((24, 24, 1176, 606), radius=36, outline=WOOD, width=6)
    wordmark = Image.open(BRAND).convert('RGBA')
    scale = min(760 / wordmark.width, 240 / wordmark.height)
    w, h = int(wordmark.width * scale), int(wordmark.height * scale)
    og.alpha_composite(wordmark.resize((w, h), Image.Resampling.LANCZOS), ((1200 - w) // 2, (630 - h) // 2 - 24))
    # A quiet footer line; text is kept out of the raster so no font is required.
    d.line((360, 470, 840, 470), fill=(201, 166, 107, 200), width=3)
    d.ellipse((570, 456, 594, 480), fill=(110, 170, 160, 200))
    d.ellipse((606, 456, 630, 480), fill=(232, 196, 138, 200))
    og.save(OUT / 'og.png', 'PNG', optimize=True)

    icon = Image.open(ICON).convert('RGBA')
    icon.thumbnail((64, 64), Image.Resampling.LANCZOS)
    canvas = Image.new('RGBA', (64, 64), (0, 0, 0, 0))
    canvas.alpha_composite(icon, ((64 - icon.width) // 2, (64 - icon.height) // 2))
    canvas.save(OUT / 'favicon.png', 'PNG', optimize=True)
    print(f'wrote {OUT / "og.png"} and {OUT / "favicon.png"}')


if __name__ == '__main__':
    main()

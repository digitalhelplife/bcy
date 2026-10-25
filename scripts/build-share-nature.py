#!/usr/bin/env python3
"""Generate the F25 share_nature frame (1080x1440 RGBA WebP).

The frame is deliberately drawn from simple shapes (paper, border, leaves, washi tape) so it has no
third-party art dependency and can be regenerated deterministically. The content opening stays
transparent; renderShare() fills it with the plant illustration, observation cards and optional photo.

Run: python3 scripts/build-share-nature.py
"""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

W, H = 1080, 1440
PAPER = (246, 240, 228, 255)
INK = (66, 91, 70, 255)
WOOD = (201, 166, 107, 255)
SAGE = (110, 170, 160, 255)
MUTED = (216, 201, 172, 255)
OUT = Path(__file__).resolve().parent.parent / 'public' / 'assets' / 'share' / 'share_nature_template.webp'


def leaf(cx: float, cy: float, rx: float, ry: float, angle: float, color: tuple[int, int, int, int]) -> tuple[Image.Image, tuple[int, int]]:
    layer = Image.new('RGBA', (int(rx * 2 + 4), int(ry * 2 + 4)), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.ellipse((2, 2, rx * 2 + 1, ry * 2 + 1), fill=color)
    # Midrib
    d.line((2, ry + 2, rx * 2 + 1, ry + 2), fill=(255, 255, 255, 90), width=max(1, int(ry * 0.12)))
    layer = layer.rotate(angle, expand=True, resample=Image.Resampling.BICUBIC)
    return layer, (int(cx - layer.width / 2), int(cy - layer.height / 2))


def dashed_rect(d: ImageDraw.ImageDraw, box: tuple[int, int, int, int], color, width=3, dash=14, gap=10, radius=0):
    x1, y1, x2, y2 = box
    # Simple dashed perimeter; radius is ignored for the tiny corner segments.
    for x in range(x1, x2, dash + gap):
        d.line((x, y1, min(x + dash, x2), y1), fill=color, width=width)
        d.line((x, y2, min(x + dash, x2), y2), fill=color, width=width)
    for y in range(y1, y2, dash + gap):
        d.line((x1, y, x1, min(y + dash, y2)), fill=color, width=width)
        d.line((x2, y, x2, min(y + dash, y2)), fill=color, width=width)


def main() -> None:
    canvas = Image.new('RGBA', (W, H), (0, 0, 0, 0))

    # Soft paper shadow.
    shadow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((44, 50, 1044, 1330), radius=40, fill=(70, 54, 34, 28))
    canvas.alpha_composite(shadow)

    # Paper with a transparent opening.
    paper = Image.new('RGBA', (W, H), PAPER)
    paper_mask = Image.new('L', (W, H), 0)
    ImageDraw.Draw(paper_mask).rounded_rectangle((40, 40, 1040, 1320), radius=36, fill=255)
    opening_mask = Image.new('L', (W, H), 0)
    ImageDraw.Draw(opening_mask).rounded_rectangle((50, 250, 1030, 1170), radius=20, fill=255)
    paper_mask = ImageChops.subtract(paper_mask, opening_mask)
    canvas.paste(paper, (0, 0), paper_mask)

    d = ImageDraw.Draw(canvas)

    # Warm border around the content opening and the outer paper.
    d.rounded_rectangle((46, 246, 1034, 1174), radius=26, outline=WOOD, width=8)
    d.rounded_rectangle((40, 40, 1040, 1320), radius=36, outline=(184, 151, 99, 255), width=3)

    # Hand-journal accents: dotted rule under the title, a small leaf sprig, and washi tape.
    for x in range(250, 830, 22):
        d.line((x, 238, min(x + 12, 830), 238), fill=(110, 170, 160, 150), width=3)
    for cx, cy, rx, ry, angle, color in [
        (884, 200, 34, 15, -28, (110, 170, 160, 190)),
        (920, 176, 28, 12, 18, (201, 166, 107, 190)),
        (84, 1210, 30, 13, 24, (110, 170, 160, 160)),
    ]:
        layer, pos = leaf(cx, cy, rx, ry, angle, color)
        canvas.alpha_composite(layer, pos)

    # Washi tape at the top-left and bottom-right corners.
    tape = Image.new('RGBA', (220, 54), (0, 0, 0, 0))
    td = ImageDraw.Draw(tape)
    td.rectangle((0, 0, 220, 54), fill=(232, 196, 138, 130))
    for x in range(0, 220, 24):
        td.line((x, 0, x, 54), fill=(255, 255, 255, 55), width=4)
    tape = tape.rotate(-7, expand=True, resample=Image.Resampling.BICUBIC)
    canvas.alpha_composite(tape, (58, 62))
    tape2 = tape.rotate(9, expand=True, resample=Image.Resampling.BICUBIC)
    canvas.alpha_composite(tape2, (790, 1236))

    # A soft dashed frame inside the photo slot is drawn by the renderer when no photo exists,
    # so the frame itself stays free of fixed geometry that could clip a user's photo.

    # Footer rule above the fixed wordmark/notices drawn by drawFixedFooter().
    d.line((180, 1152, 900, 1152), fill=MUTED, width=2)
    for cx, cy, rx, ry, angle, color in [
        (160, 1120, 24, 11, -18, (110, 170, 160, 140)),
        (920, 1120, 24, 11, 18, (201, 166, 107, 140)),
    ]:
        layer, pos = leaf(cx, cy, rx, ry, angle, color)
        canvas.alpha_composite(layer, pos)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(OUT, 'WEBP', quality=95, method=6)
    print(f'wrote {OUT} ({OUT.stat().st_size // 1024} KiB)')


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Slice v2.1 AI-generated master sheets into runtime WebP sprites.

Masters live in /home/ubuntu/chengdu_game_assets/sources/v21 (transparent PNG, grid layout).
Each connected alpha region is assigned to the grid cell containing its centroid, so leaves that
slightly cross a gutter still end up with the right sprite. Re-runnable; overwrites outputs.
"""
from pathlib import Path
import sys
import numpy as np
from PIL import Image
from scipy import ndimage

SRC = Path('/home/ubuntu/chengdu_game_assets/sources/v21')
OUT = Path(__file__).resolve().parent.parent / 'public' / 'assets'

G1 = ['narcissus', 'plum_blossom', 'winter_jasmine', 'rapeseed', 'peach', 'crabapple']
G2 = ['paulownia', 'peony', 'gardenia', 'jasmine', 'balsam', 'gourd']
G3 = ['osmanthus', 'cotton_rose', 'ginkgo', 'citrus', 'garlic', 'wintersweet']
VISITORS = ['bulbul', 'dove', 'blackbird', 'laughingthrush', 'honeybee', 'swallowtail', 'dragonfly', 'ladybird', 'butterfly', 'snail']
CRAFTS = ['craft_pressed_bookmark', 'craft_herb_sachet', 'craft_ginkgo_bookmark', 'craft_leaf_print', 'craft_garlic_sprout', 'craft_season_bouquet']


def cells(path: Path, cols: int, rows: int):
    im = Image.open(path).convert('RGBA')
    arr = np.array(im)
    alpha = arr[:, :, 3] > 16
    H, W = alpha.shape
    lab, n = ndimage.label(ndimage.binary_dilation(alpha, iterations=6))
    boxes = {}
    for i, sl in enumerate(ndimage.find_objects(lab), start=1):
        if sl is None:
            continue
        mask = (lab[sl] == i) & alpha[sl]
        if mask.sum() < 400:  # stray speckles
            continue
        cy, cx = ndimage.center_of_mass(mask)
        cy += sl[0].start; cx += sl[1].start
        key = (min(rows - 1, int(cy // (H / rows))), min(cols - 1, int(cx // (W / cols))))
        b = boxes.get(key)
        y0, y1, x0, x1 = sl[0].start, sl[0].stop, sl[1].start, sl[1].stop
        boxes[key] = (min(b[0], y0), max(b[1], y1), min(b[2], x0), max(b[3], x1)) if b else (y0, y1, x0, x1)
        lab[sl][lab[sl] == i] = -1  # mark kept
    out = []
    for r in range(rows):
        for c in range(cols):
            if (r, c) not in boxes:
                sys.exit(f'{path.name}: empty cell r{r} c{c}')
            y0, y1, x0, x1 = boxes[(r, c)]
            crop = arr[y0:y1, x0:x1].copy()
            # drop alpha from other cells' components that intrude into this bbox
            sub = lab[y0:y1, x0:x1]
            keepmask = np.zeros(sub.shape, bool)
            cy0, cy1 = r * H / rows, (r + 1) * H / rows
            cx0, cx1 = c * W / cols, (c + 1) * W / cols
            labs2, _ = ndimage.label(alpha[y0:y1, x0:x1])
            for j, sl2 in enumerate(ndimage.find_objects(labs2), start=1):
                if sl2 is None:
                    continue
                m = labs2[sl2] == j
                yy, xx = ndimage.center_of_mass(m)
                yy += y0 + sl2[0].start; xx += x0 + sl2[1].start
                if cy0 <= yy < cy1 and cx0 <= xx < cx1:
                    keepmask[sl2] |= m
            keepmask = ndimage.binary_dilation(keepmask, iterations=2)
            crop[:, :, 3] = np.where(keepmask, crop[:, :, 3], 0)
            out.append(Image.fromarray(crop))
    return out


def fit(img: Image.Image, w: int, h: int, pad: int = 6) -> Image.Image:
    bbox = img.getbbox()
    img = img.crop(bbox)
    s = min((w - 2 * pad) / img.width, (h - 2 * pad) / img.height)
    img = img.resize((max(1, round(img.width * s)), max(1, round(img.height * s))), Image.LANCZOS)
    canvas = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    # bottom-centre anchor so plants stand on the same baseline as the originals
    canvas.alpha_composite(img, ((w - img.width) // 2, h - pad - img.height))
    return canvas


def save(img: Image.Image, rel: str):
    p = OUT / f'{rel}.webp'
    p.parent.mkdir(parents=True, exist_ok=True)
    img.save(p, 'WEBP', quality=82, method=6)


def main():
    groups = [G1, G2, G3]
    for gi, ids in enumerate(groups, start=1):
        mature = cells(SRC / f'plants_mature_g{gi}.png', 3, 2)
        seedling = cells(SRC / f'plants_seedling_g{gi}.png', 3, 2)
        bags = cells(SRC / f'seed_bags_g{gi}.png', 3, 2)
        for i, pid in enumerate(ids):
            save(fit(mature[i], 459, 512), f'plants/plant_{pid}_mature')
            save(fit(mature[i], 172, 192, 4), f'plants/plant_{pid}_icon')
            save(fit(mature[i], 653, 728), f'plants/plant_{pid}_codex_detail')
            save(fit(seedling[i], 320, 320), f'plants/plant_{pid}_seedling')
            save(fit(bags[i], 244, 256, 4), f'plants/plant_{pid}_seed')
    vis = cells(SRC / 'visitors_master.png', 5, 2)
    for i, vid in enumerate(VISITORS):
        save(fit(vis[i], 256, 256), f'visitors/visitor_{vid}')
    craft_master = SRC / 'crafts_master.png'
    if craft_master.exists():
        cr = cells(craft_master, 3, 2)
        for i, cid in enumerate(CRAFTS):
            save(fit(cr[i], 300, 300), f'decor/{cid}')
            save(fit(cr[i], 160, 160, 4), f'decor/{cid}_icon')
    else:
        print('crafts_master.png missing; craft sprites skipped')
    print('ok')


if __name__ == '__main__':
    main()

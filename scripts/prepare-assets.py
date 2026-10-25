#!/usr/bin/env python3
"""Copy the approved Chengdu art pack into public/assets in runtime-friendly formats.

Every runtime image becomes WebP (alpha sprites keep their alpha channel). The Dujiangyan scene, thumbnail and
puzzle art are all derived from the approved satellite-referenced 3D map-style redraw (v03);
the deprecated v0.1 Dujiangyan target sprites and puzzle art are intentionally not copied.
Usage: python3 scripts/prepare-assets.py
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = Path('/home/ubuntu/chengdu_game_assets/assets')
DJY = Path('/home/ubuntu/dujiangyan_redraw_v03/都江堰_立体文旅地图风格.png')
OUT = ROOT / 'public' / 'assets'

OPAQUE = {
    'scenes/scene_qingcheng_bg.png', 'scenes/scene_jiezi_bg.png',
    'scenes/scene_qingcheng_thumb.png', 'scenes/scene_jiezi_thumb.png',
    'puzzles/puzzle_qingcheng_art.png', 'puzzles/puzzle_jiezi_art.png',
    'garden/garden_base_bg.png', 'map/travel_map_bg.png',
}
SKIP_PREFIX = ('puzzles/dujiangyan_', 'puzzles/qingcheng_piece', 'puzzles/jiezi_piece',
               'targets/target_yuzui', 'targets/target_feishayan', 'targets/target_baopingkou',
               'scenes/scene_dujiangyan', 'scenes/scene_qingcheng_composite', 'scenes/scene_jiezi_composite',
               'puzzles/puzzle_dujiangyan')


def save_webp(im: Image.Image, dest: Path, q: int = 84) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    im.convert('RGB').save(dest.with_suffix('.webp'), 'WEBP', quality=q, method=6)


def main() -> None:
    count = 0
    for p in sorted(SRC.rglob('*.png')):
        rel = p.relative_to(SRC).as_posix()
        if rel.startswith(SKIP_PREFIX):
            continue
        im = Image.open(p)
        dest = OUT / rel
        if rel in OPAQUE:
            save_webp(im, dest)
        else:
            dest.parent.mkdir(parents=True, exist_ok=True)
            im.convert('RGBA').save(dest.with_suffix('.webp'), 'WEBP', quality=86, method=6)
        count += 1
    # Approved Dujiangyan redraw (1440x2560, 9:16) -> scene 1080x1920.
    djy = Image.open(DJY).convert('RGB')
    save_webp(djy.resize((1080, 1920), Image.LANCZOS), OUT / 'scenes/scene_dujiangyan_bg.png', 86)
    # Puzzle art 3:4 crop around the headworks (Yuzui, Feishayan, Baopingkou) -> 1080x1440.
    crop = djy.crop((150, 260, 1290, 1780))
    save_webp(crop.resize((1080, 1440), Image.LANCZOS), OUT / 'puzzles/puzzle_dujiangyan_art.png', 86)
    save_webp(djy.crop((60, 260, 1260, 1860)).resize((360, 480), Image.LANCZOS), OUT / 'scenes/scene_dujiangyan_thumb.png')
    count += 3
    print(f'prepared {count} runtime assets in {OUT}')


if __name__ == '__main__':
    main()

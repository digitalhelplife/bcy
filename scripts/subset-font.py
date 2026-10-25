#!/usr/bin/env python3
"""A5 G11: subset the CJK UI font to the characters the game actually uses.

Source font: assets-src/fonts/ManusCC0SansCJKSC-Regular.woff2 (not bundled).
Output:      src/assets/ManusCC0SansCJKSC-Subset.woff2 (bundled by Vite).
Characters:  everything in src/**, content/**, index.html + printable ASCII + common CJK punctuation.
Player-typed text (journal titles) that falls outside the subset renders with the system font (CSS fallback stack).
Deterministic; runs before every build. `--check` exits 1 when the committed subset is missing characters.
"""
import sys
from pathlib import Path

try:
    from fontTools import subset
    from fontTools.ttLib import TTFont
except ImportError:
    # Keep the committed subset when the build host has no fonttools; new characters fall back to system fonts.
    print('subset-font: fonttools not installed, keeping the committed src/assets/*-Subset.woff2')
    raise SystemExit(0)

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'assets-src/fonts/ManusCC0SansCJKSC-Regular.woff2'
OUT = ROOT / 'src/assets/ManusCC0SansCJKSC-Subset.woff2'
EXTRA = ''.join(chr(c) for c in range(0x20, 0x7F)) + '，。、；：？！“”‘’（）《》〈〉【】「」『』—…·～￥％＋－×÷＝＜＞°℃①②③④⑤⑥⑦⑧⑨⑩〇'


def used_chars() -> set[str]:
    chars = set(EXTRA)
    files = [ROOT / 'index.html']
    for d, exts in (('src', ('.ts', '.tsx', '.css')), ('content', ('.json',))):
        files += [p for p in (ROOT / d).rglob('*') if p.suffix in exts]
    for f in files:
        chars |= set(f.read_text(encoding='utf-8'))
    return {c for c in chars if c.isprintable() and not c.isspace() or c == ' '}


def main() -> int:
    chars = used_chars()
    font = TTFont(SRC)
    cmap = font.getBestCmap()
    wanted = sorted(c for c in chars if ord(c) in cmap)
    if '--check' in sys.argv:
        have = set(TTFont(OUT).getBestCmap()) if OUT.exists() else set()
        missing = [c for c in wanted if ord(c) not in have]
        print(f'[subset-font] {len(wanted)} chars needed, {len(missing)} missing from subset')
        return 1 if missing else 0
    opts = subset.Options()
    opts.flavor = 'woff2'
    opts.layout_features = ['*']
    opts.name_IDs = ['*']
    opts.notdef_outline = True
    opts.drop_tables += ['DSIG']
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=[ord(c) for c in wanted])
    sub.subset(font)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    font.flavor = 'woff2'
    font.save(OUT)
    print(f'[subset-font] {len(wanted)} chars -> {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KiB, source {SRC.stat().st_size // 1024} KiB)')
    return 0


if __name__ == '__main__':
    sys.exit(main())

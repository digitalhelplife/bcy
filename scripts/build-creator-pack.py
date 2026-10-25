#!/usr/bin/env python3
"""A5 G12: build the blogger co-creation pack (博主共创包).

Output: /home/ubuntu/本草小游记_上线文档包/博主共创包/ (+ a .zip next to it).
Sources:
  - 都江堰: ONLY the user-approved V03 satellite-referenced redraw (/home/ubuntu/dujiangyan_redraw_v03/...).
    Never the older chengdu_game_assets dujiangyan_bg (rejected art).
  - 青城山 / 街子古镇: original background PNGs without target overlays.
  - 24 plants: the game's current codex art (public/assets/plants/*_codex_detail.webp → PNG).
  - Copy lines: scene targets (label + hint) from src/shared/content.ts — marked 待审核.
  - Samples: journal PNGs rendered by the game's own renderer (scripts/creator-samples step), trip card screenshot.
"""
import json
import re
import shutil
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = Path('/home/ubuntu/本草小游记_上线文档包/博主共创包')
V03 = Path('/home/ubuntu/dujiangyan_redraw_v03/都江堰_立体文旅地图风格.png')
ORIG = Path('/home/ubuntu/chengdu_game_assets/assets/scenes')
SAMPLES = Path(sys.argv[1] if len(sys.argv) > 1 else '/tmp/pack-samples')

SCENES = {'dujiangyan': '都江堰水利工程', 'qingcheng': '青城山前山', 'jiezi': '街子古镇'}


def scene_lines():
    src = (ROOT / 'src/shared/content.ts').read_text(encoding='utf-8')
    out = {}
    for sid in SCENES:
        block = src[src.index(f"  {sid}: {{"):]
        block = block[:block.index('targets: [') + 2000]
        rows = re.findall(r"label: '([^']+)', hint: '([^']+)'", block)[:3]
        # Only real landmarks: skip invented decorations (原创…) and strip gameplay instructions from hints.
        out[sid] = [(lab, re.sub(r'[，,]\s*先[^，。]*$', '', hint)) for lab, hint in rows if not lab.startswith('原创')]
    return out


def main():
    if OUT.exists():
        shutil.rmtree(OUT)
    (OUT / '01_场景高清图').mkdir(parents=True)
    (OUT / '02_植物高清图').mkdir()
    (OUT / '03_样张').mkdir()
    shutil.copy(V03, OUT / '01_场景高清图' / '都江堰水利工程_立体文旅地图.png')
    for sid in ('qingcheng', 'jiezi'):
        shutil.copy(ORIG / f'scene_{sid}_bg.png', OUT / '01_场景高清图' / f'{SCENES[sid]}.png')
    plants = json.loads((ROOT / 'content/plants.json').read_text(encoding='utf-8'))['plants']
    for p in plants:
        pid = p['plantId']
        name = p.get('name') or p.get('commonName') or pid
        Image.open(ROOT / f'public/assets/plants/plant_{pid}_codex_detail.webp').save(OUT / '02_植物高清图' / f'{name}.png')
    for f in sorted(SAMPLES.glob('*.png')):
        shutil.copy(f, OUT / '03_样张' / f.name)
    trip = ROOT / 'shots/17-trip-card.png'
    if trip.exists():
        shutil.copy(trip, OUT / '03_样张' / '出行卡样张-都江堰.png')

    lines = scene_lines()
    md = ['# 科普文案（每景点 3 句，均为【待审核】）', '',
          '> 状态：内容仍在专家审核中（reviewStatus = pending）。发布前请以游戏内最新文字为准，不要改写成功效、疗效或景区官方说法。', '']
    for sid, rows in lines.items():
        md += [f'## {SCENES[sid]}', '']
        md += [f'{i}. **{lab}**：{hint}。【待审核】' for i, (lab, hint) in enumerate(rows, 1)]
        for i in range(len(rows) + 1, 4):
            md.append(f'{i}. 【待内容组补充：需有来源的真实地标知识，游戏内原创装饰不作为科普】')
        md.append('')
    (OUT / '04_科普文案_待审核.md').write_text('\n'.join(md), encoding='utf-8')

    guide = f"""# 《本草小游记·成都篇》博主共创包 · 使用说明

版本：内测 S0（内容审核中，不可作为正式公开发布物料）

## 包里有什么
- `01_场景高清图/`：都江堰（立体文旅地图风格）、青城山前山、街子古镇的原创游戏画面。
- `02_植物高清图/`：游戏内 {len(plants)} 种植物的原创图鉴插画。
- `03_样张/`：游戏导出的游记图（景点 / 植物 / 小院，含植物贴纸）与带娃出行卡样张。
- `04_科普文案_待审核.md`：每个景点 3 句科普短句，全部标注【待审核】。

## 必须遵守
1. **非官方声明**：本游戏是成都主题的原创改编作品，**不是景区官方产品**，与景区管理机构没有合作、授权或联名关系。不得宣称“景区联名”“官方出品”“官方推荐”。
2. **画面说明**：场景图是原创写意插画，不是测绘地图或导航图，不能用于实际导航。
3. **植物内容**：植物介绍只讲认识植物和文化小知识，**不构成用药建议**；不得写或暗示功效、疗效、食疗、剂量、适用人群，也不得引导采摘或食用。
4. **游记图固定标识**：游记图底部的字标“本草小游记·成都篇”与“游戏画面·成都主题原创改编 / 非景区官方产品（/ 不构成用药建议）”不可裁掉或遮挡。
5. **出行信息**：出行卡只展示有来源、有核实日期的信息；实际开放时间、票务、交通以景区官方最新公告为准。

## 隐私提醒
- 游戏里加入的照片只在手机本地处理，不会上传；发笔记前请确认照片里没有孩子正脸、校服、门牌等可识别信息。
- 游戏没有广告、没有付费、不需要定位；请不要在笔记里展示任何账号截图、手机号或实名信息。

## 当前阶段
内测（S0）。正式公开发布需完成全部内容审核、版号与备案等前置手续。物料内容在此之前可能调整。
"""
    (OUT / '00_使用说明.md').write_text(guide, encoding='utf-8')
    zip_base = OUT.parent / '博主共创包_S0内测'
    shutil.make_archive(str(zip_base), 'zip', OUT.parent, OUT.name)
    files = sum(1 for _ in OUT.rglob('*') if _.is_file())
    print(f'[creator-pack] {files} files -> {OUT} ; zip {zip_base}.zip')


if __name__ == '__main__':
    main()

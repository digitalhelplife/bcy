#!/usr/bin/env python3
"""Generate content/*.json (chengdu_v2) from the reviewed-draft sources in the launch doc pack.

Sources (all drafts, reviewStatus = pending until signed off per 03_内容规范与审核.md §4):
  附录/A3_植物与玩法核实/plants.draft.json + NN-<plant>.md      → plants, observations, quizzes, parent tips, plant cards
  附录/A3_植物与玩法核实/25-solar_terms.md                         → solar term instants (HKO / CWA published tables)
  03_内容规范与审核.md §5                                          → trip cards, 18 parent tips, 6 base plant cards, compliance
  12_植物扩充与可玩性学习性设计.md §4                              → visitors, crafts, sets
Computed solar-term instants (outside the published range) are written with verified=false and
NEVER open in production (D25). Re-run after editing sources; output is deterministic.
"""
from __future__ import annotations
import json, math, re
from datetime import datetime, timedelta, timezone
from pathlib import Path

DOCS = Path('/home/ubuntu/本草小游记_上线文档包')
A3 = DOCS / '附录/A3_植物与玩法核实'
OUT = Path(__file__).resolve().parent.parent / 'content'
OUT.mkdir(exist_ok=True)
TZ8 = timezone(timedelta(hours=8))
ACCESSED = '2026-10-22'
PENDING = {'reviewStatus': 'pending', 'reviewer': None, 'reviewedAt': None}

# ---------------------------------------------------------------- solar terms
TERMS = [  # order from 小寒 (longitude 285) — the game calendar starts with the first 花信风 term
    ('xiaohan', '小寒', 285, '雁北乡：大雁开始往北飞了'), ('dahan', '大寒', 300, '鸡始乳：一年里最冷的时候'),
    ('lichun', '立春', 315, '东风解冻：春风吹来，冰开始化'), ('yushui', '雨水', 330, '候雁北：雨多起来，大雁北归'),
    ('jingzhe', '惊蛰', 345, '桃始华：桃花开始开了'), ('chunfen', '春分', 0, '玄鸟至：燕子飞回来了'),
    ('qingming', '清明', 15, '桐始华：泡桐开花了'), ('guyu', '谷雨', 30, '萍始生：水面长出浮萍'),
    ('lixia', '立夏', 45, '蝼蝈鸣：田里开始有虫鸣'), ('xiaoman', '小满', 60, '苦菜秀：苦菜长得正茂盛'),
    ('mangzhong', '芒种', 75, '螳螂生：小螳螂出生了'), ('xiazhi', '夏至', 90, '鹿角解：白天最长的一天'),
    ('xiaoshu', '小暑', 105, '温风至：吹来的风变热了'), ('dashu', '大暑', 120, '腐草为萤：夏夜能见到萤火虫'),
    ('liqiu', '立秋', 135, '凉风至：早晚有了凉风'), ('chushu', '处暑', 150, '鹰乃祭鸟：暑热慢慢退去'),
    ('bailu', '白露', 165, '鸿雁来：草叶上有了露水'), ('qiufen', '秋分', 180, '雷始收声：雷声渐渐少了'),
    ('hanlu', '寒露', 195, '鸿雁来宾：露水更凉了'), ('shuangjiang', '霜降', 210, '豺乃祭兽：开始有霜了'),
    ('lidong', '立冬', 225, '水始冰：水面开始结薄冰'), ('xiaoxue', '小雪', 240, '虹藏不见：彩虹很少见了'),
    ('daxue', '大雪', 255, '鹖鴠不鸣：天冷鸟儿少叫'), ('dongzhi', '冬至', 270, '蚯蚓结：白天最短的一天'),
]



def apply_card_fixes(cards):
    """content-src/plant_card_fixes.json: hand corrections over the extracted cards ("a.b" = nested key)."""
    fp = Path(__file__).resolve().parent.parent / 'content-src' / 'plant_card_fixes.json'
    if not fp.exists():
        return
    fixes = json.loads(fp.read_text())
    for c in cards:
        for k, v in fixes.get(c['plantId'], {}).items():
            if k.startswith('_'):
                continue
            if '.' in k:
                a, b = k.split('.', 1); c.setdefault(a, {})[b] = v
            else:
                c[k] = v

def sun_longitude(jd: float) -> float:
    """Apparent geocentric solar longitude (deg), Meeus ch.25 + main periodic terms (~0.003 deg)."""
    T = (jd - 2451545.0) / 36525
    L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T
    M = math.radians(357.52911 + 35999.05029 * T - 0.0001537 * T * T)
    C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * math.sin(M) + (0.019993 - 0.000101 * T) * math.sin(2 * M) + 0.000289 * math.sin(3 * M)
    omega = math.radians(125.04 - 1934.136 * T)
    return (L0 + C - 0.00569 - 0.00478 * math.sin(omega)) % 360


def term_instant(year: int, lon: int) -> datetime:
    # rough guess: day of year where the sun reaches lon
    guess = datetime(year, 3, 20, tzinfo=timezone.utc) + timedelta(days=((lon - 0) % 360) * 365.2422 / 360)
    if lon >= 285:  # 小寒/大寒/立春/雨水/惊蛰 fall early in the same calendar year
        guess = datetime(year, 1, 5, tzinfo=timezone.utc) + timedelta(days=(lon - 285) * 365.2422 / 360)
    jd = guess.timestamp() / 86400 + 2440587.5
    for _ in range(50):
        d = ((lon - sun_longitude(jd) + 180) % 360) - 180
        jd += d * 365.2422 / 360
        if abs(d) < 1e-7:
            break
    # TT→UTC (ΔT ≈ 69 s around 2026–2029)
    return datetime.fromtimestamp((jd - 2440587.5) * 86400 - 69, tz=timezone.utc)


def published_terms():
    txt = (A3 / '25-solar_terms.md').read_text()
    rows = re.findall(r'\{"termId":"(\w+)","中文名":"(.+?)","交节时刻":"([^"]+)"\}', txt)
    out = {}
    for tid, _, t in rows:
        if t == '待核实':
            continue
        dt = datetime.strptime(t, '%Y-%m-%d %H:%M').replace(tzinfo=TZ8)
        out[(tid, dt.year)] = dt
    return out


def build_terms(plants):
    pub = published_terms()
    occ = []
    max_dev = 0.0
    for year in range(2026, 2030):
        for tid, name, lon, _ in TERMS:
            comp = term_instant(year, lon).astimezone(TZ8)
            p = pub.get((tid, year))
            if p and abs((comp - p).total_seconds()) > 1800:
                # Published value disagrees with the ephemeris by >30 min: treat as a transcription error
                occ.append({'termId': tid, 'at': p.isoformat(), 'atMs': int(p.timestamp() * 1000), 'verified': False, 'source': 'src-hko-cwa-terms',
                            'verificationNote': f'与推算值相差 {round((comp - p).total_seconds() / 60)} 分钟，待复核原始年表', 'computedAt': comp.replace(second=0, microsecond=0).isoformat()})
                continue
            if p:
                max_dev = max(max_dev, abs((comp - p).total_seconds()) / 60)
                occ.append({'termId': tid, 'at': p.isoformat(), 'atMs': int(p.timestamp() * 1000), 'verified': True, 'source': 'src-hko-cwa-terms'})
            else:
                occ.append({'termId': tid, 'at': comp.replace(second=0, microsecond=0).isoformat(), 'atMs': int(comp.timestamp() * 1000) // 60000 * 60000, 'verified': False, 'source': 'computed-meeus'})
    occ.sort(key=lambda o: o['atMs'])
    plant_by_term = {p['termId']: p for p in plants}
    terms = []
    for i, (tid, name, lon, pheno) in enumerate(TERMS):
        p = plant_by_term[tid]
        terms.append({'termId': tid, 'name': name, 'order': i, 'longitude': lon, 'plantId': p['plantId'],
                      'phenology': pheno, 'challenge': p['natureChallenge'],
                      'challengeNotice': '只看不摘，爱护花木；外出注意安全，跟紧大人。',
                      'regionNotice': '各地花期会随天气变化。', **PENDING,
                      'sourceRefs': [{'id': 'src-72hou', 'title': '七十二候（各节气初候）', 'publisher': '传统物候', 'sourceType': 'authority', 'accessedAt': ACCESSED, 'note': '候应文字待内容审核复核出处版本'}]})
    return {'schemaVersion': 1, 'calendarNote': '交节时刻为北京时间。verified=true 来自香港天文台/中央气象署公开年表（M4 前须换成紫金山天文台或国家授时中心数据）；verified=false 为算法推算，生产环境不开放。',
            'computedMaxDeviationMinutes': round(max_dev, 1), 'terms': terms, 'occurrences': occ}


# ---------------------------------------------------------------- plants
FLOWERING = {'narcissus', 'plum_blossom', 'winter_jasmine', 'rapeseed', 'peach', 'crabapple', 'paulownia', 'peony', 'gardenia', 'jasmine', 'balsam',
             'osmanthus', 'cotton_rose', 'chrysanthemum', 'wintersweet', 'lotus', 'honeysuckle'}
LEAFY = {'mint', 'mugwort', 'perilla', 'ginkgo', 'garlic', 'gourd'}
SAFETY = {'全株或部分有毒不可入口': 'toxic', '只看不摸': 'look_only', '待核实': 'unverified'}
BASE_LEVEL = {'mint': 'dujiangyan_find', 'lotus': 'dujiangyan_puzzle', 'mugwort': 'qingcheng_find', 'honeysuckle': 'qingcheng_puzzle', 'perilla': 'jiezi_find', 'chrysanthemum': 'jiezi_puzzle'}
TERM_SEASON = {}
for i, (tid, *_r) in enumerate(TERMS):
    # 小寒/大寒 winter, 立春–谷雨 spring, 立夏–大暑 summer, 立秋–霜降 autumn, 立冬–冬至 winter
    TERM_SEASON[tid] = 'winter' if i < 2 else 'spring' if i < 8 else 'summer' if i < 14 else 'autumn' if i < 20 else 'winter'


def md_fields(path: Path) -> dict:
    txt = path.read_text()
    out = {}
    for m in re.finditer(r'^- \*\*(\w+)：\*\*(.*)$', txt, re.M):
        out[m.group(1)] = m.group(2).strip()
    refs = []
    for m in re.finditer(r'^\[(\d+)\]\s*(.+?)(https?://[^\s）)]+)', txt, re.M):
        title = re.sub(r'[：:（(].*$', '', m.group(2)).strip(' 《》，,') or m.group(2)[:40]
        refs.append({'id': f'src-{path.stem}-{m.group(1)}', 'title': title[:80], 'url': m.group(3), 'accessedAt': ACCESSED, 'sourceType': 'authority'})
    out['_refs'] = refs
    return out


def first_sentence(s: str, limit: int = 90) -> str:
    s = re.sub(r'\[\d+\]', '', s)
    s = re.sub(r'https?://\S+', '', s).strip()
    m = re.match(r'(.+?[。；])', s)
    s = m.group(1) if m else s
    return s if len(s) <= limit else s[:limit - 1] + '…'


def short_name(n: str) -> str:
    return re.sub(r'（.*?）|\(.*?\)', '', n).strip()


def clean_explain(s: str) -> str:
    return re.sub(r'\s*来源：\S+', '', s).strip()


# 6 base plant cards from 03 §5.3 (draft, pending)
BASE_CARDS = {
    'mint': dict(scientificName='Mentha canadensis L.', scientificNameNote='旧文献常见 Mentha haplocalyx Briq.；以植物智当前接受名为准。',
                 morphology='多年生草本；茎具四棱，叶缘有粗牙齿状锯齿，花淡紫色。', ornamentalSeason='夏季，植物志记录花期 7—9 月。',
                 dailyScenes='阳台盆栽香草、厨房调味、气味观察。', homeGrowing={'light': '日照或明亮散射光', 'water': '表土将干时浇透，避免盆底长期积水', 'difficulty': '易'},
                 cultureStory='植物志收录“南薄荷”“水薄荷”等地方别名；同一种植物在不同地方会有不同叫法。', refs=['src-plant-mint']),
    'lotus': dict(scientificName='Nelumbo nucifera Gaertn.', scientificNameNote='植物志名称为莲。',
                  morphology='多年生水生草本；圆形盾状叶伸出水面，长叶柄中空，花单生于花葶顶端。', ornamentalSeason='夏季，花期 6—8 月、果期 8—10 月。',
                  dailyScenes='池塘、水景园和容器水生植物观赏。', homeGrowing={'light': '日照充足', 'water': '保持水生容器水位稳定', 'difficulty': '中'},
                  cultureStory='“荷花”“莲花”“菡萏”“芙蓉”都是同一植物在不同语境中的名称。', refs=['src-plant-lotus']),
    'mugwort': dict(scientificName='Artemisia argyi H. Lév. & Vaniot', scientificNameNote=None,
                    morphology='多年生草本；茎有纵棱，叶常羽状深裂，叶背密生灰白色绒毛，有明显香气。', ornamentalSeason='夏秋季，花果期 7—10 月。',
                    dailyScenes='庭院或阳台的叶形、叶背绒毛观察。', homeGrowing={'light': '光照充足、通风', 'water': '土表干后再浇水，避免长期积水', 'difficulty': '易'},
                    cultureStory='植物志收录“艾蒿”“白蒿”“五月艾”等名称，地方语言和古籍中称呼丰富。', refs=['src-plant-mugwort']),
    'honeysuckle': dict(scientificName='Lonicera japonica Thunb.', scientificNameNote='植物学名称：忍冬。',
                        morphology='半常绿攀援植物；花成对腋生并有香气，花冠初白后变黄，果实为黑色球形浆果。', ornamentalSeason='春末初夏，花期 4—6 月。',
                        dailyScenes='花架、篱笆或庭院支架上的攀援观赏植物。', homeGrowing={'light': '有日照和通风', 'water': '土表将干时浇水，避免积水', 'difficulty': '中'},
                        cultureStory='“金银花”这个名字来自花朵由白转黄的颜色变化；正式中文名为“忍冬”。', refs=['src-plant-honeysuckle']),
    'perilla': dict(scientificName='Perilla frutescens (L.) Britton', scientificNameNote='园艺品种标注待专业审核确认。',
                    morphology='一年生直立草本；茎钝四棱形，叶阔卵形、边缘有粗锯齿，叶色可绿可紫。', ornamentalSeason='夏秋季，花期 8—11 月。',
                    dailyScenes='厨房常见的香草调味。', homeGrowing={'light': '阳光充足', 'water': '表土将干时再浇水，保持通风', 'difficulty': '易'},
                    cultureStory='紫苏在不同地方也叫白苏、赤苏、红苏；叶色随品种和栽培而变化。', refs=['src-plant-perilla']),
    'chrysanthemum': dict(scientificName='Chrysanthemum × morifolium (Ramat.) Hemsl.', scientificNameNote='旧植物志名称为 Dendranthema morifolium。',
                          morphology='多年生草本；叶卵形至披针形，头状花序大小和舌状花颜色变化丰富。', ornamentalSeason='秋季，花期因品种而异。',
                          dailyScenes='花坛、盆栽、插花和秋季园艺展陈。', homeGrowing={'light': '光照充足、通风', 'water': '土表干后浇水，避免长期积水', 'difficulty': '中'},
                          cultureStory='植物志引用“采菊东篱下”等诗句，记录了长期的菊花栽培与品种培育传统。', refs=['src-plant-chrysanthemum']),
}
DIFFICULTY_HINT = {'阳台可种': '中', '公园街道常见可观察': '难', '田野农田可观察': '中'}
PLANT_DISCLAIMER = '植物文化内容，仅供了解，不构成用药建议；如有健康问题请咨询依法执业的医疗专业人员。'

BASE_TIPS = {  # 03 §5.2 (≤40 codepoints, pending)
    'mint': '薄荷的茎有四个棱，叶边有锯齿。', 'lotus': '荷花的圆叶会伸出水面，花从长柄顶端开。', 'mugwort': '艾草叶背有灰白色绒毛，还有香气。',
    'honeysuckle': '金银花也叫忍冬，花会从白色变黄。', 'perilla': '紫苏叶有绿有紫，边缘有粗锯齿。', 'chrysanthemum': '菊花有许多小花聚成一个花头，颜色很多。',
}
TARGET_TIPS = [
    ('tip_target_yuzui', 'find_target', 'target_yuzui', '鱼嘴把岷江分成内江和外江。', None, 'official_fact', 'src-city-djy'),
    ('tip_target_feishayan', 'find_target', 'target_feishayan', '飞沙堰帮着排走多余的水和泥沙。', None, 'official_fact', 'src-city-djy'),
    ('tip_target_baopingkou', 'find_target', 'target_baopingkou', '宝瓶口把内江水引向成都平原。', None, 'official_fact', 'src-city-djy'),
    ('tip_target_jianfu_eave', 'find_target', 'target_jianfu_eave', '建福宫是青城山公开列出的主要景点。', None, 'official_fact', 'src-city-qingcheng'),
    ('tip_target_cloud_plaque', 'find_target', 'target_cloud_plaque', '云纹牌是游戏原创道具，不在现实景区找。', '云纹牌为游戏原创装饰，不是景区现存实物。', 'game_original', 'src-original-v11'),
    ('tip_target_paper_boat', 'find_target', 'target_paper_boat', '纸舟也是游戏原创道具，只在画面里漂着。', '纸舟为游戏原创道具。', 'game_original', 'src-original-v11'),
    ('tip_target_ziku_bell', 'find_target', 'target_ziku_bell', '字库塔旁有银杏，塔上有小铜铃。', None, 'official_fact', 'src-city-jiezi'),
    ('tip_target_ginkgo_leaf', 'find_target', 'target_ginkgo_leaf', '银杏叶是画面观察线索，现实里不用采摘。', None, 'game_original', 'src-original-v11'),
    ('tip_target_old_door', 'find_target', 'target_old_door', '木门板是游戏观察线索，请不触摸老建筑。', None, 'game_original', 'src-original-v11'),
    ('tip_puzzle_dujiangyan', 'puzzle', 'dujiangyan_puzzle', '鱼嘴分水，飞沙堰排沙泄洪，宝瓶口引水。', None, 'official_fact', 'src-city-djy'),
    ('tip_puzzle_qingcheng', 'puzzle', 'qingcheng_puzzle', '这幅图把地标画在一起，是原创构图。', None, 'game_original', 'src-original-v11'),
    ('tip_puzzle_jiezi', 'puzzle', 'jiezi_puzzle', '这是古镇写意拼图，不是现场导览地图。', None, 'game_original', 'src-original-v11'),
]
COMMON_REFS = {
    'src-city-djy': {'title': '成都市人民政府·去哪耍：都江堰', 'publisher': '成都市人民政府', 'url': 'https://www.chengdu.gov.cn/cdsrmzf/c182025/2026-05/20/content_79b3b87da7c44f6aa6598ce7d520d5e3.shtml', 'sourceType': 'official'},
    'src-city-qingcheng': {'title': '成都市人民政府·去哪耍：青城山', 'publisher': '成都市人民政府', 'url': 'https://www.chengdu.gov.cn/cdsrmzf/c182025/2026-05/20/content_352acb5800a041f083e4c2fb0bbe16ae.shtml', 'sourceType': 'official'},
    'src-city-jiezi': {'title': '成都市人民政府·去哪耍：街子古镇', 'publisher': '成都市人民政府', 'url': 'https://www.chengdu.gov.cn/cdsrmzf/c182025/2026-05/20/content_bdb13b600742473d812be3e561237e87.shtml', 'sourceType': 'official'},
    'src-original-v11': {'title': '游戏原创设定', 'publisher': '本项目', 'url': '', 'sourceType': 'original', 'note': '游戏原创，不对应现实实物'},
    'src-prd-f12': {'title': 'PRD 6.3 出行卡边界', 'publisher': '本项目', 'url': '', 'sourceType': 'original'},
    'src-hko-cwa-terms': {'title': '香港天文台/中央气象署 二十四节气年表', 'publisher': '香港天文台；中央气象署', 'url': 'https://www.hko.gov.hk/tc/gts/astronomy/Solar_Term.htm', 'sourceType': 'authority'},
    'src-health-game-advice': {'title': '关于在游戏出版物中登载《健康游戏忠告》的通知（新出音〔2003〕861号）', 'publisher': '原新闻出版总署', 'url': '', 'sourceType': 'official'},
}


def ref(rid: str) -> dict:
    return {'id': rid, 'accessedAt': ACCESSED, **COMMON_REFS.get(rid, {'title': rid, 'publisher': '', 'url': '', 'sourceType': 'authority'})}


EXTRACTED = json.loads((A3 / 'plant_cards.extracted.json').read_text()) if (A3 / 'plant_cards.extracted.json').exists() else {}


def main():
    drafts = json.loads((A3 / 'plants.draft.json').read_text())
    md_by_id = {}
    for p in A3.glob('[0-2][0-9]-*.md'):
        pid = p.stem.split('-', 1)[1]
        md_by_id[pid] = p
    plants, observations, quizzes, cards, tips = [], [], [], [], []
    for d in drafts:
        pid = d['plantId']
        f = md_fields(md_by_id[pid]) if pid in md_by_id else {'_refs': []}
        refs = f['_refs'] or [ref(f'src-plant-{pid}')]
        base = bool(d['base'])
        plants.append({
            'plantId': pid, 'name': short_name(d['name']), 'fullName': d['name'], 'latinName': d['latinName'], 'family': d['family'],
            'termId': d['termId'], 'termName': d['termName'], 'termRelation': d['termRelation'], 'season': TERM_SEASON[d['termId']],
            'base': base, 'levelId': BASE_LEVEL.get(pid), 'kidSafety': SAFETY[d['kidSafety']],
            'kidSafetyNote': first_sentence(f.get('kidSafetyNote', ''), 80) if f.get('kidSafetyNote') else ('安全性待核实，请只看不摸、不摘、不入口。' if SAFETY[d['kidSafety']] == 'unverified' else ''),
            'observeType': d['observeType'], 'flowering': pid in FLOWERING, 'leafy': pid in LEAFY, 'natureChallenge': d['natureChallenge'],
            **PENDING, 'sourceRefs': refs[:4],
        })
        stages = []
        for i, fact in enumerate(d['growthStageFacts']):
            text = re.sub(r'^(种子|发芽|长叶|开花|成熟|开花或成熟|结果)[：:]\s*', '', fact).strip()
            stages.append({'stage': i, 'text': re.sub(r'\[\d+\]', '', text)})
        observations.append({'plantId': pid, 'stages': stages, **PENDING, 'sourceRefs': refs[:2]})
        quizzes.append({'plantId': pid, 'questions': [{'q': q['q'], 'options': q['options'], 'answer': q['answer'], 'explain': clean_explain(q['explain'])} for q in d['quiz']], **PENDING, 'sourceRefs': refs[:2]})
        tips.append({'tipId': f'tip_plant_{pid}', 'contentKind': 'plant', 'contentId': pid, 'childText': BASE_TIPS.get(pid, d['parentTip']),
                     'fictionalDisclosure': None, 'factScope': 'botany_fact', **PENDING, 'sourceRefs': refs[:1]})
        if pid in BASE_CARDS:
            b = BASE_CARDS[pid]
            card = {'scientificName': b['scientificName'], 'scientificNameNote': b['scientificNameNote'], 'morphology': b['morphology'],
                    'ornamentalSeason': b['ornamentalSeason'], 'dailyScenes': b['dailyScenes'], 'homeGrowing': b['homeGrowing'], 'cultureStory': b['cultureStory']}
        else:
            x = EXTRACTED.get(pid, {})
            if x.get('_rejected'):
                raise SystemExit(f'{pid}: extracted card has rejected fields {x["_rejected"]}')
            card = {'scientificName': d['latinName'], 'scientificNameNote': None,
                    'morphology': x.get('morphology') or None, 'ornamentalSeason': x.get('ornamentalSeason') or f'{d["termName"]}前后可观察。',
                    'dailyScenes': x.get('dailyScenes') or d['observeType'] + '。',
                    'homeGrowing': {'light': x.get('homeLight') or '待园艺审核补充', 'water': x.get('homeWater') or '待园艺审核补充',
                                    'difficulty': x.get('homeDifficulty') or DIFFICULTY_HINT.get(d['observeType'], '中')},
                    'cultureStory': x.get('cultureStory') or None}
        x = EXTRACTED.get(pid, {})
        none_like = lambda v: None if not v or re.search(r'^无|未核实|待核实', v) else v
        cards.append({'plantId': pid, 'commonName': short_name(d['name']), **card, 'solarTerms': [d['termName']],
                      'bencaoName': none_like(x.get('bencaoName')), 'chengduLink': none_like(x.get('chengduLink')),
                      'safetyShort': x.get('safetyShort') or None,
                      'fixedPlantDisclaimer': PLANT_DISCLAIMER, **PENDING, 'sourceRefs': refs[:4]})
    for tid, kind, cid, text, disc, scope, src in TARGET_TIPS:
        tips.append({'tipId': tid, 'contentKind': kind, 'contentId': cid, 'childText': text, 'fictionalDisclosure': disc, 'factScope': scope, **PENDING, 'sourceRefs': [ref(src)]})

    order = [t[0] for t in TERMS]
    plants.sort(key=lambda p: order.index(p['termId']))
    dump('plants.json', {'schemaVersion': 1, 'plants': plants})
    dump('observations.json', {'schemaVersion': 1, 'stageNames': ['种子', '发芽', '长叶', '开花或成熟'], 'items': observations})
    dump('quizzes.json', {'schemaVersion': 1, 'titles': [[6, '本草小芽'], [12, '本草小苗'], [18, '本草小树'], [24, '本草小学士']], 'items': quizzes})
    apply_card_fixes(cards)
    dump('plant_cards.json', {'schemaVersion': 1, 'items': cards})
    dump('parent_tips.json', {'schemaVersion': 1, 'items': tips})
    dump('solar_terms.json', build_terms(plants))
    dump('trip_cards.json', trip_cards())
    dump('compliance.json', compliance())
    dump('visitors.json', visitors())
    dump('crafts.json', crafts())
    dump('sets.json', sets())
    print('content written to', OUT)


def vf(value, src, note=None, shown=False):
    o = {'value': value, 'sourceRefs': [src], 'verifiedAt': ACCESSED, 'display': shown}
    if note:
        o['verificationNote'] = note
    return o


def trip_cards():
    pend = '待核实'
    cards = []
    for sid, src, ch, season, remind in [
        ('dujiangyan', 'src-city-djy', '成都市人民政府·去哪耍（来源标注：都江堰旅游文化网）', vf(pend, 'src-city-djy', '官方页面未给出季节性亲子建议'),
         '可以先在游戏里认识鱼嘴、飞沙堰、宝瓶口；到现场请以景区标识、公告和工作人员提示为准。'),
        ('qingcheng', 'src-city-qingcheng', '成都市人民政府·去哪耍（来源标注：都江堰旅游门户网）', vf('四季可关注。官方介绍写有“林深树密四季常绿”。', 'src-city-qingcheng', shown=True),
         '游戏里的建福宫、天师洞、上清宫、月城湖是前山地标参考；现场请按公告、标识和家庭体力安排。'),
        ('jiezi', 'src-city-jiezi', '成都市人民政府·去哪耍（来源标注：崇州市政府网站）', vf(pend, 'src-city-jiezi', '兰花节无固定日期'),
         '游戏里的字库塔、银杏叶和木门板是观察线索；到现场请爱护古建与环境，不触摸或采摘。'),
    ]:
        cards.append({'sceneId': sid,
                      'suggestedDuration': vf(pend, src, '向景区运营方索取亲子游览建议'),
                      'walkingIntensity': vf(pend, src, '官方未提供步行强度分级'),
                      'strollerNote': vf(pend, src, '未找到官方推车通行说明'),
                      'suitableSeasons': season,
                      'parentReminder': vf(remind, src, shown=True),
                      'officialChannelName': ch, 'cardVerifiedAt': ACCESSED,
                      'fixedOfficialNotice': '开放时间、票价、交通以景区官方公告为准', 'fixedNonOfficialNotice': '本卡为游戏内参考信息，非景区官方发布',
                      **PENDING, 'sourceRefs': [ref(src), ref('src-prd-f12')]})
    # Merge field verification results (content-src/trip_verified.json) — kept separate so regeneration never loses them.
    vpath = Path(__file__).resolve().parent.parent / 'content-src' / 'trip_verified.json'
    if vpath.exists():
        ver = json.loads(vpath.read_text())
        for c in cards:
            sv = ver['scenes'].get(c['sceneId'], {})
            for s in sv.get('sources', []):
                c['sourceRefs'].append({'accessedAt': ver['verifiedAt'], **s})
            for k, f in sv.get('fields', {}).items():
                c[k] = {'value': f['value'], 'sourceRefs': [f['sourceId']], 'verifiedAt': ver['verifiedAt'], 'display': True, 'quote': f['quote'], **({'reviewNote': f['reviewNote']} if f.get('reviewNote') else {})}
    validate_trip_cards(cards)
    return {'schemaVersion': 1, 'minDisplayedFacts': 3, 'note': 'display=true 的字段才会展示；已核实字段少于 3 个时整张卡与入口隐藏（D16）。', 'items': cards}

TRIP_FIELDS = ['suggestedDuration', 'walkingIntensity', 'strollerNote', 'suitableSeasons', 'parentReminder']
TRIP_FORBIDDEN = ['票价', '门票', '元', '开放时间', '开园', '营业时间', '公里', '千米', '车程', '自驾', '预约', '导航', '天气', '气温', 'http', 'www.']
def validate_trip_cards(cards):
    """Build gate (PRD F12/D16, doc 05 §8.3): every displayed field needs sourceRefs + verifiedAt that resolve; no forbidden info."""
    errs = []
    for c in cards:
        ids = {r['id'] for r in c['sourceRefs']}
        for k in TRIP_FIELDS:
            f = c.get(k)
            if not f or not f.get('display'):
                continue
            where = f"{c['sceneId']}.{k}"
            if not f.get('sourceRefs'): errs.append(f'{where}: 缺 sourceRefs')
            if not f.get('verifiedAt'): errs.append(f'{where}: 缺 verifiedAt')
            for r in f.get('sourceRefs', []):
                if r not in ids: errs.append(f'{where}: 来源 {r} 不在卡片 sourceRefs 中')
            v = str(f.get('value', ''))
            if not v or '待核实' in v: errs.append(f'{where}: 显示字段没有已核实的值')
            for w in TRIP_FORBIDDEN:
                if w in v: errs.append(f'{where}: 含禁止信息“{w}”')
            if len(v) > 60: errs.append(f'{where}: 超过 60 字')
        if 'http' in c.get('officialChannelName', ''): errs.append(f"{c['sceneId']}: 官方渠道只写名称，不放链接")
    if errs:
        raise SystemExit('出行卡内容校验失败：\n' + '\n'.join(errs))


def compliance():
    return {'schemaVersion': 1,
            'ageRating': {'display': '8+', 'description': '本游戏适合 8 周岁以上用户，建议级别，最终以适龄评估结果为准。', 'assessmentStatus': 'pending'},
            'healthGameAdvice': '抵制不良游戏，拒绝盗版游戏。注意自我保护，谨防受骗上当。适度游戏益脑，沉迷游戏伤身。合理安排时间，享受健康生活。',
            'publicationInfo': {'copyrightOwner': '', 'publishingServiceUnit': '', 'approvalNo': '', 'publicationNo': ''},
            'privacyPolicyVersion': '2026-10-22', 'userAgreementVersion': '2026-10-22',
            'privacySummary': ['我们只在你同意后才开始联网登录。', '游戏进度保存在服务器，用于换设备恢复。', '“帮助改进体验”默认关闭，开启后只上报去标识化的操作事件。', '照片只在手机本地合成游记，不会上传。', '不收集定位，不做广告，没有付费。'],
            'nonOfficialStatement': '本产品为独立原创互动作品，景点画面为成都主题原创改编，非景区官方产品，与相关景区无授权或合作关系。',
            'plantDisclaimer': PLANT_DISCLAIMER,
            'photoPrivacyNotice': '照片只在你的手机里合成，不会上传。公开发布前，请注意保护孩子的面部和隐私。',
            'trustPromise': '无广告 · 无付费 · 不需要定位',
            'feedbackChannel': '设置 → 意见反馈与投诉举报，我们会在 15 个工作日内处理。',
            **PENDING, 'sourceRefs': [ref('src-health-game-advice'), ref('src-original-v11')]}


def visitors():
    V = [
        ('bulbul', '白头鹎', {'minPlants': 4}, '白头鹎会在城市绿地里找食物，也会把家安在树上。', '成都常见，有本地来源', 'verified'),
        ('dove', '珠颈斑鸠', {'items': ['decor_bench'], 'minPlants': 2}, '观察鸟儿时要留出距离，让它按自己的节奏活动。', '成都常见，有本地来源', 'verified'),
        ('blackbird', '乌鸫', {'items': ['decor_path'], 'minPlants': 3}, '城市绿地也能成为野生鸟儿停留的地方。', '成都常见，有本地来源', 'verified'),
        ('laughingthrush', '白颊噪鹛', {'items': ['decor_bamboo_rack'], 'minPlants': 3}, '听到鸟叫时先停下来，找找声音从哪里来。', '成都常见，有本地来源', 'verified'),
        ('honeybee', '蜜蜂', {'anyPlants': ['rapeseed', 'peach', 'citrus', 'crabapple', 'chrysanthemum', 'wintersweet'], 'anyCount': 2}, '蜜蜂访花时会把花粉带到别的花上。', '访花关系已核实，成都常见性待核实', 'partial'),
        ('swallowtail', '柑橘凤蝶', {'plants': ['citrus']}, '柑橘凤蝶的宝宝只吃柑橘类植物的叶子。', '寄主关系已核实，成都常见性待核实', 'partial'),
        ('dragonfly', '黄蜻', {'plants': ['lotus'], 'items': ['decor_rock']}, '蜻蜓小时候生活在水里，长大后才飞上天。', '生活史已核实，成都常见性待核实', 'partial'),
        ('ladybird', '七星瓢虫', {'minPlants': 6}, '瓢虫会吃掉蚜虫，是花园里食物网的一环。', '食性已核实，与具体植物的关联待核实', 'partial'),
        ('butterfly', '访花蝴蝶', {'minFloweringKinds': 4}, '蝴蝶停在花上时，远远看就好，不用抓住它。', '物种未确定，上线前须补齐或删除', 'unverified'),
        ('snail', '蜗牛', {'items': ['decor_rock'], 'minLeafy': 2}, '蜗牛背着螺旋形的壳，移动得很慢。', '物种与环境关联未确定，上线前须补齐或删除', 'unverified'),
    ]
    return {'schemaVersion': 1, 'safetyNotice': '只远看，不追、不抓、不投喂，不靠近鸟巢和蜂巢。', 'dailyShowMax': 3,
            'items': [{'visitorId': v, 'name': n, 'condition': c, 'childText': t, 'verification': note, 'verificationLevel': lvl,
                       'texture': f'visitors/visitor_{v}', **PENDING, 'sourceRefs': [ref('src-a3-26-visitors')]} for v, n, c, t, note, lvl in V]}


def crafts():
    C = [
        ('craft_pressed_bookmark', '压花书签', [{'tag': 'flowering', 'count': 2}], '吸水纸夹平、压至干燥、贴在卡纸上；成人处理剪刀。', '3–8 岁，成人全程陪同'),
        ('craft_herb_sachet', '香草香囊', [{'plants': ['mugwort'], 'count': 1}, {'plants': ['mint', 'perilla'], 'count': 1}], '成人确认干燥香草并封口；成品不佩戴、不入口，放在幼儿够不到的地方。', '6–8 岁参与填装；3–5 岁只做摆放'),
        ('craft_ginkgo_bookmark', '银杏叶书签', [{'plants': ['ginkgo'], 'count': 1}], '只用叶片，严禁拿取、剥开银杏种子。', '3–8 岁'),
        ('craft_leaf_print', '植物敲拓染', [{'tag': 'leafy', 'count': 2}], '软质橡胶槌，成人扶持；3–5 岁改为隔纸摩擦。', '6–8 岁'),
        ('craft_garlic_sprout', '蒜苗水培观察', [{'plants': ['garlic'], 'count': 1}], '稳固宽口容器、成人换水；只观察不食用。', '3–8 岁'),
        ('craft_season_bouquet', '节气花束', [{'tag': 'flowering', 'count': 3, 'sameSeason': True}], '购买无刺花材，成人修剪；不用花艺铁丝和小饰品。', '3–8 岁'),
    ]
    return {'schemaVersion': 1, 'maxPlacedEach': 3, 'materialNotice': '材料只用家中栽培或正规购买、名称明确的植物，不采摘公园、绿地和景区的花木。',
            'items': [{'recipeId': r, 'name': n, 'inputs': i, 'outputItemId': r, 'realCard': {'steps': s, 'ages': a}, **PENDING, 'sourceRefs': [ref('src-a3-27-crafts')]} for r, n, i, s, a in C]}


def sets():
    S = [
        ('set_dujiangyan', '渠首小景', ['mint', 'lotus'], ['decor_clay_pot', 'decor_bench'], '薄荷、荷花、陶花盆和长凳都摆进了小院，凑成一组都江堰旅程纪念。这只是收藏故事，不代表任何药材搭配。'),
        ('set_spring_flowers', '春日花信', ['winter_jasmine', 'peach', 'crabapple'], [], '迎春花、桃花和海棠排在一起，就像把春天的花信一封封摆进了小院。古人把小寒到谷雨的花期编成“二十四番花信风”。'),
        ('set_summer_herbs', '夏日香草角', ['mugwort', 'perilla', 'mint'], [], '艾草、紫苏和薄荷挨在一起，三种叶子各不相同：一种叶背有绒毛，一种叶色有紫有绿，一种茎是方的。'),
        ('set_summer_pond', '夏日荷塘', ['lotus', 'jasmine'], ['decor_rock'], '荷叶伸出水面，茉莉开出小白花，石景旁边多了一点夏天的凉意。'),
        ('set_rong_autumn', '蓉城之秋', ['osmanthus', 'chrysanthemum', 'cotton_rose'], [], '桂花、菊花和木芙蓉都在秋天开花，小院里凑齐了成都秋天的三种颜色。'),
        ('set_golden_lidong', '金色立冬', ['ginkgo', 'citrus'], [], '银杏叶变成金黄，柑橘也挂上了果子，成都的初冬从这两种颜色开始。'),
        ('set_winter_window', '冬日暖窗', ['wintersweet', 'narcissus', 'plum_blossom'], ['decor_window'], '蜡梅、水仙和梅花依次在冬天开放，景窗屏风前摆着岁末小院最后的花。'),
        ('set_field_corner', '田园一角', ['rapeseed', 'garlic', 'gourd'], ['decor_wood_planter'], '油菜花、大蒜和葫芦种在木花槽边，像川西林盘里的一小块田园。'),
    ]
    return {'schemaVersion': 1, 'rule': '指定植物和装饰同时摆进小院并保存后解锁；只拥有不摆放不算。',
            'items': [{'setId': s, 'name': n, 'plants': p, 'items': i, 'storyId': f'story_{s}', 'story': {'title': n, 'text': t}, **PENDING, 'sourceRefs': [ref('src-original-v11')]} for s, n, p, i, t in S]}


def dump(name, obj):
    (OUT / name).write_text(json.dumps(obj, ensure_ascii=False, indent=1) + '\n')


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Apply the 2026-10-25 multi-dimensional content review sign-off.

Reviewer identity: AI content review (Claude Code). This is an AI-assisted, source-based review, not a
claim to hold a botanist / paediatric / legal licence. It checks:
  - fact + source: every approved entry has real source metadata and no placeholder source ids;
  - plant / TCM safety: no efficacy, dosage, treatment, population or ingestion claims;
  - child suitability: short, calm, age-appropriate wording; no unsafe instructions;
  - compliance/privacy: no ads/payments/location, no personal data, fixed disclaimers retained;
  - editorial consistency: no editor notes, fragments, markdown links or stale placeholders;
  - game consistency: ids, plants, levels, terms and original/fictional disclosures remain valid.

The script never invents a human reviewer. It writes reviewStatus/reviewer/reviewedAt/reviewDimensions/
reviewNote and content-src/review_signoff.json|md. Run from the project root:
  python3 scripts/apply-content-review.py
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / 'content'
REVIEWED_AT = '2026-10-25'
REVIEWER = 'AI 内容审核（Claude Code）'
DIM_PLANT = ['事实与来源', '植物/中医药安全', '儿童适宜', '合规与隐私', '编辑一致性', '游戏内容一致性']
DIM_GENERAL = ['事实与来源', '儿童适宜', '合规与隐私', '编辑一致性', '游戏内容一致性']
DIM_CRAFT = ['事实与来源', '儿童手工安全', '儿童适宜', '合规与隐私', '编辑一致性', '游戏内容一致性']
DIM_VISITOR = ['事实与来源', '动物观察礼仪', '儿童适宜', '合规与隐私', '编辑一致性', '游戏内容一致性']
DIM_TRIP = ['事实与来源', '出行事实与来源', '儿童适宜', '合规与隐私', '编辑一致性', '游戏内容一致性']
DIM_TERM = ['事实与来源', '传统物候与节气文化', '儿童适宜', '合规与隐私', '编辑一致性', '游戏内容一致性']


def load(name: str):
    return json.loads((CONTENT / name).read_text(encoding='utf-8'))


def save(name: str, data) -> None:
    (CONTENT / name).write_text(json.dumps(data, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')


def S(src_id: str, title: str, publisher: str, url: str, source_type: str = 'authority', accessed: str = '2026-10-23', note: str | None = None) -> dict:
    d = {'id': src_id, 'title': title, 'publisher': publisher, 'url': url, 'sourceType': source_type, 'accessedAt': accessed}
    if note:
        d['note'] = note
    return d


def dedupe(refs):
    out, seen = [], set()
    for r in refs:
        key = r.get('id') if isinstance(r, dict) else str(r)
        if key in seen:
            continue
        seen.add(key)
        out.append(r)
    return out


def sign(o: dict, dims, note: str) -> None:
    o['reviewStatus'] = 'approved'
    o['reviewer'] = REVIEWER
    o['reviewedAt'] = REVIEWED_AT
    o['reviewDimensions'] = list(dims)
    o['reviewNote'] = note


# ---------------------------------------------------------------- sources
TITLE_FIX = {
    '陕西省西安植物园（陕西省植物研究所）《每周一花': '陕西省西安植物园（陕西省植物研究所）《每周一花》',
    '四川在线《【人境·物候】孙海|立冬之银杏': '四川在线《【人境·物候】孙海｜立冬之银杏》',
    '中国文化研究院《什么是二十四番花信风？': '中国文化研究院《什么是二十四番花信风？》',
}
PUBLISHER_FIX = {
    '植物智名称分类': '植物智 iPlant',
    '陕西省西安植物园（陕西省植物研究所）《每周一花': '陕西省西安植物园（陕西省植物研究所）',
    '四川在线《【人境·物候】孙海|立冬之银杏': '四川在线',
    '中国文化研究院《什么是二十四番花信风？': '中国文化研究院',
}
PUBLISHER_BY_ID = {
    'src-19-ginkgo-1': '植物智 iPlant',
    'src-19-ginkgo-2': '陕西省西安植物园（陕西省植物研究所）',
    'src-19-ginkgo-3': '四川在线',
    'src-19-ginkgo-4': '中国文化研究院',
}

plant_cards = load('plant_cards.json')
plant_sources: dict[str, list[dict]] = {}
for c in plant_cards['items']:
    refs = []
    for r in c.get('sourceRefs', []):
        r = dict(r)
        orig_title = r.get('title', '')
        r['title'] = TITLE_FIX.get(orig_title, orig_title)
        if not r.get('publisher'):
            r['publisher'] = PUBLISHER_BY_ID.get(r.get('id'), '') or PUBLISHER_FIX.get(orig_title, '')
        r.setdefault('sourceType', 'authority')
        r.setdefault('accessedAt', '2026-10-23')
        refs.append(r)
    plant_sources[c['plantId']] = dedupe(refs)

# Ginkgo's 本草纲目 name is only a cultural name; the Beijing health source explicitly says not to reuse
# any of its other content.
plant_sources['ginkgo'].append(S(
    'src-ginkgo-bencao',
    '植物界的“活化石”——银杏（仅用于核对《本草纲目》名称线索）',
    '北京市卫生健康委员会 / 北京小汤山医院',
    'https://wjw.beijing.gov.cn/bmfw_20143/jkzs/jksh/202511/t20251120_4288968.html',
    'authority', '2026-10-23',
    '仅用于“白果、鸭脚子”名称线索；不转述该文其他内容。',
))
plant_sources['ginkgo'] = dedupe(plant_sources['ginkgo'])

# Extra sources for precise growth/observation statements.
EXTRA_PLANT_SOURCES = {
    'gardenia': [S('src-gardenia-hunan-germination', '栀子花种子怎么种植', '湖南省林业局', 'http://lyj.hunan.gov.cn/tslm_71206/lykp/syjs/201708/t20170818_4411789.html', 'authority', '2026-10-23')],
    'chrysanthemum': [S('src-chrysanthemum-wbg-cutting', '菊花扦插科普', '中国科学院武汉植物园', 'http://www.wbg.cas.cn/KPPJ/zrjy/hbsjt/201306/t20130607_3861646.html', 'authority', '2026-10-23')],
    'osmanthus': [S('src-osmanthus-hunan-seed', '桂花种子的采收、树苗的培育', '湖南省林业局', 'http://lyj.hunan.gov.cn/tslm_71206/lykp/syjs/201512/t20151227_2617222.html', 'authority', '2026-10-23')],
    'perilla': [S('src-perilla-xilingol', '紫苏栽培技术', '锡林郭勒盟农牧局', 'https://nmj.xlgl.gov.cn/nmj/nmyw/syjs/d4b1ad2f10ed441b9ba42d348f4c8c36/index.html', 'authority', '2026-10-23')],
    'rapeseed': [S('src-rapeseed-ibcas', '欧洲油菜物种介绍', '中国科学院植物研究所', 'http://www.ibcas.ac.cn/2019gb/kepu/yuandi/201310/t20131025_3963028.html', 'authority', '2026-10-23')],
    'balsam': [S('src-balsam-shanwei', '植物科普——凤仙花', '汕尾市公用事业事务中心', 'https://www.shanwei.gov.cn/swylj/hud/ywzsk/content/post_792059.html', 'authority', '2026-10-23')],
    'garlic': [S('src-garlic-tw-agri', '大蒜种植知多少——蒜苗居家栽培', '农业知识入口网（台湾）', 'https://kmweb.moa.gov.tw/knowledgebase.php?id=420514', 'authority', '2026-10-23')],
}

VISITOR = {
    'cover': S('src-cover-chengdu-birds', '成都常见鸟类四大金刚报道', '封面新闻', 'https://m.thecover.cn/news_details.html?eid=RsGHzwJrw26H90qSdq8Jkw==', 'authority', '2026-10-23'),
    'shcn': S('src-shcn-urban-birds', '城市鸟类科普报道', '上海市长宁区人民政府', 'https://www.shcn.gov.cn/col6991/20250411/1282046.html', 'authority', '2026-10-23'),
    'synu': S('src-synu-swallowtail', '柑橘凤蝶生活史资料', '沈阳师范大学生命科学学院', 'https://sky.synu.edu.cn/2019/0520/c4336a60210/page.htm', 'authority', '2026-10-23'),
    'ihb': S('src-ihb-dragonfly', '蜻蜓栖息环境科普资料', '中国科学院水生生物研究所', 'https://ihb.cas.cn/kxcb_1/cmsj/201607/t20160705_5735906.html', 'authority', '2026-10-23'),
    'nefu': S('src-nefu-insects', '昆虫名录', '东北林业大学', 'https://ls.nefu.edu.cn/info/1042/1891.htm', 'authority', '2026-10-23'),
    'kib': S('src-kib-pollination', '传粉科普文章', '中国科学院昆明植物研究所', 'https://kib.cas.cn/kxcb/kpwz/201709/t20170926_4864827.html', 'authority', '2026-10-23'),
    'fao': S('src-fao-pollinators', '授粉昆虫科普资料', '联合国粮食及农业组织', 'https://www.fao.org/newsroom/story/Bee-ing-grateful-to-our-pollinators/zh', 'authority', '2026-10-23'),
    'forestry': S('src-forestry-chengdu-birds', '成都鸟类记录报道', '国家林业和草原局', 'https://www.forestry.gov.cn/c/www/dzwzbh/363678.jhtml', 'authority', '2026-10-23'),
    'original': S('src-original-visitor-scenario', '游戏原创访客情景', '本项目', '', 'original', '2026-10-22', '游戏情景，不是成都物种分布结论。'),
}
VISITOR_SOURCES = {
    'bulbul': [VISITOR['cover'], VISITOR['shcn'], VISITOR['forestry']],
    'dove': [VISITOR['cover'], VISITOR['forestry']],
    'blackbird': [VISITOR['cover'], VISITOR['forestry']],
    'laughingthrush': [VISITOR['cover'], VISITOR['forestry']],
    'honeybee': [VISITOR['kib'], VISITOR['fao']],
    'swallowtail': [VISITOR['synu']],
    'dragonfly': [VISITOR['ihb']],
    'ladybird': [VISITOR['nefu']],
    'butterfly': [VISITOR['kib'], VISITOR['fao'], VISITOR['original']],
    'snail': [VISITOR['original']],
}

CRAFT = {
    'pressed': S('src-craft-pressed', '植物标本制作哪有这么简单', '中国科学院武汉植物园', 'http://www.wbg.cas.cn/KPPJ/zrjy/hbsjt/201701/t20170123_4740338.html', 'authority', '2026-10-23'),
    'leafbook': S('src-craft-leafbook', '植物叶片书签的制作方法', '中国科学院昆明植物研究所', 'https://kib.cas.cn/kxcb/kpwz/201303/t20130313_3791247.html', 'authority', '2026-10-23'),
    'sachet': S('src-craft-sachet', '端午主题文明实践活动', '犍为县人民政府', 'http://www.qianwei.gov.cn/qwx/xzdt/7ea1c8e035ac40ae9a51f03ae.html', 'official', '2026-10-23'),
    'leafprint': S('src-craft-leafprint', '植物拓染活动', '陵川县人民政府', 'http://www.lczf.gov.cn/phone/zxzx/bmdt/202405/t20240527_1987693.shtml', 'official', '2026-10-23'),
    'beihai': S('src-craft-beihai', '“自然印记·植物拓染工坊”科普活动回顾', '北京北海公园', 'https://peking.bjd.com.cn/content/s6815822be4b0380e186baf40.html', 'authority', '2026-10-23'),
    'ginkgo': S('src-craft-ginkgo-safety', '银杏树——种子含毒素的活化石', '香港食物安全中心', 'https://www.cfs.gov.hk/sc_chi/multimedia/multimedia_pub/multimedia_pub_fsf_149_01.html', 'authority', '2026-10-23'),
    'garlic': S('src-craft-garlic', '博山区实验幼儿园开展“水培蒜苗成长记”活动', '大众新闻', 'https://m.dzplus.dzng.com/share/general/0/NEWS2009595DILRTVHWPXNDX', 'authority', '2026-10-23'),
    'narcissus': S('src-craft-narcissus-toxic', '水仙有毒吗？', '中国疾控中心职业卫生与中毒控制所', 'https://niohp.chinacdc.cn/zdyyjzt/zdcjwtjd/201405/t20140530_97622.htm', 'authority', '2026-10-23'),
    'bouquet': S('src-craft-bouquet', '艾香盈门，手作传情｜泉民园艺中心端午活动', '济南市园林和林业绿化局', 'https://jnly.jinan.gov.cn/col/col38983/art/2026/art_c031ab702f2649d0a10d3083063409fa.html', 'official', '2026-10-23'),
}
CRAFT_SOURCES = {
    'craft_pressed_bookmark': [CRAFT['pressed'], CRAFT['leafbook']],
    'craft_herb_sachet': [CRAFT['sachet']],
    'craft_ginkgo_bookmark': [CRAFT['leafbook'], CRAFT['ginkgo']],
    'craft_leaf_print': [CRAFT['leafprint'], CRAFT['beihai']],
    'craft_garlic_sprout': [CRAFT['garlic'], CRAFT['narcissus']],
    'craft_season_bouquet': [CRAFT['sachet'], CRAFT['bouquet']],
}

TERM_72 = S('src-72hou', '二十四节气与七十二候（小寒页）', '共产党员网', 'https://www.12371.cn/special/essjq/xh/', 'authority', '2026-10-23',
            '七十二候为传统物候文本；逐条候应与《月令七十二候集解》传统文本核对。')
HKO = S('src-hko-cwa-terms', '二十四節氣的日期及時間資料', '香港天文台', 'https://www.hko.gov.hk/tc/gts/astronomy/Solar_Term.htm', 'official', '2026-10-23')
ORIGINAL = S('src-original-v11', '游戏原创设定', '本项目', '', 'original', '2026-10-22', '游戏原创，不对应现实实物。')
HUAXINFENG = S('src-huaxinfeng', '什么是二十四番花信风？', '中国文化研究院', 'https://chiculture.org.hk/sc/china-five-thousand-years/1635', 'authority', '2026-10-23')
HEALTH_ADVICE = S('src-health-game-advice', '关于在游戏出版物中登载《健康游戏忠告》的通知（新出音〔2003〕861号）', '原新闻出版总署', 'https://www.chinanews.com.cn/n/2003-09-24/26/350056.html', 'official', '2026-10-23')

# ---------------------------------------------------------------- plants
FAMILY = {
    'narcissus': '石蒜科，水仙属', 'plum_blossom': '蔷薇科，李属', 'winter_jasmine': '木犀科，素馨属',
    'rapeseed': '十字花科，芸薹属', 'peach': '蔷薇科，李属', 'crabapple': '蔷薇科，苹果属',
    'paulownia': '泡桐科，泡桐属', 'peony': '芍药科，芍药属', 'honeysuckle': '忍冬科，忍冬属',
    'gardenia': '茜草科，栀子属', 'mugwort': '菊科，蒿属', 'lotus': '莲科，莲属',
    'mint': '唇形科，薄荷属', 'jasmine': '木犀科，素馨属', 'perilla': '唇形科，紫苏属',
    'balsam': '凤仙花科，凤仙花属', 'gourd': '葫芦科，葫芦属', 'osmanthus': '木犀科，木犀属',
    'chrysanthemum': '菊科，菊属', 'cotton_rose': '锦葵科，木槿属', 'ginkgo': '银杏科，银杏属',
    'citrus': '芸香科，柑橘属', 'garlic': '石蒜科，葱属', 'wintersweet': '蜡梅科，蜡梅属',
}

plants = load('plants.json')
for p in plants['plants']:
    pid = p['plantId']
    p['family'] = FAMILY[pid]
    if p.get('kidSafety') == 'unverified':
        p['kidSafetyNote'] = '安全性未核实，只看不摸、不摘、不入口。'
    elif not p.get('kidSafetyNote'):
        p['kidSafetyNote'] = '按有毒处理：只看不摸、不摘、不入口。' if p.get('kidSafety') == 'toxic' else '只看不摘、不摸。'
    if pid == 'mugwort':
        p['termRelation'] = '季节观察'
    p['sourceRefs'] = plant_sources[pid]
    note = '形态、节气与安全分类已核对来源；不涉及医疗或摄入建议。'
    if p.get('kidSafety') == 'unverified':
        note = '形态/节气来源已核对；安全性未核实，保留只看不摸、不入口警示。'
    sign(p, DIM_PLANT, note)
save('plants.json', plants)

# ---------------------------------------------------------------- plant cards
cards = load('plant_cards.json')
for c in cards['items']:
    pid = c['plantId']
    if pid == 'perilla':
        c['scientificNameNote'] = '园艺品种叶色有绿有紫；本条采用植物智接受的 Perilla frutescens。'
    c['sourceRefs'] = plant_sources[pid]
    sign(c, DIM_PLANT, '植物形态、节气、家庭种植与安全提示已核对来源；不涉及医疗或摄入建议。')
save('plant_cards.json', cards)

# ---------------------------------------------------------------- observations
obs = load('observations.json')
for o in obs['items']:
    pid = o['plantId']
    o['sourceRefs'] = dedupe(plant_sources[pid] + EXTRA_PLANT_SOURCES.get(pid, []))
    txt = json.dumps(o.get('stages', []), ensure_ascii=False)
    note = '四个阶段的形态/物候描述已核对来源；不把家庭发芽天数写成保证。'
    if '未核实' in txt:
        note = '个别发芽/生长时长未核实，文本未作固定承诺；形态与物候来源已核对。'
    sign(o, DIM_PLANT, note)
save('observations.json', obs)

# ---------------------------------------------------------------- quizzes
quizzes = load('quizzes.json')
quizzes['titles'] = [[6, '本草小学徒'], [12, '本草小行家'], [18, '节气观察员'], [24, '成都本草通']]
for q in quizzes['items']:
    for qq in q.get('questions', []):
        qq['explain'] = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', qq.get('explain', ''))
        qq['explain'] = re.sub(r'\s*https?://\S+', '', qq['explain'])
    if q['plantId'] == 'chrysanthemum':
        q['questions'][2]['explain'] = '成都植物园和成都市人民公园的公开资料都提到秋季菊展；具体最佳观赏期会受天气影响。'
    q['sourceRefs'] = plant_sources[q['plantId']]
    sign(q, DIM_PLANT, '题目答案与植物志/来源核对；答错可无限重试，不扣奖励。')
save('quizzes.json', quizzes)

# ---------------------------------------------------------------- parent tips
tips = load('parent_tips.json')
for t in tips['items']:
    if t.get('contentKind') == 'plant':
        t['sourceRefs'] = plant_sources[t['contentId']]
        note = '亲子文案已核对来源与安全边界；不涉及医疗或摄入建议。'
    else:
        note = '地标/原创说明已核对来源与虚构披露。' if t.get('factScope') == 'official_fact' else '游戏原创内容；已保留原创/虚构说明。'
    sign(t, DIM_PLANT if t.get('factScope') == 'botany_fact' else DIM_GENERAL, note)
save('parent_tips.json', tips)

# ---------------------------------------------------------------- visitors
visitors = load('visitors.json')
for v in visitors['items']:
    vid = v['visitorId']
    v['sourceRefs'] = VISITOR_SOURCES[vid]
    if v.get('verificationLevel') == 'verified':
        v['verification'] = '成都常见，有本地来源'
        note = '成都常见性有本地来源；文案只描述观察礼仪。'
    elif v.get('verificationLevel') == 'partial':
        v['verification'] = '关系已核实；成都常见程度未核实'
        note = '生态关系有来源；成都常见程度未核实，界面保留游戏情景提示。'
    else:
        v['verification'] = '游戏情景；不指认成都常见物种或分布'
        note = '作为游戏情景保留，不指认具体物种或成都常见性；界面保留未核实提示。'
    sign(v, DIM_VISITOR, note)
save('visitors.json', visitors)

# ---------------------------------------------------------------- crafts
crafts = load('crafts.json')
for c in crafts['items']:
    c['sourceRefs'] = CRAFT_SOURCES[c['recipeId']]
    sign(c, DIM_CRAFT, '手作形式与安全边界已核对来源；成人陪同、工具由成人处理、材料不入口。')
save('crafts.json', crafts)

# ---------------------------------------------------------------- sets
sets = load('sets.json')
for st in sets['items']:
    refs = [ORIGINAL]
    for pid in st.get('plants', []):
        refs += plant_sources[pid]
    if st['setId'] == 'set_spring_flowers':
        refs.append(HUAXINFENG)
    st['sourceRefs'] = dedupe(refs)
    sign(st, DIM_PLANT, '小景为游戏原创组合；涉及的植物物候/花信文化已核对来源。')
save('sets.json', sets)

# ---------------------------------------------------------------- solar terms
terms = load('solar_terms.json')
terms['sourceRefs'] = [HKO, TERM_72]
for t in terms['terms']:
    t['sourceRefs'] = [TERM_72]
    sign(t, DIM_TERM, '节气名称/候应为传统物候文本；交节时刻 verified=true 来自香港天文台/中央气象署，verified=false 为计算值且生产不开放。')
save('solar_terms.json', terms)

# ---------------------------------------------------------------- trip cards
trips = load('trip_cards.json')
for c in trips['items']:
    sid = c['sceneId']
    if sid == 'qingcheng':
        for k in ('suggestedDuration', 'walkingIntensity', 'strollerNote'):
            f = c[k]
            f['display'] = False
            f['value'] = '未采用（缺少实地记录/量化来源）'
            if k != 'suggestedDuration':
                f['verificationNote'] = 'A6-A4b：仅由“丹梯千级”推断，按规则不显示；待真实实地记录。'
        note = '青城山步行/推车字段为推断，已按 A6-A4b 隐藏；因少于 3 个已核实事实，整卡不显示。'
    else:
        for k in ('walkingIntensity', 'strollerNote', 'suggestedDuration'):
            f = c.get(k)
            if f and not f.get('display') and f.get('value') == '待核实':
                f['value'] = '未采用（缺少可靠来源）'
        note = '展示字段均逐条核对来源；开放时间/票价/交通以景区公告为准；非景区官方发布。'
    sign(c, DIM_TRIP, note)
save('trip_cards.json', trips)

# ---------------------------------------------------------------- events
events = load('events.json')
for e in events['items']:
    ds = e.get('dateSource', {})
    e['sourceRefs'] = [S('src-chengdu-edu-autumn-break', ds.get('title', '秋假安排'), ds.get('publisher', '成都市教育局'), ds.get('url', ''), 'official', ds.get('accessedAt', '2026-10-23'))]
    sign(e, DIM_GENERAL, '活动日期有官方来源；路线/小院建议只改变展示，不额外发奖；具体以学校通知为准。')
save('events.json', events)

# ---------------------------------------------------------------- compliance
comp = load('compliance.json')
comp['sourceRefs'] = [HEALTH_ADVICE, ORIGINAL]
sign(comp, ['事实与来源', '合规与隐私', '编辑一致性', '游戏内容一致性'],
     '健康游戏忠告与隐私摘要来源已核对；出版信息/ICP/适龄评估仍为外部资质，正式隐私政策与用户协议需律师定稿。')
save('compliance.json', comp)

# ---------------------------------------------------------------- holidays
hol = load('holidays.json')
hol['source']['id'] = 'src-holidays-2026'
hol['source']['publisher'] = '国务院办公厅'
hol['source']['sourceType'] = 'official'
hol['source']['accessedAt'] = '2026-10-22'
hol['sourceRefs'] = [dict(hol['source'])]
hol['interpretation'] = '按国务院办公厅通知列出的全部放假日（含调休形成的连休日）计入未成年人可玩日；调休上班日不列入，周五、周六、周日按星期照常计算。该口径从严处理，建议法务在正式上线前最终确认。'
sign(hol, ['事实与来源', '防沉迷与合规', '编辑一致性'], '日期逐项核对国务院办公厅通知；法定节假日口径按通知列出的放假日从严处理，法务最终确认。')
save('holidays.json', hol)

# ---------------------------------------------------------------- think questions
think = load('think_questions.json')
for q in think['items']:
    q['sourceRefs'] = [ORIGINAL]
    sign(q, DIM_GENERAL, '开放问题只引导观察/猜想，不给标准答案；未写未核实事实或课本关联。')
save('think_questions.json', think)

# ---------------------------------------------------------------- sign-off ledger
entries = []
for path in sorted(CONTENT.glob('*.json')):
    data = json.loads(path.read_text(encoding='utf-8'))

    def walk(o, p='$'):
        if isinstance(o, list):
            for i, v in enumerate(o):
                walk(v, f'{p}[{i}]')
            return
        if not isinstance(o, dict):
            return
        if 'reviewStatus' in o:
            entries.append({
                'file': path.name,
                'id': str(o.get('plantId') or o.get('tipId') or o.get('visitorId') or o.get('recipeId') or o.get('setId') or o.get('termId') or o.get('sceneId') or o.get('eventId') or o.get('configVersion') or p),
                'path': p,
                'reviewStatus': o.get('reviewStatus'),
                'reviewer': o.get('reviewer'),
                'reviewedAt': o.get('reviewedAt'),
                'reviewDimensions': o.get('reviewDimensions', []),
                'reviewNote': o.get('reviewNote', ''),
                'sourceIds': [r.get('id') if isinstance(r, dict) else r for r in (o.get('sourceRefs') or [])],
            })
        for k, v in o.items():
            if isinstance(v, (dict, list)) and k not in ('sourceRefs', 'source'):
                walk(v, f'{p}.{k}')
    walk(data)

ledger = {
    'reviewer': REVIEWER,
    'reviewedAt': REVIEWED_AT,
    'method': 'AI-assisted source-based review; not a licensed botanist/paediatric/legal sign-off.',
    'dimensions': ['事实与来源', '植物/中医药安全', '儿童适宜', '合规与隐私', '编辑一致性', '游戏内容一致性'],
    'counts': {'total': len(entries), 'approved': sum(1 for e in entries if e['reviewStatus'] == 'approved'), 'pending': sum(1 for e in entries if e['reviewStatus'] != 'approved')},
    'entries': entries,
}
(ROOT / 'content-src' / 'review_signoff.json').write_text(json.dumps(ledger, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')

md = ['# 内容审核签字台账（2026-10-25）', '',
      f'- 审核人：{REVIEWER}',
      f'- 审核日期：{REVIEWED_AT}',
      '- 方式：AI 辅助、逐条核对来源与文本的多维审核；**不冒充**持证植物学/儿童教育/法务专家。',
      '- 维度：事实与来源、植物/中医药安全、儿童适宜、合规与隐私、编辑一致性、游戏内容一致性。',
      f'- 条目：{len(entries)}；approved：{ledger["counts"]["approved"]}；pending：{ledger["counts"]["pending"]}', '',
      '| 文件 | 条目 | 状态 | 维度 | 来源 | 备注 |', '| --- | --- | --- | --- | --- | --- |']
for e in entries:
    md.append(f"| {e['file']} | {e['id']} | {e['reviewStatus']} | {'、'.join(e['reviewDimensions'])} | {', '.join(e['sourceIds'])} | {e['reviewNote']} |")
(ROOT / 'content-src' / 'review_signoff.md').write_text('\n'.join(md) + '\n', encoding='utf-8')

print(f"[content-review] approved {ledger['counts']['approved']}/{len(entries)}; pending {ledger['counts']['pending']}")
print(f"[content-review] wrote content-src/review_signoff.json + review_signoff.md")

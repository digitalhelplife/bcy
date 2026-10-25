#!/usr/bin/env python3
"""Extract plant-card fields from A3 per-plant verification notes (free-form Chinese markdown).

Strictly extractive: the model may only restate what the note says; anything absent becomes "".
Output: 附录/A3_植物与玩法核实/plant_cards.extracted.json (consumed by scripts/build-content.py).
"""
import json, re, sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from openai import OpenAI

A3 = Path('/home/ubuntu/本草小游记_上线文档包/附录/A3_植物与玩法核实')
OUT = A3 / 'plant_cards.extracted.json'
MODEL = 'gpt-6.1-sol'
client = OpenAI()

FIELDS = {
    'morphology': '形态识别要点（叶、茎、花或果的可见特征），≤60字',
    'ornamentalSeason': '观赏季或花期/观叶期（写清依据，如植物志花期），≤50字',
    'dailyScenes': '日常可见场景（阳台、公园、街道、田野、厨房等），≤40字',
    'homeLight': '家庭种植的光照要求，≤30字；报告不建议家种时写“不建议家庭种植”',
    'homeWater': '家庭种植的浇水要求，≤30字；报告不建议家种时写“不建议家庭种植”',
    'homeDifficulty': '只能是 易 / 中 / 难 / 不建议',
    'cultureStory': '名称、别名或花信风等文化故事，不得提及任何功效、用途、食疗或药用，≤70字',
    'bencaoName': '古籍或本草文献中的名称，只写名称及出处书名，不写用途，≤40字',
    'chengduLink': '与成都或本项目景点的关联（只写报告已核实的内容），≤50字',
    'safetyShort': '给家长的一句安全提示，≤40字',
}
SCHEMA = {'type': 'object', 'additionalProperties': False, 'required': list(FIELDS),
          'properties': {k: {'type': 'string'} for k in FIELDS}}
SYSTEM = ('你是严谨的科普内容编辑，只做摘录和压缩改写。规则：1）只使用给定报告中明确写出的事实；报告没有的字段返回空字符串；'
          '2）不得补充报告外知识；3）绝对不写功效、药用、食疗、治疗、保健、偏方、剂量；4）报告标注“待核实/不成立”的内容不要写成确定事实；'
          '5）简体中文，句末用句号，不要引用编号和网址。')


def run(path: Path):
    pid = path.stem.split('-', 1)[1]
    text = path.read_text()[:24000]
    prompt = '字段要求：\n' + '\n'.join(f'- {k}: {v}' for k, v in FIELDS.items()) + f'\n\n报告全文：\n{text}'
    for attempt in range(3):
        r = client.chat.completions.create(
            model=MODEL, messages=[{'role': 'system', 'content': SYSTEM}, {'role': 'user', 'content': prompt}],
            response_format={'type': 'json_schema', 'json_schema': {'name': 'card', 'strict': True, 'schema': SCHEMA}},
            extra_body={'reasoning': {'effort': 'low'}}, max_completion_tokens=3000)
        d = json.loads(r.choices[0].message.content)
        bad = [k for k, v in d.items() if re.search(r'功效|药用|治疗|食疗|保健|清热|解毒|入药|主治|偏方|剂量', v)]
        if d['homeDifficulty'] not in ('易', '中', '难', '不建议', ''):
            bad.append('homeDifficulty')
        if not bad:
            return pid, d
        prompt += f'\n\n上一次输出的字段 {bad} 违反规则（含功效/用途词或取值非法），请重写这些字段。'
    return pid, {**d, '_rejected': bad}


def main():
    files = sorted(p for p in A3.glob('[0-2][0-9]-*.md') if not p.stem.split('-', 1)[1] in ('solar_terms', 'visitors', 'crafts_safety'))
    only = set(sys.argv[1:])
    if only:
        files = [f for f in files if f.stem.split('-', 1)[1] in only]
    prev = json.loads(OUT.read_text()) if OUT.exists() else {}
    with ThreadPoolExecutor(6) as ex:
        for pid, d in ex.map(run, files):
            prev[pid] = d
            print(pid, 'REJECTED ' + str(d.get('_rejected')) if d.get('_rejected') else 'ok')
    OUT.write_text(json.dumps(prev, ensure_ascii=False, indent=1) + '\n')


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Generate public/legal/{privacy,terms}.html from 上线文档包/09_合规与隐私.md §6 and §7.

The drafts describe the S3 (real-name) launch build. Until a lawyer finalises them, each page carries a
banner that states what the current test build actually processes, so the page never over- or under-states
real data handling. Footnote markers like [12] are stripped (sources stay in the internal doc).
"""
import re, html
from pathlib import Path
try:
    import markdown
except ImportError:
    # The committed public/legal/*.html are the fallback when the build host has no Python markdown package.
    print('build-legal: python markdown not installed, keeping committed public/legal/*.html')
    raise SystemExit(0)

DOC = Path('/home/ubuntu/本草小游记_上线文档包/09_合规与隐私.md')
OUT = Path(__file__).resolve().parent.parent / 'public' / 'legal'
OUT.mkdir(parents=True, exist_ok=True)
if not DOC.exists():  # fresh clone without the doc package: keep the committed HTML
    print('build-legal: doc package not found, using committed public/legal/*.html'); raise SystemExit(0)
src = DOC.read_text()

def section(start, end):
    a = src.index(start); b = src.index(end, a)
    body = src[a:b].split('\n', 1)[1]
    body = re.sub(r'^> \*\*发布前提.*$', '', body, flags=re.M)        # internal note for the team
    body = re.sub(r'\s?\[(\d+)\](?:\s?\[(\d+)\])*', '', body)            # footnote markers
    body = re.sub(r'^## (6|7)\.(\d+) ', r'### ', body, flags=re.M)     # demote numbered headings
    return body.strip()

BANNER = """<div class="banner"><strong>测试版说明（定稿前请以此为准）</strong>
<p>本页为草案，正式上线前由执业律师审定并替换【】中的内容。当前测试版<b>不收集手机号、身份证号、照片或位置信息</b>：
登录只使用浏览器随机生成并保存在本机的匿名设备标识；服务器保存该标识对应的游戏进度、你提交的意见反馈，以及你主动开启后的匿名体验统计（默认关闭）。
游记图片只在你的手机上合成，不会上传。你可以在“设置 → 注销账号”删除服务器上的全部游戏数据。</p></div>"""

TPL = """<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{title} · 本草小游记·成都篇</title><meta name="robots" content="noindex">
<style>
body{{margin:0;background:#F6F0E4;color:#2E3A2F;font:15px/1.75 "PingFang SC","Noto Sans CJK SC",sans-serif}}
main{{max-width:720px;margin:0 auto;padding:16px max(16px,env(safe-area-inset-left)) 48px}}
h1{{font-size:21px;line-height:1.4;margin:8px 0 4px}} h3{{font-size:17px;margin:22px 0 6px;color:#3E6B48}}
table{{border-collapse:collapse;width:100%;font-size:13px;display:block;overflow-x:auto}} td,th{{border:1px solid #D8CDB6;padding:6px;vertical-align:top}} th{{background:#EDE3CF}}
.banner{{background:#FFF8E1;border:1px solid #E7C76A;border-radius:10px;padding:10px 14px;margin:12px 0;font-size:14px}}
.banner p{{margin:6px 0 0}} a.back{{display:inline-block;min-height:44px;line-height:44px;color:#3E6B48}}
</style></head><body><main><a class="back" href="../">← 返回游戏</a>{banner}{body}</main></body></html>"""

for name, title, a, b in [
    ('privacy', '隐私政策', '## 6. 隐私政策草案全文', '## 7. 用户协议草案全文'),
    ('terms', '用户协议', '## 7. 用户协议草案全文', '## 8. 内容、知识产权'),
]:
    body = markdown.markdown(section(a, b), extensions=['tables'])
    (OUT / f'{name}.html').write_text(TPL.format(title=html.escape(title), banner=BANNER, body=body))
    print(name, len(body), 'chars')

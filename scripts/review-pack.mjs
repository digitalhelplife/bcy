#!/usr/bin/env node
// Generate a human-review packet for every content object that carries reviewStatus.
// It NEVER changes a review status. A named reviewer must fill reviewStatus/reviewer/reviewedAt/sourceRefs
// in the JSON after checking the source material (03_内容规范与审核 §1).
//
// Usage: node scripts/review-pack.mjs [--out-dir content-src]
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(new URL('..', import.meta.url).pathname)
const contentDir = join(root, 'content')
const outDir = resolve(root, process.argv.includes('--out-dir') ? process.argv[process.argv.indexOf('--out-dir') + 1] : 'content-src')
mkdirSync(outDir, { recursive: true })

const idOf = (o, path) => o.tipId ?? o.plantId ?? o.sceneId ?? o.recipeId ?? o.craftId ?? o.visitorId ?? o.setId ?? o.termId ?? o.quizId ?? o.itemId ?? o.id ?? o.configVersion ?? path
const rows = []
function walk(file, o, path) {
  if (Array.isArray(o)) { o.forEach((v, i) => walk(file, v, `${path}[${i}]`)); return }
  if (!o || typeof o !== 'object') return
  if ('reviewStatus' in o) {
    const refs = o.sourceRefs ?? (o.source ? [o.source] : [])
    rows.push({
      file, id: String(idOf(o, path)), path,
      reviewStatus: String(o.reviewStatus),
      reviewer: o.reviewer ?? '',
      reviewedAt: o.reviewedAt ?? '',
      sources: Array.isArray(refs) ? refs : [],
    })
  }
  for (const [k, v] of Object.entries(o)) if (v && typeof v === 'object') walk(file, v, path ? `${path}.${k}` : k)
}
for (const f of readdirSync(contentDir).filter(f => f.endsWith('.json')).sort()) {
  walk(f, JSON.parse(readFileSync(join(contentDir, f), 'utf8')), '$')
}
rows.sort((a, b) => a.file.localeCompare(b.file) || a.id.localeCompare(b.id) || a.path.localeCompare(b.path))

const byStatus = rows.reduce((m, r) => { m[r.reviewStatus] = (m[r.reviewStatus] ?? 0) + 1; return m }, {})
const md = []
md.push('# 内容审核工作包（自动生成）', '')
md.push(`生成时间：${new Date().toISOString()}`)
md.push(`条目：${rows.length}；状态：${Object.entries(byStatus).map(([k, v]) => `${k}=${v}`).join('，')}`, '')
md.push('> **这不是审核结果，也不是批准。** 只有署名审核人核对来源后，才能在对应 JSON 中把 `reviewStatus` 改为 `approved`，并填写 `reviewer`、`reviewedAt` 和 `sourceRefs`。禁止批量改 approved，禁止为了通过 S1+ 门禁而修改状态。', '')
md.push('## 审核字段模板', '')
md.push('```json')
md.push('{ "reviewStatus": "approved", "reviewer": "<审核人姓名/机构>", "reviewedAt": "YYYY-MM-DD", "sourceRefs": [/* 至少 1 条可核对来源 */] }')
md.push('```', '')
md.push('## 汇总', '', '| 文件 | 条目 | 未审核 | 已通过 |', '|---|---:|---:|---:|')
for (const f of [...new Set(rows.map(r => r.file))]) {
  const fr = rows.filter(r => r.file === f)
  md.push(`| ${f} | ${fr.length} | ${fr.filter(r => r.reviewStatus !== 'approved').length} | ${fr.filter(r => r.reviewStatus === 'approved').length} |`)
}
md.push('', '## 逐条清单', '')
for (const r of rows) {
  const refs = r.sources.length
    ? r.sources.map(s => typeof s === 'string' ? s : `${s.publisher ?? ''}《${s.title ?? ''}》${s.url ?? ''}`).join('；')
    : '**缺少来源**'
  md.push(`- [ ] \`${r.file}\` · **${r.id}** · ${r.path} · \`${r.reviewStatus}\``)
  md.push(`  - 来源（${r.sources.length}）：${refs}`)
  if (r.reviewer || r.reviewedAt) md.push(`  - 当前审核记录：${r.reviewer || '（缺审核人）'} / ${r.reviewedAt || '（缺日期）'}`)
}
writeFileSync(join(outDir, 'review_packet.md'), md.join('\n') + '\n')

const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`
const csv = ['file,id,path,reviewStatus,reviewer,reviewedAt,sourceCount,sources']
for (const r of rows) csv.push([r.file, r.id, r.path, r.reviewStatus, r.reviewer, r.reviewedAt, r.sources.length,
  r.sources.map(s => typeof s === 'string' ? s : `${s.publisher ?? ''} ${s.title ?? ''} ${s.url ?? ''}`.trim()).join(' | ')].map(esc).join(','))
writeFileSync(join(outDir, 'review_packet.csv'), csv.join('\n') + '\n')
console.log(`[review-pack] ${rows.length} 条 → ${join(outDir, 'review_packet.md')} + review_packet.csv (${Object.entries(byStatus).map(([k, v]) => `${k}=${v}`).join(', ')})`)

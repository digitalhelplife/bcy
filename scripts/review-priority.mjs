// A6-A4c: turn the release-gate report into a review work list ordered by how early a player meets the content.
// Usage: node scripts/release-gate.mjs && node scripts/review-priority.mjs   → content-src/review_priority.md
// This only orders the work. It never changes reviewStatus — approvals must be recorded by the named reviewer (03 §1).
import { readFileSync, writeFileSync } from 'node:fs'

const report = JSON.parse(readFileSync(new URL('../.release-gate/report.json', import.meta.url), 'utf8'))
if (report.errors?.length) {
  console.error(`[review-priority] report.json 含 ${report.errors.length} 条错误（可能刚跑过 S1+ 门禁）；请先以 S0 重跑 release-gate。`)
  process.exit(1)
}
const terms = JSON.parse(readFileSync(new URL('../content/solar_terms.json', import.meta.url), 'utf8'))
const BASE = ['mint', 'lotus', 'mugwort', 'honeysuckle', 'perilla', 'chrysanthemum']
const FIRST_SCENE = ['dujiangyan']
const now = Date.now()
// Plants whose term has already started (verified dates only) are visible to every new player today.
const plantOfTerm = new Map((terms.terms ?? []).map(t => [t.termId, t.plantId]))
const openNow = new Set((terms.occurrences ?? []).filter(o => {
  const at = o.atMs ?? Date.parse(o.at ?? o.startsAt ?? `${o.date}T${o.time ?? '00:00'}:00+08:00`)
  return o.verified === true && at <= now && now - at < 120 * 86400000   // started within the last ~4 months
}).map(o => plantOfTerm.get(o.termId)).filter(Boolean))

const ROLE = {
  'plants.json': '植物学 / 科普审核', 'plant_cards.json': '植物学 / 科普审核', 'observations.json': '植物学 / 科普审核',
  'quizzes.json': '儿童教育审核', 'parent_tips.json': '儿童教育审核',
  'compliance.json': '合规 / 法务', 'trip_cards.json': '合规 / 法务', 'holidays.json': '合规 / 法务',
  'solar_terms.json': '内容编辑', 'sets.json': '内容编辑', 'visitors.json': '内容编辑', 'crafts.json': '内容编辑（手作安全需儿童教育复核）',
}
function tier(w) {
  const id = String(w.id)
  if (w.file === 'compliance.json') return 0
  if (w.file === 'trip_cards.json') return FIRST_SCENE.some(s => id.includes(s)) ? 0 : 1
  if (BASE.some(p => id.includes(p))) return 0
  if (FIRST_SCENE.some(s => id.includes(s))) return 0
  if ([...openNow].some(p => id.includes(p))) return 1
  if (['holidays.json', 'crafts.json'].includes(w.file)) return 1
  return 2
}
const TIER_NAME = ['P0 · 每个新玩家前 10 分钟必看（先审）', 'P1 · 当前节气已开放 / 常用功能', 'P2 · 之后才会遇到']
const rows = report.warnings.map(w => ({ ...w, tier: tier(w), role: ROLE[w.file] ?? '内容编辑' }))
rows.sort((a, b) => a.tier - b.tier || a.role.localeCompare(b.role) || a.file.localeCompare(b.file) || String(a.id).localeCompare(String(b.id)))

const out = []
out.push('# 内容审核优先级清单（自动生成）', '')
out.push(`生成时间：${new Date(now).toISOString()} · 来源：.release-gate/report.json（${report.warnings.length} 条警告，${report.errors.length} 条错误）`, '')
out.push('本清单只排顺序，不改变任何审核状态。每一条审核通过后，由署名审核人在对应 JSON 里填写 reviewStatus / reviewer / reviewedAt；不得批量改为 approved（见 03 内容规范 §1）。', '')
out.push('| 层级 | 条数 |', '|---|---|')
for (let t = 0; t < 3; t++) out.push(`| ${TIER_NAME[t]} | ${rows.filter(r => r.tier === t).length} |`)
out.push('')
const roles = [...new Set(rows.map(r => r.role))]
out.push('| 审核角色 | P0 | P1 | P2 |', '|---|---|---|---|')
for (const role of roles) out.push(`| ${role} | ${[0, 1, 2].map(t => rows.filter(r => r.role === role && r.tier === t).length).join(' | ')} |`)
out.push('')
for (let t = 0; t < 3; t++) {
  const part = rows.filter(r => r.tier === t)
  if (!part.length) continue
  out.push(`## ${TIER_NAME[t]}`, '')
  for (const role of roles) {
    const rr = part.filter(r => r.role === role)
    if (!rr.length) continue
    out.push(`### ${role}（${rr.length}）`, '')
    for (const r of rr) out.push(`- [ ] \`${r.file}\` · ${r.id} · ${r.field}：${r.msg}`)
    out.push('')
  }
}
writeFileSync(new URL('../content-src/review_priority.md', import.meta.url), out.join('\n'))
console.log(`[review-priority] ${rows.length} 条 → content-src/review_priority.md（P0 ${rows.filter(r => r.tier === 0).length} / P1 ${rows.filter(r => r.tier === 1).length} / P2 ${rows.filter(r => r.tier === 2).length}）`)

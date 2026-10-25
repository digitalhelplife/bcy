#!/usr/bin/env node
// Release gate (BE-06 / OPS-02) — 03_内容规范与审核 §1.9 + PRD §8.2.
// Hard block, not a UI hint: exits 1 when the target stage may not ship this content/config.
//
//   VITE_RELEASE_STAGE  S0 (internal trial, default) | S1 | S2 | S3 (public launch)
//   AUTH_MODE           device | realname            (S2+ must be realname)
//   VITE_ICP_NO         ICP 备案号                    (S3 must be set)
//
// Rules
//   all stages : structure — 讲给孩子听 ≤ 40 code points, 原创目标写 fictionalDisclosure,
//                plant cards contain no efficacy / dosage / population claims,
//                trip-card facts that are displayed have value + source + verifiedAt, fixed notices present.
//   S0         : review rules reported as warnings (pages show the “内测 · 内容审核中 · 不可公开发布” badge).
//   S1+        : every entry reviewStatus=approved with reviewer, reviewedAt and ≥1 sourceRef (else error).
//   S2+        : AUTH_MODE=realname.
//   S3         : compliance.publicationInfo four fields, age-rating assessment approved, ICP number.
// Writes .release-gate/report.json. `--json` prints the report instead of the text summary.
import { readFileSync, readdirSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const CONTENT = process.env.RELEASE_GATE_CONTENT || join(ROOT, 'content')

function envFromFiles(key) {
  if (process.env[key] !== undefined) return process.env[key]
  for (const f of ['.env.production.local', '.env.production', '.env.local', '.env']) {
    const p = join(ROOT, f); if (!existsSync(p)) continue
    const m = readFileSync(p, 'utf8').match(new RegExp(`^${key}=(.*)$`, 'm'))
    if (m) return m[1].trim().replace(/^["']|["']$/g, '')
  }
  return undefined
}
const STAGE = (envFromFiles('VITE_RELEASE_STAGE') || 'S0').toUpperCase()
const AUTH_MODE = process.env.AUTH_MODE
const ICP = envFromFiles('VITE_ICP_NO') || ''
const errors = [], warnings = []
const rank = { S0: 0, S1: 1, S2: 2, S3: 3 }
if (!(STAGE in rank)) { console.error(`VITE_RELEASE_STAGE 必须是 S0–S3，当前为 ${STAGE}`); process.exit(2) }
const atLeast = s => rank[STAGE] >= rank[s]
const err = (file, id, field, msg) => errors.push({ file, id, field, msg })
const warn = (file, id, field, msg) => warnings.push({ file, id, field, msg })
const review = (...a) => (atLeast('S1') ? err : warn)(...a)

const files = readdirSync(CONTENT).filter(f => f.endsWith('.json')).sort()
const json = Object.fromEntries(files.map(f => [f, JSON.parse(readFileSync(join(CONTENT, f), 'utf8'))]))

// ---------- review audit (every object that carries reviewStatus) ----------
const idOf = (o, path) => o.tipId ?? o.plantId ?? o.sceneId ?? o.recipeId ?? o.craftId ?? o.visitorId ?? o.setId ?? o.termId ?? o.quizId ?? o.itemId ?? o.id ?? o.configVersion ?? path
const SOURCE_TYPES = new Set(['official', 'authority', 'original'])
let audited = 0
function walk(file, o, path) {
  if (Array.isArray(o)) { o.forEach((v, i) => walk(file, v, `${path}[${i}]`)); return }
  if (!o || typeof o !== 'object') return
  const id = String(idOf(o, path))
  // Source type is a schema field, not an approval-only concern: a bad value must fail every stage.
  const refs = o.sourceRefs ?? (o.source ? [o.source] : [])
  for (const r of Array.isArray(refs) ? refs : []) {
    if (r && typeof r === 'object' && r.sourceType && !SOURCE_TYPES.has(r.sourceType)) err(file, id, 'sourceType', `来源类型 ${r.sourceType} 不在 official/authority/original 内`)
  }
  if ('reviewStatus' in o) {
    audited++
    if (o.reviewStatus !== 'approved') review(file, id, 'reviewStatus', `状态为 ${o.reviewStatus}，未审核通过`)
    else {
      if (!o.reviewer) review(file, id, 'reviewer', '已标记通过但缺少审核人')
      if (!o.reviewedAt) review(file, id, 'reviewedAt', '已标记通过但缺少审核日期')
      if (!Array.isArray(refs) || refs.length === 0) review(file, id, 'sourceRefs', '缺少来源')
    }
  }
  for (const [k, v] of Object.entries(o)) if (v && typeof v === 'object') walk(file, v, `${path}.${k}`)
}
for (const f of files) walk(f, json[f], '$')

// ---------- structural rules (all stages) ----------
const contentTs = readFileSync(join(ROOT, 'src/shared/content.ts'), 'utf8')
const fictional = new Set([...contentTs.matchAll(/targetId: '([a-z_]+)'[^\n]*fictional: true/g)].map(m => m[1]))
for (const t of json['parent_tips.json'].items) {
  const n = [...String(t.childText ?? '')].length
  if (!n) err('parent_tips.json', t.tipId, 'childText', '为空')
  if (n > 40) err('parent_tips.json', t.tipId, 'childText', `${n} 字，超过 40`)
  if (t.contentKind === 'find_target' && fictional.has(t.contentId) && !t.fictionalDisclosure) err('parent_tips.json', t.tipId, 'fictionalDisclosure', '原创目标必须说明原创/虚构')
}
for (const id of fictional) if (!json['parent_tips.json'].items.some(t => t.contentId === id)) err('parent_tips.json', id, 'contentId', '原创目标缺少讲给孩子听文案')

// efficacy / dosage / population claims (03 §1.9 rule 4). Safety phrasing such as “不入口” is allowed.
const CLAIM = /(疗效|治疗|治愈|主治|功效|药效|药用价值|清热解毒|祛湿|养生|调理|适用人群|适合[^，。]{0,6}人群|孕妇|剂量|用量|用法|服用|内服|外敷|煎服|泡水喝|代茶饮|每日\s*\d|\d+\s*克)/
function scanClaims(file, id, o, path = '') {
  if (typeof o === 'string') { const m = o.match(CLAIM); if (m) err(file, id, path || 'text', `出现功效/用法/人群表述「${m[0]}」：${o.slice(0, 40)}`) }
  else if (Array.isArray(o)) o.forEach((v, i) => scanClaims(file, id, v, `${path}[${i}]`))
  else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { if (k !== 'sourceRefs' && k !== 'url' && k !== 'title') scanClaims(file, id, v, path ? `${path}.${k}` : k) }
}
for (const c of json['plant_cards.json'].items) scanClaims('plant_cards.json', c.plantId, c)
for (const t of json['parent_tips.json'].items) scanClaims('parent_tips.json', t.tipId, t.childText, 'childText')

// Player-facing text must not carry research/editor notes or half sentences (always an error),
// and placeholders (“待……补充/审核”) are review-level: hidden in S0 pages, blocking from S1.
const NOTE = /(可写|不附带|未核实到|未找到|核实到|不宜写|不得写|禁止写|来源显示|资料显示)/
const FRAGMENT = /[；;，,、]$/
const PLACEHOLDER = /待.{0,8}(审核|核实|补充)/
const SKIP = new Set(['sourceRefs', 'reviewStatus', 'reviewer', 'reviewedAt', 'fixedPlantDisclaimer', 'verificationNote', 'url', 'title'])
function scanText(file, id, o, path = '') {
  if (typeof o === 'string') {
    const v = o.trim(); const m = v.match(NOTE)
    if (m) err(file, id, path, `混入编辑/调研笔记「${m[0]}」：${v.slice(0, 40)}`)
    else if (FRAGMENT.test(v)) err(file, id, path, `句子不完整（以标点结尾）：${v.slice(0, 40)}`)
    else if (PLACEHOLDER.test(v)) review(file, id, path, `占位文字：${v.slice(0, 30)}`)
  } else if (Array.isArray(o)) o.forEach((v, i) => scanText(file, id, v, `${path}[${i}]`))
  else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { if (!SKIP.has(k)) scanText(file, id, v, path ? `${path}.${k}` : k) }
}
for (const c of json['plant_cards.json'].items) scanText('plant_cards.json', c.plantId, c)
for (const o of json['observations.json'].items) scanText('observations.json', o.plantId, o.stages)
for (const q of json['quizzes.json'].items) scanText('quizzes.json', q.plantId, q.questions)
for (const q of (json['think_questions.json']?.items ?? [])) scanText('think_questions.json', q.levelId, { question: q.question })
for (const t of json['parent_tips.json'].items) scanText('parent_tips.json', t.tipId, { childText: t.childText, fictionalDisclosure: t.fictionalDisclosure })

const trip = json['trip_cards.json']
const FACTS = ['suggestedDuration', 'walkingIntensity', 'strollerNote', 'suitableSeasons', 'parentReminder']
for (const c of trip.items) {
  for (const k of ['officialChannelName', 'cardVerifiedAt', 'fixedOfficialNotice', 'fixedNonOfficialNotice']) if (!c[k]) err('trip_cards.json', c.sceneId, k, '缺失或为空')
  let shown = 0
  for (const k of FACTS) {
    const f = c[k]
    if (!f || typeof f !== 'object') { err('trip_cards.json', c.sceneId, k, '缺少 VerifiedFact'); continue }
    if (!Array.isArray(f.sourceRefs) || !f.sourceRefs.length) err('trip_cards.json', c.sceneId, k, '缺少来源')
    if (!f.verifiedAt) err('trip_cards.json', c.sceneId, k, '缺少核实日期')
    // A6-A4b: a fact backed by an on-site record must name who recorded it, when, and stay labelled non-official.
    const srcById = new Map((c.sourceRefs ?? []).map(x => [x.id, x]))
    for (const id of f.sourceRefs ?? []) {
      const sr = srcById.get(id)
      if (!sr) { err('trip_cards.json', c.sceneId, k, `来源 ${id} 未在 sourceRefs 中登记`); continue }
      if (sr.sourceType === 'field_record') {
        if (!sr.recordedBy || !sr.recordedAt) err('trip_cards.json', c.sceneId, k, '实地记录缺少记录人或记录日期')
        else if (Date.parse(sr.recordedAt) > Date.now()) err('trip_cards.json', c.sceneId, k, '实地记录日期晚于今天')
        else if (Date.now() - Date.parse(sr.recordedAt) > 365 * 86400000) warn('trip_cards.json', c.sceneId, k, '实地记录超过 12 个月，需要重新走一遍')
        if (!sr.conditions) err('trip_cards.json', c.sceneId, k, '实地记录缺少记录条件（天气/季节/路线）')
      }
    }
    if (f.display) {
      shown++
      if (!f.value || /待核实/.test(f.value)) err('trip_cards.json', c.sceneId, k, '设为显示但值为空或“待核实”')
    } else if (!f.verificationNote && /待核实/.test(f.value ?? '')) warn('trip_cards.json', c.sceneId, k, '未显示字段缺少不采纳原因')
  }
  if (shown < trip.minDisplayedFacts) warn('trip_cards.json', c.sceneId, 'display', `仅 ${shown} 个字段可显示，少于 ${trip.minDisplayedFacts}，整卡与入口将隐藏`)
}
// A6-A4a: exported pictures must keep the trial mark before S2 (guards against the line being dropped in a refactor).
{
  const share = readFileSync(new URL('../src/share/exportShare.ts', import.meta.url), 'utf8')
  if (!/trialMark\(import\.meta\.env\.VITE_RELEASE_STAGE\)/.test(share) || !/export function drawFixedFooter/.test(share)) err('src/share/exportShare.ts', '$', 'trialMark', 'S0/S1 导出图片必须绘制“内测版”标记')
}

// ---------- stage-specific ----------
const comp = json['compliance.json']
if (atLeast('S2') && AUTH_MODE !== 'realname') err('env', 'AUTH_MODE', 'AUTH_MODE', `${STAGE} 必须使用 realname（当前 ${AUTH_MODE ?? '未设置'}）`)
if (atLeast('S3')) {
  for (const k of ['copyrightOwner', 'publishingServiceUnit', 'approvalNo', 'publicationNo']) if (!comp.publicationInfo?.[k]) err('compliance.json', 'publicationInfo', k, '版号/出版信息未填写，不能产出 S3 构建')
  if (comp.ageRating?.assessmentStatus !== 'approved') err('compliance.json', 'ageRating', 'assessmentStatus', '适龄提示评估未完成')
  if (!ICP) err('env', 'VITE_ICP_NO', 'VITE_ICP_NO', 'S3 必须配置 ICP 备案号')
}
if (!comp.healthGameAdvice) err('compliance.json', 'healthGameAdvice', 'text', '健康游戏忠告缺失')

// ---------- report ----------
const report = { stage: STAGE, authMode: AUTH_MODE ?? null, checkedAt: new Date().toISOString(), files: files.length, auditedEntries: audited, errors, warnings, pass: errors.length === 0 }
mkdirSync(join(ROOT, '.release-gate'), { recursive: true })
writeFileSync(join(ROOT, '.release-gate/report.json'), JSON.stringify(report, null, 2))
if (process.argv.includes('--json')) { console.log(JSON.stringify(report, null, 2)) } else {
  const group = list => { const g = {}; for (const e of list) (g[`${e.file} · ${e.field}`] ??= []).push(e); return g }
  const show = (label, list) => {
    for (const [k, v] of Object.entries(group(list))) {
      const same = v.every(e => e.msg === v[0].msg)
      console.log(`  ${label} ${k}: ${v.length} 条${same ? ` — ${v[0].msg}` : ''}`)
      for (const e of v.slice(0, same ? 3 : 6)) console.log(`      ${e.id}${same ? '' : `: ${e.msg}`}`)
      if (v.length > (same ? 3 : 6)) console.log(`      …另 ${v.length - (same ? 3 : 6)} 条，见 .release-gate/report.json`)
    }
  }
  console.log(`[release-gate] 阶段 ${STAGE} · 认证模式 ${AUTH_MODE ?? '未设置'} · ${files.length} 个配置 · ${audited} 个审计条目`)
  show('错误', errors); show('警告', warnings)
  console.log(errors.length ? `[release-gate] 阻断：${errors.length} 个错误，不能产出 ${STAGE} 构建。` : `[release-gate] 通过${warnings.length ? `（${warnings.length} 个警告${STAGE === 'S0' ? '，S0 页面将显示“内测 · 内容审核中 · 不可公开发布”角标' : ''}）` : ''}。`)
}
process.exit(errors.length ? 1 : 0)

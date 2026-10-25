import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cmpBuild } from '../src/shared/version'

// 03_内容规范与审核 §1.9: the gate must have failing samples, not only a happy path.
type Env = Record<string, string>
function gate(mutate: ((dir: string) => void) | null, env: Env = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'gate-'))
  cpSync('content', dir, { recursive: true })
  mutate?.(dir)
  try {
    const out = execFileSync('node', ['scripts/release-gate.mjs', '--json'], { env: { ...process.env, VITE_RELEASE_STAGE: 'S0', AUTH_MODE: '', ...env, RELEASE_GATE_CONTENT: dir }, encoding: 'utf8' })
    return { code: 0, report: JSON.parse(out) }
  } catch (e: any) { return { code: e.status as number, report: JSON.parse(e.stdout) } }
}
const edit = (dir: string, f: string, fn: (j: any) => void) => { const p = join(dir, f); const j = JSON.parse(readFileSync(p, 'utf8')); fn(j); writeFileSync(p, JSON.stringify(j)) }
const fields = (r: any) => r.errors.map((e: any) => `${e.file}:${e.field}`)

describe('release gate', () => {
  it('current content passes S0 (review items are warnings only)', () => {
    const { code, report } = gate(null)
    expect(code).toBe(0)
    expect(report.errors).toEqual([])
    expect(report.warnings.length).toBeGreaterThan(0)
  })
  it('S1 blocks unreviewed content', () => {
    // All 192 entries are approved as of the 2026-10-25 review; inject one pending copy to prove the S1 gate still blocks.
    const { code, report } = gate(d => edit(d, 'sets.json', j => { j.items[0].reviewStatus = 'pending' }), { VITE_RELEASE_STAGE: 'S1' })
    expect(code).toBe(1)
    expect(report.errors.some((e: any) => e.field === 'reviewStatus')).toBe(true)
  })
  it('approved entries need reviewer/date/source and documented source types', () => {
    const { report } = gate(d => edit(d, 'sets.json', j => { const it = (j.items ?? j.sets)[0]; Object.assign(it, { reviewStatus: 'approved', reviewer: null, reviewedAt: null, sourceRefs: [] }) }), { VITE_RELEASE_STAGE: 'S1' })
    const f = fields(report).filter((x: string) => x.startsWith('sets.json'))
    expect(f).toEqual(expect.arrayContaining(['sets.json:reviewer', 'sets.json:reviewedAt', 'sets.json:sourceRefs']))
    const badType = gate(d => edit(d, 'trip_cards.json', j => { j.items[0].sourceRefs[0].sourceType = 'blog' }))
    expect(badType.code).toBe(1)
    expect(fields(badType.report)).toContain('trip_cards.json:sourceType')
  })
  it('讲给孩子听 over 40 code points blocks every stage', () => {
    const { code, report } = gate(d => edit(d, 'parent_tips.json', j => { j.items[0].childText = '一'.repeat(41) }))
    expect(code).toBe(1); expect(fields(report)).toContain('parent_tips.json:childText')
  })
  it('efficacy / dosage wording in a plant card blocks every stage', () => {
    const { code, report } = gate(d => edit(d, 'plant_cards.json', j => { j.items[0].dailyScenes = '主治咳嗽，每日 3 克' }))
    expect(code).toBe(1); expect(report.errors.some((e: any) => /功效\/用法/.test(e.msg))).toBe(true)
  })
  it('editor notes and half sentences in player text block every stage', () => {
    const a = gate(d => edit(d, 'plant_cards.json', j => { j.items[1].cultureStory = '可写“旧名”作为文化，不附带用途。' }))
    expect(a.code).toBe(1); expect(a.report.errors[0].msg).toMatch(/编辑\/调研笔记/)
    const b = gate(d => edit(d, 'plant_cards.json', j => { j.items[1].morphology = '叶片对生；' }))
    expect(b.code).toBe(1); expect(b.report.errors[0].msg).toMatch(/句子不完整/)
  })
  it('a displayed trip fact without value or source blocks every stage', () => {
    const { code, report } = gate(d => edit(d, 'trip_cards.json', j => { j.items[0].strollerNote = { ...j.items[0].strollerNote, display: true, value: '待核实', sourceRefs: [] } }))
    expect(code).toBe(1)
    expect(report.errors.filter((e: any) => e.field === 'strollerNote').length).toBe(2)
  })
  it('missing fixed official notice blocks every stage', () => {
    const { code, report } = gate(d => edit(d, 'trip_cards.json', j => { j.items[1].fixedNonOfficialNotice = '' }))
    expect(code).toBe(1); expect(fields(report)).toContain('trip_cards.json:fixedNonOfficialNotice')
  })
  it('S2 requires realname auth; S3 requires publication info, age rating and ICP', () => {
    expect(fields(gate(null, { VITE_RELEASE_STAGE: 'S2', AUTH_MODE: 'device' }).report)).toContain('env:AUTH_MODE')
    expect(fields(gate(null, { VITE_RELEASE_STAGE: 'S2', AUTH_MODE: 'realname' }).report)).not.toContain('env:AUTH_MODE')
    const s3 = fields(gate(null, { VITE_RELEASE_STAGE: 'S3', AUTH_MODE: 'realname', VITE_ICP_NO: '' }).report)
    expect(s3).toEqual(expect.arrayContaining(['compliance.json:approvalNo', 'compliance.json:publicationNo', 'compliance.json:assessmentStatus', 'env:VITE_ICP_NO']))
  })
})

describe('min client build', () => {
  it('compares dotted builds numerically', () => {
    expect(cmpBuild('2.10.0', '2.9.3')).toBe(1)
    expect(cmpBuild('2.1', '2.1.0')).toBe(0)
    expect(cmpBuild('2.1.0', '2.2.0')).toBe(-1)
    expect(cmpBuild('', '2.2.0')).toBe(-1)
  })
})

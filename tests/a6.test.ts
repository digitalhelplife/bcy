import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { SCENES } from '../src/shared/content'
import { activeEvent, EVENTS } from '../src/shared/events'
import { applyPlantCare, CARE_GOAL_DAYS, careDays, caredToday, createInitialState } from '../src/shared/rules'
import { TRIAL_MARK, trialMark } from '../src/share/exportShare'
import { DEFAULT_ROUTE } from '../src/share/blogger'
import { TRIAL_ASSETS } from '../src/trial/assetList'
import { finishChallenge, markChallenge, readBest } from '../src/ui/challenge'
import type { PlantId, PlayerState } from '../src/shared/types'

const DAY = 86_400_000
const NOW = Date.parse('2026-10-23T12:00:00+08:00')
const owning = (): PlayerState => { const s = createInitialState(NOW); s.inventory = { ...s.inventory, plant_mint: 1 }; return s }
class MemStorage implements Storage {
  private m = new Map<string, string>()
  get length() { return this.m.size }
  clear() { this.m.clear() }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null }
  key(i: number) { return [...this.m.keys()][i] ?? null }
  removeItem(k: string) { this.m.delete(k) }
  setItem(k: string, v: string) { this.m.set(k, String(v)) }
}

describe('A6-A3c daily care chain', () => {
  test('needs a mature plant of that species', () => {
    expect(() => applyPlantCare(createInitialState(NOW), 'mint' as PlantId, NOW)).toThrow()
  })
  test('once per UTC+8 day, thriving after 3 distinct days, then closed', () => {
    let s = owning()
    const r1 = applyPlantCare(s, 'mint' as PlantId, NOW); s = r1.state
    expect(r1.result).toEqual({ plantId: 'mint', days: 1, thriving: false })
    expect(caredToday(s, 'mint' as PlantId, NOW)).toBe(true)
    expect(() => applyPlantCare(s, 'mint' as PlantId, NOW + 3600_000)).toThrow(/今天已经照料过/)
    s = applyPlantCare(s, 'mint' as PlantId, NOW + DAY).state
    const r3 = applyPlantCare(s, 'mint' as PlantId, NOW + 2 * DAY); s = r3.state
    expect(r3.result.thriving).toBe(true)
    expect(careDays(s, 'mint' as PlantId)).toBe(CARE_GOAL_DAYS)
    expect(() => applyPlantCare(s, 'mint' as PlantId, NOW + 3 * DAY)).toThrow(/长得很好/)
  })
  test('UTC+8 day boundary: 23:59 and 00:01 Beijing time are different days', () => {
    const late = Date.parse('2026-10-23T23:59:00+08:00')
    const s = applyPlantCare(owning(), 'mint' as PlantId, late).state
    expect(() => applyPlantCare(s, 'mint' as PlantId, late + 2 * 60_000)).not.toThrow()
  })
  test('does not touch inventory (no items granted) and bumps revision once', () => {
    const s0 = owning(); const r = applyPlantCare(s0, 'mint' as PlantId, NOW)
    expect(r.state.inventory).toEqual(s0.inventory)
    expect(r.state.stateRevision).toBe(s0.stateRevision + 1)
  })
})

describe('A6-A2 autumn-break event window', () => {
  const ev = EVENTS.find(e => e.eventId === 'autumn_break_2026')!
  test('configured with a verified date source and only real scenes', () => {
    expect(ev).toBeTruthy()
    expect(ev.dateSource.url).toMatch(/^https:\/\/edu\.chengdu\.gov\.cn\//)
    expect(ev.dateNote).toMatch(/以.{0,4}学校通知为准/)
    for (const r of ev.route) expect(SCENES[r.sceneId]).toBeTruthy()
  })
  test('active inside the window, inactive outside', () => {
    expect(activeEvent(Date.parse('2026-10-23T23:00:00+08:00'))).toBeNull()
    expect(activeEvent(Date.parse('2026-10-24T09:00:00+08:00'))?.eventId).toBe('autumn_break_2026')
    expect(activeEvent(Date.parse('2026-11-22T20:00:00+08:00'))?.eventId).toBe('autumn_break_2026')
    expect(activeEvent(Date.parse('2026-11-24T09:00:00+08:00'))).toBeNull()
  })
})

describe('A6-B1 challenge mode timing (local only)', () => {
  test('records time and keeps the best per level', () => {
    const ss = new MemStorage(), ls = new MemStorage()
    markChallenge('r1', 1000, ss)
    const a = finishChallenge('r1', 'dujiangyan_find', 21_000, ss, ls)
    expect(a?.ms).toBe(20_000)
    expect(readBest('dujiangyan_find', ls)).toBe(20_000)
    markChallenge('r2', 1000, ss); finishChallenge('r2', 'dujiangyan_find', 31_000, ss, ls)
    expect(readBest('dujiangyan_find', ls)).toBe(20_000)
    markChallenge('r3', 1000, ss); finishChallenge('r3', 'dujiangyan_find', 13_000, ss, ls)
    expect(readBest('dujiangyan_find', ls)).toBe(12_000)
    // finishing the same run twice does not record again
    expect(finishChallenge('r3', 'dujiangyan_find', 99_000, ss, ls)?.ms).toBe(12_000)
  })
  test('a run that was not started as a challenge yields nothing', () => {
    expect(finishChallenge('nope', 'dujiangyan_find', 5000, new MemStorage(), new MemStorage())).toBeNull()
  })
})

describe('A6-A4a trial mark on exported pictures', () => {
  test('S0/S1 (and missing stage) carry the mark; S2/S3 do not', () => {
    expect(trialMark(undefined)).toBe(TRIAL_MARK)
    expect(trialMark('S0')).toBe(TRIAL_MARK)
    expect(trialMark('s1')).toBe(TRIAL_MARK)
    expect(trialMark('S2')).toBeNull()
    expect(trialMark('S3')).toBeNull()
  })
})

describe('A6-B3 / A1a blogger kit and offline trial', () => {
  test('default route lists the three scenes in order', () => {
    expect(DEFAULT_ROUTE.map(r => r.sceneId)).toEqual(['dujiangyan', 'qingcheng', 'jiezi'])
  })
  test('trial asset list is Dujiangyan-only and includes the V03 background, frame and wordmark', () => {
    expect(TRIAL_ASSETS).toContain(SCENES.dujiangyan.background)
    expect(TRIAL_ASSETS).toContain('brand/brand_wordmark')
    expect(TRIAL_ASSETS.some(p => p.startsWith('share/share_scenic'))).toBe(true)
    for (const id of ['qingcheng', 'jiezi'] as const) expect(TRIAL_ASSETS).not.toContain(SCENES[id].background)
  })
  test('trial entry never imports the network client or auth API', () => {
    const src = readFileSync('src/trial/main.tsx', 'utf8')
    expect(src).not.toMatch(/net\/(gameClient|transport|authApi)/)
  })
})

describe('A6-C3 service worker never touches API traffic', () => {
  const sw = readFileSync('public/sw.js', 'utf8')
  const never = eval(sw.match(/const NEVER = (\[[^\n]+\])/)![1]) as RegExp[]
  test.each(['/v2/rpc/game.bootstrap', '/ws', '/auth/sms/send', '/admin/', '/console/', '/healthcheck', '/demo/x'])('%s is passed through', p => {
    expect(never.some(r => r.test(p))).toBe(true)
  })
  test.each(['/', '/assets/index-abc.js', '/assets/scenes/scene_dujiangyan.webp', '/fonts/x.woff2'])('%s may be cached', p => {
    expect(never.some(r => r.test(p))).toBe(false)
  })
  test('only GET, same-origin, and old caches are deleted on activate', () => {
    expect(sw).toMatch(/req\.method !== 'GET'/)
    expect(sw).toMatch(/url\.origin !== self\.location\.origin/)
    expect(sw).toMatch(/k\.startsWith\(PREFIX\) && k !== CACHE/)
  })
})

import { describe, expect, test } from 'vitest'
import { PLANTS, SEASON_CONFIG, TERM_OCCURRENCES } from '../src/shared/content'
import { applyFinish, autoLayout, createInitialState, seasonView, validateLayout } from '../src/shared/rules'
import { codeFromHex, formatCode, hasProgress, isFreshState, normalizeCode, transferStates, TRANSFER_ALPHABET } from '../src/shared/transfer'
import { dailyNote, termsIcs } from '../src/shared/daily'
import { MAX_STICKERS, normalizeStickers, STICKER_SLOTS } from '../src/share/exportShare'
import type { PlantId, PlayerState } from '../src/shared/types'

const NOW = Date.parse('2026-10-23T12:00:00+08:00')
const fresh = () => createInitialState(NOW)
const withProgress = (): PlayerState => {
  const s = fresh()
  s.levels.dujiangyan_find = { ...s.levels.dujiangyan_find, firstCompletedAtMs: NOW - 1000 }
  s.discoveredPlantIds = ['mint', 'lotus'] as PlantId[]
  s.inventory = { ...s.inventory, plant_mint: 3, plant_lotus: 2, plant_perilla: 1 }
  return s
}

describe('G7 transfer codes', () => {
  test('codes use the unambiguous alphabet and normalise user input', () => {
    const c = codeFromHex('0123456789abcdef0123456789abcdef0123456789abcdef')
    expect(c).toHaveLength(8)
    for (const ch of c) expect(TRANSFER_ALPHABET).toContain(ch)
    expect(normalizeCode(` ${formatCode(c).toLowerCase()} `)).toBe(c)
    expect(normalizeCode('ABCD-EFG')).toBeNull()
    expect(normalizeCode('ABCD-EF0I')).toBeNull() // 0 / I are not in the alphabet
    expect(normalizeCode(42)).toBeNull()
  })
  test('fresh vs progress detection and state move', () => {
    expect(isFreshState(fresh())).toBe(true)
    const src = withProgress()
    src.activeRunId = 'run_old'
    expect(hasProgress(src)).toBe(true)
    const { target, source } = transferStates(src, fresh(), NOW + 1000)
    expect(target.discoveredPlantIds).toEqual(src.discoveredPlantIds)
    expect(isFreshState(source)).toBe(true)
    expect(target.activeRunId).toBeNull()
    expect(source.activeRunId).toBeNull()
    expect(() => applyFinish(source, 'run_old', 'dujiangyan_find', 'plant', NOW + 1001, 'u1')).toThrow(/失效/)
  })
})

describe('G9 one-tap demo layout', () => {
  test('only owned items, never exceeds inventory, always valid', () => {
    const s = withProgress()
    const p = autoLayout(s)
    expect(p.length).toBeGreaterThan(0)
    const used: Record<string, number> = {}
    for (const x of p) used[x.itemId] = (used[x.itemId] ?? 0) + 1
    for (const [id, n] of Object.entries(used)) expect(n).toBeLessThanOrEqual(s.inventory[id] ?? 0)
    expect(new Set(p.map(x => x.instanceId)).size).toBe(p.length)
    expect(() => validateLayout(s, s.garden.paletteId, p)).not.toThrow()
    expect(autoLayout(s)).toEqual(p) // deterministic
  })
  test('empty inventory -> empty layout', () => {
    const s = fresh(); s.inventory = {}
    expect(autoLayout(s)).toEqual([])
  })
})

describe('G10 daily note & calendar', () => {
  test('daily note is stable within a Beijing day and plain text', () => {
    const s = withProgress()
    const a = dailyNote(s, NOW, 'u1')
    expect(dailyNote(s, NOW + 3_600_000, 'u1')).toBe(a)
    expect(a).not.toMatch(/[<>]/)
    expect(a.length).toBeGreaterThan(4)
    expect(dailyNote(fresh(), NOW, 'u1')).toBeTruthy()
  })
  test('ics contains the next verified terms only, all-day, no alarms/urls', () => {
    const { ics, n } = termsIcs(NOW, 6)
    const expected = TERM_OCCURRENCES.filter(o => o.verified && o.atMs > NOW).slice(0, 6)
    expect(n).toBe(expected.length)
    expect(n).toBe(6)
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(6)
    expect(ics).toContain('DTSTART;VALUE=DATE:20261107') // 立冬 2026-11-07 (Beijing date)
    expect(ics).not.toMatch(/VALARM|URL:|ATTENDEE/)
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
  })
})

describe('G12 stickers', () => {
  test('dedupe, unknown ids dropped, max 3', () => {
    const ids = ['mint', 'mint', 'lotus', 'nope', 'perilla', 'chrysanthemum'] as PlantId[]
    expect(normalizeStickers(ids)).toEqual(['mint', 'lotus', 'perilla'])
    expect(MAX_STICKERS).toBe(3)
    expect(normalizeStickers(undefined)).toEqual([])
    expect(Object.keys(PLANTS)).toContain('mint')
  })
  test('sticker slots stay clear of title, caption, photo cards and footer', () => {
    for (const s of STICKER_SLOTS) {
      expect(s.y).toBeGreaterThanOrEqual(254) // below title box (138+116)
      expect(s.y + 2 * s.r).toBeLessThan(730) // above any photo card / caption (1010) / footer (1170)
      expect(s.x).toBeGreaterThanOrEqual(50); expect(s.x + 2 * s.r).toBeLessThanOrEqual(1030)
    }
  })
})

describe('G6 season backfill', () => {
  test('at launch, recently passed verified terms are open; the open set only grows', () => {
    const atLaunch = seasonView(SEASON_CONFIG.epochMs + 1000)
    expect(atLaunch.openTermIds.length).toBeGreaterThanOrEqual(5)
    const later = seasonView(SEASON_CONFIG.epochMs + 40 * 86_400_000)
    for (const t of atLaunch.openTermIds) expect(later.openTermIds).toContain(t)
  })
})

describe('G8 recorded parent-mode voice', async () => {
  const { allVoiceTexts, voiceKey } = await import('../src/ui/voiceTexts')
  const manifest = (await import('../src/ui/voiceManifest.json')).default as Record<string, string>
  const fs = await import('node:fs')
  test('every manifest clip exists on disk and belongs to a current text (no stale audio)', () => {
    const keys = new Set(allVoiceTexts().map(r => voiceKey(r.text)))
    for (const [k, f] of Object.entries(manifest)) {
      expect(keys.has(k), `stale clip ${f}`).toBe(true)
      expect(fs.existsSync(`public/assets/voice/${f}`), f).toBe(true)
    }
  })
  test('all current child-facing lines are recorded (re-run `pnpm voice` after wording changes)', () => {
    const missing = allVoiceTexts().filter(r => !manifest[voiceKey(r.text)]).map(r => r.id)
    expect(missing).toEqual([])
  })
  test('voiceKey is stable and text-sensitive', () => {
    expect(voiceKey('找一找')).toBe(voiceKey('找一找'))
    expect(voiceKey('找一找')).not.toBe(voiceKey('找一找。'))
  })
})

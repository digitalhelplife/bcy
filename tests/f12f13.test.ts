import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { DEFAULT_CROP, PHOTO_RECTS, placement } from '../src/share/photo'
import trip from '../content/trip_cards.json'

describe('F13 photo crop geometry', () => {
  const r = PHOTO_RECTS.share_scenic
  it('default crop covers the rect and is centred', () => {
    const p = placement({ width: 4000, height: 3000 }, r, DEFAULT_CROP)
    expect(p.h).toBeCloseTo(r.h); expect(p.w).toBeGreaterThanOrEqual(r.w)
    expect(p.x).toBeCloseTo((r.w - p.w) / 2); expect(p.y).toBeCloseTo(0)
  })
  it('pan is clamped so the photo always covers the rect', () => {
    for (const c of [{ zoom: 1, ox: 5, oy: -5 }, { zoom: 3, ox: -1, oy: 1 }, { zoom: 0.2, ox: 1, oy: 1 }]) {
      const p = placement({ width: 1200, height: 3000 }, PHOTO_RECTS.share_plant, c)
      expect(p.x).toBeLessThanOrEqual(1e-6); expect(p.y).toBeLessThanOrEqual(1e-6)
      expect(p.x + p.w).toBeGreaterThanOrEqual(PHOTO_RECTS.share_plant.w - 1e-6)
      expect(p.y + p.h).toBeGreaterThanOrEqual(PHOTO_RECTS.share_plant.h - 1e-6)
    }
  })
  it('photo rects stay inside the canvas opening and above the footer', () => {
    for (const q of Object.values(PHOTO_RECTS)) {
      expect(q.x - 8).toBeGreaterThanOrEqual(50); expect(q.x + q.w + 8).toBeLessThanOrEqual(1030)
      expect(q.y - 8).toBeGreaterThanOrEqual(250); expect(q.y + q.h + 8).toBeLessThanOrEqual(1170)
    }
  })
  it('photo module never touches network or storage APIs', () => {
    const src = readFileSync('src/share/photo.ts', 'utf8') + readFileSync('src/ui/screens/PhotoComposer.tsx', 'utf8')
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    for (const w of ['fetch(', 'XMLHttpRequest', 'localStorage', 'sessionStorage', 'indexedDB', 'sendBeacon', 'track(', 'rpc(']) expect(code).not.toContain(w)
  })
})

describe('F12 trip cards', () => {
  const FIELDS = ['suggestedDuration', 'walkingIntensity', 'strollerNote', 'suitableSeasons', 'parentReminder']
  it('every displayed field has resolvable sourceRefs and verifiedAt', () => {
    for (const c of trip.items as any[]) {
      const ids = new Set(c.sourceRefs.map((s: any) => s.id))
      for (const k of FIELDS) {
        const f = c[k]; if (!f?.display) continue
        expect(f.verifiedAt, `${c.sceneId}.${k}`).toMatch(/^\d{4}-\d{2}-\d{2}$/)
        expect(f.sourceRefs.length).toBeGreaterThan(0)
        for (const r of f.sourceRefs) expect(ids.has(r), `${c.sceneId}.${k} -> ${r}`).toBe(true)
        expect(f.value).not.toMatch(/待核实|票价|门票|开放时间|车程|预约|导航|天气|https?:/)
      }
      expect(c.officialChannelName).not.toMatch(/https?:|www\./)
    }
  })
  it('build gate rejects a displayed field without a source (mutation)', () => {
    const script = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location('bc', 'scripts/build-content.py'); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
cards = json.load(open('content/trip_cards.json'))['items']
m.validate_trip_cards(cards)  # current content passes
bad = json.loads(json.dumps(cards)); bad[0]['walkingIntensity'] = {'value': '低', 'sourceRefs': [], 'verifiedAt': '', 'display': True}
try:
    m.validate_trip_cards(bad); print('NOT_BLOCKED')
except SystemExit as e: print('BLOCKED', 'sourceRefs' in str(e))
bad2 = json.loads(json.dumps(cards)); bad2[2]['strollerNote']['value'] = '门票 80 元'
try:
    m.validate_trip_cards(bad2); print('NOT_BLOCKED')
except SystemExit as e: print('BLOCKED', '门票' in str(e))
`
    const out = execFileSync('python3', ['-c', script], { encoding: 'utf8' }).trim().split('\n')
    expect(out).toEqual(['BLOCKED True', 'BLOCKED True'])
  })
})

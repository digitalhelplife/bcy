import { describe, expect, it } from 'vitest'
import { LEVELS, SCENES } from '../src/shared/content'
import { PARENT_HIT_SCALE, hitRadius, pickTarget } from '../src/phaser/scenes/findHit'
import { levelTips } from '../src/ui/screens/ParentTips'
import type { LevelId } from '../src/shared/types'

const djy = SCENES.dujiangyan.targets

describe('F14 parent mode hit radius (client only)', () => {
  it('scale is exactly 1.3', () => {
    expect(PARENT_HIT_SCALE).toBe(1.3)
    expect(hitRadius(100, true)).toBeCloseTo(130)
    expect(hitRadius(100, false)).toBe(100)
  })
  it('a tap at 1.15 r hits only in parent mode; beyond 1.3 r never hits', () => {
    const t = djy.find(x => x.targetId === 'target_yuzui')!
    const at = (k: number) => [t.hit.x - t.hit.r * k, t.hit.y] as const
    expect(pickTarget(djy, ...at(1.15), false)).toBeNull()
    expect(pickTarget(djy, ...at(1.15), true)).toBe('target_yuzui')
    expect(pickTarget(djy, ...at(1.32), true)).toBeNull()
    expect(pickTarget(djy, ...at(0.5), false)).toBe('target_yuzui')
  })
  it('overlapping enlarged radii resolve to the nearest target', () => {
    const a = djy.find(x => x.targetId === 'target_feishayan')!, b = djy.find(x => x.targetId === 'target_baopingkou')!
    // a point slightly nearer to 飞沙堰 inside both enlarged circles
    const x = a.hit.x + (b.hit.x - a.hit.x) * 0.45, y = a.hit.y + (b.hit.y - a.hit.y) * 0.45
    expect(pickTarget(djy, x, y, true)).toBe('target_feishayan')
  })
  it('targets and proof shape are identical with or without parent mode', () => {
    // pickTarget only returns configured target IDs; FindProof is built from those IDs + fog gate (FindScene.complete).
    for (const sc of Object.values(SCENES)) for (const t of sc.targets) {
      expect(pickTarget(sc.targets, t.hit.x, t.hit.y, true)).toBe(t.targetId)
      expect(pickTarget(sc.targets, t.hit.x, t.hit.y, false)).toBe(t.targetId)
    }
  })
})

describe('F14 讲给孩子听 content', () => {
  it('every level has tips (3 per find level, 1 per puzzle), each ≤ 40 characters', () => {
    for (const id of Object.keys(LEVELS) as LevelId[]) {
      const rows = levelTips(id)
      expect(rows.length, id).toBe(LEVELS[id].kind === 'find' ? 3 : 1)
      for (const r of rows) expect([...r.tip.childText].length, r.title).toBeLessThanOrEqual(40)
    }
  })
})

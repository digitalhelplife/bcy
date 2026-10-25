import { describe, expect, it } from 'vitest'
import { LocalDemoServer } from '../src/net/localDemoServer'
import { CONFIG_VERSION, puzzlePieces } from '../src/shared/content'
import { createInitialState, dayKeyUtc8, validateLayout, isSceneOpen } from '../src/shared/rules'
import type { LevelId, PlayerState, Proof, Route, RpcResponse } from '../src/shared/types'
import { shuffledOrder } from '../src/phaser/scenes/puzzleOrder'

class MemStorage implements Storage {
  private m = new Map<string, string>()
  get length() { return this.m.size }
  clear() { this.m.clear() }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null }
  key(i: number) { return [...this.m.keys()][i] ?? null }
  removeItem(k: string) { this.m.delete(k) }
  setItem(k: string, v: string) { this.m.set(k, String(v)) }
}

const T0 = Date.UTC(2026, 9, 21, 2, 0, 0) // 10:00 Beijing
function setup(start = T0) {
  let now = start
  const server = new LocalDemoServer({ userId: 'u1', storage: new MemStorage(), latencyMs: 0, now: () => now })
  const call = <T = any>(name: Parameters<LocalDemoServer['handle']>[0], body: unknown) => server.handle(name, body) as RpcResponse<T>
  let state: PlayerState = (call('game.bootstrap', { apiVersion: 1, payload: { clientBuild: 't' } }) as any).data.state
  const write = <T = any>(name: Parameters<LocalDemoServer["handle"]>[0], payload: unknown, requestId: string = crypto.randomUUID(), rev?: number): any => {
    const r = call<T>(name, { apiVersion: 1, requestId, expectedStateRevision: rev ?? state.stateRevision, payload })
    if (r.ok && (r.data as any).state) state = (r.data as any).state
    return r
  }
  const proofFor = (levelId: LevelId): Proof => levelId.endsWith('find')
    ? { kind: 'find', foundTargetIds: ({ dujiangyan: ['target_yuzui', 'target_feishayan', 'target_baopingkou'], qingcheng: ['target_jianfu_eave', 'target_cloud_plaque', 'target_paper_boat'], jiezi: ['target_ziku_bell', 'target_ginkgo_leaf', 'target_old_door'] } as any)[levelId.split('_')[0]], gates: levelId === 'dujiangyan_find' ? { fog_revealed: true } : {} }
    : { kind: 'puzzle', slots: puzzlePieces(levelId).map(p => ({ pieceId: p.pieceId, slotIndex: p.slotIndex })) }
  const play = (levelId: LevelId, route: Route) => {
    const s = write<any>('game.run.start', { levelId, route })
    if (!s.ok) return s
    return write<any>('game.run.finish', { runId: s.data.result.run.runId, proof: proofFor(levelId) })
  }
  return { server, call, write, play, proofFor, get state() { return state }, tick: (ms: number) => { now += ms }, get now() { return now } }
}

describe('UTC+8 day key', () => {
  it('rolls over at Beijing midnight', () => {
    expect(dayKeyUtc8(Date.UTC(2026, 9, 21, 15, 59, 59))).toBe('2026-10-21')
    expect(dayKeyUtc8(Date.UTC(2026, 9, 21, 16, 0, 0))).toBe('2026-10-22')
  })
})

describe('initial state and unlocks (T01/T05)', () => {
  it('starts with bench + clay pot and only Dujiangyan open', () => {
    const s = createInitialState(T0)
    expect(s.inventory).toEqual({ decor_bench: 1, decor_clay_pot: 1 })
    expect(isSceneOpen(s, 'dujiangyan')).toBe(true)
    expect(isSceneOpen(s, 'qingcheng')).toBe(false)
  })
  it('rejects locked scene starts and unlocks Qingcheng + warm_wood after both Dujiangyan levels', () => {
    const g = setup()
    const locked = g.write('game.run.start', { levelId: 'qingcheng_find', route: 'plant' })
    expect(locked.ok).toBe(false); if (!locked.ok) expect(locked.error.code).toBe('SCENE_LOCKED')
    const a = g.play('dujiangyan_find', 'plant') as any
    expect(a.data.result.newlyDiscoveredPlantId).toBe('mint')
    expect(a.data.result.grants).toEqual([{ itemId: 'seed_mint', quantity: 2 }])
    const b = g.play('dujiangyan_puzzle', 'decor') as any
    expect(b.data.result.grants).toEqual([{ itemId: 'decor_bench', quantity: 1 }])
    expect(b.data.result.newlyUnlockedSceneIds).toEqual(['qingcheng'])
    expect(b.data.result.newlyUnlockedPaletteIds).toEqual(['warm_wood'])
    expect(b.data.result.newlyUnlockedStoryIds).toContain('story_dujiangyan')
  })
})

describe('route rewards and daily repeat limit (T03/T04)', () => {
  it('pays each route first reward once, then repeat rewards up to 3 per day, then zero', () => {
    const g = setup()
    g.play('dujiangyan_find', 'plant'); g.play('dujiangyan_find', 'decor')
    expect(g.state.inventory.decor_wood_planter).toBe(1)
    const r1 = g.play('dujiangyan_find', 'decor') as any
    expect(r1.data.result.rewardMode).toBe('repeat')
    expect(r1.data.result.grants).toEqual([{ itemId: 'decor_clay_pot', quantity: 1 }]) // rotation: second item
    const r2 = g.play('dujiangyan_find', 'decor') as any
    expect(r2.data.result.grants).toEqual([{ itemId: 'decor_wood_planter', quantity: 1 }])
    const r3 = g.play('dujiangyan_find', 'plant') as any
    expect(r3.data.result.grants).toHaveLength(1)
    expect(r3.data.result.grants[0].quantity).toBe(1)
    expect(r3.data.result.grants[0].itemId.startsWith('seed_')).toBe(true)
    g.tick(61_000)
    const r4 = g.play('dujiangyan_find', 'plant') as any
    expect(r4.ok).toBe(true)
    expect(r4.data.result.rewardMode).toBe('none')
    expect(r4.data.result.reason).toBe('DAILY_REPEAT_LIMIT')
    g.tick(16 * 3_600_000)
    const r5 = g.play('dujiangyan_find', 'plant') as any
    expect(r5.data.result.rewardMode).toBe('repeat')
  })
})

describe('run lifecycle and idempotency (T02/T06/T10/T11)', () => {
  it('allows only one active run and supports cancel', () => {
    const g = setup()
    const a = g.write<any>('game.run.start', { levelId: 'dujiangyan_find', route: 'plant' })
    const b = g.write('game.run.start', { levelId: 'dujiangyan_puzzle', route: 'plant' })
    expect(b.ok).toBe(false); if (!b.ok) expect(b.error.code).toBe('ACTIVE_RUN_EXISTS')
    const runId = (a as any).data.result.run.runId
    expect(g.write('game.run.cancel', { runId }).ok).toBe(true)
    const f = g.write('game.run.finish', { runId, proof: g.proofFor('dujiangyan_find') })
    expect(f.ok).toBe(false); if (!f.ok) expect(f.error.code).toBe('RUN_CANCELLED')
  })
  it('replays the same requestId without double rewards and rejects a reused key with a different body', () => {
    const g = setup()
    const s = g.write<any>('game.run.start', { levelId: 'dujiangyan_find', route: 'plant' })
    const runId = s.data!.result.run.runId
    const rid = crypto.randomUUID(); const rev = g.state.stateRevision
    const first = g.write<any>('game.run.finish', { runId, proof: g.proofFor('dujiangyan_find') }, rid, rev)
    const again = g.write<any>('game.run.finish', { runId, proof: g.proofFor('dujiangyan_find') }, rid, rev)
    expect(again.ok && again.replayed).toBe(true)
    expect(again.ok && again.data.result).toEqual(first.ok && first.data.result)
    expect(g.state.inventory.seed_mint).toBe(2)
    const reused = g.write('game.run.cancel', { runId }, rid, rev)
    expect(reused.ok).toBe(false); if (!reused.ok) expect(reused.error.code).toBe('IDEMPOTENCY_KEY_REUSED')
    const status = g.call<any>('game.request.status', { apiVersion: 1, payload: { requestId: rid } })
    expect(status.ok && status.data.status).toBe('FOUND')
  })
  it('a finished run returns its original settlement even with a fresh requestId and stale revision', () => {
    const g = setup()
    const s = g.write<any>('game.run.start', { levelId: 'dujiangyan_find', route: 'plant' })
    const runId = s.data!.result.run.runId
    const first = g.write<any>('game.run.finish', { runId, proof: g.proofFor('dujiangyan_find') })
    const again = g.write<any>('game.run.finish', { runId, proof: g.proofFor('dujiangyan_find') }, crypto.randomUUID(), 1)
    expect(again.ok && again.data.result).toEqual(first.ok && first.data.result)
    expect(g.state.inventory.seed_mint).toBe(2)
  })
  it('rejects stale revisions, wrong proofs and expired runs', () => {
    const g = setup()
    const s = g.write<any>('game.run.start', { levelId: 'dujiangyan_find', route: 'plant' })
    const runId = s.data!.result.run.runId
    const stale = g.write('game.plant.start', { plotId: 'plot_2', seedItemId: 'seed_mint' }, undefined, 1)
    expect(!stale.ok && stale.error.code).toBe('STATE_CONFLICT')
    const noFog = g.write('game.run.finish', { runId, proof: { kind: 'find', foundTargetIds: ['target_yuzui', 'target_feishayan', 'target_baopingkou'], gates: {} } })
    expect(!noFog.ok && noFog.error.code).toBe('INVALID_PROOF')
    const wrongPuzzle = g.write('game.run.finish', { runId, proof: g.proofFor('dujiangyan_puzzle') })
    expect(!wrongPuzzle.ok && wrongPuzzle.error.code).toBe('INVALID_PROOF')
    g.tick(1_800_001)
    const exp = g.write('game.run.finish', { runId, proof: g.proofFor('dujiangyan_find') })
    expect(!exp.ok && exp.error.code).toBe('RUN_EXPIRED')
    expect(g.write('game.run.start', { levelId: 'dujiangyan_find', route: 'plant' }).ok).toBe(true)
  })
  it('rate-limits run.start to 6 per minute', () => {
    const g = setup()
    for (let i = 0; i < 6; i++) {
      const s = g.write<any>('game.run.start', { levelId: 'dujiangyan_find', route: 'plant' })
      expect(s.ok).toBe(true)
      g.write('game.run.cancel', { runId: s.data!.result.run.runId })
    }
    const r = g.write('game.run.start', { levelId: 'dujiangyan_find', route: 'plant' })
    expect(!r.ok && r.error.code).toBe('RATE_LIMITED')
  })
  it('runs carry the content config version', () => {
    const g = setup()
    const s = g.write<any>('game.run.start', { levelId: 'dujiangyan_puzzle', route: 'decor' })
    expect(s.data!.result.run.configVersion).toBe(CONFIG_VERSION)
  })
})

describe('planting and tutorial (T07/T08/T09)', () => {
  it('instant-grows the first tutorial mint once, then normal 300s growth', () => {
    const g = setup()
    g.play('dujiangyan_find', 'plant')
    expect(g.state.tutorialStage).toBe('plant')
    const p = g.write<any>('game.plant.start', { plotId: 'plot_1', seedItemId: 'seed_mint' })
    expect(p.data!.result.tutorialInstant).toBe(true)
    expect(g.state.tutorialStage).toBe('collect')
    const c = g.write<any>('game.plant.claim', { plotId: 'plot_1', plantingId: p.data!.result.planting.plantingId })
    expect(c.data!.result.grants).toEqual([{ itemId: 'plant_mint', quantity: 1 }])
    expect(g.state.tutorialStage).toBe('decorate')
    const p2 = g.write<any>('game.plant.start', { plotId: 'plot_1', seedItemId: 'seed_mint' })
    expect(p2.data!.result.tutorialInstant).toBe(false)
    const early = g.write('game.plant.claim', { plotId: 'plot_1', plantingId: p2.data!.result.planting.plantingId })
    expect(!early.ok && early.error.code).toBe('PLANT_NOT_READY')
    g.tick(300_000)
    expect(g.write('game.plant.claim', { plotId: 'plot_1', plantingId: p2.data!.result.planting.plantingId }).ok).toBe(true)
    const none = g.write('game.plant.start', { plotId: 'plot_2', seedItemId: 'seed_mint' })
    expect(!none.ok && none.error.code).toBe('INSUFFICIENT_ITEM')
    const save = g.write('game.garden.save', { paletteId: 'green', placements: [{ instanceId: 'a1', itemId: 'plant_mint', x: 0, y: 0 }] })
    expect(save.ok).toBe(true)
    expect(g.state.tutorialStage).toBe('complete')
  })
  it('skip tutorial is idempotent', () => {
    const g = setup()
    expect(g.write('game.tutorial.skip', {}).ok).toBe(true)
    const again = g.write('game.tutorial.skip', {}, undefined, 1)
    expect(again.ok && again.replayed).toBe(true)
  })
})

describe('garden layout validation (T12/T13)', () => {
  const s = createInitialState(T0)
  const bad = (placements: any[], palette: any = 'green') => { try { validateLayout(s, palette, placements); return null } catch (e: any) { return e.code } }
  it('accepts the gift items and rejects overlap, out-of-bounds, over-placement, duplicates and locked palette', () => {
    expect(bad([{ instanceId: 'a', itemId: 'decor_bench', x: 0, y: 0 }, { instanceId: 'b', itemId: 'decor_clay_pot', x: 2, y: 0 }])).toBeNull()
    expect(bad([{ instanceId: 'a', itemId: 'decor_bench', x: 0, y: 0 }, { instanceId: 'b', itemId: 'decor_clay_pot', x: 1, y: 0 }])).toBe('LAYOUT_OVERLAP')
    expect(bad([{ instanceId: 'a', itemId: 'decor_bench', x: 7, y: 0 }])).toBe('LAYOUT_OUT_OF_BOUNDS')
    expect(bad([{ instanceId: 'a', itemId: 'decor_clay_pot', x: 0, y: 0 }, { instanceId: 'b', itemId: 'decor_clay_pot', x: 3, y: 3 }])).toBe('ITEM_OVERPLACED')
    expect(bad([{ instanceId: 'a', itemId: 'decor_clay_pot', x: 0, y: 0 }, { instanceId: 'a', itemId: 'decor_bench', x: 3, y: 3 }])).toBe('INVALID_LAYOUT')
    expect(bad([{ instanceId: 'a', itemId: 'decor_gate', x: 0, y: 0 }])).toBe('ITEM_OVERPLACED')
    expect(bad([], 'warm_wood')).toBe('PALETTE_LOCKED')
    expect(bad([{ instanceId: 'a', itemId: 'seed_mint', x: 0, y: 0 }])).toBe('UNKNOWN_ITEM')
  })
})

describe('puzzle shuffle', () => {
  it('is deterministic per seed and never the identity order', () => {
    expect(shuffledOrder(6, 42)).toEqual(shuffledOrder(6, 42))
    for (let seed = 0; seed < 200; seed++) expect(shuffledOrder(4, seed)).not.toEqual([0, 1, 2, 3])
  })
})

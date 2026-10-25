import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PLANT_IDS, SEASON_CONFIG, TERMS, TERM_OCCURRENCES, CRAFTS, VISITORS } from '../src/shared/content'
import {
  applyChallengeMark, applyCraftMake, applyGardenSave, applyObserveRecord, applyPlantStart, applyQuizComplete, applySeasonClaim,
  createInitialState, isPlotOpen, matchRecipe, migrateState, pickSeedPlant, quizFor, reachedStage, seasonView, TELEMETRY_EVENTS, validateFeedback, validateTelemetry,
} from '../src/shared/rules'
import type { PlantId, PlayerState } from '../src/shared/types'

const code = (fn: () => unknown) => { try { fn(); return 'OK' } catch (e) { return (e as { code?: string }).code ?? String(e) } }
const verified = TERM_OCCURRENCES.filter(o => o.verified)
const firstTerm = verified.find(o => o.atMs > SEASON_CONFIG.epochMs)!

describe('v2.1 content volume', () => {
  it('ships 24 plants, one per solar term, 6 base level plants', () => {
    expect(PLANT_IDS).toHaveLength(24)
    expect(Object.keys(TERMS)).toHaveLength(24)
    expect(new Set(Object.values(TERMS).map(t => t.plantId)).size).toBe(24)
    for (const id of PLANT_IDS) expect(quizFor(id)?.questions.length).toBe(3)
  })
})

describe('solar-term calendar (T41)', () => {
  it('opens only verified terms that have arrived, plus the launch pre-open', () => {
    const before = seasonView(SEASON_CONFIG.epochMs - 1)
    const at = seasonView(SEASON_CONFIG.epochMs)
    expect(at.openTermIds.length).toBeGreaterThanOrEqual(before.openTermIds.length)
    expect(at.openTermIds).toContain(firstTerm.termId)
    expect(at.openPlantIds.length).toBeGreaterThanOrEqual(6)
  })
  it('season letter grants 2 seeds once; challenge mark once; locked terms rejected', () => {
    const now = SEASON_CONFIG.epochMs + 1000
    const s0 = createInitialState(now)
    const t = firstTerm.termId
    const r = applySeasonClaim(s0, t, now)
    expect(r.result.grants).toEqual([{ itemId: `seed_${TERMS[t].plantId}`, quantity: 2 }])
    expect(r.state.discoveredPlantIds).toContain(TERMS[t].plantId)
    expect(code(() => applySeasonClaim(r.state, t, now))).toBe('ALREADY_CLAIMED')
    const locked = Object.keys(TERMS).find(id => !seasonView(now).openTermIds.includes(id as never))
    if (locked) expect(code(() => applySeasonClaim(s0, locked as never, now))).toBe('TERM_NOT_OPEN')
    const m = applyChallengeMark(s0, t, now)
    expect(m.state.season.challenges).toEqual([t])
    expect(code(() => applyChallengeMark(m.state, t, now))).toBe('ALREADY_CLAIMED')
  })
})

describe('repeat seeds prefer undiscovered open plants (D23)', () => {
  it('is deterministic per key and never returns a closed plant', () => {
    const now = SEASON_CONFIG.epochMs + 1000
    const s = createInitialState(now)
    const open = seasonView(now).openPlantIds
    const a = pickSeedPlant(s, now, 'u:r1', 'mint'); const b = pickSeedPlant(s, now, 'u:r1', 'mint')
    expect(a).toBe(b)
    expect(open).toContain(a)
    expect(s.discoveredPlantIds).not.toContain(a)
  })
})

function withPlants(now: number, ids: PlantId[], n = 1): PlayerState {
  const s = createInitialState(now)
  for (const id of ids) { s.inventory[`plant_${id}`] = n; if (!s.discoveredPlantIds.includes(id)) s.discoveredPlantIds.push(id) }
  return s
}

describe('growth observation (T42)', () => {
  it('records stages only after they are reached, once each', () => {
    const now = 1_000_000
    const s0 = createInitialState(now); s0.inventory.seed_mint = 1
    const st = applyPlantStart(s0, 'plot_2', 'seed_mint', now, 'p1').state
    const pl = st.plots.find(p => p.plotId === 'plot_2')!.planting!
    expect(reachedStage(pl, now)).toBe(0)
    expect(code(() => applyObserveRecord(st, 'p1', 2, now))).toBe('STAGE_NOT_REACHED')
    const a = applyObserveRecord(st, 'p1', 0, now)
    expect(code(() => applyObserveRecord(a.state, 'p1', 0, now))).toBe('ALREADY_CLAIMED')
    const late = pl.readyAtMs
    let s = a.state
    for (const k of [1, 2, 3]) s = applyObserveRecord(s, 'p1', k, late).state
    expect(s.observations.mint).toEqual([0, 1, 2, 3])
  })
})

describe('plant quiz stamps (T43)', () => {
  it('requires discovery and all-correct answers; stamps once', () => {
    const s0 = createInitialState(0)
    const q = quizFor('mint')!
    const right = q.questions.map(x => x.answer)
    expect(code(() => applyQuizComplete(s0, 'mint', right))).toBe('INVALID_PAYLOAD')
    const s1 = { ...s0, discoveredPlantIds: ['mint' as PlantId] }
    const wrong = right.map((a, i) => i === 0 ? (a + 1) % q.questions[0].options.length : a)
    expect(code(() => applyQuizComplete(s1, 'mint', wrong))).toBe('QUIZ_WRONG_ANSWER')
    const ok = applyQuizComplete(s1, 'mint', right)
    expect(ok.state.quizStamps).toEqual(['mint'])
    expect(code(() => applyQuizComplete(ok.state, 'mint', right))).toBe('ALREADY_CLAIMED')
  })
})

describe('crafting (T44)', () => {
  it('consumes only unplaced plants and grants the keepsake', () => {
    const now = SEASON_CONFIG.epochMs + 1000
    const recipe = Object.values(CRAFTS).find(r => r.inputs.every(i => i.tag === 'flowering'))!
    const flowering = PLANT_IDS.filter(id => matchRecipe(recipe, Array(recipe.inputs[0].count).fill(id)))[0]
    const s = withPlants(now, [flowering], recipe.inputs[0].count)
    const r = applyCraftMake(s, recipe.recipeId, [{ itemId: `plant_${flowering}`, quantity: recipe.inputs[0].count }], now)
    expect(r.state.inventory[recipe.outputItemId]).toBe(1)
    expect(r.state.inventory[`plant_${flowering}`]).toBe(0)
    const placed = { ...s, garden: { ...s.garden, placements: [{ instanceId: 'i1', itemId: `plant_${flowering}`, x: 0, y: 0 }] } }
    expect(code(() => applyCraftMake(placed, recipe.recipeId, [{ itemId: `plant_${flowering}`, quantity: recipe.inputs[0].count }], now))).toBe('INSUFFICIENT_ITEM')
    expect(code(() => applyCraftMake(s, recipe.recipeId, [{ itemId: 'decor_bench', quantity: 1 }], now))).toBe('INVALID_PAYLOAD')
  })
})

describe('visitors, sets and plot unlocks (T45/T46)', () => {
  it('a visitor arrives once when its condition is met on save', () => {
    const v = Object.values(VISITORS).find(x => x.condition.minPlants && Object.keys(x.condition).length === 1)!
    const ids = PLANT_IDS.slice(0, v.condition.minPlants!)
    const s = withPlants(0, ids)
    const placements = ids.map((id, i) => ({ instanceId: `i${i}`, itemId: `plant_${id}`, x: i, y: 0 }))
    const r = applyGardenSave(s, 'green', placements, 0, 'u1')
    expect(r.result.newVisitors.map(x => x.visitorId)).toContain(v.visitorId)
    const again = applyGardenSave(r.state, 'green', placements, 0, 'u1')
    expect(again.result.newVisitors.map(x => x.visitorId)).not.toContain(v.visitorId)
  })
  it('plot_7 opens at 12 discovered plants, plot_8 at 18', () => {
    const s = createInitialState(0)
    s.discoveredPlantIds = PLANT_IDS.slice(0, 11)
    expect(isPlotOpen(s, 'plot_7')).toBe(false)
    s.discoveredPlantIds = PLANT_IDS.slice(0, 12)
    expect(isPlotOpen(s, 'plot_7')).toBe(true); expect(isPlotOpen(s, 'plot_8')).toBe(false)
    s.discoveredPlantIds = PLANT_IDS.slice(0, 18)
    expect(isPlotOpen(s, 'plot_8')).toBe(true)
  })
})

describe('save migration and compliance validators (T47/T50)', () => {
  it('migrates a v2.0 save without losing inventory', () => {
    const old = createInitialState(0) as unknown as Record<string, unknown>
    for (const k of ['observations', 'quizStamps', 'season', 'visitors', 'unlockedSetIds', 'consent']) delete old[k]
    old.plots = (old.plots as unknown[]).slice(0, 6)
    old.schemaVersion = 2
    const { state, changed } = migrateState(old)
    expect(changed).toBe(true)
    expect(state.plots).toHaveLength(8)
    expect(state.inventory.decor_bench).toBe(1)
    expect(state.consent.telemetry).toBe(false)
  })
  it('validates telemetry opt-in, event/field whitelist and A6 events', () => {
    const s = createInitialState(0)
    expect(code(() => validateTelemetry(s, [{ eventName: 'app_open', fields: {} }]))).not.toBe('OK')
    const on = { ...s, consent: { ...s.consent, telemetry: true } }
    expect(code(() => validateTelemetry(on, [{ eventName: 'app_open', fields: {} }]))).toBe('OK')
    expect(code(() => validateTelemetry(on, [{ eventName: 'screen_view', fields: {} }]))).not.toBe('OK')
    expect(code(() => validateTelemetry(on, [{ eventName: 'plant_card_view', fields: { plantId: 'mint', phone: '1' } }]))).not.toBe('OK')
    const a6 = [
      { eventName: 'plant_care', fields: { plantId: 'mint', days: 1 } },
      { eventName: 'kid_age', fields: { age: '7-12' } },
      { eventName: 'field_tick', fields: { on: true } },
      { eventName: 'blogger_carousel', fields: { n: 4 } },
      { eventName: 'blogger_video', fields: {} },
    ]
    expect(code(() => validateTelemetry(on, a6))).toBe('OK')
    expect(code(() => validateTelemetry(on, [{ eventName: 'kid_age', fields: { age: '13-15' } }]))).not.toBe('OK')
    expect(code(() => validateTelemetry(on, [{ eventName: 'plant_care', fields: { plantId: 'mint' } }]))).not.toBe('OK')
    const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
      .flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)])
    const emitted = new Set<string>()
    for (const f of walk('src').filter(f => /\.(ts|tsx)$/.test(f))) {
      for (const m of readFileSync(f, 'utf8').matchAll(/\.track\('([a-z_]+)'/g)) emitted.add(m[1])
    }
    expect([...emitted].filter(e => !TELEMETRY_EVENTS[e])).toEqual([])
  })
  it('feedback trims, limits to 500 code points and rejects control characters', () => {
    expect(validateFeedback('  好玩  ', '').text).toBe('好玩')
    expect(code(() => validateFeedback('', ''))).not.toBe('OK')
    expect(code(() => validateFeedback('字'.repeat(501), ''))).not.toBe('OK')
    expect(code(() => validateFeedback('a\u202Eb', ''))).not.toBe('OK')
  })
})

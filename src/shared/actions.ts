// Single dispatcher for every PlayerState-only write RPC. The local demo server and the Nakama
// module both call this, so behaviour cannot drift. run.* (needs run records + rate limits) and
// side writes (feedback/telemetry/heartbeat/account.delete) stay in each storage adapter.
import { PLOT_IDS } from './content'
import { applyPlantCare,
  RuleError, applyChallengeMark, applyConsentUpdate, applyCraftMake, applyGardenSave, applyObserveRecord,
  applyParentMode, applyPlantClaim, applyPlantStart, applyQuizComplete, applySeasonClaim, clone,
} from './rules'
import type { Grant, PaletteId, Placement, PlayerState, PlotId, RpcName } from './types'

export type ActionCtx = { nowMs: number; userId: string; uuid: () => string }
export type ActionOut = { state: PlayerState; result: unknown; replayed?: boolean }
const bad = (m: string): never => { throw new RuleError('INVALID_PAYLOAD', m) }
const plotOf = (v: unknown): PlotId => (PLOT_IDS.indexOf(v as PlotId) >= 0 ? (v as PlotId) : bad('种植槽无效'))
const str = (v: unknown, max = 64): string => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : bad('参数格式错误'))

export const STATE_ACTIONS: ReadonlySet<RpcName> = new Set<RpcName>([
  'game.plant.start', 'game.plant.claim', 'game.garden.save', 'game.tutorial.skip', 'game.settings.update', 'game.consent.update',
  'game.season.claim', 'game.observe.record', 'game.quiz.complete', 'game.craft.make', 'game.challenge.mark', 'game.plant.care',
])

/** No-op replays that must answer before the revision check (06 §4.1 step 7). */
export function preRevisionReplay(name: RpcName, s: PlayerState): ActionOut | null {
  if (name === 'game.tutorial.skip' && s.tutorialSkipped) return { state: s, result: { tutorialSkipped: true }, replayed: true }
  return null
}

export function applyStateAction(name: RpcName, s: PlayerState, p: Record<string, unknown>, ctx: ActionCtx): ActionOut {
  switch (name) {
    case 'game.plant.start': return applyPlantStart(s, plotOf(p.plotId), str(p.seedItemId), ctx.nowMs, ctx.uuid())
    case 'game.plant.claim': return applyPlantClaim(s, plotOf(p.plotId), str(p.plantingId), ctx.nowMs)
    case 'game.garden.save': {
      if (!Array.isArray(p.placements) || (p.placements as unknown[]).length > 200) bad('布局数据无效')
      return applyGardenSave(s, p.paletteId as PaletteId, p.placements as Placement[], ctx.nowMs, ctx.userId)
    }
    case 'game.tutorial.skip': {
      const next = clone(s); next.tutorialSkipped = true; next.stateRevision += 1
      return { state: next, result: { tutorialSkipped: true } }
    }
    case 'game.settings.update': return applyParentMode(s, p.parentMode)
    case 'game.consent.update': return applyConsentUpdate(s, p.privacyVersion, p.telemetry, ctx.nowMs)
    case 'game.season.claim': return applySeasonClaim(s, str(p.termId), ctx.nowMs)
    case 'game.challenge.mark': return applyChallengeMark(s, str(p.termId), ctx.nowMs)
    case 'game.observe.record': return applyObserveRecord(s, str(p.plantingId), p.stage as number, ctx.nowMs)
    case 'game.quiz.complete': return applyQuizComplete(s, str(p.plantId), p.answers as number[])
    case 'game.plant.care': return applyPlantCare(s, str(p.plantId), ctx.nowMs)
    case 'game.craft.make': return applyCraftMake(s, str(p.recipeId), p.inputs as Grant[], ctx.nowMs)
    default: return bad('未知接口')
  }
}

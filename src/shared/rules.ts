import {
  BASE_PLANT_IDS, COMPLIANCE, CONFIG_VERSION, CRAFTS, CRAFT_RULES, GARDEN_LAYOUT, ITEMS, LEVELS, LEVEL_IDS, PALETTES, PLANTS,
  PLANT_IDS, PLOT_IDS, PLOT_UNLOCK, QUIZ_TITLES, RULES, SCENES, SCENE_ORDER, SEASON_CONFIG, SETS, TERMS, TERM_IDS,
  TERM_OCCURRENCES, VISITORS, isPlaceable, isPlantId, puzzlePieces, type CraftDef, type CraftInput, type VisitorCondition,
} from './content'
import quizzesJson from '../../content/quizzes.json'
import type {
  ErrorCode, FinishResult, Grant, LevelId, PaletteId, Placement, PlantId, PlayerState, PlotId, Proof,
  RewardPreview, Route, SceneId, SeasonView, TermId, VisitorArrival,
} from './types'

export class RuleError extends Error {
  constructor(public code: ErrorCode, message: string) { super(message) }
}
const fail = (code: ErrorCode, message: string): never => { throw new RuleError(code, message) }
export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
const uniqPush = <T>(arr: T[], v: T) => { if (arr.indexOf(v) < 0) { arr.push(v); return true } return false }

/** Server calendar day in UTC+8 (YYYY-MM-DD). */
export function dayKeyUtc8(ms: number): string {
  return new Date(ms + 8 * 3_600_000).toISOString().slice(0, 10)
}
/** FNV-1a 32-bit — deterministic picks that are identical on client preview, demo and Nakama. */
export function fnv1a(str: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h >>> 0
}

/* ---------------- state creation & migration ---------------- */
const emptyLevels = () => Object.fromEntries(LEVEL_IDS.map(id => [id, { firstCompletedAtMs: null, firstRouteClaimed: { plant: false, decor: false }, decorRewardCount: 0 }])) as PlayerState['levels']
export function createInitialState(nowMs: number): PlayerState {
  return {
    schemaVersion: 3, contentProfile: 'chengdu_v1', stateRevision: 1, createdAtMs: nowMs,
    tutorialStage: 'explore', tutorialSkipped: false, tutorialGrowUsed: false, tutorialPlantingId: null,
    discoveredPlantIds: [], unlockedStoryIds: [], unlockedPaletteIds: ['green'], unlockedSetIds: [],
    levels: emptyLevels(), inventory: { decor_bench: 1, decor_clay_pot: 1 },
    plots: PLOT_IDS.map(plotId => ({ plotId, planting: null })),
    garden: { paletteId: 'green', placements: [] },
    repeatRewardDayKey: dayKeyUtc8(nowMs), repeatRewardUsed: 0, activeRunId: null,
    consent: { privacyVersion: '', telemetry: false, updatedAtMs: 0 },
    settings: { parentMode: false },
    season: { claimed: [], challenges: [] }, observations: {}, quizStamps: [], visitors: [],
  }
}
/**
 * Server-side migration (06 §3.2 + v2.1): keeps every existing field, only adds defaults.
 * Never grants items, rewrites growth times, resets quotas or touches runs/receipts.
 */
export function migrateState(raw: unknown): { state: PlayerState; changed: boolean } {
  const s = clone(raw) as PlayerState
  if (!s || s.contentProfile !== 'chengdu_v1') fail('INTERNAL_ERROR', '存档格式无法识别')
  if (s.schemaVersion === 3) return { state: s, changed: false }
  if ((s.schemaVersion as number) !== 2) fail('INTERNAL_ERROR', '存档版本过旧，需要人工迁移')
  if (!s.consent) s.consent = { privacyVersion: '', telemetry: false, updatedAtMs: 0 }
  if (!s.settings) s.settings = { parentMode: false }
  if (!s.season) s.season = { claimed: [], challenges: [] }
  if (!s.observations) s.observations = {}
  if (!s.quizStamps) s.quizStamps = []
  if (!s.visitors) s.visitors = []
  for (const plotId of PLOT_IDS) if (!s.plots.some(p => p.plotId === plotId)) s.plots.push({ plotId, planting: null })
  // Old saves discovered plants via level clears only; also count already-owned seeds/plants.
  for (const id of PLANT_IDS) if ((s.inventory[`seed_${id}`] ?? 0) > 0 || (s.inventory[`plant_${id}`] ?? 0) > 0) uniqPush(s.discoveredPlantIds, id)
  s.schemaVersion = 3
  s.stateRevision += 1
  return { state: s, changed: true }
}

/* ---------------- scenes & levels ---------------- */
export const sceneComplete = (s: PlayerState, sceneId: SceneId) => {
  const sc = SCENES[sceneId]
  return s.levels[sc.findLevel].firstCompletedAtMs !== null && s.levels[sc.puzzleLevel].firstCompletedAtMs !== null
}
export function isSceneOpen(s: PlayerState, sceneId: SceneId): boolean {
  const i = SCENE_ORDER.indexOf(sceneId)
  return i === 0 || sceneComplete(s, SCENE_ORDER[i - 1])
}
export const isLevelOpen = (s: PlayerState, levelId: LevelId) => isSceneOpen(s, LEVELS[levelId].sceneId)
/** D11: until the first Dujiangyan find is cleared (and the tutorial is not skipped) only the plant route is offered. */
export const tutorialForcesPlantRoute = (s: PlayerState, levelId: LevelId) =>
  !s.tutorialSkipped && levelId === 'dujiangyan_find' && s.levels.dujiangyan_find.firstCompletedAtMs === null

/* ---------------- season (节气) ---------------- */
/** Which terms are open at `nowMs` (06 v2.1 节气配置). Opening is permanent once reached. */
export function seasonView(nowMs: number): SeasonView {
  const verified = TERM_OCCURRENCES.filter(o => o.verified)
  let open: TermId[]
  if (SEASON_CONFIG.override === 'all') open = TERM_IDS.slice()
  else {
    const set = new Set<TermId>()
    // Lower bound: launch day minus the backfill window (before launch it follows "now", so testers see what players will).
    const fromMs = Math.min(nowMs, SEASON_CONFIG.epochMs) - SEASON_CONFIG.backfillDays * 86400000
    for (const o of verified) if (o.atMs <= nowMs && o.atMs >= fromMs) set.add(o.termId)
    // Pre-open the first N verified terms after the season epoch so launch week is not empty.
    if (nowMs >= SEASON_CONFIG.epochMs) for (const o of verified.filter(o => o.atMs > SEASON_CONFIG.epochMs).slice(0, SEASON_CONFIG.preopenTerms)) set.add(o.termId)
    open = TERM_IDS.filter(t => set.has(t))
  }
  // Display "current" uses every occurrence (verified or computed) — it is a label, not a gate.
  const past = TERM_OCCURRENCES.filter(o => o.atMs <= nowMs)
  const cur = past.length ? past[past.length - 1] : null
  const next = TERM_OCCURRENCES.find(o => o.atMs > nowMs) ?? null
  const openPlants = new Set<PlantId>(BASE_PLANT_IDS)
  for (const t of open) openPlants.add(TERMS[t].plantId)
  return {
    openTermIds: open, openPlantIds: PLANT_IDS.filter(p => openPlants.has(p)),
    currentTermId: cur?.termId ?? null, currentTermAtMs: cur?.atMs ?? null,
    nextTermId: next?.termId ?? null, nextTermAtMs: next?.atMs ?? null,
    mode: SEASON_CONFIG.override === 'all' ? 'override_all' : 'calendar',
  }
}
export const isTermOpen = (termId: TermId, nowMs: number) => seasonView(nowMs).openTermIds.indexOf(termId) >= 0

/* ---------------- discovery, items & plots ---------------- */
export const isPlotOpen = (s: PlayerState, plotId: PlotId) => s.discoveredPlantIds.length >= (PLOT_UNLOCK[plotId] ?? 0)
export const openPlotIds = (s: PlayerState) => PLOT_IDS.filter(id => isPlotOpen(s, id))
function discover(s: PlayerState, plantId: PlantId | undefined): boolean {
  return !!plantId && isPlantId(plantId) && uniqPush(s.discoveredPlantIds, plantId)
}
const addItem = (s: PlayerState, g: Grant) => {
  const item = ITEMS[g.itemId] ?? fail('UNKNOWN_ITEM', '未知物品')
  const next = (s.inventory[g.itemId] ?? 0) + g.quantity
  if (!Number.isSafeInteger(next) || next < 0) fail('NUMERIC_OVERFLOW', '物品数量异常')
  s.inventory[g.itemId] = next
  if (g.quantity > 0) discover(s, item.plantId)
}
const newPlots = (before: PlotId[], s: PlayerState) => openPlotIds(s).filter(id => before.indexOf(id) < 0)

/* ---------------- rewards ---------------- */
export function repeatRemaining(s: PlayerState, nowMs: number): number {
  const used = s.repeatRewardDayKey === dayKeyUtc8(nowMs) ? s.repeatRewardUsed : 0
  return Math.max(0, RULES.dailyRepeatLimit - used)
}
/**
 * D23 repeat-seed pick: prefer an open plant the player has never discovered (so repeats grow the
 * codex); once all open plants are discovered, 50% the current term's plant, otherwise any open plant.
 */
export function pickSeedPlant(s: PlayerState, nowMs: number, key: string, fallback: PlantId): PlantId {
  const view = seasonView(nowMs)
  const open = view.openPlantIds.length ? view.openPlantIds : [fallback]
  const h = fnv1a(key)
  const unseen = open.filter(p => s.discoveredPlantIds.indexOf(p) < 0)
  if (unseen.length) return unseen[h % unseen.length]
  const curPlant = view.currentTermId ? TERMS[view.currentTermId].plantId : null
  if (curPlant && open.indexOf(curPlant) >= 0 && (h >>> 8) % 2 === 0) return curPlant
  return open[h % open.length]
}
export type RewardCtx = { userId: string; runId: string }
export function previewReward(s: PlayerState, levelId: LevelId, route: Route, nowMs: number, ctx: RewardCtx): RewardPreview {
  const lv = LEVELS[levelId]; const prog = s.levels[levelId]
  if (!prog.firstRouteClaimed[route]) {
    return { rewardMode: 'route_first', grants: [route === 'plant' ? { itemId: `seed_${lv.plantId}`, quantity: 2 } : { itemId: lv.decor[0], quantity: 1 }], reason: null }
  }
  if (repeatRemaining(s, nowMs) <= 0) return { rewardMode: 'none', grants: [], reason: 'DAILY_REPEAT_LIMIT' }
  if (route === 'plant') {
    const pid = pickSeedPlant(s, nowMs, `${ctx.userId}:${ctx.runId}`, lv.plantId)
    return { rewardMode: 'repeat', grants: [{ itemId: `seed_${pid}`, quantity: 1 }], reason: null }
  }
  return { rewardMode: 'repeat', grants: [{ itemId: lv.decor[prog.decorRewardCount % 2], quantity: 1 }], reason: null }
}

/* ---------------- proofs ---------------- */
/** Client attestation check: validates the answer set/mapping against the level config, not the touch/drag interaction. See README "服务端信任边界". */
export function validateProof(levelId: LevelId, proof: Proof): void {
  const lv = LEVELS[levelId]
  if (!proof || typeof proof !== 'object') fail('INVALID_PROOF', '缺少关卡结果')
  if (lv.kind === 'find') {
    if (proof.kind !== 'find' || !Array.isArray(proof.foundTargetIds)) return fail('INVALID_PROOF', '找物结果格式错误')
    const required = SCENES[lv.sceneId].targets.map(t => t.targetId)
    const found = proof.foundTargetIds
    if (new Set(found).size !== found.length || found.length !== required.length || !required.every(id => found.includes(id))) fail('INVALID_PROOF', '目标集合不匹配')
    const gates = proof.gates ?? {}
    const fog = SCENES[lv.sceneId].fog
    const keys = Object.keys(gates)
    if (fog) {
      if (keys.length !== 1 || gates[fog.gate] !== true) fail('INVALID_PROOF', '云雾尚未拨开')
    } else if (keys.length !== 0) fail('INVALID_PROOF', '此关不需要额外门槛')
  } else {
    if (proof.kind !== 'puzzle' || !Array.isArray(proof.slots)) return fail('INVALID_PROOF', '拼图结果格式错误')
    const pieces = puzzlePieces(levelId)
    const slots = proof.slots
    if (slots.length !== pieces.length) fail('INVALID_PROOF', '拼图片数不正确')
    const ids = new Set(slots.map(s => s.pieceId)); const idx = new Set(slots.map(s => s.slotIndex))
    if (ids.size !== pieces.length || idx.size !== pieces.length) fail('INVALID_PROOF', '拼图片重复')
    for (const p of pieces) {
      const slot = slots.find(s => s.pieceId === p.pieceId)
      if (!slot || slot.slotIndex !== p.slotIndex) fail('INVALID_PROOF', '拼图位置不正确')
    }
  }
}

/* ---------------- run finish ---------------- */
type Unlocks = Pick<FinishResult, 'newlyUnlockedSceneIds' | 'newlyUnlockedStoryIds' | 'newlyUnlockedPaletteIds' | 'newlyUnlockedSetIds' | 'newlyUnlockedPlotIds'>
const emptyUnlocks = (): Unlocks => ({ newlyUnlockedSceneIds: [], newlyUnlockedStoryIds: [], newlyUnlockedPaletteIds: [], newlyUnlockedSetIds: [], newlyUnlockedPlotIds: [] })
/** Applies a validated finish to a copy of state. Caller persists state + run + receipt atomically. */
export function applyFinish(prev: PlayerState, runId: string, levelId: LevelId, route: Route, nowMs: number, userId: string): { state: PlayerState; result: FinishResult } {
  if (prev.activeRunId !== runId) fail('RUN_NOT_FOUND', '这次探索已失效，请重新出发')
  const s = clone(prev); const lv = LEVELS[levelId]; const prog = s.levels[levelId]
  const u = emptyUnlocks()
  const openBefore = SCENE_ORDER.filter(id => isSceneOpen(s, id))
  const plotsBefore = openPlotIds(s)
  const firstCompletion = prog.firstCompletedAtMs === null
  let newlyDiscoveredPlantId: PlantId | null = null
  if (firstCompletion) {
    prog.firstCompletedAtMs = nowMs
    if (discover(s, lv.plantId)) newlyDiscoveredPlantId = lv.plantId
  }
  const today = dayKeyUtc8(nowMs)
  if (s.repeatRewardDayKey !== today) { s.repeatRewardDayKey = today; s.repeatRewardUsed = 0 }
  const preview = previewReward(s, levelId, route, nowMs, { userId, runId })
  for (const g of preview.grants) {
    const pid = ITEMS[g.itemId]?.plantId
    const isNew = !!pid && s.discoveredPlantIds.indexOf(pid) < 0
    addItem(s, g)
    if (isNew && !newlyDiscoveredPlantId) newlyDiscoveredPlantId = pid!
  }
  if (preview.rewardMode === 'route_first') prog.firstRouteClaimed[route] = true
  if (preview.rewardMode === 'repeat') s.repeatRewardUsed += 1
  if (route === 'decor' && preview.grants.length) prog.decorRewardCount += 1
  for (const id of SCENE_ORDER) if (openBefore.indexOf(id) < 0 && isSceneOpen(s, id)) u.newlyUnlockedSceneIds.push(id)
  const sc = SCENES[lv.sceneId]
  if (sceneComplete(s, lv.sceneId) && uniqPush(s.unlockedStoryIds, sc.story.id)) u.newlyUnlockedStoryIds.push(sc.story.id)
  if (lv.sceneId === 'dujiangyan' && sceneComplete(s, 'dujiangyan') && uniqPush(s.unlockedPaletteIds, 'warm_wood')) u.newlyUnlockedPaletteIds.push('warm_wood')
  if (SCENE_ORDER.every(id => sceneComplete(s, id)) && uniqPush(s.unlockedStoryIds, 'story_finale')) u.newlyUnlockedStoryIds.push('story_finale')
  u.newlyUnlockedPlotIds = newPlots(plotsBefore, s)
  if (s.tutorialStage === 'explore' && levelId === 'dujiangyan_find' && firstCompletion) s.tutorialStage = 'plant'
  s.activeRunId = null
  s.stateRevision += 1
  return { state: s, result: { runId, firstCompletion, newlyDiscoveredPlantId, rewardMode: preview.rewardMode, grants: preview.grants, reason: preview.reason, ...u, appliedStateRevision: s.stateRevision } }
}

/* ---------------- planting & observation ---------------- */
export function applyPlantStart(prev: PlayerState, plotId: PlotId, seedItemId: string, nowMs: number, plantingId: string) {
  const s = clone(prev)
  const plot = s.plots.find(p => p.plotId === plotId) ?? fail('INVALID_PAYLOAD', '种植槽不存在')
  if (!isPlotOpen(s, plotId)) fail('PLOT_LOCKED', `图鉴发现 ${PLOT_UNLOCK[plotId]} 种植物后开放这个种植槽`)
  const item = ITEMS[seedItemId]
  if (!item || item.kind !== 'seed' || !item.plantId) return fail('UNKNOWN_ITEM', '不是可种植的种子')
  if (plot.planting) fail('PLOT_OCCUPIED', '这个种植槽已经有植物')
  if ((s.inventory[seedItemId] ?? 0) < 1) fail('INSUFFICIENT_ITEM', '种子不足')
  s.inventory[seedItemId] -= 1
  const instant = !s.tutorialGrowUsed && plotId === 'plot_1' && seedItemId === 'seed_mint' && s.levels.dujiangyan_find.firstCompletedAtMs !== null
  plot.planting = { plantingId, plantId: item.plantId, startedAtMs: nowMs, readyAtMs: instant ? nowMs : nowMs + RULES.growMs }
  if (instant) { s.tutorialGrowUsed = true; s.tutorialPlantingId = plantingId }
  if (s.tutorialStage === 'plant' && seedItemId === 'seed_mint') s.tutorialStage = 'collect'
  s.stateRevision += 1
  return { state: s, result: { plotId, planting: plot.planting, tutorialInstant: instant } }
}
export function applyPlantClaim(prev: PlayerState, plotId: PlotId, plantingId: string, nowMs: number) {
  const s = clone(prev)
  const before = openPlotIds(s)
  const plot = s.plots.find(p => p.plotId === plotId) ?? fail('INVALID_PAYLOAD', '种植槽不存在')
  const planting = plot.planting
  if (!planting || planting.plantingId !== plantingId) return fail('PLANTING_NOT_FOUND', '这株植物已经领取或已更换')
  if (nowMs < planting.readyAtMs) fail('PLANT_NOT_READY', '植物还在生长')
  const grant = { itemId: `plant_${planting.plantId}`, quantity: 1 }
  addItem(s, grant)
  plot.planting = null
  if (s.tutorialStage === 'collect' && planting.plantId === 'mint') s.tutorialStage = 'decorate'
  s.stateRevision += 1
  return { state: s, result: { plotId, plantingId, grants: [grant], newlyUnlockedPlotIds: newPlots(before, s) } }
}
/** Growth stage reached by a planting: 0 种子 · 1 发芽 · 2 长叶 · 3 开花/成熟 (only once ready). */
export function reachedStage(p: { startedAtMs: number; readyAtMs: number }, nowMs: number): number {
  if (nowMs >= p.readyAtMs) return 3
  const span = Math.max(1, p.readyAtMs - p.startedAtMs)
  return Math.max(0, Math.min(2, Math.floor(((nowMs - p.startedAtMs) * 4) / span)))
}
export function applyObserveRecord(prev: PlayerState, plantingId: string, stage: number, nowMs: number) {
  if (!Number.isInteger(stage) || stage < 0 || stage > 3) fail('INVALID_PAYLOAD', '观察阶段无效')
  const s = clone(prev)
  const plot = s.plots.find(p => p.planting?.plantingId === plantingId) ?? fail('PLANTING_NOT_FOUND', '没有找到这株植物')
  const planting = plot.planting!
  if (stage > reachedStage(planting, nowMs)) fail('STAGE_NOT_REACHED', '植物还没长到这个阶段，过一会儿再来看看')
  const rec = s.observations[planting.plantId] ?? (s.observations[planting.plantId] = [])
  if (rec.indexOf(stage) >= 0) fail('ALREADY_CLAIMED', '这个阶段已经记录过了')
  rec.push(stage); rec.sort((a, b) => a - b)
  s.stateRevision += 1
  return { state: s, result: { plantId: planting.plantId, stage, recordedStages: rec.slice(), completed: rec.length === 4 } }
}

/* ---------------- quiz ---------------- */
type QuizItem = { plantId: PlantId; questions: { q: string; options: string[]; answer: number; explain: string }[] }
const QUIZZES: Record<PlantId, QuizItem> = Object.fromEntries((quizzesJson.items as unknown as QuizItem[]).map(q => [q.plantId, q]))
export const quizFor = (plantId: PlantId) => QUIZZES[plantId] ?? null
export const quizTitle = (count: number): string | null => {
  let t: string | null = null
  for (const [n, name] of QUIZ_TITLES) if (count >= n) t = name
  return t
}
export function applyQuizComplete(prev: PlayerState, plantId: PlantId, answers: number[]) {
  if (!isPlantId(plantId) || !QUIZZES[plantId]) fail('INVALID_PAYLOAD', '植物无效')
  if (prev.discoveredPlantIds.indexOf(plantId) < 0) fail('INVALID_PAYLOAD', '先在图鉴里发现这种植物')
  const qs = QUIZZES[plantId].questions
  if (!Array.isArray(answers) || answers.length !== qs.length || !answers.every(a => Number.isInteger(a))) fail('INVALID_PAYLOAD', '答案格式错误')
  if (prev.quizStamps.indexOf(plantId) >= 0) fail('ALREADY_CLAIMED', '这种植物的印章已经获得')
  if (qs.some((q, i) => q.answer !== answers[i])) fail('QUIZ_WRONG_ANSWER', '还有题目没答对，再想想看')
  const s = clone(prev)
  const before = quizTitle(s.quizStamps.length)
  s.quizStamps.push(plantId)
  const title = quizTitle(s.quizStamps.length)
  s.stateRevision += 1
  return { state: s, result: { plantId, stampCount: s.quizStamps.length, title, newTitle: title !== before } }
}

/* ---------------- season claim & nature challenge ---------------- */
export function applySeasonClaim(prev: PlayerState, termId: TermId, nowMs: number) {
  if (!TERMS[termId]) fail('INVALID_PAYLOAD', '节气无效')
  if (!isTermOpen(termId, nowMs)) fail('TERM_NOT_OPEN', '这个节气还没有到')
  if (prev.season.claimed.indexOf(termId) >= 0) fail('ALREADY_CLAIMED', '这封节气信笺已经领取')
  const s = clone(prev)
  const before = openPlotIds(s)
  const grant = { itemId: `seed_${TERMS[termId].plantId}`, quantity: 2 }
  addItem(s, grant)
  s.season.claimed.push(termId)
  s.stateRevision += 1
  return { state: s, result: { termId, grants: [grant], newlyUnlockedPlotIds: newPlots(before, s) } }
}
export function applyChallengeMark(prev: PlayerState, termId: TermId, nowMs: number) {
  if (!TERMS[termId]) fail('INVALID_PAYLOAD', '节气无效')
  if (!isTermOpen(termId, nowMs)) fail('TERM_NOT_OPEN', '这个节气还没有到')
  if (prev.season.challenges.indexOf(termId) >= 0) fail('ALREADY_CLAIMED', '这个挑战已经标记完成')
  const s = clone(prev)
  s.season.challenges.push(termId)
  s.stateRevision += 1
  return { state: s, result: { termId } }
}

/* ---------------- A6-A3c daily care ---------------- */
export const CARE_GOAL_DAYS = 3
/** Days of care so far (distinct UTC+8 days, capped at the goal). */
export const careDays = (s: PlayerState, plantId: PlantId) => (s.care?.[plantId] ?? []).length
export const caredToday = (s: PlayerState, plantId: PlantId, nowMs: number) => (s.care?.[plantId] ?? []).indexOf(dayKeyUtc8(nowMs)) >= 0
/** Once per UTC+8 day per plant species the player owns mature; after CARE_GOAL_DAYS the plant is “thriving”. No items granted. */
export function applyPlantCare(prev: PlayerState, plantId: PlantId, nowMs: number) {
  if (!PLANTS[plantId]) fail('INVALID_PAYLOAD', '植物无效')
  if ((prev.inventory[`plant_${plantId}`] ?? 0) < 1) fail('INVALID_PAYLOAD', '还没有成熟的这种植物')
  const days = prev.care?.[plantId] ?? []
  if (days.length >= CARE_GOAL_DAYS) fail('ALREADY_CLAIMED', '已经长得很好了')
  const today = dayKeyUtc8(nowMs)
  if (days.indexOf(today) >= 0) fail('ALREADY_CLAIMED', '今天已经照料过了，明天再来')
  const s = clone(prev)
  s.care = { ...(s.care ?? {}), [plantId]: [...days, today] }
  s.stateRevision += 1
  const n = days.length + 1
  return { state: s, result: { plantId, days: n, thriving: n >= CARE_GOAL_DAYS } }
}
/* ---------------- crafting ---------------- */
export const placedCount = (placements: Placement[], itemId: string) => placements.filter(p => p.itemId === itemId).length
/** Owned minus placed in the saved garden — crafting never consumes a placed plant. */
export const availableCount = (s: PlayerState, itemId: string) => (s.inventory[itemId] ?? 0) - placedCount(s.garden.placements, itemId)
const slotAccepts = (slot: CraftInput, pid: PlantId) =>
  slot.plants ? slot.plants.indexOf(pid) >= 0 : slot.tag === 'flowering' ? PLANTS[pid].flowering : slot.tag === 'leafy' ? PLANTS[pid].leafy : false
/** Assigns each input unit to a slot (backtracking; recipes have ≤3 units). Returns null if impossible. */
export function matchRecipe(recipe: CraftDef, units: PlantId[]): PlantId[][] | null {
  const need = recipe.inputs.reduce((n, i) => n + i.count, 0)
  if (units.length !== need) return null
  const buckets: PlantId[][] = recipe.inputs.map(() => [])
  const okSlot = (i: number) => {
    const slot = recipe.inputs[i]; const b = buckets[i]
    if (!slot.sameSeason || b.length < 2) return true
    return b.every(p => PLANTS[p].season === PLANTS[b[0]].season)
  }
  const go = (k: number): boolean => {
    if (k === units.length) return buckets.every((b, i) => b.length === recipe.inputs[i].count)
    for (let i = 0; i < recipe.inputs.length; i++) {
      if (buckets[i].length >= recipe.inputs[i].count || !slotAccepts(recipe.inputs[i], units[k])) continue
      buckets[i].push(units[k])
      if (okSlot(i) && go(k + 1)) return true
      buckets[i].pop()
    }
    return false
  }
  return go(0) ? buckets : null
}
export function isRecipeOpen(recipeId: string, nowMs: number): boolean {
  const r = CRAFTS[recipeId]; if (!r) return false
  const open = seasonView(nowMs).openPlantIds
  return r.inputs.every(slot => !slot.plants || slot.plants.some(p => open.indexOf(p) >= 0))
}
export function applyCraftMake(prev: PlayerState, recipeId: string, inputs: Grant[], nowMs: number) {
  const recipe = CRAFTS[recipeId] ?? fail('INVALID_PAYLOAD', '手作配方无效')
  if (!isRecipeOpen(recipeId, nowMs)) fail('RECIPE_LOCKED', '这个手作需要的植物还没开放')
  if (!Array.isArray(inputs) || inputs.length === 0 || inputs.length > 6) fail('INVALID_PAYLOAD', '材料格式错误')
  const units: PlantId[] = []; const consumed: Record<string, number> = {}
  for (const g of inputs) {
    if (!g || typeof g.itemId !== 'string' || !Number.isInteger(g.quantity) || g.quantity < 1 || g.quantity > 3) fail('INVALID_PAYLOAD', '材料格式错误')
    const item = ITEMS[g.itemId]
    if (!item || item.kind !== 'plant' || !item.plantId) fail('INVALID_PAYLOAD', '手作只能使用成熟植物')
    consumed[g.itemId] = (consumed[g.itemId] ?? 0) + g.quantity
    for (let i = 0; i < g.quantity; i++) units.push(item!.plantId!)
  }
  if (!matchRecipe(recipe, units)) fail('INVALID_PAYLOAD', '材料不符合配方')
  for (const [itemId, q] of Object.entries(consumed)) if (availableCount(prev, itemId) < q) fail('INSUFFICIENT_ITEM', `${ITEMS[itemId].name}不够（已摆在小院里的不会被用掉）`)
  const s = clone(prev)
  for (const [itemId, q] of Object.entries(consumed)) s.inventory[itemId] -= q
  const grant = { itemId: recipe.outputItemId, quantity: 1 }
  addItem(s, grant)
  s.stateRevision += 1
  return { state: s, result: { recipeId, consumed: Object.entries(consumed).map(([itemId, quantity]) => ({ itemId, quantity })), grants: [grant] } }
}

/* ---------------- garden, sets & visitors ---------------- */
export type Footprint = { x: number; y: number; w: number; h: number }
export const footprintOf = (p: Placement): Footprint => {
  const f = ITEMS[p.itemId]?.footprint ?? { w: 1, h: 1 }
  return { x: p.x, y: p.y, w: f.w, h: f.h }
}
/** Full-layout validation shared by the editor (live feedback) and the server (authoritative). */
export function validateLayout(s: PlayerState, paletteId: PaletteId, placements: Placement[]): void {
  if (!PALETTES[paletteId]) fail('INVALID_LAYOUT', '未知配色')
  if (!s.unlockedPaletteIds.includes(paletteId)) fail('PALETTE_LOCKED', '这个配色尚未解锁')
  if (!Array.isArray(placements) || placements.length > RULES.maxPlacements) fail('INVALID_LAYOUT', '摆件数量超出上限')
  const ids = new Set<string>()
  const occupied = new Map<string, string>()
  for (const p of placements) {
    if (!p || typeof p.instanceId !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(p.instanceId)) fail('INVALID_LAYOUT', '摆件编号无效')
    if (ids.has(p.instanceId)) fail('INVALID_LAYOUT', '摆件编号重复')
    ids.add(p.instanceId)
    if (!isPlaceable(p.itemId)) fail('UNKNOWN_ITEM', '未知摆件')
    if (!Number.isInteger(p.x) || !Number.isInteger(p.y)) fail('INVALID_LAYOUT', '坐标必须是整数')
    const f = footprintOf(p)
    if (f.x < 0 || f.y < 0 || f.x + f.w > RULES.gardenWidth || f.y + f.h > RULES.gardenHeight) fail('LAYOUT_OUT_OF_BOUNDS', '摆件超出小院范围')
    for (let dx = 0; dx < f.w; dx++) for (let dy = 0; dy < f.h; dy++) {
      const key = `${f.x + dx},${f.y + dy}`
      if (occupied.has(key)) fail('LAYOUT_OVERLAP', '摆件位置重叠')
      occupied.set(key, p.instanceId)
    }
  }
  for (const itemId of new Set(placements.map(p => p.itemId))) {
    const n = placedCount(placements, itemId)
    if (n > (s.inventory[itemId] ?? 0)) fail('ITEM_OVERPLACED', `${ITEMS[itemId].name}摆放数量超过拥有数量`)
    if (itemId.startsWith('craft_') && n > CRAFT_RULES.maxPlacedEach) fail('ITEM_OVERPLACED', `每种手作最多摆 ${CRAFT_RULES.maxPlacedEach} 件`)
  }
}
const placedPlants = (placements: Placement[]) => placements.map(p => ITEMS[p.itemId]?.kind === 'plant' ? ITEMS[p.itemId].plantId! : null).filter((x): x is PlantId => !!x)
export function visitorConditionMet(c: VisitorCondition, placements: Placement[]): boolean {
  const plants = placedPlants(placements)
  const itemIds = placements.map(p => p.itemId)
  if (c.minPlants !== undefined && plants.length < c.minPlants) return false
  if (c.items && !c.items.every(i => itemIds.indexOf(i) >= 0)) return false
  if (c.plants && !c.plants.every(p => plants.indexOf(p) >= 0)) return false
  if (c.anyPlants && new Set(plants.filter(p => c.anyPlants!.indexOf(p) >= 0)).size < (c.anyCount ?? 1)) return false
  if (c.minFloweringKinds !== undefined && new Set(plants.filter(p => PLANTS[p].flowering)).size < c.minFloweringKinds) return false
  if (c.minLeafy !== undefined && plants.filter(p => PLANTS[p].leafy).length < c.minLeafy) return false
  return true
}
export const setComplete = (setId: string, placements: Placement[]) => {
  const d = SETS[setId]; const plants = placedPlants(placements); const items = placements.map(p => p.itemId)
  return d.plants.every(p => plants.indexOf(p) >= 0) && d.items.every(i => items.indexOf(i) >= 0)
}
export function applyGardenSave(prev: PlayerState, paletteId: PaletteId, placements: Placement[], nowMs: number, userId: string) {
  validateLayout(prev, paletteId, placements)
  const s = clone(prev)
  const before = openPlotIds(s)
  s.garden = { paletteId, placements: placements.map(p => ({ instanceId: p.instanceId, itemId: p.itemId, x: p.x, y: p.y })) }
  if (s.tutorialStage === 'decorate' && placements.some(p => p.itemId === 'plant_mint')) s.tutorialStage = 'complete'
  const newlyUnlockedSetIds: string[] = []; const newlyUnlockedStoryIds: string[] = []
  for (const setId of Object.keys(SETS)) {
    if (s.unlockedSetIds.indexOf(setId) >= 0 || !setComplete(setId, s.garden.placements)) continue
    s.unlockedSetIds.push(setId); newlyUnlockedSetIds.push(setId)
    if (uniqPush(s.unlockedStoryIds, SETS[setId].storyId)) newlyUnlockedStoryIds.push(SETS[setId].storyId)
  }
  const newVisitors: VisitorArrival[] = []
  for (const v of Object.values(VISITORS)) {
    if (s.visitors.indexOf(v.visitorId) >= 0 || !visitorConditionMet(v.condition, s.garden.placements)) continue
    s.visitors.push(v.visitorId)
    const pid = pickSeedPlant(s, nowMs, `${userId}:visitor:${v.visitorId}`, 'mint')
    const grant = { itemId: `seed_${pid}`, quantity: 1 }
    addItem(s, grant)
    newVisitors.push({ visitorId: v.visitorId, grants: [grant] })
  }
  s.stateRevision += 1
  return { state: s, result: { garden: s.garden, newVisitors, newlyUnlockedSetIds, newlyUnlockedStoryIds, newlyUnlockedPlotIds: newPlots(before, s) } }
}
/** Cells covered by a footprint must be free of other instances (editor helper). */
export function canPlace(placements: Placement[], candidate: Placement, ignoreInstanceId?: string): boolean {
  const f = footprintOf(candidate)
  if (f.x < 0 || f.y < 0 || f.x + f.w > RULES.gardenWidth || f.y + f.h > RULES.gardenHeight) return false
  return placements.every(p => {
    if (p.instanceId === ignoreInstanceId) return true
    const o = footprintOf(p)
    return f.x + f.w <= o.x || o.x + o.w <= f.x || f.y + f.h <= o.y || o.y + o.h <= f.y
  })
}
export function findFreeSpot(placements: Placement[], itemId: string): { x: number; y: number } | null {
  for (let y = 0; y < RULES.gardenHeight; y++) for (let x = 0; x < RULES.gardenWidth; x++) {
    if (canPlace(placements, { instanceId: '__probe', itemId, x, y })) return { x, y }
  }
  return null
}
/**
 * A5 G9 "一键示范布置": a tidy layout using ONLY items the player owns (never more than owned, craft cap respected).
 * Big decor first (back rows, then centre), plants on a ring along the edges, every other cell. Deterministic.
 * Result goes into the editor draft; the player still has to press Save (no reward, no server shortcut).
 */
export function autoLayout(s: PlayerState): Placement[] {
  const out: Placement[] = []
  const W = RULES.gardenWidth; const H = RULES.gardenHeight
  const owned = Object.keys(s.inventory).filter(id => isPlaceable(id) && (s.inventory[id] ?? 0) > 0).sort()
  const isPlant = (id: string) => ITEMS[id]?.kind === 'plant'
  const decor = owned.filter(id => !isPlant(id))
    .sort((a, b) => { const fa = footprintOf({ instanceId: '', itemId: a, x: 0, y: 0 }); const fb = footprintOf({ instanceId: '', itemId: b, x: 0, y: 0 }); return fb.w * fb.h - fa.w * fa.h || (a < b ? -1 : 1) })
  const plants = owned.filter(isPlant)
  let n = 0
  const tryAt = (itemId: string, cells: [number, number][]) => {
    for (const [x, y] of cells) {
      const c = { instanceId: `demo_${n}`, itemId, x, y }
      if (canPlace(out, c)) { out.push(c); n++; return true }
    }
    return false
  }
  const decorCells: [number, number][] = []
  for (const y of [1, 0, 2, Math.floor(H / 2) - 1, Math.floor(H / 2)]) for (const x of [1, W - 3, Math.floor(W / 2) - 1, 3, 0, W - 2]) decorCells.push([x, y])
  for (const id of decor) {
    const cap = Math.min(s.inventory[id] ?? 0, id.startsWith('craft_') ? CRAFT_RULES.maxPlacedEach : 2)
    for (let k = 0; k < cap && out.length < RULES.maxPlacements; k++) {
      if (!tryAt(id, decorCells)) { const f = findFreeSpot(out, id); if (!f) break; out.push({ instanceId: `demo_${n++}`, itemId: id, x: f.x, y: f.y }) }
    }
  }
  const ring: [number, number][] = []
  for (let x = 0; x < W; x += 2) ring.push([x, H - 1])
  for (let y = H - 3; y >= 3; y -= 2) { ring.push([0, y]); ring.push([W - 1, y]) }
  for (let x = 1; x < W; x += 2) ring.push([x, H - 2])
  const queue: string[] = []
  for (const id of plants) for (let k = 0; k < (s.inventory[id] ?? 0); k++) queue.push(id)
  const bySpecies = plants.map(id => queue.filter(q => q === id))
  const mixed: string[] = []
  for (let i = 0; bySpecies.some(l => l.length > i); i++) for (const l of bySpecies) if (l[i]) mixed.push(l[i])
  for (const id of mixed) {
    if (out.length >= RULES.maxPlacements) break
    if (!tryAt(id, ring)) break
  }
  return out
}
export const gardenCellCenter = (x: number, y: number, w = 1, h = 1) => ({
  x: GARDEN_LAYOUT.origin.x + (x + w / 2) * GARDEN_LAYOUT.cell.w,
  bottom: GARDEN_LAYOUT.origin.y + (y + h) * GARDEN_LAYOUT.cell.h,
})

/* ---------------- consent, settings, feedback, telemetry ---------------- */
export function applyConsentUpdate(prev: PlayerState, privacyVersion: unknown, telemetry: unknown, nowMs: number) {
  if (privacyVersion !== COMPLIANCE.privacyPolicyVersion) fail('INVALID_PAYLOAD', '隐私政策版本无效')
  if (typeof telemetry !== 'boolean') fail('INVALID_PAYLOAD', '统计开关格式错误')
  const s = clone(prev)
  s.consent = { privacyVersion: privacyVersion as string, telemetry: telemetry as boolean, updatedAtMs: nowMs }
  s.stateRevision += 1
  return { state: s, result: { consent: s.consent } }
}
export function applyParentMode(prev: PlayerState, on: unknown) {
  if (typeof on !== 'boolean') fail('INVALID_PAYLOAD', '亲子模式开关格式错误')
  const s = clone(prev); s.settings.parentMode = on as boolean; s.stateRevision += 1
  return { state: s, result: { parentMode: s.settings.parentMode } }
}
export const codepointLength = (s: string) => [...s].length
// eslint-disable-next-line no-control-regex
export const hasForbiddenChars = (s: string) => /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/.test(s)
const hasHtml = (s: string) => /<\s*\/?\s*[a-zA-Z!]/.test(s)
export function validateFeedback(text: unknown, contact: unknown): { text: string; contact: string } {
  if (typeof text !== 'string') return fail('INVALID_PAYLOAD', '反馈内容格式错误')
  const t = text.trim()
  if (!t || hasForbiddenChars(t) || hasHtml(t)) fail('INVALID_PAYLOAD', '反馈内容为空或包含不支持的字符')
  if (codepointLength(t) > 500) fail('FEEDBACK_TOO_LONG', '反馈最多 500 字，请缩短后再提交')
  const c = contact === undefined || contact === null ? '' : contact
  if (typeof c !== 'string' || codepointLength(c) > 100 || hasForbiddenChars(c) || hasHtml(c)) fail('INVALID_PAYLOAD', '联系方式格式错误')
  return { text: t, contact: (c as string).trim() }
}
/** PRD §9 whitelist + v2.1/A5/A6 events. Unknown events/fields are rejected, never truncated. */
type FieldKind = 'level' | 'route' | 'rewardMode' | 'plant' | 'scene' | 'term' | 'stage' | 'tutorialStage' | 'int' | 'bool' | 'template' | 'code' | 'visitor' | 'recipe' | 'set' | 'ageBand' | 'result'
export const TELEMETRY_EVENTS: Record<string, Record<string, FieldKind>> = {
  app_open: {}, consent_result: { result: 'result' }, login_success: {}, realname_result: { result: 'result' },
  tutorial_step: { stage: 'tutorialStage' }, tutorial_skip: {},
  run_start: { levelId: 'level', route: 'route' }, run_finish: { levelId: 'level', rewardMode: 'rewardMode' }, run_cancel: { levelId: 'level' },
  plant_start: { plantId: 'plant' }, plant_claim: { plantId: 'plant' }, plant_care: { plantId: 'plant', days: 'int' }, garden_save: { placementCount: 'int' },
  trip_card_view: { sceneId: 'scene' }, plant_card_view: { plantId: 'plant' }, parent_mode_toggle: { on: 'bool' }, kid_age: { age: 'ageBand' },
  share_export: { templateId: 'template', hasPhoto: 'bool' }, share_system_share: { templateId: 'template' }, error_shown: { code: 'code' },
  season_claim: { termId: 'term' }, calendar_view: {}, observe_record: { plantId: 'plant', stage: 'stage' }, quiz_complete: { plantId: 'plant' },
  visitor_found: { visitorId: 'visitor' }, craft_make: { recipeId: 'recipe' }, set_complete: { setId: 'set' }, challenge_mark: { termId: 'term' },
  field_tick: { on: 'bool' }, blogger_carousel: { n: 'int' }, blogger_video: {},
}
const SHARE_TEMPLATES = ['share_scenic', 'share_plant', 'share_garden', 'share_nature']
const fieldOk = (k: FieldKind, v: unknown): boolean => {
  switch (k) {
    case 'level': return typeof v === 'string' && !!LEVELS[v as LevelId]
    case 'route': return v === 'plant' || v === 'decor'
    case 'rewardMode': return v === 'route_first' || v === 'repeat' || v === 'none'
    case 'plant': return isPlantId(v)
    case 'scene': return typeof v === 'string' && !!SCENES[v as SceneId]
    case 'term': return typeof v === 'string' && !!TERMS[v as TermId]
    case 'stage': return Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 3
    case 'tutorialStage': return ['explore', 'plant', 'collect', 'decorate', 'complete'].indexOf(v as string) >= 0
    case 'ageBand': return v === '3-6' || v === '7-12'
    case 'int': return Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 1000
    case 'bool': return typeof v === 'boolean'
    case 'template': return SHARE_TEMPLATES.indexOf(v as string) >= 0
    case 'code': return typeof v === 'string' && /^[A-Z_]{3,40}$/.test(v)
    case 'visitor': return typeof v === 'string' && !!VISITORS[v]
    case 'recipe': return typeof v === 'string' && !!CRAFTS[v]
    case 'set': return typeof v === 'string' && !!SETS[v]
    case 'result': return v === 'accepted' || v === 'declined' || v === 'passed' || v === 'failed' || v === 'pending'
  }
}
export type TelemetryEvent = { eventName: string; fields: Record<string, unknown> }
export function validateTelemetry(s: PlayerState, events: unknown): TelemetryEvent[] {
  if (s.consent.telemetry !== true) fail('CONSENT_REQUIRED', '未开启“帮助改进体验”')
  if (!Array.isArray(events) || events.length < 1 || events.length > 20) return fail('INVALID_PAYLOAD', '每批 1–20 条')
  for (const e of events as TelemetryEvent[]) {
    const spec = e && typeof e.eventName === 'string' ? TELEMETRY_EVENTS[e.eventName] : undefined
    if (!spec || !e.fields || typeof e.fields !== 'object' || Array.isArray(e.fields)) fail('INVALID_PAYLOAD', '未知统计事件')
    const keys = Object.keys(e.fields)
    if (keys.length !== Object.keys(spec!).length || !keys.every(k => spec![k] && fieldOk(spec![k], e.fields[k]))) fail('INVALID_PAYLOAD', `统计字段不符合白名单：${e.eventName}`)
  }
  return events as TelemetryEvent[]
}
export const configVersionOk = (v: string) => v === CONFIG_VERSION
export { PLANTS }

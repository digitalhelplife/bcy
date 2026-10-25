import type { MinorRule } from './compliance'
// Business contract shared by the frontend, the local demo server and the Nakama runtime.
// Mirrors 06_后端技术规格与接口契约.md §3–5 and the v2.1 addendum (CR-01). Times are Unix ms.
export type SceneId = 'dujiangyan' | 'qingcheng' | 'jiezi'
/** 24 plant IDs come from content/plants.json; validated at runtime against PLANTS. */
export type PlantId = string
export type TermId = string
export type Route = 'plant' | 'decor'
export type LevelId =
  | 'dujiangyan_find' | 'dujiangyan_puzzle'
  | 'qingcheng_find' | 'qingcheng_puzzle'
  | 'jiezi_find' | 'jiezi_puzzle'
export type PaletteId = 'green' | 'warm_wood'
export type TutorialStage = 'explore' | 'plant' | 'collect' | 'decorate' | 'complete'
export type PlotId = 'plot_1' | 'plot_2' | 'plot_3' | 'plot_4' | 'plot_5' | 'plot_6' | 'plot_7' | 'plot_8'
export type Planting = { plantingId: string; plantId: PlantId; startedAtMs: number; readyAtMs: number }
export type Plot = { plotId: PlotId; planting: Planting | null }
export type Placement = { instanceId: string; itemId: string; x: number; y: number }
export type LevelProgress = {
  firstCompletedAtMs: number | null
  firstRouteClaimed: { plant: boolean; decor: boolean }
  decorRewardCount: number
}
export type Consent = { privacyVersion: string; telemetry: boolean; updatedAtMs: number }
export type PlayerState = {
  schemaVersion: 3
  contentProfile: 'chengdu_v1'
  stateRevision: number
  createdAtMs: number
  tutorialStage: TutorialStage
  tutorialSkipped: boolean
  tutorialGrowUsed: boolean
  tutorialPlantingId: string | null
  discoveredPlantIds: PlantId[]
  unlockedStoryIds: string[]
  unlockedPaletteIds: PaletteId[]
  unlockedSetIds: string[]
  levels: Record<LevelId, LevelProgress>
  inventory: Record<string, number>
  plots: Plot[]
  garden: { paletteId: PaletteId; placements: Placement[] }
  repeatRewardDayKey: string
  repeatRewardUsed: number
  activeRunId: string | null
  // v2.0 compliance
  consent: Consent
  settings: { parentMode: boolean }
  // v2.1 learning & playability
  season: { claimed: TermId[]; challenges: TermId[] }
  observations: Record<PlantId, number[]>
  quizStamps: PlantId[]
  visitors: string[]
  // v2.3 A6-A3c: UTC+8 day keys a mature plant was cared for (max 1/day/plant; optional for old saves)
  care?: Partial<Record<PlantId, string[]>>
}
export type FindProof = { kind: 'find'; foundTargetIds: string[]; gates: Record<string, boolean> }
export type PuzzleProof = { kind: 'puzzle'; slots: { pieceId: string; slotIndex: number }[] }
/** Client attestation of completion: the server checks the answer shape, not the touch/drag interaction. See README "服务端信任边界". */
export type Proof = FindProof | PuzzleProof
export type Grant = { itemId: string; quantity: number }
export type FinishResult = {
  runId: string
  firstCompletion: boolean
  newlyDiscoveredPlantId: PlantId | null
  rewardMode: 'route_first' | 'repeat' | 'none'
  grants: Grant[]
  reason: 'DAILY_REPEAT_LIMIT' | null
  newlyUnlockedSceneIds: SceneId[]
  newlyUnlockedStoryIds: string[]
  newlyUnlockedPaletteIds: PaletteId[]
  newlyUnlockedSetIds: string[]
  newlyUnlockedPlotIds: PlotId[]
  appliedStateRevision: number
}
export type RunStatus = 'ACTIVE' | 'FINISHED' | 'CANCELLED' | 'EXPIRED'
export type ExploreRun = {
  runId: string
  userId: string
  levelId: LevelId
  route: Route
  configVersion: string
  shuffleSeed: number
  status: RunStatus
  startedAtMs: number
  expiresAtMs: number
  finishedAtMs: number | null
  finishResult: FinishResult | null
}
export type RewardPreview = { rewardMode: 'route_first' | 'repeat' | 'none'; grants: Grant[]; reason: 'DAILY_REPEAT_LIMIT' | null }
export type ErrorCode =
  | 'INVALID_PAYLOAD' | 'UNSUPPORTED_API_VERSION' | 'UNKNOWN_ITEM' | 'INVALID_PROOF'
  | 'SCENE_LOCKED' | 'ACTIVE_RUN_EXISTS' | 'RUN_NOT_FOUND' | 'RUN_EXPIRED' | 'RUN_CANCELLED'
  | 'RUN_ALREADY_FINISHED' | 'CONFIG_EXPIRED'
  | 'INSUFFICIENT_ITEM' | 'PLOT_OCCUPIED' | 'PLANTING_NOT_FOUND' | 'PLANT_NOT_READY' | 'NUMERIC_OVERFLOW'
  | 'INVALID_LAYOUT' | 'LAYOUT_OVERLAP' | 'LAYOUT_OUT_OF_BOUNDS' | 'ITEM_OVERPLACED' | 'PALETTE_LOCKED'
  | 'STATE_CONFLICT' | 'IDEMPOTENCY_KEY_REUSED'
  | 'RATE_LIMITED' | 'SERVER_BUSY' | 'INTERNAL_ERROR'
  // v2.0
  | 'REALNAME_REQUIRED' | 'REALNAME_PENDING' | 'MINOR_TIME_RESTRICTED' | 'ACCOUNT_DELETED' | 'CONSENT_REQUIRED' | 'FEEDBACK_TOO_LONG'
  // v2.1
  | 'CLIENT_OUTDATED'
  | 'TERM_NOT_OPEN' | 'ALREADY_CLAIMED' | 'STAGE_NOT_REACHED' | 'QUIZ_WRONG_ANSWER' | 'RECIPE_LOCKED' | 'PLOT_LOCKED'
  | 'TRANSFER_CODE_INVALID' | 'TARGET_HAS_PROGRESS'
export const ERROR_CODES: readonly ErrorCode[] = [
  'CLIENT_OUTDATED',
  'INVALID_PAYLOAD', 'UNSUPPORTED_API_VERSION', 'UNKNOWN_ITEM', 'INVALID_PROOF', 'SCENE_LOCKED', 'ACTIVE_RUN_EXISTS',
  'RUN_NOT_FOUND', 'RUN_EXPIRED', 'RUN_CANCELLED', 'RUN_ALREADY_FINISHED', 'CONFIG_EXPIRED', 'INSUFFICIENT_ITEM',
  'PLOT_OCCUPIED', 'PLANTING_NOT_FOUND', 'PLANT_NOT_READY', 'NUMERIC_OVERFLOW', 'INVALID_LAYOUT', 'LAYOUT_OVERLAP',
  'LAYOUT_OUT_OF_BOUNDS', 'ITEM_OVERPLACED', 'PALETTE_LOCKED', 'STATE_CONFLICT', 'IDEMPOTENCY_KEY_REUSED',
  'RATE_LIMITED', 'SERVER_BUSY', 'INTERNAL_ERROR',
  'REALNAME_REQUIRED', 'REALNAME_PENDING', 'MINOR_TIME_RESTRICTED', 'ACCOUNT_DELETED', 'CONSENT_REQUIRED', 'FEEDBACK_TOO_LONG',
  'TERM_NOT_OPEN', 'ALREADY_CLAIMED', 'STAGE_NOT_REACHED', 'QUIZ_WRONG_ANSWER', 'RECIPE_LOCKED', 'PLOT_LOCKED',
  'TRANSFER_CODE_INVALID', 'TARGET_HAS_PROGRESS',
]
export type RpcError = { code: ErrorCode; message: string; retryable: boolean; retryAfterMs?: number }
export type RpcOk<T> = {
  ok: true; apiVersion: 1; serverTimeMs: number; configVersion: string
  stateRevision: number; replayed: boolean; data: T
}
export type RpcFail = { ok: false; apiVersion: 1; serverTimeMs: number; stateRevision: number; error: RpcError }
export type RpcResponse<T> = RpcOk<T> | RpcFail
export type ReadRequest<P> = { apiVersion: 1; payload: P }
export type WriteRequest<P> = { apiVersion: 1; clientBuild?: string; requestId: string; expectedStateRevision: number; payload: P }
export type RunSummary = Pick<ExploreRun, 'runId' | 'levelId' | 'route' | 'status' | 'shuffleSeed' | 'startedAtMs' | 'expiresAtMs' | 'configVersion'>
export type RpcName =
  | 'game.bootstrap' | 'game.state.get'
  | 'game.run.start' | 'game.run.get' | 'game.run.finish' | 'game.run.cancel'
  | 'game.plant.start' | 'game.plant.claim'
  | 'game.garden.save' | 'game.tutorial.skip' | 'game.settings.update' | 'game.request.status'
  | 'game.account.status' | 'game.account.delete' | 'game.consent.update' | 'game.feedback.submit' | 'game.telemetry.track' | 'game.playtime.heartbeat'
  | 'game.season.claim' | 'game.observe.record' | 'game.quiz.complete' | 'game.craft.make' | 'game.challenge.mark' | 'game.plant.care'
  | 'game.transfer.create' | 'game.transfer.claim'
  | 'game.garden.share.create' | 'game.garden.share.revoke' | 'game.garden.share.get' | 'game.garden.share.react'
export const WRITE_RPCS: ReadonlySet<RpcName> = new Set<RpcName>([
  'game.run.start', 'game.run.finish', 'game.run.cancel', 'game.plant.start',
  'game.plant.claim', 'game.garden.save', 'game.tutorial.skip', 'game.settings.update',
  'game.account.delete', 'game.consent.update', 'game.feedback.submit', 'game.telemetry.track', 'game.playtime.heartbeat',
  'game.season.claim', 'game.observe.record', 'game.quiz.complete', 'game.craft.make', 'game.challenge.mark', 'game.plant.care',
  'game.transfer.create', 'game.transfer.claim', 'game.garden.share.create', 'game.garden.share.revoke', 'game.garden.share.react',
])
/** Writes that never change PlayerState: no revision bump and no expectedStateRevision check (06 §5.2). */
export const SIDE_WRITES: ReadonlySet<RpcName> = new Set<RpcName>(['game.feedback.submit', 'game.telemetry.track', 'game.playtime.heartbeat', 'game.account.delete', 'game.transfer.create', 'game.garden.share.create', 'game.garden.share.revoke', 'game.garden.share.react'])
export type SeasonView = {
  openTermIds: TermId[]; openPlantIds: PlantId[]
  currentTermId: TermId | null; currentTermAtMs: number | null
  nextTermId: TermId | null; nextTermAtMs: number | null
  mode: 'calendar' | 'override_all'
}
export type StateData = { state: PlayerState; activeRun: RunSummary | null; dayKey: string; repeatRewardRemaining: number; season: SeasonView }
export type BootstrapData = StateData & { contentProfile: 'chengdu_v1'; minClientBuild: string; trialNotice: string }
export type RunStartData = { state: PlayerState; result: { run: RunSummary; preview: RewardPreview } }
export type RunGetData = { run: RunSummary & { finishResult: FinishResult | null } }
export type RunFinishData = { state: PlayerState; result: FinishResult }
export type RunCancelData = { state: PlayerState; result: { runId: string; status: 'CANCELLED' } }
export type PlantStartData = { state: PlayerState; result: { plotId: PlotId; planting: Planting; tutorialInstant: boolean } }
export type PlantClaimData = { state: PlayerState; result: { plotId: PlotId; plantingId: string; grants: Grant[]; newlyUnlockedPlotIds: PlotId[] } }
export type VisitorArrival = { visitorId: string; grants: Grant[] }
export type GardenSaveData = { state: PlayerState; result: { garden: PlayerState['garden']; newVisitors: VisitorArrival[]; newlyUnlockedSetIds: string[]; newlyUnlockedStoryIds: string[]; newlyUnlockedPlotIds: PlotId[] } }
export type TutorialSkipData = { state: PlayerState; result: { tutorialSkipped: true } }
export type SettingsUpdateData = { state: PlayerState; result: { parentMode: boolean } }
export type RequestStatusData = { status: 'FOUND'; rpcName: RpcName; result: unknown; appliedStateRevision: number } | { status: 'NOT_FOUND' }
export type AccountStatusData = {
  accountStatus: 'ACTIVE' | 'DELETE_PENDING' | 'DELETED'
  realnameStatus: 'UNVERIFIED' | 'PENDING' | 'VERIFIED_ADULT' | 'VERIFIED_MINOR'
  minorPolicy: { restricted: boolean; serverTimeMs: number; playableUntilMs: number | null; nextWindowStartMs?: number | null; rule?: MinorRule }
  /** S0/S1 device-auth stage: phone/realname service not wired yet. */
  authMode: 'device_trial' | 'phone_realname'
}
export type SeasonClaimData = { state: PlayerState; result: { termId: TermId; grants: Grant[]; newlyUnlockedPlotIds: PlotId[] } }
export type ObserveRecordData = { state: PlayerState; result: { plantId: PlantId; stage: number; recordedStages: number[]; completed: boolean } }
export type QuizCompleteData = { state: PlayerState; result: { plantId: PlantId; stampCount: number; title: string | null; newTitle: boolean } }
export type PlantCareData = { state: PlayerState; result: { plantId: PlantId; days: number; thriving: boolean } }
export type CraftMakeData = { state: PlayerState; result: { recipeId: string; consumed: Grant[]; grants: Grant[] } }
export type ChallengeMarkData = { state: PlayerState; result: { termId: TermId } }
export type ConsentUpdateData = { state: PlayerState; result: { consent: Consent } }
export type FeedbackSubmitData = { state: PlayerState; result: { acceptedAtMs: number } }
export type TelemetryTrackData = { state: PlayerState; result: { acceptedCount: number; receivedAtMs: number } }
export type AccountDeleteData = { state: null; result: { accountStatus: 'DELETED'; deletedAtMs: number } }
export type HeartbeatData = { state: PlayerState; result: AccountStatusData }

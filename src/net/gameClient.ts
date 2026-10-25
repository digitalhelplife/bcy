import { CLIENT_BUILD, CONFIG_VERSION } from '../shared/content'
import { cmpBuild } from '../shared/version'
import type {
  AccountDeleteData, AccountStatusData, ChallengeMarkData, ConsentUpdateData, CraftMakeData, PlantCareData, FeedbackSubmitData, Grant,
  HeartbeatData, ObserveRecordData, PlantId, QuizCompleteData, SeasonClaimData, SeasonView, TelemetryTrackData, TermId,
  BootstrapData, FinishResult, GardenSaveData, LevelId, PaletteId, Placement, PlantClaimData, PlantStartData,
  PlayerState, PlotId, Proof, RequestStatusData, Route, RpcError, RpcName, RpcResponse, RunCancelData, RunFinishData,
  RunGetData, RunStartData, RunSummary, SettingsUpdateData, StateData, TutorialSkipData, WriteRequest,
} from '../shared/types'
import { TransportError, type Transport } from './transport'
import { AuthApiError, getRealnameStatus, loadAuthConfig, submitRealname, type AuthConfig } from './authApi'
import type { TransferClaimResult, TransferCreateResult } from '../shared/transfer'
export type GardenReaction = 'heart' | 'flower' | 'clap' | 'wow'
export type GardenSnapshot = { paletteId: PaletteId; placements: Placement[]; createdAtMs: number; mine: boolean; reactions?: Partial<Record<GardenReaction, number>>; reactedToday?: GardenReaction | null }

/** Why the game cannot be served right now (doc 06 §4.1 steps 2–4). Rendered over every screen. */
export type Gate =
  | { kind: 'login' }
  | { kind: 'realname'; pending: boolean }
  | { kind: 'restricted' }
  | { kind: 'deleted' }
  | { kind: 'outdated'; minClientBuild: string | null }
export function gateFor(st: AccountStatusData): Gate | null {
  if (st.accountStatus !== 'ACTIVE') return { kind: 'deleted' }
  if (st.authMode !== 'phone_realname') return null
  if (st.realnameStatus === 'UNVERIFIED') return { kind: 'realname', pending: false }
  if (st.realnameStatus === 'PENDING') return { kind: 'realname', pending: true }
  if (st.minorPolicy.restricted) return { kind: 'restricted' }
  return null
}
const GATE_CODES: Record<string, Gate> = {
  REALNAME_REQUIRED: { kind: 'realname', pending: false },
  REALNAME_PENDING: { kind: 'realname', pending: true },
  MINOR_TIME_RESTRICTED: { kind: 'restricted' },
  ACCOUNT_DELETED: { kind: 'deleted' },
  CLIENT_OUTDATED: { kind: 'outdated', minClientBuild: null },
}

/** retried: a user-initiated re-send of an unknown outcome — the UI keeps the banner up ("正在确认…") until it settles. */
export type Pending = { rpc: RpcName; body: WriteRequest<unknown>; label: string; status: 'sending' | 'unknown'; retried?: boolean }
export type Snapshot = {
  phase: 'idle' | 'connecting' | 'ready' | 'error' | 'gate'
  mode: 'nakama' | 'demo' | null
  userId: string | null
  state: PlayerState | null
  activeRun: RunSummary | null
  serverOffsetMs: number
  repeatRemaining: number
  online: boolean
  pending: Pending | null
  bootError: string | null
  season: SeasonView | null
  gate: Gate | null
  account: AccountStatusData | null
  authConfig: AuthConfig | null
}

/** Business failure (ok:false) surfaced to UI. */
export class BusinessError extends Error {
  constructor(public error: RpcError) { super(error.message) }
}
/** The outcome of a write is unknown (timeout/disconnect). Retry with the same request only. */
export class UnknownOutcomeError extends Error {}

const PENDING_KEY = 'bcy.pendingWrite'

export class GameClient {
  private snap: Snapshot = { phase: 'idle', mode: null, userId: null, state: null, activeRun: null, serverOffsetMs: 0, repeatRemaining: 3, online: navigator.onLine, pending: null, bootError: null, season: null, gate: null, account: null, authConfig: null }
  private listeners = new Set<() => void>()
  private channel: BroadcastChannel | null = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('bcy-state') : null

  constructor(private transport: Transport) {
    window.addEventListener('online', () => { this.set({ online: true }); if (this.snap.phase === 'ready') void this.refresh() })
    window.addEventListener('offline', () => this.set({ online: false }))
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && this.snap.phase === 'ready') void this.refresh() })
    if (this.channel) this.channel.onmessage = () => { if (this.snap.phase === 'ready') void this.refresh() }
  }

  get snapshot() { return this.snap }
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => this.listeners.delete(fn) }
  getSnapshot = () => this.snap
  private set(patch: Partial<Snapshot>) { this.snap = { ...this.snap, ...patch }; this.listeners.forEach(l => l()) }

  serverNow() { return Date.now() + this.snap.serverOffsetMs }

  /** Apply a confirmed state only if it is not older than the current one. */
  private applyState(state: PlayerState | undefined, serverTimeMs: number, extra: Partial<Snapshot> = {}) {
    const cur = this.snap.state
    const patch: Partial<Snapshot> = { serverOffsetMs: serverTimeMs - Date.now(), ...extra }
    if (state && (!cur || state.stateRevision >= cur.stateRevision)) {
      patch.state = state
      if (cur && state.stateRevision > cur.stateRevision) this.channel?.postMessage('changed')
    }
    this.set(patch)
  }

  private stateExtras(d: StateData): Partial<Snapshot> {
    return { activeRun: d.activeRun, repeatRemaining: d.repeatRewardRemaining, season: d.season }
  }

  /** Route a business/transport failure to an auth gate. Returns true when it was a gate condition. */
  private intercept(e: unknown): boolean {
    let gate: Gate | null = null
    if (e instanceof TransportError && e.kind === 'login') gate = { kind: 'login' }
    else if (e instanceof BusinessError && GATE_CODES[e.error.code]) {
      gate = GATE_CODES[e.error.code]
      // a device-trial session in realname mode can only fix this by logging in with a phone number
      if (gate.kind === 'realname' && this.snap.account?.authMode !== 'phone_realname') gate = { kind: 'login' }
    }
    if (!gate) return false
    this.set({ phase: 'gate', gate })
    return true
  }
  get authMode() { return this.transport.authMode }
  async boot() {
    this.set({ phase: 'connecting', bootError: null, mode: this.transport.mode, gate: null })
    if (!navigator.onLine) { this.set({ phase: 'error', bootError: '当前没有网络。首次进入需要联网，恢复网络后点“重试”。' }); return }
    try {
      if (this.transport.mode === 'nakama') {
        const cfg = await loadAuthConfig()
        this.transport.setAuthMode?.(cfg.authMode)
        this.set({ authConfig: cfg })
      }
      await this.transport.connect()
      if (this.transport.authMode === 'realname') {
        const st = await this.read<AccountStatusData>('game.account.status', {})
        this.set({ account: st })
        const g = st.authMode === 'phone_realname' ? gateFor(st) : null
        if (g) { this.set({ phase: 'gate', gate: g }); return }
      }
      const res = await this.transport.rpc<BootstrapData>('game.bootstrap', { apiVersion: 1, clientBuild: CLIENT_BUILD, payload: { clientBuild: CLIENT_BUILD } })
      if (!res.ok) throw new BusinessError(res.error)
      // BE-06 / 05 §内容包: stop before any write when this page is older than the server allows or the content differs.
      if (cmpBuild(CLIENT_BUILD, res.data.minClientBuild) < 0 || res.configVersion !== CONFIG_VERSION) {
        this.set({ phase: 'gate', gate: { kind: 'outdated', minClientBuild: res.data.minClientBuild } }); return
      }
      this.applyState(res.data.state, res.serverTimeMs, { ...this.stateExtras(res.data), phase: 'ready', userId: this.transport.userId })
      this.track('login_success', {})
      const saved = localStorage.getItem(PENDING_KEY)
      if (saved) this.set({ pending: { ...(JSON.parse(saved) as Pending), status: 'unknown' } })
    } catch (e) {
      if (this.intercept(e)) return
      const msg = e instanceof AuthApiError ? e.message : e instanceof BusinessError ? e.message : e instanceof TransportError && e.kind === 'auth' ? '登录服务暂时无法连接，请稍后重试。' : e instanceof Error && e.name === 'StorageUnavailableError' ? e.message : '连接失败，请检查网络后重试。'
      this.set({ phase: 'error', bootError: msg })
    }
  }

  /** P50: sync the locally accepted privacy version + telemetry choice to the server state. */
  async syncConsent(privacyVersion: string, telemetry: boolean) {
    const c = this.snap.state?.consent
    if (c && c.privacyVersion === privacyVersion && c.telemetry === telemetry) return
    await this.write<ConsentUpdateData>('game.consent.update', { privacyVersion, telemetry }, '隐私设置')
  }
  async refresh() {
    try {
      const res = await this.transport.rpc<StateData>('game.state.get', { apiVersion: 1, clientBuild: CLIENT_BUILD, payload: {} })
      if (res.ok) this.applyState(res.data.state, res.serverTimeMs, this.stateExtras(res.data))
    } catch { /* keep last confirmed snapshot */ }
  }

  private async read<T>(name: RpcName, payload: unknown): Promise<T> {
    let res: RpcResponse<T>
    try { res = await this.transport.rpc<T>(name, { apiVersion: 1, clientBuild: CLIENT_BUILD, payload }) } catch (e) { this.intercept(e); throw e }
    if (!res.ok) { this.track('error_shown', { code: res.error.code }); const be = new BusinessError(res.error); if (name !== 'game.account.status') this.intercept(be); throw be }
    this.set({ serverOffsetMs: res.serverTimeMs - Date.now() })
    return res.data
  }

  /** Every write goes through here: persisted before sending, same requestId on retry. */
  private inflight: Promise<unknown> | null = null
  private async send<T extends { state: PlayerState }>(pending: Pending): Promise<T> {
    // A write that is merely still on the wire is not an "unconfirmed" one: wait (bounded) for it to settle
    // instead of rejecting a quick second tap. Only a write whose outcome is unknown blocks new writes.
    if (this.inflight && this.snap.pending?.status === 'sending' && this.snap.pending.body.requestId !== pending.body.requestId) {
      await Promise.race([this.inflight.catch(() => undefined), new Promise(r => setTimeout(r, 10_000))])
      // never sent yet, so it is safe to re-base it on the state the earlier write produced
      pending = { ...pending, body: { ...pending.body, expectedStateRevision: this.snap.state?.stateRevision ?? pending.body.expectedStateRevision } }
    }
    if (this.snap.pending && this.snap.pending.body.requestId !== pending.body.requestId) {
      throw new BusinessError({ code: 'SERVER_BUSY', message: '上一个操作还未确认，请先完成确认', retryable: false })
    }
    if (!this.snap.online) throw new BusinessError({ code: 'SERVER_BUSY', message: '当前离线，联网后再操作', retryable: true })
    localStorage.setItem(PENDING_KEY, JSON.stringify(pending))
    this.set({ pending: { ...pending, status: 'sending' } })
    let res: RpcResponse<T>
    try {
      const call = this.transport.rpc<T>(pending.rpc, pending.body)
      this.inflight = call
      try { res = await call } finally { if (this.inflight === call) this.inflight = null }
    } catch (e) {
      this.set({ pending: { ...pending, status: 'unknown' } })
      // login required: the request never reached the game; it stays pending and is retried after login
      if (this.intercept(e)) throw e
      throw new UnknownOutcomeError('网络中断，操作结果未确认')
    }
    localStorage.removeItem(PENDING_KEY)
    this.set({ pending: null })
    if (!res.ok) {
      this.set({ serverOffsetMs: res.serverTimeMs - Date.now() })
      this.track('error_shown', { code: res.error.code })
      if (res.error.code === 'STATE_CONFLICT') void this.refresh()
      const be = new BusinessError(res.error); this.intercept(be); throw be
    }
    this.applyState(res.data.state, res.serverTimeMs)
    void this.refresh()
    return res.data
  }

  private write<T extends { state: PlayerState }>(rpc: RpcName, payload: unknown, label: string) {
    const body: WriteRequest<unknown> = { apiVersion: 1, clientBuild: CLIENT_BUILD, requestId: crypto.randomUUID(), expectedStateRevision: this.snap.state?.stateRevision ?? 0, payload }
    return this.send<T>({ rpc, body, label, status: 'sending' })
  }

  /** Retry the unknown pending write with the identical body (idempotent on the server). */
  retryPending<T extends { state: PlayerState }>() {
    const p = this.snap.pending
    if (!p) return Promise.reject(new Error('没有待确认的操作'))
    return this.send<T>({ ...p, retried: true })
  }
  async queryPending(): Promise<RequestStatusData> {
    const p = this.snap.pending
    if (!p) return { status: 'NOT_FOUND' }
    const d = await this.read<RequestStatusData>('game.request.status', { requestId: p.body.requestId })
    if (d.status === 'FOUND') { localStorage.removeItem(PENDING_KEY); this.set({ pending: null }); await this.refresh() }
    return d
  }

  runStart(levelId: LevelId, route: Route) { return this.write<RunStartData>('game.run.start', { levelId, route }, '开始探索') }
  runGet(runId: string) { return this.read<RunGetData>('game.run.get', { runId }) }
  /** A5 G13: read-only courtyard codes (layout + palette only). */
  gardenShareCreate() { return this.side<{ code: string; createdAtMs: number; items: number }>('game.garden.share.create', {}) }
  gardenShareRevoke() { return this.side<{ revoked: boolean }>('game.garden.share.revoke', {}) }
  gardenShareGet(code: string) { return this.read<GardenSnapshot>('game.garden.share.get', { code }) }
  gardenShareReact(code: string, reaction: GardenReaction) { return this.side<{ reaction: GardenReaction; already: boolean }>('game.garden.share.react', { code, reaction }) }
  runFinish(runId: string, proof: Proof) { return this.write<RunFinishData>('game.run.finish', { runId, proof }, '确认奖励') }
  runCancel(runId: string) { return this.write<RunCancelData>('game.run.cancel', { runId }, '放弃探索') }
  plantStart(plotId: PlotId, seedItemId: string) { return this.write<PlantStartData>('game.plant.start', { plotId, seedItemId }, '种植') }
  plantClaim(plotId: PlotId, plantingId: string) { return this.write<PlantClaimData>('game.plant.claim', { plotId, plantingId }, '收入背包') }
  gardenSave(paletteId: PaletteId, placements: Placement[]) { return this.write<GardenSaveData>('game.garden.save', { paletteId, placements }, '保存布置') }
  plantCare(plantId: PlantId) { return this.write<PlantCareData>('game.plant.care', { plantId }, '照料植物') }
  seasonClaim(termId: TermId) { return this.write<SeasonClaimData>('game.season.claim', { termId }, '领取节气信笺') }
  challengeMark(termId: TermId) { return this.write<ChallengeMarkData>('game.challenge.mark', { termId }, '标记自然挑战') }
  observeRecord(plantingId: string, stage: number) { return this.write<ObserveRecordData>('game.observe.record', { plantingId, stage }, '记录观察') }
  quizComplete(plantId: PlantId, answers: number[]) { return this.write<QuizCompleteData>('game.quiz.complete', { plantId, answers }, '提交问答') }
  craftMake(recipeId: string, inputs: Grant[]) { return this.write<CraftMakeData>('game.craft.make', { recipeId, inputs }, '制作手作') }
  accountStatus() { return this.read<AccountStatusData>('game.account.status', {}) }
  /** Side writes (06 §5.2): never change PlayerState, so they skip the pending-write banner. */
  private async side<T>(rpc: RpcName, payload: unknown): Promise<T> {
    if (!this.snap.online) throw new BusinessError({ code: 'SERVER_BUSY', message: '当前离线，联网后再操作', retryable: true })
    const body = { apiVersion: 1, clientBuild: CLIENT_BUILD, requestId: crypto.randomUUID(), payload }
    let res: RpcResponse<T>
    try { res = await this.transport.rpc<T>(rpc, body) } catch (e) { if (this.intercept(e)) throw e; throw new UnknownOutcomeError('网络中断，结果未确认，请稍后再试') }
    if (!res.ok) { this.track('error_shown', { code: res.error.code }); const be = new BusinessError(res.error); if (rpc !== 'game.account.delete') this.intercept(be); throw be }
    this.set({ serverOffsetMs: res.serverTimeMs - Date.now() })
    return res.data
  }
  feedbackSubmit(text: string, contact: string) { return this.side<FeedbackSubmitData>('game.feedback.submit', { text, contact }) }
  async heartbeat() {
    const d = await this.side<HeartbeatData>('game.playtime.heartbeat', {})
    if (d.result) { this.set({ account: d.result }); const g = gateFor(d.result); if (g) this.set({ phase: 'gate', gate: g }) }
    return d
  }
  /* ---------- phone login / realname (bencao-auth) ---------- */
  async loginWithTicket(ticket: string) {
    if (!this.transport.loginWithTicket) throw new Error('当前模式不支持手机号登录')
    await this.transport.loginWithTicket(ticket)
    await this.boot()
  }
  async submitRealname(name: string, idNumber: string) {
    const token = await this.transport.token!()
    const r = await submitRealname(token, name, idNumber)
    await this.boot()
    this.track('realname_result', { result: r.realnameStatus === 'PENDING' ? 'pending' : r.realnameStatus === 'UNVERIFIED' ? 'failed' : 'passed' })
    return r.realnameStatus
  }
  async refreshRealname() {
    const token = await this.transport.token!()
    const r = await getRealnameStatus(token)
    await this.boot()
    this.track('realname_result', { result: r.realnameStatus === 'PENDING' ? 'pending' : r.realnameStatus === 'UNVERIFIED' ? 'failed' : 'passed' })
  }
  async logout() {
    await this.transport.logout?.()
    this.set({ phase: 'gate', gate: { kind: 'login' }, state: null, account: null, userId: null })
  }
  async accountDelete() {
    const d = await this.side<AccountDeleteData>('game.account.delete', { confirm: true })
    for (const k of Object.keys(localStorage)) if (k.startsWith('bcy.')) localStorage.removeItem(k)
    this.transport.forget?.()
    return d
  }
  /** F17: queue ≤20 whitelisted events, only while the player has opted in; dropped otherwise. */
  private queue: { eventName: string; fields: Record<string, unknown> }[] = []
  private flushTimer = 0
  track(eventName: string, fields: Record<string, unknown> = {}) {
    if (this.snap.state?.consent.telemetry !== true || this.snap.phase !== 'ready') return
    if (this.queue.length >= 20) this.queue.shift()
    this.queue.push({ eventName, fields })
    if (!this.flushTimer) this.flushTimer = window.setTimeout(() => { this.flushTimer = 0; void this.flush() }, 8000)
  }
  async flush() {
    if (!this.queue.length || this.snap.state?.consent.telemetry !== true || !this.snap.online) { this.queue = []; return }
    const events = this.queue.splice(0, 20)
    try { await this.side<TelemetryTrackData>('game.telemetry.track', { events }) } catch { /* best effort, never retried */ }
  }
  tutorialSkip() { return this.write<TutorialSkipData>('game.tutorial.skip', {}, '跳过引导').then(d => { this.track('tutorial_skip', {}); return d }) }
  /** Cross-device parent-mode preference. The UI still applies it locally for instant feedback. */
  settingsUpdate(parentMode: boolean) { return this.write<SettingsUpdateData>('game.settings.update', { parentMode }, '亲子模式') }
  /** A5 G7: one-time code (10 min) that moves this account's save into another fresh account. */
  transferCreate() { return this.side<TransferCreateResult>('game.transfer.create', {}) }
  transferClaim(code: string) { return this.write<{ state: PlayerState; result: TransferClaimResult }>('game.transfer.claim', { code }, '接收进度') }
  /**
   * After switching to phone login: if this browser still has a device-trial account with progress, issue a code
   * with that trial session and claim it into the current (fresh) phone account. Returns null when nothing to move.
   */
  hasTrialAccount() { return this.transport.hasTrialAccount?.() ?? Promise.resolve(false) }
  async migrateTrial(): Promise<TransferClaimResult | null> {
    if (!this.transport.rpcAsTrial) return null
    const body = { apiVersion: 1, clientBuild: CLIENT_BUILD, requestId: crypto.randomUUID(), payload: {} }
    const res = await this.transport.rpcAsTrial<TransferCreateResult>('game.transfer.create', body)
    if (!res) return null
    if (!res.ok) throw new BusinessError(res.error)
    if (!res.data.sourceHasProgress) return null
    return (await this.transferClaim(res.data.code)).result
  }
}

export type { FinishResult }

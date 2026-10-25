// Local demo server: implements the documented Nakama RPC contract in the browser so the full
// frontend loop can be played without a Nakama endpoint. It is NOT cloud storage and gives no
// server-side authority or anti-cheat guarantee; the UI labels it as a local demo.
import { CONFIG_VERSION, LEVELS, RULES, TRIAL_NOTICE, CLIENT_BUILD } from '../shared/content'
import { STATE_ACTIONS, applyStateAction, preRevisionReplay } from '../shared/actions'
import {
  RuleError, applyFinish, clone, createInitialState, dayKeyUtc8, isLevelOpen, migrateState, previewReward,
  repeatRemaining, seasonView, tutorialForcesPlantRoute, validateFeedback, validateProof, validateTelemetry,
} from '../shared/rules'
import type {
  AccountStatusData, ErrorCode, ExploreRun, LevelId, PaletteId, PlayerState, Proof, Route, RpcName, RpcResponse, RunSummary,
} from '../shared/types'
import { SIDE_WRITES, WRITE_RPCS } from '../shared/types'
import {
  TRANSFER_TRIES_PER_HOUR, TRANSFER_TTL_MS, claimSummary, codeFromHex, hasProgress, isFreshState, normalizeCode, transferStates,
} from '../shared/transfer'

type Receipt = { requestId: string; rpcName: RpcName; fingerprint: string; createdAtMs: number; appliedStateRevision: number; result: unknown }
type Db = {
  state: PlayerState | null; runs: Record<string, ExploreRun>; receipts: Record<string, Receipt>
  runStartRate: { minuteKey: number; count: number }
  feedback: { atMs: number; text: string; contact: string }[]; telemetry: { atMs: number; eventName: string }[]
}
type TransferCode = { sourceUserId: string; createdAtMs: number; expiresAtMs: number; usedAtMs: number | null }
type GardenShare = { ownerUserId: string; paletteId: PaletteId; placements: { itemId: string; x: number; y: number }[]; createdAtMs: number; revoked: boolean }
type SharedDb = {
  transfers: Record<string, TransferCode>
  transferRecords: Record<string, { code: string; createdAtMs: number; expiresAtMs: number }>
  transferTries: Record<string, { hourKey: number; count: number }>
  gardenShares: Record<string, GardenShare>
  gardenShareRecords: Record<string, { code: string; createdAtMs: number }>
  gardenShareMisses: Record<string, { hourKey: number; count: number }>
  gardenReactions: Record<string, Record<string, number>>
  gardenReacts: Record<string, { dayKey: string; reaction: string }>
}
const GARDEN_REACTIONS = ['heart', 'flower', 'clap', 'wow'] as const
const GARDEN_SHARE_MISSES_PER_HOUR = 30
const stable = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
  if (v && typeof v === 'object') return `{${Object.keys(v as object).sort().map(k => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`
  return JSON.stringify(v)
}
const uuid = () => crypto.randomUUID()
const MAX_BODY = 32 * 1024
const FEEDBACK_PER_DAY = 10

export type DemoOptions = { userId: string; now?: () => number; storage?: Storage; latencyMs?: number }
export class LocalDemoServer {
  private key: string
  private sharedKey = 'bcy.demo.shared.v1'
  private now: () => number
  private storage: Storage
  private latency: number
  /** Test hook: when set, the next write is applied but its response is "lost" in transit. */
  dropNextResponse = false
  constructor(private opts: DemoOptions) {
    this.key = `bcy.demo.v1.${opts.userId}`
    this.now = opts.now ?? Date.now
    this.storage = opts.storage ?? localStorage
    this.latency = opts.latencyMs ?? 120
  }
  private keyFor(userId: string) { return `bcy.demo.v1.${userId}` }
  private loadFor(userId: string): Db {
    const raw = this.storage.getItem(this.keyFor(userId))
    const db: Db = raw ? JSON.parse(raw) : { state: null, runs: {}, receipts: {}, runStartRate: { minuteKey: 0, count: 0 }, feedback: [], telemetry: [] }
    db.feedback ??= []; db.telemetry ??= []
    return db
  }
  private saveFor(userId: string, db: Db) { this.storage.setItem(this.keyFor(userId), JSON.stringify(db)) }
  private load(): Db { return this.loadFor(this.opts.userId) }
  private save(db: Db) { this.saveFor(this.opts.userId, db) }
  private loadShared(): SharedDb {
    const raw = this.storage.getItem(this.sharedKey)
    const d: Partial<SharedDb> = raw ? JSON.parse(raw) : {}
    return {
      transfers: d.transfers ?? {}, transferRecords: d.transferRecords ?? {}, transferTries: d.transferTries ?? {},
      gardenShares: d.gardenShares ?? {}, gardenShareRecords: d.gardenShareRecords ?? {}, gardenShareMisses: d.gardenShareMisses ?? {},
      gardenReactions: d.gardenReactions ?? {}, gardenReacts: d.gardenReacts ?? {},
    }
  }
  private saveShared(d: SharedDb) { this.storage.setItem(this.sharedKey, JSON.stringify(d)) }
  /** Read-only courtyard snapshot by 8-char code; misses are rate-limited like the Nakama module. */
  private gardenShareGet(shared: SharedDb, db: Db, p: Record<string, unknown>, now: number): RpcResponse<unknown> {
    const userId = this.opts.userId
    const hourKey = Math.floor(now / 3_600_000)
    const tries = shared.gardenShareMisses[userId]
    const used = tries && tries.hourKey === hourKey ? tries.count : 0
    if (used >= GARDEN_SHARE_MISSES_PER_HOUR) return this.err(db, 'RATE_LIMITED', '查询次数较多，请一小时后再试', true, (hourKey + 1) * 3_600_000 - now)
    const miss = (): RpcResponse<unknown> => {
      shared.gardenShareMisses[userId] = { hourKey, count: used + 1 }
      this.saveShared(shared)
      return this.err(db, 'TRANSFER_CODE_INVALID', '口令无效或已被撤销')
    }
    const code = normalizeCode(p.code)
    if (!code) return miss()
    const share = shared.gardenShares[code]
    const rec = share ? shared.gardenShareRecords[share.ownerUserId] : null
    if (!share || share.revoked || !rec || rec.code !== code) return miss()
    const mine = share.ownerUserId === userId
    const mark = mine ? null : shared.gardenReacts[`${userId}:${code}`]
    return this.ok(db, {
      paletteId: share.paletteId,
      placements: share.placements.map((x, i) => ({ instanceId: `v${i}`, itemId: x.itemId, x: x.x, y: x.y })),
      createdAtMs: share.createdAtMs,
      mine,
      reactions: mine ? (shared.gardenReactions[code] ?? {}) : undefined,
      reactedToday: mark && mark.dayKey === dayKeyUtc8(now) ? mark.reaction : null,
    })
  }
  async rpc<T>(name: RpcName, body: unknown): Promise<RpcResponse<T>> {
    if (this.latency) await new Promise(r => setTimeout(r, this.latency))
    const res = this.handle(name, body) as RpcResponse<T>
    if (this.dropNextResponse && WRITE_RPCS.has(name)) {
      this.dropNextResponse = false
      throw new Error('network: response lost')
    }
    return res
  }
  private ok(db: Db, data: unknown, replayed = false) {
    return { ok: true as const, apiVersion: 1 as const, serverTimeMs: this.now(), configVersion: CONFIG_VERSION, stateRevision: db.state?.stateRevision ?? 0, replayed, data }
  }
  private err(db: Db, code: ErrorCode, message: string, retryable = false, retryAfterMs?: number) {
    return { ok: false as const, apiVersion: 1 as const, serverTimeMs: this.now(), stateRevision: db.state?.stateRevision ?? 0, error: { code, message, retryable, ...(retryAfterMs ? { retryAfterMs } : {}) } }
  }
  private summary(run: ExploreRun, now: number): RunSummary {
    const status = run.status === 'ACTIVE' && now >= run.expiresAtMs ? 'EXPIRED' : run.status
    return { runId: run.runId, levelId: run.levelId, route: run.route, status, shuffleSeed: run.shuffleSeed, startedAtMs: run.startedAtMs, expiresAtMs: run.expiresAtMs, configVersion: run.configVersion }
  }
  private stateData(db: Db, now: number) {
    const s = db.state!
    const run = s.activeRunId ? db.runs[s.activeRunId] : null
    const activeRun = run ? this.summary(run, now) : null
    return { state: s, activeRun: activeRun && activeRun.status === 'ACTIVE' ? activeRun : null, dayKey: dayKeyUtc8(now), repeatRewardRemaining: repeatRemaining(s, now), season: seasonView(now) }
  }
  private accountStatus(now: number): AccountStatusData {
    // Device trial: phone/realname service (bencao-auth) is not wired; no minor restriction is claimed.
    return { accountStatus: 'ACTIVE', realnameStatus: 'UNVERIFIED', minorPolicy: { restricted: false, serverTimeMs: now, playableUntilMs: null }, authMode: 'device_trial' }
  }
  handle(name: RpcName, body: unknown): RpcResponse<unknown> {
    const db = this.load(); const shared = this.loadShared(); const now = this.now()
    try {
      if (JSON.stringify(body ?? null).length > MAX_BODY) return this.err(db, 'INVALID_PAYLOAD', '请求过大')
      const b = body as { apiVersion?: number; requestId?: string; expectedStateRevision?: number; payload?: Record<string, unknown> }
      if (!b || b.apiVersion !== 1) return this.err(db, 'UNSUPPORTED_API_VERSION', '客户端版本过旧，请刷新页面')
      if (!b.payload || typeof b.payload !== 'object') return this.err(db, 'INVALID_PAYLOAD', '请求格式错误')
      if (name === 'game.bootstrap') {
        if (!db.state) { db.state = createInitialState(now); this.save(db) } else {
          const m = migrateState(db.state); if (m.changed) { db.state = m.state; this.save(db) }
        }
        return this.ok(db, { ...this.stateData(db, now), contentProfile: 'chengdu_v1', minClientBuild: CLIENT_BUILD, trialNotice: TRIAL_NOTICE })
      }
      if (name === 'game.account.status') return this.ok(db, this.accountStatus(now))
      if (!db.state) return this.err(db, 'INVALID_PAYLOAD', '请先完成初始化')
      if (name === 'game.state.get') return this.ok(db, this.stateData(db, now))
      if (name === 'game.garden.share.get') return this.gardenShareGet(shared, db, b.payload, now)
      if (name === 'game.run.get') {
        const run = db.runs[String(b.payload.runId)]
        if (!run) return this.err(db, 'RUN_NOT_FOUND', '没有找到这次探索')
        return this.ok(db, { run: { ...this.summary(run, now), finishResult: run.finishResult } })
      }
      if (name === 'game.request.status') {
        const rc = db.receipts[String(b.payload.requestId)]
        return this.ok(db, rc ? { status: 'FOUND', rpcName: rc.rpcName, result: rc.result, appliedStateRevision: rc.appliedStateRevision } : { status: 'NOT_FOUND' })
      }
      if (!WRITE_RPCS.has(name)) return this.err(db, 'INVALID_PAYLOAD', '未知接口')
      const side = SIDE_WRITES.has(name)
      if (typeof b.requestId !== 'string' || !/^[0-9a-f-]{36}$/.test(b.requestId) || (!side && !Number.isInteger(b.expectedStateRevision))) return this.err(db, 'INVALID_PAYLOAD', '写请求缺少 requestId 或版本号')
      const fingerprint = stable({ name, apiVersion: 1, expectedStateRevision: side ? null : b.expectedStateRevision, payload: b.payload })
      const existing = db.receipts[b.requestId]
      if (existing) {
        if (existing.fingerprint !== fingerprint || existing.rpcName !== name) return this.err(db, 'IDEMPOTENCY_KEY_REUSED', '同一请求编号不能用于不同操作')
        return this.ok(db, { state: db.state, result: existing.result }, true)
      }
      if (side) return this.sideWrite(db, shared, name, b.requestId, fingerprint, b.payload, now)
      return this.write(db, shared, name, b.requestId, fingerprint, b.expectedStateRevision!, b.payload, now)
    } catch (e) {
      if (e instanceof RuleError) return this.err(db, e.code, e.message)
      console.error('[demo-server]', e)
      return this.err(db, 'INTERNAL_ERROR', '服务暂时不可用', true)
    }
  }
  private commit(db: Db, requestId: string, name: RpcName, fingerprint: string, state: PlayerState | null, result: unknown, now: number, replayed = false) {
    db.state = state
    db.receipts[requestId] = { requestId, rpcName: name, fingerprint, createdAtMs: now, appliedStateRevision: state?.stateRevision ?? 0, result }
    this.save(db)
    return this.ok(db, { state, result }, replayed)
  }
  private sideWrite(db: Db, shared: SharedDb, name: RpcName, requestId: string, fp: string, p: Record<string, unknown>, now: number) {
    const s = db.state!
    switch (name) {
      case 'game.transfer.create': {
        const userId = this.opts.userId
        const rec = shared.transferRecords[userId]
        if (rec && now - rec.createdAtMs < 15_000) throw new RuleError('RATE_LIMITED', '刚刚生成过转移码，请稍后再试')
        let code = ''
        for (let i = 0; i < 6; i++) { const c = codeFromHex(crypto.randomUUID() + crypto.randomUUID()); if (c.length === 8 && !shared.transfers[c]) { code = c; break } }
        if (!code) throw new RuleError('SERVER_BUSY', '请重试')
        const expiresAtMs = now + TRANSFER_TTL_MS
        shared.transfers[code] = { sourceUserId: userId, createdAtMs: now, expiresAtMs, usedAtMs: null }
        shared.transferRecords[userId] = { code, createdAtMs: now, expiresAtMs }
        this.saveShared(shared)
        return this.commit(db, requestId, name, fp, s, { code, expiresAtMs, sourceHasProgress: hasProgress(s) }, now)
      }
      case 'game.garden.share.create': {
        const userId = this.opts.userId
        const rec = shared.gardenShareRecords[userId]
        if (rec && now - rec.createdAtMs < 15_000) throw new RuleError('RATE_LIMITED', '刚刚生成过口令，请稍后再试')
        if (!s.garden.placements.length) throw new RuleError('INVALID_PAYLOAD', '小院还是空的，先摆几件再分享吧')
        let code = ''
        for (let i = 0; i < 6; i++) { const c = codeFromHex(crypto.randomUUID() + crypto.randomUUID()); if (c.length === 8 && !shared.gardenShares[c]) { code = c; break } }
        if (!code) throw new RuleError('SERVER_BUSY', '请重试')
        const old = rec ? shared.gardenShares[rec.code] : null
        if (old && !old.revoked) old.revoked = true
        shared.gardenShares[code] = {
          ownerUserId: userId, paletteId: s.garden.paletteId,
          placements: s.garden.placements.map(x => ({ itemId: x.itemId, x: x.x, y: x.y })),
          createdAtMs: now, revoked: false,
        }
        shared.gardenShareRecords[userId] = { code, createdAtMs: now }
        this.saveShared(shared)
        return this.commit(db, requestId, name, fp, s, { code, createdAtMs: now, items: s.garden.placements.length }, now)
      }
      case 'game.garden.share.revoke': {
        const userId = this.opts.userId
        const rec = shared.gardenShareRecords[userId]
        if (!rec || !rec.code) return this.commit(db, requestId, name, fp, s, { revoked: false }, now)
        const old = shared.gardenShares[rec.code]
        if (old) old.revoked = true
        delete shared.gardenShareRecords[userId]
        this.saveShared(shared)
        return this.commit(db, requestId, name, fp, s, { revoked: true }, now)
      }
      case 'game.garden.share.react': {
        const userId = this.opts.userId
        const code = normalizeCode(p.code)
        const reaction = String(p.reaction ?? '')
        if (!code) throw new RuleError('TRANSFER_CODE_INVALID', '口令无效或已被撤销')
        if (!(GARDEN_REACTIONS as readonly string[]).includes(reaction)) throw new RuleError('INVALID_PAYLOAD', '不支持的回应')
        const share = shared.gardenShares[code]
        const ownerRec = share ? shared.gardenShareRecords[share.ownerUserId] : null
        if (!share || share.revoked || !ownerRec || ownerRec.code !== code) throw new RuleError('TRANSFER_CODE_INVALID', '口令无效或已被撤销')
        if (share.ownerUserId === userId) throw new RuleError('INVALID_PAYLOAD', '这是你自己的小院')
        const markKey = `${userId}:${code}`
        const mark = shared.gardenReacts[markKey]
        if (mark && mark.dayKey === dayKeyUtc8(now)) return this.commit(db, requestId, name, fp, s, { reaction: mark.reaction, already: true }, now)
        const counts = shared.gardenReactions[code] ?? {}
        counts[reaction] = (counts[reaction] || 0) + 1
        shared.gardenReactions[code] = counts
        shared.gardenReacts[markKey] = { dayKey: dayKeyUtc8(now), reaction }
        this.saveShared(shared)
        return this.commit(db, requestId, name, fp, s, { reaction, already: false }, now)
      }
      case 'game.feedback.submit': {
        const f = validateFeedback(p.text, p.contact)
        const day = dayKeyUtc8(now)
        if (db.feedback.filter(x => dayKeyUtc8(x.atMs) === day).length >= FEEDBACK_PER_DAY) return this.err(db, 'RATE_LIMITED', '今天提交的反馈较多，请明天再试', true)
        db.feedback.push({ atMs: now, ...f })
        return this.commit(db, requestId, name, fp, s, { acceptedAtMs: now }, now)
      }
      case 'game.telemetry.track': {
        const events = validateTelemetry(s, p.events)
        for (const e of events) db.telemetry.push({ atMs: now, eventName: e.eventName })
        db.telemetry = db.telemetry.slice(-500)
        return this.commit(db, requestId, name, fp, s, { acceptedCount: events.length, receivedAtMs: now }, now)
      }
      case 'game.playtime.heartbeat':
        return this.commit(db, requestId, name, fp, s, this.accountStatus(now), now)
      case 'game.account.delete': {
        if (p.confirm !== true) return this.err(db, 'INVALID_PAYLOAD', '需要确认注销')
        // Demo: wipe everything for this local player (cloud mode deletes server storage + account).
        this.storage.removeItem(this.key)
        return this.ok({ ...db, state: null }, { state: null, result: { accountStatus: 'DELETED', deletedAtMs: now } })
      }
      default: return this.err(db, 'INVALID_PAYLOAD', '未知接口')
    }
  }
  private write(db: Db, shared: SharedDb, name: RpcName, requestId: string, fp: string, expected: number, p: Record<string, unknown>, now: number) {
    const s = db.state!
    // run.finish of an already-finished run replays its original settlement before any revision check.
    if (name === 'game.run.finish') {
      const run = db.runs[String(p.runId)]
      if (run?.status === 'FINISHED' && run.finishResult) return this.commit(db, requestId, name, fp, s, run.finishResult, now, true)
    }
    if (name === 'game.run.cancel') {
      const run = db.runs[String(p.runId)]
      if (run?.status === 'CANCELLED') return this.commit(db, requestId, name, fp, s, { runId: run.runId, status: 'CANCELLED' }, now, true)
    }
    const pre = preRevisionReplay(name, s)
    if (pre) return this.commit(db, requestId, name, fp, s, pre.result, now, true)
    if (expected !== s.stateRevision) return this.err(db, 'STATE_CONFLICT', '进度已更新，请刷新后确认操作')
    if (STATE_ACTIONS.has(name)) {
      const out = applyStateAction(name, s, p, { nowMs: now, userId: this.opts.userId, uuid })
      return this.commit(db, requestId, name, fp, out.state, out.result, now)
    }
    switch (name) {
      case 'game.run.start': {
        const levelId = p.levelId as LevelId; const route = p.route as Route
        if (!LEVELS[levelId] || (route !== 'plant' && route !== 'decor')) return this.err(db, 'INVALID_PAYLOAD', '关卡或路线无效')
        if (!isLevelOpen(s, levelId)) return this.err(db, 'SCENE_LOCKED', '这个景点还没有开放')
        if (route === 'decor' && tutorialForcesPlantRoute(s, levelId)) return this.err(db, 'INVALID_PAYLOAD', '新手第一次探索请选择苗圃路线')
        const next = clone(s)
        if (next.activeRunId) {
          const old = db.runs[next.activeRunId]
          if (old && old.status === 'ACTIVE' && now < old.expiresAtMs) return this.err(db, 'ACTIVE_RUN_EXISTS', '还有一次未结束的探索')
          if (old && old.status === 'ACTIVE') db.runs[old.runId] = { ...old, status: 'EXPIRED' }
        }
        const minuteKey = Math.floor(now / 60_000)
        const rate = db.runStartRate.minuteKey === minuteKey ? db.runStartRate : { minuteKey, count: 0 }
        if (rate.count >= RULES.runStartPerMinute) return this.err(db, 'RATE_LIMITED', '操作太快了，请稍后再出发', true, (minuteKey + 1) * 60_000 - now)
        const run: ExploreRun = {
          runId: uuid(), userId: this.opts.userId, levelId, route, configVersion: CONFIG_VERSION,
          shuffleSeed: Math.floor(Math.random() * 2 ** 31), status: 'ACTIVE', startedAtMs: now,
          expiresAtMs: now + RULES.runTtlMs, finishedAtMs: null, finishResult: null,
        }
        db.runs[run.runId] = run
        db.runStartRate = { minuteKey, count: rate.count + 1 }
        next.activeRunId = run.runId; next.stateRevision += 1
        const preview = previewReward(next, levelId, route, now, { userId: this.opts.userId, runId: run.runId })
        return this.commit(db, requestId, name, fp, next, { run: this.summary(run, now), preview }, now)
      }
      case 'game.run.finish': {
        const run = db.runs[String(p.runId)]
        if (!run) return this.err(db, 'RUN_NOT_FOUND', '没有找到这次探索')
        if (run.status === 'CANCELLED') return this.err(db, 'RUN_CANCELLED', '这次探索已取消')
        if (run.status === 'EXPIRED' || now >= run.expiresAtMs) return this.err(db, 'RUN_EXPIRED', '这次探索已过期，请重新出发')
        if (run.configVersion !== CONFIG_VERSION) return this.err(db, 'CONFIG_EXPIRED', '内容版本已更新，请重新出发')
        validateProof(run.levelId, p.proof as Proof)
        const { state, result } = applyFinish(s, run.runId, run.levelId, run.route, now, this.opts.userId)
        db.runs[run.runId] = { ...run, status: 'FINISHED', finishedAtMs: now, finishResult: result }
        return this.commit(db, requestId, name, fp, state, result, now)
      }
      case 'game.run.cancel': {
        const run = db.runs[String(p.runId)]
        if (!run) return this.err(db, 'RUN_NOT_FOUND', '没有找到这次探索')
        if (run.status === 'FINISHED') return this.err(db, 'RUN_ALREADY_FINISHED', '这次探索已经完成')
        db.runs[run.runId] = { ...run, status: 'CANCELLED' }
        const next = clone(s); if (next.activeRunId === run.runId) next.activeRunId = null
        next.stateRevision += 1
        return this.commit(db, requestId, name, fp, next, { runId: run.runId, status: 'CANCELLED' }, now)
      }
      case 'game.transfer.claim': {
        const userId = this.opts.userId
        const hourKey = Math.floor(now / 3_600_000)
        const tries = shared.transferTries[userId]
        const used = tries && tries.hourKey === hourKey ? tries.count : 0
        if (used >= TRANSFER_TRIES_PER_HOUR) throw new RuleError('RATE_LIMITED', '输错次数较多，请一小时后再试')
        const bad = (message: string): never => {
          shared.transferTries[userId] = { hourKey, count: used + 1 }
          this.saveShared(shared)
          throw new RuleError('TRANSFER_CODE_INVALID', message)
        }
        const code = normalizeCode(p.code)
        if (!code) return bad('转移码应为 8 位字母和数字')
        const t = shared.transfers[code]
        if (!t || t.usedAtMs !== null || now >= t.expiresAtMs) return bad('转移码无效、已使用或已过期')
        if (t.sourceUserId === userId) throw new RuleError('INVALID_PAYLOAD', '这是本账号生成的转移码，请在另一个浏览器或新账号里输入')
        const srcRec = shared.transferRecords[t.sourceUserId]
        if (!srcRec || srcRec.code !== code) return bad('这个转移码已被更新的转移码替换')
        if (!isFreshState(s)) throw new RuleError('TARGET_HAS_PROGRESS', '当前账号已经有进度，不能覆盖。请在还没开始玩的账号里输入转移码')
        const srcDb = this.loadFor(t.sourceUserId)
        if (!srcDb.state) return bad('转移码对应的进度不存在')
        const out = transferStates(migrateState(srcDb.state).state, s, now)
        t.usedAtMs = now
        srcDb.state = out.source
        this.saveFor(t.sourceUserId, srcDb)
        this.saveShared(shared)
        return this.commit(db, requestId, name, fp, out.target, claimSummary(out.target, now), now)
      }
      default:
        return this.err(db, 'INVALID_PAYLOAD', '未知接口')
    }
  }
}

// 本草小游记 · Nakama TypeScript runtime module (server-authoritative game state).
// Mirrors the RPC contract implemented by src/net/localDemoServer.ts (behaviour oracle) and
// 06_后端技术规格与接口契约.md §3–5, using the SAME pure rules (src/shared/rules.ts, content.ts).
//
// Storage (owner = ctx.userId, permissionRead 0 / permissionWrite 0 — runtime only):
//   game_player/state      PlayerState
//   game_player/meta       { runStartRate }
//   game_runs/<runId>      ExploreRun
//   game_receipts/<reqId>  Receipt (idempotency)
// Every state-changing write is ONE nk.storageWrite batch (single DB transaction) with
// storage-version CAS on state/meta/run and create-only ("*") on new run + receipt.
import { CONFIG_VERSION, LEVELS, RULES, TRIAL_NOTICE, CLIENT_BUILD, configureSeason } from '../../../src/shared/content'
import { STATE_ACTIONS, applyStateAction, preRevisionReplay } from '../../../src/shared/actions'
import {
  applyFinish, clone, createInitialState, dayKeyUtc8, isLevelOpen, migrateState, previewReward, repeatRemaining,
  seasonView, tutorialForcesPlantRoute, validateFeedback, validateProof, validateTelemetry,
} from '../../../src/shared/rules'
import type {
  AccountStatusData, ErrorCode, ExploreRun, LevelId, PlayerState, Proof, Route, RpcName, RunSummary,
} from '../../../src/shared/types'
import { ERROR_CODES, SIDE_WRITES, WRITE_RPCS } from '../../../src/shared/types'

import { accountStatusFor, authCfg, beforeAuthCustom, beforeAuthDevice, beforeSessionRefresh, deleteIdentity, enforceGate, recordPlaytime, type GateResult } from './authGate'
/* eslint-disable @typescript-eslint/no-explicit-any */
type Nk = any; type Ctx = any; type Logger = any

const C_PLAYER = 'game_player'
const C_RUNS = 'game_runs'
const C_RECEIPTS = 'game_receipts'
const C_FEEDBACK = 'game_feedback'
const C_TELEMETRY = 'game_telemetry'
const C_TRANSFER = 'game_transfer'
const C_GARDEN_SHARE = 'game_garden_share'
/** System-owned objects (transfer codes) are stored under Nakama's nil user id. */
const SYSTEM_USER = '00000000-0000-0000-0000-000000000000'
const PROTECTED = [C_PLAYER, C_RUNS, C_RECEIPTS, C_FEEDBACK, C_TELEMETRY, C_TRANSFER, C_GARDEN_SHARE]
const FEEDBACK_PER_DAY = 10
const MAX_BODY = 32 * 1024
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const WRITES: RpcName[] = Array.from(WRITE_RPCS)
type Receipt = { requestId: string; rpcName: RpcName; fingerprint: string; createdAtMs: number; appliedStateRevision: number; result: unknown }
type Meta = { runStartRate: { minuteKey: number; count: number }; feedbackDay?: { dayKey: string; count: number } }
type Obj<T> = { value: T; version: string } | null

import { Fail } from './fail'
import { cmpBuild } from '../../../src/shared/version'
import {
  TRANSFER_TRIES_PER_HOUR, TRANSFER_TTL_MS, claimSummary, codeFromHex, hasProgress, isFreshState, normalizeCode, transferStates,
} from '../../../src/shared/transfer'
type TransferCode = { sourceUserId: string; createdAtMs: number; expiresAtMs: number; usedAtMs: number | null; targetUserId?: string }
type TransferRecord = { code: string; createdAtMs: number; expiresAtMs: number }
// A5 G13: a read-only snapshot of a saved courtyard (layout + palette ONLY — no ids, names or progress are returned).
type GardenShare = { ownerUserId: string; paletteId: string; placements: { itemId: string; x: number; y: number }[]; createdAtMs: number; revoked: boolean }
type GardenShareRecord = { code: string; createdAtMs: number }
const GARDEN_SHARE_MISSES_PER_HOUR = 30
const GARDEN_REACTIONS = ['heart', 'flower', 'clap', 'wow']
type GardenReactions = { counts: Record<string, number>; updatedAtMs: number }
/** BE-06: minimum client build accepted for writes; env BCY_MIN_CLIENT_BUILD, default = this server's build. */
let MIN_CLIENT_BUILD: string = CLIENT_BUILD

const stable = (v: unknown): string => {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']'
  if (v && typeof v === 'object') return '{' + Object.keys(v as object).sort().map(k => JSON.stringify(k) + ':' + stable((v as Record<string, unknown>)[k])).join(',') + '}'
  return JSON.stringify(v)
}

function read<T>(nk: Nk, userId: string, collection: string, key: string): Obj<T> {
  const r = nk.storageRead([{ collection, key, userId }])
  if (!r || r.length === 0) return null
  return { value: r[0].value as T, version: r[0].version }
}
const w = (userId: string, collection: string, key: string, value: unknown, version: string | undefined) => ({
  collection, key, userId, value, version, permissionRead: 0, permissionWrite: 0,
})

function summary(run: ExploreRun, now: number): RunSummary {
  const status = run.status === 'ACTIVE' && now >= run.expiresAtMs ? 'EXPIRED' : run.status
  return { runId: run.runId, levelId: run.levelId, route: run.route, status, shuffleSeed: run.shuffleSeed, startedAtMs: run.startedAtMs, expiresAtMs: run.expiresAtMs, configVersion: run.configVersion }
}

function ok(now: number, rev: number, data: unknown, replayed = false) {
  return JSON.stringify({ ok: true, apiVersion: 1, serverTimeMs: now, configVersion: CONFIG_VERSION, stateRevision: rev, replayed, data })
}
function err(now: number, rev: number, f: Fail) {
  const e: Record<string, unknown> = { code: f.code, message: f.message, retryable: f.retryable }
  if (f.retryAfterMs) e.retryAfterMs = f.retryAfterMs
  return JSON.stringify({ ok: false, apiVersion: 1, serverTimeMs: now, stateRevision: rev, error: e })
}

function stateData(nk: Nk, userId: string, s: PlayerState, now: number) {
  let activeRun: RunSummary | null = null
  if (s.activeRunId) {
    const run = read<ExploreRun>(nk, userId, C_RUNS, s.activeRunId)
    if (run) { const sm = summary(run.value, now); if (sm.status === 'ACTIVE') activeRun = sm }
  }
  return { state: s, activeRun, dayKey: dayKeyUtc8(now), repeatRewardRemaining: repeatRemaining(s, now), season: seasonView(now) }
}
/** Gate result of the RPC currently executing (goja runs one call at a time per VM). */
let CURRENT_GATE: GateResult | null = null

/** Ensure the player's state exists (create-only; on race, re-read). */
function ensureState(nk: Nk, userId: string, now: number): { value: PlayerState; version: string } {
  const cur = read<PlayerState>(nk, userId, C_PLAYER, 'state')
  if (cur) {
    const m = migrateState(cur.value)
    if (!m.changed) return cur
    try { nk.storageWrite([w(userId, C_PLAYER, 'state', m.state, cur.version)]) } catch (_e) { /* concurrent migration */ }
    const mig = read<PlayerState>(nk, userId, C_PLAYER, 'state')
    if (!mig) throw new Fail('INTERNAL_ERROR', '服务暂时不可用', true)
    return mig
  }
  const init = createInitialState(now)
  try {
    nk.storageWrite([w(userId, C_PLAYER, 'state', init, '*'), w(userId, C_PLAYER, 'meta', { runStartRate: { minuteKey: 0, count: 0 } }, '*')])
  } catch (_e) { /* concurrent bootstrap created it first */ }
  const again = read<PlayerState>(nk, userId, C_PLAYER, 'state')
  if (!again) throw new Fail('INTERNAL_ERROR', '服务暂时不可用', true)
  return again
}

type Body = { apiVersion?: number; clientBuild?: string; requestId?: string; expectedStateRevision?: number; payload?: Record<string, unknown> }

function parse(payload: string): Body {
  if (payload && payload.length > MAX_BODY) throw new Fail('INVALID_PAYLOAD', '请求过大')
  let b: Body
  try { b = JSON.parse(payload || '{}') } catch (_e) { throw new Fail('INVALID_PAYLOAD', '请求格式错误') }
  if (!b || typeof b !== 'object' || b.apiVersion !== 1) throw new Fail('UNSUPPORTED_API_VERSION', '客户端版本过旧，请刷新页面')
  if (!b.payload || typeof b.payload !== 'object' || Array.isArray(b.payload)) throw new Fail('INVALID_PAYLOAD', '请求格式错误')
  return b
}

function toFail(e: unknown, logger: Logger): Fail {
  if (e instanceof Fail) return e
  const anyE = e as { code?: string; message?: string }
  if (anyE && typeof anyE.code === 'string' && ERROR_CODES.indexOf(anyE.code as ErrorCode) >= 0) return new Fail(anyE.code as ErrorCode, anyE.message || '请求无效')
  logger.error('bencao internal error: %s', String((anyE && anyE.message) || e))
  return new Fail('INTERNAL_ERROR', '服务暂时不可用', true)
}

/* ---------------- read RPCs ---------------- */

function handleRead(name: RpcName, ctx: Ctx, logger: Logger, nk: Nk, payload: string): string {
  const now = Date.now(); let rev = 0
  try {
    const userId: string = ctx.userId
    if (!userId) throw new Fail('INVALID_PAYLOAD', '需要登录会话')
    const b = parse(payload)
    // account.status is readable in every state so the client can route to login/realname/restricted screens.
    if (name === 'game.account.status') return ok(now, 0, accountStatusFor(ctx, nk, now, true).status)
    enforceGate(ctx, logger, nk, now)
    if (name === 'game.garden.share.get') return ok(now, 0, gardenShareGet(nk, userId, b.payload || {}, now)) // after the gate
    if (name === 'game.bootstrap') {
      const st = ensureState(nk, userId, now); rev = st.value.stateRevision
      const d = stateData(nk, userId, st.value, now)
      return ok(now, rev, { state: d.state, activeRun: d.activeRun, dayKey: d.dayKey, repeatRewardRemaining: d.repeatRewardRemaining, contentProfile: 'chengdu_v1', minClientBuild: MIN_CLIENT_BUILD, trialNotice: TRIAL_NOTICE })
    }
    const st = read<PlayerState>(nk, userId, C_PLAYER, 'state')
    if (!st) throw new Fail('INVALID_PAYLOAD', '请先完成初始化')
    rev = st.value.stateRevision
    if (name === 'game.state.get') return ok(now, rev, stateData(nk, userId, st.value, now))
    if (name === 'game.run.get') {
      const runId = String(b.payload!.runId || '')
      const run = UUID_RE.test(runId) ? read<ExploreRun>(nk, userId, C_RUNS, runId) : null
      if (!run) throw new Fail('RUN_NOT_FOUND', '没有找到这次探索')
      const sm = summary(run.value, now) as RunSummary & { finishResult?: unknown }
      sm.finishResult = run.value.finishResult
      return ok(now, rev, { run: sm })
    }
    if (name === 'game.request.status') {
      const reqId = String(b.payload!.requestId || '')
      const rc = UUID_RE.test(reqId) ? read<Receipt>(nk, userId, C_RECEIPTS, reqId) : null
      return ok(now, rev, rc ? { status: 'FOUND', rpcName: rc.value.rpcName, result: rc.value.result, appliedStateRevision: rc.value.appliedStateRevision } : { status: 'NOT_FOUND' })
    }
    throw new Fail('INVALID_PAYLOAD', '未知接口')
  } catch (e) { return err(now, rev, toFail(e, logger)) }
}

/* ---------------- write RPCs ---------------- */

type Plan = { state: PlayerState; result: unknown; writes: unknown[]; replayed?: boolean }

function handleWrite(name: RpcName, ctx: Ctx, logger: Logger, nk: Nk, payload: string): string {
  const now = Date.now(); let rev = 0
  try {
    const userId: string = ctx.userId
    if (!userId) throw new Fail('INVALID_PAYLOAD', '需要登录会话')
    const b = parse(payload)
    // Deletion stays available whatever the realname/minor state is; everything else passes the full gate.
    // A5 G7: an old device-trial session (blocked by the realname gate) may still issue a transfer code for its own
    // save — no gameplay — so the player can carry trial progress into the new phone account.
    CURRENT_GATE = name === 'game.account.delete' || name === 'game.transfer.create' ? accountStatusFor(ctx, nk, now, true) : enforceGate(ctx, logger, nk, now)
    if (CURRENT_GATE.status.accountStatus === 'DELETED') throw new Fail('ACCOUNT_DELETED', '账号已注销')
    // BE-06: writes from builds older than the configured minimum are refused (deletion always allowed).
    if (name !== 'game.account.delete' && cmpBuild(String(b.clientBuild || '0'), MIN_CLIENT_BUILD) < 0) throw new Fail('CLIENT_OUTDATED', '游戏已更新，请刷新页面后继续')
    const side = SIDE_WRITES.has(name)
    if (typeof b.requestId !== 'string' || !UUID_RE.test(b.requestId) || (!side && (typeof b.expectedStateRevision !== 'number' || Math.floor(b.expectedStateRevision) !== b.expectedStateRevision))) {
      throw new Fail('INVALID_PAYLOAD', '写请求缺少 requestId 或版本号')
    }
    const requestId = b.requestId
    const fp = stable({ name, apiVersion: 1, expectedStateRevision: side ? null : b.expectedStateRevision, payload: b.payload })

    const replay = (): string | null => {
      const rc = read<Receipt>(nk, userId, C_RECEIPTS, requestId)
      if (!rc) return null
      if (rc.value.fingerprint !== fp || rc.value.rpcName !== name) throw new Fail('IDEMPOTENCY_KEY_REUSED', '同一请求编号不能用于不同操作')
      const cur = read<PlayerState>(nk, userId, C_PLAYER, 'state')
      const s = cur ? cur.value : null
      return ok(now, s ? s.stateRevision : 0, { state: s, result: rc.value.result }, true)
    }
    const early = replay(); if (early) return early

    // Deletion works even before a save exists (e.g. never passed the realname gate).
    if (name === 'game.account.delete') {
      if (b.payload!.confirm !== true) throw new Fail('INVALID_PAYLOAD', '需要确认注销')
      // Deletes the Nakama account and all of its storage objects (state, runs, receipts, feedback, telemetry).
      deleteIdentity(ctx, logger, nk, CURRENT_GATE.sub, requestId)
      nk.accountDeleteId(userId, false)
      try { nk.sessionLogout(userId) } catch { /* sessions already gone with the account */ }
      logger.info('bencao account deleted %s', userId)
      return ok(now, 0, { state: null, result: { accountStatus: 'DELETED', deletedAtMs: now } })
    }
    const st = read<PlayerState>(nk, userId, C_PLAYER, 'state')
    if (!st) throw new Fail('INVALID_PAYLOAD', '请先完成初始化')
    rev = st.value.stateRevision
    if (name === 'game.playtime.heartbeat') recordPlaytime(ctx, logger, nk, CURRENT_GATE.sub)
    const plan = side ? planSide(name, nk, userId, st.value, requestId, b.payload!, now) : planWrite(name, nk, userId, st, b.expectedStateRevision!, b.payload!, now)
    const receipt: Receipt = { requestId, rpcName: name, fingerprint: fp, createdAtMs: now, appliedStateRevision: plan.state.stateRevision, result: plan.result }
    const batch = plan.writes.concat([w(userId, C_RECEIPTS, requestId, receipt, '*')])
    try {
      nk.storageWrite(batch)
    } catch (e) {
      logger.warn('bencao CAS conflict on %s: %s', name, String((e as Error)?.message || e))
      const again = replay(); if (again) return again
      if (name === 'game.run.finish') {
        const run = read<ExploreRun>(nk, userId, C_RUNS, String(b.payload!.runId))
        if (run && run.value.status === 'FINISHED' && run.value.finishResult) {
          const cur = read<PlayerState>(nk, userId, C_PLAYER, 'state')
          return ok(now, cur ? cur.value.stateRevision : rev, { state: cur ? cur.value : null, result: run.value.finishResult }, true)
        }
      }
      throw new Fail('STATE_CONFLICT', '进度已更新，请刷新后确认操作')
    }
    return ok(now, plan.state.stateRevision, { state: plan.state, result: plan.result }, !!plan.replayed)
  } catch (e) { return err(now, rev, toFail(e, logger)) }
}

function planSide(name: RpcName, nk: Nk, userId: string, s: PlayerState, requestId: string, p: Record<string, unknown>, now: number): Plan {
  switch (name) {
    case 'game.feedback.submit': {
      const f = validateFeedback(p.text, p.contact)
      const meta = read<Meta>(nk, userId, C_PLAYER, 'meta')
      const day = dayKeyUtc8(now)
      const fd = meta && meta.value.feedbackDay && meta.value.feedbackDay.dayKey === day ? meta.value.feedbackDay : { dayKey: day, count: 0 }
      if (fd.count >= FEEDBACK_PER_DAY) throw new Fail('RATE_LIMITED', '今天提交的反馈较多，请明天再试', true)
      const nextMeta: Meta = { runStartRate: meta ? meta.value.runStartRate : { minuteKey: 0, count: 0 }, feedbackDay: { dayKey: day, count: fd.count + 1 } }
      return { state: s, result: { acceptedAtMs: now }, writes: [
        w(userId, C_FEEDBACK, requestId, { atMs: now, text: f.text, contact: f.contact, clientBuild: CLIENT_BUILD, status: 'NEW' }, '*'),
        w(userId, C_PLAYER, 'meta', nextMeta, meta ? meta.version : '*'),
      ] }
    }
    case 'game.telemetry.track': {
      const events = validateTelemetry(s, p.events)
      // De-identified: owner is the Nakama user id (pseudonymous); no device, IP or free text is stored.
      return { state: s, result: { acceptedCount: events.length, receivedAtMs: now }, writes: [w(userId, C_TELEMETRY, requestId, { atMs: now, dayKey: dayKeyUtc8(now), events }, '*')] }
    }
    case 'game.playtime.heartbeat':
      return { state: s, result: CURRENT_GATE ? CURRENT_GATE.status : null, writes: [] }
    case 'game.garden.share.create': {
      const rec = read<GardenShareRecord>(nk, userId, C_PLAYER, 'garden_share')
      if (rec && now - rec.value.createdAtMs < 15_000) throw new Fail('RATE_LIMITED', '刚刚生成过口令，请稍后再试', true, 15_000 - (now - rec.value.createdAtMs))
      if (!s.garden.placements.length) throw new Fail('INVALID_PAYLOAD', '小院还是空的，先摆几件再分享吧')
      const code = codeFromHex(String(nk.uuidv4()) + String(nk.uuidv4()))
      if (code.length !== 8) throw new Fail('SERVER_BUSY', '请重试', true)
      const snap: GardenShare = { ownerUserId: userId, paletteId: s.garden.paletteId, placements: s.garden.placements.map(p => ({ itemId: p.itemId, x: p.x, y: p.y })), createdAtMs: now, revoked: false }
      const writes = [w(SYSTEM_USER, C_GARDEN_SHARE, code, snap, '*'), w(userId, C_PLAYER, 'garden_share', { code, createdAtMs: now } as GardenShareRecord, rec ? rec.version : '*')]
      const old = rec ? read<GardenShare>(nk, SYSTEM_USER, C_GARDEN_SHARE, rec.value.code) : null
      if (old && !old.value.revoked) writes.push(w(SYSTEM_USER, C_GARDEN_SHARE, rec!.value.code, { ...old.value, revoked: true }, old.version))
      return { state: s, result: { code, createdAtMs: now, items: snap.placements.length }, writes }
    }
    case 'game.garden.share.revoke': {
      const rec = read<GardenShareRecord>(nk, userId, C_PLAYER, 'garden_share')
      if (!rec || !rec.value.code) return { state: s, result: { revoked: false }, writes: [] }
      const old = read<GardenShare>(nk, SYSTEM_USER, C_GARDEN_SHARE, rec.value.code)
      const writes = [w(userId, C_PLAYER, 'garden_share', { code: '', createdAtMs: rec.value.createdAtMs } as GardenShareRecord, rec.version)]
      if (old && !old.value.revoked) writes.push(w(SYSTEM_USER, C_GARDEN_SHARE, rec.value.code, { ...old.value, revoked: true }, old.version))
      return { state: s, result: { revoked: true }, writes }
    }
    case 'game.garden.share.react': {
      // A6-C2: preset reactions only (no free text). One per visitor per code per UTC+8 day; owners cannot react to themselves.
      const code = normalizeCode(p.code)
      const reaction = String(p.reaction ?? '')
      if (GARDEN_REACTIONS.indexOf(reaction) < 0) throw new Fail('INVALID_PAYLOAD', '不支持的回应')
      const obj = code ? read<GardenShare>(nk, SYSTEM_USER, C_GARDEN_SHARE, code) : null
      const rec = obj && !obj.value.revoked ? read<GardenShareRecord>(nk, obj.value.ownerUserId, C_PLAYER, 'garden_share') : null
      if (!obj || !rec || rec.value.code !== code) throw new Fail('TRANSFER_CODE_INVALID', '口令无效或已被撤销')
      if (obj.value.ownerUserId === userId) throw new Fail('INVALID_PAYLOAD', '这是你自己的小院')
      const day = dayKeyUtc8(now)
      const mark = read<{ dayKey: string; reaction: string }>(nk, userId, C_PLAYER, `garden_react_${code}`)
      if (mark && mark.value.dayKey === day) return { state: s, result: { reaction: mark.value.reaction, already: true }, writes: [] }
      const cnt = read<GardenReactions>(nk, SYSTEM_USER, C_GARDEN_SHARE, `${code}.r`)
      const counts: Record<string, number> = { ...(cnt ? cnt.value.counts : {}) }
      counts[reaction] = (counts[reaction] || 0) + 1
      return { state: s, result: { reaction, already: false }, writes: [
        w(SYSTEM_USER, C_GARDEN_SHARE, `${code}.r`, { counts, updatedAtMs: now } as GardenReactions, cnt ? cnt.version : '*'),
        w(userId, C_PLAYER, `garden_react_${code}`, { dayKey: day, reaction }, mark ? mark.version : '*'),
      ] }
    }
    case 'game.transfer.create': {
      const rec = read<TransferRecord>(nk, userId, C_PLAYER, 'transfer')
      if (rec && now - rec.value.createdAtMs < 15_000) throw new Fail('RATE_LIMITED', '刚刚生成过转移码，请稍后再试', true, 15_000 - (now - rec.value.createdAtMs))
      const code = codeFromHex(String(nk.uuidv4()) + String(nk.uuidv4()))
      if (code.length !== 8) throw new Fail('SERVER_BUSY', '请重试', true)
      const expiresAtMs = now + TRANSFER_TTL_MS
      // A newer code replaces the older one: claims check the source's current record.
      return { state: s, result: { code, expiresAtMs, sourceHasProgress: hasProgress(s) }, writes: [
        w(SYSTEM_USER, C_TRANSFER, code, { sourceUserId: userId, createdAtMs: now, expiresAtMs, usedAtMs: null } as TransferCode, '*'),
        w(userId, C_PLAYER, 'transfer', { code, createdAtMs: now, expiresAtMs } as TransferRecord, rec ? rec.version : '*'),
      ] }
    }
    default:
      throw new Fail('INVALID_PAYLOAD', '未知接口')
  }
}
function planWrite(name: RpcName, nk: Nk, userId: string, st: { value: PlayerState; version: string }, expected: number, p: Record<string, unknown>, now: number): Plan {
  const s = st.value
  const stateW = (next: PlayerState) => w(userId, C_PLAYER, 'state', next, st.version)
  const getRun = (): Obj<ExploreRun> => {
    const id = String(p.runId || '')
    return UUID_RE.test(id) ? read<ExploreRun>(nk, userId, C_RUNS, id) : null
  }

  // No-op replays that precede the revision check (contract §4.1 step 7).
  if (name === 'game.run.finish') {
    const run = getRun()
    if (run && run.value.status === 'FINISHED' && run.value.finishResult) return { state: s, result: run.value.finishResult, writes: [], replayed: true }
  }
  if (name === 'game.run.cancel') {
    const run = getRun()
    if (run && run.value.status === 'CANCELLED') return { state: s, result: { runId: run.value.runId, status: 'CANCELLED' }, writes: [], replayed: true }
  }
  const pre = preRevisionReplay(name, s)
  if (pre) return { state: s, result: pre.result, writes: [], replayed: true }
  if (expected !== s.stateRevision) throw new Fail('STATE_CONFLICT', '进度已更新，请刷新后确认操作')
  if (STATE_ACTIONS.has(name)) {
    const out = applyStateAction(name, s, p, { nowMs: now, userId, uuid: () => nk.uuidv4() })
    return { state: out.state, result: out.result, writes: [stateW(out.state)] }
  }

  switch (name) {
    case 'game.run.start': {
      const levelId = p.levelId as LevelId; const route = p.route as Route
      if (typeof levelId !== 'string' || !LEVELS[levelId] || (route !== 'plant' && route !== 'decor')) throw new Fail('INVALID_PAYLOAD', '关卡或路线无效')
      if (!isLevelOpen(s, levelId)) throw new Fail('SCENE_LOCKED', '这个景点还没有开放')
      if (route === 'decor' && tutorialForcesPlantRoute(s, levelId)) throw new Fail('INVALID_PAYLOAD', '新手第一次探索请选择苗圃路线')
      const next = clone(s); const writes: unknown[] = []
      if (next.activeRunId) {
        const old = read<ExploreRun>(nk, userId, C_RUNS, next.activeRunId)
        if (old && old.value.status === 'ACTIVE' && now < old.value.expiresAtMs) throw new Fail('ACTIVE_RUN_EXISTS', '还有一次未结束的探索')
        if (old && old.value.status === 'ACTIVE') { const exp = clone(old.value); exp.status = 'EXPIRED'; writes.push(w(userId, C_RUNS, exp.runId, exp, old.version)) }
      }
      const meta = read<Meta>(nk, userId, C_PLAYER, 'meta')
      const minuteKey = Math.floor(now / 60000)
      const rate = meta && meta.value.runStartRate.minuteKey === minuteKey ? meta.value.runStartRate : { minuteKey, count: 0 }
      if (rate.count >= RULES.runStartPerMinute) throw new Fail('RATE_LIMITED', '操作太快了，请稍后再出发', true, (minuteKey + 1) * 60000 - now)
      const run: ExploreRun = {
        runId: nk.uuidv4(), userId, levelId, route, configVersion: CONFIG_VERSION,
        shuffleSeed: Math.floor(Math.random() * 2147483647), status: 'ACTIVE', startedAtMs: now,
        expiresAtMs: now + RULES.runTtlMs, finishedAtMs: null, finishResult: null,
      }
      next.activeRunId = run.runId; next.stateRevision += 1
      writes.push(w(userId, C_RUNS, run.runId, run, '*'))
      writes.push(w(userId, C_PLAYER, 'meta', { runStartRate: { minuteKey, count: rate.count + 1 }, feedbackDay: meta ? meta.value.feedbackDay : undefined }, meta ? meta.version : '*'))
      writes.push(stateW(next))
      return { state: next, result: { run: summary(run, now), preview: previewReward(next, levelId, route, now, { userId, runId: run.runId }) }, writes }
    }
    case 'game.run.finish': {
      const run = getRun()
      if (!run) throw new Fail('RUN_NOT_FOUND', '没有找到这次探索')
      const r = run.value
      if (r.status === 'CANCELLED') throw new Fail('RUN_CANCELLED', '这次探索已取消')
      if (r.status === 'EXPIRED' || now >= r.expiresAtMs) throw new Fail('RUN_EXPIRED', '这次探索已过期，请重新出发')
      if (r.configVersion !== CONFIG_VERSION) throw new Fail('CONFIG_EXPIRED', '内容版本已更新，请重新出发')
      validateProof(r.levelId, p.proof as Proof)
      const out = applyFinish(s, r.runId, r.levelId, r.route, now, userId)
      const fin = clone(r); fin.status = 'FINISHED'; fin.finishedAtMs = now; fin.finishResult = out.result
      return { state: out.state, result: out.result, writes: [w(userId, C_RUNS, fin.runId, fin, run.version), stateW(out.state)] }
    }
    case 'game.run.cancel': {
      const run = getRun()
      if (!run) throw new Fail('RUN_NOT_FOUND', '没有找到这次探索')
      if (run.value.status === 'FINISHED') throw new Fail('RUN_ALREADY_FINISHED', '这次探索已经完成')
      const can = clone(run.value); can.status = 'CANCELLED'
      const next = clone(s); if (next.activeRunId === can.runId) next.activeRunId = null
      next.stateRevision += 1
      return { state: next, result: { runId: can.runId, status: 'CANCELLED' }, writes: [w(userId, C_RUNS, can.runId, can, run.version), stateW(next)] }
    }
    case 'game.transfer.claim':
      return planTransferClaim(nk, userId, st, p, now)
    default:
      throw new Fail('INVALID_PAYLOAD', '未知接口')
  }
}

/** A5 G7: copy the source save into this (fresh) account in ONE storage batch: target CAS, source CAS, code CAS. */
function planTransferClaim(nk: Nk, userId: string, st: { value: PlayerState; version: string }, p: Record<string, unknown>, now: number): Plan {
  const hourKey = Math.floor(now / 3_600_000)
  const tries = read<{ hourKey: number; count: number }>(nk, userId, C_PLAYER, 'transfer_tries')
  const used = tries && tries.value.hourKey === hourKey ? tries.value.count : 0
  if (used >= TRANSFER_TRIES_PER_HOUR) throw new Fail('RATE_LIMITED', '输错次数较多，请一小时后再试', true, (hourKey + 1) * 3_600_000 - now)
  const bad = (message: string): never => {
    try { nk.storageWrite([w(userId, C_PLAYER, 'transfer_tries', { hourKey, count: used + 1 }, tries ? tries.version : '*')]) } catch (_e) { /* concurrent miss */ }
    throw new Fail('TRANSFER_CODE_INVALID', message)
  }
  const code = normalizeCode(p.code)
  if (!code) return bad('转移码应为 8 位字母和数字')
  const obj = read<TransferCode>(nk, SYSTEM_USER, C_TRANSFER, code)
  if (!obj || obj.value.usedAtMs !== null || now >= obj.value.expiresAtMs) return bad('转移码无效、已使用或已过期')
  const source = obj.value.sourceUserId
  if (source === userId) throw new Fail('INVALID_PAYLOAD', '这是本账号生成的转移码，请在另一个浏览器或新账号里输入')
  const rec = read<TransferRecord>(nk, source, C_PLAYER, 'transfer')
  if (!rec || rec.value.code !== code) return bad('这个转移码已被更新的转移码替换')
  if (!isFreshState(st.value)) throw new Fail('TARGET_HAS_PROGRESS', '当前账号已经有进度，不能覆盖。请在还没开始玩的账号里输入转移码')
  const src = read<PlayerState>(nk, source, C_PLAYER, 'state')
  if (!src) return bad('转移码对应的进度不存在')
  const out = transferStates(migrateState(src.value).state, st.value, now)
  const usedCode: TransferCode = { sourceUserId: source, createdAtMs: obj.value.createdAtMs, expiresAtMs: obj.value.expiresAtMs, usedAtMs: now, targetUserId: userId }
  return { state: out.target, result: claimSummary(out.target, now), writes: [
    w(userId, C_PLAYER, 'state', out.target, st.version),
    w(source, C_PLAYER, 'state', out.source, src.version),
    w(SYSTEM_USER, C_TRANSFER, code, usedCode, obj.version),
  ] }
}

/** A5 G13: look up a courtyard code. Only palette + placements are returned; misses are rate limited per user. */
function gardenShareGet(nk: Nk, userId: string, p: Record<string, unknown>, now: number) {
  const hourKey = Math.floor(now / 3_600_000)
  const tries = read<{ hourKey: number; count: number }>(nk, userId, C_PLAYER, 'garden_share_misses')
  const used = tries && tries.value.hourKey === hourKey ? tries.value.count : 0
  if (used >= GARDEN_SHARE_MISSES_PER_HOUR) throw new Fail('RATE_LIMITED', '查询次数较多，请一小时后再试', true, (hourKey + 1) * 3_600_000 - now)
  const miss = (): never => {
    try { nk.storageWrite([w(userId, C_PLAYER, 'garden_share_misses', { hourKey, count: used + 1 }, tries ? tries.version : '*')]) } catch (_e) { /* concurrent miss */ }
    throw new Fail('TRANSFER_CODE_INVALID', '口令无效或已被撤销')
  }
  const code = normalizeCode(p.code)
  if (!code) return miss()
  const obj = read<GardenShare>(nk, SYSTEM_USER, C_GARDEN_SHARE, code)
  if (!obj || obj.value.revoked) return miss()
  const rec = read<GardenShareRecord>(nk, obj.value.ownerUserId, C_PLAYER, 'garden_share')
  if (!rec || rec.value.code !== code) return miss() // owner deleted the account or issued a newer code
  const mine = obj.value.ownerUserId === userId
  const cnt = mine ? read<GardenReactions>(nk, SYSTEM_USER, C_GARDEN_SHARE, `${code}.r`) : null
  const mark = mine ? null : read<{ dayKey: string; reaction: string }>(nk, userId, C_PLAYER, `garden_react_${code}`)
  return { paletteId: obj.value.paletteId, placements: obj.value.placements.map((x, i) => ({ instanceId: `v${i}`, itemId: x.itemId, x: x.x, y: x.y })), createdAtMs: obj.value.createdAtMs, mine,
    // Counts are shown to the owner only; visitors only learn whether they already reacted today.
    reactions: mine ? (cnt ? cnt.value.counts : {}) : undefined,
    reactedToday: mark && mark.value.dayKey === dayKeyUtc8(now) ? mark.value.reaction : null }
}

/* ---------------- client storage guard ---------------- */

function guardWrite(_ctx: Ctx, logger: Logger, _nk: Nk, data: any) {
  const objs = (data && data.objects) || []
  for (let i = 0; i < objs.length; i++) if (PROTECTED.indexOf(objs[i].collection) >= 0) { logger.warn('blocked client storage write to %s', objs[i].collection); return null }
  return data
}
function guardDelete(_ctx: Ctx, logger: Logger, _nk: Nk, data: any) {
  const ids = (data && (data.objectIds || data.object_ids)) || []
  for (let i = 0; i < ids.length; i++) if (PROTECTED.indexOf(ids[i].collection) >= 0) { logger.warn('blocked client storage delete in %s', ids[i].collection); return null }
  return data
}

/** InitModule hook: S0/S1 may open every solar term via env BCY_SEASON_OVERRIDE=all (never in production). */
function init(ctx: Ctx, logger: Logger, nk?: Nk) {
  const env = (ctx && ctx.env) || {}
  const cfg = authCfg(ctx, nk)
  // Realname/minor settings are runtime config (admin console); this only logs what is in effect at start-up.
  logger.info('bencao auth mode=%s source=%s configVersion=%d minor=%s blockDevice=%s', cfg.mode, cfg.source, cfg.version, cfg.minor.mode, String(cfg.blockDevice))
  if (cfg.secret.length < 32) logger.error('BCY_AUTH_SECRET is missing/short: runtime config and phone login are unavailable, falling back to BCY_AUTH_MODE')
  MIN_CLIENT_BUILD = /^\d+(\.\d+){0,3}$/.test(String(env.BCY_MIN_CLIENT_BUILD || '')) ? String(env.BCY_MIN_CLIENT_BUILD) : CLIENT_BUILD
  logger.info('bencao minClientBuild=%s serverBuild=%s config=%s', MIN_CLIENT_BUILD, CLIENT_BUILD, CONFIG_VERSION)
  if (env.BCY_SEASON_OVERRIDE === 'all') { configureSeason({ override: 'all' }); logger.warn('bencao season override=all (test only)') }
}
export const BCY = { handleRead, handleWrite, guardWrite, guardDelete, init, beforeAuthCustom, beforeAuthDevice, beforeSessionRefresh, WRITES, ERROR_CODES }

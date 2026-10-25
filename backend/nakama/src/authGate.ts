// Nakama ↔ bencao-auth integration (doc 06 §2.3, §4.1 steps 2–4, §7.3, §8.2).
// Realname on/off and the minor rule are RUNTIME config edited in the admin console (/admin/), fetched from
// bencao-auth GET /internal/config and cached CFG_TTL_SEC. If the auth service is unreachable the last good
// config is used; if it was never reachable, the env value below is the fallback.
// Runtime env (nakama.yml runtime.env):
//   BCY_AUTH_URL=http://127.0.0.1:7360   BCY_AUTH_SECRET=<shared internal secret>
//   BCY_AUTH_MODE=device|realname   (fallback only, used before the auth service has ever answered)
//   BCY_BLOCK_DEVICE_AUTH=true      (optional: reject device auth server-wide — only if no other game uses it)
import { minorWindow } from '../../../src/shared/minorPolicy'
import { describeMinorRule, LEGAL_MINOR_RULE, type MinorRule } from '../../../src/shared/compliance'
import type { AccountStatusData } from '../../../src/shared/types'
import { Fail } from './fail'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Nk = any; type Ctx = any; type Logger = any
type AuthCfg = { mode: 'device' | 'realname'; url: string; secret: string; blockDevice: boolean; minor: MinorRule; version: number; source: 'runtime' | 'last-good' | 'env' }
const CUSTOM_PREFIX = 'bcy-'
const CACHE_TTL_SEC = 20
const CFG_TTL_SEC = 10
const CFG_KEY = 'bcy:cfg', CFG_LAST_KEY = 'bcy:cfg:last'
type Runtime = { realnameEnabled: boolean; minor: MinorRule; version: number }

function validRuntime(x: any): x is Runtime {
  return !!x && typeof x.realnameEnabled === 'boolean' && !!x.minor && ['window', 'block', 'off'].indexOf(x.minor.mode) >= 0 && Array.isArray(x.minor.days)
}
/** Effective auth config. `nk` enables the runtime (admin-console) config; without it only env is used. */
export function authCfg(ctx: Ctx, nk?: Nk): AuthCfg {
  const env = (ctx && ctx.env) || {}
  const base = { url: env.BCY_AUTH_URL || 'http://127.0.0.1:7360', secret: env.BCY_AUTH_SECRET || '', blockDevice: env.BCY_BLOCK_DEVICE_AUTH === 'true' }
  const fromEnv: AuthCfg = { ...base, mode: env.BCY_AUTH_MODE === 'realname' ? 'realname' : 'device', minor: LEGAL_MINOR_RULE, version: 0, source: 'env' }
  if (!nk || base.secret.length < 32) return fromEnv
  let rt: Runtime | null = null, source: AuthCfg['source'] = 'runtime'
  try { const c = nk.localcacheGet(CFG_KEY); if (validRuntime(c)) rt = c } catch { /* cache unavailable */ }
  if (!rt) {
    try {
      const r = call(nk, { ...fromEnv }, 'GET', '/internal/config')
      if (r.status === 200 && r.json && r.json.ok && validRuntime(r.json.data)) {
        rt = { realnameEnabled: r.json.data.realnameEnabled, minor: r.json.data.minor, version: r.json.data.version }
        try { nk.localcachePut(CFG_KEY, rt, CFG_TTL_SEC); nk.localcachePut(CFG_LAST_KEY, rt, 7 * 86400) } catch { /* ignore */ }
      }
    } catch { /* auth service unreachable */ }
  }
  if (!rt) {
    try { const c = nk.localcacheGet(CFG_LAST_KEY); if (validRuntime(c)) { rt = c; source = 'last-good' } } catch { /* ignore */ }
  }
  if (!rt) return fromEnv
  return { ...base, mode: rt.realnameEnabled ? 'realname' : 'device', minor: rt.minor, version: rt.version, source }
}

function call(nk: Nk, cfg: AuthCfg, method: 'GET' | 'POST', path: string, body?: unknown): { status: number; json: any } {
  const res = nk.httpRequest(cfg.url + path, method.toLowerCase(), { 'content-type': 'application/json', 'x-internal-secret': cfg.secret }, body === undefined ? '' : JSON.stringify(body), 3000)
  let json: any = null
  try { json = JSON.parse(res.body) } catch { /* non-JSON */ }
  return { status: res.code, json }
}

/* ---------------- beforeAuthenticateCustom ---------------- */
/** Exchanges a one-time `LT-…` loginTicket for the stable subject. Other custom ids (other games) pass through. */
export function beforeAuthCustom(ctx: Ctx, logger: Logger, nk: Nk, data: any) {
  const id: string = (data && data.account && data.account.id) || ''
  if (id.indexOf('LT-') !== 0) {
    if (id.indexOf(CUSTOM_PREFIX) === 0) { logger.warn('blocked direct custom auth with reserved prefix'); return null }
    return data
  }
  const cfg = authCfg(ctx, nk)
  if (cfg.mode !== 'realname') { logger.warn('loginTicket used while BCY_AUTH_MODE=device'); return null }
  let r: { status: number; json: any }
  try { r = call(nk, cfg, 'POST', '/internal/ticket/consume', { ticket: id }) } catch (e) { logger.error('auth service unreachable on ticket consume'); return null }
  if (r.status !== 200 || !r.json || !r.json.ok) { logger.info('loginTicket rejected (%d)', r.status); return null }
  const sub: string = r.json.data.sub
  data.account.id = CUSTOM_PREFIX + sub
  data.create = true
  // Non-identifying, deterministic username (Nakama usernames must be unique).
  data.username = 'p' + sub.replace(/-/g, '').slice(0, 20)
  return data
}

/** Optional server-wide device-auth block (S3). Off by default because the Nakama server may host other games. */
export function beforeAuthDevice(ctx: Ctx, logger: Logger, nk: Nk, data: any) {
  const cfg = authCfg(ctx, nk)
  // Existing device accounts may still sign in (create=false) so their owner can issue a transfer code (A5 G7);
  // the realname gate keeps every gameplay RPC closed for them.
  const create = data && data.create
  const existingOnly = create === false || (create && typeof create === 'object' && create.value === false)
  if (cfg.mode === 'realname' && cfg.blockDevice && !existingOnly) { logger.info('device auth rejected (BCY_BLOCK_DEVICE_AUTH)'); return null }
  return data
}

/** Refuse to refresh sessions of deleted bencao accounts. */
export function beforeSessionRefresh(ctx: Ctx, logger: Logger, nk: Nk, data: any) {
  const cfg = authCfg(ctx, nk)
  if (cfg.mode !== 'realname') return data
  try {
    const parts = String((data && data.token) || '').split('.')
    const claims = JSON.parse(nk.base64UrlDecode(parts[1]))
    const uid = claims && claims.uid
    if (!uid) return data
    const sub = subjectOf(nk, uid)
    if (!sub) return data // not a bencao phone account (e.g. another game)
    const st = fetchState(nk, cfg, sub, true)
    if (st.accountStatus !== 'ACTIVE') { logger.info('refresh rejected: account %s', st.accountStatus); return null }
  } catch (e) { logger.warn('refresh check failed: %s', String((e as Error)?.message || e)); return null }
  return data
}

/* ---------------- per-RPC gate ---------------- */
function subjectOf(nk: Nk, userId: string): string | null {
  const acc = nk.accountGetId(userId)
  const cid: string = (acc && (acc.customId || acc.custom_id)) || ''
  return cid.indexOf(CUSTOM_PREFIX) === 0 ? cid.slice(CUSTOM_PREFIX.length) : null
}
type RemoteState = { accountStatus: 'ACTIVE' | 'DELETE_PENDING' | 'DELETED'; realnameStatus: AccountStatusData['realnameStatus'] }
function fetchState(nk: Nk, cfg: AuthCfg, sub: string, fresh = false): RemoteState {
  const key = 'bcy:acct:' + sub
  if (!fresh) {
    try { const c = nk.localcacheGet(key); if (c) return c as RemoteState } catch { /* cache unavailable */ }
  }
  const r = call(nk, cfg, 'GET', '/internal/account/state?sub=' + encodeURIComponent(sub))
  if (r.status !== 200 || !r.json || !r.json.ok) throw new Fail('SERVER_BUSY', '账号服务繁忙，请稍后重试', true)
  const st = r.json.data as RemoteState
  try { nk.localcachePut(key, st, CACHE_TTL_SEC) } catch { /* ignore */ }
  return st
}
export function dropStateCache(nk: Nk, sub: string) { try { nk.localcacheDelete('bcy:acct:' + sub) } catch { /* ignore */ } }

export type GateResult = { status: AccountStatusData; sub: string | null }
/** Account status as seen by the game. Never returns phone, name, pi, birth date or ID data. */
export function accountStatusFor(ctx: Ctx, nk: Nk, now: number, fresh = false): GateResult {
  const cfg = authCfg(ctx, nk)
  if (cfg.mode !== 'realname') {
    return { sub: null, status: { accountStatus: 'ACTIVE', realnameStatus: 'UNVERIFIED', minorPolicy: { restricted: false, serverTimeMs: now, playableUntilMs: null, nextWindowStartMs: null }, authMode: 'device_trial' } }
  }
  const sub = subjectOf(nk, ctx.userId)
  if (!sub) {
    // Device/anonymous session in realname mode: no game service (doc 06 §2.3: S3 forbids guest accounts).
    return { sub: null, status: { accountStatus: 'ACTIVE', realnameStatus: 'UNVERIFIED', minorPolicy: { restricted: false, serverTimeMs: now, playableUntilMs: null, nextWindowStartMs: null }, authMode: 'phone_realname' } }
  }
  const st = fetchState(nk, cfg, sub, fresh)
  const minor = st.realnameStatus === 'VERIFIED_MINOR'
  const w = minor ? minorWindow(now, cfg.minor) : null
  return { sub, status: {
    accountStatus: st.accountStatus, realnameStatus: st.realnameStatus,
    minorPolicy: { restricted: !!w && !w.allowed, serverTimeMs: now, playableUntilMs: w ? w.playableUntilMs : null, nextWindowStartMs: w ? w.nextWindowStartMs : null, rule: cfg.minor },
    authMode: 'phone_realname',
  } }
}

/** Steps 2–4 of the wrapper: account status → realname gate → minor time window. Throws Fail to stop the RPC. */
export function enforceGate(ctx: Ctx, logger: Logger, nk: Nk, now: number): GateResult {
  const g = accountStatusFor(ctx, nk, now)
  if (g.status.authMode === 'device_trial') return g
  const rule = g.status.minorPolicy.rule || LEGAL_MINOR_RULE
  const s = g.status
  if (s.accountStatus !== 'ACTIVE') throw new Fail('ACCOUNT_DELETED', '账号已注销或正在注销')
  if (s.realnameStatus === 'UNVERIFIED') throw new Fail('REALNAME_REQUIRED', '请先完成实名认证')
  if (s.realnameStatus === 'PENDING') throw new Fail('REALNAME_PENDING', '实名认证审核中，请稍后再试', true)
  if (s.minorPolicy.restricted) {
    // 21:00 and outside windows: stop service and revoke sessions (doc 06 §7.3).
    try { nk.sessionLogout(ctx.userId) } catch (e) { logger.warn('sessionLogout failed') }
    throw new Fail('MINOR_TIME_RESTRICTED', describeMinorRule(rule))
  }
  return g
}

/** Heartbeat side effect for verified users: online/offline intents for duration accounting and national reporting. */
export function recordPlaytime(ctx: Ctx, logger: Logger, nk: Nk, sub: string | null) {
  const cfg = authCfg(ctx, nk)
  if (cfg.mode !== 'realname' || !sub) return
  try { call(nk, cfg, 'POST', '/internal/playtime', { sub, kind: 'heartbeat' }) } catch { logger.warn('playtime record failed') }
}

/** Deletion saga step 2: erase identity data in bencao-auth first (idempotent by requestId). */
export function deleteIdentity(ctx: Ctx, logger: Logger, nk: Nk, sub: string | null, requestId: string) {
  const cfg = authCfg(ctx, nk)
  if (cfg.mode !== 'realname' || !sub) return
  let r: { status: number; json: any }
  try { r = call(nk, cfg, 'POST', '/auth/account/delete', { userId: sub, requestId }) } catch { throw new Fail('SERVER_BUSY', '注销服务繁忙，请稍后重试', true) }
  if (r.status !== 200 || !r.json || !r.json.ok) { logger.error('auth delete failed %d', r.status); throw new Fail('SERVER_BUSY', '注销服务繁忙，请稍后重试', true) }
  dropStateCache(nk, sub)
}

// bencao-auth HTTP service (doc 06 §6–§8). Listens on 127.0.0.1 only; Nginx proxies exactly the public paths.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import pg from 'pg'
import { SCHEMA } from './schema'
import { decrypt, encrypt, issueTicket, loadKeys, lookupHash, newSmsCode, normalizePhone, parseIdNumber, validName, verifyTicket, type Keys } from './core'
import { createProviders, MockSms, type RealnameOutcome } from './providers'
import { isAdult } from '../../../src/shared/minorPolicy'
import { ConfigStore, handleAdmin, type AdminDeps } from './admin'

type Env = NodeJS.ProcessEnv
type Deps = { pool: pg.Pool; keys: Keys; env: Env; now: () => number; providers: ReturnType<typeof createProviders>; store: ConfigStore }
class HttpFail extends Error {
  constructor(public status: number, public code: string, message: string, public retryAfterMs?: number) { super(message) }
}
const MAX_BODY = 16 * 1024
const SMS_TTL_MS = 5 * 60_000
const SMS_COOLDOWN_MS = 60_000
const SMS_MAX_ATTEMPTS = 5
const PENDING_MAX_MS = 48 * 3600_000
const SESSION_GAP_MS = 90_000
const SAME_MSG = '验证码错误或已过期，请重新获取'

/* ---------------- request helpers ---------------- */
async function readJson(req: IncomingMessage, allowed: string[]): Promise<Record<string, unknown>> {
  const ct = String(req.headers['content-type'] || '')
  if (!ct.toLowerCase().startsWith('application/json')) throw new HttpFail(415, 'INVALID_PAYLOAD', '请求格式错误')
  const chunks: Buffer[] = []; let size = 0
  for await (const c of req) { size += (c as Buffer).length; if (size > MAX_BODY) throw new HttpFail(413, 'INVALID_PAYLOAD', '请求过大'); chunks.push(c as Buffer) }
  let body: unknown
  try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))) } catch { throw new HttpFail(400, 'INVALID_PAYLOAD', '请求格式错误') }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpFail(400, 'INVALID_PAYLOAD', '请求格式错误')
  for (const k of Object.keys(body)) if (!allowed.includes(k)) throw new HttpFail(400, 'INVALID_PAYLOAD', '请求包含未知字段')
  return body as Record<string, unknown>
}
function send(res: ServerResponse, status: number, payload: unknown) {
  const s = JSON.stringify(payload)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-length': Buffer.byteLength(s) })
  res.end(s)
}
const okBody = (data: unknown) => ({ ok: true, data })
const isLoopback = (req: IncomingMessage) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress || '')
/** Client IP: only trust X-Real-IP set by the local Nginx. */
const clientIp = (req: IncomingMessage) => (isLoopback(req) && typeof req.headers['x-real-ip'] === 'string' ? req.headers['x-real-ip'] : req.socket.remoteAddress) || 'unknown'
function requireInternal(req: IncomingMessage, env: Env) {
  const want = Buffer.from(env.AUTH_INTERNAL_SECRET || '')
  const got = Buffer.from(String(req.headers['x-internal-secret'] || ''))
  // internal calls never pass through Nginx: no forwarded headers allowed
  if (!isLoopback(req) || req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || want.length < 32 || got.length !== want.length || !timingSafeEqual(got, want)) {
    throw new HttpFail(403, 'FORBIDDEN', '禁止访问')
  }
}
async function audit(d: Deps, trace: string, actor: string | null, action: string, outcome: string, meta?: Record<string, unknown>) {
  await d.pool.query('insert into audit_log (trace_id, actor_hash, action, outcome, metadata_redacted) values ($1,$2,$3,$4,$5)',
    [trace, actor ? lookupHash(d.keys, 'audit-actor', actor) : null, action, outcome, meta ? JSON.stringify(meta) : null]).catch(() => undefined)
}

/* ---------------- Nakama session → stable subject ---------------- */
async function subjectFromBearer(req: IncomingMessage, d: Deps): Promise<string> {
  const h = String(req.headers.authorization || '')
  const m = /^Bearer ([A-Za-z0-9._-]{20,4096})$/.exec(h)
  if (!m) throw new HttpFail(401, 'UNAUTHORIZED', '登录已失效，请重新登录')
  const base = d.env.AUTH_NAKAMA_URL || 'http://127.0.0.1:7350'
  let r: Response
  try { r = await fetch(`${base}/v2/account`, { headers: { authorization: `Bearer ${m[1]}` }, signal: AbortSignal.timeout(3000) }) } catch { throw new HttpFail(503, 'SERVER_BUSY', '服务繁忙，请稍后重试') }
  if (r.status === 401) throw new HttpFail(401, 'UNAUTHORIZED', '登录已失效，请重新登录')
  if (!r.ok) throw new HttpFail(503, 'SERVER_BUSY', '服务繁忙，请稍后重试')
  const acc = await r.json() as { custom_id?: string }
  const cid = acc.custom_id || ''
  if (!/^bcy-[0-9a-f-]{36}$/.test(cid)) throw new HttpFail(403, 'REALNAME_REQUIRED', '请先用手机号登录')
  return cid.slice(4)
}

/* ---------------- handlers ---------------- */
async function smsSend(req: IncomingMessage, d: Deps) {
  const b = await readJson(req, ['phone', 'challengeToken'])
  const phone = normalizePhone(b.phone)
  if (!phone) throw new HttpFail(400, 'INVALID_PHONE', '请输入正确的 11 位手机号')
  const ph = lookupHash(d.keys, 'phone', phone), ih = lookupHash(d.keys, 'ip', clientIp(req))
  const now = d.now()
  const last = await d.pool.query('select sent_at from sms_challenges where phone_lookup_hash=$1 order by sent_at desc limit 1', [ph])
  if (last.rows[0]) {
    const wait = SMS_COOLDOWN_MS - (now - new Date(last.rows[0].sent_at).getTime())
    if (wait > 0) throw new HttpFail(429, 'RATE_LIMITED', '发送太频繁，请稍后再试', wait)
  }
  const dayAgo = new Date(now - 86_400_000)
  const perPhone = Number(d.env.AUTH_SMS_DAILY_PER_PHONE || 10), perIp = Number(d.env.AUTH_SMS_DAILY_PER_IP || 30)
  const counts = await d.pool.query('select (select count(*) from sms_challenges where phone_lookup_hash=$1 and sent_at>$3)::int p, (select count(*) from sms_challenges where ip_hash=$2 and sent_at>$3)::int i', [ph, ih, dayAgo])
  if (counts.rows[0].p >= perPhone || counts.rows[0].i >= perIp) throw new HttpFail(429, 'RATE_LIMITED', '今日获取验证码次数过多，请明天再试', 3600_000)
  const code = newSmsCode()
  await d.pool.query('insert into sms_challenges (phone_lookup_hash, ip_hash, code_hash, expires_at, sent_at) values ($1,$2,$3,$4,$5)',
    [ph, ih, lookupHash(d.keys, 'sms-code', `${ph}|${code}`), new Date(now + SMS_TTL_MS), new Date(now)])
  try { await d.providers.sms.send(phone, code) } catch { throw new HttpFail(503, 'SERVER_BUSY', '短信服务暂时不可用，请稍后重试') }
  const data: Record<string, unknown> = { retryAfterMs: SMS_COOLDOWN_MS }
  // staging only: show the code on screen (mock provider never exists in production)
  if (!d.providers.production && d.providers.sms instanceof MockSms) data.debugCode = code
  return data
}

async function smsVerify(req: IncomingMessage, d: Deps) {
  const b = await readJson(req, ['phone', 'code'])
  const phone = normalizePhone(b.phone)
  const code = typeof b.code === 'string' && /^\d{6}$/.test(b.code) ? b.code : null
  if (!phone || !code) throw new HttpFail(400, 'CODE_INVALID', SAME_MSG)
  const ph = lookupHash(d.keys, 'phone', phone), now = d.now()
  const client = await d.pool.connect()
  try {
    await client.query('begin')
    const c = await client.query('select id, code_hash, attempt_count from sms_challenges where phone_lookup_hash=$1 and consumed_at is null and expires_at>$2 order by sent_at desc limit 1 for update', [ph, new Date(now)])
    const row = c.rows[0]
    if (!row || row.attempt_count >= SMS_MAX_ATTEMPTS) { await client.query('rollback'); throw new HttpFail(400, 'CODE_INVALID', SAME_MSG) }
    if (row.code_hash !== lookupHash(d.keys, 'sms-code', `${ph}|${code}`)) {
      await client.query('update sms_challenges set attempt_count=attempt_count+1 where id=$1', [row.id]); await client.query('commit')
      throw new HttpFail(400, 'CODE_INVALID', SAME_MSG)
    }
    await client.query('update sms_challenges set consumed_at=$2 where id=$1', [row.id, new Date(now)])
    let acc = await client.query("select user_id from auth_accounts where phone_lookup_hash=$1 and account_status<>'DELETED'", [ph])
    if (!acc.rows[0]) {
      acc = await client.query('insert into auth_accounts (user_id, phone_ciphertext, phone_lookup_hash) values ($1,$2,$3) on conflict (phone_lookup_hash) do update set updated_at=now() returning user_id', [randomUUID(), encrypt(d.keys, phone), ph])
    }
    const sub: string = acc.rows[0].user_id
    const t = issueTicket(d.keys, sub, now)
    await client.query('insert into ticket_jti (jti_hash, user_id, expires_at) values ($1,$2,$3)', [lookupHash(d.keys, 'jti', t.jti), sub, new Date(t.expiresAtMs)])
    await client.query('commit')
    return { loginTicket: t.ticket, expiresAtMs: t.expiresAtMs }
  } catch (e) { await client.query('rollback').catch(() => undefined); throw e } finally { client.release() }
}

function statusOf(row: { realname_status: string; account_status: string } | undefined) {
  if (!row) return { accountStatus: 'DELETED', realnameStatus: 'UNVERIFIED' }
  return { accountStatus: row.account_status, realnameStatus: row.realname_status }
}
async function applyOutcome(d: Deps, sub: string, ai: string, o: RealnameOutcome, birthYm: string | null) {
  if (o.status === 'PENDING') return 'PENDING'
  if (o.status === 'FAILED') {
    await d.pool.query("update realname_requests set request_status='FAILED', result_at=now() where ai=$1", [ai])
    await d.pool.query("update auth_accounts set realname_status='UNVERIFIED', updated_at=now() where user_id=$1", [sub])
    return 'UNVERIFIED'
  }
  const ym = o.birthYm || birthYm || ''
  const st = isAdult(ym, d.now()) ? 'VERIFIED_ADULT' : 'VERIFIED_MINOR'
  await d.pool.query("update realname_requests set request_status='VERIFIED', result_at=now() where ai=$1", [ai])
  await d.pool.query('update auth_accounts set realname_status=$2, pi_ciphertext=$3, birth_ym=$4, updated_at=now() where user_id=$1', [sub, st, encrypt(d.keys, o.pi), ym])
  return st
}

async function realnameSubmit(req: IncomingMessage, d: Deps, trace: string) {
  const sub = await subjectFromBearer(req, d)
  const b = await readJson(req, ['name', 'idNumber'])
  const acc = (await d.pool.query('select realname_status, account_status from auth_accounts where user_id=$1', [sub])).rows[0]
  if (!acc || acc.account_status !== 'ACTIVE') throw new HttpFail(403, 'ACCOUNT_DELETED', '账号已注销')
  if (acc.realname_status !== 'UNVERIFIED') return { realnameStatus: acc.realname_status }
  const today = await d.pool.query("select count(*)::int n from realname_requests where user_id=$1 and submitted_at>now()-interval '1 day'", [sub])
  if (today.rows[0].n >= Number(d.env.AUTH_REALNAME_DAILY || 5)) throw new HttpFail(429, 'RATE_LIMITED', '今日实名提交次数过多，请明天再试', 3600_000)
  const parsed = parseIdNumber(b.idNumber, d.now())
  if (!validName(b.name) || !parsed) throw new HttpFail(400, 'REALNAME_INVALID', '请填写与身份证一致的姓名和 18 位身份证号')
  const ai = randomUUID()
  await d.pool.query("insert into realname_requests (ai, user_id, request_status, birth_ym) values ($1,$2,'PENDING',$3)", [ai, sub, parsed.birthYm])
  await d.pool.query("update auth_accounts set realname_status='PENDING', updated_at=now() where user_id=$1", [sub])
  let o: RealnameOutcome
  try { o = await d.providers.realname.submit(ai, String(b.name).trim(), String(b.idNumber).trim().toUpperCase(), parsed.birthYm) } catch {
    // provider unreachable: request stays PENDING and is re-queried by status polling
    await audit(d, trace, sub, 'realname.submit', 'provider_error'); return { realnameStatus: 'PENDING' }
  }
  const st = await applyOutcome(d, sub, ai, o, parsed.birthYm)
  await audit(d, trace, sub, 'realname.submit', st)
  if (st === 'UNVERIFIED') throw new HttpFail(400, 'REALNAME_FAILED', '实名信息未通过核验，请检查姓名和身份证号后重试')
  return { realnameStatus: st }
}

async function realnameStatus(req: IncomingMessage, d: Deps) {
  const sub = await subjectFromBearer(req, d)
  const acc = (await d.pool.query('select realname_status, account_status from auth_accounts where user_id=$1', [sub])).rows[0]
  if (!acc) throw new HttpFail(403, 'ACCOUNT_DELETED', '账号已注销')
  if (acc.realname_status === 'PENDING') {
    const r = (await d.pool.query("select ai, birth_ym, submitted_at from realname_requests where user_id=$1 and request_status='PENDING' order by submitted_at desc limit 1", [sub])).rows[0]
    if (!r || d.now() - new Date(r.submitted_at).getTime() > PENDING_MAX_MS) {
      if (r) await d.pool.query("update realname_requests set request_status='FAILED', result_at=now() where ai=$1", [r.ai])
      await d.pool.query("update auth_accounts set realname_status='UNVERIFIED', updated_at=now() where user_id=$1", [sub])
      return { realnameStatus: 'UNVERIFIED' }
    }
    await d.pool.query('update realname_requests set queried_at=now() where ai=$1', [r.ai])
    try { return { realnameStatus: await applyOutcome(d, sub, r.ai, await d.providers.realname.query(r.ai), r.birth_ym) } } catch { return { realnameStatus: 'PENDING' } }
  }
  return { realnameStatus: acc.realname_status }
}

/* ---------------- internal (Nakama → auth, loopback + shared secret) ---------------- */
async function ticketConsume(req: IncomingMessage, d: Deps) {
  const b = await readJson(req, ['ticket'])
  const claims = verifyTicket(d.keys, b.ticket, d.now())
  if (!claims) throw new HttpFail(401, 'TICKET_INVALID', '登录凭证无效')
  const r = await d.pool.query("update ticket_jti set consumed_at=now() where jti_hash=$1 and consumed_at is null and expires_at>now() and user_id=$2 returning user_id", [lookupHash(d.keys, 'jti', claims.jti), claims.sub])
  if (!r.rows[0]) throw new HttpFail(401, 'TICKET_INVALID', '登录凭证无效')
  const acc = (await d.pool.query('select account_status from auth_accounts where user_id=$1', [claims.sub])).rows[0]
  if (!acc || acc.account_status !== 'ACTIVE') throw new HttpFail(401, 'TICKET_INVALID', '登录凭证无效')
  return { sub: claims.sub }
}
async function accountState(url: URL, d: Deps) {
  const sub = url.searchParams.get('sub') || ''
  if (!/^[0-9a-f-]{36}$/.test(sub)) throw new HttpFail(400, 'INVALID_PAYLOAD', 'bad sub')
  const row = (await d.pool.query('select realname_status, account_status from auth_accounts where user_id=$1', [sub])).rows[0]
  return statusOf(row)
}
async function accountDelete(req: IncomingMessage, d: Deps, trace: string) {
  const b = await readJson(req, ['userId', 'requestId'])
  const sub = String(b.userId || ''), rid = String(b.requestId || '')
  if (!/^[0-9a-f-]{36}$/.test(sub) || !/^[0-9a-f-]{36}$/.test(rid)) throw new HttpFail(400, 'INVALID_PAYLOAD', 'bad ids')
  const client = await d.pool.connect()
  try {
    await client.query('begin')
    const done = await client.query('select completed_at from account_deletions where user_id=$1 and request_id=$2', [sub, rid])
    if (done.rows[0]) { await client.query('commit'); return { accountStatus: 'DELETED', deletedAtMs: new Date(done.rows[0].completed_at).getTime() } }
    const acc = (await client.query('select phone_lookup_hash from auth_accounts where user_id=$1 for update', [sub])).rows[0]
    if (acc?.phone_lookup_hash) await client.query('delete from sms_challenges where phone_lookup_hash=$1', [acc.phone_lookup_hash])
    await client.query("update auth_accounts set phone_ciphertext=null, phone_lookup_hash=null, pi_ciphertext=null, birth_ym=null, realname_status='UNVERIFIED', account_status='DELETED', deleted_at=now(), updated_at=now() where user_id=$1", [sub])
    await client.query('delete from realname_requests where user_id=$1', [sub])
    await client.query('delete from ticket_jti where user_id=$1', [sub])
    const ins = await client.query('insert into account_deletions (user_id, request_id) values ($1,$2) returning completed_at', [sub, rid])
    await client.query('commit')
    await audit(d, trace, sub, 'account.delete', 'DELETED')
    return { accountStatus: 'DELETED', deletedAtMs: new Date(ins.rows[0].completed_at).getTime() }
  } catch (e) { await client.query('rollback').catch(() => undefined); throw e } finally { client.release() }
}
async function playtime(req: IncomingMessage, d: Deps) {
  const b = await readJson(req, ['sub', 'kind'])
  const sub = String(b.sub || '')
  if (!/^[0-9a-f-]{36}$/.test(sub) || (b.kind !== 'heartbeat' && b.kind !== 'offline')) throw new HttpFail(400, 'INVALID_PAYLOAD', 'bad playtime')
  const now = new Date(d.now())
  const cur = (await d.pool.query('select id, last_at from playtime_sessions where user_id=$1 and not closed order by last_at desc limit 1', [sub])).rows[0]
  const fresh = cur && now.getTime() - new Date(cur.last_at).getTime() <= SESSION_GAP_MS
  if (b.kind === 'offline') {
    if (cur) { await d.pool.query('update playtime_sessions set closed=true where id=$1', [cur.id]); await outbox(d, sub, 'offline', fresh ? now : new Date(cur.last_at)) }
    return { closed: !!cur }
  }
  if (fresh) await d.pool.query('update playtime_sessions set last_at=$2 where id=$1', [cur.id, now])
  else {
    if (cur) { await d.pool.query('update playtime_sessions set closed=true where id=$1', [cur.id]); await outbox(d, sub, 'offline', new Date(cur.last_at)) }
    await d.pool.query('insert into playtime_sessions (user_id, started_at, last_at) values ($1,$2,$2)', [sub, now])
    await outbox(d, sub, 'online', now)
  }
  return { recorded: true }
}
async function outbox(d: Deps, sub: string, kind: 'online' | 'offline', at: Date) {
  await d.pool.query('insert into behavior_outbox (event_id, user_id, kind, occurred_at) values ($1,$2,$3,$4) on conflict do nothing', [randomUUID(), sub, kind, at])
}

/* ---------------- housekeeping ---------------- */
async function housekeeping(d: Deps) {
  await d.pool.query("delete from sms_challenges where expires_at < now() - interval '1 day'")
  await d.pool.query("delete from ticket_jti where expires_at < now() - interval '1 day'")
  const stale = await d.pool.query("update playtime_sessions set closed=true where not closed and last_at < now() - interval '90 seconds' returning user_id, last_at")
  for (const r of stale.rows) await outbox(d, r.user_id, 'offline', new Date(r.last_at))
  // National behaviour reporting: only for VERIFIED users with a pi; adapter not configured yet → keep events queued.
  const batch = await d.pool.query("select o.event_id, o.kind, o.occurred_at, a.pi_ciphertext from behavior_outbox o join auth_accounts a on a.user_id=o.user_id where o.status='PENDING' and a.pi_ciphertext is not null order by o.occurred_at limit 128")
  if (batch.rows.length) {
    const events = batch.rows.map(r => ({ eventId: r.event_id, pi: decrypt(d.keys, r.pi_ciphertext), kind: r.kind, occurredAtMs: new Date(r.occurred_at).getTime() }))
    const res = await d.providers.behavior.report(events).catch(() => 'NOT_CONFIGURED' as const)
    if (res === 'SENT') await d.pool.query("update behavior_outbox set status='SENT', sent_at=now(), attempts=attempts+1 where event_id = any($1)", [events.map(e => e.eventId)])
  }
}

async function requireRealnameOn(d: Deps) {
  if (!(await d.store.get()).realnameEnabled) throw new HttpFail(403, 'REALNAME_DISABLED', '当前为试玩模式，无需手机号登录，请刷新页面')
}

/* ---------------- router ---------------- */
export function createHandler(d: Deps) {
  const admin: AdminDeps = {
    pool: d.pool, env: d.env, now: d.now, store: d.store, clientIp, readJson,
    // Admin session key is derived from the ticket key (domain-separated), so no extra secret is needed.
    sessionKey: createHmac('sha256', d.keys.ticketKey).update('bencao-admin-session-v1').digest(),
    audit: (trace, actor, action, outcome, meta) => audit(d, trace, actor, action, outcome, meta),
    providerInfo: { environment: d.providers.production ? 'production' : 'staging', sms: d.providers.sms.name, realname: d.providers.realname.name },
  }
  return async (req: IncomingMessage, res: ServerResponse) => {
    const trace = randomUUID()
    const url = new URL(req.url || '/', 'http://local')
    const route = `${req.method} ${url.pathname}`
    if (await handleAdmin(req, res, url, admin, trace)) return
    try {
      let data: unknown
      switch (route) {
        case 'GET /auth/config': {
          // Runtime config set in the admin console (/admin/); AUTH_PUBLIC_MODE is no longer read.
          const c = await d.store.get()
          data = { authMode: c.realnameEnabled ? 'realname' : 'device', environment: d.providers.production ? 'production' : 'staging', smsProvider: d.providers.sms.name, realnameProvider: d.providers.realname.name, minor: c.minor, configVersion: c.version }
          break
        }
        case 'GET /auth/healthz': await d.pool.query('select 1'); data = { healthy: true }; break
        // Realname switched off in the admin console → collect no phone numbers or identity data at all.
        case 'POST /auth/sms/send': await requireRealnameOn(d); data = await smsSend(req, d); break
        case 'POST /auth/sms/verify': await requireRealnameOn(d); data = await smsVerify(req, d); break
        case 'POST /auth/realname/submit': await requireRealnameOn(d); data = await realnameSubmit(req, d, trace); break
        case 'GET /auth/realname/status': data = await realnameStatus(req, d); break
        case 'POST /auth/account/delete': requireInternal(req, d.env); data = await accountDelete(req, d, trace); break
        case 'POST /internal/ticket/consume': requireInternal(req, d.env); data = await ticketConsume(req, d); break
        case 'GET /internal/account/state': requireInternal(req, d.env); data = await accountState(url, d); break
        case 'POST /internal/playtime': requireInternal(req, d.env); data = await playtime(req, d); break
        case 'GET /internal/config': requireInternal(req, d.env); data = await d.store.get(); break
        default: throw new HttpFail(404, 'NOT_FOUND', '接口不存在')
      }
      send(res, 200, okBody(data))
    } catch (e) {
      if (e instanceof HttpFail) {
        send(res, e.status, { ok: false, error: { code: e.code, message: e.message, retryable: e.status >= 500 || e.status === 429, ...(e.retryAfterMs ? { retryAfterMs: e.retryAfterMs } : {}) } })
      } else {
        // never log request bodies (phone, code, name, ID number)
        console.error(`[${trace}] ${route} internal error: ${(e as Error)?.message?.slice(0, 200)}`)
        send(res, 500, { ok: false, error: { code: 'INTERNAL_ERROR', message: '服务异常，请稍后重试', retryable: true } })
      }
    }
  }
}

export async function main(env: Env = process.env) {
  const providers = createProviders(env)
  const keys = loadKeys(env)
  if ((env.AUTH_INTERNAL_SECRET || '').length < 32) throw new Error('AUTH_INTERNAL_SECRET must be >= 32 chars')
  const pool = new pg.Pool({ connectionString: env.AUTH_DATABASE_URL, max: Number(env.AUTH_DB_POOL || 5) })
  await pool.query(SCHEMA)
  const store = new ConfigStore(pool, providers.production)
  const cfg = await store.seed()
  const d: Deps = { pool, keys, env, now: Date.now, providers, store }
  const port = Number(env.AUTH_PORT || 7360)
  createServer(createHandler(d)).listen(port, '127.0.0.1', () => {
    console.log(`bencao-auth listening on 127.0.0.1:${port} env=${providers.production ? 'production' : 'staging'} sms=${providers.sms.name} realname=${providers.realname.name} config=v${cfg.version} realname=${cfg.realnameEnabled ? 'on' : 'off'} minor=${cfg.minor.mode} admin=${env.AUTH_ADMIN_PASSWORD_HASH ? 'on' : 'off'}`)
  })
  setInterval(() => { housekeeping(d).catch(e => console.error('housekeeping:', (e as Error).message)) }, 60_000).unref()
}

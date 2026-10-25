// Admin console backend for runtime compliance config (实名认证 / 未成年人保护).
// - Config lives in runtime_config (single row) with full history; readers cache it for a few seconds.
// - Admin auth: one password (scrypt hash in AUTH_ADMIN_PASSWORD_HASH), stateless HMAC session cookie,
//   HttpOnly + Secure + SameSite=Strict, Path=/admin, 8 h. Per-IP lockout after repeated failures.
// - CSRF: every state-changing admin call needs the custom header `x-bcy-admin: 1` (not sendable cross-site
//   without CORS preflight, which this service never answers) in addition to SameSite=Strict.
// - Optional AUTH_ADMIN_ALLOW_IPS=1.2.3.4,5.6.7.8 restricts the console to listed client IPs.
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type pg from 'pg'
import { defaultCompliance, validateCompliance, type ComplianceConfig, type StoredCompliance } from '../../../src/shared/compliance'
import { ADMIN_CSS, ADMIN_HTML, ADMIN_JS } from './adminPage'

type Env = NodeJS.ProcessEnv
const SESSION_TTL_SEC = 8 * 3600
const COOKIE = 'bcy_admin'
const LOCK_FAILS = 5
const LOCK_MS = 15 * 60_000
const CACHE_MS = 3000

/* ---------------- config store ---------------- */
export class ConfigStore {
  private cached: { at: number; value: StoredCompliance } | null = null
  constructor(private pool: pg.Pool, readonly production: boolean, private now: () => number = Date.now) {}

  /** Insert defaults once (staging: realname off; production: realname on). Never overwrites an existing row. */
  async seed() {
    const cfg = defaultCompliance(this.production)
    const r = await this.pool.query("insert into runtime_config (id, config, version, updated_by) values (1, $1, 1, 'system:default') on conflict (id) do nothing returning version", [JSON.stringify(cfg)])
    if (r.rows[0]) await this.pool.query("insert into runtime_config_history (version, config, updated_by, note) values (1, $1, 'system:default', '初始默认配置') on conflict do nothing", [JSON.stringify(cfg)])
    // A production server must never run with a config the production guard would reject (e.g. copied from staging).
    const cur = await this.get(true)
    if (this.production) {
      const v = validateCompliance({ realnameEnabled: cur.realnameEnabled, minor: cur.minor }, true)
      if (!v.ok) throw new Error(`AUTH_ENV=production but runtime_config v${cur.version} is not allowed in production: ${v.errors.join('；')}`)
    }
    return cur
  }

  async get(fresh = false): Promise<StoredCompliance> {
    if (!fresh && this.cached && this.now() - this.cached.at < CACHE_MS) return this.cached.value
    const row = (await this.pool.query('select config, version, updated_at, updated_by from runtime_config where id=1')).rows[0]
    const raw: ComplianceConfig = row ? row.config : defaultCompliance(this.production)
    // jsonb reorders keys; rebuild in canonical order so API output and comparisons are stable.
    const m = raw.minor
    const base: ComplianceConfig = { realnameEnabled: raw.realnameEnabled, minor: { mode: m.mode, startHour: m.startHour, endHour: m.endHour, days: [...m.days].sort((a, b) => a - b), includeHolidays: m.includeHolidays } }
    const value: StoredCompliance = { ...base, version: row ? row.version : 0, updatedAtMs: row ? new Date(row.updated_at).getTime() : 0, updatedBy: row ? row.updated_by : 'system:default' }
    this.cached = { at: this.now(), value }
    return value
  }

  /** Optimistic update: fails with VERSION_CONFLICT if someone else saved first. */
  async update(input: unknown, expectedVersion: number, by: string, note: string | null): Promise<{ ok: true; value: StoredCompliance } | { ok: false; code: 'INVALID' | 'VERSION_CONFLICT'; errors: string[] }> {
    const v = validateCompliance(input, this.production)
    if (!v.ok) return { ok: false, code: 'INVALID', errors: v.errors }
    const client = await this.pool.connect()
    try {
      await client.query('begin')
      const cur = (await client.query('select version from runtime_config where id=1 for update')).rows[0]
      if (!cur || cur.version !== expectedVersion) { await client.query('rollback'); return { ok: false, code: 'VERSION_CONFLICT', errors: ['配置已被其他人修改，请刷新后再保存'] } }
      const next = cur.version + 1
      await client.query('update runtime_config set config=$1, version=$2, updated_at=now(), updated_by=$3 where id=1', [JSON.stringify(v.config), next, by])
      await client.query('insert into runtime_config_history (version, config, updated_by, note) values ($1,$2,$3,$4)', [next, JSON.stringify(v.config), by, note])
      await client.query('commit')
    } catch (e) { await client.query('rollback').catch(() => undefined); throw e } finally { client.release() }
    this.cached = null
    return { ok: true, value: await this.get(true) }
  }

  async history(limit = 20) {
    const r = await this.pool.query('select version, config, updated_at, updated_by, note from runtime_config_history order by version desc limit $1', [limit])
    return r.rows.map(x => ({ version: x.version, config: x.config as ComplianceConfig, updatedAtMs: new Date(x.updated_at).getTime(), updatedBy: x.updated_by, note: x.note }))
  }
}

/* ---------------- password + session ---------------- */
/** Format: scrypt$<N>$<saltB64>$<hashB64>. Generate with `node bencao-auth.mjs hash-password` (reads stdin). */
export function hashPassword(pw: string, N = 16384): string {
  const salt = randomBytes(16)
  const hash = scryptSync(pw, salt, 32, { N, r: 8, p: 1 })
  return `scrypt$${N}$${salt.toString('base64')}$${hash.toString('base64')}`
}
export function verifyPassword(pw: string, stored: string): boolean {
  const m = /^scrypt\$(\d+)\$([A-Za-z0-9+/=]+)\$([A-Za-z0-9+/=]+)$/.exec(stored || '')
  if (!m || typeof pw !== 'string' || pw.length === 0 || pw.length > 256) return false
  const want = Buffer.from(m[3], 'base64')
  const got = scryptSync(pw, Buffer.from(m[2], 'base64'), want.length, { N: Number(m[1]), r: 8, p: 1, maxmem: 64 * 1024 * 1024 })
  return got.length === want.length && timingSafeEqual(got, want)
}
// The session key is bound to the password hash: changing the password invalidates every session.
const sessionSig = (key: Buffer, pwHash: string, exp: number, nonce: string) =>
  createHmac('sha256', key).update(`bencao-admin|v1|${pwHash}|${exp}|${nonce}`).digest('hex')
export function issueSession(key: Buffer, pwHash: string, nowMs: number): { value: string; exp: number } {
  const exp = Math.floor(nowMs / 1000) + SESSION_TTL_SEC
  const nonce = randomBytes(12).toString('hex')
  return { value: `v1.${exp}.${nonce}.${sessionSig(key, pwHash, exp, nonce)}`, exp }
}
export function checkSession(key: Buffer, pwHash: string, raw: string | undefined, nowMs: number): boolean {
  const m = /^v1\.(\d{10})\.([0-9a-f]{24})\.([0-9a-f]{64})$/.exec(raw || '')
  if (!m) return false
  const exp = Number(m[1])
  if (exp <= Math.floor(nowMs / 1000) || exp > Math.floor(nowMs / 1000) + SESSION_TTL_SEC) return false
  const want = Buffer.from(sessionSig(key, pwHash, exp, m[2]), 'hex'), got = Buffer.from(m[3], 'hex')
  return got.length === want.length && timingSafeEqual(got, want)
}
function cookieOf(req: IncomingMessage, name: string): string | undefined {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('='); if (i < 0) continue
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim()
  }
  return undefined
}

/* ---------------- HTTP ---------------- */
export type AdminDeps = {
  pool: pg.Pool; env: Env; now: () => number; store: ConfigStore; sessionKey: Buffer
  clientIp: (req: IncomingMessage) => string
  readJson: (req: IncomingMessage, allowed: string[]) => Promise<Record<string, unknown>>
  audit: (trace: string, actor: string | null, action: string, outcome: string, meta?: Record<string, unknown>) => Promise<void>
  providerInfo: { environment: 'production' | 'staging'; sms: string; realname: string }
}
class AdminFail extends Error { constructor(public status: number, public code: string, message: string, public extra?: Record<string, unknown>) { super(message) } }
const fails = new Map<string, { n: number; until: number }>()
/** Tests only: clear the in-memory per-IP login lockouts. */
export function resetAdminLockouts() { fails.clear() }

function sendRaw(res: ServerResponse, status: number, type: string, body: string, headers: Record<string, string> = {}) {
  res.writeHead(status, {
    'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'content-security-policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    'content-length': String(Buffer.byteLength(body)), ...headers,
  })
  res.end(body)
}
const json = (res: ServerResponse, status: number, payload: unknown, headers: Record<string, string> = {}) => sendRaw(res, status, 'application/json; charset=utf-8', JSON.stringify(payload), headers)

/** Returns true when the request was an admin route (handled), false otherwise. */
export async function handleAdmin(req: IncomingMessage, res: ServerResponse, url: URL, d: AdminDeps, trace: string): Promise<boolean> {
  if (url.pathname !== '/admin' && !url.pathname.startsWith('/admin/')) return false
  const pwHash = d.env.AUTH_ADMIN_PASSWORD_HASH || ''
  try {
    const allow = (d.env.AUTH_ADMIN_ALLOW_IPS || '').split(',').map(s => s.trim()).filter(Boolean)
    if (allow.length && !allow.includes(d.clientIp(req))) throw new AdminFail(404, 'NOT_FOUND', '接口不存在')
    if (!pwHash) throw new AdminFail(503, 'ADMIN_DISABLED', '后台未启用：服务器未配置管理员密码')
    const route = `${req.method} ${url.pathname}`
    switch (route) {
      case 'GET /admin': res.writeHead(301, { location: '/admin/' }); res.end(); return true
      case 'GET /admin/': sendRaw(res, 200, 'text/html; charset=utf-8', ADMIN_HTML); return true
      case 'GET /admin/app.js': sendRaw(res, 200, 'text/javascript; charset=utf-8', ADMIN_JS); return true
      case 'GET /admin/app.css': sendRaw(res, 200, 'text/css; charset=utf-8', ADMIN_CSS); return true
    }
    // ---- API ----
    if (req.method === 'POST' && req.headers['x-bcy-admin'] !== '1') throw new AdminFail(403, 'FORBIDDEN', '禁止访问')
    if (route === 'POST /admin/api/login') {
      const ip = d.clientIp(req), now = d.now(), f = fails.get(ip)
      if (f && f.until > now) throw new AdminFail(429, 'LOCKED', `尝试次数过多，请 ${Math.ceil((f.until - now) / 60_000)} 分钟后再试`)
      const b = await d.readJson(req, ['password'])
      if (!verifyPassword(String(b.password ?? ''), pwHash)) {
        const n = (f && f.until <= now && f.n >= LOCK_FAILS ? 0 : f?.n ?? 0) + 1
        fails.set(ip, { n, until: n >= LOCK_FAILS ? now + LOCK_MS : 0 })
        await d.audit(trace, `admin@${ip}`, 'admin.login', 'FAILED')
        throw new AdminFail(401, 'BAD_PASSWORD', n >= LOCK_FAILS ? '密码错误次数过多，已锁定 15 分钟' : '密码错误')
      }
      fails.delete(ip)
      const s = issueSession(d.sessionKey, pwHash, now)
      await d.audit(trace, `admin@${ip}`, 'admin.login', 'OK')
      json(res, 200, { ok: true, data: { expiresAtMs: s.exp * 1000 } }, { 'set-cookie': `${COOKIE}=${s.value}; Path=/admin; Max-Age=${SESSION_TTL_SEC}; HttpOnly; Secure; SameSite=Strict` })
      return true
    }
    if (route === 'POST /admin/api/logout') {
      json(res, 200, { ok: true, data: {} }, { 'set-cookie': `${COOKIE}=; Path=/admin; Max-Age=0; HttpOnly; Secure; SameSite=Strict` })
      return true
    }
    const authed = checkSession(d.sessionKey, pwHash, cookieOf(req, COOKIE), d.now())
    if (route === 'GET /admin/api/session') { json(res, 200, { ok: true, data: { authed } }); return true }
    if (!authed) throw new AdminFail(401, 'UNAUTHORIZED', '请先登录后台')
    if (route === 'GET /admin/api/config') {
      const [cfg, history, stats] = [await d.store.get(true), await d.store.history(20), await adminStats(d.pool)]
      json(res, 200, { ok: true, data: { config: cfg, history, stats, production: d.store.production, env: d.providerInfo } })
      return true
    }
    if (route === 'POST /admin/api/config') {
      const b = await d.readJson(req, ['config', 'expectedVersion', 'note'])
      const note = typeof b.note === 'string' ? b.note.trim().slice(0, 200) || null : null
      const by = `admin@${d.clientIp(req)}`
      const r = await d.store.update(b.config, Number(b.expectedVersion), by, note)
      if (!r.ok) { await d.audit(trace, by, 'admin.config.update', r.code); throw new AdminFail(r.code === 'VERSION_CONFLICT' ? 409 : 400, r.code, r.errors[0], { errors: r.errors }) }
      await d.audit(trace, by, 'admin.config.update', 'OK', { version: r.value.version, realnameEnabled: r.value.realnameEnabled, minorMode: r.value.minor.mode })
      json(res, 200, { ok: true, data: { config: r.value } })
      return true
    }
    throw new AdminFail(404, 'NOT_FOUND', '接口不存在')
  } catch (e) {
    if (e instanceof AdminFail) json(res, e.status, { ok: false, error: { code: e.code, message: e.message, ...(e.extra || {}) } })
    else if ((e as { status?: number })?.status && (e as { code?: string }).code) {
      const he = e as unknown as { status: number; code: string; message: string }
      json(res, he.status, { ok: false, error: { code: he.code, message: he.message } })
    } else { console.error(`[${trace}] admin error: ${(e as Error)?.message?.slice(0, 200)}`); json(res, 500, { ok: false, error: { code: 'INTERNAL_ERROR', message: '服务异常，请稍后重试' } }) }
    return true
  }
}

/** Aggregate counts only — never phone numbers, names, birth dates or IDs. */
async function adminStats(pool: pg.Pool) {
  const r = await pool.query("select realname_status s, count(*)::int n from auth_accounts where account_status='ACTIVE' group by 1")
  const by: Record<string, number> = { UNVERIFIED: 0, PENDING: 0, VERIFIED_ADULT: 0, VERIFIED_MINOR: 0 }
  for (const row of r.rows) by[row.s] = row.n
  const online = (await pool.query("select count(distinct user_id)::int n from playtime_sessions where not closed and last_at > now() - interval '90 seconds'")).rows[0].n
  return { accountsByRealname: by, onlineVerified: online }
}

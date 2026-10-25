// Admin-configurable compliance (实名认证 / 未成年人保护): validation, production guard, configurable minor
// windows, admin password/session crypto, and the admin HTTP API against an in-memory fake of the auth DB.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import { randomBytes } from 'node:crypto'
import { defaultCompliance, describeMinorRule, LEGAL_MINOR_RULE, validateCompliance, type ComplianceConfig } from '../src/shared/compliance'
import { minorWindow } from '../src/shared/minorPolicy'
import { ConfigStore, checkSession, handleAdmin, hashPassword, issueSession, resetAdminLockouts, verifyPassword, type AdminDeps } from '../backend/auth/src/admin'

const bj = (s: string) => Date.parse(s + '+08:00')
const cfg = (over: Partial<ComplianceConfig['minor']> = {}, realnameEnabled = true): ComplianceConfig => ({ realnameEnabled, minor: { ...LEGAL_MINOR_RULE, days: [...LEGAL_MINOR_RULE.days], ...over } })

describe('defaults', () => {
  it('testing starts with realname OFF; production starts with it ON; both use the national minor rule', () => {
    expect(defaultCompliance(false).realnameEnabled).toBe(false)
    expect(defaultCompliance(true).realnameEnabled).toBe(true)
    expect(defaultCompliance(false).minor).toEqual(LEGAL_MINOR_RULE)
  })
})

describe('validateCompliance', () => {
  it('accepts the national rule and normalizes day order', () => {
    const r = validateCompliance(cfg({ days: [6, 0, 5] }), false)
    expect(r.ok && r.config.minor.days).toEqual([0, 5, 6])
  })
  it('rejects malformed input with Chinese messages', () => {
    const bad = validateCompliance({ realnameEnabled: 'yes', minor: { mode: 'x', startHour: 21, endHour: 20, days: [7, 7], includeHolidays: 1 }, extra: 1 }, false)
    expect(bad.ok).toBe(false)
    if (!bad.ok) {
      expect(bad.errors.join('|')).toMatch(/未知字段：extra/)
      expect(bad.errors.join('|')).toMatch(/实名认证开关/)
      expect(bad.errors.join('|')).toMatch(/开始时间必须早于结束时间/)
    }
  })
  it('window mode needs at least one day', () => {
    expect(validateCompliance(cfg({ days: [], includeHolidays: false }), false).ok).toBe(false)
  })
  it('staging may switch realname off and set minors to “off”', () => {
    expect(validateCompliance(cfg({ mode: 'off' }, false), false).ok).toBe(true)
  })
  it('production guard: realname must stay on, minors must stay restricted, window may only be stricter', () => {
    const err = (c: ComplianceConfig) => { const r = validateCompliance(c, true); return r.ok ? '' : r.errors.join('|') }
    expect(err(cfg({}, false))).toMatch(/正式环境不能关闭实名认证/)
    expect(err(cfg({ mode: 'off' }))).toMatch(/不能取消未成年人限制/)
    expect(err(cfg({ days: [1, 5, 6, 0] }))).toMatch(/周五、周六、周日的子集/)
    expect(err(cfg({ startHour: 19 }))).toMatch(/20:00–21:00 之内/)
    expect(err(cfg({ endHour: 22 }))).toMatch(/20:00–21:00 之内/)
    expect(validateCompliance(cfg({ days: [6] }), true).ok).toBe(true) // stricter: Saturday only
    expect(validateCompliance(cfg({ mode: 'block' }), true).ok).toBe(true)
  })
})

describe('describeMinorRule', () => {
  it('renders the national rule exactly as the old fixed text', () => {
    expect(describeMinorRule(LEGAL_MINOR_RULE)).toBe('未成年人仅可在周五、周六、周日和法定节假日的 20:00–21:00 游戏')
  })
  it('renders block / custom', () => {
    expect(describeMinorRule({ ...LEGAL_MINOR_RULE, mode: 'block' })).toBe('本游戏暂不向未成年人提供服务')
    expect(describeMinorRule({ mode: 'window', startHour: 9, endHour: 10, days: [6], includeHolidays: false })).toBe('未成年人仅可在周六的 09:00–10:00 游戏')
  })
})

describe('minorWindow with configurable rules', () => {
  const fri2030 = bj('2026-10-23T20:30:00'), sat2030 = bj('2026-10-24T20:30:00')
  it('default rule unchanged (Friday 20:30 allowed)', () => {
    expect(minorWindow(fri2030).allowed).toBe(true)
    expect(minorWindow(fri2030, LEGAL_MINOR_RULE)).toEqual(minorWindow(fri2030))
  })
  it('block → never allowed, no next window', () => {
    expect(minorWindow(fri2030, { ...LEGAL_MINOR_RULE, mode: 'block' })).toEqual({ allowed: false, playableUntilMs: null, nextWindowStartMs: null })
  })
  it('off → always allowed', () => {
    expect(minorWindow(bj('2026-10-21T10:00:00'), { ...LEGAL_MINOR_RULE, mode: 'off' }).allowed).toBe(true)
  })
  it('Saturday-only rule: Friday refused with Saturday as next window', () => {
    const sat = { ...LEGAL_MINOR_RULE, days: [6], includeHolidays: false }
    const w = minorWindow(fri2030, sat)
    expect(w.allowed).toBe(false)
    expect(w.nextWindowStartMs).toBe(bj('2026-10-24T20:00:00'))
    expect(minorWindow(sat2030, sat).allowed).toBe(true)
  })
  it('custom hours are honoured', () => {
    const r = { ...LEGAL_MINOR_RULE, startHour: 20, endHour: 21 }
    expect(minorWindow(bj('2026-10-23T21:00:00'), r).allowed).toBe(false)
    expect(minorWindow(bj('2026-10-23T20:59:00'), r).playableUntilMs).toBe(bj('2026-10-23T21:00:00'))
  })
})

describe('admin password + session', () => {
  const key = randomBytes(32)
  it('scrypt hash verifies only the right password', () => {
    const h = hashPassword('correct horse battery', 1024)
    expect(h).toMatch(/^scrypt\$1024\$/)
    expect(verifyPassword('correct horse battery', h)).toBe(true)
    expect(verifyPassword('wrong', h)).toBe(false)
    expect(verifyPassword('', h)).toBe(false)
    expect(verifyPassword('x', 'garbage')).toBe(false)
  })
  it('session: valid, tamper-proof, expires, and dies when the password changes', () => {
    const h1 = hashPassword('pw-one-123456', 1024), h2 = hashPassword('pw-two-123456', 1024), now = Date.now()
    const s = issueSession(key, h1, now)
    expect(checkSession(key, h1, s.value, now)).toBe(true)
    expect(checkSession(key, h1, s.value.slice(0, -1) + (s.value.endsWith('0') ? '1' : '0'), now)).toBe(false)
    expect(checkSession(key, h1, s.value, now + 9 * 3600_000)).toBe(false)
    expect(checkSession(key, h2, s.value, now)).toBe(false)
    expect(checkSession(randomBytes(32), h1, s.value, now)).toBe(false)
    expect(checkSession(key, h1, undefined, now)).toBe(false)
  })
})

/* ---------------- admin HTTP API against a fake auth DB ---------------- */
type Row = { config: ComplianceConfig; version: number; updated_at: Date; updated_by: string }
class FakePool {
  row: Row | null = null
  history: { version: number; config: ComplianceConfig; updated_at: Date; updated_by: string; note: string | null }[] = []
  async query(sql: string, p: unknown[] = []): Promise<{ rows: any[] }> {
    const q = sql.replace(/\s+/g, ' ').trim()
    if (q === 'begin' || q === 'commit' || q === 'rollback') return { rows: [] }
    if (q.startsWith('insert into runtime_config (')) {
      if (this.row) return { rows: [] }
      this.row = { config: JSON.parse(p[0] as string), version: 1, updated_at: new Date(), updated_by: 'system:default' }; return { rows: [{ version: 1 }] }
    }
    if (q.startsWith('insert into runtime_config_history')) {
      const seed = q.includes("'system:default'")
      this.history.push(seed ? { version: 1, config: JSON.parse(p[0] as string), updated_at: new Date(), updated_by: 'system:default', note: '初始默认配置' }
        : { version: p[0] as number, config: JSON.parse(p[1] as string), updated_at: new Date(), updated_by: p[2] as string, note: p[3] as string | null })
      return { rows: [] }
    }
    if (q.startsWith('select config, version')) return { rows: this.row ? [this.row] : [] }
    if (q.startsWith('select version from runtime_config')) return { rows: this.row ? [{ version: this.row.version }] : [] }
    if (q.startsWith('update runtime_config')) { this.row = { config: JSON.parse(p[0] as string), version: p[1] as number, updated_at: new Date(), updated_by: p[2] as string }; return { rows: [] } }
    if (q.startsWith('select version, config')) return { rows: [...this.history].sort((a, b) => b.version - a.version).slice(0, p[0] as number) }
    if (q.startsWith('select realname_status s')) return { rows: [{ s: 'VERIFIED_ADULT', n: 3 }, { s: 'VERIFIED_MINOR', n: 1 }] }
    if (q.startsWith('select count(distinct user_id)')) return { rows: [{ n: 2 }] }
    throw new Error('fake pool: unexpected SQL ' + q)
  }
  async connect() { return { query: (s: string, p?: unknown[]) => this.query(s, p), release() {} } }
}
async function readJson(req: IncomingMessage, allowed: string[]) {
  const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer)
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  for (const k of Object.keys(body)) if (!allowed.includes(k)) throw Object.assign(new Error('请求包含未知字段'), { status: 400, code: 'INVALID_PAYLOAD' })
  return body
}

function startAdmin(production: boolean, pw: string) {
  const pool = new FakePool()
  const store = new ConfigStore(pool as any, production)
  const audits: string[] = []
  const deps: AdminDeps = {
    pool: pool as any, env: { AUTH_ADMIN_PASSWORD_HASH: hashPassword(pw, 1024) }, now: Date.now, store, sessionKey: randomBytes(32),
    clientIp: req => req.socket.remoteAddress || 'x', readJson,
    audit: async (_t, _a, action, outcome) => { audits.push(`${action}:${outcome}`) },
    providerInfo: { environment: production ? 'production' : 'staging', sms: 'mock', realname: 'mock' },
  }
  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://local')
    if (!(await handleAdmin(req, res, url, deps, 't'))) { res.writeHead(404); res.end() }
  })
  return { pool, store, audits, server }
}

describe('admin console API (staging)', () => {
  const PW = 'test-admin-password-1'
  const h = startAdmin(false, PW)
  let base = '', cookie = ''
  beforeAll(async () => {
    await h.store.seed()
    await new Promise<void>(r => h.server.listen(0, '127.0.0.1', () => r()))
    base = `http://127.0.0.1:${(h.server.address() as { port: number }).port}`
  })
  afterAll(() => new Promise<void>(r => h.server.close(() => r())))
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-bcy-admin': '1', ...(cookie ? { cookie } : {}), ...headers }, body: JSON.stringify(body) })
  const get = (path: string) => fetch(base + path, { headers: cookie ? { cookie } : {} })

  it('serves the console page with a strict CSP and no framing', async () => {
    const r = await get('/admin/')
    expect(r.status).toBe(200)
    expect(r.headers.get('content-security-policy')).toMatch(/frame-ancestors 'none'/)
    expect(r.headers.get('x-frame-options')).toBe('DENY')
    expect(await r.text()).toContain('合规后台')
    expect((await get('/admin/app.js')).status).toBe(200)
  })
  it('API needs login; POST needs the anti-CSRF header', async () => {
    expect((await get('/admin/api/config')).status).toBe(401)
    expect((await post('/admin/api/login', { password: PW }, { 'x-bcy-admin': '0' })).status).toBe(403)
    expect(await (await get('/admin/api/session')).json()).toEqual({ ok: true, data: { authed: false } })
  })
  it('wrong password is refused; right password sets an HttpOnly Secure SameSite=Strict cookie', async () => {
    expect((await post('/admin/api/login', { password: 'nope' })).status).toBe(401)
    const r = await post('/admin/api/login', { password: PW })
    expect(r.status).toBe(200)
    const sc = r.headers.get('set-cookie') || ''
    expect(sc).toMatch(/HttpOnly/); expect(sc).toMatch(/Secure/); expect(sc).toMatch(/SameSite=Strict/); expect(sc).toMatch(/Path=\/admin/)
    cookie = sc.split(';')[0]
    expect(h.audits).toContain('admin.login:FAILED'); expect(h.audits).toContain('admin.login:OK')
  })
  it('shows the seeded default (realname off) with aggregate stats only', async () => {
    const j = await (await get('/admin/api/config')).json()
    expect(j.data.config.realnameEnabled).toBe(false)
    expect(j.data.config.version).toBe(1)
    expect(j.data.production).toBe(false)
    expect(j.data.stats.accountsByRealname.VERIFIED_MINOR).toBe(1)
    expect(JSON.stringify(j)).not.toMatch(/phone|idNumber|birth/)
  })
  it('saves a change, records history + audit, and rejects a stale version', async () => {
    const next = cfg({ days: [6] }, true)
    const r = await post('/admin/api/config', { config: next, expectedVersion: 1, note: '开启实名，仅周六' })
    expect(r.status).toBe(200)
    const j = await r.json()
    expect(j.data.config).toMatchObject({ realnameEnabled: true, version: 2 })
    expect((await h.store.get()).minor.days).toEqual([6])
    expect(h.pool.history.length).toBe(2)
    expect(h.audits).toContain('admin.config.update:OK')
    const stale = await post('/admin/api/config', { config: cfg(), expectedVersion: 1 })
    expect(stale.status).toBe(409)
    expect((await stale.json()).error.code).toBe('VERSION_CONFLICT')
  })
  it('invalid config → 400 with all messages, nothing saved', async () => {
    const r = await post('/admin/api/config', { config: { realnameEnabled: true, minor: { ...LEGAL_MINOR_RULE, startHour: 22 } }, expectedVersion: 2 })
    expect(r.status).toBe(400)
    expect((await r.json()).error.errors.join('')).toMatch(/开始时间必须早于结束时间/)
    expect((await h.store.get()).version).toBe(2)
  })
  it('locks the IP after repeated wrong passwords', async () => {
    const saved = cookie; cookie = ''
    for (let i = 0; i < 5; i++) await post('/admin/api/login', { password: 'wrong' + i })
    const r = await post('/admin/api/login', { password: PW })
    expect(r.status).toBe(429)
    cookie = saved
  })
})

describe('admin console API (production guard)', () => {
  const PW = 'prod-admin-password-1'
  const h = startAdmin(true, PW)
  let base = ''
  beforeAll(async () => {
    resetAdminLockouts() // the staging suite deliberately locked 127.0.0.1
    await h.store.seed()
    await new Promise<void>(r => h.server.listen(0, '127.0.0.1', () => r()))
    base = `http://127.0.0.1:${(h.server.address() as { port: number }).port}`
  })
  afterAll(() => new Promise<void>(r => h.server.close(() => r())))
  it('production seeds realname ON and refuses to switch it off', async () => {
    expect((await h.store.get()).realnameEnabled).toBe(true)
    const login = await fetch(base + '/admin/api/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-bcy-admin': '1' }, body: JSON.stringify({ password: PW }) })
    const cookie = (login.headers.get('set-cookie') || '').split(';')[0]
    const r = await fetch(base + '/admin/api/config', { method: 'POST', headers: { 'content-type': 'application/json', 'x-bcy-admin': '1', cookie }, body: JSON.stringify({ config: cfg({}, false), expectedVersion: 1 }) })
    expect(r.status).toBe(400)
    expect((await r.json()).error.message).toMatch(/正式环境不能关闭实名认证/)
    expect((await h.store.get()).realnameEnabled).toBe(true)
  })
  it('normalizes jsonb key order and day order when reading (dirty-check regression)', async () => {
    const pool = new FakePool()
    // Postgres jsonb returns keys sorted by length/bytes, not in insertion order
    pool.row = { config: { minor: { days: [6, 0, 5], mode: 'window', endHour: 21, startHour: 20, includeHolidays: true }, realnameEnabled: false } as any, version: 3, updated_at: new Date(), updated_by: 'x' }
    const got = await new ConfigStore(pool as any, false).get(true)
    expect(Object.keys(got.minor)).toEqual(['mode', 'startHour', 'endHour', 'days', 'includeHolidays'])
    expect(got.minor.days).toEqual([0, 5, 6])
    expect(JSON.stringify({ realnameEnabled: got.realnameEnabled, minor: got.minor })).toBe(JSON.stringify(cfg({ days: [0, 5, 6] }, false)))
  })
  it('a production server refuses to start with a non-production config (e.g. copied from staging)', async () => {
    const pool = new FakePool()
    pool.row = { config: cfg({}, false), version: 7, updated_at: new Date(), updated_by: 'x' }
    await expect(new ConfigStore(pool as any, true).seed()).rejects.toThrow(/not allowed in production/)
  })
})

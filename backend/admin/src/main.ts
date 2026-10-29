// bencao-admin: read-mostly operations console for one game.
// Node 22 + node:http + pg. No framework, no ORM. Every mutation is audited.
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { randomUUID, randomBytes, createHash } from 'node:crypto'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { Store, type SessionRow } from './store'
import { AuthReader, NakamaReader } from './readers'
import { METRIC_DEFINITIONS, metricsCsv, metricsSummary, runMetrics, GAME_ID } from './metrics'
import { hashPassword, ipHash, newToken, newTotpSecret, tokenHash, totpUri, verifyPassword, verifyTotp } from './crypto'
import { can, ROLE_PERMISSIONS, type AdminRole, type Permission, type SessionUser, type FeedbackStatus } from '../../../src/shared/adminContract'
import {
  HttpError, clientIp, parseCookies, readJson, sendError, sendJson, sendText, serveStatic, securityHeaders,
} from './http'

/* ---------------- environment ---------------- */
type Env = {
  port: number
  adminDbUrl: string
  adminDbPool: number
  nakamaDbUrl: string | null
  authDbUrl: string | null
  authBaseUrl: string | null
  authInternalSecret: string | null
  environment: 'staging' | 'production'
  cookieSecure: boolean
  trustProxy: boolean
  allowIps: string[]
  ipSalt: string
  bootstrapUsername: string
  bootstrapPassword: string | null
  gameId: string
  root: string
  staticDir: string
  publicDir: string
  snapshotPath: string
  contentDir: string
  gameBaseUrl: string
  now: () => number
}

function loadEnv(): Env {
  const e = process.env
  const root = e.ADMIN_ROOT ? resolve(e.ADMIN_ROOT) : resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
  const adminDbUrl = e.ADMIN_DATABASE_URL
  if (!adminDbUrl) throw new Error('ADMIN_DATABASE_URL is required')
  const environment = e.ADMIN_ENV === 'production' ? 'production' : 'staging'
  return {
    port: Number(e.ADMIN_PORT || 7361),
    adminDbUrl,
    adminDbPool: Number(e.ADMIN_DB_POOL || 5),
    nakamaDbUrl: e.NAKAMA_DATABASE_URL || null,
    authDbUrl: e.AUTH_DATABASE_URL || null,
    authBaseUrl: e.AUTH_BASE_URL ? e.AUTH_BASE_URL.replace(/\/$/, '') : null,
    authInternalSecret: e.AUTH_INTERNAL_SECRET || null,
    environment,
    cookieSecure: e.ADMIN_COOKIE_SECURE === '1' || (environment === 'production' && e.ADMIN_COOKIE_SECURE !== '0'),
    trustProxy: e.ADMIN_TRUST_PROXY === '1',
    allowIps: (e.ADMIN_ALLOW_IPS || '').split(',').map(s => s.trim()).filter(Boolean),
    ipSalt: e.ADMIN_IP_SALT || createHash('sha256').update(adminDbUrl).digest('hex'),
    bootstrapUsername: e.ADMIN_BOOTSTRAP_USERNAME || 'owner',
    bootstrapPassword: e.ADMIN_BOOTSTRAP_PASSWORD || null,
    gameId: e.ADMIN_GAME_ID || GAME_ID,
    root,
    staticDir: e.ADMIN_STATIC_DIR ? resolve(e.ADMIN_STATIC_DIR) : join(root, 'dist-admin'),
    publicDir: join(root, 'public'),
    snapshotPath: e.ADMIN_SNAPSHOT_PATH ? resolve(e.ADMIN_SNAPSHOT_PATH) : join(root, 'admin-snapshot.json'),
    contentDir: join(root, 'content'),
    gameBaseUrl: e.ADMIN_GAME_URL || 'https://bencaoyou.tryliang.me',
    now: () => Date.now(),
  }
}

const COOKIE = 'bcy_admin_sid'
const IDLE_MS = 2 * 3600_000
const ABSOLUTE_MS = 12 * 3600_000
const LOCK_FAILS = 5
const LOCK_MS = 15 * 60_000

type Ctx = { req: Parameters<typeof clientIp>[0]; env: Env; store: Store; nakama: NakamaReader | null; auth: AuthReader | null; session: SessionRow | null; trace: string }

/* ---------------- bootstrap ---------------- */
async function applySchema(pool: pg.Pool, env: Env) {
  const schema = join(dirname(fileURLToPath(import.meta.url)), '../sql/0001_admin.sql')
  if (existsSync(schema)) await pool.query(readFileSync(schema, 'utf8'))
  else console.warn('[admin] schema file not found; expected tables to exist already')
  const game = await pool.query('select 1 from games where id=$1', [env.gameId])
  if (!game.rows[0]) await pool.query('insert into games (id,name,stage,timezone) values ($1,$2,$3,$4)', [env.gameId, '本草小游记', 'S0', 'Asia/Shanghai'])
}

async function bootstrapOwner(store: Store, env: Env) {
  if (await store.countAdmins() > 0) return
  const password = env.bootstrapPassword || randomBytes(12).toString('base64url')
  await store.createAdmin({
    username: env.bootstrapUsername,
    passwordHash: hashPassword(password),
    role: 'owner',
    createdBy: 'system:bootstrap',
  })
  if (env.bootstrapPassword) {
    console.log(`[admin] bootstrap owner "${env.bootstrapUsername}" created from ADMIN_BOOTSTRAP_PASSWORD`)
  } else {
    const file = process.env.ADMIN_BOOTSTRAP_FILE || join(dirname(fileURLToPath(import.meta.url)), '../.bootstrap-password')
    writeFileSync(file, `${password}\n`, { mode: 0o600 })
    console.log(`[admin] bootstrap owner "${env.bootstrapUsername}" created; password written to ${file}`)
  }
}

/* ---------------- snapshot ---------------- */
type Snapshot = Record<string, any> | null
let snapCache: { mtimeMs: number; data: Snapshot } | null = null

function getSnapshot(env: Env): Snapshot {
  if (!existsSync(env.snapshotPath)) return null
  const st = statSync(env.snapshotPath)
  if (snapCache && snapCache.mtimeMs === st.mtimeMs) return snapCache.data
  try {
    const data = JSON.parse(readFileSync(env.snapshotPath, 'utf8'))
    snapCache = { mtimeMs: st.mtimeMs, data }
    return data
  } catch (e) {
    console.error('[admin] snapshot parse failed:', (e as Error).message)
    return null
  }
}

function readContentJson(env: Env, file: string): unknown {
  const p = join(env.contentDir, file)
  if (!existsSync(p)) return null
  try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return null }
}

/* ---------------- helpers ---------------- */
/** Quote a CSV cell and neutralize spreadsheet formula prefixes. */
const csvCell = (v: unknown): string => {
  const text = String(v ?? '')
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
  return `"${safe.replace(/"/g, '""')}"`
}
const ROLE_SET: AdminRole[] = ['owner', 'ops', 'support', 'reviewer', 'viewer']
const STATUS_SET: FeedbackStatus[] = ['NEW', 'IN_PROGRESS', 'RESOLVED', 'ARCHIVED']

function sessionUser(s: SessionRow, env: Env): SessionUser {
  return {
    id: s.userId, username: s.username, role: s.role, totpEnabled: s.totpEnabled,
    environment: env.environment, permissions: [...ROLE_PERMISSIONS[s.role]],
  }
}

function maskContact(c: string): string {
  if (!c) return ''
  const phone = c.replace(/[\s-]/g, '')
  if (/^1[3-9]\d{9}$/.test(phone)) return `${phone.slice(0, 3)}****${phone.slice(-4)}`
  if (/^[^@\s]+@[^@\s]+$/.test(c)) { const [u, d] = c.split('@'); return `${u.slice(0, 1)}***@${d}` }
  return c.length <= 2 ? '**' : `${c.slice(0, 1)}***${c.slice(-1)}`
}

const RETENTION_MS = 180 * 86400000
/** Feedback is kept 180 days after resolution; the console flags rows past that horizon. */
function retentionDueAtMs(status: string, updatedAtMs: number | null | undefined): number | null {
  if (!updatedAtMs) return null
  if (status !== 'RESOLVED' && status !== 'ARCHIVED') return null
  return updatedAtMs + RETENTION_MS
}

/** Delete console state whose raw feedback object no longer exists (account deletion / ops cleanup). */
export async function reconcileFeedbackState(store: Store, nakama: NakamaReader, gameId: string): Promise<number> {
  const [rows, states] = await Promise.all([nakama.allFeedback(10000), store.allFeedbackState(gameId)])
  const live = new Set(rows.map(r => `${r.ownerId}\u0000${r.key}`))
  let removed = 0
  for (const s of states) {
    if (!live.has(`${s.ownerId}\u0000${s.storageKey}`)) {
      if (await store.deleteFeedbackState(gameId, s.ownerId, s.storageKey)) removed++
    }
  }
  return removed
}

const dayKey = (ms: number) => new Date(ms + 8 * 3600_000).toISOString().slice(0, 10)
const dateAdd = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)
const str = (v: string | null | undefined) => (v === null || v === undefined ? undefined : v.trim() || undefined)
const int = (v: string | null | undefined, d: number, min = 1, max = 1000) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : d
}

/* ---------------- app ---------------- */
export function createApp(env: Env, store: Store, nakama: NakamaReader | null, auth: AuthReader | null) {
  const loginFails = new Map<string, { n: number; until: number }>()
  const summaryCache = new Map<string, { at: number; data: unknown }>()

  type AuditActor = { userId: string; username: string; role: AdminRole }
  const audit = (ctx: Ctx, s: AuditActor | null, action: string, outcome: string, extra: Partial<{ targetType: string; targetId: string; metadata: Record<string, unknown> }> = {}) =>
    store.audit({
      actorId: s?.userId ?? null,
      actorName: s?.username ?? `admin@${clientIp(ctx.req, env.trustProxy)}`,
      action, outcome,
      ipHash: ipHash(clientIp(ctx.req, env.trustProxy), env.ipSalt),
      ...extra,
    })

  function checkCsrf(req: import('node:http').IncomingMessage) {
    if (req.method === 'GET' || req.method === 'HEAD') return
    if (req.headers['x-bcy-admin'] !== '1') throw new HttpError(403, 'FORBIDDEN', '禁止访问')
    const origin = req.headers.origin
    if (origin) {
      try { if (new URL(origin).host !== req.headers.host) throw new Error('bad origin') } catch {
        throw new HttpError(403, 'FORBIDDEN', '来源校验失败')
      }
    }
  }

  async function requirePerm(ctx: Ctx, p: Permission) {
    if (!ctx.session) throw new HttpError(401, 'UNAUTHORIZED', '请先登录后台')
    if (!can(ctx.session.role, p)) {
      await audit(ctx, ctx.session, `deny.${p}`, 'DENIED', { targetType: 'permission', targetId: p })
      throw new HttpError(403, 'FORBIDDEN', '没有权限执行此操作')
    }
  }

  async function getSummary(days: number) {
    const key = String(days)
    const hit = summaryCache.get(key)
    if (hit && env.now() - hit.at < 60_000) return hit.data as Awaited<ReturnType<typeof metricsSummary>>
    if (!nakama) throw new HttpError(503, 'NAKAMA_DB_MISSING', '未配置 Nakama 只读数据库')
    const data = await metricsSummary(store, nakama, env.now(), days)
    summaryCache.set(key, { at: env.now(), data })
    return data
  }

  async function authInternal(path: string, init?: { method?: string; body?: unknown }) {
    if (!env.authBaseUrl || !env.authInternalSecret) {
      throw new HttpError(503, 'AUTH_NOT_CONFIGURED', '认证服务未部署在本地；请先部署 bencao-auth')
    }
    let r: Response
    try {
      r = await fetch(`${env.authBaseUrl}${path}`, {
        method: init?.method || 'GET',
        headers: {
          'x-internal-secret': env.authInternalSecret,
          ...(init?.body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
        body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(5000),
      })
    } catch {
      throw new HttpError(502, 'AUTH_UNREACHABLE', '认证服务不可达')
    }
    const j = await r.json().catch(() => null) as any
    if (!r.ok || !j?.ok) throw new HttpError(r.status === 401 ? 502 : r.status || 502, j?.error?.code || 'AUTH_ERROR', j?.error?.message || '认证服务返回错误')
    return j.data
  }

  async function authServiceHealth() {
    if (!env.authBaseUrl) return { configured: false, ok: false }
    try {
      const r = await fetch(`${env.authBaseUrl}/auth/healthz`, { signal: AbortSignal.timeout(1500) })
      return { configured: true, ok: r.ok, status: r.status }
    } catch { return { configured: true, ok: false } }
  }

  async function enrichUsers(rows: Array<{ id: string; customId: string; username: string | null; createTimeMs: number; updateTimeMs: number }>) {
    const ids = rows.map(r => r.id)
    const authIds = rows.map(r => (r.customId.startsWith('bcy-') ? r.customId.slice(4) : null)).filter((x): x is string => !!x)
    const [states, accounts, feedbackCounts, playtime] = await Promise.all([
      nakama ? nakama.playerStates(ids) : Promise.resolve(new Map()),
      auth && authIds.length ? auth.accountsByAuthIds(authIds) : Promise.resolve(new Map()),
      nakama ? nakama.feedbackCountsByOwner(ids) : Promise.resolve(new Map()),
      auth && authIds.length ? auth.playtimeLast7d(authIds) : Promise.resolve(new Map<string, number>()),
    ])
    return rows.map(u => {
      const authId = u.customId.startsWith('bcy-') ? u.customId.slice(4) : null
      const account = authId ? accounts.get(authId) : null
      const state = states.get(u.id)
      return {
        id: u.id,
        customId: u.customId,
        username: u.username,
        loginMethod: authId ? 'phone' : 'device',
        authUserId: authId,
        realnameStatus: account?.realnameStatus ?? 'UNVERIFIED',
        accountStatus: account?.accountStatus ?? 'ACTIVE',
        createdAtMs: u.createTimeMs,
        lastActiveMs: state?.summary.updatedAtMs || u.updateTimeMs,
        plantsDiscovered: state?.summary.plantsDiscovered ?? 0,
        levelsCompleted: state?.summary.levelsCompleted ?? 0,
        feedbackCount: feedbackCounts.get(u.id) ?? 0,
        playtimeMinutes7d: authId ? playtime.get(authId) ?? 0 : null,
      }
    })
  }

  async function handleApi(ctx: Ctx, url: URL, res: import('node:http').ServerResponse) {
    const { req, store: st } = ctx
    const path = url.pathname.slice('/admin/api'.length) || '/'
    const method = req.method || 'GET'
    const sp = url.searchParams
    const mutating = method !== 'GET' && method !== 'HEAD'

    /* ---- login ---- */
    if (path === '/session' && method === 'POST') {
      try { checkCsrf(req) } catch (e) {
        await audit(ctx, null, 'csrf.login', 'DENIED')
        throw e
      }
      const b = await readJson(req, ['username', 'password', 'totp'])
      const username = String(b.username || '').trim()
      const password = String(b.password || '')
      const ip = clientIp(req, env.trustProxy)
      const key = `${ip}|${username.toLowerCase()}`
      const f = loginFails.get(key)
      if (f && f.until > env.now()) throw new HttpError(429, 'LOCKED', `尝试次数过多，请 ${Math.ceil((f.until - env.now()) / 60_000)} 分钟后再试`)
      const user = await st.findAdminByUsername(username)
      const ok = !!user && user.status === 'ACTIVE' && verifyPassword(password, user.passwordHash)
      if (!ok) {
        const n = (f && f.until <= env.now() && f.n >= LOCK_FAILS ? 0 : f?.n ?? 0) + 1
        loginFails.set(key, { n, until: n >= LOCK_FAILS ? env.now() + LOCK_MS : 0 })
        await audit(ctx, null, 'admin.login', 'FAILED', { metadata: { username: username.slice(0, 32) } })
        throw new HttpError(401, 'BAD_CREDENTIALS', n >= LOCK_FAILS ? '密码错误次数过多，已锁定 15 分钟' : '用户名或密码错误')
      }
      if (user.totpEnabled) {
        if (!b.totp) throw new HttpError(401, 'TOTP_REQUIRED', '请输入动态验证码')
        if (!user.totpSecret || !verifyTotp(user.totpSecret, b.totp, env.now())) {
          await audit(ctx, null, 'admin.login.totp', 'FAILED', { metadata: { username: user.username } })
          throw new HttpError(401, 'BAD_TOTP', '动态验证码错误')
        }
      }
      loginFails.delete(key)
      const token = newToken()
      const expiresAt = new Date(env.now() + ABSOLUTE_MS)
      await st.createSession({
        userId: user.id, tokenHash: tokenHash(token), expiresAt,
        ipHash: ipHash(ip, env.ipSalt),
        userAgentHash: createHash('sha256').update(String(req.headers['user-agent'] || '')).digest('hex').slice(0, 32),
      })
      await st.markLogin(user.id)
      await audit(ctx, { userId: user.id, username: user.username, role: user.role }, 'admin.login', 'OK')
      const cookie = [`${COOKIE}=${token}`, 'Path=/admin', `Max-Age=${ABSOLUTE_MS / 1000}`, 'HttpOnly', 'SameSite=Strict', ...(env.cookieSecure ? ['Secure'] : [])].join('; ')
      const s = { userId: user.id, username: user.username, role: user.role, totpEnabled: user.totpEnabled } as SessionRow
      sendJson(res, 200, { ok: true, data: { user: sessionUser(s, env), game: await st.getGame(env.gameId) } }, { 'set-cookie': cookie })
      return
    }

    /* ---- session required ---- */
    if (!ctx.session) throw new HttpError(401, 'UNAUTHORIZED', '请先登录后台')
    if (mutating) {
      try { checkCsrf(req) } catch (e) {
        await audit(ctx, ctx.session, 'csrf', 'DENIED', { metadata: { path } })
        throw e
      }
    }

    if (path === '/session' && method === 'DELETE') {
      await st.revokeSession(ctx.session.id)
      await audit(ctx, ctx.session, 'admin.logout', 'OK')
      sendJson(res, 200, { ok: true, data: {} }, { 'set-cookie': `${COOKIE}=; Path=/admin; Max-Age=0; HttpOnly; SameSite=Strict` })
      return
    }
    if (path === '/session' && method === 'GET') {
      sendJson(res, 200, { ok: true, data: { user: sessionUser(ctx.session, env), game: await st.getGame(env.gameId), sessions: await st.listSessions(ctx.session.userId) } })
      return
    }

    if (path === '/nav-badges' && method === 'GET') {
      const data: Record<string, number> = {}
      if (can(ctx.session.role, 'feedback.view') && nakama) {
        const [rows, states] = await Promise.all([nakama.allFeedback(5000), st.allFeedbackState(env.gameId)])
        const map = new Map(states.map(x => [`${x.ownerId}\u0000${x.storageKey}`, x.status]))
        data.feedback = rows.reduce((n, r) => {
          const status = map.get(`${r.ownerId}\u0000${r.key}`) ?? 'NEW'
          return n + (status !== 'RESOLVED' && status !== 'ARCHIVED' ? 1 : 0)
        }, 0)
      }
      if (can(ctx.session.role, 'content.view')) {
        const snap = getSnapshot(env)
        data.review = (snap?.review?.counts?.total ?? 0) - (snap?.review?.counts?.approved ?? 0)
      }
      sendJson(res, 200, { ok: true, data })
      return
    }

    const s = ctx.session
    const isOwner = s.role === 'owner'

    /* ---- overview ---- */
    if (path === '/overview' && method === 'GET') {
      await requirePerm(ctx, 'overview.view')
      const snap = getSnapshot(env)
      const [summary, feedbackRows, feedbackStates, failedRealname, health, game] = await Promise.all([
        getSummary(7),
        nakama ? nakama.allFeedback(5000) : Promise.resolve([]),
        st.allFeedbackState(env.gameId),
        auth ? auth.failedRealnameRequests() : Promise.resolve(0),
        getHealth(ctx),
        st.getGame(env.gameId),
      ])
      const stateMap = new Map(feedbackStates.map(x => [`${x.ownerId}\u0000${x.storageKey}`, x.status]))
      let unresolved = 0
      for (const row of feedbackRows) {
        const status = stateMap.get(`${row.ownerId}\u0000${row.key}`) ?? 'NEW'
        if (status !== 'RESOLVED' && status !== 'ARCHIVED') unresolved++
      }
      sendJson(res, 200, { ok: true, data: {
        stage: game?.stage ?? snap?.stage ?? 'S0',
        game: game ?? { id: env.gameId, name: '本草小游记', stage: 'S0', timezone: 'Asia/Shanghai' },
        summary,
        launch: {
          review: snap?.review ?? null,
          assets: snap?.assets ? {
            total: snap.assets.total, withRuntimeFile: snap.assets.withRuntimeFile,
            withLicence: snap.assets.withLicence, aiLabelled: snap.assets.aiLabelled,
            missingRuntime: snap.assets.missingRuntime, packStatus: snap.assets.packStatus,
          } : null,
          versions: snap?.versions ?? null,
          snapshotGeneratedAt: snap?.generatedAt ?? null,
          blockers: snap?.release?.preflight?.blockers ?? [],
          warnings: snap?.release?.preflight?.warnings ?? [],
          preflightPass: snap?.release?.preflight?.pass ?? null,
        },
        todos: { unresolvedFeedback: unresolved, failedRealname, pendingReview: (snap?.review?.counts?.total ?? 0) - (snap?.review?.counts?.approved ?? 0) },
        health,
        recentFeedback: feedbackRows.slice(0, 5).map(r => ({
          ownerId: r.ownerId, key: r.key, atMs: r.atMs, excerpt: r.text.slice(0, 60),
          status: stateMap.get(`${r.ownerId}\u0000${r.key}`) ?? 'NEW', clientBuild: r.clientBuild,
        })),
      } })
      return
    }

    /* ---- metrics ---- */
    if (path === '/metrics/definitions' && method === 'GET') {
      await requirePerm(ctx, 'overview.view')
      sendJson(res, 200, { ok: true, data: { definitions: METRIC_DEFINITIONS } })
      return
    }
    if (path === '/metrics/summary' && method === 'GET') {
      await requirePerm(ctx, 'metrics.view')
      const days = int(sp.get('days'), 7, 1, 90)
      sendJson(res, 200, { ok: true, data: await getSummary(days) })
      return
    }
    if (path === '/metrics/timeseries' && method === 'GET') {
      await requirePerm(ctx, 'metrics.view')
      const days = int(sp.get('days'), 30, 1, 90)
      const summary = await getSummary(days)
      sendJson(res, 200, { ok: true, data: { days: summary.series.days, series: summary.series, computedAt: summary.computedAt } })
      return
    }
    if (path === '/metrics/funnel' && method === 'GET') {
      await requirePerm(ctx, 'metrics.view')
      const days = int(sp.get('days'), 7, 1, 90)
      const summary = await getSummary(days)
      sendJson(res, 200, { ok: true, data: { range: summary.range, funnel: summary.funnel, sources: summary.sources } })
      return
    }
    if (path === '/metrics/retention' && method === 'GET') {
      await requirePerm(ctx, 'metrics.view')
      const days = int(sp.get('days'), 30, 1, 90)
      const summary = await getSummary(days)
      sendJson(res, 200, { ok: true, data: summary.retention })
      return
    }
    if (path === '/metrics/export.csv' && method === 'GET') {
      await requirePerm(ctx, 'metrics.export')
      const days = int(sp.get('days'), 30, 1, 180)
      const summary = await getSummary(days)
      await audit(ctx, s, 'metrics.export', 'OK', { metadata: { days } })
      const csv = metricsCsv(summary)
      sendText(res, 200, 'text/csv; charset=utf-8', '﻿' + csv, { 'content-disposition': `attachment; filename="bencaoyou-metrics-${days}d.csv"` })
      return
    }
    if (path === '/metrics/recompute' && method === 'POST') {
      await requirePerm(ctx, 'config.write')
      if (!nakama) throw new HttpError(503, 'NAKAMA_DB_MISSING', '未配置 Nakama 只读数据库')
      const r = await runMetrics(store, nakama, env.now())
      summaryCache.clear()
      await audit(ctx, s, 'metrics.recompute', 'OK', { metadata: { days: r.days, cohorts: r.cohorts } })
      sendJson(res, 200, { ok: true, data: r })
      return
    }

    /* ---- users ---- */
    if (path === '/users' && method === 'GET') {
      await requirePerm(ctx, 'users.view')
      if (!nakama) throw new HttpError(503, 'NAKAMA_DB_MISSING', '未配置 Nakama 只读数据库')
      const realname = str(sp.get('realname'))
      const accountStatus = str(sp.get('status'))
      let restrictIds: string[] | null = null
      if (realname || accountStatus) {
        if (!auth) throw new HttpError(503, 'AUTH_DB_MISSING', '未配置认证数据库，无法按实名状态筛选')
        let ids: string[] | null = null
        if (realname) ids = await nakama.nakamaIdsForAuthUserIds(await auth.authIdsByRealname(realname))
        if (accountStatus) {
          const a = await nakama.nakamaIdsForAuthUserIds(await auth.authIdsByAccountStatus(accountStatus))
          ids = ids ? ids.filter(x => a.includes(x)) : a
        }
        restrictIds = ids ?? []
        if (restrictIds.length > 5000) throw new HttpError(400, 'FILTER_TOO_BROAD', '筛选结果过多，请缩小范围')
      }
      const page = int(sp.get('page'), 1, 1, 100000)
      const pageSize = int(sp.get('pageSize'), 50, 10, 100)
      const result = await nakama.usersPage({
        q: str(sp.get('q')),
        login: str(sp.get('login')),
        from: str(sp.get('from')),
        to: str(sp.get('to')),
        activeFrom: str(sp.get('activeFrom')),
        activeTo: str(sp.get('activeTo')),
        feedback: sp.get('feedback') === '1',
        restrictIds,
        page, pageSize,
      })
      const rows = await enrichUsers(result.rows)
      await audit(ctx, s, 'users.list', 'OK', { metadata: { page, pageSize, count: rows.length, q: str(sp.get('q')) ?? null } })
      sendJson(res, 200, { ok: true, data: { total: result.total, page, pageSize, rows } })
      return
    }

    if (path === '/users/search-phone' && method === 'POST') {
      await requirePerm(ctx, 'users.phone')
      if (!nakama) throw new HttpError(503, 'NAKAMA_DB_MISSING', '未配置 Nakama 只读数据库')
      const b = await readJson(req, ['phone'])
      const lookup = await authInternal('/internal/admin/phone-lookup', { method: 'POST', body: b })
      if (!lookup?.found) {
        await audit(ctx, s, 'users.phone.lookup', 'NOT_FOUND')
        sendJson(res, 200, { ok: true, data: { found: false } })
        return
      }
      const user = await nakama.userById(`bcy-${lookup.userId}`)
      const [row] = user ? await enrichUsers([user]) : []
      await audit(ctx, s, 'users.phone.lookup', 'OK', { targetType: 'auth_user', targetId: String(lookup.userId), metadata: { found: true } })
      sendJson(res, 200, { ok: true, data: { found: true, maskedPhone: lookup.maskedPhone, user: row ?? null } })
      return
    }

    const userMatch = path.match(/^\/users\/([^/]+)(?:\/(progress|sessions|feedback|export))?$/)
    if (userMatch && method === 'GET' && userMatch[2] !== 'export') {
      await requirePerm(ctx, 'users.view')
      if (!nakama) throw new HttpError(503, 'NAKAMA_DB_MISSING', '未配置 Nakama 只读数据库')
      const id = decodeURIComponent(userMatch[1])
      const section = userMatch[2]
      const user = await nakama.userById(id)
      if (!user) throw new HttpError(404, 'NOT_FOUND', '用户不存在')
      const authId = user.customId.startsWith('bcy-') ? user.customId.slice(4) : null
      const [states, account, sessions, feedbackRows, deletions, auditRows] = await Promise.all([
        nakama.playerStates([user.id]),
        auth && authId ? auth.accountByAuthId(authId) : Promise.resolve(null),
        auth && authId ? auth.sessionsForUser(authId, 50) : Promise.resolve([]),
        nakama.feedbackForOwners([user.id]),
        auth && authId ? auth.deletionsForUser(authId) : Promise.resolve([]),
        st.queryAudit({ targetId: user.id, page: 1, pageSize: 20 }),
      ])
      const feedbackStates = await st.allFeedbackState(env.gameId)
      const stateMap = new Map(feedbackStates.map(x => [`${x.ownerId}\u0000${x.storageKey}`, x]))
      const progress = states.get(user.id)?.summary ?? null
      const feedback = feedbackRows.map(r => ({
        key: r.key, atMs: r.atMs, excerpt: r.text.slice(0, 80), clientBuild: r.clientBuild,
        status: stateMap.get(`${r.ownerId}\u0000${r.key}`)?.status ?? 'NEW',
      }))
      const data = {
        user: { id: user.id, customId: user.customId, username: user.username, loginMethod: authId ? 'phone' : 'device', authUserId: authId, createdAtMs: user.createTimeMs },
        identity: {
          realnameStatus: account?.realnameStatus ?? 'UNVERIFIED',
          accountStatus: account?.accountStatus ?? 'ACTIVE',
          authCreatedAtMs: account?.createdAtMs ?? null,
          deletedAtMs: account?.deletedAtMs ?? null,
          deletions,
        },
        progress,
        sessions,
        feedback,
        audit: auditRows.rows,
        runs: await nakama.runsForOwner(user.id, 30),
      }
      await audit(ctx, s, 'users.view', 'OK', { targetType: 'user', targetId: user.id, metadata: { section: section ?? 'overview' } })
      sendJson(res, 200, { ok: true, data })
      return
    }

    if (userMatch && userMatch[2] === 'export' && method === 'GET') {
      await requirePerm(ctx, 'users.view')
      if (!nakama) throw new HttpError(503, 'NAKAMA_DB_MISSING', '未配置 Nakama 只读数据库')
      const id = decodeURIComponent(userMatch[1])
      const user = await nakama.userById(id)
      if (!user) throw new HttpError(404, 'NOT_FOUND', '用户不存在')
      const progress = (await nakama.playerStates([user.id])).get(user.id)?.summary ?? null
      await audit(ctx, s, 'users.export', 'OK', { targetType: 'user', targetId: user.id })
      const redacted = { exportedAt: new Date(env.now()).toISOString(), user: { id: user.id, customId: user.customId, createdAtMs: user.createTimeMs }, progress }
      sendJson(res, 200, { ok: true, data: redacted }, { 'content-disposition': `attachment; filename="user-${user.id}.json"` })
      return
    }

    /* ---- feedback ---- */
    if (path === '/feedback' && method === 'GET') {
      await requirePerm(ctx, 'feedback.view')
      if (!nakama) throw new HttpError(503, 'NAKAMA_DB_MISSING', '未配置 Nakama 只读数据库')
      const statusFilter = str(sp.get('status'))
      const q = str(sp.get('q'))?.toLowerCase()
      const from = str(sp.get('from'))
      const to = str(sp.get('to'))
      const page = int(sp.get('page'), 1, 1, 100000)
      const pageSize = int(sp.get('pageSize'), 50, 10, 100)
      const states = await st.allFeedbackState(env.gameId)
      const stateMap = new Map(states.map(x => [`${x.ownerId}\u0000${x.storageKey}`, x]))
      const allRows = await nakama.allFeedback(5000)
      const counts = { NEW: 0, IN_PROGRESS: 0, RESOLVED: 0, ARCHIVED: 0 } as Record<FeedbackStatus, number>
      const merged = allRows.map(r => {
        const stRow = stateMap.get(`${r.ownerId}\u0000${r.key}`)
        const status = (stRow?.status ?? 'NEW') as FeedbackStatus
        counts[status]++
        return { ...r, status, assigneeId: stRow?.assigneeId ?? null, assigneeName: stRow?.assigneeName ?? null, note: stRow?.note ?? null, stateUpdatedAtMs: stRow?.updatedAtMs ?? null }
      }).filter(r => {
        if (statusFilter && r.status !== statusFilter) return false
        if (q && !r.text.toLowerCase().includes(q) && !r.ownerId.includes(q)) return false
        if (from && dayKey(r.atMs) < from) return false
        if (to && dayKey(r.atMs) > to) return false
        return true
      })
      const total = merged.length
      const pageRows = merged.slice((page - 1) * pageSize, page * pageSize)
      const owners = [...new Set(pageRows.map(r => r.ownerId))]
      const users = await nakama.usersByIds(owners)
      const userMap = new Map(users.map(u => [u.id, u]))
      const assignees = (await st.listAdmins()).filter(a => a.status === 'ACTIVE' && (a.role === 'owner' || a.role === 'ops' || a.role === 'support')).map(a => ({ id: a.id, username: a.username, role: a.role }))
      await audit(ctx, s, 'feedback.list', 'OK', { metadata: { page, count: pageRows.length } })
      sendJson(res, 200, { ok: true, data: {
        total, page, pageSize, counts, assignees,
        rows: pageRows.map(r => ({
          ownerId: r.ownerId, key: r.key, atMs: r.atMs, excerpt: r.text.slice(0, 60), status: r.status,
          clientBuild: r.clientBuild, assigneeId: r.assigneeId, assigneeName: r.assigneeName,
          retentionDueAtMs: retentionDueAtMs(r.status, r.stateUpdatedAtMs),
          retentionOverdue: !!retentionDueAtMs(r.status, r.stateUpdatedAtMs) && (retentionDueAtMs(r.status, r.stateUpdatedAtMs) as number) < env.now(),
          user: userMap.get(r.ownerId) ? { id: r.ownerId, username: userMap.get(r.ownerId)!.username, loginMethod: userMap.get(r.ownerId)!.customId.startsWith('bcy-') ? 'phone' : 'device' } : { id: r.ownerId, username: null, loginMethod: 'unknown' },
        })),
      } })
      return
    }

    const fbMatch = path.match(/^\/feedback\/([^/]+)\/([^/]+)(?:\/(reveal-contact))?$/)
    if (fbMatch && method === 'GET' && !fbMatch[3]) {
      await requirePerm(ctx, 'feedback.view')
      if (!nakama) throw new HttpError(503, 'NAKAMA_DB_MISSING', '未配置 Nakama 只读数据库')
      const ownerId = decodeURIComponent(fbMatch[1])
      const key = decodeURIComponent(fbMatch[2])
      const row = await nakama.feedbackDetail(ownerId, key)
      if (!row) throw new HttpError(404, 'NOT_FOUND', '反馈不存在')
      const state = await st.getFeedbackState(env.gameId, ownerId, key)
      const user = (await nakama.usersByIds([ownerId]))[0] ?? null
      await audit(ctx, s, 'feedback.view', 'OK', { targetType: 'feedback', targetId: `${ownerId}/${key}` })
      sendJson(res, 200, { ok: true, data: {
        ownerId, key, atMs: row.atMs, text: row.text,
        contactMasked: maskContact(row.contact), contactPresent: !!row.contact,
        clientBuild: row.clientBuild, storedStatus: row.storedStatus,
        status: state?.status ?? 'NEW', assigneeId: state?.assigneeId ?? null, note: state?.note ?? null,
        updatedAtMs: state?.updatedAtMs ?? null,
        retentionDueAtMs: retentionDueAtMs(state?.status ?? 'NEW', state?.updatedAtMs),
        retentionOverdue: !!retentionDueAtMs(state?.status ?? 'NEW', state?.updatedAtMs) && (retentionDueAtMs(state?.status ?? 'NEW', state?.updatedAtMs) as number) < env.now(),
        user: user ? { id: user.id, username: user.username, loginMethod: user.customId.startsWith('bcy-') ? 'phone' : 'device' } : null,
        audit: (await st.queryAudit({ targetId: `${ownerId}/${key}`, page: 1, pageSize: 20 })).rows,
      } })
      return
    }

    if (fbMatch && fbMatch[3] === 'reveal-contact' && method === 'POST') {
      await requirePerm(ctx, 'feedback.contact')
      if (!nakama) throw new HttpError(503, 'NAKAMA_DB_MISSING', '未配置 Nakama 只读数据库')
      const b = await readJson(req, ['reason'])
      const reason = String(b.reason || '').trim()
      if (reason.length < 2) throw new HttpError(400, 'REASON_REQUIRED', '请填写查看联系方式的原因')
      const ownerId = decodeURIComponent(fbMatch[1])
      const key = decodeURIComponent(fbMatch[2])
      const row = await nakama.feedbackDetail(ownerId, key)
      if (!row) throw new HttpError(404, 'NOT_FOUND', '反馈不存在')
      await audit(ctx, s, 'feedback.reveal_contact', 'OK', { targetType: 'feedback', targetId: `${ownerId}/${key}`, metadata: { reason: reason.slice(0, 200) } })
      sendJson(res, 200, { ok: true, data: { contact: row.contact } })
      return
    }

    if (fbMatch && !fbMatch[3] && method === 'PATCH') {
      await requirePerm(ctx, 'feedback.manage')
      const b = await readJson(req, ['status', 'assigneeId', 'note'])
      const ownerId = decodeURIComponent(fbMatch[1])
      const key = decodeURIComponent(fbMatch[2])
      if (!nakama) throw new HttpError(503, 'NAKAMA_DB_MISSING', '未配置 Nakama 只读数据库')
      const row = await nakama.feedbackDetail(ownerId, key)
      if (!row) throw new HttpError(404, 'NOT_FOUND', '反馈不存在')
      const status = b.status === undefined ? undefined : String(b.status) as FeedbackStatus
      if (status !== undefined && !STATUS_SET.includes(status)) throw new HttpError(400, 'INVALID_STATUS', '状态不合法')
      const assigneeId = b.assigneeId === undefined ? undefined : (b.assigneeId ? String(b.assigneeId) : null)
      if (assigneeId) {
        const assignee = await st.findAdminById(assigneeId)
        if (!assignee || assignee.status !== 'ACTIVE') throw new HttpError(400, 'INVALID_ASSIGNEE', '分派对象不存在或已停用')
      }
      const note = b.note === undefined ? undefined : String(b.note).slice(0, 2000)
      const current = await st.getFeedbackState(env.gameId, ownerId, key)
      await st.upsertFeedbackState({
        gameId: env.gameId, ownerId, key,
        status: status ?? current?.status ?? 'NEW',
        assigneeId: assigneeId !== undefined ? assigneeId : current?.assigneeId ?? null,
        note: note !== undefined ? note : current?.note ?? null,
      })
      const next = await st.getFeedbackState(env.gameId, ownerId, key)
      await audit(ctx, s, 'feedback.update', 'OK', { targetType: 'feedback', targetId: `${ownerId}/${key}`, metadata: { status: next?.status, assigneeId: next?.assigneeId } })
      sendJson(res, 200, { ok: true, data: next })
      return
    }

    if (path === '/jobs/reconcile-feedback' && method === 'POST') {
      await requirePerm(ctx, 'config.write')
      if (!nakama) throw new HttpError(503, 'NAKAMA_DB_MISSING', '未配置 Nakama 只读数据库')
      const removed = await reconcileFeedbackState(store, nakama, env.gameId)
      await audit(ctx, s, 'feedback.reconcile', 'OK', { metadata: { removed } })
      sendJson(res, 200, { ok: true, data: { removed } })
      return
    }

    /* ---- content & assets ---- */
    if (path === '/snapshot' && method === 'GET') {
      await requirePerm(ctx, 'content.view')
      const snap = getSnapshot(env)
      if (!snap) throw new HttpError(503, 'SNAPSHOT_MISSING', '快照未生成，请运行 node scripts/build-admin-snapshot.mjs')
      sendJson(res, 200, { ok: true, data: snap })
      return
    }
    if (path === '/content/review-summary' && method === 'GET') {
      await requirePerm(ctx, 'content.view')
      const snap = getSnapshot(env)
      if (!snap) throw new HttpError(503, 'SNAPSHOT_MISSING', '快照未生成')
      const byFile = new Map<string, { total: number; approved: number; pending: number }>()
      for (const e of snap.entries ?? []) {
        const x = byFile.get(e.file) ?? { total: 0, approved: 0, pending: 0 }
        x.total++
        if (e.status === 'approved') x.approved++; else x.pending++
        byFile.set(e.file, x)
      }
      sendJson(res, 200, { ok: true, data: { review: snap.review, byFile: [...byFile.entries()].map(([file, v]) => ({ file, ...v })), generatedAt: snap.generatedAt } })
      return
    }
    if (path === '/content/entries' && method === 'GET') {
      await requirePerm(ctx, 'content.view')
      const snap = getSnapshot(env)
      if (!snap) throw new HttpError(503, 'SNAPSHOT_MISSING', '快照未生成')
      const type = str(sp.get('type'))
      const status = str(sp.get('status'))
      const q = str(sp.get('q'))?.toLowerCase()
      const page = int(sp.get('page'), 1, 1, 100000)
      const pageSize = int(sp.get('pageSize'), 50, 10, 200)
      let rows = (snap.entries ?? []) as any[]
      if (type) rows = rows.filter(e => e.file.replace(/\.json$/, '') === type)
      if (status) rows = rows.filter(e => e.status === status)
      if (q) rows = rows.filter(e => `${e.id} ${e.file} ${e.path} ${e.note}`.toLowerCase().includes(q))
      const total = rows.length
      sendJson(res, 200, { ok: true, data: { total, page, pageSize, rows: rows.slice((page - 1) * pageSize, page * pageSize) } })
      return
    }
    const entryMatch = path.match(/^\/content\/entries\/(.+)$/)
    if (entryMatch && method === 'GET') {
      await requirePerm(ctx, 'content.view')
      const snap = getSnapshot(env)
      if (!snap) throw new HttpError(503, 'SNAPSHOT_MISSING', '快照未生成')
      const id = decodeURIComponent(entryMatch[1])
      const entry = (snap.entries ?? []).find((e: any) => e.id === id)
      if (!entry) throw new HttpError(404, 'NOT_FOUND', '条目不存在')
      sendJson(res, 200, { ok: true, data: entry })
      return
    }
    if (path === '/assets' && method === 'GET') {
      await requirePerm(ctx, 'content.view')
      const snap = getSnapshot(env)
      if (!snap) throw new HttpError(503, 'SNAPSHOT_MISSING', '快照未生成')
      const group = str(sp.get('group'))
      const q = str(sp.get('q'))?.toLowerCase()
      const page = int(sp.get('page'), 1, 1, 100000)
      const pageSize = int(sp.get('pageSize'), 48, 12, 200)
      let rows = (snap.assets?.items ?? []) as any[]
      if (group) rows = rows.filter(a => a.group === group)
      if (q) rows = rows.filter(a => `${a.id} ${a.name} ${a.path}`.toLowerCase().includes(q))
      sendJson(res, 200, { ok: true, data: { total: rows.length, page, pageSize, coverage: { ...snap.assets, items: undefined }, rows: rows.slice((page - 1) * pageSize, page * pageSize) } })
      return
    }
    const assetMatch = path.match(/^\/assets\/([^/]+)$/)
    if (assetMatch && method === 'GET') {
      await requirePerm(ctx, 'content.view')
      const snap = getSnapshot(env)
      if (!snap) throw new HttpError(503, 'SNAPSHOT_MISSING', '快照未生成')
      const asset = (snap.assets?.items ?? []).find((a: any) => a.id === decodeURIComponent(assetMatch[1]))
      if (!asset) throw new HttpError(404, 'NOT_FOUND', '资产不存在')
      sendJson(res, 200, { ok: true, data: asset })
      return
    }
    if (path === '/release' && method === 'GET') {
      await requirePerm(ctx, 'content.view')
      const snap = getSnapshot(env)
      if (!snap) throw new HttpError(503, 'SNAPSHOT_MISSING', '快照未生成')
      sendJson(res, 200, { ok: true, data: { stage: snap.stage, versions: snap.versions, release: snap.release, generatedAt: snap.generatedAt, missingSources: snap.missingSources } })
      return
    }
    if (path === '/config/holidays' && method === 'GET') {
      await requirePerm(ctx, 'config.view')
      sendJson(res, 200, { ok: true, data: readContentJson(env, 'holidays.json') })
      return
    }
    if (path === '/config/solar-terms' && method === 'GET') {
      await requirePerm(ctx, 'config.view')
      sendJson(res, 200, { ok: true, data: readContentJson(env, 'solar_terms.json') })
      return
    }
    if (path === '/config/compliance' && method === 'GET') {
      await requirePerm(ctx, 'config.view')
      const data = await authInternal('/internal/admin/config')
      sendJson(res, 200, { ok: true, data })
      return
    }
    if (path === '/config/compliance' && method === 'PUT') {
      await requirePerm(ctx, 'config.write')
      const b = await readJson(req, ['config', 'expectedVersion', 'note'])
      const data = await authInternal('/internal/admin/config', { method: 'POST', body: b })
      await audit(ctx, s, 'config.compliance.update', 'OK', { targetType: 'config', targetId: 'compliance', metadata: { version: (data as any)?.config?.version } })
      sendJson(res, 200, { ok: true, data })
      return
    }

    /* ---- audit ---- */
    if (path === '/audit' && method === 'GET') {
      await requirePerm(ctx, 'audit.view')
      const data = await st.queryAudit({
        actor: str(sp.get('actor')), action: str(sp.get('action')), outcome: str(sp.get('outcome')),
        targetId: str(sp.get('targetId')),
        from: str(sp.get('from')), to: str(sp.get('to')),
        page: int(sp.get('page'), 1, 1, 100000), pageSize: int(sp.get('pageSize'), 50, 10, 200),
      })
      sendJson(res, 200, { ok: true, data })
      return
    }
    if (path === '/audit/export.csv' && method === 'GET') {
      await requirePerm(ctx, 'audit.view')
      const data = await st.queryAudit({ page: 1, pageSize: 200, from: str(sp.get('from')), to: str(sp.get('to')) })
      await audit(ctx, s, 'audit.export', 'OK')
      const lines = ['id,createdAt,actor,action,targetType,targetId,outcome,ipHash']
      for (const r of data.rows) {
        lines.push([r.id, new Date(r.createdAtMs ?? 0).toISOString(), r.actorName ?? '', r.action, r.targetType ?? '', r.targetId ?? '', r.outcome, r.ipHash ?? '']
          .map(csvCell).join(','))
      }
      sendText(res, 200, 'text/csv; charset=utf-8', '﻿' + lines.join('\n'), { 'content-disposition': 'attachment; filename="admin-audit.csv"' })
      return
    }

    /* ---- promo ---- */
    if (path === '/channels' && method === 'GET') {
      await requirePerm(ctx, 'promo.view')
      sendJson(res, 200, { ok: true, data: { rows: await st.listChannels(env.gameId) } })
      return
    }
    if (path === '/channels' && method === 'POST') {
      await requirePerm(ctx, 'promo.manage')
      const b = await readJson(req, ['code', 'name', 'platform', 'notes'])
      const code = String(b.code || '').trim().toLowerCase()
      const name = String(b.name || '').trim()
      if (!/^[a-z0-9_]{2,40}$/.test(code)) throw new HttpError(400, 'INVALID_CODE', '渠道代码只能使用小写字母、数字、下划线（2–40 位）')
      if (!name) throw new HttpError(400, 'INVALID_NAME', '请填写渠道名称')
      try {
        const row = await st.createChannel(env.gameId, { code, name, platform: str(b.platform as string), notes: str(b.notes as string) })
        await audit(ctx, s, 'promo.channel.create', 'OK', { targetType: 'channel', targetId: row.id, metadata: { code } })
        sendJson(res, 200, { ok: true, data: row })
      } catch (e) {
        if ((e as { code?: string }).code === '23505') throw new HttpError(409, 'DUPLICATE_CODE', '渠道代码已存在')
        throw e
      }
      return
    }
    const channelMatch = path.match(/^\/channels\/([^/]+)$/)
    if (channelMatch && method === 'PATCH') {
      await requirePerm(ctx, 'promo.manage')
      const b = await readJson(req, ['name', 'platform', 'status', 'notes'])
      const row = await st.updateChannel(env.gameId, channelMatch[1], {
        name: b.name === undefined ? undefined : String(b.name),
        platform: b.platform === undefined ? undefined : (b.platform === null ? null : String(b.platform)),
        status: b.status === undefined ? undefined : String(b.status),
        notes: b.notes === undefined ? undefined : (b.notes === null ? null : String(b.notes)),
      })
      if (!row) throw new HttpError(404, 'NOT_FOUND', '渠道不存在')
      await audit(ctx, s, 'promo.channel.update', 'OK', { targetType: 'channel', targetId: row.id })
      sendJson(res, 200, { ok: true, data: row })
      return
    }

    if (path === '/campaigns' && method === 'GET') {
      await requirePerm(ctx, 'promo.view')
      sendJson(res, 200, { ok: true, data: { rows: await st.listCampaigns(env.gameId) } })
      return
    }
    if (path === '/campaigns' && method === 'POST') {
      await requirePerm(ctx, 'promo.manage')
      const b = await readJson(req, ['channelId', 'name', 'startDay', 'endDay', 'budgetCents', 'landingUrl', 'notes'])
      const name = String(b.name || '').trim()
      if (!name) throw new HttpError(400, 'INVALID_NAME', '请填写活动名称')
      const channelId = String(b.channelId || '')
      const channels = await st.listChannels(env.gameId)
      if (!channels.some(c => c.id === channelId)) throw new HttpError(400, 'INVALID_CHANNEL', '渠道不存在')
      const row = await st.createCampaign(env.gameId, {
        channelId, name,
        startDay: str(b.startDay as string) ?? null, endDay: str(b.endDay as string) ?? null,
        budgetCents: b.budgetCents === undefined || b.budgetCents === null ? null : Number(b.budgetCents),
        landingUrl: str(b.landingUrl as string) ?? null, notes: str(b.notes as string) ?? null,
      })
      await audit(ctx, s, 'promo.campaign.create', 'OK', { targetType: 'campaign', targetId: row.id })
      sendJson(res, 200, { ok: true, data: row })
      return
    }
    const campaignMatch = path.match(/^\/campaigns\/([^/]+)$/)
    if (campaignMatch && method === 'PATCH') {
      await requirePerm(ctx, 'promo.manage')
      const b = await readJson(req, ['name', 'startDay', 'endDay', 'budgetCents', 'landingUrl', 'notes', 'status'])
      const row = await st.updateCampaign(env.gameId, campaignMatch[1], b)
      if (!row) throw new HttpError(404, 'NOT_FOUND', '活动不存在')
      await audit(ctx, s, 'promo.campaign.update', 'OK', { targetType: 'campaign', targetId: row.id })
      sendJson(res, 200, { ok: true, data: row })
      return
    }

    if (path === '/links' && method === 'GET') {
      await requirePerm(ctx, 'promo.view')
      sendJson(res, 200, { ok: true, data: { rows: await st.listLinks(env.gameId), gameBaseUrl: env.gameBaseUrl } })
      return
    }
    if (path === '/links' && method === 'POST') {
      await requirePerm(ctx, 'promo.manage')
      const b = await readJson(req, ['campaignId', 'code'])
      const campaigns = await st.listCampaigns(env.gameId)
      const campaign = campaigns.find(c => c.id === String(b.campaignId || ''))
      if (!campaign) throw new HttpError(400, 'INVALID_CAMPAIGN', '活动不存在')
      const code = String(b.code || '').trim().toLowerCase() || `${campaign.channelCode ?? 'ch'}_${randomBytes(4).toString('hex')}`
      if (!/^[a-z0-9_]{2,64}$/.test(code)) throw new HttpError(400, 'INVALID_CODE', '链接代码只能使用小写字母、数字、下划线')
      const url = `${env.gameBaseUrl}?ch=${encodeURIComponent(campaign.channelCode ?? '')}&c=${encodeURIComponent(campaign.id.slice(0, 8))}&l=${encodeURIComponent(code)}`
      try {
        const row = await st.createLink(env.gameId, { campaignId: campaign.id, code, url, createdBy: s.username })
        await audit(ctx, s, 'promo.link.create', 'OK', { targetType: 'link', targetId: row.id, metadata: { code } })
        sendJson(res, 200, { ok: true, data: row })
      } catch (e) {
        if ((e as { code?: string }).code === '23505') throw new HttpError(409, 'DUPLICATE_CODE', '链接代码已存在')
        throw e
      }
      return
    }
    const qrMatch = path.match(/^\/links\/([^/]+)\/qr\.svg$/)
    if (qrMatch && method === 'GET') {
      await requirePerm(ctx, 'promo.view')
      const link = await st.getLink(env.gameId, qrMatch[1])
      if (!link) throw new HttpError(404, 'NOT_FOUND', '链接不存在')
      const QR = await import('qrcode')
      const svg = await QR.toString(link.url, { type: 'svg', margin: 1, width: 320, errorCorrectionLevel: 'M' })
      sendText(res, 200, 'image/svg+xml; charset=utf-8', svg)
      return
    }

    if (path === '/promo/metrics' && method === 'GET') {
      await requirePerm(ctx, 'promo.view')
      const days = int(sp.get('days'), 30, 1, 365)
      const from = dateAdd(dayKey(env.now()), -(days - 1))
      const [daily, byLink, report, imports] = await Promise.all([
        st.clicksDaily(env.gameId, from),
        st.clicksByLink(env.gameId, from),
        st.reportSummary(env.gameId, from),
        st.listImports(env.gameId),
      ])
      sendJson(res, 200, { ok: true, data: { days, from, daily, byLink, report, imports } })
      return
    }
    if ((path === '/imports/preview' || path === '/imports') && method === 'POST') {
      await requirePerm(ctx, 'promo.manage')
      const b = await readJson(req, ['filename', 'csv'])
      const filename = String(b.filename || 'import.csv')
      const csvText = String(b.csv || '')
      const parsed = parseCsv(csvText)
      const mapped = await mapReportRows(parsed, st, env.gameId)
      if (path === '/imports/preview') {
        sendJson(res, 200, { ok: true, data: { filename, headers: parsed.headers, rows: mapped.rows.slice(0, 10), total: mapped.rows.length, errors: mapped.errors.slice(0, 20) } })
        return
      }
      if (mapped.errors.length) throw new HttpError(400, 'IMPORT_ERRORS', `有 ${mapped.errors.length} 行无法导入`, mapped.errors.slice(0, 20))
      const hash = createHash('sha256').update(csvText).digest('hex')
      const existing = await st.findImportByHash(env.gameId, hash)
      if (existing) {
        sendJson(res, 200, { ok: true, data: { duplicate: true, importId: existing, rowCount: mapped.rows.length } })
        return
      }
      const importId = await st.createImport(env.gameId, { filename, fileHash: hash, importedBy: s.username, rowCount: mapped.rows.length })
      await st.insertReportRows(importId, mapped.rows)
      await audit(ctx, s, 'promo.import', 'OK', { targetType: 'import', targetId: importId, metadata: { filename, rows: mapped.rows.length } })
      sendJson(res, 200, { ok: true, data: { duplicate: false, importId, rowCount: mapped.rows.length } })
      return
    }
    if (path === '/imports' && method === 'GET') {
      await requirePerm(ctx, 'promo.view')
      sendJson(res, 200, { ok: true, data: { rows: await st.listImports(env.gameId) } })
      return
    }

    /* ---- settings ---- */
    if (path === '/admins' && method === 'GET') {
      if (!isOwner) {
        await requirePerm(ctx, 'admin.manage')
      }
      const admins = await st.listAdmins()
      sendJson(res, 200, { ok: true, data: { rows: admins.map(a => ({ id: a.id, username: a.username, role: a.role, status: a.status, totpEnabled: a.totpEnabled, createdAtMs: a.createdAtMs, lastLoginAtMs: a.lastLoginAtMs })) } })
      return
    }
    if (path === '/admins' && method === 'POST') {
      await requirePerm(ctx, 'admin.manage')
      const b = await readJson(req, ['username', 'password', 'role'])
      const username = String(b.username || '').trim()
      const password = String(b.password || '')
      const role = String(b.role || '') as AdminRole
      if (!/^[A-Za-z0-9_]{3,32}$/.test(username)) throw new HttpError(400, 'INVALID_USERNAME', '用户名只能使用字母、数字、下划线（3–32 位）')
      if (password.length < 12) throw new HttpError(400, 'WEAK_PASSWORD', '密码至少 12 位')
      if (!ROLE_SET.includes(role)) throw new HttpError(400, 'INVALID_ROLE', '角色不合法')
      if (role === 'owner' && s.role !== 'owner') throw new HttpError(403, 'FORBIDDEN', '只有负责人可以授予负责人角色')
      try {
        const row = await st.createAdmin({ username, passwordHash: hashPassword(password), role, createdBy: s.username })
        await audit(ctx, s, 'admin.user.create', 'OK', { targetType: 'admin', targetId: row.id, metadata: { username, role } })
        sendJson(res, 200, { ok: true, data: { id: row.id, username: row.username, role: row.role } })
      } catch (e) {
        if ((e as { code?: string }).code === '23505') throw new HttpError(409, 'DUPLICATE_USERNAME', '用户名已存在')
        throw e
      }
      return
    }
    const adminMatch = path.match(/^\/admins\/([^/]+)(?:\/(reset-password|revoke-sessions))?$/)
    if (adminMatch && method === 'PATCH' && !adminMatch[2]) {
      await requirePerm(ctx, 'admin.manage')
      const b = await readJson(req, ['role', 'status'])
      const target = await st.findAdminById(adminMatch[1])
      if (!target) throw new HttpError(404, 'NOT_FOUND', '管理员不存在')
      const role = b.role === undefined ? undefined : String(b.role) as AdminRole
      const status = b.status === undefined ? undefined : String(b.status) as 'ACTIVE' | 'DISABLED'
      if (role !== undefined && !ROLE_SET.includes(role)) throw new HttpError(400, 'INVALID_ROLE', '角色不合法')
      if (role === 'owner' && s.role !== 'owner') throw new HttpError(403, 'FORBIDDEN', '只有负责人可以授予负责人角色')
      if (status !== undefined && status !== 'ACTIVE' && status !== 'DISABLED') throw new HttpError(400, 'INVALID_STATUS', '状态不合法')
      const losingOwner = target.role === 'owner' && ((role !== undefined && role !== 'owner') || status === 'DISABLED')
      if (losingOwner && await st.countActiveOwners() <= 1) throw new HttpError(400, 'LAST_OWNER', '不能停用或降级最后一名负责人')
      const row = await st.updateAdmin(target.id, { role, status })
      await audit(ctx, s, 'admin.user.update', 'OK', { targetType: 'admin', targetId: target.id, metadata: { role, status } })
      sendJson(res, 200, { ok: true, data: row ? { id: row.id, username: row.username, role: row.role, status: row.status } : null })
      return
    }
    if (adminMatch && adminMatch[2] === 'reset-password' && method === 'POST') {
      await requirePerm(ctx, 'admin.manage')
      const b = await readJson(req, ['password'])
      const target = await st.findAdminById(adminMatch[1])
      if (!target) throw new HttpError(404, 'NOT_FOUND', '管理员不存在')
      const password = b.password ? String(b.password) : randomBytes(9).toString('base64url')
      if (password.length < 12) throw new HttpError(400, 'WEAK_PASSWORD', '密码至少 12 位')
      await st.setPassword(target.id, hashPassword(password))
      await st.revokeAllSessions(target.id)
      await audit(ctx, s, 'admin.user.reset_password', 'OK', { targetType: 'admin', targetId: target.id })
      sendJson(res, 200, { ok: true, data: { username: target.username, temporaryPassword: password } })
      return
    }
    if (adminMatch && adminMatch[2] === 'revoke-sessions' && method === 'POST') {
      await requirePerm(ctx, 'admin.manage')
      const n = await st.revokeAllSessions(adminMatch[1])
      await audit(ctx, s, 'admin.user.revoke_sessions', 'OK', { targetType: 'admin', targetId: adminMatch[1], metadata: { revoked: n } })
      sendJson(res, 200, { ok: true, data: { revoked: n } })
      return
    }

    if (path === '/health' && method === 'GET') {
      await requirePerm(ctx, 'overview.view')
      sendJson(res, 200, { ok: true, data: await getHealth(ctx) })
      return
    }

    if (path === '/me' && method === 'GET') {
      sendJson(res, 200, { ok: true, data: { user: sessionUser(s, env), sessions: await st.listSessions(s.userId) } })
      return
    }
    if (path === '/me/password' && method === 'POST') {
      const b = await readJson(req, ['currentPassword', 'newPassword'])
      const admin = await st.findAdminById(s.userId)
      if (!admin || !verifyPassword(String(b.currentPassword || ''), admin.passwordHash)) throw new HttpError(401, 'BAD_PASSWORD', '当前密码错误')
      const next = String(b.newPassword || '')
      if (next.length < 12) throw new HttpError(400, 'WEAK_PASSWORD', '密码至少 12 位')
      await st.setPassword(s.userId, hashPassword(next))
      await st.revokeAllSessions(s.userId, s.id)
      await audit(ctx, s, 'admin.password.change', 'OK')
      sendJson(res, 200, { ok: true, data: {} })
      return
    }
    if (path === '/me/totp/setup' && method === 'POST') {
      const admin = await st.findAdminById(s.userId)
      if (!admin) throw new HttpError(404, 'NOT_FOUND', '管理员不存在')
      if (admin.totpEnabled) throw new HttpError(400, 'TOTP_ENABLED', '动态验证码已启用')
      const secret = newTotpSecret()
      await st.setTotp(s.userId, secret, false)
      await audit(ctx, s, 'admin.totp.setup', 'OK')
      sendJson(res, 200, { ok: true, data: { secret, uri: totpUri('本草小游记运营后台', admin.username, secret) } })
      return
    }
    if (path === '/me/totp/enable' && method === 'POST') {
      const b = await readJson(req, ['code'])
      const admin = await st.findAdminById(s.userId)
      if (!admin?.totpSecret) throw new HttpError(400, 'TOTP_NOT_SETUP', '请先生成密钥')
      if (!verifyTotp(admin.totpSecret, b.code, env.now())) throw new HttpError(400, 'BAD_TOTP', '动态验证码错误')
      await st.setTotp(s.userId, admin.totpSecret, true)
      await audit(ctx, s, 'admin.totp.enable', 'OK')
      sendJson(res, 200, { ok: true, data: { enabled: true } })
      return
    }
    if (path === '/me/totp/disable' && method === 'POST') {
      const b = await readJson(req, ['code'])
      const admin = await st.findAdminById(s.userId)
      if (!admin?.totpEnabled || !admin.totpSecret) throw new HttpError(400, 'TOTP_NOT_ENABLED', '动态验证码未启用')
      if (!verifyTotp(admin.totpSecret, b.code, env.now())) throw new HttpError(400, 'BAD_TOTP', '动态验证码错误')
      await st.setTotp(s.userId, null, false)
      await audit(ctx, s, 'admin.totp.disable', 'OK')
      sendJson(res, 200, { ok: true, data: { enabled: false } })
      return
    }
    if (path === '/me/sessions' && method === 'GET') {
      sendJson(res, 200, { ok: true, data: { rows: await st.listSessions(s.userId) } })
      return
    }
    const sessionMatch = path.match(/^\/me\/sessions\/([^/]+)$/)
    if (sessionMatch && method === 'DELETE') {
      const ok = await st.revokeSession(sessionMatch[1], s.userId)
      await audit(ctx, s, 'admin.session.revoke', ok ? 'OK' : 'NOT_FOUND', { targetType: 'session', targetId: sessionMatch[1] })
      sendJson(res, 200, { ok: true, data: { revoked: ok } })
      return
    }

    throw new HttpError(404, 'NOT_FOUND', '接口不存在')
  }

  async function getHealth(_ctx: Ctx) {
    const [adminOk, nakamaOk, authOk, authService, computedAt, game] = await Promise.all([
      store.ping(),
      nakama ? nakama.ping() : Promise.resolve(false),
      auth ? auth.ping() : Promise.resolve(false),
      authServiceHealth(),
      store.metricsComputedAt(env.gameId),
      store.getGame(env.gameId),
    ])
    const snap = getSnapshot(env)
    return {
      services: {
        adminDb: { configured: true, ok: adminOk },
        nakamaDb: { configured: !!nakama, ok: nakamaOk },
        authDb: { configured: !!auth, ok: authOk },
        authService,
      },
      snapshot: { configured: !!snap, generatedAt: snap?.generatedAt ?? null, ageMs: snap?.generatedAt ? env.now() - Date.parse(snap.generatedAt) : null },
      metrics: { computedAt, ageMs: computedAt ? env.now() - computedAt : null },
      versions: snap?.versions ?? null,
      stage: game?.stage ?? snap?.stage ?? 'S0',
      serverTime: new Date(env.now()).toISOString(),
    }
  }

  /* ---------------- HTTP entry ---------------- */
  return async function handler(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) {
    const trace = randomUUID()
    securityHeaders(res)
    const url = new URL(req.url || '/', 'http://local')
    try {
      if (!url.pathname.startsWith('/admin')) throw new HttpError(404, 'NOT_FOUND', '页面不存在')
      const ip = clientIp(req, env.trustProxy)
      if (env.allowIps.length && !env.allowIps.includes(ip)) throw new HttpError(404, 'NOT_FOUND', '页面不存在')

      if (url.pathname === '/admin') {
        res.writeHead(301, { location: '/admin/' })
        res.end()
        return
      }

      // Media (asset previews) requires a session and only serves known media types.
      if (url.pathname.startsWith('/admin/media/')) {
        const session = await authenticate(req)
        if (!session) throw new HttpError(401, 'UNAUTHORIZED', '请先登录后台')
        const rel = url.pathname.slice('/admin/media/'.length)
        if (!['.webp', '.png', '.jpg', '.jpeg', '.svg', '.gif', '.mp3'].includes(extname(rel).toLowerCase())) {
          throw new HttpError(404, 'NOT_FOUND', '文件不存在')
        }
        if (!serveStatic(res, env.publicDir, rel)) throw new HttpError(404, 'NOT_FOUND', '文件不存在')
        return
      }

      if (url.pathname.startsWith('/admin/api/') || url.pathname === '/admin/api') {
        let session: SessionRow | null = null
        if (url.pathname !== '/admin/api/session' || req.method !== 'POST') session = await authenticate(req)
        const ctx: Ctx = { req, env, store, nakama, auth, session, trace }
        try {
          await handleApi(ctx, url, res)
        } catch (e) {
          if (e instanceof HttpError) {
            if (e.status === 401 && url.pathname !== '/admin/api/session') {
              res.setHeader('set-cookie', `${COOKIE}=; Path=/admin; Max-Age=0; HttpOnly; SameSite=Strict`)
            }
            sendError(res, e.status, e.code, e.message, trace, e.details)
          } else {
            console.error(`[${trace}] ${req.method} ${url.pathname}:`, (e as Error)?.stack || e)
            sendError(res, 500, 'INTERNAL_ERROR', '服务异常，请稍后重试', trace)
          }
        }
        return
      }

      // Static SPA.
      const rel = url.pathname.replace(/^\/admin\/?/, '')
      if (rel && extname(rel) && serveStatic(res, env.staticDir, rel)) return
      if (!rel || !extname(rel)) {
        if (serveStatic(res, env.staticDir, 'index.html')) return
        sendText(res, 503, 'text/html; charset=utf-8', '<h1>运营后台尚未构建</h1><p>请运行 <code>pnpm build:admin</code>。</p>')
        return
      }
      throw new HttpError(404, 'NOT_FOUND', '文件不存在')
    } catch (e) {
      if (e instanceof HttpError) sendError(res, e.status, e.code, e.message, trace)
      else {
        console.error(`[${trace}] unhandled:`, (e as Error)?.stack || e)
        sendError(res, 500, 'INTERNAL_ERROR', '服务异常，请稍后重试', trace)
      }
    }
  }

  async function authenticate(req: import('node:http').IncomingMessage): Promise<SessionRow | null> {
    const token = parseCookies(req)[COOKIE]
    if (!token) return null
    const row = await store.findSession(tokenHash(token))
    if (!row) return null
    if (env.now() - row.lastSeenAtMs > IDLE_MS) {
      await store.revokeSession(row.id).catch(() => undefined)
      return null
    }
    if (env.now() - row.lastSeenAtMs > 60_000) await store.touchSession(row.id).catch(() => undefined)
    return row
  }
}

/* ---------------- CSV import ---------------- */
export function parseCsv(raw: string): { headers: string[]; rows: string[][] } {
  const text = raw.replace(/^\uFEFF/, '')
  const records: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++ } else quoted = false
      } else cell += ch
    } else if (ch === '"') quoted = true
    else if (ch === ',') { row.push(cell); cell = '' }
    else if (ch === '\n') { row.push(cell); records.push(row); row = []; cell = '' }
    else if (ch === '\r') { /* skip */ }
    else cell += ch
  }
  if (cell.length || row.length) { row.push(cell); records.push(row) }
  const nonEmpty = records.filter(r => r.some(c => c.trim() !== ''))
  if (!nonEmpty.length) return { headers: [], rows: [] }
  const headers = nonEmpty[0].map(h => h.trim().toLowerCase())
  return { headers, rows: nonEmpty.slice(1) }
}

const HEADER_ALIASES: Record<string, string[]> = {
  day: ['day', 'date', '日期'],
  channel: ['channel', 'channel_code', '渠道', '渠道代码'],
  campaign: ['campaign', 'campaign_name', '活动', '活动名称'],
  impressions: ['impressions', '曝光', '展示', '曝光量'],
  clicks: ['clicks', '点击', '点击量'],
  spend: ['spend', 'cost', '花费', '成本', 'spend_cents', '消耗'],
}

export async function mapReportRows(parsed: { headers: string[]; rows: string[][] }, store: Store, gameId: string) {
  const idx: Record<string, number> = {}
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    const i = parsed.headers.findIndex(h => aliases.includes(h))
    if (i >= 0) idx[key] = i
  }
  const missing = ['day', 'channel'].filter(k => idx[k] === undefined)
  if (missing.length) return { rows: [] as Array<{ day: string; channelId: string | null; campaignId: string | null; impressions: number | null; clicks: number | null; spendCents: number | null }>, errors: [`缺少列：${missing.join('、')}（需要 day/日期、channel/渠道）`] }

  const channels = await store.listChannels(gameId)
  const campaigns = await store.listCampaigns(gameId)
  const out: Array<{ day: string; channelId: string | null; campaignId: string | null; impressions: number | null; clicks: number | null; spendCents: number | null }> = []
  const errors: string[] = []
  parsed.rows.forEach((r, i) => {
    const line = i + 2
    const day = (r[idx.day] ?? '').trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) { errors.push(`第 ${line} 行：日期格式应为 YYYY-MM-DD`); return }
    const chCode = (r[idx.channel] ?? '').trim().toLowerCase()
    const channel = channels.find(c => c.code.toLowerCase() === chCode)
    if (!channel) { errors.push(`第 ${line} 行：渠道代码 ${chCode || '(空)'} 不存在`); return }
    const campName = idx.campaign === undefined ? '' : (r[idx.campaign] ?? '').trim()
    const campaign = campName ? campaigns.find(c => c.channelId === channel.id && c.name === campName) : null
    if (campName && !campaign) { errors.push(`第 ${line} 行：活动 ${campName} 不属于渠道 ${chCode}`); return }
    const num = (k: string) => idx[k] === undefined || (r[idx[k]] ?? '').trim() === '' ? null : Number((r[idx[k]] ?? '').replace(/[,\s]/g, ''))
    const impressions = num('impressions')
    const clicks = num('clicks')
    let spendCents = num('spend')
    if (spendCents !== null && !parsed.headers[idx.spend]?.includes('cents')) spendCents = Math.round(spendCents * 100)
    if ([impressions, clicks, spendCents].some(v => v !== null && (!Number.isFinite(v) || v < 0))) { errors.push(`第 ${line} 行：数值不合法`); return }
    out.push({ day, channelId: channel.id, campaignId: campaign?.id ?? null, impressions, clicks, spendCents })
  })
  return { rows: out, errors }
}

/* ---------------- startup ---------------- */
export async function main() {
  const env = loadEnv()
  const adminPool = new pg.Pool({ connectionString: env.adminDbUrl, max: env.adminDbPool })
  const store = new Store(adminPool)
  await applySchema(adminPool, env)
  await bootstrapOwner(store, env)

  const nakama = env.nakamaDbUrl ? new NakamaReader(new pg.Pool({ connectionString: env.nakamaDbUrl, max: 4 })) : null
  const auth = env.authDbUrl ? new AuthReader(new pg.Pool({ connectionString: env.authDbUrl, max: 4 })) : null

  const app = createApp(env, store, nakama, auth)
  createServer(app).listen(env.port, '127.0.0.1', () => {
    console.log(`[admin] listening on http://127.0.0.1:${env.port}/admin/ env=${env.environment} nakama=${!!nakama} auth=${!!auth} authService=${!!env.authBaseUrl}`)
  })

  if (nakama) {
    runMetrics(store, nakama, env.now()).then(r => console.log(`[admin] metrics computed: ${r.days} days, ${r.cohorts} cohorts`)).catch(e => console.error('[admin] metrics failed:', e.message))
    setInterval(() => runMetrics(store, nakama, env.now()).catch(e => console.error('[admin] metrics failed:', e.message)), 6 * 3600_000).unref()
    reconcileFeedbackState(store, nakama, env.gameId)
      .then(n => { if (n) console.log(`[admin] feedback reconcile removed ${n} stale state row(s)`) })
      .catch(e => console.error('[admin] feedback reconcile failed:', e.message))
    setInterval(() => reconcileFeedbackState(store, nakama, env.gameId).catch(e => console.error('[admin] feedback reconcile failed:', e.message)), 24 * 3600_000).unref()
  }
}

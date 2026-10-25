import { Client, Session } from '@heroiclabs/nakama-js'
import type { RpcName, RpcResponse } from '../shared/types'
import { LocalDemoServer } from './localDemoServer'

export type Transport = {
  mode: 'nakama' | 'demo'
  userId: string | null
  connect(): Promise<void>
  rpc<T>(name: RpcName, body: unknown): Promise<RpcResponse<T>>
  /** Drop any cached session after account deletion. */
  forget?(): void
  /** 'device' = S0/S1 trial; 'realname' = phone + realname login (never falls back to device auth). */
  authMode: 'device' | 'realname'
  setAuthMode?(m: 'device' | 'realname'): void
  loginWithTicket?(ticket: string): Promise<void>
  token?(): Promise<string>
  logout?(): Promise<void>
  /** A5 G7: call one RPC as this browser's existing device-trial account (never creates one). null = no trial account. */
  rpcAsTrial?<T>(name: RpcName, body: unknown): Promise<RpcResponse<T> | null>
  hasTrialAccount?(): Promise<boolean>
}

export class StorageUnavailableError extends Error {}
export class TransportError extends Error {
  constructor(message: string, public kind: 'network' | 'auth' | 'login' | 'unknown') { super(message) }
}

const INSTALL_KEY = 'bcy.installId'
const SESSION_KEY = 'bcy.session'
const MODE_KEY = 'bcy.authMode'

/** Random install ID persisted on this site. Never a device fingerprint. Never regenerated on network failure. */
export function getInstallId(storage: Storage = localStorage): string {
  let id: string | null
  try {
    id = storage.getItem(INSTALL_KEY)
    if (!id) {
      id = `bcy-${crypto.randomUUID()}`
      storage.setItem(INSTALL_KEY, id)
      if (storage.getItem(INSTALL_KEY) !== id) throw new Error('not persisted')
    }
  } catch {
    throw new StorageUnavailableError('浏览器存储不可用，无法创建试玩账号。请关闭无痕模式或允许站点存储后重试。')
  }
  return id
}

export type NakamaConfig = { host: string; port: string; useSSL: boolean; serverKey: string }
export function readNakamaConfig(): NakamaConfig | null {
  const env = import.meta.env
  const host = env.VITE_NAKAMA_HOST as string | undefined
  if (!host) return null
  return { host, port: (env.VITE_NAKAMA_PORT as string) || '7350', useSSL: env.VITE_NAKAMA_SSL === 'true', serverKey: (env.VITE_NAKAMA_SERVER_KEY as string) || 'defaultkey' }
}

export class NakamaTransport implements Transport {
  forget() { this.session = null; this.userId = null; localStorage.removeItem(SESSION_KEY) }
  authMode: 'device' | 'realname' = 'device'
  setAuthMode(m: 'device' | 'realname') {
    if (m !== this.authMode) { this.forget() } // never reuse a device-trial session for a realname account or vice versa
    this.authMode = m
    localStorage.setItem(MODE_KEY, m)
  }
  /** Exchange a one-time loginTicket (from SMS verify) for a Nakama session. */
  async loginWithTicket(ticket: string) {
    try { const s = await this.client.authenticateCustom(ticket, true); this.persist(s) } catch (e) {
      const status = (e as { status?: number })?.status
      throw new TransportError(status === 401 || status === 403 ? '登录凭证已失效，请重新获取验证码' : '登录失败，请检查网络后重试', status ? 'login' : 'network')
    }
  }
  async token() { return (await this.ensureSession()).token }
  async logout() {
    const s = this.session
    if (s) await this.client.sessionLogout(s, s.token, s.refresh_token).catch(() => undefined)
    this.forget()
  }
  mode = 'nakama' as const
  userId: string | null = null
  private client: Client
  private session: Session | null = null
  private refreshing: Promise<Session> | null = null

  constructor(cfg: NakamaConfig, private installId: string) {
    this.client = new Client(cfg.serverKey, cfg.host, cfg.port, cfg.useSSL, 10_000)
  }

  async connect() { await this.ensureSession() }

  private persist(s: Session) {
    this.session = s; this.userId = s.user_id ?? null
    localStorage.setItem(SESSION_KEY, JSON.stringify({ token: s.token, refresh: s.refresh_token }))
  }

  /** Serial refresh: concurrent calls share a single refresh/authenticate attempt. */
  private ensureSession(): Promise<Session> {
    const nowSec = Date.now() / 1000
    if (this.session && !this.session.isexpired(nowSec + 30)) return Promise.resolve(this.session)
    // A saved session from the other auth mode is never reused.
    if (!this.session && localStorage.getItem(MODE_KEY) && localStorage.getItem(MODE_KEY) !== this.authMode) localStorage.removeItem(SESSION_KEY)
    if (this.refreshing) return this.refreshing
    this.refreshing = (async () => {
      try {
        if (!this.session) {
          const saved = localStorage.getItem(SESSION_KEY)
          if (saved) { const { token, refresh } = JSON.parse(saved); this.session = Session.restore(token, refresh) }
        }
        if (this.session && !this.session.isexpired(nowSec + 30)) { this.persist(this.session); return this.session }
        if (this.session && !this.session.isrefreshexpired(nowSec + 30)) {
          try { const s = await this.client.sessionRefresh(this.session); this.persist(s); return s } catch { /* fall through to re-auth with the same install ID */ }
        }
        if (this.authMode === 'realname') { this.session = null; localStorage.removeItem(SESSION_KEY); throw new TransportError('请用手机号登录', 'login') }
        const s = await this.client.authenticateDevice(this.installId, true)
        this.persist(s); return s
      } catch (e) {
        if (e instanceof TransportError) throw e
        throw new TransportError(e instanceof Error ? e.message : '登录失败', 'auth')
      } finally { this.refreshing = null }
    })()
    return this.refreshing
  }

  async hasTrialAccount(): Promise<boolean> {
    try {
      const t = await this.client.authenticateDevice(this.installId, false)
      void this.client.sessionLogout(t, t.token, t.refresh_token).catch(() => undefined)
      return !!t.user_id && t.user_id !== this.userId
    } catch { return false }
  }
  async rpcAsTrial<T>(name: RpcName, body: unknown): Promise<RpcResponse<T> | null> {
    let trial: Session
    try { trial = await this.client.authenticateDevice(this.installId, false) } catch (e) {
      const status = (e as { status?: number })?.status
      if (status === 404 || status === 401 || status === 403) return null // no trial account on this browser (or blocked)
      throw new TransportError('网络请求失败', 'network')
    }
    if (trial.user_id && trial.user_id === this.userId) return null
    try {
      const res = await this.client.rpc(trial, name, body as object)
      return (typeof res.payload === 'string' ? JSON.parse(res.payload) : res.payload) as RpcResponse<T>
    } catch { throw new TransportError('网络请求失败', 'network') }
    finally { void this.client.sessionLogout(trial, trial.token, trial.refresh_token).catch(() => undefined) }
  }

  async rpc<T>(name: RpcName, body: unknown): Promise<RpcResponse<T>> {
    const session = await this.ensureSession()
    try {
      const res = await this.client.rpc(session, name, body as object)
      const payload = typeof res.payload === 'string' ? JSON.parse(res.payload) : res.payload
      return payload as RpcResponse<T>
    } catch (e) {
      const status = (e as { status?: number })?.status
      if (status === 401) {
        this.session = null; localStorage.removeItem(SESSION_KEY)
        // realname: session revoked (21:00 minor cut-off, deletion, logout) → back to the login screen
        if (this.authMode === 'realname') throw new TransportError('登录已失效，请重新登录', 'login')
      }
      throw new TransportError('网络请求失败', status === 401 ? 'auth' : 'network')
    }
  }
}

export class DemoTransport implements Transport {
  mode = 'demo' as const
  authMode = 'device' as const
  userId: string | null
  readonly server: LocalDemoServer
  constructor(installId: string) {
    this.userId = `demo-${installId.slice(-12)}`
    this.server = new LocalDemoServer({ userId: this.userId })
  }
  async connect() {}
  async rpc<T>(name: RpcName, body: unknown): Promise<RpcResponse<T>> {
    if (!navigator.onLine) throw new TransportError('当前离线', 'network')
    try { return await this.server.rpc<T>(name, body) } catch (e) { throw new TransportError(e instanceof Error ? e.message : '网络请求失败', 'network') }
  }
}

export function createTransport(): Transport {
  const installId = getInstallId()
  const cfg = readNakamaConfig()
  return cfg ? new NakamaTransport(cfg, installId) : new DemoTransport(installId)
}

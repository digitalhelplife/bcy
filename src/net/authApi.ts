// Browser client for the 4 public bencao-auth endpoints + config (doc 06 §6.1). Same-origin, relative URLs.
import type { MinorRule } from '../shared/compliance'
/** authMode/minor come from the admin console's runtime config (older auth services omit minor/configVersion). */
export type AuthConfig = { authMode: 'device' | 'realname'; environment: 'staging' | 'production'; smsProvider: string; realnameProvider: string; minor?: MinorRule; configVersion?: number }
export type AuthErr = { code: string; message: string; retryable: boolean; retryAfterMs?: number }
export class AuthApiError extends Error { constructor(public error: AuthErr) { super(error.message) } }
const BASE = './auth'

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let r: Response
  try { r = await fetch(`${BASE}${path}`, { ...init, cache: 'no-store', headers: { 'content-type': 'application/json', ...(init.headers || {}) } }) } catch {
    throw new AuthApiError({ code: 'NETWORK', message: '网络不可用，请检查网络后重试', retryable: true })
  }
  let body: { ok: boolean; data?: T; error?: AuthErr } | null = null
  try { body = await r.json() } catch { /* non-JSON (e.g. proxy error page) */ }
  if (body && body.ok) return body.data as T
  throw new AuthApiError(body?.error ?? { code: r.status === 404 ? 'NOT_FOUND' : 'SERVER_BUSY', message: '服务暂时不可用，请稍后重试', retryable: true })
}

/** 404 (no auth service deployed) means the server runs the device-trial stage. */
export async function loadAuthConfig(): Promise<AuthConfig> {
  try { return await call<AuthConfig>('/config') } catch (e) {
    if (e instanceof AuthApiError && e.error.code === 'NOT_FOUND') return { authMode: 'device', environment: 'staging', smsProvider: 'none', realnameProvider: 'none' }
    throw e
  }
}
export const sendSms = (phone: string) => call<{ retryAfterMs: number; debugCode?: string }>('/sms/send', { method: 'POST', body: JSON.stringify({ phone }) })
export const verifySms = (phone: string, code: string) => call<{ loginTicket: string; expiresAtMs: number }>('/sms/verify', { method: 'POST', body: JSON.stringify({ phone, code }) })
export type RealnameStatus = 'UNVERIFIED' | 'PENDING' | 'VERIFIED_ADULT' | 'VERIFIED_MINOR'
export const submitRealname = (token: string, name: string, idNumber: string) =>
  call<{ realnameStatus: RealnameStatus }>('/realname/submit', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ name, idNumber }) })
export const getRealnameStatus = (token: string) =>
  call<{ realnameStatus: RealnameStatus }>('/realname/status', { headers: { authorization: `Bearer ${token}` } })

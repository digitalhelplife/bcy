// Pluggable providers. Production refuses to start with `mock`. The NPPA (national anti-addiction) adapter is a
// placeholder on purpose: its interface spec (URLs, encryption, signing, error codes) is only available inside the
// enterprise console after onboarding, so no protocol is guessed here (doc 06 §7.1).
import { createHash } from 'node:crypto'

export interface SmsProvider {
  readonly name: string
  /** Deliver a one-time code. Must never log the phone number or code. */
  send(phone: string, code: string): Promise<void>
}
export type RealnameOutcome =
  | { status: 'VERIFIED'; pi: string; birthYm: string }
  | { status: 'PENDING'; ai: string }
  | { status: 'FAILED' }
export interface RealnameProvider {
  readonly name: string
  /** `ai` is our per-request unique id. name/idNumber exist only in memory for this call. */
  submit(ai: string, name: string, idNumber: string, birthYm: string): Promise<RealnameOutcome>
  /** Poll a PENDING request (doc: must be queried within 48h). */
  query(ai: string): Promise<RealnameOutcome>
}
export interface BehaviorReporter {
  readonly name: string
  /** Batch of online/offline events for VERIFIED users (≤128 per batch, ≤10 QPS per NPPA manual). */
  report(events: { eventId: string; pi: string; kind: 'online' | 'offline'; occurredAtMs: number }[]): Promise<'SENT' | 'NOT_CONFIGURED'>
}

/* ---------------- mock (staging only) ---------------- */
export class MockSms implements SmsProvider {
  readonly name = 'mock'
  /** Last code per phone so staging can display it; production never constructs this class. */
  readonly outbox = new Map<string, string>()
  async send(phone: string, code: string) { this.outbox.set(phone, code); if (this.outbox.size > 1000) this.outbox.clear() }
}

/** Mock realname: trusts the checksum-valid ID number's birth date; the name "测试认证中" simulates a 30 s PENDING. */
export class MockRealname implements RealnameProvider {
  readonly name = 'mock'
  private pending = new Map<string, { until: number; pi: string; birthYm: string }>()
  constructor(private now: () => number = Date.now) {}
  async submit(ai: string, name: string, idNumber: string, birthYm: string): Promise<RealnameOutcome> {
    const pi = 'mockpi_' + createHash('sha256').update('mock|' + idNumber).digest('hex').slice(0, 32)
    if (name.trim() === '测试失败') return { status: 'FAILED' }
    if (name.trim() === '测试认证中') { this.pending.set(ai, { until: this.now() + 30_000, pi, birthYm }); return { status: 'PENDING', ai } }
    return { status: 'VERIFIED', pi, birthYm }
  }
  async query(ai: string): Promise<RealnameOutcome> {
    const p = this.pending.get(ai)
    if (!p) return { status: 'FAILED' }
    if (this.now() < p.until) return { status: 'PENDING', ai }
    this.pending.delete(ai)
    return { status: 'VERIFIED', pi: p.pi, birthYm: p.birthYm }
  }
}
export class NoopBehavior implements BehaviorReporter {
  readonly name = 'none'
  async report() { return 'NOT_CONFIGURED' as const }
}

/* ---------------- generic HTTP gateway adapters ----------------
 * These are deliberately tiny, vendor-neutral HTTP adapters. They let the operator put a real SMS /
 * realname gateway in front of the auth service without hard-coding a vendor protocol. The gateway contract
 * is documented in deploy/ops/README.md. The NPPA behavior-reporting adapter still needs the official
 * protocol and credentials; this HTTP reporter is only for a provider that exposes a matching gateway.
 */
const timeout = () => AbortSignal.timeout(5_000)
async function postJson(url: string, token: string, body: unknown): Promise<unknown> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
    signal: timeout(),
  })
  if (!r.ok) throw new Error(`provider HTTP ${r.status}`)
  try { return await r.json() } catch { return {} }
}
export class HttpSms implements SmsProvider {
  readonly name = 'http'
  constructor(private url: string, private token: string) {}
  async send(phone: string, code: string) { await postJson(this.url, this.token, { phone, code }) }
}
export class HttpRealname implements RealnameProvider {
  readonly name = 'http'
  constructor(private url: string, private token: string) {}
  private async call(body: Record<string, unknown>): Promise<RealnameOutcome> {
    const j = await postJson(this.url, this.token, body) as { status?: string; pi?: string; birthYm?: string; ai?: string }
    if (j.status === 'VERIFIED' && j.pi) return { status: 'VERIFIED', pi: j.pi, birthYm: String(j.birthYm || '') }
    if (j.status === 'PENDING') return { status: 'PENDING', ai: String(j.ai || body.ai || '') }
    return { status: 'FAILED' }
  }
  submit(ai: string, name: string, idNumber: string, birthYm: string) {
    return this.call({ action: 'submit', ai, name, idNumber, birthYm })
  }
  query(ai: string) { return this.call({ action: 'query', ai }) }
}
export class HttpBehavior implements BehaviorReporter {
  readonly name = 'http'
  constructor(private url: string, private token: string) {}
  async report(events: { eventId: string; pi: string; kind: 'online' | 'offline'; occurredAtMs: number }[]) {
    await postJson(this.url, this.token, { events })
    return 'SENT' as const
  }
}

/* ---------------- placeholders for real vendors ---------------- */
class NotConfigured implements SmsProvider, RealnameProvider {
  constructor(readonly name: string) {}
  private fail(): never { throw new Error(`${this.name} adapter is not implemented yet: needs vendor credentials and the vendor's current API document`) }
  async send(): Promise<void> { this.fail() }
  async submit(): Promise<RealnameOutcome> { this.fail() }
  async query(): Promise<RealnameOutcome> { this.fail() }
}

export function createProviders(env: NodeJS.ProcessEnv) {
  const production = env.AUTH_ENV === 'production'
  const smsName = env.AUTH_SMS_PROVIDER || 'mock'
  const rnName = env.AUTH_REALNAME_PROVIDER || 'mock'
  if (production && (smsName === 'mock' || rnName === 'mock')) {
    throw new Error('AUTH_ENV=production refuses mock SMS/realname providers')
  }
  const sms: SmsProvider = smsName === 'mock'
    ? new MockSms()
    : smsName === 'http' && env.AUTH_SMS_HTTP_URL
      ? new HttpSms(env.AUTH_SMS_HTTP_URL, env.AUTH_SMS_HTTP_TOKEN || '')
      : new NotConfigured(`sms:${smsName}`)
  const realname: RealnameProvider = rnName === 'mock'
    ? new MockRealname()
    : rnName === 'http' && env.AUTH_REALNAME_HTTP_URL
      ? new HttpRealname(env.AUTH_REALNAME_HTTP_URL, env.AUTH_REALNAME_HTTP_TOKEN || '')
      : new NotConfigured(`realname:${rnName}`)
  if (production && (sms instanceof NotConfigured || realname instanceof NotConfigured)) {
    throw new Error(`AUTH_ENV=production but provider adapters are not implemented: sms=${smsName} realname=${rnName}`)
  }
  const behavior: BehaviorReporter = env.AUTH_BEHAVIOR_PROVIDER === 'http' && env.AUTH_BEHAVIOR_HTTP_URL
    ? new HttpBehavior(env.AUTH_BEHAVIOR_HTTP_URL, env.AUTH_BEHAVIOR_HTTP_TOKEN || '')
    : new NoopBehavior()
  return { sms, realname, behavior, production }
}

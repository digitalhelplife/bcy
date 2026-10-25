// bencao-auth core primitives: envelope encryption, lookup hashes, compact login tickets, ID-number checks.
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/* ---------- keys ---------- */
export type Keys = { dataKey: Buffer; pepper: Buffer; ticketKey: Buffer }
export function loadKeys(env: NodeJS.ProcessEnv): Keys {
  const k = (name: string) => {
    const v = env[name]
    if (!v) throw new Error(`missing ${name}`)
    const b = Buffer.from(v, 'base64')
    if (b.length < 32) throw new Error(`${name} must be >= 32 bytes (base64)`)
    return b
  }
  return { dataKey: k('AUTH_DATA_KEY').subarray(0, 32), pepper: k('AUTH_LOOKUP_PEPPER'), ticketKey: k('AUTH_TICKET_KEY') }
}

/* ---------- AES-256-GCM (v1:iv:tag:ct, base64) ---------- */
export function encrypt(keys: Keys, plain: string): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', keys.dataKey, iv)
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), ct.toString('base64')].join(':')
}
export function decrypt(keys: Keys, box: string): string {
  const [v, iv, tag, ct] = box.split(':')
  if (v !== 'v1') throw new Error('unknown ciphertext version')
  const d = createDecipheriv('aes-256-gcm', keys.dataKey, Buffer.from(iv, 'base64'))
  d.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8')
}
/** Deterministic, keyed lookup hash (HMAC with an independent pepper). Domain-separated per purpose. */
export function lookupHash(keys: Keys, purpose: string, value: string): string {
  return createHmac('sha256', keys.pepper).update(`${purpose}\u0000${value}`).digest('hex')
}

/* ---------- phone ---------- */
export const PHONE_RE = /^1[3-9]\d{9}$/
export function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const p = raw.replace(/[\s-]/g, '').replace(/^\+?86/, '')
  return PHONE_RE.test(p) ? p : null
}

/* ---------- login ticket ----------
 * Wire format: "LT-" + base32(sub[16] | iat[4] | exp[4] | jti[16] | tag[16]) = 3 + 90 chars.
 * Only [A-Z2-7-], so it is a valid Nakama custom ID (6–128, alnum + hyphen). Contains no phone/realname data.
 * tag = HMAC-SHA256(ticketKey, "bencao-auth|nakama|v1" || body)[0..16]  → binds iss/aud/version.
 */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
function b32enc(buf: Buffer): string {
  let bits = 0, val = 0, out = ''
  for (const byte of buf) { val = (val << 8) | byte; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5 } }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31]
  return out
}
function b32dec(s: string): Buffer | null {
  let bits = 0, val = 0; const out: number[] = []
  for (const ch of s) {
    const i = B32.indexOf(ch); if (i < 0) return null
    val = (val << 5) | i; bits += 5
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8 }
  }
  return Buffer.from(out)
}
const DOMAIN = Buffer.from('bencao-auth|nakama|v1')
const uuidToBuf = (u: string) => Buffer.from(u.replace(/-/g, ''), 'hex')
const bufToUuid = (b: Buffer) => { const h = b.toString('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}` }
export const TICKET_TTL_SEC = 300

export function issueTicket(keys: Keys, sub: string, nowMs: number): { ticket: string; jti: string; expiresAtMs: number } {
  const iat = Math.floor(nowMs / 1000), exp = iat + TICKET_TTL_SEC
  const jti = randomBytes(16)
  const body = Buffer.alloc(40)
  uuidToBuf(sub).copy(body, 0); body.writeUInt32BE(iat, 16); body.writeUInt32BE(exp, 20); jti.copy(body, 24)
  const tag = createHmac('sha256', keys.ticketKey).update(DOMAIN).update(body).digest().subarray(0, 16)
  return { ticket: `LT-${b32enc(Buffer.concat([body, tag]))}`, jti: jti.toString('hex'), expiresAtMs: exp * 1000 }
}

export type TicketClaims = { sub: string; iat: number; exp: number; jti: string }
/** Signature + time check only. One-time consumption of `jti` is enforced by the database. */
export function verifyTicket(keys: Keys, ticket: unknown, nowMs: number): TicketClaims | null {
  if (typeof ticket !== 'string' || !ticket.startsWith('LT-') || ticket.length !== 93) return null
  const raw = b32dec(ticket.slice(3))
  if (!raw || raw.length !== 56) return null
  const body = raw.subarray(0, 40), tag = raw.subarray(40)
  const want = createHmac('sha256', keys.ticketKey).update(DOMAIN).update(body).digest().subarray(0, 16)
  if (!timingSafeEqual(tag, want)) return null
  const iat = body.readUInt32BE(16), exp = body.readUInt32BE(20), now = Math.floor(nowMs / 1000)
  if (exp - iat > TICKET_TTL_SEC || now >= exp || iat > now + 60) return null
  return { sub: bufToUuid(body.subarray(0, 16)), iat, exp, jti: body.subarray(24, 40).toString('hex') }
}

/* ---------- SMS code ---------- */
export function newSmsCode(): string { return String(randomBytes(4).readUInt32BE(0) % 1_000_000).padStart(6, '0') }

/* ---------- PRC resident ID (GB 11643-1999) ---------- */
const W = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
const CHECK = '10X98765432'
/** Format + checksum + plausible birth date. Returns birth year-month (YYYY-MM) or null. Never stores the number. */
export function parseIdNumber(raw: unknown, nowMs: number): { birthYm: string } | null {
  if (typeof raw !== 'string') return null
  const id = raw.trim().toUpperCase()
  if (!/^\d{17}[\dX]$/.test(id)) return null
  let sum = 0
  for (let i = 0; i < 17; i++) sum += Number(id[i]) * W[i]
  if (CHECK[sum % 11] !== id[17]) return null
  const y = Number(id.slice(6, 10)), m = Number(id.slice(10, 12)), d = Number(id.slice(12, 14))
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  if (y < 1900 || dt.getTime() > nowMs) return null
  return { birthYm: `${y}-${String(m).padStart(2, '0')}` }
}
/** 2–30 Chinese characters (incl. middle dot for ethnic-minority names). */
export function validName(raw: unknown): boolean {
  return typeof raw === 'string' && /^[\u4e00-\u9fa5·]{2,30}$/.test(raw.trim())
}

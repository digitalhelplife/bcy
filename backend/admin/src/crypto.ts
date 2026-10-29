// Admin console crypto: scrypt passwords, opaque session tokens, and RFC 6238 TOTP.
// No dependency: the auth service already uses exactly this scrypt format, so hashes are interchangeable.
import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

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

export const newToken = () => randomBytes(32).toString('base64url')
export const sha256 = (v: string | Buffer) => createHash('sha256').update(v).digest('hex')
export const tokenHash = (token: string) => sha256(`bencao-admin-session\u0000${token}`)
export const ipHash = (ip: string, salt: string) => createHmac('sha256', salt).update(`ip\u0000${ip}`).digest('hex').slice(0, 32)

/* ---------------- TOTP (RFC 6238, SHA-1, 6 digits, 30 s) ---------------- */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Encode(buf: Buffer): string {
  let bits = 0, val = 0, out = ''
  for (const byte of buf) {
    val = (val << 8) | byte
    bits += 8
    while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5 }
  }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31]
  return out
}

export function base32Decode(s: string): Buffer {
  let bits = 0, val = 0
  const out: number[] = []
  for (const ch of s.replace(/=+$/, '').toUpperCase()) {
    const i = B32.indexOf(ch)
    if (i < 0) throw new Error('invalid base32')
    val = (val << 5) | i
    bits += 5
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8 }
  }
  return Buffer.from(out)
}

export const newTotpSecret = () => base32Encode(randomBytes(20))

export function hotp(secret: string, counter: number, digits = 6): string {
  const key = base32Decode(secret)
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64BE(BigInt(counter))
  const h = createHmac('sha1', key).update(buf).digest()
  const off = h[h.length - 1] & 0x0f
  const code = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3]
  return String(code % 10 ** digits).padStart(digits, '0')
}

export function verifyTotp(secret: string, code: unknown, nowMs = Date.now(), window = 1): boolean {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code.trim())) return false
  const counter = Math.floor(nowMs / 1000 / 30)
  for (let i = -window; i <= window; i++) {
    if (timingSafeEqual(Buffer.from(hotp(secret, counter + i)), Buffer.from(code.trim()))) return true
  }
  return false
}

export function totpUri(issuer: string, account: string, secret: string): string {
  const q = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: '6', period: '30' })
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?${q.toString()}`
}

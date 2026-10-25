import { describe, expect, it } from 'vitest'
import { randomBytes, randomUUID } from 'node:crypto'
import { decrypt, encrypt, issueTicket, lookupHash, normalizePhone, parseIdNumber, validName, verifyTicket, type Keys } from '../backend/auth/src/core'
import { createProviders, MockRealname } from '../backend/auth/src/providers'
import { beijingDay, holidaysExpiringWithin, isAdult, minorWindow } from '../src/shared/minorPolicy'

const keys: Keys = { dataKey: randomBytes(32), pepper: randomBytes(32), ticketKey: randomBytes(32) }
const bj = (s: string) => Date.parse(s + '+08:00')
// checksum-valid synthetic IDs (region 110101 is a public example code)
function makeId(birth: string, seq = '123'): string {
  const W = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2], C = '10X98765432'
  const b = '110101' + birth + seq; let s = 0
  for (let i = 0; i < 17; i++) s += Number(b[i]) * W[i]
  return b + C[s % 11]
}

describe('login ticket', () => {
  it('is a valid Nakama custom id and round-trips', () => {
    const sub = randomUUID(), now = Date.now()
    const t = issueTicket(keys, sub, now)
    expect(t.ticket).toMatch(/^LT-[A-Z2-7]{90}$/)
    expect(t.ticket.length).toBeLessThanOrEqual(128)
    const c = verifyTicket(keys, t.ticket, now + 1000)!
    expect(c.sub).toBe(sub); expect(c.jti).toBe(t.jti); expect(c.exp - c.iat).toBe(300)
  })
  it('rejects expiry, tampering and a different key', () => {
    const now = Date.now(), t = issueTicket(keys, randomUUID(), now)
    expect(verifyTicket(keys, t.ticket, now + 301_000)).toBeNull()
    const flip = t.ticket.slice(0, 10) + (t.ticket[10] === 'A' ? 'B' : 'A') + t.ticket.slice(11)
    expect(verifyTicket(keys, flip, now)).toBeNull()
    expect(verifyTicket({ ...keys, ticketKey: randomBytes(32) }, t.ticket, now)).toBeNull()
    expect(verifyTicket(keys, 'bcy-' + randomUUID(), now)).toBeNull()
  })
  it('carries no phone or identity data', () => {
    const t = issueTicket(keys, randomUUID(), Date.now())
    expect(t.ticket).not.toMatch(/1[3-9]\d{9}/)
  })
})

describe('data protection helpers', () => {
  it('encrypts with random IVs and decrypts', () => {
    const a = encrypt(keys, '13800138000'), b = encrypt(keys, '13800138000')
    expect(a).not.toBe(b); expect(a).not.toContain('13800138000'); expect(decrypt(keys, a)).toBe('13800138000')
  })
  it('lookup hash is deterministic and domain separated', () => {
    expect(lookupHash(keys, 'phone', 'x')).toBe(lookupHash(keys, 'phone', 'x'))
    expect(lookupHash(keys, 'phone', 'x')).not.toBe(lookupHash(keys, 'ip', 'x'))
  })
  it('normalizes phones', () => {
    expect(normalizePhone('+86 138-0013-8000')).toBe('13800138000')
    expect(normalizePhone('12800138000')).toBeNull()
    expect(normalizePhone(13800138000)).toBeNull()
  })
  it('validates ID checksum and birth date, returns only year-month', () => {
    const now = Date.now()
    expect(parseIdNumber(makeId('19900101'), now)).toEqual({ birthYm: '1990-01' })
    const bad = makeId('19900101').slice(0, 17) + (makeId('19900101')[17] === '0' ? '1' : '0')
    expect(parseIdNumber(bad, now)).toBeNull()
    expect(parseIdNumber(makeId('19900230'), now)).toBeNull()
    expect(validName('张三')).toBe(true); expect(validName('阿依古丽·买买提')).toBe(true); expect(validName('<b>x</b>')).toBe(false)
  })
})

describe('providers', () => {
  it('production refuses mock providers', () => {
    expect(() => createProviders({ AUTH_ENV: 'production' })).toThrow(/refuses mock/)
    expect(() => createProviders({ AUTH_ENV: 'production', AUTH_SMS_PROVIDER: 'aliyun', AUTH_REALNAME_PROVIDER: 'nppa' })).toThrow(/not implemented/)
    expect(createProviders({}).production).toBe(false)
  })
  it('mock realname simulates pending then verified', async () => {
    let t = 0; const m = new MockRealname(() => t)
    expect((await m.submit('a1', '张三', makeId('19900101'), '1990-01')).status).toBe('VERIFIED')
    expect((await m.submit('a2', '测试认证中', makeId('19900101'), '1990-01')).status).toBe('PENDING')
    expect((await m.query('a2')).status).toBe('PENDING')
    t = 31_000; expect((await m.query('a2')).status).toBe('VERIFIED')
    expect((await m.submit('a3', '测试失败', makeId('19900101'), '1990-01')).status).toBe('FAILED')
  })
})

describe('minor play-time policy (Beijing time)', () => {
  it('Friday 20:30 is allowed, until 21:00', () => {
    const w = minorWindow(bj('2026-10-23T20:30:00')) // Friday
    expect(w.allowed).toBe(true); expect(w.playableUntilMs).toBe(bj('2026-10-23T21:00:00'))
  })
  it('21:00:00 is closed; next window is Saturday 20:00', () => {
    const w = minorWindow(bj('2026-10-23T21:00:00'))
    expect(w.allowed).toBe(false); expect(w.nextWindowStartMs).toBe(bj('2026-10-24T20:00:00'))
  })
  it('weekday evening closed; next is Friday', () => {
    const w = minorWindow(bj('2026-10-21T20:30:00')) // Wednesday
    expect(w.allowed).toBe(false); expect(w.nextWindowStartMs).toBe(bj('2026-10-23T20:00:00'))
  })
  it('public holiday on a weekday is a service day; make-up workday Saturday stays a weekend day', () => {
    expect(minorWindow(bj('2026-10-06T20:10:00')).allowed).toBe(true) // Tue, National Day
    expect(minorWindow(bj('2026-10-10T20:10:00')).allowed).toBe(true) // Sat make-up workday: weekend rule still applies
    expect(minorWindow(bj('2026-10-08T20:10:00')).allowed).toBe(false) // Thu after holiday
  })
  it('date math is in Beijing time, not UTC', () => {
    expect(beijingDay(Date.parse('2026-10-22T16:30:00Z')).date).toBe('2026-10-23')
    expect(beijingDay(Date.parse('2026-10-22T16:30:00Z')).weekday).toBe(5)
  })
  it('adult classification is conservative in the birth month', () => {
    const now = bj('2026-10-22T12:00:00')
    expect(isAdult('2008-09', now)).toBe(true)
    expect(isAdult('2008-10', now)).toBe(false)
    expect(isAdult('2008-11', now)).toBe(false)
    expect(isAdult('1990-01', now)).toBe(true)
  })
  it('flags holiday config expiry for the release gate', () => {
    expect(holidaysExpiringWithin(bj('2026-10-22T12:00:00'), 30)).toBe(false)
    expect(holidaysExpiringWithin(bj('2026-12-15T12:00:00'), 30)).toBe(true)
  })
})

import { describe, expect, it } from 'vitest'
import { can, ROLE_PERMISSIONS, type AdminRole } from '../src/shared/adminContract'
import { hotp, newTotpSecret, verifyTotp, hashPassword, verifyPassword } from '../backend/admin/src/crypto'
import { parseCsv, mapReportRows } from '../backend/admin/src/main'
import type { Store } from '../backend/admin/src/store'

describe('admin role matrix', () => {
  it('owner has every permission', () => {
    const all = new Set(ROLE_PERMISSIONS.owner)
    for (const list of Object.values(ROLE_PERMISSIONS)) for (const p of list) expect(all.has(p)).toBe(true)
  })

  it('support can search phones and manage feedback but cannot read metrics or config', () => {
    expect(can('support', 'users.phone')).toBe(true)
    expect(can('support', 'feedback.manage')).toBe(true)
    expect(can('support', 'promo.manage')).toBe(false)
    expect(can('support', 'metrics.view')).toBe(false)
    expect(can('support', 'config.write')).toBe(false)
    expect(can('support', 'admin.manage')).toBe(false)
  })

  it('viewer is read-only and cannot see user details', () => {
    expect(can('viewer', 'overview.view')).toBe(true)
    expect(can('viewer', 'audit.view')).toBe(true)
    expect(can('viewer', 'users.view')).toBe(false)
    expect(can('viewer', 'promo.view')).toBe(false)
  })

  it('ops can read config and manage promotion but cannot write config or search phones', () => {
    expect(can('ops', 'config.view')).toBe(true)
    expect(can('ops', 'config.write')).toBe(false)
    expect(can('ops', 'promo.manage')).toBe(true)
    expect(can('ops', 'users.phone')).toBe(false)
  })

  it('unknown or empty roles get nothing', () => {
    expect(can(null, 'overview.view')).toBe(false)
    expect(can('nope' as AdminRole, 'overview.view')).toBe(false)
  })
})

describe('admin passwords', () => {
  it('accepts the matching password and rejects others', () => {
    const hash = hashPassword('BencaoDemo2026!')
    expect(verifyPassword('BencaoDemo2026!', hash)).toBe(true)
    expect(verifyPassword('wrong-password', hash)).toBe(false)
    expect(verifyPassword('', hash)).toBe(false)
  })
})

describe('TOTP', () => {
  it('verifies the current RFC 6238 code', () => {
    const secret = newTotpSecret()
    const now = Date.UTC(2026, 9, 29, 9, 0, 0)
    const counter = Math.floor(now / 1000 / 30)
    const code = hotp(secret, counter)
    expect(code).toMatch(/^\d{6}$/)
    expect(verifyTotp(secret, code, now)).toBe(true)
    expect(verifyTotp(secret, code === '000000' ? '000001' : '000000', now)).toBe(false)
  })

  it('accepts one step of clock skew but not more', () => {
    const secret = 'JBSWY3DPEHPK3PXP'
    const now = Date.UTC(2026, 9, 29, 9, 0, 0)
    const code = hotp(secret, Math.floor(now / 1000 / 30) - 1)
    expect(verifyTotp(secret, code, now, 1)).toBe(true)
    expect(verifyTotp(secret, code, now + 120_000, 1)).toBe(false)
  })
})

describe('CSV import', () => {
  it('parses quotes, commas and escaped quotes', () => {
    const parsed = parseCsv('a,b\n"x,1","y""z"\n\n')
    expect(parsed.headers).toEqual(['a', 'b'])
    expect(parsed.rows).toEqual([['x,1', 'y"z']])
  })

  it('maps channel/campaign and converts yuan to cents', async () => {
    const fake = {
      listChannels: async () => [{ id: 'c1', code: 'xhs_s1', name: '小红书 S1', platform: null, status: 'ACTIVE', notes: null, createdAtMs: 0 }],
      listCampaigns: async () => [{
        id: 'p1', channelId: 'c1', name: '秋假亲子打卡', startDay: null, endDay: null,
        budgetCents: null, landingUrl: null, notes: null, status: 'ACTIVE', createdAtMs: 0,
      }],
    } as unknown as Store
    const parsed = parseCsv('day,channel,campaign,impressions,clicks,spend\n2026-10-28,xhs_s1,秋假亲子打卡,1000,80,12.5')
    const out = await mapReportRows(parsed, fake, 'bencaoyou')
    expect(out.errors).toEqual([])
    expect(out.rows).toHaveLength(1)
    expect(out.rows[0]).toMatchObject({ day: '2026-10-28', channelId: 'c1', campaignId: 'p1', impressions: 1000, clicks: 80, spendCents: 1250 })
  })

  it('reports unknown channels and missing required columns', async () => {
    const fake = { listChannels: async () => [], listCampaigns: async () => [] } as unknown as Store
    const missing = await mapReportRows(parseCsv('foo,bar\n1,2'), fake, 'bencaoyou')
    expect(missing.errors[0]).toContain('缺少列')
    const unknown = await mapReportRows(parseCsv('day,channel\n2026-10-28,nope'), fake, 'bencaoyou')
    expect(unknown.errors[0]).toContain('不存在')
  })
})

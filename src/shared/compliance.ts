// Runtime compliance configuration (实名认证 / 未成年人保护), edited in the admin console (/admin/).
// Stored by bencao-auth (table runtime_config), read by Nakama (/internal/config) and the browser (/auth/config).
// Shared by auth service, Nakama runtime, frontend and tests — keep it dependency-free.

export type MinorMode = 'window' | 'block' | 'off'
export type MinorRule = {
  /** window = 仅在规定时段可玩；block = 不向未成年人提供服务；off = 不限制（仅测试环境）。 */
  mode: MinorMode
  /** Beijing-time hours, [startHour, endHour). */
  startHour: number
  endHour: number
  /** Allowed weekdays, 0 = Sunday … 6 = Saturday. */
  days: number[]
  /** Also allow statutory holidays listed in content/holidays.json. */
  includeHolidays: boolean
}
export type ComplianceConfig = {
  /** Phone login + realname verification. Off = device trial accounts, no identity data collected. */
  realnameEnabled: boolean
  minor: MinorRule
}
export type StoredCompliance = ComplianceConfig & { version: number; updatedAtMs: number; updatedBy: string }

/** National rule (国新出发〔2021〕14号): Fri/Sat/Sun + statutory holidays, 20:00–21:00. */
export const LEGAL_MINOR_RULE: MinorRule = { mode: 'window', startHour: 20, endHour: 21, days: [5, 6, 0], includeHolidays: true }

/** Defaults when no row exists yet. Staging/testing starts with realname OFF; production can never start without it. */
export function defaultCompliance(production: boolean): ComplianceConfig {
  return { realnameEnabled: production, minor: { ...LEGAL_MINOR_RULE, days: [...LEGAL_MINOR_RULE.days] } }
}

const KEYS = ['realnameEnabled', 'minor'] as const
const MINOR_KEYS = ['mode', 'startHour', 'endHour', 'days', 'includeHolidays'] as const

/**
 * Validate an edited config. Returns normalized config or a list of Chinese error messages.
 * Production guard: realname must stay on, minors must be restricted, and a window may only be stricter than the law.
 */
export function validateCompliance(input: unknown, production: boolean): { ok: true; config: ComplianceConfig } | { ok: false; errors: string[] } {
  const errors: string[] = []
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, errors: ['配置格式错误'] }
  const o = input as Record<string, unknown>
  for (const k of Object.keys(o)) if (!(KEYS as readonly string[]).includes(k)) errors.push(`未知字段：${k}`)
  if (typeof o.realnameEnabled !== 'boolean') errors.push('实名认证开关必须是开或关')
  const m = o.minor as Record<string, unknown> | undefined
  if (!m || typeof m !== 'object' || Array.isArray(m)) return { ok: false, errors: [...errors, '未成年人策略缺失'] }
  for (const k of Object.keys(m)) if (!(MINOR_KEYS as readonly string[]).includes(k)) errors.push(`未知字段：minor.${k}`)
  if (m.mode !== 'window' && m.mode !== 'block' && m.mode !== 'off') errors.push('未成年人策略必须是 时段限制 / 完全禁止 / 不限制')
  const isHour = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 24
  if (!isHour(m.startHour) || !isHour(m.endHour)) errors.push('时段必须是 0–24 的整点')
  else if ((m.startHour as number) >= (m.endHour as number)) errors.push('开始时间必须早于结束时间')
  const days = Array.isArray(m.days) ? m.days : null
  if (!days || days.some(d => !Number.isInteger(d) || d < 0 || d > 6) || new Set(days).size !== days.length) errors.push('可游戏星期必须是 0–6 且不重复')
  if (typeof m.includeHolidays !== 'boolean') errors.push('法定节假日开关必须是开或关')
  if (m.mode === 'window' && days && days.length === 0 && m.includeHolidays === false) errors.push('时段限制模式下至少选择一个可游戏的日子（或改为“完全禁止”）')
  if (errors.length) return { ok: false, errors }

  const config: ComplianceConfig = {
    realnameEnabled: o.realnameEnabled as boolean,
    minor: { mode: m.mode as MinorMode, startHour: m.startHour as number, endHour: m.endHour as number, days: [...(days as number[])].sort((a, b) => a - b), includeHolidays: m.includeHolidays as boolean },
  }
  if (production) {
    if (!config.realnameEnabled) errors.push('正式环境不能关闭实名认证')
    if (config.minor.mode === 'off') errors.push('正式环境不能取消未成年人限制')
    if (config.minor.mode === 'window') {
      const legal = new Set(LEGAL_MINOR_RULE.days)
      if (config.minor.days.some(d => !legal.has(d))) errors.push('正式环境的可游戏日只能是周五、周六、周日的子集')
      if (config.minor.startHour < LEGAL_MINOR_RULE.startHour || config.minor.endHour > LEGAL_MINOR_RULE.endHour) errors.push('正式环境的时段只能在 20:00–21:00 之内')
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, config }
}

const WK = '日一二三四五六'
/** Human-readable rule, e.g. “周五、周六、周日和法定节假日的 20:00–21:00”. */
export function describeMinorRule(r: MinorRule): string {
  if (r.mode === 'block') return '本游戏暂不向未成年人提供服务'
  if (r.mode === 'off') return '未成年人不限时（测试环境）'
  const order = [1, 2, 3, 4, 5, 6, 0]
  const days = order.filter(d => r.days.includes(d)).map(d => `周${WK[d]}`)
  const when = [days.join('、'), r.includeHolidays ? '法定节假日' : ''].filter(Boolean).join('和')
  const hh = (h: number) => `${String(h).padStart(2, '0')}:00`
  return `未成年人仅可在${when}的 ${hh(r.startHour)}–${hh(r.endHour)} 游戏`
}

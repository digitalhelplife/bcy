// Minor play-time policy (doc 06 §7.3, PRD F01). Pure functions shared by the Nakama module and the client.
// Minors may only be served on Fri/Sat/Sun and configured public holidays, [20:00, 21:00) Beijing time.
// China has observed a fixed UTC+8 with no DST since 1991, so a fixed offset is exact for this purpose and avoids
// relying on Intl time-zone data inside Nakama's goja runtime.
import holidays from '../../content/holidays.json'
import { LEGAL_MINOR_RULE, type MinorRule } from './compliance'

const OFFSET_MS = 8 * 3600_000
const DAY_MS = 86_400_000
const HOLIDAYS: ReadonlySet<string> = new Set(holidays.dates)
export const HOLIDAY_COVERAGE_TO: string = holidays.coverage.to
export const HOLIDAY_CONFIG_VERSION: string = holidays.configVersion

/** Beijing calendar date (YYYY-MM-DD) and weekday (0=Sun) for an epoch ms. */
export function beijingDay(ms: number): { date: string; weekday: number; dayStartMs: number } {
  const local = ms + OFFSET_MS
  const dayIndex = Math.floor(local / DAY_MS)
  const d = new Date(dayIndex * DAY_MS)
  const date = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
  return { date, weekday: d.getUTCDay(), dayStartMs: dayIndex * DAY_MS - OFFSET_MS }
}

/** Service day under `rule` (default: Fri/Sat/Sun + holidays). The admin console may configure a stricter rule. */
export function isServiceDay(ms: number, rule: MinorRule = LEGAL_MINOR_RULE): boolean {
  const { date, weekday } = beijingDay(ms)
  return rule.days.includes(weekday) || (rule.includeHolidays && HOLIDAYS.has(date))
}

export type MinorWindow = { allowed: boolean; playableUntilMs: number | null; nextWindowStartMs: number | null }

/**
 * Is a minor allowed to be served at `now` under `rule`? Also returns the current window end or the next window start.
 * mode 'block' → never; mode 'off' (staging only) → always, with no end.
 */
export function minorWindow(now: number, rule: MinorRule = LEGAL_MINOR_RULE): MinorWindow {
  if (rule.mode === 'off') return { allowed: true, playableUntilMs: null, nextWindowStartMs: null }
  if (rule.mode === 'block') return { allowed: false, playableUntilMs: null, nextWindowStartMs: null }
  const { dayStartMs } = beijingDay(now)
  const start = dayStartMs + rule.startHour * 3600_000
  const end = dayStartMs + rule.endHour * 3600_000
  if (isServiceDay(now, rule) && now >= start && now < end) return { allowed: true, playableUntilMs: end, nextWindowStartMs: null }
  // search forward up to 14 days for the next window
  for (let i = now >= start ? 1 : 0; i <= 14; i++) {
    const s = dayStartMs + i * DAY_MS + rule.startHour * 3600_000
    if (isServiceDay(s, rule)) return { allowed: false, playableUntilMs: null, nextWindowStartMs: s }
  }
  return { allowed: false, playableUntilMs: null, nextWindowStartMs: null }
}

/** True when the holiday file does not yet cover `now` + `days` (release gate / alert). */
export function holidaysExpiringWithin(now: number, days: number): boolean {
  return beijingDay(now + days * DAY_MS).date > HOLIDAY_COVERAGE_TO
}

/** Age in whole years on `now` (Beijing date) from a birth year-month; unknown day counts as the 1st (conservative = younger). */
export function isAdult(birthYm: string, now: number): boolean {
  const m = /^(\d{4})-(\d{2})$/.exec(birthYm)
  if (!m) return false
  const { date } = beijingDay(now)
  const [y, mo] = [Number(date.slice(0, 4)), Number(date.slice(5, 7))]
  let age = y - Number(m[1])
  if (mo < Number(m[2])) age--
  // same month: birthday day unknown → treat as not yet reached (stay minor until next month)
  if (mo === Number(m[2])) age--
  return age >= 18
}

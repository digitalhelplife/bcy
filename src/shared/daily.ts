// A5 G10 return reasons that need no push permission:
//  - dailyNote: one deterministic "小院小事" line per UTC+8 day, built from the player's own courtyard. Display only.
//  - termsIcs: an .ics file with the next verified solar terms, imported by the player into their own calendar.
import { ITEMS, PLANTS, TERMS, TERM_OCCURRENCES, VISITORS } from './content'
import { dayKeyUtc8, fnv1a, seasonView } from './rules'
import type { PlayerState } from './types'

const pick = <T>(arr: T[], h: number): T => arr[h % arr.length]

export function dailyNote(s: PlayerState, nowMs: number, userId: string): string {
  const day = dayKeyUtc8(nowMs)
  const h = fnv1a(`${userId}:daily:${day}`)
  const placed = s.garden.placements.map(p => ITEMS[p.itemId]).filter(Boolean)
  const plants = placed.filter(i => i.kind === 'plant').map(i => PLANTS[i.plantId!]?.name).filter(Boolean) as string[]
  const decor = placed.filter(i => i.kind !== 'plant').map(i => i.name)
  const visitors = s.visitors.map(v => VISITORS[v]?.name).filter(Boolean) as string[]
  const cur = seasonView(nowMs).currentTermId
  const term = cur ? TERMS[cur].name : null
  const lines: string[] = []
  if (plants.length) {
    const p = pick(plants, h >>> 3)
    lines.push(`早上去看了看，${p}的叶子上还挂着一点露水。`, `${p}今天好像又长高了一点点，可以凑近看看新叶。`, `阳光斜斜地照进院子，${p}的影子落在青石板上。`)
  }
  if (decor.length) {
    const d = pick(decor, h >>> 5)
    lines.push(`风从竹篱笆那边吹过来，${d}旁边落了几片叶子。`, `有人在${d}旁边坐了一会儿，院子里很安静。`)
  }
  if (visitors.length) {
    const v = pick(visitors, h >>> 7)
    lines.push(`${v}今天又从院墙上经过，停了一小会儿。`)
  }
  if (term) lines.push(`现在是${term}前后，院子里的光线和上个节气不太一样了。`)
  if (!lines.length) lines.push('院子还空空的，去景点逛一逛，带一颗种子回来吧。')
  return pick(lines, h)
}

const icsDate = (ms: number) => new Date(ms + 8 * 3_600_000).toISOString().slice(0, 10).replace(/-/g, '')
const esc = (t: string) => t.replace(/[\\;,]/g, m => '\\' + m).replace(/\n/g, '\\n')

/** All-day events for the next `count` VERIFIED terms after now. Times are Beijing dates; no alarms, no URLs. */
export function termsIcs(nowMs: number, count = 6): { ics: string; n: number } {
  const next = TERM_OCCURRENCES.filter(o => o.verified && o.atMs > nowMs).sort((a, b) => a.atMs - b.atMs).slice(0, count)
  const stamp = new Date(nowMs).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  const ev = next.map(o => {
    const t = TERMS[o.termId]; const d = icsDate(o.atMs); const d2 = icsDate(o.atMs + 86_400_000)
    return [
      'BEGIN:VEVENT', `UID:bcy-term-${o.termId}-${d}@bencaoyou`, `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${d2}`,
      `SUMMARY:${esc(`${t.name} · 本草小游记节气信笺开放`)}`,
      `DESCRIPTION:${esc(`${t.name}到了，可以在游戏里领取节气信笺，认识${PLANTS[t.plantId].name}。`)}`,
      'TRANSP:TRANSPARENT', 'END:VEVENT',
    ].join('\r\n')
  })
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//bencaoyou//solar-terms//ZH', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:本草小游记·节气', ...ev, 'END:VCALENDAR', ''].join('\r\n')
  return { ics, n: next.length }
}

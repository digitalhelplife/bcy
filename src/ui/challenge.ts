// A6-B1 挑战模式 (find levels). Client-only presentation: no hint texts, no hint button, a visible timer and a local
// best time. Rewards and server rules are unchanged, so a "best time" is a personal record, never a leaderboard.
const START = (runId: string) => `bcy.challenge.${runId}`
const BEST = 'bcy.best.v1'
export function markChallenge(runId: string, nowMs: number, s: Storage = sessionStorage) { try { s.setItem(START(runId), String(nowMs)) } catch { /* ignore */ } }
export function challengeStart(runId: string, s: Storage = sessionStorage): number | null {
  try { const v = Number(s.getItem(START(runId))); return Number.isFinite(v) && v > 0 ? v : null } catch { return null }
}
export function readBest(levelId: string, s: Storage = localStorage): number | null {
  try { const v = JSON.parse(s.getItem(BEST) ?? '{}')[levelId]; return typeof v === 'number' ? v : null } catch { return null }
}
/** Records a finished challenge once per run; returns the time, the previous best and whether it is a new record. */
export function finishChallenge(runId: string, levelId: string, nowMs: number, ss: Storage = sessionStorage, ls: Storage = localStorage) {
  const start = challengeStart(runId, ss)
  if (start === null) return null
  const doneKey = `${START(runId)}.done`
  const prev = ss.getItem(doneKey)
  if (prev) return JSON.parse(prev) as { ms: number; best: number | null; newBest: boolean }
  const ms = Math.max(0, nowMs - start)
  const best = readBest(levelId, ls)
  const newBest = best === null || ms < best
  if (newBest) { try { const all = JSON.parse(ls.getItem(BEST) ?? '{}'); all[levelId] = ms; ls.setItem(BEST, JSON.stringify(all)) } catch { /* ignore */ } }
  const out = { ms, best, newBest }
  try { ss.setItem(doneKey, JSON.stringify(out)) } catch { /* ignore */ }
  return out
}
export const fmtSecs = (ms: number) => `${(ms / 1000).toFixed(1)} 秒`

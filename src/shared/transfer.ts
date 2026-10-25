// A5 G7 progress transfer: move a save from one account (another browser, or the old device trial) to a fresh one.
// Pure helpers shared by the Nakama module, the local demo server and tests.
import { clone, createInitialState } from './rules'
import type { PlayerState } from './types'

/** No 0/O/1/I/L: easy to read aloud and type on a phone. 31^8 ≈ 8.5e11 codes. */
export const TRANSFER_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
export const TRANSFER_CODE_LEN = 8
export const TRANSFER_TTL_MS = 10 * 60_000
/** Failed claims allowed per account per hour (anti-guessing; Nginx limits per IP on top). */
export const TRANSFER_TRIES_PER_HOUR = 10

/** Builds a code from random bytes (hex string from a CSPRNG such as nk.uuidv4 / crypto.randomUUID). */
export function codeFromHex(hex: string): string {
  const h = hex.replace(/[^0-9a-f]/gi, '')
  let out = ''
  for (let i = 0; out.length < TRANSFER_CODE_LEN && i + 2 <= h.length; i += 2) {
    const b = parseInt(h.slice(i, i + 2), 16)
    if (b >= 248) continue // 248 = 31*8: reject to keep the distribution uniform
    out += TRANSFER_ALPHABET[b % TRANSFER_ALPHABET.length]
  }
  return out
}
/** Accepts "abcd-efgh", spaces, lower case; returns null when it cannot be a code. */
export function normalizeCode(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const c = input.toUpperCase().replace(/[\s-]/g, '')
  if (c.length !== TRANSFER_CODE_LEN) return null
  for (const ch of c) if (TRANSFER_ALPHABET.indexOf(ch) < 0) return null
  return c
}
export const formatCode = (c: string) => `${c.slice(0, 4)}-${c.slice(4)}`

/** A target may receive a save only before it has made any progress of its own. */
export function isFreshState(s: PlayerState): boolean {
  if (Object.values(s.levels).some(l => l.firstCompletedAtMs !== null)) return false
  if (s.plots.some(p => p.planting !== null)) return false
  if (s.discoveredPlantIds.length > 0) return false
  if (s.activeRunId) return false
  // G7 says "无小院改动" too: a saved layout is progress and must not be overwritten by a transfer code.
  if (s.garden.placements.length > 0) return false
  return true
}
export const hasProgress = (s: PlayerState) => !isFreshState(s)

/**
 * New states after a transfer. The target keeps its own consent record and gets a higher revision than before
 * (clients CAS on it); runs belong to the source account, so the active run is dropped. The source restarts.
 */
export function transferStates(source: PlayerState, target: PlayerState, nowMs: number): { target: PlayerState; source: PlayerState } {
  const t = clone(source)
  t.stateRevision = Math.max(target.stateRevision, source.stateRevision) + 1
  t.activeRunId = null
  t.consent = clone(target.consent)
  const s = createInitialState(nowMs)
  s.stateRevision = source.stateRevision + 1
  s.consent = clone(source.consent)
  return { target: t, source: s }
}

export type TransferCreateResult = { code: string; expiresAtMs: number; sourceHasProgress: boolean }
export type TransferClaimResult = { transferredAtMs: number; levelsCleared: number; plantsDiscovered: number }
export const claimSummary = (s: PlayerState, nowMs: number): TransferClaimResult => ({
  transferredAtMs: nowMs,
  levelsCleared: Object.values(s.levels).filter(l => l.firstCompletedAtMs !== null).length,
  plantsDiscovered: s.discoveredPlantIds.length,
})

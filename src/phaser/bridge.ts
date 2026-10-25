import type { Placement, PlotId, Proof } from '../shared/types'

export type BridgeEvents = {
  'scene.ready': { sceneInstanceId: string }
  'explore.progress': { sceneInstanceId: string; runId: string; found: string[]; placed: number; total: number; gates: Record<string, boolean> }
  'explore.hint': { sceneInstanceId: string; text: string }
  'explore.complete': { sceneInstanceId: string; runId: string; proof: Proof }
  'garden.draftChanged': { sceneInstanceId: string; placements: Placement[]; selected: string | null }
  'garden.plotTap': { sceneInstanceId: string; plotId: PlotId }
  'canvas.error': { sceneInstanceId: string; message: string }
  // React → Phaser commands
  /** F14 hint: pulse a soft ring near one unfound target (or point at the fog first). */
  'find.cmd': { sceneInstanceId: string; kind: 'reveal' }
  'garden.cmd': { kind: 'add'; itemId: string } | { kind: 'remove' } | { kind: 'mode'; editing: boolean } | { kind: 'load'; placements: Placement[] } | { kind: 'palette'; tint: number } | { kind: 'refreshPlots' }
}
type Handler<K extends keyof BridgeEvents> = (e: BridgeEvents[K]) => void

export class Bridge {
  private map = new Map<keyof BridgeEvents, Set<Handler<never>>>()
  on<K extends keyof BridgeEvents>(k: K, h: Handler<K>): () => void {
    if (!this.map.has(k)) this.map.set(k, new Set())
    this.map.get(k)!.add(h as Handler<never>)
    return () => { this.map.get(k)?.delete(h as Handler<never>) }
  }
  emit<K extends keyof BridgeEvents>(k: K, e: BridgeEvents[K]) {
    for (const h of [...(this.map.get(k) ?? [])]) (h as Handler<K>)(e)
  }
  clear() { this.map.clear() }
}

/** Local per-run progress cache (convenience only, never a reward credential). */
export const runCacheKey = (userId: string, runId: string, configVersion: string) => `bcy.run.${userId}.${runId}.${configVersion}`
export function readRunCache<T>(key: string): T | null {
  try { const v = sessionStorage.getItem(key) ?? localStorage.getItem(key); return v ? (JSON.parse(v) as T) : null } catch { return null }
}
export function writeRunCache(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)) } catch { /* storage full: progress simply won't survive refresh */ }
}
export function clearRunCaches() {
  for (const k of Object.keys(localStorage)) if (k.startsWith('bcy.run.')) localStorage.removeItem(k)
}

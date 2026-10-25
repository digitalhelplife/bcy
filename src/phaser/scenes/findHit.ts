// Pure hit-test for the find scene (no Phaser import, unit-tested).
// F14 parent mode only enlarges the tap radius on the client (05 前端规格 §FindScene: r × 1.3).
// World coordinates, target IDs, fog gating and the FindProof are unaffected.
export const PARENT_HIT_SCALE = 1.3
export type HitTarget = { targetId: string; hit: { x: number; y: number; r: number } }

export function hitRadius(r: number, parentMode: boolean) { return r * (parentMode ? PARENT_HIT_SCALE : 1) }

/** Nearest target whose (possibly enlarged) radius contains the tap, or null. */
export function pickTarget(targets: readonly HitTarget[], x: number, y: number, parentMode: boolean): string | null {
  let best: { id: string; d: number } | null = null
  for (const t of targets) {
    const d = Math.hypot(x - t.hit.x, y - t.hit.y)
    if (d <= hitRadius(t.hit.r, parentMode) && (!best || d < best.d)) best = { id: t.targetId, d }
  }
  return best?.id ?? null
}

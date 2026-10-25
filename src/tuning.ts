// Development-only tuning manager consumed by the preview Tweak bridge. Only client-side feel
// parameters are exposed; reward/settlement rules remain server-owned and are never tunable here.
export const TUNABLE = { snapRatio: 0.2, dragThresholdCss: 8 }
const DEFAULTS = { ...TUNABLE }

type Control = { id: string; type: 'number'; category: string; label: string; description: string; unit: string; default: number; min: number; max: number; step: number; applyMode: 'NEXT_RUN'; integrity: 'COSMETIC' | 'GAMEPLAY' }
const controls: Control[] = [
  { id: 'puzzle.snapRatio', type: 'number', category: 'Puzzle', label: 'Snap distance (cell ratio)', description: 'Applies when the next puzzle scene opens.', unit: '', default: DEFAULTS.snapRatio, min: 0.1, max: 0.4, step: 0.05, applyMode: 'NEXT_RUN', integrity: 'GAMEPLAY' },
  { id: 'input.dragThresholdCss', type: 'number', category: 'Input', label: 'Drag threshold', description: 'Applies when the next canvas scene opens.', unit: 'px', default: DEFAULTS.dragThresholdCss, min: 4, max: 16, step: 1, applyMode: 'NEXT_RUN', integrity: 'COSMETIC' },
]
const keyOf: Record<string, keyof typeof TUNABLE> = { 'puzzle.snapRatio': 'snapRatio', 'input.dragThresholdCss': 'dragThresholdCss' }

export const tuning = {
  controls: Object.freeze(controls),
  read() {
    const active = Object.fromEntries(controls.map(c => [c.id, TUNABLE[keyOf[c.id]]]))
    return { requested: { ...active }, active }
  },
  apply(patch: unknown): void {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Invalid patch')
    for (const [id, value] of Object.entries(patch)) {
      const c = controls.find(x => x.id === id)
      if (!c || typeof value !== 'number' || !Number.isFinite(value) || value < c.min || value > c.max) throw new Error('Invalid value')
    }
    for (const [id, value] of Object.entries(patch)) TUNABLE[keyOf[id]] = value as number
  },
}

/**
 * Map-style pan/zoom for a Phaser canvas, with no visible controls.
 *
 * Two fingers started together on the scene pan and pinch-zoom it. Game input is
 * suspended only while that gesture is active (one finger stays reserved for
 * gameplay), and Phaser's scale manager is told to re-read the transformed canvas
 * bounds before every press so taps keep landing on the same world coordinates.
 *
 * Pinching back out to the minimum snaps the view to its default position.
 */
export type CanvasPanZoom = { destroy: () => void }

type Options = {
  min?: number
  max?: number
  /** Called after every transform change (Phaser must refresh its bounds/displayScale). */
  onChange?: () => void
  /** Called when a two-finger move/zoom gesture starts/ends (suspend game input). */
  onGesture?: (active: boolean) => void
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const TWO_FINGER_MS = 320
const FIRST_MOVE_SLOP = 10

export function installCanvasPanZoom(canvas: HTMLCanvasElement, host: HTMLElement, opts: Options = {}): CanvasPanZoom {
  const min = opts.min ?? 1
  const max = opts.max ?? 4
  let scale = 1
  let tx = 0
  let ty = 0
  const pointers = new Map<number, { x: number; y: number }>()
  let firstAt = 0
  let firstStart = { x: 0, y: 0 }
  let firstMoved = false
  let gesturing = false
  let objectDown = false
  let panActive = false
  let panStart = { x: 0, y: 0 }
  let panLast = { x: 0, y: 0 }
  let pinch: { sx: number; dist: number; wx: number; wy: number } | null = null

  const local = (e: PointerEvent) => {
    const r = host.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  const clampView = () => {
    const W = host.clientWidth
    const H = host.clientHeight
    const bx = canvas.offsetLeft
    const by = canvas.offsetTop
    const bw = canvas.offsetWidth
    const bh = canvas.offsetHeight
    const sw = bw * scale
    const sh = bh * scale
    if (sw <= W) tx = (W - sw) / 2 - bx
    else tx = clamp(tx, W - sw - bx, -bx)
    if (sh <= H) ty = (H - sh) / 2 - by
    else ty = clamp(ty, H - sh - by, -by)
  }

  const apply = () => {
    canvas.style.transformOrigin = '0 0'
    canvas.style.transform = `translate3d(${tx}px, ${ty}px, 0) scale(${scale})`
    opts.onChange?.()
  }

  const resetView = () => { scale = min; tx = 0; ty = 0; clampView(); apply() }

  const zoomAt = (px: number, py: number, factor: number) => {
    const next = clamp(scale * factor, min, max)
    if (Math.abs(next - scale) < 0.001) return
    const bx = canvas.offsetLeft
    const by = canvas.offsetTop
    const cx = (px - bx - tx) / scale
    const cy = (py - by - ty) / scale
    scale = next
    tx = px - bx - cx * scale
    ty = py - by - cy * scale
    clampView()
    apply()
  }

  const startPinch = () => {
    const [a, b] = [...pointers.values()]
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    const bx = canvas.offsetLeft
    const by = canvas.offsetTop
    pinch = {
      sx: scale,
      dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      wx: (mid.x - bx - tx) / scale,
      wy: (mid.y - by - ty) / scale,
    }
  }

  const onDown = (e: PointerEvent) => {
    // Any new press clears the previous pan's tap-suppression flag (mouse taps included).
    canvas.dataset.bcyPan = ''
    if (e.pointerType !== 'touch') return
    const p = local(e)
    if (pointers.size === 0) {
      firstAt = Date.now()
      firstStart = p
      firstMoved = false
      objectDown = false
      panActive = false
      pointers.set(e.pointerId, p)
      panLast = p
      return
    }
    if (gesturing) {
      pointers.set(e.pointerId, p)
      e.preventDefault(); e.stopPropagation()
      return
    }
    // A second finger only starts a camera gesture if both landed together and the
    // first finger has not begun a game drag (so pieces/fog/items keep working).
    if (Date.now() - firstAt <= TWO_FINGER_MS && !firstMoved) {
      pointers.set(e.pointerId, p)
      gesturing = true
      opts.onGesture?.(true)
      startPinch()
      e.preventDefault(); e.stopPropagation()
      try { host.setPointerCapture(e.pointerId) } catch { /* ignore */ }
    }
  }

  const onMove = (e: PointerEvent) => {
    if (!pointers.has(e.pointerId)) return
    const p = local(e)
    pointers.set(e.pointerId, p)
    if (!gesturing) {
      if (Math.hypot(p.x - firstStart.x, p.y - firstStart.y) > FIRST_MOVE_SLOP) firstMoved = true
      // One-finger pan on empty space. If a game object received this press, its
      // `gameobjectdown`/`dragstart` cancels this immediately (see the canvas events).
      if (!objectDown && pointers.size === 1) {
        if (!panActive && Math.hypot(p.x - firstStart.x, p.y - firstStart.y) > FIRST_MOVE_SLOP) {
          panActive = true
          panStart = { x: tx, y: ty }
          panLast = p
          canvas.dataset.bcyPan = '1'
        }
        if (panActive) {
          tx += p.x - panLast.x
          ty += p.y - panLast.y
          panLast = p
          clampView()
          apply()
        }
      }
      return
    }
    e.preventDefault(); e.stopPropagation()
    if (pointers.size >= 2 && pinch) {
      const [a, b] = [...pointers.values()]
      const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y))
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      scale = clamp(pinch.sx * (dist / pinch.dist), min, max)
      const bx = canvas.offsetLeft
      const by = canvas.offsetTop
      tx = mid.x - bx - pinch.wx * scale
      ty = mid.y - by - pinch.wy * scale
      clampView()
      apply()
    }
  }

  const finishGesture = () => {
    if (!gesturing) return
    gesturing = false
    pinch = null
    if (scale <= min + 0.02) resetView()
    opts.onGesture?.(false)
  }

  const onUp = (e: PointerEvent) => {
    if (!pointers.has(e.pointerId)) return
    if (gesturing) { e.preventDefault(); e.stopPropagation() }
    pointers.delete(e.pointerId)
    if (pointers.size === 0) {
      if (gesturing) finishGesture()
      else { firstMoved = false; panActive = false }
    }
  }

  const cancelPan = () => {
    objectDown = true
    if (!panActive) return
    panActive = false
    tx = panStart.x
    ty = panStart.y
    canvas.dataset.bcyPan = ''
    clampView()
    apply()
  }
  canvas.addEventListener('bcy-object-down', cancelPan as EventListener)
  canvas.addEventListener('bcy-object-drag', cancelPan as EventListener)

  const onWheel = (e: WheelEvent) => {
    e.preventDefault()
    const r = host.getBoundingClientRect()
    zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015))
    if (scale <= min + 0.01) resetView()
  }

  const listeners: [string, EventListener, AddEventListenerOptions][] = [
    ['pointerdown', onDown as EventListener, { capture: true, passive: false }],
    ['pointermove', onMove as EventListener, { capture: true, passive: false }],
    ['pointerup', onUp as EventListener, { capture: true, passive: false }],
    ['pointercancel', onUp as EventListener, { capture: true, passive: false }],
    ['wheel', onWheel as EventListener, { capture: true, passive: false }],
  ]
  for (const [type, fn, opt] of listeners) host.addEventListener(type, fn, opt)

  return {
    destroy: () => {
      for (const [type, fn, opt] of listeners) host.removeEventListener(type, fn, opt)
      canvas.removeEventListener('bcy-object-down', cancelPan as EventListener)
      canvas.removeEventListener('bcy-object-drag', cancelPan as EventListener)
      canvas.style.transform = ''
      if (gesturing) opts.onGesture?.(false)
    },
  }
}

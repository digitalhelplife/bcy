import { useEffect, useRef } from 'react'

/**
 * Map-style pan/zoom for a DOM viewport + content layer.
 *
 * The content is laid out cover-sized (1080x1920) inside the viewport and then
 * transformed with translate/scale. One-finger drag pans, two-finger pinch zooms,
 * the wheel zooms at the cursor, and a drag that starts on a button suppresses the
 * click so the map can be grabbed from anywhere.
 */
export function useDomPanZoom(
  viewportRef: React.RefObject<HTMLElement | null>,
  layerRef: React.RefObject<HTMLElement | null>,
  opts: { min?: number; max?: number; aspectW?: number; aspectH?: number } = {},
) {
  const min = opts.min ?? 1
  const max = opts.max ?? 3.5
  const AW = opts.aspectW ?? 1080
  const AH = opts.aspectH ?? 1920
  const state = useRef({ s: 1, x: 0, y: 0, bx: 0, by: 0, bw: 0, bh: 0 })
  const apiRef = useRef<{ zoomIn: () => void; zoomOut: () => void; reset: () => void } | null>(null)

  useEffect(() => {
    const vp = viewportRef.current
    const layer = layerRef.current
    if (!vp || !layer) return
    const st = state.current
    let suppressClick = false

    const clampView = () => {
      const W = vp.clientWidth
      const H = vp.clientHeight
      const { bw, bh, s, bx, by } = st
      const sw = bw * s
      const sh = bh * s
      if (sw <= W) st.x = (W - sw) / 2 - bx
      else st.x = Math.min(0 - bx, Math.max(W - sw - bx, st.x))
      if (sh <= H) st.y = (H - sh) / 2 - by
      else st.y = Math.min(0 - by, Math.max(H - sh - by, st.y))
    }

    const apply = () => {
      layer.style.transformOrigin = '0 0'
      layer.style.transform = `translate3d(${st.x}px, ${st.y}px, 0) scale(${st.s})`
    }

    const layout = () => {
      const W = vp.clientWidth
      const H = vp.clientHeight
      const k = Math.max(W / AW, H / AH)
      st.bw = AW * k
      st.bh = AH * k
      st.bx = (W - st.bw) / 2
      st.by = (H - st.bh) / 2
      layer.style.width = `${st.bw}px`
      layer.style.height = `${st.bh}px`
      layer.style.left = `${st.bx}px`
      layer.style.top = `${st.by}px`
      clampView()
      apply()
    }

    const zoomAt = (px: number, py: number, factor: number) => {
      const next = Math.min(max, Math.max(min, st.s * factor))
      if (Math.abs(next - st.s) < 0.001) return
      const cx = (px - st.bx - st.x) / st.s
      const cy = (py - st.by - st.y) / st.s
      st.s = next
      st.x = px - st.bx - cx * st.s
      st.y = py - st.by - cy * st.s
      clampView()
      apply()
    }

    const zoomCenter = (factor: number) => zoomAt(vp.clientWidth / 2, vp.clientHeight / 2, factor)
    apiRef.current = {
      zoomIn: () => zoomCenter(1.35),
      zoomOut: () => zoomCenter(1 / 1.35),
      reset: () => { st.s = 1; st.x = 0; st.y = 0; clampView(); apply() },
    }

    const pts = new Map<number, { x: number; y: number }>()
    let last = { x: 0, y: 0 }
    let pinch: { sx: number; dist: number; wx: number; wy: number } | null = null
    let downAt = { x: 0, y: 0 }
    let moved = false

    const local = (e: PointerEvent) => {
      const r = vp.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }

    const onDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      const p = local(e)
      pts.set(e.pointerId, p)
      if (pts.size === 1) {
        last = p; downAt = p; moved = false; pinch = null
      } else if (pts.size === 2) {
        const [a, b] = [...pts.values()]
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
        pinch = {
          sx: st.s,
          dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
          wx: (mid.x - st.bx - st.x) / st.s,
          wy: (mid.y - st.by - st.y) / st.s,
        }
      }
    }
    const onMove = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return
      e.preventDefault()
      const p = local(e)
      pts.set(e.pointerId, p)
      if (pts.size >= 2 && pinch) {
        const [a, b] = [...pts.values()]
        const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y))
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
        st.s = Math.min(max, Math.max(min, pinch.sx * (dist / pinch.dist)))
        st.x = mid.x - st.bx - pinch.wx * st.s
        st.y = mid.y - st.by - pinch.wy * st.s
        clampView(); apply()
      } else if (pts.size === 1) {
        const dx = p.x - last.x
        const dy = p.y - last.y
        if (Math.abs(p.x - downAt.x) + Math.abs(p.y - downAt.y) > 6) moved = true
        st.x += dx; st.y += dy
        last = p
        clampView(); apply()
      }
    }
    const onUp = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return
      pts.delete(e.pointerId)
      if (moved) {
        suppressClick = true
        window.setTimeout(() => { suppressClick = false }, 350)
      }
      if (pts.size === 0) {
        pinch = null
        if (st.s <= min + 0.02) { st.s = min; st.x = 0; st.y = 0; clampView(); apply() }
      }
      else if (pts.size === 1) {
        const [p] = [...pts.values()]
        last = p; pinch = null
      }
    }
    const onClick = (e: MouseEvent) => {
      if (!suppressClick) return
      suppressClick = false
      e.stopPropagation()
      e.preventDefault()
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = vp.getBoundingClientRect()
      zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015))
      if (st.s <= min + 0.01) { st.s = min; st.x = 0; st.y = 0; clampView(); apply() }
    }

    const listeners: [string, EventListener, AddEventListenerOptions][] = [
      ['pointerdown', onDown as EventListener, { capture: true, passive: false }],
      ['pointermove', onMove as EventListener, { capture: true, passive: false }],
      ['pointerup', onUp as EventListener, { capture: true, passive: false }],
      ['pointercancel', onUp as EventListener, { capture: true, passive: false }],
      ['click', onClick as EventListener, { capture: true }],
      ['wheel', onWheel as EventListener, { capture: true, passive: false }],
    ]
    for (const [type, fn, opt] of listeners) vp.addEventListener(type, fn, opt)

    layout()
    const ro = new ResizeObserver(() => layout())
    ro.observe(vp)
    return () => {
      ro.disconnect()
      for (const [type, fn, opt] of listeners) vp.removeEventListener(type, fn, opt)
      apiRef.current = null
    }
  }, [viewportRef, layerRef, min, max, AW, AH])

  return {
    zoomIn: () => apiRef.current?.zoomIn(),
    zoomOut: () => apiRef.current?.zoomOut(),
    reset: () => apiRef.current?.reset(),
  }
}

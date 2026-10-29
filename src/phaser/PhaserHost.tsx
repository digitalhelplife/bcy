import Phaser from 'phaser'
import { useEffect, useRef } from 'react'
import { WORLD } from '../shared/content'
import { installCanvasPanZoom } from './panZoom'

type SceneCtor = new () => Phaser.Scene

/** Mounts one Phaser.Game for a single scene; destroyed (with listeners) on unmount. */
export function PhaserHost({ scene, sceneKey, data, className, scale = 'fit', align = 'center', panZoom = false }: {
  scene: SceneCtor; sceneKey: string; data: object; className?: string
  /** `envelop` fills the parent (cover, may crop edges); `fit` shows the whole 1080x1920 world. */
  scale?: 'fit' | 'envelop'
  /** `bottom` anchors a cover-scaled canvas to the bottom (garden plots), cropping the top instead. */
  align?: 'center' | 'bottom'
  /** Enables default two-finger pan/zoom on the scene (no visible controls). */
  panZoom?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const dataRef = useRef(data)

  useEffect(() => {
    if (!ref.current) return
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: ref.current,
      width: WORLD.width,
      height: WORLD.height,
      transparent: true,
      banner: false,
      scale: {
        mode: scale === 'envelop' ? Phaser.Scale.ENVELOP : Phaser.Scale.FIT,
        autoCenter: align === 'bottom' ? Phaser.Scale.NO_CENTER : Phaser.Scale.CENTER_BOTH,
      },
      input: { activePointers: 2 },
      render: { antialias: true, powerPreference: 'high-performance' },
    })
    game.scene.add(sceneKey, scene, true, dataRef.current)
    ;(window as unknown as { __phaser?: Phaser.Game }).__phaser = game

    // Phaser caches the canvas bounds. CSS pan/zoom changes them, so refresh both the
    // bounds and displayScale (which the input transform divides by) before each press
    // and after every transform, otherwise taps drift once the canvas is zoomed.
    const syncInputScale = () => {
      if (!game.isBooted) return
      const sm = game.scale
      sm.updateBounds()
      sm.displayScale.set(sm.baseSize.width / sm.canvasBounds.width, sm.baseSize.height / sm.canvasBounds.height)
    }
    const host = ref.current
    const onDown = () => { if (game.isBooted) syncInputScale() }
    host.addEventListener('pointerdown', onDown, { capture: true })

    const api = panZoom
      ? installCanvasPanZoom(game.canvas, host, {
        onChange: syncInputScale,
        onGesture: (active) => { game.input.enabled = !active },
      })
      : null

    const ro = new ResizeObserver(() => {
      if (!game.isBooted) return
      game.scale.getParentBounds()
      game.scale.refresh()
      syncInputScale()
    })
    ro.observe(host)

    return () => {
      host.removeEventListener('pointerdown', onDown, { capture: true })
      ro.disconnect()
      api?.destroy()
      game.destroy(true)
      const w = window as unknown as { __phaser?: Phaser.Game }
      if (w.__phaser === game) delete w.__phaser
    }
  }, [scene, sceneKey, scale, align, panZoom])

  return <div ref={ref} className={`${className ?? 'phaser-host'}${align === 'bottom' ? ' align-bottom' : ''}`} />
}

import Phaser from 'phaser'
import { useEffect, useRef } from 'react'
import { WORLD } from '../shared/content'

type SceneCtor = new () => Phaser.Scene

/** Mounts one Phaser.Game for a single scene; destroyed (with listeners) on unmount. */
export function PhaserHost({ scene, sceneKey, data, className }: { scene: SceneCtor; sceneKey: string; data: object; className?: string }) {
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
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
      input: { activePointers: 2 },
      render: { antialias: true, powerPreference: 'high-performance' },
    })
    game.scene.add(sceneKey, scene, true, dataRef.current)
    ;(window as unknown as { __phaser?: Phaser.Game }).__phaser = game
    // Banners/HUD can move the canvas without resizing its parent; Phaser caches canvas bounds,
    // so refresh them right before each press (pointerdown precedes mouse/touch compat events).
    const host = ref.current
    const onDown = () => { if (game.isBooted) game.scale.updateBounds() }
    host.addEventListener('pointerdown', onDown, { capture: true })
    const ro = new ResizeObserver(() => { if (game.isBooted) { game.scale.getParentBounds(); game.scale.refresh() } })
    ro.observe(host)
    return () => {
      host.removeEventListener('pointerdown', onDown, { capture: true })
      ro.disconnect()
      game.destroy(true)
      const w = window as unknown as { __phaser?: Phaser.Game }
      if (w.__phaser === game) delete w.__phaser
    }
  }, [scene, sceneKey])
  return <div ref={ref} className={className ?? 'phaser-host'} />
}

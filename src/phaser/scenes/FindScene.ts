import Phaser from 'phaser'
import { hitRadius, pickTarget } from './findHit'
import { showLoading } from '../loading'
import { SCENES, WORLD, asset } from '../../shared/content'
import type { SceneId } from '../../shared/types'
import { readRunCache, writeRunCache, type Bridge } from '../bridge'
import { TUNABLE } from '../../tuning'

/** parentMode is read once when the level is entered; toggling it mid-level takes effect next time (05 §FindScene). */
export type FindInit = { bridge: Bridge; sceneId: SceneId; runId: string; cacheKey: string; instanceId: string; parentMode?: boolean }
type Cache = { found: string[]; fog: { x: number; y: number } | null; revealed: boolean }

export class FindScene extends Phaser.Scene {
  private cfg!: FindInit
  private found = new Set<string>()
  private fog: Phaser.GameObjects.Image | null = null
  private revealed = false
  private down: { x: number; y: number } | null = null
  private done = false

  constructor() { super('find') }

  init(data: FindInit) { this.cfg = data; this.found = new Set(); this.revealed = false; this.done = false }

  preload() {
    showLoading(this, '正在展开景点…')
    const sc = SCENES[this.cfg.sceneId]
    this.load.image('bg', asset(sc.background))
    for (const t of sc.targets) if (t.texture) this.load.image(t.targetId, asset(t.texture))
    if (sc.fog) this.load.image('fog', asset(sc.fog.texture))
    this.load.image('ring', asset('effects/fx_target_ring'))
    this.load.image('badge', asset('effects/fx_found_badge'))
    this.load.image('sparkle', asset('effects/fx_sparkle'))
    this.load.on('loaderror', (file: Phaser.Loader.File) => this.cfg.bridge.emit('canvas.error', { sceneInstanceId: this.cfg.instanceId, message: `资源加载失败：${file.key}` }))
  }

  /** CSS pixels → game units, so thresholds stay 8 CSS px regardless of canvas scaling. */
  private cssToWorld(px: number) { return px * this.scale.displayScale.x }

  create() {
    const sc = SCENES[this.cfg.sceneId]
    this.add.image(0, 0, 'bg').setOrigin(0).setDisplaySize(WORLD.width, WORLD.height)
    for (const t of sc.targets) {
      if (t.texture && t.size) this.add.image(t.hit.x, t.hit.y, t.targetId).setDisplaySize(t.size.w, t.size.h)
    }
    const cache = readRunCache<Cache>(this.cfg.cacheKey)
    if (sc.fog) {
      const f = sc.fog
      const pos = cache?.fog ?? f.start
      this.fog = this.add.image(pos.x, pos.y, 'fog').setDisplaySize(f.size.w, f.size.h).setDepth(10).setAlpha(0.97)
      this.fog.setInteractive({ draggable: true, useHandCursor: true })
      this.input.dragDistanceThreshold = this.cssToWorld(TUNABLE.dragThresholdCss)
      let grab = { x: 0, y: 0 }
      this.fog.on('pointerdown', (ptr: Phaser.Input.Pointer) => { grab = { x: this.fog!.x - ptr.worldX, y: this.fog!.y - ptr.worldY } })
      this.fog.on('drag', (ptr: Phaser.Input.Pointer) => {
        this.fog!.setPosition(Phaser.Math.Clamp(ptr.worldX + grab.x, 0, WORLD.width), Phaser.Math.Clamp(ptr.worldY + grab.y, 0, WORLD.height))
        this.checkFog()
      })
      this.fog.on('dragend', () => { this.checkFog(); this.persist() })
      this.revealed = cache?.revealed ?? false
      this.tweens.add({ targets: this.fog, alpha: 0.88, yoyo: true, repeat: -1, duration: 2200, ease: 'Sine.easeInOut' })
    }
    for (const id of cache?.found ?? []) if (sc.targets.some(t => t.targetId === id)) this.markFound(id, false)

    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => { this.down = { x: p.x, y: p.y } })
    this.input.on('pointerup', (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      if (!this.down) return
      const moved = Phaser.Math.Distance.Between(this.down.x, this.down.y, p.x, p.y)
      this.down = null
      if (moved > this.cssToWorld(TUNABLE.dragThresholdCss)) return
      if (this.fog && over.includes(this.fog)) { this.hint('云雾挡住了视线，按住云雾拖到一旁'); return }
      this.tap(p.worldX, p.worldY)
    })
    const off = this.cfg.bridge.on('find.cmd', c => { if (c.sceneInstanceId === this.cfg.instanceId && c.kind === 'reveal') this.reveal() })
    this.events.once('shutdown', off)
    this.emitProgress()
    this.cfg.bridge.emit('scene.ready', { sceneInstanceId: this.cfg.instanceId })
  }

  private fogCovers(targetId: string) {
    const sc = SCENES[this.cfg.sceneId]
    if (!this.fog || !sc.fog || sc.fog.coversTargetId !== targetId) return false
    const t = sc.targets.find(x => x.targetId === targetId)!
    const hw = sc.fog.size.w * 0.42, hh = sc.fog.size.h * 0.38
    const cx = Phaser.Math.Clamp(t.hit.x, this.fog.x - hw, this.fog.x + hw)
    const cy = Phaser.Math.Clamp(t.hit.y, this.fog.y - hh, this.fog.y + hh)
    return Phaser.Math.Distance.Between(cx, cy, t.hit.x, t.hit.y) < t.hit.r * 0.8
  }

  private checkFog() {
    const sc = SCENES[this.cfg.sceneId]
    if (!sc.fog || this.revealed) return
    if (!this.fogCovers(sc.fog.coversTargetId)) {
      this.revealed = true
      this.hint('云雾散开了，看看露出了什么')
      this.emitProgress()
    }
  }

  private tap(x: number, y: number) {
    if (this.done) return
    const sc = SCENES[this.cfg.sceneId]
    const id = pickTarget(sc.targets, x, y, !!this.cfg.parentMode)
    if (!id) { this.miss(x, y); return }
    if (this.found.has(id)) { this.hint('这个已经找到啦'); return }
    if (this.fogCovers(id)) { this.hint('云雾挡住了，先把云雾拖开'); return }
    this.markFound(id, true)
    this.persist()
    this.emitProgress()
    if (this.found.size === sc.targets.length) this.complete()
  }

  private miss(x: number, y: number) {
    const s = this.add.image(x, y, 'ring').setDisplaySize(70, 70).setAlpha(0.6).setTint(0xdddddd)
    this.tweens.add({ targets: s, alpha: 0, scale: s.scale * 0.6, duration: 450, onComplete: () => s.destroy() })
    this.hint('不是这里，再看看提示')
  }

  private markFound(id: string, animate: boolean) {
    const t = SCENES[this.cfg.sceneId].targets.find(x => x.targetId === id)!
    this.found.add(id)
    const size = Math.max(t.hit.r * 2.1, 120)
    const ring = this.add.image(t.hit.x, t.hit.y, 'ring').setDisplaySize(size, size).setDepth(20)
    const badge = this.add.image(t.hit.x + size * 0.36, t.hit.y - size * 0.36, 'badge').setDisplaySize(72, 72).setDepth(21)
    if (animate) {
      const rs = ring.scale; const bs = badge.scale
      ring.setScale(rs * 0.3); badge.setScale(0)
      this.tweens.add({ targets: ring, scale: rs, duration: 380, ease: 'Back.easeOut' })
      this.tweens.add({ targets: badge, scale: bs, delay: 200, duration: 320, ease: 'Back.easeOut' })
      for (let i = 0; i < 6; i++) {
        const sp = this.add.image(t.hit.x, t.hit.y, 'sparkle').setDisplaySize(48, 48).setDepth(22)
        const a = (Math.PI * 2 * i) / 6
        this.tweens.add({ targets: sp, x: t.hit.x + Math.cos(a) * 110, y: t.hit.y + Math.sin(a) * 110, alpha: 0, duration: 650, onComplete: () => sp.destroy() })
      }
    }
  }

  private persist() {
    writeRunCache(this.cfg.cacheKey, { found: [...this.found], fog: this.fog ? { x: this.fog.x, y: this.fog.y } : null, revealed: this.revealed } satisfies Cache)
  }

  private gates(): Record<string, boolean> {
    const sc = SCENES[this.cfg.sceneId]
    return sc.fog ? { [sc.fog.gate]: this.revealed } : {}
  }

  private emitProgress() {
    const sc = SCENES[this.cfg.sceneId]
    this.cfg.bridge.emit('explore.progress', { sceneInstanceId: this.cfg.instanceId, runId: this.cfg.runId, found: [...this.found], placed: this.found.size, total: sc.targets.length, gates: this.gates() })
  }

  /** Soft ring around (not exactly on) an unfound target; if the fog hides the next one, nudge the fog instead. */
  private reveal() {
    if (this.done) return
    const sc = SCENES[this.cfg.sceneId]
    const t = sc.targets.find(x => !this.found.has(x.targetId))
    if (!t) return
    // Nudge the fog whenever its image lies over the target (it can visually cover neighbours of the gated one).
    if (this.fog && (this.fogCovers(t.targetId) || this.fog.getBounds().contains(t.hit.x, t.hit.y))) {
      this.hint('先按住云雾，把它拖到一旁')
      this.tweens.add({ targets: this.fog, x: this.fog.x + 24, yoyo: true, repeat: 2, duration: 160 })
      return
    }
    // Offset the ring centre a little so the hint narrows the area without giving the exact spot away.
    const size = hitRadius(t.hit.r, true) * 3.2
    const ox = ((t.targetId.length * 37) % 2 ? 1 : -1) * t.hit.r * 0.45
    const ring = this.add.image(t.hit.x + ox, t.hit.y - t.hit.r * 0.3, 'ring').setDisplaySize(size, size).setDepth(15).setAlpha(0)
    this.tweens.add({ targets: ring, alpha: 0.75, yoyo: true, repeat: 2, duration: 520, onComplete: () => ring.destroy() })
    this.hint(`找找看：${t.label}`)
  }
  private hint(text: string) { this.cfg.bridge.emit('explore.hint', { sceneInstanceId: this.cfg.instanceId, text }) }

  private complete() {
    this.done = true
    const sc = SCENES[this.cfg.sceneId]
    const gates: Record<string, boolean> = sc.fog ? { [sc.fog.gate]: true } : {}
    this.time.delayedCall(700, () => this.cfg.bridge.emit('explore.complete', {
      sceneInstanceId: this.cfg.instanceId, runId: this.cfg.runId,
      proof: { kind: 'find', foundTargetIds: sc.targets.map(t => t.targetId).filter(id => this.found.has(id)), gates },
    }))
  }
}

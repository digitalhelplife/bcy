import Phaser from 'phaser'
import { showLoading } from '../loading'
import { GARDEN_LAYOUT, ITEMS, PLOT_IDS, PLOT_UNLOCK, RULES, WORLD, asset, plantTexture } from '../../shared/content'
import { canPlace, findFreeSpot, footprintOf } from '../../shared/rules'
import type { Placement, Plot, PlotId } from '../../shared/types'
import type { Bridge, BridgeEvents } from '../bridge'
import { TUNABLE } from '../../tuning'

export type GardenInit = {
  bridge: Bridge; instanceId: string; placements: Placement[]; tint: number
  getPlots: () => Plot[]; serverNow: () => number; isPlotOpen: (id: PlotId) => boolean
}

const { origin, cell } = GARDEN_LAYOUT
const cellAt = (wx: number, wy: number, w: number, h: number) => ({
  x: Math.round((wx - origin.x) / cell.w - w / 2),
  y: Math.round((wy - origin.y) / cell.h - h / 2),
})

export class GardenScene extends Phaser.Scene {
  private cfg!: GardenInit
  private draft: Placement[] = []
  private sprites = new Map<string, Phaser.GameObjects.Image>()
  private editing = false
  private selected: string | null = null
  private grid!: Phaser.GameObjects.Graphics
  private ghost!: Phaser.GameObjects.Graphics
  private bg!: Phaser.GameObjects.Image
  private plotLayer!: Phaser.GameObjects.Container
  private off: (() => void)[] = []
  private plotSig = ''

  constructor() { super('garden') }
  init(data: GardenInit) { this.cfg = data; this.draft = data.placements.map(p => ({ ...p })); this.selected = null; this.editing = false; this.sprites = new Map() }

  preload() {
    showLoading(this, '正在布置小院…')
    this.load.image('garden_bg', asset(GARDEN_LAYOUT.background))
    this.load.image('ready', asset('ui/ui_ready'))
    // Load only what is on screen now (placed items + growing plots). Everything else is fetched on demand via
    // ensure(); with 24 plants preloading every texture was ~4 MB before the courtyard could appear.
    const keys = new Set<string>(this.draft.map(p => p.itemId))
    for (const plot of this.cfg.getPlots()) if (plot.planting) { keys.add(`seedling_${plot.planting.plantId}`); keys.add(`plant_${plot.planting.plantId}`) }
    for (const k of keys) { const path = this.texturePath(k); if (path) this.load.image(k, path) }
    this.load.on('loaderror', (file: Phaser.Loader.File) => this.cfg.bridge.emit('canvas.error', { sceneInstanceId: this.cfg.instanceId, message: `资源加载失败：${file.key}` }))
  }

  create() {
    this.bg = this.add.image(0, 0, 'garden_bg').setOrigin(0).setDisplaySize(WORLD.width, WORLD.height).setTint(this.cfg.tint)
    this.grid = this.add.graphics().setDepth(1).setVisible(false)
    this.grid.lineStyle(3, 0xffffff, 0.55)
    for (let x = 0; x <= RULES.gardenWidth; x++) this.grid.lineBetween(origin.x + x * cell.w, origin.y, origin.x + x * cell.w, origin.y + RULES.gardenHeight * cell.h)
    for (let y = 0; y <= RULES.gardenHeight; y++) this.grid.lineBetween(origin.x, origin.y + y * cell.h, origin.x + RULES.gardenWidth * cell.w, origin.y + y * cell.h)
    this.ghost = this.add.graphics().setDepth(2)
    // plot_7/plot_8 are not painted into the courtyard: draw wooden planters on the paving.
    const extra = this.add.graphics().setDepth(2999)
    PLOT_IDS.slice(GARDEN_LAYOUT.paintedPlots).forEach(id => {
      const { x, y } = GARDEN_LAYOUT.plots[id]
      extra.fillStyle(0x6b4a2b, 0.35).fillEllipse(x, y + 38, 170, 34)
      extra.fillStyle(0x9a6b3f, 1).fillRoundedRect(x - 78, y - 14, 156, 56, 12)
      extra.fillStyle(0x5d3d22, 1).fillRoundedRect(x - 70, y - 22, 140, 22, 8)
      extra.lineStyle(3, 0x6b4a2b, 1).strokeRoundedRect(x - 78, y - 14, 156, 56, 12)
    })
    this.plotLayer = this.add.container(0, 0).setDepth(3000)
    for (const p of this.draft) this.spawn(p)
    this.drawPlots()

    // Plot tap zones (outside the placement grid).
    for (const plotId of PLOT_IDS) {
      const z = this.add.zone(GARDEN_LAYOUT.plots[plotId].x, GARDEN_LAYOUT.plots[plotId].y - 40, 150, 190).setInteractive({ useHandCursor: true }).setDepth(3001)
      z.on('pointerup', () => { if (!this.editing) this.cfg.bridge.emit('garden.plotTap', { sceneInstanceId: this.cfg.instanceId, plotId }) })
    }
    this.input.dragDistanceThreshold = TUNABLE.dragThresholdCss * this.scale.displayScale.x
    this.input.on('pointerup', (_p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => {
      if (this.editing && over.length === 0) this.select(null)
    })
    this.off.push(this.cfg.bridge.on('garden.cmd', c => this.command(c)))
    this.time.addEvent({ delay: 1000, loop: true, callback: () => this.drawPlots() })
    this.events.once('shutdown', () => this.off.forEach(f => f()))
    this.emitDraft()
    this.cfg.bridge.emit('scene.ready', { sceneInstanceId: this.cfg.instanceId })
  }

  private texturePath(key: string): string | null {
    if (key.startsWith('seedling_')) return asset(plantTexture(key.slice('seedling_'.length) as never, 'seedling'))
    const it = ITEMS[key]
    return it && it.kind !== 'seed' ? asset(it.texture) : null
  }
  private waiting = new Map<string, (() => void)[]>()
  /** Load missing textures, then call cb. Safe to call repeatedly and while another load is in flight. */
  private ensure(keys: string[], cb: () => void) {
    const missing = keys.filter(k => !this.textures.exists(k))
    if (!missing.length) { cb(); return }
    const key = missing.join('|')
    const q = this.waiting.get(key); if (q) { q.push(cb); return }
    this.waiting.set(key, [cb])
    const run = () => {
      if (!this.sys.isActive()) return
      if (this.load.isLoading()) { this.load.once(Phaser.Loader.Events.COMPLETE, run); return }
      for (const k of missing) { const path = this.texturePath(k); if (path && !this.textures.exists(k)) this.load.image(k, path) }
      this.load.once(Phaser.Loader.Events.COMPLETE, () => { const cbs = this.waiting.get(key) ?? []; this.waiting.delete(key); if (this.sys.isActive()) cbs.forEach(f => f()) })
      this.load.start()
    }
    run()
  }
  private layout(img: Phaser.GameObjects.Image, p: Placement) {
    const f = footprintOf(p)
    const w = f.w * cell.w * 0.96
    const scale = w / img.width
    const maxH = (f.h + 1.8) * cell.h
    img.setScale(Math.min(scale, maxH / img.height))
    img.setPosition(origin.x + (f.x + f.w / 2) * cell.w, origin.y + (f.y + f.h) * cell.h - 4)
    img.setDepth(10 + img.y)
  }

  private spawn(p: Placement) {
    // Transparent placeholder until the texture arrives; the sprite exists immediately so commands stay synchronous.
    const has = this.textures.exists(p.itemId)
    const img = this.add.image(0, 0, has ? p.itemId : '__DEFAULT').setOrigin(0.5, 1)
    this.layout(img, p)
    if (!has) this.ensure([p.itemId], () => {
      if (!img.active) return
      img.setTexture(p.itemId)
      const cur = this.draft.find(d => d.instanceId === p.instanceId); if (cur) this.layout(img, cur)
    })
    img.setInteractive({ draggable: true, pixelPerfect: false, useHandCursor: true })
    this.input.setDraggable(img, this.editing)
    img.on('pointerup', () => { if (this.editing) this.select(p.instanceId) })
    img.on('dragstart', () => { this.select(p.instanceId); img.setDepth(5000).setAlpha(0.85) })
    img.on('drag', (ptr: Phaser.Input.Pointer) => {
      const f = footprintOf(p)
      const c = cellAt(ptr.worldX, ptr.worldY - f.h * cell.h * 0.5, f.w, f.h)
      const cand = { ...p, ...c }
      img.setPosition(origin.x + (c.x + f.w / 2) * cell.w, origin.y + (c.y + f.h) * cell.h - 4)
      this.drawGhost(cand, canPlace(this.draft, cand, p.instanceId))
    })
    img.on('dragend', (ptr: Phaser.Input.Pointer) => {
      const f = footprintOf(p)
      const c = cellAt(ptr.worldX, ptr.worldY - f.h * cell.h * 0.5, f.w, f.h)
      const cand = { ...p, ...c }
      const cur = this.draft.find(d => d.instanceId === p.instanceId)!
      if (canPlace(this.draft, cand, p.instanceId)) { cur.x = c.x; cur.y = c.y } else this.cfg.bridge.emit('explore.hint', { sceneInstanceId: this.cfg.instanceId, text: '这里放不下：不能重叠或超出院子' })
      img.setAlpha(1); this.layout(img, cur); this.ghost.clear(); this.emitDraft()
    })
    this.sprites.set(p.instanceId, img)
  }

  private drawGhost(p: Placement, ok: boolean) {
    const f = footprintOf(p)
    this.ghost.clear().fillStyle(ok ? 0x6eaaa0 : 0xd9534f, 0.45).lineStyle(4, ok ? 0x2f6f63 : 0x9b2c2c, 0.9)
    this.ghost.fillRect(origin.x + f.x * cell.w, origin.y + f.y * cell.h, f.w * cell.w, f.h * cell.h)
    this.ghost.strokeRect(origin.x + f.x * cell.w, origin.y + f.y * cell.h, f.w * cell.w, f.h * cell.h)
  }

  private select(id: string | null) {
    this.selected = id
    for (const [k, s] of this.sprites) s.setTint(k === id ? 0xc9f2e6 : 0xffffff)
    if (id) { const p = this.draft.find(d => d.instanceId === id)!; this.drawGhost(p, true) } else this.ghost.clear()
    this.emitDraft()
  }

  private command(c: BridgeEvents['garden.cmd']) {
    switch (c.kind) {
      case 'mode':
        this.editing = c.editing; this.grid.setVisible(c.editing)
        for (const s of this.sprites.values()) this.input.setDraggable(s, c.editing)
        if (!c.editing) this.select(null)
        break
      case 'add': {
        const spot = findFreeSpot(this.draft, c.itemId)
        if (!spot) { this.cfg.bridge.emit('explore.hint', { sceneInstanceId: this.cfg.instanceId, text: '院子里没有空位了，先移走一些摆件' }); return }
        const p: Placement = { instanceId: `i${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`, itemId: c.itemId, ...spot }
        this.draft.push(p); this.spawn(p); this.select(p.instanceId)
        break
      }
      case 'remove': {
        if (!this.selected) return
        this.sprites.get(this.selected)?.destroy(); this.sprites.delete(this.selected)
        this.draft = this.draft.filter(d => d.instanceId !== this.selected)
        this.select(null)
        break
      }
      case 'load':
        for (const s of this.sprites.values()) s.destroy()
        this.sprites.clear(); this.draft = c.placements.map(p => ({ ...p }))
        for (const p of this.draft) this.spawn(p)
        for (const s of this.sprites.values()) this.input.setDraggable(s, this.editing)
        this.select(null)
        break
      case 'palette': this.bg.setTint(c.tint); break
      case 'refreshPlots': this.plotSig = ''; this.drawPlots(); break
    }
  }

  private drawPlots() {
    const now = this.cfg.serverNow()
    const plots = this.cfg.getPlots()
    const sig = plots.map(p => `${this.cfg.isPlotOpen(p.plotId) ? 'o' : 'x'}${p.planting ? `${p.planting.plantingId}:${now >= p.planting.readyAtMs}` : '-'}`).join('|')
    if (sig === this.plotSig) return
    const need = plots.flatMap(p => p.planting && this.cfg.isPlotOpen(p.plotId) ? [now >= p.planting.readyAtMs ? `plant_${p.planting.plantId}` : `seedling_${p.planting.plantId}`] : [])
    const missing = need.filter(k => !this.textures.exists(k))
    if (missing.length) this.ensure(missing, () => { this.plotSig = ''; this.drawPlots() })
    this.plotSig = missing.length ? '' : sig
    this.tweens.killTweensOf(this.plotLayer.list)
    this.plotLayer.removeAll(true)
    for (const plot of plots) {
      const { x, y } = GARDEN_LAYOUT.plots[plot.plotId]
      if (!this.cfg.isPlotOpen(plot.plotId)) {
        const lock = this.add.graphics()
        lock.fillStyle(0x2e3b30, 0.55).fillRoundedRect(x - 80, y - 70, 160, 110, 18)
        const t = this.add.text(x, y - 15, `图鉴发现\n${PLOT_UNLOCK[plot.plotId]} 种开放`, { fontFamily: '"ManusCC0 Sans CJK SC", sans-serif', fontSize: '26px', color: '#ffffff', align: 'center' }).setOrigin(0.5)
        this.plotLayer.add([lock, t])
        continue
      }
      if (!plot.planting) continue
      const ready = now >= plot.planting.readyAtMs
      if (!this.textures.exists(ready ? `plant_${plot.planting.plantId}` : `seedling_${plot.planting.plantId}`)) continue
      const img = this.add.image(x, y + 30, ready ? `plant_${plot.planting.plantId}` : `seedling_${plot.planting.plantId}`).setOrigin(0.5, 1)
      img.setScale((ready ? 140 : 110) / img.width)
      this.plotLayer.add(img)
      if (ready) {
        const icon = this.add.image(x + 46, y - 120, 'ready').setDisplaySize(64, 60)
        this.tweens.add({ targets: icon, y: icon.y - 14, yoyo: true, repeat: -1, duration: 700, ease: 'Sine.easeInOut' })
        this.plotLayer.add(icon)
      }
    }
  }

  private emitDraft() {
    this.cfg.bridge.emit('garden.draftChanged', { sceneInstanceId: this.cfg.instanceId, placements: this.draft.map(p => ({ ...p })), selected: this.selected })
  }
}

import Phaser from 'phaser'
import { showLoading } from '../loading'
import { LEVELS, SCENES, WORLD, asset, puzzlePieces } from '../../shared/content'
import type { LevelId } from '../../shared/types'
import { readRunCache, writeRunCache, type Bridge } from '../bridge'
import { TUNABLE } from '../../tuning'
import { shuffledOrder } from './puzzleOrder'

export type PuzzleInit = { bridge: Bridge; levelId: LevelId; runId: string; shuffleSeed: number; cacheKey: string; instanceId: string }
type Cache = { placed: string[] }

const BOARD = { x: 90, y: 70, w: 900, h: 1200 }
const TRAY = { y: 1310, h: 580 }
const ART = { w: 1080, h: 1440 }

export class PuzzleScene extends Phaser.Scene {
  private cfg!: PuzzleInit
  private placed = new Set<string>()
  private done = false

  constructor() { super('puzzle') }
  init(data: PuzzleInit) { this.cfg = data; this.placed = new Set(); this.done = false }

  preload() {
    showLoading(this, '正在准备拼图…')
    const sc = SCENES[LEVELS[this.cfg.levelId].sceneId]
    this.load.image('art', asset(sc.puzzleArt))
    this.load.image('sparkle', asset('effects/fx_sparkle'))
    this.load.on('loaderror', (file: Phaser.Loader.File) => this.cfg.bridge.emit('canvas.error', { sceneInstanceId: this.cfg.instanceId, message: `资源加载失败：${file.key}` }))
  }

  create() {
    const sc = SCENES[LEVELS[this.cfg.levelId].sceneId]
    const { columns, rows } = sc.puzzle
    const cellW = BOARD.w / columns, cellH = BOARD.h / rows
    const srcW = ART.w / columns, srcH = ART.h / rows
    const boardScale = cellW / srcW
    const tex = this.textures.get('art')
    const pieces = puzzlePieces(this.cfg.levelId)
    for (const p of pieces) if (!tex.has(p.pieceId)) tex.add(p.pieceId, 0, p.col * srcW, p.row * srcH, srcW, srcH)

    this.add.rectangle(WORLD.width / 2, WORLD.height / 2, WORLD.width, WORLD.height, 0xf6f0e4)
    this.add.rectangle(BOARD.x + BOARD.w / 2, BOARD.y + BOARD.h / 2, BOARD.w + 24, BOARD.h + 24, 0xe7dcc6).setStrokeStyle(6, 0xbd925e)
    this.add.image(BOARD.x, BOARD.y, 'art', '__BASE').setOrigin(0).setDisplaySize(BOARD.w, BOARD.h).setAlpha(0.16)
    const g = this.add.graphics().lineStyle(4, 0x8a7a5c, 0.55)
    for (let c = 1; c < columns; c++) g.lineBetween(BOARD.x + c * cellW, BOARD.y, BOARD.x + c * cellW, BOARD.y + BOARD.h)
    for (let r = 1; r < rows; r++) g.lineBetween(BOARD.x, BOARD.y + r * cellH, BOARD.x + BOARD.w, BOARD.y + r * cellH)
    this.add.rectangle(WORLD.width / 2, TRAY.y + TRAY.h / 2, WORLD.width - 40, TRAY.h, 0xe9e0cd).setStrokeStyle(4, 0xc9b892)

    // Tray layout: 4 pieces in one row, 6 pieces in two rows of three.
    const trayCols = pieces.length === 4 ? 4 : 3
    const trayRows = Math.ceil(pieces.length / trayCols)
    const slotW = (WORLD.width - 60) / trayCols, slotH = TRAY.h / trayRows
    const trayScale = Math.min((slotW - 26) / srcW, (slotH - 26) / srcH)
    const order = shuffledOrder(pieces.length, this.cfg.shuffleSeed)
    const snap = TUNABLE.snapRatio * Math.min(cellW, cellH)
    const cache = readRunCache<Cache>(this.cfg.cacheKey)

    order.forEach((pieceIndex, trayIndex) => {
      const p = pieces[pieceIndex]
      const home = { x: 30 + slotW * (trayIndex % trayCols) + slotW / 2, y: TRAY.y + slotH * Math.floor(trayIndex / trayCols) + slotH / 2 }
      const target = { x: BOARD.x + p.col * cellW + cellW / 2, y: BOARD.y + p.row * cellH + cellH / 2 }
      const img = this.add.image(home.x, home.y, 'art', p.pieceId).setScale(trayScale)
      if (cache?.placed.includes(p.pieceId)) { img.setPosition(target.x, target.y).setScale(boardScale); this.placed.add(p.pieceId); return }
      img.setInteractive({ draggable: true, useHandCursor: true })
      // Keep the grab point under the finger: Phaser only measures the drag offset after the
      // distance threshold, which would make the piece trail the finger by that amount.
      let grab = { x: 0, y: 0 }
      img.on('pointerdown', (ptr: Phaser.Input.Pointer) => { grab = { x: img.x - ptr.worldX, y: img.y - ptr.worldY } })
      img.on('dragstart', () => { img.setDepth(50); this.tweens.add({ targets: img, scale: boardScale, duration: 120 }) })
      img.on('drag', (ptr: Phaser.Input.Pointer) => img.setPosition(ptr.worldX + grab.x, ptr.worldY + grab.y))
      img.on('dragend', () => {
        // Logical (world) distance, independent of canvas CSS scaling.
        if (Phaser.Math.Distance.Between(img.x, img.y, target.x, target.y) <= snap) {
          img.disableInteractive(); img.setDepth(1)
          this.tweens.add({ targets: img, x: target.x, y: target.y, scale: boardScale, duration: 140 })
          this.placed.add(p.pieceId)
          this.sparkle(target.x, target.y)
          writeRunCache(this.cfg.cacheKey, { placed: [...this.placed] } satisfies Cache)
          this.progress()
          if (this.placed.size === pieces.length) this.complete()
        } else {
          img.setDepth(5)
          this.tweens.add({ targets: img, x: home.x, y: home.y, scale: trayScale, duration: 220, ease: 'Quad.easeOut' })
          if (img.y < TRAY.y) this.cfg.bridge.emit('explore.hint', { sceneInstanceId: this.cfg.instanceId, text: '位置不对，这片回到托盘了，再试试' })
        }
      })
    })
    this.input.dragDistanceThreshold = TUNABLE.dragThresholdCss * this.scale.displayScale.x
    this.input.on('gameobjectdown', () => this.game.canvas.dispatchEvent(new CustomEvent('bcy-object-down')))
    this.input.on('dragstart', () => this.game.canvas.dispatchEvent(new CustomEvent('bcy-object-drag')))
    this.progress()
    this.cfg.bridge.emit('scene.ready', { sceneInstanceId: this.cfg.instanceId })
    if (this.placed.size === pieces.length) this.complete()
  }

  private sparkle(x: number, y: number) {
    for (let i = 0; i < 5; i++) {
      const s = this.add.image(x, y, 'sparkle').setDisplaySize(56, 56).setDepth(60)
      const a = (Math.PI * 2 * i) / 5
      this.tweens.add({ targets: s, x: x + Math.cos(a) * 140, y: y + Math.sin(a) * 140, alpha: 0, duration: 600, onComplete: () => s.destroy() })
    }
  }

  private progress() {
    const total = puzzlePieces(this.cfg.levelId).length
    this.cfg.bridge.emit('explore.progress', { sceneInstanceId: this.cfg.instanceId, runId: this.cfg.runId, found: [...this.placed], placed: this.placed.size, total, gates: {} })
  }

  private complete() {
    if (this.done) return
    this.done = true
    const slots = puzzlePieces(this.cfg.levelId).map(p => ({ pieceId: p.pieceId, slotIndex: p.slotIndex }))
    this.time.delayedCall(700, () => this.cfg.bridge.emit('explore.complete', { sceneInstanceId: this.cfg.instanceId, runId: this.cfg.runId, proof: { kind: 'puzzle', slots } }))
  }
}

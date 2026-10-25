// A6-B3 博主产出: a 4-picture carousel (scenic / plant / garden / route card), a route guide card and a 6-second
// courtyard animation. Everything is rendered on this device from game content; nothing is uploaded or posted.
// Every picture keeps the fixed footer (wordmark, originality notice, trial mark) through drawFixedFooter.
import { SCENES, SCENE_ORDER } from '../shared/content'
import type { PaletteId, Placement, PlantId, SceneId } from '../shared/types'
import { FONT, coverImage, drawFixedFooter, ensureFont, loadImage, renderShare, wrapText } from './exportShare'

export type RouteStop = { sceneId: SceneId; line: string }
export type RouteCardInput = { title: string; stops: RouteStop[]; ticked: ReadonlySet<string> }

export const DEFAULT_ROUTE: RouteStop[] = SCENE_ORDER.map(id => ({ sceneId: id, line: `先在游戏里认识${SCENES[id].displayName}，到现场再对照着看。` }))

/** Route guide card (1080×1440): three stops with the real landmarks met in the game and the on-site ticks. */
export async function renderRouteCard(input: RouteCardInput): Promise<HTMLCanvasElement> {
  await ensureFont()
  const canvas = document.createElement('canvas'); canvas.width = 1080; canvas.height = 1440
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#F6F0E4'; ctx.fillRect(0, 0, 1080, 1440)
  ctx.fillStyle = '#FFFDF6'; ctx.beginPath(); ctx.roundRect(40, 40, 1000, 1110, 36); ctx.fill()
  ctx.fillStyle = '#3F513F'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.font = `bold 46px ${FONT}`
  ctx.fillText(wrapText(ctx, input.title || '成都周边带娃路线', 900, 1)[0] ?? '', 540, 112)
  ctx.font = `26px ${FONT}`; ctx.fillStyle = '#7A6E58'
  ctx.fillText('游戏里先认识，到现场再对照 · 以景区官方公告为准', 540, 166)
  const stops = input.stops.slice(0, 3)
  const rowH = 300, top = 206
  for (let i = 0; i < stops.length; i++) {
    const st = stops[i]; const sc = SCENES[st.sceneId]; const y = top + i * (rowH + 16)
    ctx.save(); ctx.beginPath(); ctx.roundRect(70, y, 330, rowH, 24); ctx.clip()
    coverImage(ctx, await loadImage(sc.thumb), { x: 70, y, w: 330, h: rowH })
    ctx.restore()
    ctx.fillStyle = '#E8C48A'; ctx.beginPath(); ctx.arc(96, y + 26, 22, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = '#FFFDF6'; ctx.font = `bold 26px ${FONT}`; ctx.textAlign = 'center'; ctx.fillText(String(i + 1), 96, y + 27)
    ctx.textAlign = 'left'; ctx.fillStyle = '#3F513F'; ctx.font = `bold 36px ${FONT}`
    ctx.fillText(sc.displayName, 430, y + 32)
    ctx.font = `26px ${FONT}`; ctx.fillStyle = '#5B5141'
    wrapText(ctx, st.line, 580, 3).forEach((l, k) => ctx.fillText(l, 430, y + 82 + k * 36))
    const real = sc.targets.filter(t => t.fictional === false)
    ctx.font = `26px ${FONT}`
    real.slice(0, 3).forEach((t, k) => {
      const on = input.ticked.has(t.targetId)
      ctx.fillStyle = on ? '#4E8A63' : '#9A8F78'
      ctx.fillText(`${on ? '☑' : '☐'} ${t.label}`, 430, y + 200 + k * 34)
    })
  }
  drawFixedFooter(ctx, await loadImage('brand/brand_wordmark'))
  return canvas
}

export type CarouselInput = {
  sceneId: SceneId; plantId: PlantId | null
  garden: { paletteId: PaletteId; placements: Placement[] }
  stickers?: PlantId[]; route: RouteCardInput
}
/** Four pictures in posting order. Titles are fixed short captions; the player can still edit single exports. */
export async function renderCarousel(input: CarouselInput): Promise<{ name: string; canvas: HTMLCanvasElement }[]> {
  const out: { name: string; canvas: HTMLCanvasElement }[] = []
  out.push({ name: '1-景点', canvas: await renderShare({ templateId: 'share_scenic', title: `${SCENES[input.sceneId].displayName} · 游戏里先逛一遍`, sceneId: input.sceneId, stickers: input.stickers }) })
  if (input.plantId) out.push({ name: '2-植物', canvas: await renderShare({ templateId: 'share_plant', title: '今天认识的植物', plantId: input.plantId }) })
  out.push({ name: '3-小院', canvas: await renderShare({ templateId: 'share_garden', title: '我布置的川西小院', garden: input.garden }) })
  out.push({ name: '4-路线', canvas: await renderRouteCard(input.route) })
  return out
}

/** Recording needs MediaRecorder + canvas.captureStream; otherwise the button is hidden. */
export function videoSupport(): string | null {
  if (typeof MediaRecorder === 'undefined' || typeof HTMLCanvasElement.prototype.captureStream !== 'function') return null
  for (const t of ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm']) if (MediaRecorder.isTypeSupported(t)) return t
  return null
}
const ease = (x: number) => 1 - Math.pow(1 - x, 3)
/**
 * 6-second courtyard animation: items appear in groups (bottom row last), then the finished picture holds.
 * Frames are whole share_garden pictures, so the fixed footer and trial mark are present in every frame.
 */
export async function recordGardenVideo(garden: { paletteId: PaletteId; placements: Placement[] }, title: string, onProgress?: (p: number) => void): Promise<Blob> {
  const mime = videoSupport()
  if (!mime) throw new Error('当前浏览器不支持录制动画，可以改用轮播组图')
  const sorted = [...garden.placements].sort((a, b) => a.y - b.y || a.x - b.x)
  const steps = Math.min(6, Math.max(1, sorted.length))
  const states: HTMLCanvasElement[] = [await renderShare({ templateId: 'share_garden', title, garden: { ...garden, placements: [] } })]
  for (let k = 1; k <= steps; k++) {
    states.push(await renderShare({ templateId: 'share_garden', title, garden: { ...garden, placements: sorted.slice(0, Math.ceil((sorted.length * k) / steps)) } }))
    onProgress?.(k / (steps + 1))
  }
  const W = 720, H = 960 // 3:4, smaller than the PNG to keep the file light
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')!
  const stream = canvas.captureStream(30)
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2_500_000 })
  const chunks: Blob[] = []
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
  const done = new Promise<Blob>(resolve => { rec.onstop = () => resolve(new Blob(chunks, { type: mime.split(';')[0] })) })
  const TOTAL = 6000, BUILD = 4200
  rec.start(250)
  const t0 = performance.now()
  await new Promise<void>(resolve => {
    const frame = () => {
      const t = performance.now() - t0
      const pos = Math.min(1, t / BUILD) * steps
      const i = Math.min(steps - 1, Math.floor(pos)), f = ease(Math.min(1, pos - i))
      ctx.globalAlpha = 1; ctx.drawImage(states[i], 0, 0, W, H)
      ctx.globalAlpha = t >= BUILD ? 1 : f; ctx.drawImage(states[Math.min(steps, i + 1)], 0, 0, W, H)
      ctx.globalAlpha = 1
      onProgress?.(Math.min(0.99, (steps + t / TOTAL) / (steps + 1)))
      if (t < TOTAL) requestAnimationFrame(frame); else resolve()
    }
    requestAnimationFrame(frame)
  })
  rec.stop(); stream.getTracks().forEach(tr => tr.stop())
  onProgress?.(1)
  return done
}

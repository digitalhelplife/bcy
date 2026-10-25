import { GARDEN_LAYOUT, ITEMS, PLANTS, SCENES, SHARE, TERMS, asset, plantTexture, type ShareTemplateId } from '../shared/content'
import { codepointLength, footprintOf, hasForbiddenChars } from '../shared/rules'
import type { PaletteId, Placement, PlantId, SceneId } from '../shared/types'
import { PALETTES } from '../shared/content'
import { DEFAULT_CROP, PHOTO_RECTS, drawPhotoCard, type Crop, type LocalPhoto } from './photo'

export const FONT = '"ManusCC0 Sans CJK SC", "PingFang SC", "Noto Sans SC", sans-serif'
const OPENING = { x: 50, y: 250, w: 980, h: 920 }

/** Optional local photo (F13). Never leaves the device; see ./photo.ts. */
export type SharePhoto = { photo: LocalPhoto; crop?: Crop }
export type ShareInput = (
  | { templateId: 'share_scenic'; title: string; sceneId: SceneId }
  | { templateId: 'share_plant'; title: string; plantId: PlantId }
  | { templateId: 'share_garden'; title: string; garden: { paletteId: PaletteId; placements: Placement[] } }
  // F25: one plant's four observation stages, plus the solar term it belongs to.
  | { templateId: 'share_nature'; title: string; plantId: PlantId; observations?: number[] }
) & { photo?: SharePhoto | null; stickers?: PlantId[] }

/**
 * A5 G12: up to 3 plant stickers in the top corners of the picture opening (y 272–550). These slots never overlap
 * the title (y < 254), the caption (y ≥ 1010), any photo card (y ≥ 730) or the fixed footer (y ≥ 1170).
 */
export const STICKER_SLOTS = [{ x: 70, y: 272, r: 66, rot: -0.12 }, { x: 878, y: 272, r: 66, rot: 0.1 }, { x: 70, y: 418, r: 58, rot: 0.08 }] as const
export const MAX_STICKERS = STICKER_SLOTS.length
export const normalizeStickers = (ids: PlantId[] | undefined) => [...new Set(ids ?? [])].filter(id => PLANTS[id]).slice(0, MAX_STICKERS)
async function drawStickers(ctx: CanvasRenderingContext2D, ids: PlantId[]) {
  const imgs = await Promise.all(ids.map(id => loadImage(plantTexture(id, 'mature'))))
  imgs.forEach((img, i) => {
    const sl = STICKER_SLOTS[i]; const cx = sl.x + sl.r, cy = sl.y + sl.r
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(sl.rot)
    ctx.shadowColor = 'rgba(60,50,30,0.25)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 4
    ctx.fillStyle = '#FFFDF6'; ctx.beginPath(); ctx.arc(0, 0, sl.r, 0, Math.PI * 2); ctx.fill()
    ctx.shadowColor = 'transparent'
    ctx.strokeStyle = '#E3D5B8'; ctx.lineWidth = 3; ctx.setLineDash([8, 6]); ctx.beginPath(); ctx.arc(0, 0, sl.r - 7, 0, Math.PI * 2); ctx.stroke()
    const s = Math.min((sl.r * 1.5) / img.width, (sl.r * 1.5) / img.height)
    ctx.drawImage(img, (-img.width * s) / 2, (-img.height * s) / 2, img.width * s, img.height * s)
    ctx.restore()
  })
}

/** A6-A4a: pictures made before S2 must say they come from a trial build, so they are not mistaken for a public release. */
export const TRIAL_MARK = '内测版 · 内容审核中 · 请勿公开传播'
export function trialMark(stage: string | undefined): string | null {
  const st = (stage || 'S0').toUpperCase()
  return st === 'S0' || st === 'S1' ? TRIAL_MARK : null
}
export function validateTitle(title: string): string | null {
  if (codepointLength(title) > 30) return `标题最多 30 个字符，当前 ${codepointLength(title)} 个`
  if (hasForbiddenChars(title)) return '标题包含不支持的控制字符'
  return null
}

export const IMAGE_TIMEOUT_MS = 25_000
const cache = new Map<string, Promise<HTMLImageElement>>()
export function loadImage(path: string): Promise<HTMLImageElement> {
  const url = asset(path)
  if (!cache.has(url)) {
    cache.set(url, new Promise((resolve, reject) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      // A stalled request must not leave the page on “生成中…” forever: give up after IMAGE_TIMEOUT_MS so the user can retry.
      const timer = setTimeout(() => { cache.delete(url); img.src = ''; reject(new Error('网络有点慢，图片还没加载好，请再点一次生成')) }, IMAGE_TIMEOUT_MS)
      img.onload = () => { clearTimeout(timer); img.decode().then(() => resolve(img), () => resolve(img)) }
      img.onerror = () => { clearTimeout(timer); cache.delete(url); reject(new Error(`图片加载失败：${path}`)) }
      img.src = url
    }))
  }
  return cache.get(url)!
}

function cover(ctx: CanvasRenderingContext2D, img: CanvasImageSource & { width: number; height: number }, r: { x: number; y: number; w: number; h: number }, focus = { x: 0.5, y: 0.5 }) {
  const s = Math.max(r.w / img.width, r.h / img.height)
  const sw = r.w / s, sh = r.h / s
  const sx = Math.min(Math.max(0, img.width * focus.x - sw / 2), img.width - sw)
  const sy = Math.min(Math.max(0, img.height * focus.y - sh / 2), img.height - sh)
  ctx.drawImage(img, sx, sy, sw, sh, r.x, r.y, r.w, r.h)
}

/** Wrap plain text into at most `maxLines`, ellipsizing the overflow (input itself is preserved). */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const chars = [...text]; const lines: string[] = []; let cur = ''
  for (const ch of chars) {
    if (ctx.measureText(cur + ch).width > maxW) { lines.push(cur); cur = ch; if (lines.length === maxLines) break } else cur += ch
  }
  if (lines.length < maxLines && cur) lines.push(cur)
  const used = lines.join('').length
  if (used < chars.join('').length && lines.length) {
    let last = lines[lines.length - 1]
    while (last && ctx.measureText(last + '…').width > maxW) last = [...last].slice(0, -1).join('')
    lines[lines.length - 1] = last + '…'
  }
  return lines
}

async function ensureFont() {
  try {
    await Promise.race([document.fonts.load(`48px ${FONT}`, '本草小游记'), new Promise(r => setTimeout(r, 2500))])
  } catch { /* fallback fonts declared in FONT */ }
}

async function drawGarden(ctx: CanvasRenderingContext2D, garden: { paletteId: PaletteId; placements: Placement[] }) {
  const bg = await loadImage(GARDEN_LAYOUT.background)
  const off = document.createElement('canvas'); off.width = 1080; off.height = 1920
  const g = off.getContext('2d')!
  g.drawImage(bg, 0, 0, 1080, 1920)
  if (garden.paletteId === 'warm_wood') { g.fillStyle = 'rgba(255,214,160,0.16)'; g.fillRect(0, 0, 1080, 1920) }
  const sorted = [...garden.placements].sort((a, b) => (a.y + footprintOf(a).h) - (b.y + footprintOf(b).h))
  const { origin, cell } = GARDEN_LAYOUT
  for (const p of sorted) {
    const it = ITEMS[p.itemId]; if (!it) continue
    const img = await loadImage(it.texture)
    const f = footprintOf(p)
    const s = Math.min((f.w * cell.w * 0.96) / img.width, ((f.h + 1.8) * cell.h) / img.height)
    const w = img.width * s, h = img.height * s
    g.drawImage(img, origin.x + (f.x + f.w / 2) * cell.w - w / 2, origin.y + (f.y + f.h) * cell.h - 4 - h, w, h)
  }
  // Crop the courtyard (grid area plus margins) into the opening.
  const src = { x: 60, y: 380, w: 960, h: 1180 }
  const r = OPENING
  const s = Math.max(r.w / src.w, r.h / src.h)
  const sw = r.w / s, sh = r.h / s
  ctx.drawImage(off, src.x + (src.w - sw) / 2, src.y + (src.h - sh) / 2, sw, sh, r.x, r.y, r.w, r.h)
}

const NATURE_STAGES = ['种子', '发芽', '长叶', '开花 / 成熟']

/**
 * F25 nature journal: one plant, its four observation stages, and an optional
 * photo / child's drawing. The page is drawn from content, so it works without
 * a per-plant template asset and keeps the fixed footer + trial mark.
 */
async function drawNature(ctx: CanvasRenderingContext2D, plantId: PlantId, observations: number[] | undefined, hasPhoto: boolean) {
  const { x, y, w, h } = OPENING
  ctx.fillStyle = '#FBF6EA'; ctx.fillRect(x, y, w, h)
  const recorded = new Set((observations ?? []).filter(s => Number.isInteger(s) && s >= 0 && s <= 3))
  const card = { x: 78, y: 286, w: 434, h: 468 }
  ctx.save()
  ctx.shadowColor = 'rgba(60,48,30,0.16)'; ctx.shadowBlur = 14; ctx.shadowOffsetY = 5
  ctx.fillStyle = '#FFFDF6'; ctx.beginPath(); ctx.roundRect(card.x, card.y, card.w, card.h, 24); ctx.fill()
  ctx.restore()
  ctx.strokeStyle = '#E3D5B8'; ctx.lineWidth = 3; ctx.beginPath(); ctx.roundRect(card.x, card.y, card.w, card.h, 24); ctx.stroke()
  const img = await loadImage(plantTexture(plantId, 'codex_detail'))
  const box = { x: card.x + 18, y: card.y + 18, w: card.w - 36, h: 320 }
  const s = Math.min(box.w / img.width, box.h / img.height)
  ctx.drawImage(img, box.x + (box.w - img.width * s) / 2, box.y + (box.h - img.height * s) / 2, img.width * s, img.height * s)
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillStyle = '#3F513F'; ctx.font = `bold 38px ${FONT}`
  ctx.fillText(PLANTS[plantId].name, card.x + card.w / 2, card.y + 386)
  const term = TERMS[PLANTS[plantId].termId]
  ctx.fillStyle = '#7A6E58'; ctx.font = `24px ${FONT}`
  ctx.fillText(`${term?.name ?? ''} · 虚拟苗圃收藏`, card.x + card.w / 2, card.y + 426)

  // Four observation cards on the right page.
  for (let i = 0; i < NATURE_STAGES.length; i++) {
    const cy = 300 + i * 114
    const on = recorded.has(i)
    ctx.save()
    ctx.fillStyle = on ? '#EAF3EE' : '#FFFDF6'
    ctx.beginPath(); ctx.roundRect(546, cy, 424, 100, 20); ctx.fill()
    ctx.strokeStyle = on ? '#6EAAA0' : '#D8C9AC'; ctx.lineWidth = on ? 4 : 3
    if (!on) ctx.setLineDash([10, 8])
    ctx.beginPath(); ctx.roundRect(546, cy, 424, 100, 20); ctx.stroke()
    ctx.restore()
    ctx.beginPath(); ctx.arc(584, cy + 50, 25, 0, Math.PI * 2)
    ctx.fillStyle = on ? '#6EAAA0' : '#F0E7D4'; ctx.fill()
    ctx.fillStyle = on ? '#FFFDF6' : '#8A7A5C'; ctx.font = `bold 24px ${FONT}`
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText(on ? '✓' : String(i + 1), 584, cy + 51)
    ctx.textAlign = 'left'; ctx.fillStyle = '#3F513F'; ctx.font = `bold 28px ${FONT}`
    ctx.fillText(NATURE_STAGES[i], 626, cy + 36)
    ctx.fillStyle = on ? '#4E8A63' : '#9A8F78'; ctx.font = `21px ${FONT}`
    ctx.fillText(on ? '已记录' : '还没有记录', 626, cy + 72)
  }

  // A small note card on the lower left.
  const note = { x: 78, y: 784, w: 454, h: 256 }
  ctx.save()
  ctx.shadowColor = 'rgba(60,48,30,0.12)'; ctx.shadowBlur = 12; ctx.shadowOffsetY = 4
  ctx.fillStyle = '#FFFDF6'; ctx.beginPath(); ctx.roundRect(note.x, note.y, note.w, note.h, 22); ctx.fill()
  ctx.restore()
  ctx.strokeStyle = '#E3D5B8'; ctx.lineWidth = 3; ctx.beginPath(); ctx.roundRect(note.x, note.y, note.w, note.h, 22); ctx.stroke()
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
  ctx.fillStyle = '#7A6E58'; ctx.font = `24px ${FONT}`
  ctx.fillText('我的观察', note.x + 24, note.y + 40)
  ctx.fillStyle = '#3F513F'; ctx.font = `bold 44px ${FONT}`
  ctx.fillText(`${recorded.size} / 4`, note.x + 24, note.y + 100)
  ctx.fillStyle = '#5B5141'; ctx.font = `22px ${FONT}`
  const date = new Date(Date.now() + 8 * 3_600_000).toISOString().slice(0, 10)
  ctx.fillText(`节气：${term?.name ?? ''}`, note.x + 24, note.y + 150)
  ctx.fillText(`日期：${date}`, note.x + 24, note.y + 190)
  ctx.fillStyle = '#8A7A5C'; ctx.font = `19px ${FONT}`
  ctx.fillText('孩子的画也可以贴在这里。', note.x + 24, note.y + 226)

  // Optional child's drawing / photo slot.
  const pr = PHOTO_RECTS.share_nature
  if (!hasPhoto) {
    ctx.save()
    ctx.fillStyle = 'rgba(255,253,246,0.55)'; ctx.beginPath(); ctx.roundRect(pr.x, pr.y, pr.w, pr.h, 24); ctx.fill()
    ctx.strokeStyle = '#D8C9AC'; ctx.lineWidth = 3; ctx.setLineDash([10, 8])
    ctx.beginPath(); ctx.roundRect(pr.x, pr.y, pr.w, pr.h, 24); ctx.stroke()
    ctx.restore()
    ctx.fillStyle = '#9A8F78'; ctx.font = `21px ${FONT}`
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.fillText('贴一张照片 / 孩子的画', pr.x + pr.w / 2, pr.y + pr.h / 2)
  }
}

/** A5 G13: read-only courtyard picture for a shared code (no frame, no title). */
export async function renderGardenSnapshot(garden: { paletteId: PaletteId; placements: Placement[] }): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas'); canvas.width = OPENING.w; canvas.height = OPENING.h
  const ctx = canvas.getContext('2d')!
  ctx.translate(-OPENING.x, -OPENING.y)
  await drawGarden(ctx, garden)
  return canvas
}

export async function renderShare(input: ShareInput): Promise<HTMLCanvasElement> {
  const err = validateTitle(input.title)
  if (err) throw new Error(err)
  await ensureFont()
  const tpl = SHARE.templates[input.templateId as ShareTemplateId]
  const [frame, brand] = await Promise.all([loadImage(tpl.frame), loadImage('brand/brand_wordmark')])
  const canvas = document.createElement('canvas')
  canvas.width = SHARE.canvas.width; canvas.height = SHARE.canvas.height
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#F6F0E4'; ctx.fillRect(0, 0, canvas.width, canvas.height)

  let caption = ''
  if (input.templateId === 'share_scenic') {
    const sc = SCENES[input.sceneId]
    cover(ctx, await loadImage(sc.background), OPENING, input.sceneId === 'dujiangyan' ? { x: 0.42, y: 0.36 } : { x: 0.5, y: 0.45 })
    caption = `${sc.displayName} · ${sc.regionLabel}`
  } else if (input.templateId === 'share_plant') {
    const img = await loadImage(plantTexture(input.plantId, 'codex_detail'))
    ctx.fillStyle = '#FBF6EA'; ctx.fillRect(OPENING.x, OPENING.y, OPENING.w, OPENING.h)
    // With a photo the plant keeps the upper area and the photo strip sits below it (doc 04 §6).
    const box = input.photo ? 520 : 680
    const s = Math.min(box / img.width, box / img.height)
    ctx.drawImage(img, 540 - (img.width * s) / 2, 300, img.width * s, img.height * s)
    caption = `${PLANTS[input.plantId].name} · 虚拟苗圃收藏`
  } else if (input.templateId === 'share_nature') {
    await drawNature(ctx, input.plantId, input.observations, !!input.photo)
    caption = `${PLANTS[input.plantId].name} · 自然笔记`
  } else {
    await drawGarden(ctx, input.garden)
    caption = `${PALETTES[input.garden.paletteId].name} · 我的布置`
  }
  ctx.drawImage(frame, 0, 0, canvas.width, canvas.height)

  // Title: plain text only (never parsed as HTML), up to two lines.
  ctx.fillStyle = '#3F513F'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  const t = SHARE.title
  if (input.title.trim()) {
    ctx.font = `bold 50px ${FONT}`
    let lines = wrap(ctx, input.title, t.w, 1)
    if ([...lines.join('')].length < [...input.title].length) { ctx.font = `bold 38px ${FONT}`; lines = wrap(ctx, input.title, t.w, 2) }
    const lh = lines.length === 1 ? 0 : 46
    lines.forEach((l, i) => ctx.fillText(l, t.x + t.w / 2, t.y + t.h / 2 - lh / 2 + i * lh))
  }
  // Caption strip at the bottom of the opening.
  ctx.font = `30px ${FONT}`
  const cw = ctx.measureText(caption).width + 48
  const capY = input.templateId === 'share_nature' ? 1085 : input.photo && input.templateId === 'share_plant' ? 1040 : 1010
  ctx.fillStyle = 'rgba(246,240,228,0.9)'; ctx.beginPath(); ctx.roundRect(540 - cw / 2, capY, cw, 52, 26); ctx.fill()
  ctx.fillStyle = '#425B46'; ctx.fillText(caption, 540, capY + 27)
  const stickers = normalizeStickers(input.stickers)
  // Nature pages already carry four observation cards; plant stickers would collide with them.
  if (stickers.length && input.templateId !== 'share_nature') await drawStickers(ctx, stickers)
  if (input.photo) drawPhotoCard(ctx, input.photo.photo, PHOTO_RECTS[input.templateId], input.photo.crop ?? DEFAULT_CROP, FONT)

  drawFixedFooter(ctx, brand, input.templateId === 'share_plant' || input.templateId === 'share_nature' ? [SHARE.plantSafety] : [])
  return canvas
}

/** Fixed, non-removable footer: wordmark + originality notice (+ extra lines) + the S0/S1 trial mark. Shared by every export. */
export function drawFixedFooter(ctx: CanvasRenderingContext2D, brand: HTMLImageElement, extra: string[] = []) {
  const f = SHARE.footer
  const bh = 104, bw = (brand.width / brand.height) * bh
  ctx.drawImage(brand, f.x + 6, f.y + (f.h - bh) / 2, bw, bh)
  ctx.textAlign = 'left'; ctx.fillStyle = '#5B5141'; ctx.textBaseline = 'middle'
  const lines: string[] = [...SHARE.fixed, ...extra]
  ctx.font = `${lines.length > 2 ? 24 : 27}px ${FONT}`
  const tx = f.x + bw + 26, gap = lines.length > 2 ? 36 : 42
  lines.forEach((l, i) => ctx.fillText(l, tx, f.y + f.h / 2 - ((lines.length - 1) * gap) / 2 + i * gap))
  const mark = trialMark(import.meta.env.VITE_RELEASE_STAGE)
  if (mark) {
    // Below the fixed footer (ends at y 1315) and above the frame edge; never covers title, photo or footer.
    ctx.font = `22px ${FONT}`; ctx.textAlign = 'center'
    const mw = ctx.measureText(mark).width + 36
    ctx.fillStyle = 'rgba(138,90,40,0.88)'; ctx.beginPath(); ctx.roundRect(540 - mw / 2, 1338, mw, 38, 19); ctx.fill()
    ctx.fillStyle = '#FFF8EC'; ctx.fillText(mark, 540, 1358)
  }
}
export { cover as coverImage, wrap as wrapText, ensureFont }

export function canvasToBlob(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try { c.toBlob(b => (b ? resolve(b) : reject(new Error('图片生成失败'))), 'image/png') } catch { reject(new Error('图片受跨域限制，无法导出')) }
  })
}

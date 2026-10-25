// F13 local photo for share images (PRD F13, doc 05 §8.4).
// Everything here is in-memory only: no network, no localStorage/sessionStorage, no telemetry, no Nakama state.
// The exported PNG is re-encoded from a fresh canvas, so no EXIF (incl. GPS) from the source file survives.
import type { ShareTemplateId } from '../shared/content'

export type Rect = { x: number; y: number; w: number; h: number }
/** Photo card rects on the 1080×1440 canvas (doc 04 §6). Rounded 24, 8 px paper border. */
export const PHOTO_RECTS: Record<ShareTemplateId, Rect> = {
  share_scenic: { x: 696, y: 730, w: 264, h: 264 },
  share_plant: { x: 96, y: 844, w: 888, h: 170 },
  share_garden: { x: 120, y: 730, w: 300, h: 220 },
  // F25: optional child's drawing / family photo on the right page.
  share_nature: { x: 620, y: 780, w: 320, h: 260 },
}
export const MAX_EDGE = 4096
export const PHOTO_NOTICE = '照片只在你的手机里合成，不会上传。公开发布前，请注意保护孩子的面部和隐私。'

export type LocalPhoto = { source: HTMLCanvasElement | ImageBitmap; width: number; height: number; release: () => void }
/** zoom ≥ 1 (1 = cover); ox/oy ∈ [-1, 1] = fraction of the available pan range. */
export type Crop = { zoom: number; ox: number; oy: number }
export const DEFAULT_CROP: Crop = { zoom: 1, ox: 0, oy: 0 }

export class PhotoError extends Error {}

const isHeic = (f: File) => /heic|heif/i.test(f.type) || /\.(heic|heif)$/i.test(f.name)

async function decode(file: File): Promise<{ img: CanvasImageSource; w: number; h: number; close: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
      return { img: bmp, w: bmp.width, h: bmp.height, close: () => bmp.close() }
    } catch { /* fall back to <img> */ }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.decoding = 'async'
    await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(new Error('decode')); img.src = url })
    if (!img.naturalWidth) throw new Error('decode')
    return { img, w: img.naturalWidth, h: img.naturalHeight, close: () => { img.src = '' } }
  } finally { URL.revokeObjectURL(url) }
}

/** Decode a user-picked file locally; downsample so the long edge ≤ 4096 px (memory guard). */
export async function loadLocalPhoto(file: File): Promise<LocalPhoto> {
  if (!file.type.startsWith('image/') && !isHeic(file)) throw new PhotoError('请选择一张图片')
  let d
  try { d = await decode(file) } catch {
    throw new PhotoError(isHeic(file)
      ? '这个浏览器无法读取 HEIC 照片。请在相册里把照片另存为 JPEG 后再选，或直接导出不带照片的游记。'
      : '这张照片读取失败，请换一张试试，或直接导出不带照片的游记。')
  }
  const k = Math.min(1, MAX_EDGE / Math.max(d.w, d.h))
  if (k === 1 && d.img instanceof ImageBitmap) {
    const bmp = d.img
    return { source: bmp, width: d.w, height: d.h, release: () => bmp.close() }
  }
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(d.w * k)); c.height = Math.max(1, Math.round(d.h * k))
  const g = c.getContext('2d')
  if (!g) { d.close(); throw new PhotoError('照片太大，手机内存不足，请换一张较小的照片') }
  g.imageSmoothingQuality = 'high'
  g.drawImage(d.img, 0, 0, c.width, c.height)
  d.close()
  return { source: c, width: c.width, height: c.height, release: () => { c.width = 0; c.height = 0 } }
}

/** Geometry of the photo inside rect r for a crop (shared by preview and export so they match exactly). */
export function placement(photo: { width: number; height: number }, r: { w: number; h: number }, crop: Crop) {
  const s = Math.max(r.w / photo.width, r.h / photo.height) * Math.max(1, crop.zoom)
  const w = photo.width * s, h = photo.height * s
  const rangeX = (w - r.w) / 2, rangeY = (h - r.h) / 2
  const ox = Math.max(-1, Math.min(1, crop.ox)), oy = Math.max(-1, Math.min(1, crop.oy))
  return { w, h, x: (r.w - w) / 2 + ox * rangeX, y: (r.h - h) / 2 + oy * rangeY, rangeX, rangeY }
}

function roundRect(ctx: CanvasRenderingContext2D, r: Rect, radius: number) {
  ctx.beginPath(); ctx.roundRect(r.x, r.y, r.w, r.h, radius)
}

/** Draw the polaroid-style "我的照片" card: shadow, paper border, rounded clip, label. */
export function drawPhotoCard(ctx: CanvasRenderingContext2D, photo: LocalPhoto, r: Rect, crop: Crop, font: string) {
  const b = 8
  const outer = { x: r.x - b, y: r.y - b, w: r.w + 2 * b, h: r.h + 2 * b }
  ctx.save()
  ctx.shadowColor = 'rgba(60,48,30,0.28)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 6
  ctx.fillStyle = '#FBF6EA'; roundRect(ctx, outer, 24 + b); ctx.fill()
  ctx.restore()
  ctx.save()
  roundRect(ctx, r, 24); ctx.clip()
  const p = placement(photo, r, crop)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(photo.source, r.x + p.x, r.y + p.y, p.w, p.h)
  ctx.restore()
  ctx.save()
  ctx.font = `22px ${font}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'
  const label = '我的照片'; const lw = ctx.measureText(label).width + 24
  ctx.fillStyle = 'rgba(251,246,234,0.92)'; roundRect(ctx, { x: r.x + 12, y: r.y + 12, w: lw, h: 36 }, 18); ctx.fill()
  ctx.fillStyle = '#5B5141'; ctx.fillText(label, r.x + 24, r.y + 30)
  ctx.restore()
}

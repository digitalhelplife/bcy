import { useEffect, useRef, useState } from 'react'
import type { ShareTemplateId } from '../../shared/content'
import { DEFAULT_CROP, PHOTO_NOTICE, PHOTO_RECTS, PhotoError, loadLocalPhoto, placement, type Crop, type LocalPhoto } from '../../share/photo'
import { Btn, type ConfirmOpts } from '../common'

type Props = {
  templateId: ShareTemplateId
  photo: LocalPhoto | null
  crop: Crop
  onPhoto: (p: LocalPhoto | null) => void
  onCrop: (c: Crop) => void
  confirm: (opts: ConfirmOpts) => void
  toast: (msg: string) => void
}

/** F13 photo picker + cropper. The photo stays in component memory only (doc 05 §8.4). */
export function PhotoComposer({ templateId, photo, crop, onPhoto, onCrop, confirm, toast }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const noticed = useRef(false)
  const [loading, setLoading] = useState(false)
  const r = PHOTO_RECTS[templateId]

  // Preview uses the exact same geometry as the export.
  useEffect(() => {
    const c = canvasRef.current; if (!c || !photo) return
    const W = c.clientWidth || 300, dpr = Math.min(2, window.devicePixelRatio || 1)
    c.width = Math.round(W * dpr); c.height = Math.round((W * r.h / r.w) * dpr)
    const g = c.getContext('2d')!; const k = c.width / r.w
    const p = placement(photo, r, crop)
    g.clearRect(0, 0, c.width, c.height)
    g.drawImage(photo.source, p.x * k, p.y * k, p.w * k, p.h * k)
  }, [photo, crop, r])

  // The file picker must open synchronously inside a tap handler (iOS Safari drops async gestures).
  const choose = () => {
    if (noticed.current) { fileRef.current?.click(); return }
    confirm({ title: '添加我的照片', body: PHOTO_NOTICE, actions: [
      { label: '先不加', kind: 'ghost' },
      { label: '选择照片', kind: 'primary', onClick: () => { noticed.current = true; fileRef.current?.click() } },
    ] })
  }
  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; e.target.value = ''
    if (!f) return
    setLoading(true)
    try {
      const p = await loadLocalPhoto(f)
      onPhoto(p); onCrop(DEFAULT_CROP)
    } catch (err) { toast(err instanceof PhotoError ? err.message : '照片读取失败，请换一张试试') } finally { setLoading(false) }
  }

  // Pointer gestures: one finger pans, two fingers pinch-zoom.
  const pts = useRef(new Map<number, { x: number; y: number }>())
  const start = useRef<{ crop: Crop; dist: number; cx: number; cy: number } | null>(null)
  const snapshot = (c: Crop) => {
    const a = [...pts.current.values()]
    const cx = a.reduce((s, p) => s + p.x, 0) / a.length, cy = a.reduce((s, p) => s + p.y, 0) / a.length
    const dist = a.length > 1 ? Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) : 0
    start.current = { crop: c, dist, cx, cy }
  }
  const down = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId)
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY }); snapshot(crop)
  }
  const move = (e: React.PointerEvent) => {
    if (!photo || !pts.current.has(e.pointerId) || !start.current) return
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const a = [...pts.current.values()]
    const st = start.current
    const cx = a.reduce((s, p) => s + p.x, 0) / a.length, cy = a.reduce((s, p) => s + p.y, 0) / a.length
    let zoom = st.crop.zoom
    if (a.length > 1 && st.dist > 0) zoom = Math.min(4, Math.max(1, st.crop.zoom * Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) / st.dist))
    const el = canvasRef.current!; const k = el.clientWidth / r.w
    const p = placement(photo, r, { ...st.crop, zoom })
    const nx = p.rangeX > 0 ? st.crop.ox + ((cx - st.cx) / k) / p.rangeX : 0
    const ny = p.rangeY > 0 ? st.crop.oy + ((cy - st.cy) / k) / p.rangeY : 0
    onCrop({ zoom, ox: Math.max(-1, Math.min(1, nx)), oy: Math.max(-1, Math.min(1, ny)) })
  }
  const up = (e: React.PointerEvent) => { pts.current.delete(e.pointerId); if (pts.current.size) snapshot(crop); else start.current = null }

  return (
    <div className="photo-composer" data-testid="photo-composer">
      <input ref={fileRef} type="file" accept="image/*,.heic,.heif" hidden onChange={onFile} data-testid="photo-input" />
      {!photo ? (
        <div className="row">
          <Btn small kind="ghost" onClick={choose} disabled={loading} testId="photo-add">{loading ? '读取中…' : '＋ 添加我的照片（可选）'}</Btn>
        </div>
      ) : (
        <>
          <div className="photo-crop" style={{ aspectRatio: `${r.w} / ${r.h}` }}>
            <canvas ref={canvasRef} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} data-testid="photo-crop" />
          </div>
          <label className="field photo-zoom">
            <span>缩放（拖动照片调整位置，双指可缩放）</span>
            <input type="range" min={1} max={4} step={0.01} value={crop.zoom} onChange={e => onCrop({ ...crop, zoom: Number(e.target.value) })} data-testid="photo-zoom" />
          </label>
          <div className="row">
            <Btn small kind="ghost" onClick={() => onCrop(DEFAULT_CROP)}>重置</Btn>
            <Btn small kind="ghost" onClick={choose}>换一张</Btn>
            <Btn small kind="ghost" onClick={() => onPhoto(null)} testId="photo-remove">移除照片</Btn>
          </div>
          <p className="tiny muted">{PHOTO_NOTICE}</p>
        </>
      )}
    </div>
  )
}

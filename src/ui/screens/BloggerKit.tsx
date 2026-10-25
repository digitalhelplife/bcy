import { useEffect, useState } from 'react'
import { LEVELS, SCENES, SCENE_ORDER } from '../../shared/content'
import { activeEvent } from '../../shared/events'
import type { SceneId } from '../../shared/types'
import { DEFAULT_ROUTE, recordGardenVideo, renderCarousel, videoSupport } from '../../share/blogger'
import { canvasToBlob } from '../../share/exportShare'
import { Btn, errorText, useApp, useSnap } from '../common'
import { readTicks } from './FieldChecklist'

/** A6-B3: blogger tools on the journal page. Local rendering only; the player saves and posts by hand. */
export function BloggerKit() {
  const { client, toast } = useApp()
  const s = useSnap().state!
  const [busy, setBusy] = useState<null | 'carousel' | 'video'>(null)
  const [pics, setPics] = useState<{ name: string; url: string }[]>([])
  const [video, setVideo] = useState<{ url: string; ext: string } | null>(null)
  const [pct, setPct] = useState(0)
  useEffect(() => () => { pics.forEach(p => URL.revokeObjectURL(p.url)); if (video) URL.revokeObjectURL(video.url) }, [pics, video])
  const lastScene: SceneId = [...SCENE_ORDER].reverse().find(id => [SCENES[id].findLevel, SCENES[id].puzzleLevel].some(l => s.levels[l].firstCompletedAtMs !== null)) ?? 'dujiangyan'
  const ev = activeEvent(client.serverNow())
  const route = { title: ev ? ev.journalTitle : '成都周边带娃路线', stops: ev ? ev.route : DEFAULT_ROUTE, ticked: new Set(Object.keys(readTicks())) }
  const makeCarousel = async () => {
    setBusy('carousel')
    try {
      const out = await renderCarousel({ sceneId: lastScene, plantId: s.discoveredPlantIds[0] ?? null, garden: s.garden, route })
      const urls = await Promise.all(out.map(async o => ({ name: o.name, url: URL.createObjectURL(await canvasToBlob(o.canvas)) })))
      setPics(urls); client.track('blogger_carousel', { n: urls.length })
    } catch (e) { toast(errorText(e)) } finally { setBusy(null) }
  }
  const makeVideo = async () => {
    if (!s.garden.placements.length) { toast('小院还是空的，先摆几件并保存'); return }
    setBusy('video'); setPct(0)
    try {
      const blob = await recordGardenVideo(s.garden, '我布置的川西小院', setPct)
      setVideo({ url: URL.createObjectURL(blob), ext: blob.type.includes('mp4') ? 'mp4' : 'webm' }); client.track('blogger_video', {})
    } catch (e) { toast(errorText(e)) } finally { setBusy(null) }
  }
  const canVideo = videoSupport() !== null
  return (
    <section className="card col" data-testid="blogger-kit">
      <h3>博主工具</h3>
      <p className="tiny muted">一次生成 4 张 3:4 组图（景点 · 植物 · 小院 · 路线攻略卡），适合直接发图文笔记。图片在手机上生成，不会上传，也不会自动发布。路线卡会带上你在“现场寻宝清单”里勾过的地方。</p>
      <Btn small disabled={!!busy} onClick={makeCarousel} testId="carousel">{busy === 'carousel' ? '正在生成…' : '生成 4 张轮播组图'}</Btn>
      {pics.length > 0 && (
        <div className="carousel-grid" data-testid="carousel-out">
          {pics.map(p => <a key={p.name} href={p.url} download={`本草小游记-${p.name}.png`}><img src={p.url} alt={p.name} /><span className="tiny">{p.name}</span></a>)}
          <p className="tiny muted">长按图片保存到相册；在小红书内打开时，点图片后长按保存。</p>
        </div>
      )}
      {canVideo && <Btn small kind="soft" disabled={!!busy} onClick={makeVideo} testId="garden-video">{busy === 'video' ? `正在录制 ${Math.round(pct * 100)}%…` : '录一段 6 秒小院动画'}</Btn>}
      {video && <figure className="video-out"><video src={video.url} controls playsInline muted loop /><a className="tiny" href={video.url} download={`本草小游记-小院.${video.ext}`}>保存视频</a></figure>}
      {!canVideo && <p className="tiny muted">当前浏览器不支持录制动画，可以用组图代替。</p>}
      <p className="tiny muted">关卡：{Object.values(LEVELS).filter(l => s.levels[l.levelId].firstCompletedAtMs !== null).length}/6 已完成 · 组图第 1 张使用最近完成的景点「{SCENES[lastScene].displayName}」。</p>
    </section>
  )
}

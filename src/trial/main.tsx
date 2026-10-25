// A6-A1a 离线试玩版: Dujiangyan find level + a scenic journal picture. No login, no network calls, no save data.
// Packaged as a standalone zip for platforms that host small interactive tools; see 附录 A7 for the rule checklist.
import { StrictMode, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../styles.css'
import { COMPLIANCE, SCENES, SHARE, asset } from '../shared/content'
import { Bridge, clearRunCaches } from '../phaser/bridge'
import { PhaserHost } from '../phaser/PhaserHost'
import { FindScene } from '../phaser/scenes/FindScene'
import { canvasToBlob, renderShare } from '../share/exportShare'

const sc = SCENES.dujiangyan
function Trial() {
  const [phase, setPhase] = useState<'intro' | 'play' | 'done'>('intro')
  const [found, setFound] = useState(0)
  const [url, setUrl] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const bridge = useMemo(() => new Bridge(), [])
  useEffect(() => {
    clearRunCaches() // nothing from a previous visit is kept
    const offs = [
      bridge.on('explore.progress', e => setFound(e.found.length)),
      bridge.on('explore.complete', () => { clearRunCaches(); setPhase('done') }),
    ]
    return () => { offs.forEach(f => f()); bridge.clear() }
  }, [bridge])
  useEffect(() => {
    if (phase !== 'done') return
    renderShare({ templateId: 'share_scenic', title: SHARE.templates.share_scenic.defaultTitle, sceneId: 'dujiangyan' })
      .then(canvasToBlob).then(b => setUrl(URL.createObjectURL(b))).catch(e => setErr(String((e as Error).message || e)))
  }, [phase])
  const data = useMemo(() => ({ bridge, sceneId: 'dujiangyan', runId: 'trial', cacheKey: 'bcy.run.trial', instanceId: 'trial', parentMode: false }), [bridge])
  return (
    <div className="screen boot trial">
      {phase !== 'play' && <img className="boot-logo" src={asset('brand/brand_wordmark')} alt="本草小游记·成都篇" />}
      {phase === 'intro' && (
        <section className="card col">
          <h3>{sc.displayName} · 离线试玩</h3>
          <p className="tiny">在立体地图上找到 {sc.targets.length} 个地方：{sc.targets.map(t => t.label).join('、')}。完成后生成一张游记图。</p>
          <p className="tiny muted">试玩版不需要登录、不联网、不保存任何记录。完整版还有 24 种植物、苗圃种植和川西小院。</p>
          <button className="btn btn-primary" onClick={() => setPhase('play')} data-testid="trial-start">开始找一找</button>
        </section>
      )}
      {phase === 'play' && (
        <div className="trial-play">
          <p className="tiny center">已找到 {found}/{sc.targets.length} · 雾可以用手指拨开</p>
          <PhaserHost scene={FindScene} sceneKey="find" data={data} className="phaser-host trial-host" />
        </div>
      )}
      {phase === 'done' && (
        <section className="card col" data-testid="trial-done">
          <h3>都找到啦！</h3>
          {url ? <img src={url} alt="都江堰游记" className="trial-share" /> : err ? <p className="tiny err">{err}</p> : <p className="tiny">正在生成游记…</p>}
          {url && <p className="tiny muted">长按图片保存到相册。</p>}
          <button className="btn btn-soft" onClick={() => { setFound(0); setUrl(null); setPhase('play') }}>再玩一次</button>
        </section>
      )}
      <p className="tiny muted">游戏画面·成都主题原创改编 · 非景区官方产品</p>
      <p className="tiny muted health">{COMPLIANCE.healthGameAdvice}</p>
    </div>
  )
}
createRoot(document.getElementById('root')!).render(<StrictMode><Trial /></StrictMode>)

import { useEffect, useMemo, useRef, useState } from 'react'
import { ITEMS, LEVELS, LEVEL_IDS, PALETTES, PLANTS, SCENES, STORIES, puzzlePieces } from '../../shared/content'
import type { FinishResult, Grant, LevelId, Proof, RunSummary } from '../../shared/types'
import { BusinessError, UnknownOutcomeError } from '../../net/gameClient'
import { Bridge, clearRunCaches, runCacheKey } from '../../phaser/bridge'
import { PhaserHost } from '../../phaser/PhaserHost'
import { FindScene } from '../../phaser/scenes/FindScene'
import { PuzzleScene } from '../../phaser/scenes/PuzzleScene'
import { Btn, Img, errorText, useApp, useSnap } from '../common'
import { TripCardLink } from './TripCard'
import { readParentMode, useParentMode } from '../prefs'
import { play, speak, stopSpeaking } from '../sfx'
import { ParentTipsCard } from './ParentTips'
import { sceneCallText } from '../voiceTexts'
import { challengeStart, finishChallenge, fmtSecs } from '../challenge'
import { AMBIENT_FOR, startAmbient } from '../ambient'

export function ExploreScreen({ run }: { run: RunSummary }) {
  const { client, go, confirm, toast } = useApp()
  const snap = useSnap()
  const lv = LEVELS[run.levelId]; const sc = SCENES[lv.sceneId]
  const bridge = useMemo(() => new Bridge(), [])
  const instanceId = useMemo(() => crypto.randomUUID(), [])
  const [found, setFound] = useState<string[]>([])
  const [placed, setPlaced] = useState(0)
  const [hint, setHint] = useState<string | null>(null)
  const [idle, setIdle] = useState(false)
  // Fixed for this level instance (not hot-switched while playing).
  const [parentMode] = useState(() => readParentMode())
  const [canvasError, setCanvasError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const lastPlaced = useRef(0)
  const mountedAt = useRef(Date.now()) // restored runs replay progress right after mount: no sound for that
  const total = lv.kind === 'find' ? sc.targets.length : puzzlePieces(run.levelId).length
  const expired = client.serverNow() >= run.expiresAtMs
  const [challengeAt] = useState(() => (lv.kind === 'find' ? challengeStart(run.runId) : null))
  const [tick, setTick] = useState(0)
  useEffect(() => { if (challengeAt === null) return; const t = setInterval(() => setTick(x => x + 1), 100); return () => clearInterval(t) }, [challengeAt])

  useEffect(() => {
    const offs = [
      bridge.on('explore.progress', e => {
        if (e.sceneInstanceId !== instanceId || e.runId !== run.runId) return
        if (e.placed > lastPlaced.current && Date.now() - mountedAt.current > 800) play(lv.kind === 'find' ? 'found' : 'snap')
        lastPlaced.current = e.placed
        setFound(e.found); setPlaced(e.placed)
      }),
      bridge.on('explore.hint', e => { if (e.sceneInstanceId === instanceId) { setHint(e.text); play('miss') } }),
      bridge.on('canvas.error', e => { if (e.sceneInstanceId === instanceId) setCanvasError(e.message) }),
      bridge.on('explore.complete', e => {
        if (e.sceneInstanceId !== instanceId || e.runId !== run.runId) return
        play('complete'); stopSpeaking()
        finishChallenge(run.runId, run.levelId, Date.now())
        go({ name: 'result', run, proof: e.proof })
      }),
    ]
    return () => { offs.forEach(f => f()) }
  }, [bridge, instanceId, run, go])
  // A6-C1: optional ambient bed for this scene (opt-in switch in Settings).
  useEffect(() => startAmbient(AMBIENT_FOR[lv.sceneId]), [lv.sceneId])
  // A5 G8: parent mode reads the three targets aloud once at the start of a find level.
  useEffect(() => {
    if (lv.kind !== 'find' || !parentMode) return
    const t = setTimeout(() => speak(sceneCallText(sc.sceneId)), 900)
    return () => { clearTimeout(t); stopSpeaking() }
  }, [lv.kind, parentMode, sc])
  useEffect(() => { if (!hint) return; const t = setTimeout(() => setHint(null), 2200); return () => clearTimeout(t) }, [hint])
  // F14: hint button is always shown in parent mode; otherwise it appears after 20 s without a new find.
  useEffect(() => { setIdle(false); if (lv.kind !== 'find' || placed >= total) return; const t = setTimeout(() => setIdle(true), 20000); return () => clearTimeout(t) }, [placed, total, lv.kind])

  const leave = () => confirm({
    title: '要离开这次探索吗？', body: '暂时离开会保留进度，回到地图可继续；放弃则本次不发放奖励。',
    actions: [
      { label: '继续探索', kind: 'ghost' },
      { label: '暂时离开', kind: 'primary', onClick: () => go({ name: 'map' }) },
      { label: '放弃本次探索', kind: 'danger', onClick: async () => { try { await client.runCancel(run.runId); client.track('run_cancel', { levelId: run.levelId }); clearRunCaches(); go({ name: 'map' }) } catch (e) { toast(errorText(e)) } } },
    ],
  })

  const data = useMemo(() => {
    const cacheKey = runCacheKey(snap.userId ?? 'anon', run.runId, run.configVersion)
    return lv.kind === 'find'
      ? { bridge, sceneId: lv.sceneId, runId: run.runId, cacheKey, instanceId, parentMode }
      : { bridge, levelId: run.levelId, runId: run.runId, shuffleSeed: run.shuffleSeed, cacheKey, instanceId }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.runId, reloadKey])

  if (expired) {
    return (
      <div className="screen center-screen">
        <h2>这次探索已过期</h2>
        <p className="muted">探索有效期为 30 分钟。请回到地图重新出发，本次不发放奖励。</p>
        <Btn onClick={() => go({ name: 'map' })}>回到地图</Btn>
      </div>
    )
  }

  return (
    <div className="screen explore-screen">
      <div className="explore-top">
        <button className="icon-btn" aria-label="离开" onClick={leave}><Img path="ui/ui_back" /></button>
        <div className="explore-title">
          <b>{sc.displayName} · {lv.name}</b>
          <span className="tiny">{run.route === 'plant' ? '植物路线' : '景点装饰路线'} · {placed}/{total}{parentMode ? ' · 亲子模式' : ''}{challengeAt !== null ? ` · 挑战 ${fmtSecs(Date.now() - challengeAt + tick * 0)}` : ''}</span>
        </div>
        {lv.kind === 'find' && challengeAt === null && (parentMode || idle) && (
          <button className="btn small hint-btn" data-testid="find-hint" onClick={() => { setIdle(false); bridge.emit('find.cmd', { sceneInstanceId: instanceId, kind: 'reveal' }) }}>提示</button>
        )}
      </div>
      {lv.kind === 'find' && (
        <div className="target-strip">
          {sc.targets.map(t => (
            <div key={t.targetId} className={`target-chip${found.includes(t.targetId) ? ' found' : ''}`}>
              <span className="target-name">{found.includes(t.targetId) ? '✓ ' : ''}{t.label}{t.fictional ? '（原创）' : ''}</span>
              {challengeAt === null && <span className="target-hint">{t.hint}</span>}
            </div>
          ))}
        </div>
      )}
      <div className="stage">
        <PhaserHost key={reloadKey} scene={lv.kind === 'find' ? FindScene : PuzzleScene} sceneKey={lv.kind} data={data} scale="envelop" panZoom />
        {hint && <div className="hint-toast">{hint}</div>}
        {canvasError && (
          <div className="stage-error">
            <p>{canvasError}</p>
            <Btn small onClick={() => { setCanvasError(null); setReloadKey(k => k + 1) }}>重试加载</Btn>
          </div>
        )}
      </div>
      <div className="tiny muted foot-note">{sc.factNote}</div>
    </div>
  )
}

export function ResultScreen({ run, proof, replay }: { run: RunSummary; proof: unknown | null; replay?: FinishResult }) {
  const { client, go } = useApp()
  const [result, setResult] = useState<FinishResult | null>(replay ?? null)
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(!replay)
  const sent = useRef(false)
  const tracked = useRef(false)
  const lv = LEVELS[run.levelId]
  const snap = useSnap()
  const [parentMode] = useParentMode()
  // F12: offer the trip card once both levels of this scene are completed.
  const sceneDone = !!result && !!snap.state && [SCENES[lv.sceneId].findLevel, SCENES[lv.sceneId].puzzleLevel].every(l => snap.state!.levels[l].firstCompletedAtMs !== null)

  const submit = async (mode: 'first' | 'retry' | 'query') => {
    setBusy(true); setError(null)
    try {
      if (mode === 'first') setResult((await client.runFinish(run.runId, proof as Proof)).result)
      else if (mode === 'retry') setResult((await client.retryPending<{ state: never; result: FinishResult }>()).result)
      else {
        const st = await client.queryPending()
        if (st.status === 'FOUND') setResult(st.result as FinishResult)
        else {
          // Not received by the server: the run can still be read and finished with a fresh request.
          const r = await client.runGet(run.runId)
          if (r.run.finishResult) setResult(r.run.finishResult)
          else setResult((await client.runFinish(run.runId, proof as Proof)).result)
        }
      }
      clearRunCaches()
    } catch (e) { setError(e) } finally { setBusy(false) }
  }
  useEffect(() => { if (!replay && !sent.current) { sent.current = true; void submit('first') } // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (!result || tracked.current) return
    tracked.current = true
    client.track('run_finish', { levelId: run.levelId, rewardMode: result.rewardMode })
  }, [client, result, run.levelId])

  if (busy) return <div className="screen center-screen"><div className="spinner" /><p>正在确认奖励…</p></div>
  if (error || !result) {
    const unknown = error instanceof UnknownOutcomeError
    const code = error instanceof BusinessError ? error.error.code : null
    const terminal = code === 'RUN_EXPIRED' || code === 'RUN_CANCELLED' || code === 'RUN_NOT_FOUND' || code === 'CONFIG_EXPIRED' || code === 'INVALID_PROOF'
    return (
      <div className="screen center-screen">
        <h2>{unknown ? '奖励还没确认' : '没能完成结算'}</h2>
        <p className="muted">{errorText(error)}</p>
        <div className="col">
          {unknown && <Btn onClick={() => submit('retry')}>重试确认</Btn>}
          {unknown && <Btn kind="ghost" onClick={() => submit('query')}>查询结果</Btn>}
          {!unknown && !terminal && <Btn onClick={() => submit('first')}>重试</Btn>}
          <Btn kind="ghost" onClick={() => go({ name: 'map' })}>回到地图</Btn>
        </div>
      </div>
    )
  }
  const plant = result.newlyDiscoveredPlantId
  return (
    <div className="screen result-screen">
      <Img path="effects/fx_sparkle" className="result-glow" />
      {(plant || result.rewardMode === 'route_first') && <Celebrate />}
      <h2>{lv.name} 完成！</h2>
      {(() => { const c = finishChallenge(run.runId, run.levelId, Date.now()); return c ? <p className="badge challenge-result" data-testid="challenge-result">挑战用时 {fmtSecs(c.ms)}{c.newBest ? ' · 新的个人最佳！' : c.best !== null ? ` · 个人最佳 ${fmtSecs(c.best)}` : ''}</p> : null })()}
      {lv.kind === 'find' && <p className="scene-fact">这次认识了：{SCENES[lv.sceneId].targets.map(t => t.label).join(' · ')}</p>}
      {plant && (
        <div className="result-card discover">
          <Img path={`plants/plant_${plant}_mature`} alt={PLANTS[plant].name} eager />
          <div><b>图鉴新发现：{PLANTS[plant].name}</b><div className="tiny muted">虚拟苗圃收藏，不代表景区野生分布</div></div>
        </div>
      )}
      <div className="result-card">
        <b>{result.rewardMode === 'route_first' ? '路线首次奖励' : result.rewardMode === 'repeat' ? '重复游玩奖励' : '本次无奖励'}</b>
        <div className="grants">
          {result.grants.map(g => <span key={g.itemId} className="grant big"><Img path={ITEMS[g.itemId].icon} eager />{ITEMS[g.itemId].name} ×{g.quantity}</span>)}
          {result.reason === 'DAILY_REPEAT_LIMIT' && <span className="muted">今日重复奖励已达 3 次，明天（北京时间零点后）恢复。仍可继续游玩。</span>}
        </div>
      </div>
      {(result.newlyUnlockedSceneIds.length > 0 || result.newlyUnlockedStoryIds.length > 0 || result.newlyUnlockedPaletteIds.length > 0) && (
        <div className="result-card">
          {result.newlyUnlockedSceneIds.map(id => <div key={id}>新景点开放：<b>{SCENES[id].displayName}</b></div>)}
          {result.newlyUnlockedPaletteIds.map(id => <div key={id}>小院新配色：<b>{PALETTES[id].name}</b></div>)}
          {result.newlyUnlockedStoryIds.map(id => <div key={id}>解锁故事：<b>{STORIES[id]?.title}</b><p className="tiny">{STORIES[id]?.text}</p></div>)}
        </div>
      )}
      <NextSteps levelId={run.levelId} grants={result.grants} />
      {parentMode && <ParentTipsCard levelId={run.levelId} />}
      {sceneDone && <TripCardLink sceneId={lv.sceneId} />}
      <div className="row">
        <Btn onClick={() => go({ name: 'garden' })}>去小院</Btn>
        <Btn kind="ghost" onClick={() => go({ name: 'map' })}>继续游览</Btn>
      </div>
    </div>
  )
}

/** A6-B6: tell the player what this result is for, instead of leaving the screen half empty. */
function NextSteps({ levelId, grants }: { levelId: LevelId; grants: Grant[] }) {
  const s = useSnap().state!
  const lv = LEVELS[levelId]
  const seed = grants.find(g => ITEMS[g.itemId]?.kind === 'seed')
  const decor = grants.find(g => ITEMS[g.itemId]?.kind === 'decor')
  const sibling = LEVEL_IDS.find(id => id !== levelId && LEVELS[id].sceneId === lv.sceneId)
  const tips: string[] = []
  if (seed) tips.push(`去小院把「${ITEMS[seed.itemId].name}」种进空着的种植槽，5 分钟后就能收获。`)
  if (decor) tips.push(`「${ITEMS[decor.itemId].name}」已放进背包，打开小院点“布置小院”摆上去。`)
  if (sibling && !s.levels[sibling]?.firstCompletedAtMs) tips.push(`同一景点还有「${LEVELS[sibling].name}」，完成两关会开放下一个景点。`)
  if (!tips.length) tips.push('去小院照料一下成熟的植物，或者在“游记”里做一张今天的纪念图。')
  return (
    <div className="result-card next-steps" data-testid="next-steps">
      <b>接下来可以做</b>
      <ul>{tips.slice(0, 2).map(t => <li key={t}>{t}</li>)}</ul>
    </div>
  )
}
/** A5 G9: light petal burst for first clears / new discoveries. CSS only; respects reduced motion. */
function Celebrate() {
  useEffect(() => { play('claim') }, [])
  return (
    <div className="celebrate" aria-hidden="true">
      {Array.from({ length: 14 }, (_, i) => <span key={i} style={{ left: `${(i * 37) % 100}%`, animationDelay: `${(i % 7) * 0.12}s`, ['--drift' as string]: `${((i * 53) % 60) - 30}px` }} />)}
    </div>
  )
}

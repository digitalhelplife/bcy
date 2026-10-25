import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { COMPLIANCE, SCENES, TRIAL_NOTICE, asset } from '../shared/content'
import type { FinishResult } from '../shared/types'
import type { GameClient } from '../net/gameClient'
import { Btn, Ctx, Img, Sheet, errorText, useApp, useSnap, type AppCtx, type ConfirmOpts, type Screen } from './common'
import { MapScreen } from './screens/MapScreen'
import { ExploreScreen, GardenScreen, Lazy, ResultScreen, prefetchCanvasScreens } from './lazyScreens'
import { InventoryScreen, SettingsScreen, ShareScreen } from './screens/Pages'
import { CodexScreen, SeasonScreen } from './screens/Learn'
import { NotebookScreen } from './screens/Notebook'
import { readConsent, writeConsent } from './prefs'
import { AuthGate } from './screens/AuthGate'
import { TrustChips } from './trust'
import { InAppBanner } from './InAppBanner'
import { FieldChecklistSheet } from './screens/FieldChecklist'
import { TrialMigratePrompt } from './screens/Transfer'

const CRITICAL = ['brand/brand_wordmark', 'map/travel_map_bg', SCENES.dujiangyan.thumb, SCENES.qingcheng.thumb, SCENES.jiezi.thumb, 'ui/ui_map', 'ui/ui_codex', 'ui/ui_inventory', 'ui/ui_decorate', 'ui/ui_export']

function preload(paths: string[], onStep: (n: number) => void) {
  let done = 0
  return Promise.all(paths.map(p => new Promise<void>((resolve, reject) => {
    const img = new Image()
    img.onload = () => { onStep(++done); resolve() }
    img.onerror = () => reject(new Error(`资源加载失败：${p}`))
    img.src = asset(p)
  })))
}

function Boot({ onEnter }: { onEnter: () => void }) {
  const snap = useSnap()
  const ctx = useApp()
  const [loaded, setLoaded] = useState(0)
  const [assetError, setAssetError] = useState<string | null>(null)
  const [fieldOpen, setFieldOpen] = useState(false)
  const [consent, setConsent] = useState(() => readConsent())
  const accepted = consent?.privacyVersion === COMPLIANCE.privacyPolicyVersion
  const run = useCallback(() => {
    setAssetError(null); setLoaded(0)
    // P50: no login / RPC before the player accepts the current privacy version.
    preload(CRITICAL, setLoaded).then(async () => {
      await ctx.client.boot()
      const c = readConsent()
      if (ctx.client.snapshot.phase === 'ready' && c) {
        await ctx.client.syncConsent(c.privacyVersion, c.telemetry).catch(() => undefined)
        ctx.client.track('consent_result', { result: 'accepted' })
      }
    }).catch(e => setAssetError(errorText(e)))
  }, [ctx.client])
  useEffect(() => { if (accepted) run() }, [run, accepted])
  if (!accepted) return <ConsentGate onAccept={(telemetry) => { const c = { privacyVersion: COMPLIANCE.privacyPolicyVersion, telemetry, acceptedAtMs: Date.now() }; writeConsent(c); setConsent(c) }} />
  const ready = snap.phase === 'ready' && loaded === CRITICAL.length
  return (
    <div className="screen boot">
      <img className="boot-logo" src={asset('brand/brand_wordmark')} alt="本草小游记·成都篇" />
      <p className="boot-sub">认识植物，跟着节气过日子 · 逛成都周边 · 布置川西小院</p>
      {!ready && !assetError && snap.phase !== 'error' && (
        <div className="progress"><div style={{ width: `${(loaded / CRITICAL.length) * 100}%` }} /><span>{snap.phase === 'connecting' ? '正在连接…' : '正在加载画面…'}</span></div>
      )}
      {(assetError || snap.bootError) && (
        <div className="boot-error"><p>{assetError ?? snap.bootError}</p><Btn onClick={run}>重试</Btn>
          <Btn small kind="ghost" onClick={() => setFieldOpen(true)} testId="offline-field">离线查看现场寻宝清单</Btn></div>
      )}
      {ready && <Btn onClick={onEnter} testId="enter">进入小院之旅</Btn>}
      {fieldOpen && <FieldChecklistSheet offline onClose={() => setFieldOpen(false)} />}
      <p className="tiny muted boot-notice">{snap.mode === 'demo' ? '本地演示模式：进度仅保存在此浏览器，非云存档。' : TRIAL_NOTICE}</p>
      <TrustChips />
      <p className="tiny muted">游戏画面·成都主题原创改编 · 非景区官方产品</p>
      <p className="tiny muted health">{COMPLIANCE.healthGameAdvice}</p>
      <p className="tiny muted">适龄提示 {COMPLIANCE.ageRating.display}</p>
    </div>
  )
}
function ConsentGate({ onAccept }: { onAccept: (telemetry: boolean) => void }) {
  const [agree, setAgree] = useState(false)
  const [telemetry, setTelemetry] = useState(false)
  return (
    <div className="screen boot consent">
      <img className="boot-logo" src={asset('brand/brand_wordmark')} alt="本草小游记·成都篇" />
      <section className="card">
        <h3>开始前，请先了解</h3>
        <TrustChips />
        <ul className="tiny">{COMPLIANCE.privacySummary.map(t => <li key={t}>{t}</li>)}</ul>
        <p className="tiny muted">全文：<a href="./legal/privacy.html" data-testid="link-privacy">《隐私政策》</a><a href="./legal/terms.html" data-testid="link-terms">《用户协议》</a>，版本 {COMPLIANCE.privacyPolicyVersion}。未满 14 周岁的孩子请在家长陪同下阅读并使用。</p>
        <label className="switch"><input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} data-testid="consent-agree" /><span>我已阅读并同意《隐私政策》和《用户协议》</span></label>
        <label className="switch"><input type="checkbox" checked={telemetry} onChange={e => setTelemetry(e.target.checked)} /><span>（可选）帮助改进体验：上报去标识化的操作事件，随时可在设置关闭</span></label>
      </section>
      <Btn disabled={!agree} onClick={() => onAccept(telemetry)} testId="consent-accept">同意并开始</Btn>
      <p className="tiny muted">不同意也不会联网；关闭页面即可。</p>
      <p className="tiny muted health">{COMPLIANCE.healthGameAdvice}</p>
    </div>
  )
}


const TUTORIAL: Record<string, { text: string; screen: Screen['name'] }> = {
  explore: { text: '第 1 步：在地图点都江堰「寻踪」，选植物路线出发', screen: 'map' },
  plant: { text: '第 2 步：去小院，点第一个种植槽种下薄荷种子', screen: 'garden' },
  collect: { text: '第 3 步：薄荷立即成熟了，点种植槽「收入背包」', screen: 'garden' },
  decorate: { text: '第 4 步：点「布置小院」，放入薄荷后保存', screen: 'garden' },
}

function GateOrApp({ screen, onEnter }: { screen: Screen; onEnter: () => void }) {
  const snap = useSnap()
  if (snap.phase === 'gate' && snap.gate) return <AuthGate />
  return screen.name === 'boot' ? <Boot onEnter={onEnter} /> : <Shell screen={screen} />
}
export function App({ client }: { client: GameClient }) {
  const [screen, setScreen] = useState<Screen>({ name: 'boot' })
  const [toastText, setToast] = useState<string | null>(null)
  const [dialog, setDialog] = useState<ConfirmOpts | null>(null)
  const guard = useRef<((next: Screen) => boolean) | null>(null)
  const toastTimer = useRef<number>(0)

  const ctx = useMemo<AppCtx>(() => ({
    client,
    go: (next: Screen) => { if (guard.current && !guard.current(next)) return; setScreen(next); window.scrollTo(0, 0) },
    toast: (text: string) => { setToast(text); window.clearTimeout(toastTimer.current); toastTimer.current = window.setTimeout(() => setToast(null), 2600) },
    confirm: (opts: ConfirmOpts) => setDialog(opts),
    setLeaveGuard: g => { guard.current = g },
  }), [client])

  return (
    <Ctx.Provider value={ctx}>
      <div className="app">
        <GateOrApp screen={screen} onEnter={() => setScreen({ name: 'map' })} />
        {toastText && <div className="toast" role="status">{toastText}</div>}
        {dialog && (
          <Sheet title={dialog.title} onClose={() => setDialog(null)}>
            {dialog.body && <div className="dialog-body">{dialog.body}</div>}
            <div className="col">
              {dialog.actions.map(a => <Btn key={a.label} kind={a.kind ?? 'primary'} onClick={() => { setDialog(null); a.onClick?.() }}>{a.label}</Btn>)}
            </div>
          </Sheet>
        )}
      </div>
    </Ctx.Provider>
  )
}

function Shell({ screen }: { screen: Screen }) {
  const snap = useSnap()
  const ctx = useApp()
  useEffect(() => { prefetchCanvasScreens() }, [])
  const s = snap.state!
  const nav: { name: Screen['name']; label: string; icon: string }[] = [
    { name: 'map', label: '地图', icon: 'ui/ui_map' }, { name: 'garden', label: '小院', icon: 'ui/ui_decorate' },
    { name: 'codex', label: '图鉴', icon: 'ui/ui_codex' }, { name: 'season', label: '节气', icon: 'ui/ui_plant' }, { name: 'inventory', label: '背包', icon: 'ui/ui_inventory' },
    { name: 'share', label: '游记', icon: 'ui/ui_export' },
  ]
  const immersive = screen.name === 'explore' || screen.name === 'result'
  // Playtime heartbeat for the anti-addiction service (only counted server-side for real-name minors).
  useEffect(() => {
    // realname accounts: every 60 s (minor cut-off at 21:00 must be enforced promptly); device trial: every 5 min
    const every = ctx.client.authMode === 'realname' ? 60_000 : 300_000
    const t = setInterval(() => { if (document.visibilityState === 'visible' && navigator.onLine) void ctx.client.heartbeat().catch(() => undefined) }, every)
    return () => clearInterval(t)
  }, [ctx.client])
  // Minor window end: re-check right after it closes so the gate shows without waiting for the next heartbeat.
  const until = snap.account?.minorPolicy.playableUntilMs ?? null
  useEffect(() => {
    if (!until) return
    const ms = until - ctx.client.serverNow() + 1500
    const t = setTimeout(() => { void ctx.client.heartbeat().catch(() => undefined) }, Math.max(1000, Math.min(ms, 2 ** 31 - 1)))
    return () => clearTimeout(t)
  }, [until, ctx.client])
  useEffect(() => { ctx.client.track('app_open', {}) }, [ctx.client])
  const tut = !s.tutorialSkipped && s.tutorialStage !== 'complete' ? TUTORIAL[s.tutorialStage] : null
  useEffect(() => {
    if (!s.tutorialSkipped && s.tutorialStage !== 'complete') ctx.client.track('tutorial_step', { stage: s.tutorialStage })
  }, [ctx.client, s.tutorialStage, s.tutorialSkipped])
  return (
    <div className={`shell${immersive ? ' immersive' : ''}`}>
      {until && <div className="minor-banner" role="status">未成年人模式 · 今日可玩至 21:00，到时会自动结束</div>}
      {!immersive && (
        <header className="topbar">
          <img src={asset('brand/brand_wordmark')} alt="本草小游记·成都篇" className="top-logo" />
          {snap.mode === 'demo' && <span className="mode-chip" title="未连接 Nakama，进度只保存在本浏览器">本地演示·非云存档</span>}
          {!snap.online && <span className="mode-chip warn"><Img path="ui/ui_offline" />离线</span>}
          <button className="icon-btn" aria-label="设置" onClick={() => ctx.go({ name: 'settings' })}><Img path="ui/ui_settings" /></button>
        </header>
      )}
      {!immersive && <InAppBanner />}
      {!immersive && <TrialMigratePrompt />}
      {(snap.pending?.status === 'unknown' || snap.pending?.retried) && <PendingBanner />}
      {tut && !immersive && (
        <div className="tutorial">
          <span>{tut.text}</span>
          <div className="row">
            {screen.name !== tut.screen && <Btn small onClick={() => ctx.go({ name: tut.screen } as Screen)}>前往</Btn>}
            <Btn small kind="ghost" onClick={async () => { try { await ctx.client.tutorialSkip() } catch (e) { ctx.toast(errorText(e)) } }}>跳过引导</Btn>
          </div>
        </div>
      )}
      <main className="content">
        {screen.name === 'map' && <MapScreen />}
        {screen.name === 'explore' && <Lazy><ExploreScreen key={screen.run.runId} run={screen.run} /></Lazy>}
        {screen.name === 'result' && <Lazy><ResultScreen run={screen.run} proof={screen.proof} replay={screen.replay} /></Lazy>}
        {screen.name === 'garden' && <Lazy><GardenScreen /></Lazy>}
        {screen.name === 'codex' && <CodexScreen />}
        {screen.name === 'inventory' && <InventoryScreen />}
        {screen.name === 'share' && <ShareScreen template={screen.template} plantId={screen.plantId} />}
        {screen.name === 'notebook' && <NotebookScreen />}
        {screen.name === 'settings' && <SettingsScreen />}
        {screen.name === 'season' && <SeasonScreen />}
      </main>
      {!immersive && (
        <nav className="bottom-nav">
          {nav.map(n => (
            <button key={n.name} className={screen.name === n.name ? 'on' : ''} onClick={() => ctx.go({ name: n.name } as Screen)} data-testid={`nav-${n.name}`}>
              <Img path={n.icon} /><span>{n.label}</span>
            </button>
          ))}
        </nav>
      )}
    </div>
  )
}

function PendingBanner() {
  const snap = useSnap(); const ctx = useApp()
  const p = snap.pending!
  const [busy, setBusy] = useState(false)
  const done = async (rpc: string, data: unknown) => {
    if (rpc === 'game.run.finish') {
      const r = (data as { result: FinishResult }).result
      const g = await ctx.client.runGet(r.runId)
      ctx.go({ name: 'result', run: g.run, proof: null, replay: r })
    } else ctx.toast(`「${p.label}」已确认`)
  }
  return (
    <div className="banner pending">
      <span>{p.status === 'sending' ? `正在确认「${p.label}」…` : `「${p.label}」的结果还没确认（网络中断）。`}</span>
      <div className="row">
        <Btn small disabled={busy || p.status === 'sending' || !snap.online} onClick={async () => { setBusy(true); try { await done(p.rpc, await ctx.client.retryPending()) } catch (e) { ctx.toast(errorText(e)) } finally { setBusy(false) } }}>重试确认</Btn>
        <Btn small kind="ghost" disabled={busy || p.status === 'sending' || !snap.online} onClick={async () => { setBusy(true); try { const r = await ctx.client.queryPending(); if (r.status === 'FOUND') await done(r.rpcName, { result: r.result }); else ctx.toast('服务器没有收到该操作，可以点「重试确认」重新发送') } catch (e) { ctx.toast(errorText(e)) } finally { setBusy(false) } }}>查询结果</Btn>
      </div>
    </div>
  )
}

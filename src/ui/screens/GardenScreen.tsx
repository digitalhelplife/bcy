import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ITEMS, PALETTES, PLANTS, PLOT_UNLOCK, RULES, SETS, VISITORS, VISITOR_RULES } from '../../shared/content'
import { autoLayout, isPlotOpen, placedCount, validateLayout } from '../../shared/rules'
import type { GardenSaveData, PaletteId, Placement, PlotId } from '../../shared/types'
import { ObserveRow } from './Learn'
import { CraftSheet } from './Craft'
import { useParentMode } from '../prefs'
import { BusinessError } from '../../net/gameClient'
import { Bridge } from '../../phaser/bridge'
import { PhaserHost } from '../../phaser/PhaserHost'
import { GardenScene } from '../../phaser/scenes/GardenScene'
import { Btn, Img, Sheet, errorText, fmtCountdown, useApp, useNow, useSnap, type Screen } from '../common'
import { play } from '../sfx'
import { dailyNote } from '../../shared/daily'
import { GardenShareSheet } from './GardenShare'
import { CareSheet } from './Care'

const same = (a: Placement[], b: Placement[]) => JSON.stringify([...a].sort((x, y) => x.instanceId.localeCompare(y.instanceId))) === JSON.stringify([...b].sort((x, y) => x.instanceId.localeCompare(y.instanceId)))

export function GardenScreen() {
  const { client, toast, confirm, setLeaveGuard, go } = useApp()
  const snap = useSnap(); const s = snap.state!
  const bridge = useMemo(() => new Bridge(), [])
  const instanceId = useMemo(() => crypto.randomUUID(), [])
  const draftKey = `bcy.gardenDraft.${snap.userId}`
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Placement[]>(s.garden.placements)
  const [palette, setPalette] = useState<PaletteId>(s.garden.paletteId)
  const [selected, setSelected] = useState<string | null>(null)
  const [plot, setPlot] = useState<PlotId | null>(null)
  const [saving, setSaving] = useState(false)
  const [reveal, setReveal] = useState<GardenSaveData['result'] | null>(null)
  const [craft, setCraft] = useState(false)
  const [care, setCare] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [hint, setHint] = useState<string | null>(null)
  const [canvasError, setCanvasError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const stateRef = useRef(s); stateRef.current = s

  const dirty = editing && (!same(draft, s.garden.placements) || palette !== s.garden.paletteId)
  let layoutError: string | null = null
  try { validateLayout(s, palette, draft) } catch (e) { layoutError = (e as Error).message }

  useEffect(() => {
    const offs = [
      bridge.on('garden.draftChanged', e => { if (e.sceneInstanceId === instanceId) { setDraft(e.placements); setSelected(e.selected) } }),
      bridge.on('garden.plotTap', e => { if (e.sceneInstanceId === instanceId) setPlot(e.plotId) }),
      bridge.on('explore.hint', e => { if (e.sceneInstanceId === instanceId) setHint(e.text) }),
      bridge.on('canvas.error', e => { if (e.sceneInstanceId === instanceId) setCanvasError(e.message) }),
    ]
    return () => { offs.forEach(f => f()) }
  }, [bridge, instanceId])
  useEffect(() => { if (!hint) return; const t = setTimeout(() => setHint(null), 2200); return () => clearTimeout(t) }, [hint])
  useEffect(() => { bridge.emit('garden.cmd', { kind: 'refreshPlots' }) }, [bridge, s.stateRevision])
  useEffect(() => { bridge.emit('garden.cmd', { kind: 'palette', tint: PALETTES[palette].tint }) }, [bridge, palette])

  // Local draft backup + leave guards.
  useEffect(() => {
    if (dirty) localStorage.setItem(draftKey, JSON.stringify({ placements: draft, paletteId: palette, baseRevision: s.stateRevision }))
  }, [dirty, draft, palette, draftKey, s.stateRevision])
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', onUnload)
    setLeaveGuard(dirty ? (next: Screen) => {
      confirm({
        title: '布置还没保存', body: '离开前要保存这次布置吗？',
        actions: [
          { label: '继续编辑', kind: 'ghost' },
          { label: '放弃修改', kind: 'danger', onClick: () => { localStorage.removeItem(draftKey); setLeaveGuard(null); go(next) } },
          { label: '保存并离开', kind: 'primary', onClick: async () => { if (await save()) { setLeaveGuard(null); go(next) } } },
        ],
      })
      return false
    } : null)
    return () => { window.removeEventListener('beforeunload', onUnload); setLeaveGuard(null) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, draft, palette])

  useEffect(() => {
    const raw = localStorage.getItem(draftKey)
    if (!raw) return
    const saved = JSON.parse(raw) as { placements: Placement[]; paletteId: PaletteId }
    if (same(saved.placements, s.garden.placements) && saved.paletteId === s.garden.paletteId) { localStorage.removeItem(draftKey); return }
    confirm({
      title: '发现未保存的布置', body: '上次离开时还有一份没保存的小院草稿。',
      actions: [
        { label: '丢弃草稿', kind: 'ghost', onClick: () => localStorage.removeItem(draftKey) },
        { label: '恢复草稿', kind: 'primary', onClick: () => { setEditing(true); bridge.emit('garden.cmd', { kind: 'mode', editing: true }); bridge.emit('garden.cmd', { kind: 'load', placements: saved.placements }); setPalette(saved.paletteId) } },
      ],
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const setMode = (on: boolean) => { setEditing(on); bridge.emit('garden.cmd', { kind: 'mode', editing: on }) }
  const discard = () => { bridge.emit('garden.cmd', { kind: 'load', placements: s.garden.placements }); setPalette(s.garden.paletteId); localStorage.removeItem(draftKey); setMode(false) }

  const save = useCallback(async (): Promise<boolean> => {
    if (layoutError) { toast(layoutError); return false }
    setSaving(true)
    try {
      const d = await client.gardenSave(palette, draft)
      localStorage.removeItem(draftKey); setMode(false); toast('小院布置已保存')
      const r = d.result
      client.track('garden_save', { placementCount: draft.length })
      if (r.newVisitors.length || r.newlyUnlockedSetIds.length || r.newlyUnlockedPlotIds.length) setReveal(r)
      r.newVisitors.forEach(v => client.track('visitor_found', { visitorId: v.visitorId }))
      r.newlyUnlockedSetIds.forEach(id => client.track('set_complete', { setId: id }))
      return true
    } catch (e) {
      if (e instanceof BusinessError && e.error.code === 'STATE_CONFLICT') {
        confirm({
          title: '进度已在别处更新', body: '你的草稿已保留。可以基于最新库存重新检查后再保存，或载入已保存的布局。',
          actions: [
            { label: '载入已保存布局', kind: 'ghost', onClick: () => { const st = client.snapshot.state!; bridge.emit('garden.cmd', { kind: 'load', placements: st.garden.placements }); setPalette(st.garden.paletteId) } },
            { label: '保留草稿再检查', kind: 'primary' },
          ],
        })
      } else toast(errorText(e))
      return false
    } finally { setSaving(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, palette, draft, layoutError])

  const data = useMemo(() => ({
    bridge, instanceId, placements: s.garden.placements, tint: PALETTES[s.garden.paletteId].tint,
    getPlots: () => stateRef.current.plots, serverNow: () => client.serverNow(),
    isPlotOpen: (id: PlotId) => isPlotOpen(stateRef.current, id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [reloadKey])

  const placeables = Object.values(ITEMS).filter(i => (i.kind === 'decor' || i.kind === 'plant') && (s.inventory[i.itemId] ?? 0) > 0)

  return (
    <div className="screen garden-screen">
      <div className="stage">
        <PhaserHost key={reloadKey} scene={GardenScene} sceneKey="garden" data={data} scale="envelop" align="bottom" panZoom />
        {hint && <div className="hint-toast">{hint}</div>}
        {canvasError && <div className="stage-error"><p>{canvasError}</p><Btn small onClick={() => { setCanvasError(null); setReloadKey(k => k + 1) }}>重试加载</Btn></div>}
      </div>
      <div className="garden-hud">
        {!editing && <p className="daily-note" data-testid="daily-note"><span className="badge">小院小事</span>{dailyNote(s, client.serverNow(), snap.userId ?? 'anon')}</p>}
        {!editing ? (
          <>
          <p className="tiny muted hud-hint">点种植槽种下种子 · 成长 5 分钟 · 访客 {s.visitors.length}/{Object.keys(VISITORS).length}</p>
          <div className="btn-row">
            <Btn small kind="soft" onClick={() => setCare(true)} testId="care-open">照料</Btn>
            <Btn small kind="soft" onClick={() => setCraft(true)}>手作台</Btn>
            <Btn small kind="soft" onClick={() => setShareOpen(true)} testId="garden-share-open">小院口令</Btn>
            <Btn small onClick={() => setMode(true)} testId="edit-garden"><Img path="ui/ui_decorate" />布置小院</Btn>
          </div>
          </>
        ) : (
          <div className="editor">
            <div className="row palettes">
              {(Object.keys(PALETTES) as PaletteId[]).map(id => {
                const unlocked = s.unlockedPaletteIds.includes(id)
                return <button key={id} className={`chip${palette === id ? ' on' : ''}`} disabled={!unlocked} onClick={() => setPalette(id)}>{PALETTES[id].name}{unlocked ? '' : '（完成都江堰两关解锁）'}</button>
              })}
            </div>
            <div className="item-drawer">
              {placeables.length === 0 && <span className="tiny muted">背包里还没有可布置的物品</span>}
              {placeables.map(it => {
                const total = s.inventory[it.itemId] ?? 0; const used = placedCount(draft, it.itemId)
                return (
                  <button key={it.itemId} className="item-tile" disabled={used >= total || draft.length >= RULES.maxPlacements} onClick={() => bridge.emit('garden.cmd', { kind: 'add', itemId: it.itemId })} data-testid={`add-${it.itemId}`}>
                    <Img path={it.icon} /><span>{it.name}</span><span className="tiny">{total - used}/{total}</span>
                  </button>
                )
              })}
            </div>
            {layoutError && <div className="error-line">{layoutError}</div>}
            <div className="row">
              <Btn small kind="ghost" disabled={!selected} onClick={() => bridge.emit('garden.cmd', { kind: 'remove' })}>移除所选</Btn>
              <Btn small kind="soft" testId="garden-auto" onClick={() => confirm({
                title: '一键示范布置？', body: '用你已经拥有的植物和摆件自动摆一个样子，会替换当前草稿。满意后记得点「保存」，之后还可以随意调整。',
                actions: [{ label: '取消', kind: 'ghost' }, { label: '摆一摆', onClick: () => { const l = autoLayout(s); bridge.emit('garden.cmd', { kind: 'load', placements: l }); setDraft(l); toast(l.length ? `摆好了 ${l.length} 件，记得保存` : '背包里还没有可摆放的物品') } }],
              })}>一键示范布置</Btn>
              <Btn small kind="ghost" onClick={discard}>放弃修改</Btn>
              <Btn small disabled={saving || !!layoutError} onClick={() => void save()} testId="save-garden">{saving ? '保存中…' : '保存布置'}</Btn>
            </div>
          </div>
        )}
      </div>
      {plot && <PlotSheet plotId={plot} onClose={() => setPlot(null)} />}
      {shareOpen && <GardenShareSheet onClose={() => setShareOpen(false)} />}
      {craft && <CraftSheet onClose={() => setCraft(false)} />}
      {care && <CareSheet onClose={() => setCare(false)} />}
      {reveal && <RevealSheet r={reveal} onClose={() => setReveal(null)} />}
    </div>
  )
}

function PlotSheet({ plotId, onClose }: { plotId: PlotId; onClose: () => void }) {
  const { client, toast } = useApp()
  const snap = useSnap(); const s = snap.state!
  const now = useNow(client)
  const plot = s.plots.find(p => p.plotId === plotId)!
  const [busy, setBusy] = useState(false)
  const seeds = Object.values(ITEMS).filter(i => i.kind === 'seed' && (s.inventory[i.itemId] ?? 0) > 0)
  const instantEligible = !s.tutorialGrowUsed && plotId === 'plot_1' && s.levels.dujiangyan_find.firstCompletedAtMs !== null
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    if (busy) return; setBusy(true)
    try { await fn(); toast(ok) } catch (e) { toast(errorText(e)) } finally { setBusy(false) }
  }
  // A5 G8: chime when a planting finishes while this sheet is open (hooks stay above the early returns).
  const readyNow = !!plot.planting && now >= plot.planting.readyAtMs
  const wasReady = useRef(readyNow)
  useEffect(() => { if (readyNow && !wasReady.current) play('ready'); wasReady.current = readyNow }, [readyNow])
  const title = `种植槽 ${plotId.slice(-1)}`
  if (!isPlotOpen(s, plotId)) {
    return <Sheet title={title} onClose={onClose}><p>图鉴发现 {PLOT_UNLOCK[plotId]} 种植物后开放这个种植槽（现在 {s.discoveredPlantIds.length} 种）。</p></Sheet>
  }
  if (!plot.planting) {
    return (
      <Sheet title={title} onClose={onClose}>
        {seeds.length === 0 ? <p className="muted">背包里没有种子。完成景点探索的「植物路线」可获得种子。</p> : (
          <div className="seed-list">
            {seeds.map(it => (
              <button key={it.itemId} className="item-tile wide" disabled={busy} data-testid={`plant-${it.itemId}`} onClick={() => act(() => client.plantStart(plotId, it.itemId).then(d => { client.track('plant_start', { plantId: it.plantId! }); return d }), `已种下${PLANTS[it.plantId!].name}`)}>
                <Img path={it.icon} /><span>{it.name}</span><span className="tiny">×{s.inventory[it.itemId]}</span>
                {instantEligible && it.itemId === 'seed_mint' && <span className="badge">新手：立即成熟</span>}
              </button>
            ))}
          </div>
        )}
      </Sheet>
    )
  }
  const p = plot.planting
  const ready = now >= p.readyAtMs
  return (
    <Sheet title={`${title} · ${PLANTS[p.plantId].name}`} onClose={onClose}>
      <div className="plot-status">
        <Img path={`plants/plant_${p.plantId}_${ready ? 'mature' : 'seedling'}`} />
        {ready ? <p>已经成熟，可以收入背包，之后能布置到小院。</p> : <p>正在生长，还需 <b>{fmtCountdown(p.readyAtMs - now)}</b>（以服务器时间为准）</p>}
      </div>
      <ObserveRow plantingId={p.plantingId} plantId={p.plantId} startedAtMs={p.startedAtMs} readyAtMs={p.readyAtMs} />
      <Btn disabled={!ready || busy} testId="claim-plant" onClick={() => act(() => client.plantClaim(plotId, p.plantingId).then(d => { play('claim'); client.track('plant_claim', { plantId: p.plantId }); onClose(); if (d.result.newlyUnlockedPlotIds.length) toast(`新的种植槽开放了：${d.result.newlyUnlockedPlotIds.map(x => x.slice(-1)).join('、')} 号`) }), `${PLANTS[p.plantId].name}已收入背包`)}>{ready ? '收入背包' : '生长中'}</Btn>
    </Sheet>
  )
}

function RevealSheet({ r, onClose }: { r: GardenSaveData['result']; onClose: () => void }) {
  const [parent] = useParentMode()
  return (
    <Sheet title="小院来了新动静" onClose={onClose}>
      {r.newVisitors.map(v => {
        const d = VISITORS[v.visitorId]
        return (
          <div key={v.visitorId} className="visitor-card" data-testid={`visitor-${v.visitorId}`}>
            <Img path={d.texture} />
            <div><b>{d.name} 来串门了</b><p className="tiny">{d.childText}</p>
              {d.verificationLevel !== 'verified' && <p className="tiny muted">游戏情景，成都是否常见待核实</p>}
              {v.grants.length > 0 && <p className="tiny">留下礼物：{v.grants.map(g => `${ITEMS[g.itemId].name}×${g.quantity}`).join('、')}</p>}
            </div>
          </div>
        )
      })}
      {r.newlyUnlockedSetIds.map(id => <div key={id} className="story"><b>集齐小景「{SETS[id].name}」</b><p>{SETS[id].story.text}</p></div>)}
      {r.newlyUnlockedPlotIds.length > 0 && <p>新的种植槽开放了：{r.newlyUnlockedPlotIds.map(x => x.slice(-1)).join('、')} 号</p>}
      {parent && r.newVisitors.length > 0 && <p className="tiny muted">{VISITOR_RULES.safetyNotice}</p>}
      <Btn onClick={onClose}>好的</Btn>
    </Sheet>
  )
}

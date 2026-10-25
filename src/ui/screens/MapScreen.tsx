import { useState } from 'react'
import { ITEMS, LEVELS, SCENES, SCENE_ORDER } from '../../shared/content'
import { isSceneOpen, previewReward, repeatRemaining, tutorialForcesPlantRoute } from '../../shared/rules'
import type { LevelId, Route, RunSummary } from '../../shared/types'
import { BusinessError } from '../../net/gameClient'
import { clearRunCaches } from '../../phaser/bridge'
import { Btn, Img, Sheet, errorText, useApp, useSnap } from '../common'
import { TripCardLink } from './TripCard'
import { activeEvent } from '../../shared/events'
import { EventSheet } from './EventSheet'
import { CraftSheet } from './Craft'
import { FieldChecklistSheet } from './FieldChecklist'
import { fmtSecs, markChallenge, readBest } from '../challenge'
import { readParentMode } from '../prefs'

export function MapScreen() {
  const { client, go, toast, confirm } = useApp()
  const snap = useSnap()
  const s = snap.state!
  const [picked, setPicked] = useState<LevelId | null>(null)
  const active = snap.activeRun
  const ev = activeEvent(client.serverNow())
  const [sheet, setSheet] = useState<null | 'event' | 'craft' | 'field'>(null)

  const cancelRun = (run: RunSummary, then?: () => void) => confirm({
    title: '放弃本次探索？', body: '放弃后这次探索不会发放奖励，可以重新选择关卡和路线出发。',
    actions: [
      { label: '继续保留', kind: 'ghost' },
      { label: '放弃探索', kind: 'danger', onClick: async () => { try { await client.runCancel(run.runId); client.track('run_cancel', { levelId: run.levelId }); clearRunCaches(); toast('已放弃本次探索'); then?.() } catch (e) { toast(errorText(e)) } } },
    ],
  })

  return (
    <div className="screen map-screen">
      <div className="map-canvas">
        <Img path="map/travel_map_bg" className="map-bg" alt="成都周边旅行地图" />
        {SCENE_ORDER.map((id, i) => {
          const sc = SCENES[id]; const open = isSceneOpen(s, id)
          return (
            <div key={id} className={`map-node${open ? '' : ' locked'}`} style={{ left: `${sc.map.x * 100}%`, top: `${sc.map.y * 100}%` }}>
              <button className="node-thumb" aria-label={sc.displayName} onClick={() => open ? setPicked(sc.findLevel) : toast(`完成${SCENES[SCENE_ORDER[i - 1]].displayName}的两关后开放`)}>
                <Img path={sc.thumb} alt="" />
                {!open && <span className="lock"><Img path="ui/ui_locked" /></span>}
              </button>
              <div className="node-label">{sc.displayName}</div>
              <div className="node-levels">
                {[sc.findLevel, sc.puzzleLevel].map(lid => {
                  const done = s.levels[lid].firstCompletedAtMs !== null
                  return <button key={lid} disabled={!open} className={`chip${done ? ' done' : ''}`} onClick={() => setPicked(lid)}>{LEVELS[lid].kind === 'find' ? '寻踪' : '拼图'}{done ? ' ✓' : ''}</button>
                })}
              </div>
            </div>
          )
        })}
      </div>
      {active && (
        <div className="banner active-run">
          <div>有一次未结束的探索：<b>{LEVELS[active.levelId].name}</b>（{active.route === 'plant' ? '植物路线' : '景点装饰路线'}）</div>
          <div className="row">
            <Btn small onClick={() => go({ name: 'explore', run: active })}>继续上次探索</Btn>
            <Btn small kind="ghost" onClick={() => cancelRun(active)}>放弃并重新出发</Btn>
          </div>
        </div>
      )}
      {ev && !active && <button className="banner event-banner" data-testid="event-banner" onClick={() => setSheet('event')}><b>{ev.title}</b><span className="tiny">路线 · 节气 · 秋天的小院 ›</span></button>}
      <div className="map-quick">
        <button className="chip" onClick={() => setSheet('craft')} data-testid="map-craft">手作台</button>
        <button className="chip" onClick={() => setSheet('field')} data-testid="map-field">现场寻宝清单</button>
      </div>
      <div className="daily-chip">今日重复奖励剩余 {repeatRemaining(s, client.serverNow())}/3</div>
      {sheet === 'event' && ev && <EventSheet ev={ev} onClose={() => setSheet(null)} />}
      {sheet === 'craft' && <CraftSheet onClose={() => setSheet(null)} />}
      {sheet === 'field' && <FieldChecklistSheet onClose={() => setSheet(null)} />}
      {picked && <RouteSheet levelId={picked} onClose={() => setPicked(null)} onCancelActive={cancelRun} />}
    </div>
  )
}

function RouteSheet({ levelId, onClose, onCancelActive }: { levelId: LevelId; onClose: () => void; onCancelActive: (r: RunSummary, then?: () => void) => void }) {
  const { client, go, toast } = useApp()
  const snap = useSnap(); const s = snap.state!
  const lv = LEVELS[levelId]; const sc = SCENES[lv.sceneId]
  const [route, setRoute] = useState<Route>('plant')
  const [busy, setBusy] = useState(false)
  const [challenge, setChallenge] = useState(false)
  const now = client.serverNow()
  const prog = s.levels[levelId]
  const routes: Route[] = ['plant', 'decor']
  const forced = tutorialForcesPlantRoute(s, levelId)
  const start = async () => {
    if (busy) return
    setBusy(true)
    try {
      const d = await client.runStart(levelId, route)
      client.track('run_start', { levelId, route })
      if (challenge && lv.kind === 'find') markChallenge(d.result.run.runId, Date.now())
      go({ name: 'explore', run: d.result.run })
    } catch (e) {
      if (e instanceof BusinessError && e.error.code === 'ACTIVE_RUN_EXISTS' && snap.activeRun) {
        onCancelActive(snap.activeRun)
      } else toast(errorText(e))
    } finally { setBusy(false) }
  }
  return (
    <Sheet title={`${sc.displayName} · ${lv.name}`} onClose={onClose}>
      <p className="muted">{lv.kind === 'find' ? `在画面中找到 3 处${lv.sceneId === 'dujiangyan' ? '渠首工程（宝瓶口被云雾挡住，先拖开云雾）' : '目标'}` : `把 ${sc.puzzle.columns * sc.puzzle.rows} 片拼图拖回原位`}。不限次数，不会失败。</p>
      <div className="route-cards">
        {routes.map(r => {
          const pv = previewReward(s, levelId, r, now, { userId: snap.userId ?? '', runId: 'preview' })
          const locked = r === 'decor' && forced
          const randomSeed = pv.rewardMode === 'repeat' && r === 'plant'
          return (
            <button key={r} className={`route-card${route === r ? ' on' : ''}`} disabled={locked} onClick={() => setRoute(r)} data-testid={`route-${r}`}>
              <div className="route-title">{r === 'plant' ? '植物路线' : '景点装饰路线'}</div>
              <div className="route-reward">
                {randomSeed && <span className="grant">随机 1 颗已开放植物种子（优先你还没发现的）</span>}
                {locked && <span className="muted">新手第一次探索先走植物路线</span>}
                {!randomSeed && !locked && pv.grants.map(g => <span key={g.itemId} className="grant"><Img path={ITEMS[g.itemId].icon} />{ITEMS[g.itemId].name}×{g.quantity}</span>)}
                {pv.rewardMode === 'none' && <span className="muted">今日重复奖励已用完，可继续游玩</span>}
              </div>
              <div className="route-tag">{pv.rewardMode === 'route_first' ? '首次奖励' : pv.rewardMode === 'repeat' ? '重复奖励' : '无奖励'}{prog.firstRouteClaimed[r] ? ' · 首奖已领' : ''}</div>
            </button>
          )
        })}
      </div>
      {lv.kind === 'find' && prog.firstCompletedAtMs !== null && !readParentMode() && (
        <label className="field-item challenge-toggle">
          <input type="checkbox" checked={challenge} onChange={e => setChallenge(e.target.checked)} data-testid="challenge-toggle" />
          <span><b>挑战模式</b><span className="tiny muted">不显示位置说明和提示按钮，记录用时{readBest(levelId) !== null ? `（你的最佳 ${fmtSecs(readBest(levelId)!)}）` : ''}。奖励不变。</span></span>
        </label>
      )}
      <TripCardLink sceneId={lv.sceneId} />
      <p className="tiny muted">路线只改变奖励，不改变任务。首次完成本关还会在图鉴中发现「{ITEMS[`plant_${lv.plantId}`].name}」。</p>
      <Btn onClick={start} disabled={busy} testId="start-run">{busy ? '正在出发…' : '出发'}</Btn>
    </Sheet>
  )
}

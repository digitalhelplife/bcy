// P64 自然笔记本: one page per discovered plant, with its four observation stages and a shortcut
// to the F25 nature-journal export. Completion is derived from PlayerState.observations; no new state.
import obsJson from '../../../content/observations.json'
import { CONTENT_NOTICE, PLANTS, plantTexture } from '../../shared/content'
import type { PlantId } from '../../shared/types'
import { Btn, Img, useApp, useSnap } from '../common'
import { STAGE_NAMES, verifiedPart } from './Learn'

const OBS: Record<PlantId, { stage: number; text: string }[]> = Object.fromEntries(
  (obsJson.items as unknown as { plantId: PlantId; stages: { stage: number; text: string }[] }[]).map(o => [o.plantId, o.stages]),
)

export function NotebookScreen() {
  const s = useSnap().state!
  const { go } = useApp()
  const discovered = s.discoveredPlantIds
  const completed = discovered.filter(id => (s.observations[id]?.length ?? 0) === 4)
  return (
    <div className="screen page" data-testid="notebook">
      <div className="row">
        <h2>自然笔记本</h2>
        <Btn small kind="ghost" onClick={() => go({ name: 'codex' })}>返回图鉴</Btn>
      </div>
      <p className="tiny muted">每种植物的 4 个成长阶段各记录一次，集齐后就能做一张“自然笔记”游记。观察完全可选，不影响成熟和领取。</p>
      <div className="stat-row">
        <span>已发现 <b>{discovered.length}</b></span>
        <span>完整笔记 <b>{completed.length}</b></span>
        <span>观察贴纸 <b>{completed.length}</b></span>
      </div>
      {discovered.length === 0 && <p className="muted">还没有发现植物。先去景点完成一关探索吧。</p>}
      <div className="story-list">
        {discovered.map(id => {
          const rec = s.observations[id] ?? []
          const done = rec.length === 4
          return (
            <div key={id} className={`story${done ? '' : ' locked'}`} data-testid={`notebook-${id}`}>
              <div className="row notebook-head">
                <Img path={plantTexture(id, 'icon')} />
                <b>{PLANTS[id].name}</b>
                <span className="tiny muted">{PLANTS[id].termName} · {rec.length}/4</span>
                {done && <span className="badge">观察贴纸</span>}
              </div>
              <div className="obs-row">
                {STAGE_NAMES.map((name, i) => (
                  <div key={name} className={`obs-cell${rec.includes(i) ? ' on' : ''}`}>
                    <b>{name}</b>
                    <span className="tiny">{rec.includes(i) ? verifiedPart(OBS[id]?.[i]?.text) || '已记录' : '待观察'}</span>
                  </div>
                ))}
              </div>
              <div className="row">
                <Btn small kind="soft" disabled={!done} onClick={() => go({ name: 'share', template: 'share_nature', plantId: id })} testId={`notebook-share-${id}`}>
                  {done ? '做成自然笔记' : '集齐 4 个阶段后可做'}
                </Btn>
              </div>
            </div>
          )
        })}
      </div>
      <p className="tiny muted">{CONTENT_NOTICE}</p>
    </div>
  )
}

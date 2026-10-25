import { ITEMS, PLANTS, SCENES, TERMS } from '../../shared/content'
import type { GameEvent } from '../../shared/events'
import { isTermOpen } from '../../shared/rules'
import { Btn, Img, Sheet, useApp, useSnap } from '../common'
import { TripCardLink } from './TripCard'
import { openCountdown } from './Learn'
import { plantTexture } from '../../shared/content'

/** A6-A2 秋假特别篇: a curated view over existing content. Uses only verified dates and fields; no extra rewards. */
export function EventSheet({ ev, onClose }: { ev: GameEvent; onClose: () => void }) {
  const { client, go } = useApp()
  const s = useSnap().state!
  const now = client.serverNow()
  return (
    <Sheet title={ev.title} onClose={onClose}>
      <p className="tiny">{ev.dateNote}</p>
      <p className="tiny muted">日期来源：{ev.dateSource.publisher} · 查阅于 {ev.dateSource.accessedAt}</p>
      <h4>秋假带娃路线</h4>
      <ol className="event-route">
        {ev.route.map(r => (
          <li key={r.sceneId}><b>{SCENES[r.sceneId].displayName}</b><p className="tiny">{r.line}</p><TripCardLink sceneId={r.sceneId} /></li>
        ))}
      </ol>
      <h4>这些天的节气</h4>
      <div className="row wrap">
        {ev.termIds.map(t => <span key={t} className={`chip${isTermOpen(t, now) ? ' on' : ''}`}>{TERMS[t].name}{isTermOpen(t, now) ? ' · 信笺可领' : ` · ${openCountdown(t, now)}`}</span>)}
      </div>
      <Btn small kind="soft" onClick={() => { onClose(); go({ name: 'season' }) }}>去看节气信笺</Btn>
      <h4>{ev.gardenIdea.title}</h4>
      <p className="tiny">{ev.gardenIdea.line}</p>
      <div className="row wrap event-idea">
        {ev.gardenIdea.plants.map(p => {
          const found = s.discoveredPlantIds.includes(p)
          return <span key={p} className="grant"><Img path={plantTexture(p, 'icon')} eager className={found ? undefined : 'silhouette'} />{found ? PLANTS[p].name : '？？？'}</span>
        })}
        {ev.gardenIdea.items.map(i => <span key={i} className="grant"><Img path={ITEMS[i].icon} eager />{ITEMS[i].name}</span>)}
      </div>
      <div className="row">
        <Btn small onClick={() => { onClose(); go({ name: 'garden' }) }}>去布置小院</Btn>
        <Btn small kind="soft" onClick={() => { onClose(); go({ name: 'share' }) }}>做一张秋假游记</Btn>
      </div>
      <p className="tiny muted">活动只是一份整理好的玩法推荐，不额外发放奖励。现场开放时间、票价、交通以景区官方公告为准。</p>
    </Sheet>
  )
}

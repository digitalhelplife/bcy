import { useState } from 'react'
import { PLANTS } from '../../shared/content'
import { CARE_GOAL_DAYS, careDays, caredToday } from '../../shared/rules'
import type { PlantId } from '../../shared/types'
import { Btn, Img, Sheet, errorText, useApp, useNow, useSnap } from '../common'
import { play } from '../sfx'
import { plantTexture } from '../../shared/content'

/** A6-A3c: a small reason to come back tomorrow — care for each mature plant once a day for 3 days. No items granted. */
export function CareSheet({ onClose }: { onClose: () => void }) {
  const { client, toast } = useApp()
  const s = useSnap().state!
  const now = useNow(client, 60_000)
  const [busy, setBusy] = useState<PlantId | null>(null)
  const owned = (Object.keys(PLANTS) as PlantId[]).filter(id => (s.inventory[`plant_${id}`] ?? 0) > 0)
  return (
    <Sheet title="今日照料" onClose={onClose}>
      <p className="tiny muted">每种成熟的植物每天可以照料一次（浇浇水、看看叶子），连续照料 {CARE_GOAL_DAYS} 天会“长得很好”。不发奖励，只是陪它慢慢长。</p>
      {owned.length === 0 && <p className="muted">还没有成熟的植物。先在种植槽种下种子吧。</p>}
      <div className="care-list">
        {owned.map(id => {
          const n = careDays(s, id); const done = n >= CARE_GOAL_DAYS; const today = caredToday(s, id, now)
          return (
            <div key={id} className={`care-row${done ? ' thriving' : ''}`} data-testid={`care-${id}`}>
              <Img path={plantTexture(id, 'icon')} alt={PLANTS[id].name} />
              <div className="grow"><b>{PLANTS[id].name}</b>
                <div className="care-dots">{Array.from({ length: CARE_GOAL_DAYS }, (_, i) => <span key={i} className={i < n ? 'on' : ''} />)}</div>
                <span className="tiny muted">{done ? '长得很好' : today ? '今天照料过了，明天再来' : `已照料 ${n}/${CARE_GOAL_DAYS} 天`}</span>
              </div>
              <Btn small kind="soft" disabled={done || today || busy === id} testId={`care-btn-${id}`} onClick={async () => {
                setBusy(id)
                try { const { result: r } = await client.plantCare(id); play('found'); client.track('plant_care', { plantId: id, days: r.days }); toast(r.thriving ? `${PLANTS[id].name}长得很好了！` : `照料了${PLANTS[id].name}（${r.days}/${CARE_GOAL_DAYS}）`) }
                catch (e) { toast(errorText(e)) } finally { setBusy(null) }
              }}>{done ? '很好' : '照料'}</Btn>
            </div>
          )
        })}
      </div>
    </Sheet>
  )
}

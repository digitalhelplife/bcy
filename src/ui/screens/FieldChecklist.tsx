import { useState } from 'react'
import { SCENES, SCENE_ORDER } from '../../shared/content'
import type { SceneId } from '../../shared/types'
import { Btn, Sheet, useApp } from '../common'

/**
 * A6-B2 现场寻宝清单. No location access, no upload, no server state: ticks live only in this browser's localStorage.
 * Only real landmarks (fictional === false) are listed — original game props are never presented as on-site things to find.
 */
const KEY = 'bcy.field.v1'
type Ticks = Record<string, number>   // targetId → tickedAtMs
export function readTicks(storage: Storage = localStorage): Ticks {
  try { const v = JSON.parse(storage.getItem(KEY) ?? '{}'); return v && typeof v === 'object' ? v : {} } catch { return {} }
}
export function fieldTargets(sceneId: SceneId) {
  return SCENES[sceneId].targets.filter(t => t.fictional === false)
}
export function FieldChecklistSheet({ onClose, offline = false }: { onClose: () => void; offline?: boolean }) {
  const { go, client } = useApp()
  const [ticks, setTicks] = useState<Ticks>(() => readTicks())
  const toggle = (id: string) => {
    const next = { ...ticks }
    if (next[id]) delete next[id]; else next[id] = Date.now()
    setTicks(next); try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* private mode: keep in memory */ }
    if (!offline) client.track('field_tick', { on: !!next[id] })
  }
  return (
    <Sheet title="现场寻宝清单" onClose={onClose}>
      <p className="tiny muted">到了景区，看到游戏里认识过的地方就勾一下。不会定位，不会上传，只记在这台手机上。现场请跟紧孩子、遵守景区指引。</p>
      {SCENE_ORDER.map(id => {
        const list = fieldTargets(id)
        if (!list.length) return null
        const n = list.filter(t => ticks[t.targetId]).length
        return (
          <div key={id} className="field-scene">
            <h4>{SCENES[id].displayName} <span className="tiny muted">{n}/{list.length}</span></h4>
            {list.map(t => (
              <label key={t.targetId} className={`field-item${ticks[t.targetId] ? ' on' : ''}`}>
                <input type="checkbox" checked={!!ticks[t.targetId]} onChange={() => toggle(t.targetId)} data-testid={`field-${t.targetId}`} />
                <span><b>{t.label}</b><span className="tiny muted">{t.hint}</span></span>
              </label>
            ))}
          </div>
        )
      })}
      {offline ? <p className="tiny muted">现在没有网络，勾选会先记在手机上；联网后可以用现场照片做一张对照游记。</p>
        : <Btn small kind="soft" onClick={() => { onClose(); go({ name: 'share' }) }}>用现场照片做一张对照游记</Btn>}
    </Sheet>
  )
}

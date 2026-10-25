import { useState } from 'react'
import { createPortal } from 'react-dom'
import tripJson from '../../../content/trip_cards.json'
import { SCENES } from '../../shared/content'
import type { SceneId } from '../../shared/types'
import { Sheet, useApp } from '../common'

// F12 带娃出行卡 (PRD §6.3, doc 05 §8.3). Content gate lives in scripts/build-content.py (validate_trip_cards);
// the UI only renders fields marked display=true and hides the card when fewer than minDisplayedFacts remain (D16).
type Field = { value: string; sourceRefs: string[]; verifiedAt: string; display: boolean }
type Source = { id: string; title: string; publisher: string; sourceType: string; recordedBy?: string; recordedAt?: string; conditions?: string }
type Card = Record<string, unknown> & {
  sceneId: SceneId; officialChannelName: string; cardVerifiedAt: string
  fixedOfficialNotice: string; fixedNonOfficialNotice: string; sourceRefs: Source[]
}
const FIELDS: [key: string, label: string][] = [
  ['suggestedDuration', '建议游玩时长'],
  ['walkingIntensity', '步行强度'],
  ['strollerNote', '推车提示'],
  ['suitableSeasons', '适合季节'],
  ['parentReminder', '带娃小提醒'],
]
const MIN = (tripJson as { minDisplayedFacts: number }).minDisplayedFacts
const CARDS = new Map((tripJson.items as unknown as Card[]).map(c => [c.sceneId, c]))

function shownFields(c: Card) {
  return FIELDS.flatMap(([k, label]) => {
    const f = c[k] as Field | undefined
    return f && f.display && f.value && f.sourceRefs?.length && f.verifiedAt ? [{ k, label, f }] : []
  })
}
/** null when the card must stay hidden (missing, or fewer than MIN verified facts). */
export function tripCardFor(sceneId: SceneId) {
  const c = CARDS.get(sceneId)
  if (!c) return null
  const fields = shownFields(c)
  return fields.length >= MIN ? { card: c, fields } : null
}

export function TripCard({ sceneId }: { sceneId: SceneId }) {
  const t = tripCardFor(sceneId)
  if (!t) return null
  const src = new Map(t.card.sourceRefs.map(s => [s.id, s]))
  return (
    <div className="trip-card" data-testid="trip-card">
      <dl>
        {t.fields.map(({ k, label, f }) => (
          <div key={k} className="trip-field">
            <dt>{label}</dt>
            <dd>{f.value}
              <span className="trip-src">来源：{f.sourceRefs.map(id => src.get(id)).filter(Boolean).map(s => s!.sourceType === 'field_record' ? `实地记录（非官方）：${s!.recordedBy} ${s!.recordedAt} 走访，${s!.conditions}` : `${s!.publisher}《${s!.title}》`).join('；')} · 核实于 {f.verifiedAt}</span>
            </dd>
          </div>
        ))}
        <div className="trip-field"><dt>官方信息渠道</dt><dd>{t.card.officialChannelName}</dd></div>
        <div className="trip-field"><dt>信息核实日期</dt><dd>{t.card.cardVerifiedAt}</dd></div>
      </dl>
      <div className="trip-fixed">
        <p>{t.card.fixedOfficialNotice}。</p>
        <p>{t.card.fixedNonOfficialNotice}。</p>
      </div>
    </div>
  )
}

/** Shared entry used by the map scene sheet, the scene-complete result page and the codex story list. */
export function TripCardLink({ sceneId }: { sceneId: SceneId }) {
  const [open, setOpen] = useState(false)
  const { client } = useApp()
  if (!tripCardFor(sceneId)) return null
  return (
    <>
      <button className="trip-link" onClick={() => { client.track('trip_card_view', { sceneId }); setOpen(true) }} data-testid={`trip-link-${sceneId}`}>带娃出行卡 · {SCENES[sceneId].displayName} ›</button>
      {/* Portal to <body>: this link lives inside other sheets, whose stacking context would otherwise show through. */}
      {open && createPortal(<div className="trip-layer"><Sheet title={`带娃出行卡 · ${SCENES[sceneId].displayName}`} onClose={() => setOpen(false)}><TripCard sceneId={sceneId} /></Sheet></div>, document.querySelector('.app') ?? document.body)}
    </>
  )
}

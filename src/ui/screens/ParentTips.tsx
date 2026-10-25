import tipsJson from '../../../content/parent_tips.json'
import { LEVELS, SCENES } from '../../shared/content'
import type { LevelId } from '../../shared/types'
import { SpeakButton } from '../SpeakButton'
import { levelTipText } from '../voiceTexts'
import thinkJson from '../../../content/think_questions.json'
import { useKidAge } from '../prefs'

type Tip = { contentKind: string; contentId: string; childText: string; reviewStatus: string }
const TIPS = new Map((tipsJson.items as unknown as Tip[]).map(t => [`${t.contentKind}:${t.contentId}`, t]))

/** Tips for one level: the three targets of a find level, or the puzzle's own tip. */
export function levelTips(levelId: LevelId): { title: string; tip: Tip }[] {
  const lv = LEVELS[levelId]
  if (lv.kind === 'find') {
    return SCENES[lv.sceneId].targets.flatMap(t => { const tip = TIPS.get(`find_target:${t.targetId}`); return tip ? [{ title: t.label, tip }] : [] })
  }
  const tip = TIPS.get(`puzzle:${levelId}`)
  return tip ? [{ title: lv.name, tip }] : []
}

const THINK = new Map((thinkJson.items as { levelId: string; question: string }[]).map(q => [q.levelId, q.question]))
export const thinkQuestion = (levelId: LevelId) => THINK.get(levelId) ?? null
/** F14 result card (parent mode only). Display-only: never affects completion or rewards. */
export function ParentTipsCard({ levelId }: { levelId: LevelId }) {
  const rows = levelTips(levelId)
  const [age] = useKidAge()
  const think = age === '7-12' ? thinkQuestion(levelId) : null
  if (!rows.length) return null
  const pending = rows.some(r => r.tip.reviewStatus !== 'approved')
  return (
    <div className="result-card parent-tip" data-testid="parent-tips">
      <div className="row"><b>讲给孩子听</b><SpeakButton text={levelTipText(levelId)} /></div>
      {rows.map(r => <p key={r.title}><span className="muted">{r.title}：</span>{r.tip.childText}</p>)}
      {think && <p className="think-q" data-testid="think-q"><b>想一想（7–12 岁）：</b>{think}</p>}
      {pending && <p className="tiny muted">文案待专家审核，正式上线前可能调整。</p>}
    </div>
  )
}

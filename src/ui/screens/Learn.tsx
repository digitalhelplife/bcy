import { useEffect, useState } from 'react'
import {
  COMPLIANCE, CONTENT_NOTICE, ITEMS, LEVELS, PLANTS, PLANT_IDS, SCENES, SETS, STORIES, TERMS, TERM_IDS, TERM_OCCURRENCES,
  VISITORS, CALENDAR_NOTE, SEASON_CONFIG, plantTexture, type VisitorCondition,
} from '../../shared/content'
import { quizFor, quizTitle, reachedStage } from '../../shared/rules'
import type { PlantId, TermId } from '../../shared/types'
import cardsJson from '../../../content/plant_cards.json'
import obsJson from '../../../content/observations.json'
import tipsJson from '../../../content/parent_tips.json'
import { Btn, Img, Sheet, errorText, useApp, useNow, useSnap } from '../common'
import { useParentMode } from '../prefs'
import { TripCardLink } from './TripCard'
import { SpeakButton } from '../SpeakButton'
import { SCENE_ORDER as TRIP_SCENES } from '../../shared/content'
import { termsIcs } from '../../shared/daily'
import { detectInApp } from '../inApp'

type Card = { plantId: PlantId; morphology?: string; ornamentalSeason?: string; dailyScenes?: string; cultureStory?: string; kidLine?: string; homeGrowing?: { light?: string; water?: string; difficulty?: string } }
const CARDS: Record<PlantId, Card> = Object.fromEntries((cardsJson.items as unknown as Card[]).map(c => [c.plantId, c]))
const OBS: Record<PlantId, { stage: number; text: string }[]> = Object.fromEntries((obsJson.items as unknown as { plantId: PlantId; stages: { stage: number; text: string }[] }[]).map(o => [o.plantId, o.stages]))
const TIPS: Record<string, string> = Object.fromEntries((tipsJson.items as unknown as { contentKind: string; contentId: string; childText: string }[]).map(t => [`${t.contentKind}:${t.contentId}`, t.childText]))
/** Hide placeholder text that still waits for expert review (03 §1.9: never show guesses). */
const real = (v?: string | null) => !!v && !/待(补充|核实|审核|园艺)|待专业/.test(v)
/** Player-facing text: drop clauses that are still placeholders (“……待核实”), keep the verified part. */
export const verifiedPart = (v?: string | null) => {
  const kept = String(v ?? '').replace(/[。.]$/, '').split(/[；;，,]/).map(x => x.trim()).filter(x => x && !/待.{0,8}(审核|核实|补充)/.test(x))
  return kept.length ? kept.join('；') + '。' : ''
}
export const STAGE_NAMES = ['种子', '发芽', '长叶', '开花/成熟']
const SAFETY: Record<string, string> = { toxic: '有毒 · 只看不摸', look_only: '只看不摘', unverified: '安全性待核实', safe: '常见安全' }

/** A5 G4: locked cards say when they open. Only verified dates open terms, so unverified ones get no date. */
export function openCountdown(termId: TermId, nowMs: number): string {
  const o = TERM_OCCURRENCES.find(x => x.termId === termId && x.verified && x.atMs > nowMs)
  if (!o) return `${TERMS[termId].name}到来时开放`
  const days = Math.ceil((o.atMs - nowMs) / 86_400_000)
  const d = new Date(o.atMs + 8 * 3_600_000)
  // A6-A3a: far-off dates read as a discouraging wait — show only the month beyond 30 days.
  if (days > 30) return `${d.getUTCMonth() + 1}月 · ${TERMS[termId].name}时节开放`
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日${TERMS[termId].name}开放 · ${days <= 1 ? '明天' : `还有 ${days} 天`}`
}

/** P65: turn a visitor condition into a readable hint without exposing hidden numbers beyond the condition. */
function visitorConditionText(c: VisitorCondition): string {
  const parts: string[] = []
  if (c.minPlants) parts.push(`至少 ${c.minPlants} 株植物`)
  if (c.items?.length) parts.push(`摆上 ${c.items.map(i => ITEMS[i]?.name ?? i).join('、')}`)
  if (c.plants?.length) parts.push(`种上 ${c.plants.map(p => PLANTS[p]?.name ?? p).join('、')}`)
  if (c.anyPlants?.length) parts.push(`至少 ${c.anyCount ?? 1} 种：${c.anyPlants.map(p => PLANTS[p]?.name ?? p).join('、')}`)
  if (c.minFloweringKinds !== undefined) parts.push(`至少 ${c.minFloweringKinds} 种开花植物`)
  if (c.minLeafy !== undefined) parts.push(`至少 ${c.minLeafy} 株叶片植物`)
  return parts.length ? parts.join('；') : '暂时未知'
}
export function CodexScreen() {
  const s = useSnap().state!
  const { client, go } = useApp()
  const now = useNow(client, 60_000)
  const [tab, setTab] = useState<'plants' | 'sets' | 'stories' | 'visitors'>('plants')
  const [filter, setFilter] = useState<'all' | 'found' | 'season'>('all')
  const [open, setOpen] = useState<PlantId | null>(null)
  const season = useSnap().season
  const list = PLANT_IDS.filter(id => filter === 'all' ? true : filter === 'found' ? s.discoveredPlantIds.includes(id) : season?.openPlantIds.includes(id))
  const title = quizTitle(s.quizStamps.length)
  return (
    <div className="screen page" data-testid="codex">
      <div className="row"><h2>本草图鉴</h2><Btn small kind="soft" onClick={() => go({ name: 'notebook' })} testId="open-notebook">自然笔记本</Btn></div>
      <div className="stat-row">
        <span>发现 <b>{s.discoveredPlantIds.length}</b>/{PLANT_IDS.length}</span>
        <span>问答印章 <b>{s.quizStamps.length}</b></span>
        <span>观察完成 <b>{Object.values(s.observations).filter(v => v.length === 4).length}</b></span>
        {title && <span className="badge">{title}</span>}
      </div>
      <div className="tabs">
        <button className={tab === 'plants' ? 'on' : ''} onClick={() => setTab('plants')}>植物</button>
        <button className={tab === 'sets' ? 'on' : ''} onClick={() => setTab('sets')}>小景 {s.unlockedSetIds.length}/{Object.keys(SETS).length}</button>
        <button className={tab === 'stories' ? 'on' : ''} onClick={() => setTab('stories')}>故事 {s.unlockedStoryIds.length}</button>
        <button className={tab === 'visitors' ? 'on' : ''} onClick={() => setTab('visitors')}>访客 {s.visitors.length}/{Object.keys(VISITORS).length}</button>
      </div>
      {tab === 'plants' && (
        <>
          <div className="row wrap">
            {(['all', 'found', 'season'] as const).map(f => <button key={f} className={`chip${filter === f ? ' on' : ''}`} onClick={() => setFilter(f)}>{f === 'all' ? '全部' : f === 'found' ? '已发现' : '已开放'}</button>)}
          </div>
          <div className="codex-grid">
            {list.map(id => {
              const p = PLANTS[id]; const found = s.discoveredPlantIds.includes(id)
              const openNow = season?.openPlantIds.includes(id)
              return (
                <button key={id} className={`codex-card${found ? '' : ' unknown'}`} onClick={() => found && setOpen(id)} data-testid={`codex-${id}`}>
                  <Img path={plantTexture(id, 'mature')} alt={found ? p.name : '未发现'} className={found ? undefined : 'silhouette'} />
                  <b>{found ? p.name : '？？？'}</b>
                  <span className="tiny muted">{p.termName} · {p.base ? '景点关卡' : '节气'}</span>
                  {found
                    ? <span className="tiny">{(s.care?.[id]?.length ?? 0) >= 3 ? '长得很好 · ' : ''}{s.quizStamps.includes(id) ? '已得印章 · ' : ''}观察 {s.observations[id]?.length ?? 0}/4</span>
                    : <span className="tiny muted">{p.base ? `首次完成「${LEVELS[p.levelId!].name}」发现` : openNow ? '已开放：节气信笺或重复奖励可得' : openCountdown(p.termId, now)}</span>}
                </button>
              )
            })}
          </div>
        </>
      )}
      {tab === 'sets' && (
        <div className="story-list">
          <div className="story" data-testid="titles">
            <b>问答称号</b>
            <p>{title ? `当前称号：${title}` : '还没有称号'} · 印章 {s.quizStamps.length}/24</p>
            <p className="tiny muted">集齐 6 / 12 / 18 / 24 枚印章，依次解锁本草小学徒、本草小行家、节气观察员、成都本草通。称号只做展示。</p>
          </div>
          {Object.values(SETS).map(st => {
            const done = s.unlockedSetIds.includes(st.setId)
            return (
              <div key={st.setId} className={`story${done ? '' : ' locked'}`}>
                <b>{st.name}{done ? ' · 已完成' : ''}</b>
                <p className="tiny">把 {st.plants.map(p => PLANTS[p].name).join('、')}{st.items.length ? ` 和 ${st.items.length} 件摆件` : ''} 一起摆进小院并保存。</p>
                {done && <p>{st.story.text}</p>}
              </div>
            )
          })}
        </div>
      )}
      {tab === 'visitors' && (
        <div className="story-list">
          <p className="tiny muted">访客看的是小院里摆了什么，不使用定位或现实观察。未核实的访客只作游戏情景。</p>
          {Object.values(VISITORS).map(v => {
            const found = s.visitors.includes(v.visitorId)
            return (
              <div key={v.visitorId} className={`story${found ? '' : ' locked'}`} data-testid={`visitor-codex-${v.visitorId}`}>
                <div className="row"><Img path={v.texture} /><b>{v.name}</b>{found ? <span className="badge">已来过</span> : <span className="tiny muted">未发现</span>}</div>
                {found ? <p className="tiny">{v.childText}</p> : <p className="tiny muted">到访条件：{visitorConditionText(v.condition)}</p>}
                {v.verificationLevel !== 'verified' && <p className="tiny muted">游戏情景，成都是否常见待核实</p>}
              </div>
            )
          })}
        </div>
      )}
      {tab === 'stories' && (
        <div className="story-list">
          {s.unlockedStoryIds.length === 0 && <p className="muted">完成一个景点的两关，或在小院集齐一组小景，就能解锁故事。</p>}
          {s.unlockedStoryIds.map(id => { const sid = TRIP_SCENES.find(x => `story_${x}` === id); return <div key={id} className="story"><b>{STORIES[id]?.title}</b><p>{STORIES[id]?.text}</p>{sid && <TripCardLink sceneId={sid} />}</div> })}
        </div>
      )}
      <p className="tiny muted">{CONTENT_NOTICE}</p>
      {open && <PlantSheet plantId={open} onClose={() => setOpen(null)} />}
    </div>
  )
}

function PlantSheet({ plantId, onClose }: { plantId: PlantId; onClose: () => void }) {
  const { client } = useApp()
  const s = useSnap().state!
  const [parent] = useParentMode()
  const [quiz, setQuiz] = useState(false)
  const p = PLANTS[plantId]; const c = CARDS[plantId]; const rec = s.observations[plantId] ?? []
  const tip = TIPS[`plant:${plantId}`]
  const owned = s.inventory[`plant_${plantId}`] ?? 0
  const facts: [string, string | undefined][] = [
    ['长什么样', c?.morphology], ['什么时候看', c?.ornamentalSeason], ['在哪能见到', c?.dailyScenes],
    ['阳台种植 · 光照', c?.homeGrowing?.light], ['阳台种植 · 浇水', c?.homeGrowing?.water], ['阳台种植 · 难度', c?.homeGrowing?.difficulty],
    ['名字的故事', c?.cultureStory], ['一句话记住', c?.kidLine],
  ]
  useEffect(() => { client.track('plant_card_view', { plantId }) }, [client, plantId])
  return (
    <Sheet title={p.name} onClose={onClose}>
      <div className="plant-card">
        <Img path={plantTexture(plantId, 'mature')} className="plant-hero" />
        <div>
          <p className="tiny muted"><i>{p.latinName.split('（')[0]}</i></p>
          <p className="tiny">节气：{p.termName}（{p.termRelation}）· 已收进背包 {owned} 株</p>
          <span className={`safety ${p.kidSafety}`}>{SAFETY[p.kidSafety]}</span>
        </div>
      </div>
      <p className="tiny">{p.kidSafetyNote}</p>
      <dl className="facts">
        {facts.filter(([, v]) => real(v)).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
      </dl>
      <h4>成长观察 {rec.length}/4</h4>
      <div className="obs-row">
        {STAGE_NAMES.map((n, i) => (
          <div key={n} className={`obs-cell${rec.includes(i) ? ' on' : ''}`}>
            <b>{n}</b>
            <span className="tiny">{rec.includes(i) ? (verifiedPart(OBS[plantId]?.[i]?.text) || '已记录这一步') : '种下后长到这一步再来记录'}</span>
          </div>
        ))}
      </div>
      {parent && tip && <div className="parent-tip"><div className="row"><b>亲子一起说</b><SpeakButton text={tip} /></div><p>{tip}</p><p className="tiny">自然挑战：{p.natureChallenge}</p></div>}
      {s.quizStamps.includes(plantId)
        ? <p className="badge">已获得「{p.name}」问答印章</p>
        : quizFor(plantId) && <Btn kind="soft" onClick={() => setQuiz(true)} testId="open-quiz">答 3 题拿印章</Btn>}
      <p className="tiny pending-review">知识内容审核中，正式版以专家审核文本为准。{COMPLIANCE.plantDisclaimer}</p>
      {quiz && <QuizSheet plantId={plantId} onClose={() => setQuiz(false)} />}
    </Sheet>
  )
}

function QuizSheet({ plantId, onClose }: { plantId: PlantId; onClose: () => void }) {
  const { client, toast } = useApp()
  const qz = quizFor(plantId)!
  const [idx, setIdx] = useState(0)
  const [answers, setAnswers] = useState<number[]>([])
  const [picked, setPicked] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const q = qz.questions[idx]
  const submit = async (all: number[]) => {
    setBusy(true)
    try {
      const d = await client.quizComplete(plantId, all)
      toast(d.result.newTitle && d.result.title ? `获得印章，解锁称号「${d.result.title}」` : `获得「${PLANTS[plantId].name}」印章`)
      client.track('quiz_complete', { plantId })
      onClose()
    } catch (e) { toast(errorText(e)); setIdx(0); setAnswers([]); setPicked(null) } finally { setBusy(false) }
  }
  return (
    <Sheet title={`${PLANTS[plantId].name} · 第 ${idx + 1}/${qz.questions.length} 题`} onClose={onClose}>
      <p className="quiz-q">{q.q}</p>
      <div className="col">
        {q.options.map((o, i) => (
          <button key={o} className={`quiz-opt${picked === null ? '' : i === q.answer ? ' right' : i === picked ? ' wrong' : ''}`} disabled={picked !== null} onClick={() => setPicked(i)} data-testid={`quiz-opt-${i}`}>{o}</button>
        ))}
      </div>
      {picked !== null && (
        <>
          <p className="tiny">{picked === q.answer ? '答对了！' : '再想想～'}{q.explain}</p>
          {picked === q.answer
            ? <Btn disabled={busy} testId="quiz-next" onClick={() => { const next = [...answers, picked]; if (idx + 1 < qz.questions.length) { setAnswers(next); setIdx(idx + 1); setPicked(null) } else void submit(next) }}>{idx + 1 < qz.questions.length ? '下一题' : '领取印章'}</Btn>
            : <Btn kind="ghost" onClick={() => setPicked(null)}>重新选择</Btn>}
        </>
      )}
      <p className="tiny muted">答错可以重来，不扣任何东西。</p>
    </Sheet>
  )
}

const fmtDate = (ms: number) => new Date(ms + 8 * 3_600_000).toISOString().slice(5, 16).replace('-', '月').replace('T', '日 ')
export function SeasonScreen() {
  const { client, toast } = useApp()
  const snap = useSnap(); const s = snap.state!; const season = snap.season
  const now = useNow(client, 30_000)
  const [busy, setBusy] = useState<string | null>(null)
  const [parent] = useParentMode()
  useEffect(() => { client.track('calendar_view', {}) }, [client])
  const nextAt = (t: TermId) => TERM_OCCURRENCES.find(o => o.termId === t && o.atMs > now)?.atMs ?? null
  const act = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key)
    try { await fn(); toast(ok) } catch (e) { toast(errorText(e)) } finally { setBusy(null) }
  }
  const cur = season?.currentTermId ? TERMS[season.currentTermId] : null
  return (
    <div className="screen page">
      <h2>节气日历</h2>
      <section className="card season-head">
        {cur ? <p>现在是 <b>{cur.name}</b>{season?.currentTermAtMs ? `（${fmtDate(season.currentTermAtMs)} 交节）` : ''}</p> : <p>二十四节气陆续开放</p>}
        {season?.nextTermId && season.nextTermAtMs && <p className="tiny">下一个：{TERMS[season.nextTermId].name} · {fmtDate(season.nextTermAtMs)}</p>}
        <Btn small kind="soft" testId="terms-ics" onClick={() => exportTermsIcs(now, toast)}>把接下来 6 个节气加到手机日历</Btn>
        {season?.mode === 'override_all' && <p className="tiny warn-text">测试环境：全部节气已提前开放</p>}
        {season && season.openTermIds.length === 0 && now < SEASON_CONFIG.epochMs && <p className="badge">节气日历将于 {fmtDate(SEASON_CONFIG.epochMs)} 起陆续开放，开放首日会先送上 {SEASON_CONFIG.preopenTerms} 个节气</p>}
        <p className="tiny muted">每个节气开放后可领一封信笺（2 颗当季植物种子），并做一个“只看不摘”的自然小挑战。已开放 {season?.openTermIds.length ?? 0}/24。</p>
      </section>
      <div className="term-list">
        {TERM_IDS.map(id => {
          const t = TERMS[id]; const open = season?.openTermIds.includes(id) ?? false
          const claimed = s.season.claimed.includes(id); const done = s.season.challenges.includes(id)
          const at = nextAt(id)
          return (
            <div key={id} className={`term-card${open ? '' : ' locked'}`} data-testid={`term-${id}`}>
              <div className="term-head">
                <Img path={plantTexture(t.plantId, open ? 'mature' : 'seed')} />
                <div>
                  <b>{t.name}</b><span className="tiny"> · {PLANTS[t.plantId].name}</span>
                  <p className="tiny muted">{open ? t.phenology : at ? openCountdown(id, now) : '待开放'}</p>
                </div>
              </div>
              {open && (
                <>
                  <div className="row">
                    <Btn small disabled={claimed || busy === `c${id}`} testId={`claim-${id}`} onClick={() => act(`c${id}`, async () => { await client.seasonClaim(id); client.track('season_claim', { termId: id }) }, `收到${t.name}信笺：${PLANTS[t.plantId].name}种子×2`)}>{claimed ? '信笺已领' : '领取信笺'}</Btn>
                    <Btn small kind="ghost" disabled={done || busy === `m${id}`} onClick={() => act(`m${id}`, async () => { await client.challengeMark(id); client.track('challenge_mark', { termId: id }) }, '已记下这次自然观察')}>{done ? '挑战已完成' : '我完成了挑战'}</Btn>
                  </div>
                  <p className="tiny">自然挑战：{t.challenge}</p>
                  {parent && <p className="tiny muted">{t.challengeNotice} {t.regionNotice}</p>}
                </>
              )}
            </div>
          )
        })}
      </div>
      <p className="tiny muted">{CALENDAR_NOTE}</p>
      <p className="tiny muted">节气开放以服务器时间为准；自然挑战靠自觉打勾，不发奖励，也不需要上传照片或定位。</p>
    </div>
  )
}

/** Growth observation entry used by the garden plot sheet. */
export function ObserveRow({ plantingId, plantId, startedAtMs, readyAtMs }: { plantingId: string; plantId: PlantId; startedAtMs: number; readyAtMs: number }) {
  const { client, toast } = useApp()
  const s = useSnap().state!
  const now = useNow(client)
  const [busy, setBusy] = useState(false)
  const reached = reachedStage({ startedAtMs, readyAtMs }, now)
  const rec = s.observations[plantId] ?? []
  const nextStage = [0, 1, 2, 3].find(i => i <= reached && !rec.includes(i))
  return (
    <div className="observe">
      <div className="obs-row dots">
        {STAGE_NAMES.map((n, i) => <span key={n} className={`obs-dot${rec.includes(i) ? ' on' : i <= reached ? ' ready' : ''}`}>{n}</span>)}
      </div>
      {nextStage !== undefined
        ? <Btn small kind="soft" disabled={busy} testId="observe" onClick={async () => {
            setBusy(true)
            try { const d = await client.observeRecord(plantingId, nextStage); client.track('observe_record', { plantId, stage: nextStage }); toast(`记下了「${STAGE_NAMES[nextStage]}」：${OBS[plantId]?.[nextStage]?.text ?? ''}`.slice(0, 60)); if (d.result.completed) toast(`${PLANTS[plantId].name}的成长观察全部完成`) } catch (e) { toast(errorText(e)) } finally { setBusy(false) }
          }}>记录「{STAGE_NAMES[nextStage]}」观察</Btn>
        : <span className="tiny muted">{rec.length === 4 ? '这种植物的四个阶段都观察过了' : '下一个阶段还没到，过一会儿再来看看'}</span>}
    </div>
  )
}
export { SCENES }

/** A5 G10: download an .ics (no push permission, no account data). In-app browsers often block downloads. */
function exportTermsIcs(now: number, toast: (t: string) => void) {
  const { ics, n } = termsIcs(now, 6)
  if (!n) { toast('暂时没有已核实的后续节气'); return }
  if (detectInApp()) { toast('当前 App 内置浏览器不支持下载日历文件，请先在浏览器中打开本游戏'); return }
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }))
  const a = document.createElement('a'); a.href = url; a.download = '本草小游记-节气.ics'
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
  toast(`已生成 ${n} 个节气的日历文件，打开它即可加入手机日历`)
}


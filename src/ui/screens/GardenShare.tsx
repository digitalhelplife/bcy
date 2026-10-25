// A5 G13 "小院口令": share a read-only snapshot of the SAVED courtyard (layout + palette only, no account data),
// view a friend's snapshot by code, revoke any time. No comments or rankings by design; A6-C2 adds four preset
// reactions (no free text), one per visitor per code per day, with counts shown to the owner only.
import { useEffect, useState } from 'react'
import type { GardenReaction, GardenSnapshot } from '../../net/gameClient'
import { PALETTES } from '../../shared/content'
import { formatCode, normalizeCode } from '../../shared/transfer'
import { renderGardenSnapshot } from '../../share/exportShare'
import { Btn, Sheet, errorText, useApp, useSnap } from '../common'
import { copyText } from '../inApp'

export const REACTIONS: { id: GardenReaction; label: string; mark: string }[] = [
  { id: 'heart', label: '喜欢', mark: '❤' }, { id: 'flower', label: '送花', mark: '✿' },
  { id: 'clap', label: '好会摆', mark: '👏' }, { id: 'wow', label: '想去', mark: '✨' },
]
const MY_CODE = 'bcy.gardenCode'
const readMyCode = () => { try { return localStorage.getItem(MY_CODE) } catch { return null } }
const writeMyCode = (c: string | null) => { try { if (c) localStorage.setItem(MY_CODE, c); else localStorage.removeItem(MY_CODE) } catch { /* ignore */ } }

export function GardenShareSheet({ onClose }: { onClose: () => void }) {
  const { client, toast, confirm } = useApp()
  const snap = useSnap(); const s = snap.state!
  const [mine, setMine] = useState<string | null>(() => readMyCode())
  const [counts, setCounts] = useState<GardenSnapshot['reactions'] | null>(null)
  useEffect(() => {
    if (!mine) { setCounts(null); return }
    let live = true
    client.gardenShareGet(mine).then(g => { if (live) setCounts(g.reactions ?? {}) }).catch(() => { if (live) { writeMyCode(null); setMine(null) } })
    return () => { live = false }
  }, [client, mine])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [view, setView] = useState<{ snap: GardenSnapshot; url: string } | null>(null)
  useEffect(() => () => { if (view) URL.revokeObjectURL(view.url) }, [view])
  const create = async () => {
    setBusy(true)
    try { const r = await client.gardenShareCreate(); writeMyCode(r.code); setMine(r.code) } catch (e) { toast(errorText(e)) } finally { setBusy(false) }
  }
  const revoke = () => confirm({
    title: '撤销小院口令？', body: '撤销后，任何人都不能再用这个口令查看你的小院。',
    actions: [{ label: '取消', kind: 'ghost' }, { label: '撤销', kind: 'danger', onClick: async () => {
      try { await client.gardenShareRevoke(); writeMyCode(null); setMine(null); toast('口令已撤销') } catch (e) { toast(errorText(e)) }
    } }],
  })
  const look = async () => {
    const c = normalizeCode(input); if (!c) { toast('口令应为 8 位字母和数字'); return }
    setBusy(true)
    try {
      const g = await client.gardenShareGet(c)
      const canvas = await renderGardenSnapshot(g)
      const blob = await new Promise<Blob>((res, rej) => canvas.toBlob(b => (b ? res(b) : rej(new Error('图片生成失败'))), 'image/png'))
      setView({ snap: g, url: URL.createObjectURL(blob) })
    } catch (e) { toast(errorText(e)) } finally { setBusy(false) }
  }
  return (
    <Sheet title="小院口令" onClose={onClose}>
      <div className="col" data-testid="garden-share">
        <p className="tiny">把口令发给朋友，她可以只读地看看你<b>已保存</b>的小院布局。口令里不包含你的手机号、昵称或任何进度，随时可以撤销。</p>
        {mine
          ? <div className="transfer-code"><b data-testid="garden-code">{formatCode(mine)}</b>
              <div className="row"><Btn small kind="soft" onClick={async () => toast((await copyText(`来看看我的川西小院！在「本草小游记·成都篇」小院里输入口令 ${formatCode(mine)}`)) ? '已复制口令' : '复制失败，请长按口令手动复制')}>复制口令</Btn>
                <Btn small kind="ghost" onClick={revoke}>撤销</Btn></div></div>
          : <Btn small disabled={busy || !s.garden.placements.length} onClick={create} testId="garden-share-create">{s.garden.placements.length ? '生成我的小院口令' : '先摆几件并保存，再来生成口令'}</Btn>}
        {mine && counts && <p className="tiny reaction-counts" data-testid="reaction-counts">朋友的回应：{REACTIONS.map(r => `${r.mark} ${counts[r.id] ?? 0}`).join('　')}</p>}
        {mine && <p className="tiny muted">之后再修改小院，朋友看到的仍是生成口令时的样子；重新生成会让旧口令失效。</p>}
        <div className="row code-row">
          <label className="field grow">看看朋友的小院
            <input value={input} maxLength={9} autoCapitalize="characters" autoComplete="off" onChange={e => setInput(e.target.value.toUpperCase())} placeholder="输入 8 位口令" data-testid="garden-code-input" />
          </label>
          <Btn small disabled={busy || !normalizeCode(input)} onClick={look} testId="garden-code-view">查看</Btn>
        </div>
        {view && (
          <figure className="garden-view" data-testid="garden-view">
            <img src={view.url} alt="朋友的小院（只读）" />
            <figcaption className="tiny muted">{view.snap.mine ? '这是你自己的小院口令' : '朋友的小院'} · {PALETTES[view.snap.paletteId]?.name ?? ''} · {view.snap.placements.length} 件 · 只读</figcaption>
            {!view.snap.mine && (
              <div className="row wrap reactions" data-testid="reactions">
                {REACTIONS.map(r => (
                  <button key={r.id} className={`chip${view.snap.reactedToday === r.id ? ' on' : ''}`} disabled={!!view.snap.reactedToday || busy} data-testid={`react-${r.id}`}
                    onClick={async () => {
                      setBusy(true)
                      try { const out = await client.gardenShareReact(normalizeCode(input)!, r.id); setView({ ...view, snap: { ...view.snap, reactedToday: out.reaction } }); toast(out.already ? '今天已经回应过啦' : '已送出回应') } catch (e) { toast(errorText(e)) } finally { setBusy(false) }
                    }}>{r.mark} {r.label}</button>
                ))}
                <span className="tiny muted">{view.snap.reactedToday ? '今天已回应，明天可以再来' : '每天可以回应一次，主人只看到次数'}</span>
              </div>
            )}
          </figure>
        )}
      </div>
    </Sheet>
  )
}

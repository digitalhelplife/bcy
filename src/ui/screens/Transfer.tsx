// A5 G7: move progress between browsers/accounts with a one-time code, and carry device-trial progress into
// the phone account after the realname switch. The server does the move atomically; this is only the UI.
import { useEffect, useState } from 'react'
import { formatCode, isFreshState, normalizeCode, type TransferCreateResult } from '../../shared/transfer'
import { Btn, Sheet, errorText, useApp, useSnap } from '../common'

const MIGRATE_KEY = 'bcy.trialMigrate.done'

export function TransferCard() {
  const { client, toast, confirm } = useApp()
  const snap = useSnap(); const s = snap.state!
  const [code, setCode] = useState<TransferCreateResult | null>(null)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const fresh = isFreshState(s)
  const create = () => confirm({
    title: '生成转移码？',
    body: '在另一个浏览器或新账号里输入这个码，进度会整体搬过去，这里的进度随后清空。转移码 10 分钟内有效，只能用一次。',
    actions: [{ label: '取消', kind: 'ghost' }, { label: '生成', onClick: async () => {
      setBusy(true)
      try { setCode(await client.transferCreate()) } catch (e) { toast(errorText(e)) } finally { setBusy(false) }
    } }],
  })
  const claim = async () => {
    const c = normalizeCode(input)
    if (!c) { toast('转移码应为 8 位字母和数字'); return }
    setBusy(true)
    try {
      const r = await client.transferClaim(c)
      setInput(''); toast(`进度已接收：${r.result.levelsCleared} 个关卡、${r.result.plantsDiscovered} 种植物`)
    } catch (e) { toast(errorText(e)) } finally { setBusy(false) }
  }
  return (
    <section className="card col" data-testid="transfer-card">
      <h3>换浏览器 / 换手机继续玩</h3>
      <p className="tiny">从小红书、微信里打开时，进度存在那个 App 的浏览器里。用转移码可以把进度搬到别的浏览器。</p>
      {code
        ? <div className="transfer-code" data-testid="transfer-code">
            <b>{formatCode(code.code)}</b>
            <span className="tiny muted">{new Date(code.expiresAtMs).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })} 前有效 · 只能用一次</span>
            {!code.sourceHasProgress && <span className="tiny warn-text">当前账号还没有进度，转过去也是空的。</span>}
          </div>
        : <Btn small kind="soft" disabled={busy} onClick={create} testId="transfer-create">生成转移码（把这里的进度搬走）</Btn>}
      {fresh
        ? <div className="row code-row">
            <label className="field grow">输入转移码
              <input value={input} maxLength={9} autoCapitalize="characters" autoComplete="off" onChange={e => setInput(e.target.value.toUpperCase())} placeholder="例如 7KQ2-M9XA" data-testid="transfer-input" />
            </label>
            <Btn small disabled={busy || !normalizeCode(input)} onClick={claim} testId="transfer-claim">接收进度</Btn>
          </div>
        : <p className="tiny muted">当前账号已有进度，不能再接收转移码（避免覆盖）。</p>}
    </section>
  )
}

/** Shown once after phone login when the phone account is still empty: offer to bring the device-trial save over. */
export function TrialMigratePrompt() {
  const { client, toast } = useApp()
  const snap = useSnap()
  const [done, setDone] = useState(() => { try { return localStorage.getItem(MIGRATE_KEY) === '1' } catch { return true } })
  const [busy, setBusy] = useState(false)
  const [exists, setExists] = useState(false)
  const eligible = !done && snap.mode === 'nakama' && client.authMode === 'realname' && !!snap.state && isFreshState(snap.state)
  useEffect(() => {
    if (!eligible) return
    let live = true
    void client.hasTrialAccount().then(v => { if (live) setExists(v) })
    return () => { live = false }
  }, [eligible, client])
  if (!eligible || !exists) return null
  if (done || snap.mode !== 'nakama' || client.authMode !== 'realname' || !snap.state || !isFreshState(snap.state)) return null
  const finish = () => { try { localStorage.setItem(MIGRATE_KEY, '1') } catch { /* private mode */ } setDone(true) }
  const go = async () => {
    setBusy(true)
    try {
      const r = await client.migrateTrial()
      toast(r ? `试玩进度已带过来：${r.levelsCleared} 个关卡、${r.plantsDiscovered} 种植物` : '这个浏览器上没有找到试玩进度')
      finish()
    } catch (e) { toast(errorText(e)) } finally { setBusy(false) }
  }
  return (
    <Sheet title="之前在这里试玩过吗？" onClose={finish}>
      <p>如果你在这个浏览器里玩过试玩版，可以把当时的关卡、植物和小院一起带到现在的手机号账号。</p>
      <div className="row">
        <Btn disabled={busy} onClick={go} testId="trial-migrate">{busy ? '正在搬运…' : '带过来'}</Btn>
        <Btn kind="ghost" onClick={finish} testId="trial-migrate-skip">不用了</Btn>
      </div>
    </Sheet>
  )
}

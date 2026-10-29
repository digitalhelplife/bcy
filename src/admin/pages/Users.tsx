import { useState } from 'react'
import { ACCOUNT_LABELS, ApiError, api, fmt, qs, readQuery, REALNAME_LABELS, syncQuery, useApi } from '../api'
import { useRouter } from '../App'
import { Card, Chip, ErrorBox, Loading, PageHead, Pager } from '../ui'

type UserRow = {
  id: string; customId: string; username: string | null; loginMethod: 'phone' | 'device'; authUserId: string | null
  realnameStatus: string; accountStatus: string; createdAtMs: number; lastActiveMs: number
  plantsDiscovered: number; levelsCompleted: number; feedbackCount: number; playtimeMinutes7d: number | null
}
type UsersData = { total: number; page: number; pageSize: number; rows: UserRow[] }

const EMPTY = { q: '', login: '', realname: '', status: '', from: '', to: '', activeFrom: '', activeTo: '', feedback: false }

function initialForm() {
  const q = readQuery()
  return {
    q: q.q ?? '', login: q.login ?? '', realname: q.realname ?? '', status: q.status ?? '',
    from: q.from ?? '', to: q.to ?? '', activeFrom: q.activeFrom ?? '', activeTo: q.activeTo ?? '', feedback: q.feedback === '1',
  }
}

export function Users() {
  const { navigate } = useRouter()
  const [form, setForm] = useState(initialForm)
  const [applied, setApplied] = useState(initialForm)
  const [page, setPage] = useState(1)
  const [phone, setPhone] = useState('')
  const [phoneBusy, setPhoneBusy] = useState(false)
  const [phoneResult, setPhoneResult] = useState<{ found: boolean; maskedPhone?: string; user?: UserRow | null; error?: string } | null>(null)
  const data = useApi<UsersData>(`/users${qs({ ...applied, page, pageSize: 50, feedback: applied.feedback ? '1' : '' })}`, [applied, page])

  const apply = () => {
    setPage(1)
    setApplied({ ...form })
    syncQuery({ ...form, feedback: form.feedback ? '1' : '' })
  }
  const reset = () => {
    const e = { ...EMPTY }
    setForm(e); setApplied(e); setPage(1); setPhoneResult(null)
    syncQuery({})
  }

  async function searchPhone() {
    setPhoneBusy(true)
    setPhoneResult(null)
    try {
      const r = await api<{ found: boolean; maskedPhone?: string; user?: UserRow | null }>('/users/search-phone', { method: 'POST', body: { phone } })
      setPhoneResult(r)
    } catch (e) {
      setPhoneResult({ found: false, error: (e as ApiError).message })
    } finally {
      setPhoneBusy(false)
    }
  }

  return (
    <>
      <PageHead title="用户" desc="按 Nakama ID、bcy- ID 或完整手机号定位玩家；列表不显示手机号、姓名或身份证号。" />
      <div className="stack">
        <Card title="搜索与筛选" sub="手机号只支持精确匹配，且每次查询都会记录审计">
          <div className="filterbar">
            <label className="field grow"><span>用户 ID / bcy- ID / 昵称</span>
              <input value={form.q} onChange={e => setForm({ ...form, q: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') apply() }} placeholder="例如 6f1c… 或 bcy-…" data-testid="users-q" />
            </label>
            <label className="field"><span>登录方式</span>
              <select value={form.login} onChange={e => setForm({ ...form, login: e.target.value })} data-testid="users-login">
                <option value="">全部</option><option value="device">设备试玩</option><option value="phone">手机号</option>
              </select>
            </label>
            <label className="field"><span>实名状态</span>
              <select value={form.realname} onChange={e => setForm({ ...form, realname: e.target.value })} data-testid="users-realname">
                <option value="">全部</option>
                {Object.entries(REALNAME_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label className="field"><span>账号状态</span>
              <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>
                <option value="">全部</option>
                {Object.entries(ACCOUNT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label className="field"><span>注册起</span><input type="date" value={form.from} onChange={e => setForm({ ...form, from: e.target.value })} /></label>
            <label className="field"><span>注册止</span><input type="date" value={form.to} onChange={e => setForm({ ...form, to: e.target.value })} /></label>
            <label className="field"><span>活跃起</span><input type="date" value={form.activeFrom} onChange={e => setForm({ ...form, activeFrom: e.target.value })} /></label>
            <label className="field"><span>活跃止</span><input type="date" value={form.activeTo} onChange={e => setForm({ ...form, activeTo: e.target.value })} /></label>
            <label className="check" style={{ marginBottom: 6 }}><input type="checkbox" checked={form.feedback} onChange={e => setForm({ ...form, feedback: e.target.checked })} />有反馈</label>
            <button className="btn primary" onClick={apply} data-testid="users-apply">查询</button>
            <button className="btn" onClick={reset}>重置</button>
          </div>
          <div className="divider" />
          <div className="row-wrap">
            <label className="field" style={{ margin: 0, minWidth: 240 }}><span>手机号精确查询</span>
              <input value={phone} onChange={e => setPhone(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void searchPhone() }} placeholder="11 位手机号" data-testid="users-phone" />
            </label>
            <button className="btn" onClick={searchPhone} disabled={phoneBusy || !/^1[3-9]\d{9}$/.test(phone)} data-testid="users-phone-search">{phoneBusy ? '查询中…' : '精确查询'}</button>
            <span className="hint">只返回脱敏号码；查询行为会写入审计日志。</span>
          </div>
          {phoneResult ? (
            <div className="banner info" style={{ marginTop: 10 }} data-testid="phone-result">
              {phoneResult.error ? phoneResult.error : phoneResult.found ? (
                <span>匹配到 {phoneResult.maskedPhone} · {phoneResult.user ? <button className="btn link" onClick={() => navigate(`/users/${phoneResult.user!.id}`)}>查看用户 {fmt.short(phoneResult.user.id)}</button> : '用户不在 Nakama 中'}</span>
              ) : '没有匹配的用户'}
            </div>
          ) : null}
        </Card>

        {data.error ? <ErrorBox error={data.error} onRetry={data.reload} /> : null}
        {data.loading && !data.data ? <Loading /> : null}
        {data.data ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>用户</th><th>登录方式</th><th>实名状态</th><th>账号状态</th><th>注册时间</th><th>最近活跃</th><th className="num">近 7 日时长</th><th className="num">进度</th><th className="num">反馈</th><th></th>
                </tr>
              </thead>
              <tbody>
                {data.data.rows.map(u => (
                  <tr key={u.id}>
                    <td>
                      <button className="btn link mono" onClick={() => navigate(`/users/${u.id}`)} data-testid={`user-link-${u.id}`}>{fmt.short(u.id, 10)}</button>
                      <div className="sub">{u.username ?? '未命名'}</div>
                    </td>
                    <td>{u.loginMethod === 'phone' ? <Chip kind="info">手机号</Chip> : <Chip kind="mute">设备试玩</Chip>}</td>
                    <td><Chip kind={u.realnameStatus.startsWith('VERIFIED') ? 'ok' : u.realnameStatus === 'PENDING' ? 'warn' : 'mute'}>{REALNAME_LABELS[u.realnameStatus] ?? u.realnameStatus}</Chip></td>
                    <td><Chip kind={u.accountStatus === 'ACTIVE' ? 'ok' : 'danger'}>{ACCOUNT_LABELS[u.accountStatus] ?? u.accountStatus}</Chip></td>
                    <td className="nowrap">{fmt.time(u.createdAtMs)}</td>
                    <td className="nowrap">{fmt.time(u.lastActiveMs)}</td>
                    <td className="num">{u.playtimeMinutes7d === null ? '—' : `${u.playtimeMinutes7d} 分钟`}</td>
                    <td className="num">{u.plantsDiscovered} 植物 · {u.levelsCompleted}/6 关</td>
                    <td className="num">{u.feedbackCount}</td>
                    <td><button className="btn sm" onClick={() => navigate(`/users/${u.id}`)}>查看</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.data.rows.length ? <div className="table-empty">没有匹配的用户。请尝试完整用户 ID 或手机号。</div> : null}
            <div style={{ padding: '0 12px' }}><Pager page={data.data.page} pageSize={data.data.pageSize} total={data.data.total} onPage={setPage} /></div>
          </div>
        ) : null}
      </div>
    </>
  )
}

import { useState } from 'react'
import { ApiError, api, fmt, useApi } from '../api'
import { useRouter } from '../App'
import { Card, Chip, CopyButton, Empty, ErrorBox, Loading, PageHead, toast } from '../ui'

type AdminRow = { id: string; username: string; role: string; status: string; totpEnabled: boolean; createdAtMs: number; lastLoginAtMs: number | null }
const ROLES = [['owner', '负责人'], ['ops', '运营'], ['support', '客服'], ['reviewer', '内容审核'], ['viewer', '只读']] as const
const ROLE_LABEL = Object.fromEntries(ROLES)

export function Admins() {
  const data = useApi<{ rows: AdminRow[] }>('/admins')
  const [form, setForm] = useState({ username: '', password: '', role: 'ops' })
  const [busy, setBusy] = useState(false)
  const [temp, setTemp] = useState<{ username: string; temporaryPassword: string } | null>(null)

  async function create() {
    setBusy(true)
    try {
      await api('/admins', { method: 'POST', body: form })
      toast('管理员已创建')
      setForm({ username: '', password: '', role: 'ops' })
      data.reload()
    } catch (e) { toast((e as ApiError).message, 'error') } finally { setBusy(false) }
  }
  async function patch(a: AdminRow, body: Record<string, unknown>) {
    try { await api(`/admins/${a.id}`, { method: 'PATCH', body }); data.reload(); toast('已更新') } catch (e) { toast((e as ApiError).message, 'error') }
  }
  async function reset(a: AdminRow) {
    try {
      const r = await api<{ username: string; temporaryPassword: string }>(`/admins/${a.id}/reset-password`, { method: 'POST', body: {} })
      setTemp(r); data.reload()
    } catch (e) { toast((e as ApiError).message, 'error') }
  }
  async function revoke(a: AdminRow) {
    try { const r = await api<{ revoked: number }>(`/admins/${a.id}/revoke-sessions`, { method: 'POST' }); toast(`已撤销 ${r.revoked} 个会话`) } catch (e) { toast((e as ApiError).message, 'error') }
  }

  return (
    <>
      <PageHead title="管理员与角色" desc="权限在服务端逐路由校验；隐藏按钮不是安全措施。" />
      <div className="stack">
        <Card title="新建管理员" sub="密码至少 12 位；首次登录后建议立即启用 TOTP">
          <div className="filterbar">
            <label className="field"><span>用户名</span><input value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} data-testid="admin-username" /></label>
            <label className="field grow"><span>初始密码</span><input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} data-testid="admin-password" /></label>
            <label className="field"><span>角色</span><select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>{ROLES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <button className="btn primary" onClick={create} disabled={busy || !form.username || form.password.length < 12} data-testid="admin-create">创建</button>
          </div>
        </Card>
        {temp ? (
          <div className="banner warn">
            临时密码（仅显示一次）：<b className="mono">{temp.temporaryPassword}</b> · 用户 {temp.username}
            <button className="btn sm" style={{ marginLeft: 10 }} onClick={() => setTemp(null)}>我已记录</button>
          </div>
        ) : null}
        {data.error ? <ErrorBox error={data.error} onRetry={data.reload} /> : null}
        {data.loading && !data.data ? <Loading /> : null}
        {data.data ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>用户名</th><th>角色</th><th>状态</th><th>TOTP</th><th>最近登录</th><th>创建时间</th><th></th></tr></thead>
              <tbody>{data.data.rows.map(a => (
                <tr key={a.id}>
                  <td>{a.username}</td>
                  <td>
                    <select className="btn sm" value={a.role} onChange={e => patch(a, { role: e.target.value })} data-testid={`admin-role-${a.username}`}>
                      {ROLES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </td>
                  <td><Chip kind={a.status === 'ACTIVE' ? 'ok' : 'mute'}>{a.status === 'ACTIVE' ? '启用' : '停用'}</Chip></td>
                  <td>{a.totpEnabled ? <Chip kind="ok">已启用</Chip> : <Chip kind="mute">未启用</Chip>}</td>
                  <td>{fmt.time(a.lastLoginAtMs)}</td>
                  <td>{fmt.time(a.createdAtMs)}</td>
                  <td className="nowrap">
                    <button className="btn sm" onClick={() => patch(a, { status: a.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' })}>{a.status === 'ACTIVE' ? '停用' : '启用'}</button>{' '}
                    <button className="btn sm" onClick={() => reset(a)}>重置密码</button>{' '}
                    <button className="btn sm" onClick={() => revoke(a)}>撤销会话</button>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : null}
      </div>
    </>
  )
}

export function Environment() {
  const { session } = useRouter()
  const health = useApi<any>('/health')
  if (health.loading && !health.data) return <Loading />
  if (health.error) return <ErrorBox error={health.error} onRetry={health.reload} />
  if (!health.data) return null
  const h = health.data
  return (
    <>
      <PageHead title="环境与版本" desc="只读：服务健康、阶段、版本与快照；部署仍需负责人执行。" actions={<button className="btn" onClick={health.reload}>刷新</button>} />
      <div className="stack">
        <Card title="环境">
          <div className="kv kv-3">
            <div><dt>后台环境</dt><dd>{session.user.environment === 'production' ? '正式环境' : '测试环境'}</dd></div>
            <div><dt>发布阶段</dt><dd>{h.stage}</dd></div>
            <div><dt>服务器时间</dt><dd>{fmt.time(Date.parse(h.serverTime))}</dd></div>
            <div><dt>客户端构建</dt><dd className="mono">{h.versions?.clientBuild ?? '—'}</dd></div>
            <div><dt>内容配置</dt><dd className="mono">{h.versions?.configVersion ?? '—'}</dd></div>
            <div><dt>包版本</dt><dd className="mono">{h.versions?.packageVersion ?? '—'}</dd></div>
          </div>
        </Card>
        <Card title="服务健康">
          <div className="stack" style={{ gap: 8 }}>
            {Object.entries(h.services).map(([k, v]: [string, any]) => (
              <div className="row" key={k}>
                <span style={{ width: 120 }} className="muted">{serviceName(k)}</span>
                <Chip kind={!v.configured ? 'mute' : v.ok ? 'ok' : 'danger'}>{!v.configured ? '未配置' : v.ok ? '正常' : '异常'}</Chip>
                {v.status ? <span className="dim mono">HTTP {v.status}</span> : null}
              </div>
            ))}
          </div>
        </Card>
        <Card title="快照与指标">
          <div className="kv kv-3">
            <div><dt>快照生成</dt><dd>{h.snapshot.generatedAt ? fmt.time(Date.parse(h.snapshot.generatedAt)) : '未生成'}</dd></div>
            <div><dt>快照年龄</dt><dd>{h.snapshot.ageMs === null ? '—' : `${Math.round(h.snapshot.ageMs / 60000)} 分钟`}</dd></div>
            <div><dt>指标计算</dt><dd>{h.metrics.computedAt ? fmt.time(h.metrics.computedAt) : '未计算'}</dd></div>
          </div>
        </Card>
        <Card title="安全提示">
          <div className="banner warn">请确认 nginx 没有把 Nakama Console（/console/）暴露到公网；后台在生产环境必须走 IP 白名单或 VPN。</div>
          <div className="hint" style={{ marginTop: 8 }}>部署顺序：先部署接受旧客户端版本的服务器 → 部署新前端并冒烟 → 最后提高 BCY_MIN_CLIENT_BUILD。</div>
        </Card>
      </div>
    </>
  )
}

function serviceName(k: string) {
  return ({ adminDb: '后台数据库', nakamaDb: 'Nakama 库', authDb: '认证库', authService: '认证服务' } as Record<string, string>)[k] ?? k
}

export function Me() {
  const { session, setSession } = useRouter()
  const me = useApi<{ user: any; sessions: Array<any> }>('/me')
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [busy, setBusy] = useState(false)
  const [totp, setTotp] = useState<{ secret: string; uri: string } | null>(null)
  const [code, setCode] = useState('')

  async function changePassword() {
    setBusy(true)
    try {
      await api('/me/password', { method: 'POST', body: { currentPassword: current, newPassword: next } })
      setCurrent(''); setNext('')
      toast('密码已修改；其他会话已撤销')
      const s = await api<any>('/session'); setSession(s); me.reload()
    } catch (e) { toast((e as ApiError).message, 'error') } finally { setBusy(false) }
  }
  async function setupTotp() {
    try { const r = await api<{ secret: string; uri: string }>('/me/totp/setup', { method: 'POST' }); setTotp(r) } catch (e) { toast((e as ApiError).message, 'error') }
  }
  async function enableTotp() {
    try {
      await api('/me/totp/enable', { method: 'POST', body: { code } })
      toast('TOTP 已启用'); setTotp(null); setCode('')
      const s = await api<any>('/session'); setSession(s); me.reload()
    } catch (e) { toast((e as ApiError).message, 'error') }
  }
  async function disableTotp() {
    try {
      await api('/me/totp/disable', { method: 'POST', body: { code } })
      toast('TOTP 已关闭'); setCode('')
      const s = await api<any>('/session'); setSession(s); me.reload()
    } catch (e) { toast((e as ApiError).message, 'error') }
  }
  async function revokeSession(id: string) {
    try { await api(`/me/sessions/${id}`, { method: 'DELETE' }); toast('会话已撤销'); me.reload() } catch (e) { toast((e as ApiError).message, 'error') }
  }

  const sessions = me.data?.sessions
  return (
    <>
      <PageHead title="我的账号" desc={`${session.user.username} · ${ROLE_LABEL[session.user.role] ?? session.user.role}`} />
      <div className="grid grid-2">
        <Card title="修改密码">
          <label className="field"><span>当前密码</span><input type="password" value={current} onChange={e => setCurrent(e.target.value)} /></label>
          <label className="field"><span>新密码（至少 12 位）</span><input type="password" value={next} onChange={e => setNext(e.target.value)} /></label>
          <button className="btn primary" onClick={changePassword} disabled={busy || !current || next.length < 12}>保存</button>
          <div className="hint" style={{ marginTop: 8 }}>修改密码会撤销除当前会话外的所有登录。</div>
        </Card>
        <Card title="动态验证码（TOTP）">
          <div className="row-wrap" style={{ marginBottom: 10 }}>
            <Chip kind={session.user.totpEnabled ? 'ok' : 'mute'}>{session.user.totpEnabled ? '已启用' : '未启用'}</Chip>
            <span className="hint">启用后登录需要 6 位动态验证码。</span>
          </div>
          {!session.user.totpEnabled ? (
            <>
              <button className="btn" onClick={setupTotp}>生成密钥</button>
              {totp ? (
                <div style={{ marginTop: 12 }}>
                  <div className="hint">密钥（添加到验证器）：</div>
                  <div className="row"><span className="mono" data-testid="totp-secret">{totp.secret}</span><CopyButton text={totp.secret} /></div>
                  <div className="hint" style={{ marginTop: 6, wordBreak: 'break-all' }}>{totp.uri}</div>
                  <label className="field" style={{ marginTop: 10 }}><span>输入验证码启用</span><input value={code} onChange={e => setCode(e.target.value)} maxLength={6} inputMode="numeric" /></label>
                  <button className="btn primary" onClick={enableTotp} disabled={code.length !== 6}>启用</button>
                </div>
              ) : null}
            </>
          ) : (
            <>
              <label className="field"><span>输入当前验证码关闭</span><input value={code} onChange={e => setCode(e.target.value)} maxLength={6} inputMode="numeric" /></label>
              <button className="btn danger" onClick={disableTotp} disabled={code.length !== 6}>关闭 TOTP</button>
            </>
          )}
        </Card>
      </div>
      <Card title="登录会话" sub="最多显示 50 条" className="flush" >
        {sessions?.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>登录时间</th><th>最后活动</th><th>到期</th><th>IP hash</th><th></th></tr></thead>
              <tbody>{sessions.map(s => (
                <tr key={s.id}>
                  <td>{fmt.time(s.createdAtMs)}</td><td>{fmt.time(s.lastSeenAtMs)}</td><td>{fmt.time(s.expiresAtMs)}</td>
                  <td className="mono dim">{s.ipHash ?? '—'}</td>
                  <td><button className="btn sm" onClick={() => revokeSession(s.id)}>撤销</button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <Empty title="没有活动会话" hint="刷新页面后这里会显示当前会话。" />}
      </Card>
    </>
  )
}

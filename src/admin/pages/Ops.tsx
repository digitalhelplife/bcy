import { useEffect, useState } from 'react'
import { ApiError, api, FEEDBACK_LABELS, fmt, qs, readQuery, syncQuery, useApi } from '../api'
import { useRouter } from '../App'
import { Card, Chip, Drawer, Empty, ErrorBox, FeedbackChip, Funnel, Heatmap, LineChart, Loading, PageHead, Pager, SourceBadge, toast } from '../ui'

type Summary = {
  range: { from: string; to: string; days: number }
  kpis: Array<{ key: string; label: string; value: number; unit: string; delta: number | null; source: string }>
  series: { days: string[]; dau: number[]; newUsers: number[] }
  funnel: Array<{ key: string; label: string; count: number; source: string }>
  retention: { offsets: number[]; rows: Array<{ cohortDay: string; cohortSize: number; values: Record<string, number> }>; d1: number; d7: number }
  sources: { consentBias: boolean; note: string }
  computedAt: number | null
}
type Definition = { key: string; label: string; definition: string; source: string; caveat: string }

export function Metrics() {
  const { session } = useRouter()
  const [days, setDays] = useState(7)
  const [defsOpen, setDefsOpen] = useState(false)
  const data = useApi<Summary>(`/metrics/summary?days=${days}`, [days])
  const defs = useApi<{ definitions: Definition[] }>('/metrics/definitions')

  async function exportCsv() {
    const r = await fetch(`/admin/api/metrics/export.csv?days=${days}`, { credentials: 'same-origin' })
    if (!r.ok) { toast('导出失败', 'error'); return }
    const blob = await r.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `bencaoyou-metrics-${days}d.csv`; a.click()
    URL.revokeObjectURL(url)
    toast('已导出聚合 CSV（不含用户 ID）')
  }

  async function recompute() {
    try { await api('/metrics/recompute', { method: 'POST' }); toast('指标已重算'); data.reload() } catch (e) { toast((e as ApiError).message, 'error') }
  }

  return (
    <>
      <PageHead title="数据看板" desc="每个数字都带来源与口径；埋点指标只覆盖已同意“帮助改进体验”的用户。" actions={<>
        <select className="btn" value={days} onChange={e => setDays(Number(e.target.value))} data-testid="metrics-range">
          <option value={7}>近 7 天</option><option value={30}>近 30 天</option><option value={90}>近 90 天</option>
        </select>
        <button className="btn" onClick={exportCsv}>导出 CSV</button>
        <button className="btn" onClick={() => setDefsOpen(true)}>指标口径</button>
        {session.user.role === 'owner' ? <button className="btn" onClick={recompute}>重算</button> : null}
      </>} />
      {data.error ? <ErrorBox error={data.error} onRetry={data.reload} /> : null}
      {data.loading && !data.data ? <Loading /> : null}
      {data.data ? (
        <div className="stack">
          <div className="kpis">
            {data.data.kpis.map(k => (
              <div className="kpi" key={k.key}>
                <div className="kpi-label">{k.label}<SourceBadge source={k.source} /></div>
                <div className="kpi-value">{k.unit === '%' ? fmt.pct(k.value) : fmt.num(k.value)}</div>
                <div className="kpi-foot">
                  {k.delta === null ? <span className="dim">无环比</span> : <span className={k.delta >= 0 ? 'delta-up' : 'delta-down'}>{k.delta >= 0 ? '▲' : '▼'} {Math.abs(k.delta)}%</span>}
                  <span className="dim">环比</span>
                </div>
              </div>
            ))}
          </div>
          <div className="grid grid-2">
            <Card title="活跃与新增" sub={`${data.data.range.from} → ${data.data.range.to}`}>
              <LineChart days={data.data.series.days} series={[
                { name: '活跃用户', values: data.data.series.dau }, { name: '新增用户', values: data.data.series.newUsers },
              ]} height={220} />
            </Card>
            <Card title="漏斗" sub="分母为区间新增用户">
              <Funnel steps={data.data.funnel} />
              <div className="banner warn" style={{ marginTop: 12 }}>{data.data.sources.note}</div>
            </Card>
          </div>
          <Card title="留存" sub={`D1 ${fmt.pct(data.data.retention.d1)} · D7 ${fmt.pct(data.data.retention.d7)}`}>
            <Heatmap rows={data.data.retention.rows} offsets={data.data.retention.offsets} />
          </Card>
          <div className="hint">指标计算时间：{data.data.computedAt ? fmt.time(data.data.computedAt) : '未计算'}</div>
        </div>
      ) : null}
      {defsOpen ? (
        <Drawer title="指标口径" onClose={() => setDefsOpen(false)}>
          {defs.loading ? <Loading /> : (
            <div className="stack" style={{ gap: 12 }}>
              {(defs.data?.definitions ?? []).map(d => (
                <div className="card" key={d.key} style={{ padding: 14 }}>
                  <div className="row"><b>{d.label}</b><span className="mono dim">{d.key}</span><span className="spacer" /><SourceBadge source={d.source} /></div>
                  <div className="muted" style={{ marginTop: 6 }}>{d.definition}</div>
                  <div className="hint">已知偏差：{d.caveat}</div>
                </div>
              ))}
            </div>
          )}
        </Drawer>
      ) : null}
    </>
  )
}

type FeedbackList = {
  total: number; page: number; pageSize: number
  counts: Record<string, number>
  assignees: Array<{ id: string; username: string; role: string }>
  rows: Array<{ ownerId: string; key: string; atMs: number; excerpt: string; status: string; clientBuild: string | null; assigneeId: string | null; assigneeName: string | null; retentionOverdue: boolean; user: { id: string; username: string | null; loginMethod: string } }>
}
type FeedbackDetail = {
  ownerId: string; key: string; atMs: number; text: string; contactMasked: string; contactPresent: boolean
  clientBuild: string | null; storedStatus: string; status: string; assigneeId: string | null; note: string | null
  updatedAtMs: number | null; retentionDueAtMs: number | null; retentionOverdue: boolean
  user: { id: string; username: string | null; loginMethod: string } | null
  audit: Array<{ id: number; actorName: string | null; action: string; outcome: string; createdAtMs: number }>
}

function initialFeedbackFilters() {
  const q = readQuery()
  return { status: q.status ?? '', q: q.q ?? '', from: q.from ?? '', to: q.to ?? '' }
}

export function Feedback() {
  const { navigate, session } = useRouter()
  const [status, setStatus] = useState(initialFeedbackFilters().status)
  const [q, setQ] = useState(initialFeedbackFilters().q)
  const [from, setFrom] = useState(initialFeedbackFilters().from)
  const [to, setTo] = useState(initialFeedbackFilters().to)
  const [applied, setApplied] = useState(initialFeedbackFilters)
  const [page, setPage] = useState(1)
  const [reconciling, setReconciling] = useState(false)
  const [selected, setSelected] = useState<{ ownerId: string; key: string } | null>(null)
  const list = useApi<FeedbackList>(`/feedback${qs({ ...applied, page, pageSize: 50 })}`, [applied, page])
  const detail = useApi<FeedbackDetail>(selected ? `/feedback/${encodeURIComponent(selected.ownerId)}/${encodeURIComponent(selected.key)}` : null, [selected])
  const [form, setForm] = useState({ status: 'NEW', assigneeId: '', note: '' })
  const [reason, setReason] = useState('')
  const [revealed, setRevealed] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!detail.data) return
    setForm({ status: detail.data.status, assigneeId: detail.data.assigneeId ?? '', note: detail.data.note ?? '' })
    setRevealed(null)
    setReason('')
  }, [detail.data])

  async function save() {
    if (!selected) return
    setSaving(true)
    try {
      await api(`/feedback/${encodeURIComponent(selected.ownerId)}/${encodeURIComponent(selected.key)}`, {
        method: 'PATCH', body: { status: form.status, assigneeId: form.assigneeId || null, note: form.note },
      })
      toast('反馈状态已保存')
      detail.reload(); list.reload()
    } catch (e) { toast((e as ApiError).message, 'error') } finally { setSaving(false) }
  }

  async function reveal() {
    if (!selected) return
    try {
      const r = await api<{ contact: string }>(`/feedback/${encodeURIComponent(selected.ownerId)}/${encodeURIComponent(selected.key)}/reveal-contact`, { method: 'POST', body: { reason } })
      setRevealed(r.contact)
      toast('已揭示联系方式（已记录审计）')
    } catch (e) { toast((e as ApiError).message, 'error') }
  }

  function applyFilters() {
    setPage(1)
    const next = { status, q, from, to }
    setApplied(next)
    syncQuery(next)
  }
  function resetFilters() {
    setStatus(''); setQ(''); setFrom(''); setTo('')
    setApplied({ status: '', q: '', from: '', to: '' }); setPage(1)
    syncQuery({})
  }
  async function reconcile() {
    setReconciling(true)
    try {
      const r = await api<{ removed: number }>('/jobs/reconcile-feedback', { method: 'POST' })
      toast(r.removed ? `已清理 ${r.removed} 条失效状态` : '没有需要清理的记录')
      list.reload()
    } catch (e) { toast((e as ApiError).message, 'error') } finally { setReconciling(false) }
  }

  const counts = list.data?.counts ?? {}
  return (
    <>
      <PageHead title="反馈收件箱" desc="游戏内没有回复通道；这里负责分派、备注与关闭。" actions={
        session.user.role === 'owner'
          ? <button className="btn" onClick={reconcile} disabled={reconciling}>{reconciling ? '对账中…' : '对账失效状态'}</button>
          : null
      } />
      <div className="stack">
        <div className="kpis" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))' }}>
          {(['NEW', 'IN_PROGRESS', 'RESOLVED', 'ARCHIVED'] as const).map(k => (
            <div className="kpi" key={k}><div className="kpi-label">{FEEDBACK_LABELS[k]}</div><div className="kpi-value">{counts[k] ?? 0}</div><div className="kpi-foot">点击筛选</div></div>
          ))}
        </div>
        <Card>
          <div className="filterbar">
            <label className="field"><span>状态</span>
              <select value={status} onChange={e => setStatus(e.target.value)} data-testid="feedback-status-filter">
                <option value="">全部</option>{Object.entries(FEEDBACK_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label className="field grow"><span>搜索</span><input value={q} onChange={e => setQ(e.target.value)} placeholder="反馈正文或用户 ID" onKeyDown={e => { if (e.key === 'Enter') applyFilters() }} data-testid="feedback-q" /></label>
            <label className="field"><span>起</span><input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
            <label className="field"><span>止</span><input type="date" value={to} onChange={e => setTo(e.target.value)} /></label>
            <button className="btn primary" onClick={applyFilters} data-testid="feedback-apply">筛选</button>
            <button className="btn" onClick={resetFilters}>重置</button>
          </div>
        </Card>
        {list.error ? <ErrorBox error={list.error} onRetry={list.reload} /> : null}
        {list.loading && !list.data ? <Loading /> : null}
        {list.data ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>时间</th><th>用户</th><th>摘要</th><th>状态</th><th>版本</th><th>处理人</th><th></th></tr></thead>
              <tbody>{list.data.rows.map(r => (
                <tr key={`${r.ownerId}/${r.key}`}>
                  <td className="nowrap">{fmt.time(r.atMs)}</td>
                  <td><button className="btn link mono" onClick={() => navigate(`/users/${r.ownerId}`)}>{fmt.short(r.ownerId, 8)}</button><div className="sub">{r.user.username ?? r.user.loginMethod}</div></td>
                  <td style={{ maxWidth: 380 }}><div className="ellipsis">{r.excerpt}</div></td>
                  <td><FeedbackChip status={r.status} />{r.retentionOverdue ? <Chip kind="danger" plain>超期</Chip> : null}</td>
                  <td className="mono dim">{r.clientBuild ?? '—'}</td>
                  <td>{r.assigneeName ?? '—'}</td>
                  <td><button className="btn sm" onClick={() => setSelected({ ownerId: r.ownerId, key: r.key })} data-testid="feedback-open">处理</button></td>
                </tr>
              ))}</tbody>
            </table>
            {!list.data.rows.length ? <div className="table-empty">没有匹配的反馈</div> : null}
            <div style={{ padding: '0 12px' }}><Pager page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} /></div>
          </div>
        ) : null}
      </div>

      {selected ? (
        <Drawer title="反馈详情" onClose={() => setSelected(null)} footer={<>
          <button className="btn" onClick={() => setSelected(null)}>关闭</button>
          <button className="btn primary" onClick={save} disabled={saving} data-testid="feedback-save">{saving ? '保存中…' : '保存状态'}</button>
        </>}>
          {detail.loading && !detail.data ? <Loading /> : null}
          {detail.error ? <ErrorBox error={detail.error} onRetry={detail.reload} /> : null}
          {detail.data ? (
            <div className="stack" style={{ gap: 14 }}>
              <div className="row-wrap">
                <FeedbackChip status={detail.data.status} />
                {detail.data.retentionOverdue ? <Chip kind="danger">超过 180 天保留期</Chip> : null}
                <span className="dim">{fmt.time(detail.data.atMs)}</span>
                {detail.data.clientBuild ? <span className="mono dim">{detail.data.clientBuild}</span> : null}
                <span className="spacer" />
                {detail.data.user ? <button className="btn sm" onClick={() => navigate(`/users/${detail.data!.user!.id}`)}>查看用户</button> : null}
              </div>
              <div className="card" style={{ padding: 14 }}>
                <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7 }} data-testid="feedback-text">{detail.data.text}</div>
              </div>
              <div>
                <div className="section-title">联系方式</div>
                <div className="row-wrap">
                  <span>{revealed ?? detail.data.contactMasked ?? '未填写'}</span>
                  {detail.data.contactPresent && !revealed ? (
                    <>
                      <input className="btn" style={{ minWidth: 220 }} placeholder="查看原因（必填）" value={reason} onChange={e => setReason(e.target.value)} data-testid="feedback-reason" />
                      <button className="btn" onClick={reveal} disabled={reason.trim().length < 2} data-testid="feedback-reveal">揭示</button>
                    </>
                  ) : null}
                </div>
                <div className="hint">联系方式默认脱敏；揭示需要填写原因并写入审计，不能导出。</div>
              </div>
              <div className="divider" />
              <div className="grid grid-2">
                <label className="field"><span>状态</span>
                  <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })} data-testid="feedback-status">
                    {Object.entries(FEEDBACK_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </label>
                <label className="field"><span>处理人</span>
                  <select value={form.assigneeId} onChange={e => setForm({ ...form, assigneeId: e.target.value })}>
                    <option value="">未分派</option>
                    {(list.data?.assignees ?? []).map(a => <option key={a.id} value={a.id}>{a.username}（{a.role}）</option>)}
                  </select>
                </label>
              </div>
              <label className="field"><span>内部备注</span>
                <textarea value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} placeholder="仅后台可见，不会发给用户" data-testid="feedback-note" />
              </label>
              <div>
                <div className="section-title">操作记录</div>
                {detail.data.audit.length ? detail.data.audit.map(a => (
                  <div key={a.id} className="row" style={{ fontSize: 12.5, padding: '3px 0' }}>
                    <span className="dim">{fmt.time(a.createdAtMs)}</span><span>{a.actorName ?? '—'}</span><span className="mono">{a.action}</span><Chip kind={a.outcome === 'OK' ? 'ok' : 'mute'}>{a.outcome}</Chip>
                  </div>
                )) : <div className="dim">暂无记录</div>}
              </div>
            </div>
          ) : null}
        </Drawer>
      ) : null}
    </>
  )
}

/* ---------------- compliance config ---------------- */
type Compliance = {
  config: { realnameEnabled: boolean; minor: { mode: string; startHour: number; endHour: number; days: number[]; includeHolidays: boolean }; version: number; updatedAtMs: number; updatedBy: string }
  history: Array<{ version: number; config: any; updatedAtMs: number; updatedBy: string; note: string | null }>
  production: boolean
}

export function Config() {
  const { session } = useRouter()
  const data = useApi<Compliance>('/config/compliance')
  const holidays = useApi<any>('/config/holidays')
  const terms = useApi<any>('/config/solar-terms')
  const release = useApi<any>('/release')
  const [form, setForm] = useState<Compliance['config'] | null>(null)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const canWrite = session.user.role === 'owner'

  useEffect(() => { if (data.data) setForm(data.data.config) }, [data.data])

  async function save() {
    if (!form) return
    setSaving(true)
    try {
      await api('/config/compliance', { method: 'PUT', body: { config: { realnameEnabled: form.realnameEnabled, minor: form.minor }, expectedVersion: form.version, note } })
      toast('合规配置已保存')
      setNote('')
      data.reload()
    } catch (e) {
      const err = e as ApiError
      toast(err.message, 'error')
    } finally { setSaving(false) }
  }

  const WK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  return (
    <>
      <PageHead title="合规与日历" desc="合规配置的写入仍由 bencao-auth 执行；后台只做代理，生产护栏在服务端。" />
      <div className="stack">
        {data.error ? <ErrorBox error={data.error} onRetry={data.reload} /> : null}
        {data.loading && !data.data ? <Loading /> : null}
        {data.data && form ? (
          <div className="grid grid-2">
            <Card title="实名认证与未成年人保护" sub={`配置版本 v${form.version} · ${fmt.time(form.updatedAtMs)} · ${form.updatedBy}`}>
              {data.data.production ? <div className="banner danger" style={{ marginBottom: 12 }}>正式环境：实名不能关闭，未成年人限制不能取消。</div> : <div className="banner info" style={{ marginBottom: 12 }}>测试环境：可以关闭实名以设备模式试玩。</div>}
              <label className="check" style={{ marginBottom: 12 }}>
                <input type="checkbox" checked={form.realnameEnabled} disabled={!canWrite} onChange={e => setForm({ ...form, realnameEnabled: e.target.checked })} data-testid="config-realname" />
                开启手机号登录 + 实名认证
              </label>
              <div className="section-title">未成年人策略</div>
              <div className="stack" style={{ gap: 6 }}>
                {[['window', '按时段限制'], ['block', '完全禁止'], ['off', '不限制（仅测试）']].map(([k, label]) => (
                  <label className="check" key={k}>
                    <input type="radio" name="mode" checked={form.minor.mode === k} disabled={!canWrite} onChange={() => setForm({ ...form, minor: { ...form.minor, mode: k } })} />
                    {label}
                  </label>
                ))}
              </div>
              {form.minor.mode === 'window' ? (
                <>
                  <div className="section-title" style={{ marginTop: 12 }}>可游戏的日子</div>
                  <div className="tag-list">
                    {WK.map((label, d) => (
                      <label className="check" key={d} style={{ minWidth: 76 }}>
                        <input type="checkbox" checked={form.minor.days.includes(d)} disabled={!canWrite}
                          onChange={e => setForm({ ...form, minor: { ...form.minor, days: e.target.checked ? [...form.minor.days, d].sort() : form.minor.days.filter(x => x !== d) } })} />
                        {label}
                      </label>
                    ))}
                  </div>
                  <div className="row-wrap" style={{ marginTop: 12 }}>
                    <label className="field" style={{ margin: 0 }}><span>开始</span>
                      <select value={form.minor.startHour} disabled={!canWrite} onChange={e => setForm({ ...form, minor: { ...form.minor, startHour: Number(e.target.value) } })}>
                        {Array.from({ length: 25 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
                      </select>
                    </label>
                    <label className="field" style={{ margin: 0 }}><span>结束</span>
                      <select value={form.minor.endHour} disabled={!canWrite} onChange={e => setForm({ ...form, minor: { ...form.minor, endHour: Number(e.target.value) } })}>
                        {Array.from({ length: 25 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
                      </select>
                    </label>
                    <label className="check" style={{ marginTop: 18 }}><input type="checkbox" checked={form.minor.includeHolidays} disabled={!canWrite} onChange={e => setForm({ ...form, minor: { ...form.minor, includeHolidays: e.target.checked } })} />包含法定节假日</label>
                  </div>
                </>
              ) : null}
              <div className="divider" />
              <label className="field"><span>变更说明（可选）</span><input value={note} onChange={e => setNote(e.target.value)} maxLength={200} placeholder="例如：内测阶段调整时段" /></label>
              <button className="btn primary" onClick={save} disabled={!canWrite || saving} data-testid="config-save">{saving ? '保存中…' : canWrite ? '保存配置' : '仅负责人可保存'}</button>
            </Card>
            <Card title="变更历史" sub="最近 20 次">
              {data.data.history.length ? (
                <div className="stack" style={{ gap: 8 }}>
                  {data.data.history.map(h => (
                    <div key={h.version} style={{ borderBottom: '1px solid var(--line)', paddingBottom: 8 }}>
                      <div className="row"><b>v{h.version}</b><span className="dim">{fmt.time(h.updatedAtMs)}</span><span className="dim">{h.updatedBy}</span></div>
                      <div className="muted" style={{ fontSize: 12.5 }}>{h.config?.realnameEnabled ? '实名开启' : '实名关闭'} · {h.config?.minor?.mode}</div>
                      {h.note ? <div className="hint">{h.note}</div> : null}
                    </div>
                  ))}
                </div>
              ) : <Empty title="还没有历史记录" />}
            </Card>
          </div>
        ) : null}

        <div className="grid grid-2">
          <Card title="节假日（只读）" sub={holidays.data ? `覆盖 ${holidays.data.coverage?.from ?? '?'} → ${holidays.data.coverage?.to ?? '?'}` : undefined}>
            {holidays.loading ? <Loading /> : holidays.data ? (
              <>
                <div className="stat-inline">
                  <div><b>{Array.isArray(holidays.data.dates) ? holidays.data.dates.length : '—'}</b><span>放假日</span></div>
                  <div><b>{holidays.data.configVersion}</b><span>数据版本</span></div>
                </div>
                <div className="hint" style={{ marginTop: 8 }}>来源：{holidays.data.source?.publisher ?? '—'} · {holidays.data.source?.title ?? ''}</div>
                <div className="banner warn" style={{ marginTop: 10 }}>编辑仍在 content/holidays.json + 部署，后台只读。</div>
              </>
            ) : <Empty title="没有节假日数据" />}
          </Card>
          <Card title="节气（只读）" sub={terms.data ? `${terms.data.occurrences?.length ?? 0} 个交节时刻` : undefined}>
            {terms.loading ? <Loading /> : terms.data ? (
              <>
                <div className="stat-inline">
                  <div><b>{(terms.data.occurrences ?? []).filter((o: any) => o.verified).length}</b><span>已验证</span></div>
                  <div><b>{(terms.data.occurrences ?? []).filter((o: any) => !o.verified).length}</b><span>算法推算</span></div>
                  <div><b>{terms.data.computedMaxDeviationMinutes ?? '—'}</b><span>最大偏差（分钟）</span></div>
                </div>
                <div className="hint" style={{ marginTop: 8 }}>{terms.data.calendarNote}</div>
              </>
            ) : <Empty title="没有节气数据" />}
          </Card>
        </div>

        <Card title="客户端版本（只读）" sub="发布顺序：先服务器，再前端，最后提高最低客户端版本">
          {release.data ? (
            <div className="row-wrap">
              <span className="mono">CLIENT_BUILD {release.data.versions?.clientBuild ?? '—'}</span>
              <span className="mono">CONFIG_VERSION {release.data.versions?.configVersion ?? '—'}</span>
              <span className="mono">package {release.data.versions?.packageVersion ?? '—'}</span>
              <span className="source-badge">阶段 {release.data.stage}</span>
            </div>
          ) : <Loading />}
        </Card>
      </div>
    </>
  )
}

/* ---------------- audit ---------------- */
type AuditRow = { id: number; actorId: string | null; actorName: string | null; action: string; targetType: string | null; targetId: string | null; outcome: string; ipHash: string | null; metadata: any; createdAtMs: number }

export function Audit() {
  const initialAudit = () => {
    const q = readQuery()
    return { actor: q.actor ?? '', action: q.action ?? '', outcome: q.outcome ?? '', targetId: q.targetId ?? '', from: q.from ?? '', to: q.to ?? '' }
  }
  const [form, setForm] = useState(initialAudit)
  const [applied, setApplied] = useState(initialAudit)
  const [page, setPage] = useState(1)
  const data = useApi<{ total: number; page: number; pageSize: number; rows: AuditRow[] }>(`/audit${qs({ ...applied, page, pageSize: 50 })}`, [applied, page])

  async function exportCsv() {
    const r = await fetch(`/admin/api/audit/export.csv${qs({ from: applied.from, to: applied.to })}`, { credentials: 'same-origin' })
    if (!r.ok) { toast('导出失败', 'error'); return }
    const blob = await r.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'admin-audit.csv'; a.click(); URL.revokeObjectURL(url)
    toast('审计日志已导出')
  }

  return (
    <>
      <PageHead title="审计日志" desc="登录、查看用户、手机号查询、联系方式揭示、配置与推广变更都会记录。" actions={<button className="btn" onClick={exportCsv}>导出 CSV</button>} />
      <div className="stack">
        <Card>
          <div className="filterbar">
            <label className="field"><span>操作者</span><input value={form.actor} onChange={e => setForm({ ...form, actor: e.target.value })} placeholder="用户名" /></label>
            <label className="field"><span>动作</span><input value={form.action} onChange={e => setForm({ ...form, action: e.target.value })} placeholder="users.view" /></label>
            <label className="field"><span>结果</span><select value={form.outcome} onChange={e => setForm({ ...form, outcome: e.target.value })}><option value="">全部</option><option value="OK">OK</option><option value="FAILED">FAILED</option><option value="DENIED">DENIED</option><option value="NOT_FOUND">NOT_FOUND</option></select></label>
            <label className="field"><span>目标 ID</span><input value={form.targetId} onChange={e => setForm({ ...form, targetId: e.target.value })} /></label>
            <label className="field"><span>起</span><input type="date" value={form.from} onChange={e => setForm({ ...form, from: e.target.value })} /></label>
            <label className="field"><span>止</span><input type="date" value={form.to} onChange={e => setForm({ ...form, to: e.target.value })} /></label>
            <button className="btn primary" onClick={() => { setPage(1); setApplied({ ...form }); syncQuery(form) }} data-testid="audit-apply">筛选</button>
            <button className="btn" onClick={() => { const e = { actor: '', action: '', outcome: '', targetId: '', from: '', to: '' }; setForm(e); setApplied(e); setPage(1); syncQuery({}) }}>重置</button>
          </div>
        </Card>
        {data.error ? <ErrorBox error={data.error} onRetry={data.reload} /> : null}
        {data.loading && !data.data ? <Loading /> : null}
        {data.data ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>时间</th><th>操作者</th><th>动作</th><th>目标</th><th>结果</th><th>IP hash</th></tr></thead>
              <tbody>{data.data.rows.map(r => (
                <tr key={r.id}>
                  <td className="nowrap">{fmt.time(r.createdAtMs)}</td>
                  <td>{r.actorName ?? '—'}</td>
                  <td className="mono">{r.action}</td>
                  <td className="mono dim">{r.targetType ? `${r.targetType}:${r.targetId ?? ''}` : r.targetId ?? '—'}</td>
                  <td><Chip kind={r.outcome === 'OK' ? 'ok' : r.outcome === 'DENIED' || r.outcome === 'FAILED' ? 'danger' : 'mute'}>{r.outcome}</Chip></td>
                  <td className="mono dim">{r.ipHash ?? '—'}</td>
                </tr>
              ))}</tbody>
            </table>
            {!data.data.rows.length ? <div className="table-empty">没有匹配的审计记录</div> : null}
            <div style={{ padding: '0 12px' }}><Pager page={data.data.page} pageSize={data.data.pageSize} total={data.data.total} onPage={setPage} /></div>
          </div>
        ) : null}
      </div>
    </>
  )
}

import { useState } from 'react'
import { api, fmt, useApi } from '../api'
import { useRouter } from '../App'
import { Card, Chip, Drawer, ErrorBox, Loading, PageHead, SourceBadge, Sparkline, LineChart, Funnel, Heatmap, Empty, FeedbackChip } from '../ui'

type Kpi = { key: string; label: string; value: number; unit: string; delta: number | null; source: string }
type Summary = {
  range: { from: string; to: string; days: number }
  kpis: Kpi[]
  series: { days: string[]; dau: number[]; newUsers: number[] }
  funnel: Array<{ key: string; label: string; count: number; source: string }>
  retention: { offsets: number[]; rows: Array<{ cohortDay: string; cohortSize: number; values: Record<string, number> }>; d1: number; d7: number }
  sources: { consentBias: boolean; note: string }
  computedAt: number | null
}
type OverviewData = {
  stage: string
  summary: Summary
  launch: {
    review: any
    assets: any
    versions: any
    snapshotGeneratedAt: string | null
    blockers: Array<{ code: string; msg: string }>
    warnings: Array<{ code: string; msg: string }>
    preflightPass: boolean | null
  }
  todos: { unresolvedFeedback: number; failedRealname: number; pendingReview: number }
  health: {
    services: Record<string, { configured: boolean; ok: boolean; status?: number }>
    snapshot: { configured: boolean; generatedAt: string | null; ageMs: number | null }
    metrics: { computedAt: number | null; ageMs: number | null }
    versions: any
    stage: string
    serverTime: string
  }
  recentFeedback: Array<{ ownerId: string; key: string; atMs: number; excerpt: string; status: string; clientBuild: string | null }>
}

export function Overview() {
  const { navigate } = useRouter()
  const [days, setDays] = useState(7)
  const ov = useApi<OverviewData>('/overview')
  const sum = useApi<Summary>(`/metrics/summary?days=${days}`, [days])
  const [blockersOpen, setBlockersOpen] = useState(false)
  const [defsOpen, setDefsOpen] = useState(false)
  const [defs, setDefs] = useState<any[] | null>(null)

  if (ov.loading && !ov.data) return <Loading />
  if (ov.error) return <ErrorBox error={ov.error} onRetry={ov.reload} />
  if (!ov.data) return null
  const d = ov.data
  const s = sum.data

  const openDefs = async () => {
    setDefsOpen(true)
    if (!defs) {
      try { const r = await api<{ definitions: any[] }>('/metrics/definitions'); setDefs(r.definitions) } catch { setDefs([]) }
    }
  }

  return (
    <>
      <PageHead
        title="总览"
        desc="内测阶段的早间驾驶舱：先看发布与合规，再看用户与内容。"
        actions={<>
          <select className="btn" value={days} onChange={e => setDays(Number(e.target.value))} data-testid="overview-range">
            <option value={7}>近 7 天</option>
            <option value={30}>近 30 天</option>
          </select>
          <button className="btn" onClick={() => { ov.reload(); sum.reload() }}>刷新</button>
        </>}
      />

      <div className="stack">
        <Card title="发布条" sub="阶段、阻塞项、审核与版本" actions={<button className="btn sm" onClick={() => setBlockersOpen(true)}>查看阻塞清单</button>}>
          <div className="grid grid-4">
            <div>
              <div className="kpi-label">当前阶段</div>
              <div style={{ fontSize: 22, fontFamily: 'var(--serif)' }}>{stageLabel(d.stage)}</div>
              <div className="hint">{d.stage === 'S0' ? '内部试玩，不可公开发布' : '按发布门禁推进'}</div>
            </div>
            <div>
              <div className="kpi-label">发布阻塞项</div>
              <div style={{ fontSize: 22 }} className={d.launch.blockers.length ? 'delta-down' : 'delta-up'}>
                {d.launch.blockers.length}
              </div>
              <div className="hint">{d.launch.preflightPass === null ? '尚未运行 preflight' : d.launch.preflightPass ? 'preflight 通过' : 'preflight 未通过'}</div>
            </div>
            <div>
              <div className="kpi-label">内容审核</div>
              <div style={{ fontSize: 22 }}>
                {d.launch.review ? `${d.launch.review.counts.approved} / ${d.launch.review.counts.total}` : '—'}
              </div>
              <div className="hint">AI 辅助审核 · 人工复审未完成</div>
            </div>
            <div>
              <div className="kpi-label">美术资产覆盖</div>
              <div style={{ fontSize: 22 }}>
                {d.launch.assets ? `${d.launch.assets.withRuntimeFile} / ${d.launch.assets.total}` : '—'}
              </div>
              <div className="hint">有运行时文件 · 许可证 {d.launch.assets?.withLicence ?? 0}</div>
            </div>
          </div>
          <div className="divider" />
          <div className="row-wrap">
            <span className="dim">版本：</span>
            <span className="mono">CLIENT_BUILD {d.launch.versions?.clientBuild ?? '—'}</span>
            <span className="mono">CONFIG {d.launch.versions?.configVersion ?? '—'}</span>
            <span className="mono">commit {String(d.launch.versions?.sourceManifest ?? '').match(/[0-9a-f]{40}/)?.[0]?.slice(0, 8) ?? '—'}</span>
            <span className="dim">快照 {d.launch.snapshotGeneratedAt ? fmt.time(Date.parse(d.launch.snapshotGeneratedAt)) : '未生成'}</span>
          </div>
        </Card>

        {sum.error ? <ErrorBox error={sum.error} onRetry={sum.reload} /> : null}
        {!s ? <Loading label="正在计算指标…" /> : (
          <>
            <div className="kpis">
              {s.kpis.map((k, i) => (
                <div className="kpi" key={k.key} data-testid={`kpi-${k.key}`}>
                  <div className="kpi-label">{k.label}<SourceBadge source={k.source} /></div>
                  <div className="kpi-value">{k.unit === '%' ? fmt.pct(k.value) : fmt.num(k.value)}</div>
                  <div className="kpi-foot">
                    {k.delta === null ? <span className="dim">无环比</span> : (
                      <span className={k.delta >= 0 ? 'delta-up' : 'delta-down'}>{k.delta >= 0 ? '▲' : '▼'} {Math.abs(k.delta)}% <span className="dim">环比</span></span>
                    )}
                  </div>
                  {i === 0 ? <div className="kpi-spark"><Sparkline values={s.series.dau} width={56} height={18} /></div> : null}
                </div>
              ))}
            </div>

            <div className="grid grid-2">
              <Card title="活跃与新增" sub={`${s.range.from} → ${s.range.to}`}>
                <LineChart days={s.series.days} series={[
                  { name: '活跃用户', values: s.series.dau },
                  { name: '新增用户', values: s.series.newUsers },
                ]} />
              </Card>
              <Card title="新手漏斗" sub="分母为区间新增用户；埋点指标仅覆盖已同意用户">
                <Funnel steps={s.funnel} />
                <div className="banner warn" style={{ marginTop: 14 }}>{s.sources.note}</div>
              </Card>
            </div>

            <Card title="留存队列" sub={`D1 ${fmt.pct(s.retention.d1)} · D7 ${fmt.pct(s.retention.d7)}`}>
              <Heatmap rows={s.retention.rows} offsets={s.retention.offsets} />
            </Card>
          </>
        )}

        <div className="grid grid-2">
          <Card title="待办" sub="需要运营或支持处理的条目">
            <div className="stack" style={{ gap: 10 }}>
              <TodoLine label="未处理反馈" value={d.todos.unresolvedFeedback} action={() => navigate('/ops/feedback')} />
              <TodoLine label="待人工复审内容" value={d.todos.pendingReview} action={() => navigate('/content')} />
              <TodoLine label="实名审核失败" value={d.todos.failedRealname} action={() => navigate('/users')} />
            </div>
            <div className="divider" />
            <div className="card-title" style={{ marginBottom: 8 }}>最近反馈</div>
            {d.recentFeedback.length ? d.recentFeedback.map(f => (
              <div key={`${f.ownerId}/${f.key}`} style={{ padding: '7px 0', borderBottom: '1px solid var(--line)' }}>
                <div className="row"><FeedbackChip status={f.status} /><span className="dim" style={{ fontSize: 11 }}>{fmt.time(f.atMs)}</span></div>
                <div className="ellipsis" style={{ marginTop: 2 }}>{f.excerpt}</div>
              </div>
            )) : <Empty title="还没有反馈" hint="游戏内提交反馈后会出现在这里。" />}
          </Card>

          <Card title="系统状态" sub={`服务器时间 ${fmt.time(Date.parse(d.health.serverTime))}`}>
            <div className="stack" style={{ gap: 8 }}>
              {Object.entries(d.health.services).map(([key, v]) => (
                <div className="row" key={key}>
                  <span style={{ width: 100 }} className="muted">{serviceName(key)}</span>
                  <Chip kind={!v.configured ? 'mute' : v.ok ? 'ok' : 'danger'}>{!v.configured ? '未配置' : v.ok ? '正常' : '异常'}</Chip>
                </div>
              ))}
              <div className="row"><span style={{ width: 100 }} className="muted">快照年龄</span><span>{d.health.snapshot.ageMs === null ? '未生成' : ageLabel(d.health.snapshot.ageMs)}</span></div>
              <div className="row"><span style={{ width: 100 }} className="muted">指标更新时间</span><span>{d.health.metrics.computedAt ? fmt.time(d.health.metrics.computedAt) : '尚未计算'}</span></div>
            </div>
            {d.launch.warnings.length ? <div className="banner warn" style={{ marginTop: 12 }}>{d.launch.warnings.length} 条 preflight 警告</div> : null}
            <div style={{ marginTop: 12 }}><button className="btn sm" onClick={openDefs}>指标口径</button></div>
          </Card>
        </div>
      </div>

      {blockersOpen ? (
        <Drawer title="发布阻塞项" onClose={() => setBlockersOpen(false)}>
          {d.launch.blockers.length ? (
            <div className="stack" style={{ gap: 10 }}>
              {d.launch.blockers.map(b => (
                <div key={b.code} className="banner danger"><b className="mono">{b.code}</b><div style={{ marginTop: 4 }}>{b.msg}</div></div>
              ))}
            </div>
          ) : <Empty title="没有阻塞项" hint="preflight 通过。" />}
          {d.launch.warnings.length ? <>
            <div className="section-title" style={{ marginTop: 20 }}>警告</div>
            {d.launch.warnings.map(w => <div key={`${w.code}-${w.msg}`} className="banner warn" style={{ marginBottom: 8 }}><b className="mono">{w.code}</b> {w.msg}</div>)}
          </> : null}
        </Drawer>
      ) : null}

      {defsOpen ? (
        <Drawer title="指标口径" onClose={() => setDefsOpen(false)}>
          {!defs ? <Loading /> : (
            <div className="stack" style={{ gap: 12 }}>
              {defs.map((x: any) => (
                <div key={x.key} className="card" style={{ padding: 14 }}>
                  <div className="row"><b>{x.label}</b><span className="mono dim">{x.key}</span><span className="spacer" /><SourceBadge source={x.source} /></div>
                  <div className="muted" style={{ marginTop: 6, fontSize: 13 }}>{x.definition}</div>
                  <div className="hint">已知偏差：{x.caveat}</div>
                </div>
              ))}
            </div>
          )}
        </Drawer>
      ) : null}
    </>
  )
}

function TodoLine({ label, value, action }: { label: string; value: number; action: () => void }) {
  return (
    <div className="row">
      <span>{label}</span>
      <span className="spacer" />
      <b style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</b>
      <button className="btn sm" onClick={action}>查看</button>
    </div>
  )
}

function stageLabel(s: string) {
  return s === 'S0' ? 'S0 · 内测' : s === 'S1' ? 'S1 · 封闭测试' : s === 'S2' ? 'S2 · 申报' : 'S3 · 公开'
}
function serviceName(k: string) {
  return ({ adminDb: '后台数据库', nakamaDb: 'Nakama 库', authDb: '认证库', authService: '认证服务' } as Record<string, string>)[k] ?? k
}
function ageLabel(ms: number) {
  const m = Math.round(ms / 60_000)
  if (m < 60) return `${m} 分钟前`
  const h = Math.round(m / 60)
  if (h < 48) return `${h} 小时前`
  return `${Math.round(h / 24)} 天前`
}

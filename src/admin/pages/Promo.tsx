import { useState } from 'react'
import { ApiError, api, fmt, useApi } from '../api'
import { Card, Chip, Drawer, Empty, ErrorBox, LineChart, Loading, PageHead, Tabs, toast } from '../ui'

type Tab = 'channels' | 'campaigns' | 'links' | 'data' | 'imports'
type Channel = { id: string; code: string; name: string; platform: string | null; status: string; notes: string | null; createdAtMs: number }
type Campaign = {
  id: string; channelId: string; channelCode?: string; channelName?: string; name: string
  startDay: string | null; endDay: string | null; budgetCents: number | null; landingUrl: string | null
  notes: string | null; status: string; createdAtMs: number
}
type Link = { id: string; campaignId: string; campaignName?: string; channelCode?: string; code: string; url: string; createdBy: string | null; createdAtMs: number }

export function Promo() {
  const [tab, setTab] = useState<Tab>('channels')
  return (
    <>
      <PageHead title="推广" desc="只做链接、二维码与点击计数；游戏内尚未记录渠道，当前不能算渠道漏斗。" />
      <div className="banner warn" style={{ marginBottom: 14 }}>无广告 · 无内购。小红书笔记不得包含链接或二维码；分享无奖励。</div>
      <Tabs<Tab> value={tab} onChange={setTab} items={[
        { key: 'channels', label: '渠道' }, { key: 'campaigns', label: '活动' }, { key: 'links', label: '链接与二维码' },
        { key: 'data', label: '数据' }, { key: 'imports', label: '报表导入' },
      ]} />
      {tab === 'channels' ? <Channels /> : null}
      {tab === 'campaigns' ? <Campaigns /> : null}
      {tab === 'links' ? <Links /> : null}
      {tab === 'data' ? <Data /> : null}
      {tab === 'imports' ? <Imports /> : null}
    </>
  )
}

function Channels() {
  const data = useApi<{ rows: Channel[] }>('/channels')
  const [form, setForm] = useState({ code: '', name: '', platform: '', notes: '' })
  const [busy, setBusy] = useState(false)

  async function create() {
    setBusy(true)
    try {
      await api('/channels', { method: 'POST', body: form })
      toast('渠道已创建')
      setForm({ code: '', name: '', platform: '', notes: '' })
      data.reload()
    } catch (e) { toast((e as ApiError).message, 'error') } finally { setBusy(false) }
  }
  async function toggle(c: Channel) {
    try { await api(`/channels/${c.id}`, { method: 'PATCH', body: { status: c.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE' } }); data.reload() } catch (e) { toast((e as ApiError).message, 'error') }
  }

  return (
    <div className="stack">
      <Card title="新建渠道" sub="代码用于链接参数 ?ch=">
        <div className="filterbar">
          <label className="field"><span>代码</span><input value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} placeholder="xhs_s1" data-testid="channel-code" /></label>
          <label className="field grow"><span>名称</span><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="小红书 S1" data-testid="channel-name" /></label>
          <label className="field"><span>平台</span><select value={form.platform} onChange={e => setForm({ ...form, platform: e.target.value })}><option value="">未指定</option><option value="xiaohongshu">小红书</option><option value="offline">线下</option><option value="other">其他</option></select></label>
          <label className="field grow"><span>备注</span><input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></label>
          <button className="btn primary" onClick={create} disabled={busy || !form.code || !form.name} data-testid="channel-create">创建</button>
        </div>
      </Card>
      {data.error ? <ErrorBox error={data.error} onRetry={data.reload} /> : null}
      {data.loading && !data.data ? <Loading /> : null}
      {data.data ? (
        <div className="table-wrap">
          <table>
            <thead><tr><th>代码</th><th>名称</th><th>平台</th><th>状态</th><th>备注</th><th>创建时间</th><th></th></tr></thead>
            <tbody>{data.data.rows.map(c => (
              <tr key={c.id}>
                <td className="mono">{c.code}</td><td>{c.name}</td><td>{c.platform ?? '—'}</td>
                <td><Chip kind={c.status === 'ACTIVE' ? 'ok' : 'mute'}>{c.status === 'ACTIVE' ? '启用' : '暂停'}</Chip></td>
                <td>{c.notes ?? '—'}</td><td>{fmt.time(c.createdAtMs)}</td>
                <td><button className="btn sm" onClick={() => toggle(c)}>{c.status === 'ACTIVE' ? '暂停' : '启用'}</button></td>
              </tr>
            ))}</tbody>
          </table>
          {!data.data.rows.length ? <div className="table-empty">还没有渠道</div> : null}
        </div>
      ) : null}
    </div>
  )
}

function Campaigns() {
  const data = useApi<{ rows: Campaign[] }>('/campaigns')
  const channels = useApi<{ rows: Channel[] }>('/channels')
  const [form, setForm] = useState({ channelId: '', name: '', startDay: '', endDay: '', budgetYuan: '', landingUrl: '', notes: '' })
  const [busy, setBusy] = useState(false)

  async function create() {
    setBusy(true)
    try {
      await api('/campaigns', { method: 'POST', body: {
        channelId: form.channelId, name: form.name, startDay: form.startDay || undefined, endDay: form.endDay || undefined,
        budgetCents: form.budgetYuan ? Math.round(Number(form.budgetYuan) * 100) : undefined, landingUrl: form.landingUrl || undefined, notes: form.notes || undefined,
      } })
      toast('活动已创建')
      setForm({ channelId: form.channelId, name: '', startDay: '', endDay: '', budgetYuan: '', landingUrl: '', notes: '' })
      data.reload()
    } catch (e) { toast((e as ApiError).message, 'error') } finally { setBusy(false) }
  }

  return (
    <div className="stack">
      <Card title="新建活动" sub="活动属于一个渠道；预算以元填写">
        <div className="filterbar">
          <label className="field"><span>渠道</span>
            <select value={form.channelId} onChange={e => setForm({ ...form, channelId: e.target.value })} data-testid="campaign-channel">
              <option value="">选择渠道</option>{(channels.data?.rows ?? []).map(c => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
            </select>
          </label>
          <label className="field grow"><span>活动名称</span><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} data-testid="campaign-name" /></label>
          <label className="field"><span>开始</span><input type="date" value={form.startDay} onChange={e => setForm({ ...form, startDay: e.target.value })} /></label>
          <label className="field"><span>结束</span><input type="date" value={form.endDay} onChange={e => setForm({ ...form, endDay: e.target.value })} /></label>
          <label className="field"><span>预算（元）</span><input type="number" min="0" value={form.budgetYuan} onChange={e => setForm({ ...form, budgetYuan: e.target.value })} /></label>
          <button className="btn primary" onClick={create} disabled={busy || !form.channelId || !form.name} data-testid="campaign-create">创建</button>
        </div>
      </Card>
      {data.error ? <ErrorBox error={data.error} onRetry={data.reload} /> : null}
      {data.loading && !data.data ? <Loading /> : null}
      {data.data ? (
        <div className="table-wrap">
          <table>
            <thead><tr><th>活动</th><th>渠道</th><th>周期</th><th className="num">预算</th><th>状态</th><th>创建时间</th></tr></thead>
            <tbody>{data.data.rows.map(c => (
              <tr key={c.id}>
                <td>{c.name}<div className="sub mono">{c.id.slice(0, 8)}</div></td>
                <td>{c.channelCode ?? '—'}</td>
                <td>{c.startDay ?? '—'} → {c.endDay ?? '—'}</td>
                <td className="num">{c.budgetCents === null ? '—' : fmt.money(c.budgetCents)}</td>
                <td><Chip kind={c.status === 'ACTIVE' ? 'ok' : 'mute'}>{c.status}</Chip></td>
                <td>{fmt.time(c.createdAtMs)}</td>
              </tr>
            ))}</tbody>
          </table>
          {!data.data.rows.length ? <div className="table-empty">还没有活动</div> : null}
        </div>
      ) : null}
    </div>
  )
}

function Links() {
  const data = useApi<{ rows: Link[]; gameBaseUrl: string }>('/links')
  const campaigns = useApi<{ rows: Campaign[] }>('/campaigns')
  const [form, setForm] = useState({ campaignId: '', code: '' })
  const [qr, setQr] = useState<Link | null>(null)
  const [busy, setBusy] = useState(false)

  async function create() {
    setBusy(true)
    try {
      await api('/links', { method: 'POST', body: form })
      toast('链接已创建')
      setForm({ campaignId: form.campaignId, code: '' })
      data.reload()
    } catch (e) { toast((e as ApiError).message, 'error') } finally { setBusy(false) }
  }

  return (
    <div className="stack">
      <Card title="生成追踪链接" sub="链接格式 ?ch=<渠道>&c=<活动>&l=<链接代码>">
        <div className="filterbar">
          <label className="field grow"><span>活动</span>
            <select value={form.campaignId} onChange={e => setForm({ ...form, campaignId: e.target.value })} data-testid="link-campaign">
              <option value="">选择活动</option>{(campaigns.data?.rows ?? []).map(c => <option key={c.id} value={c.id}>{c.channelCode} · {c.name}</option>)}
            </select>
          </label>
          <label className="field"><span>链接代码（可空，自动生成）</span><input value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} placeholder="xhs_s1_a" data-testid="link-code" /></label>
          <button className="btn primary" onClick={create} disabled={busy || !form.campaignId} data-testid="link-create">生成</button>
        </div>
        <div className="hint">游戏内尚未记录渠道；当前只能统计链接点击，不能统计进游戏后的转化。</div>
      </Card>
      {data.error ? <ErrorBox error={data.error} onRetry={data.reload} /> : null}
      {data.loading && !data.data ? <Loading /> : null}
      {data.data ? (
        <div className="table-wrap">
          <table>
            <thead><tr><th>代码</th><th>活动</th><th>URL</th><th>创建</th><th></th></tr></thead>
            <tbody>{data.data.rows.map(l => (
              <tr key={l.id}>
                <td className="mono">{l.code}</td><td>{l.channelCode} · {l.campaignName}</td>
                <td className="mono" style={{ maxWidth: 400 }}><div className="ellipsis">{l.url}</div></td>
                <td>{fmt.time(l.createdAtMs)}<div className="sub">{l.createdBy ?? '—'}</div></td>
                <td className="nowrap">
                  <button className="btn sm" onClick={async () => { try { await navigator.clipboard.writeText(l.url); toast('已复制链接') } catch { toast('复制失败', 'error') } }}>复制</button>{' '}
                  <button className="btn sm" onClick={() => setQr(l)} data-testid="link-qr">二维码</button>
                </td>
              </tr>
            ))}</tbody>
          </table>
          {!data.data.rows.length ? <div className="table-empty">还没有追踪链接</div> : null}
        </div>
      ) : null}
      {qr ? (
        <Drawer title={`二维码 · ${qr.code}`} onClose={() => setQr(null)}>
          <div style={{ textAlign: 'center', background: 'var(--paper-2)', padding: 18, borderRadius: 10 }}>
            <img src={`/admin/api/links/${qr.id}/qr.svg`} alt="链接二维码" style={{ width: 280, height: 280, background: '#fff' }} data-testid="qr-image" />
          </div>
          <div className="mono" style={{ marginTop: 12, wordBreak: 'break-all' }}>{qr.url}</div>
          <div className="hint" style={{ marginTop: 8 }}>小红书笔记内不得放置二维码；仅用于线下物料或允许的场景。</div>
        </Drawer>
      ) : null}
    </div>
  )
}

type PromoMetrics = {
  days: number; from: string
  daily: Array<{ day: string; clicks: number }>
  byLink: Array<{ linkId: string | null; code: string | null; channelCode: string | null; campaignName: string | null; clicks: number }>
  report: { impressions: number; clicks: number; spendCents: number }
  imports: Array<{ id: string; filename: string; importedAtMs: number; rowCount: number; importedBy: string | null }>
}

function Data() {
  const [days, setDays] = useState(30)
  const data = useApi<PromoMetrics>(`/promo/metrics?days=${days}`, [days])
  const d = data.data
  const daily = d?.daily ?? []
  return (
    <div className="stack">
      <div className="row-wrap">
        <select className="btn" value={days} onChange={e => setDays(Number(e.target.value))}><option value={30}>近 30 天</option><option value={90}>近 90 天</option></select>
        <button className="btn" onClick={data.reload}>刷新</button>
      </div>
      {data.error ? <ErrorBox error={data.error} onRetry={data.reload} /> : null}
      {data.loading && !data.data ? <Loading /> : null}
      {d ? (
        <>
          <div className="kpis" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))' }}>
            <div className="kpi"><div className="kpi-label">链接点击</div><div className="kpi-value">{fmt.num(daily.reduce((a, x) => a + x.clicks, 0))}</div><div className="kpi-foot">来自 nginx 日志</div></div>
            <div className="kpi"><div className="kpi-label">导入曝光</div><div className="kpi-value">{fmt.num(d.report.impressions)}</div><div className="kpi-foot">平台报表 CSV</div></div>
            <div className="kpi"><div className="kpi-label">导入点击</div><div className="kpi-value">{fmt.num(d.report.clicks)}</div><div className="kpi-foot">平台报表 CSV</div></div>
            <div className="kpi"><div className="kpi-label">花费</div><div className="kpi-value">{fmt.money(d.report.spendCents)}</div><div className="kpi-foot">平台报表 CSV</div></div>
          </div>
          <Card title="每日点击" sub={`${d.from} → 今天`}>
            {daily.length ? (
              <LineChart days={daily.map(x => x.day)} series={[{ name: '点击', values: daily.map(x => x.clicks) }]} height={200} />
            ) : <Empty title="还没有点击数据" hint="导入 nginx 日志或等待链接被访问。" />}
          </Card>
          <Card title="按链接" flush>
            <div className="table-wrap">
              <table>
                <thead><tr><th>链接代码</th><th>渠道</th><th>活动</th><th className="num">点击</th></tr></thead>
                <tbody>{d.byLink.map((x, i) => (
                  <tr key={`${x.linkId ?? 'none'}-${i}`}><td className="mono">{x.code ?? '—'}</td><td>{x.channelCode ?? '—'}</td><td>{x.campaignName ?? '—'}</td><td className="num">{x.clicks}</td></tr>
                ))}</tbody>
              </table>
              {!d.byLink.length ? <div className="table-empty">还没有链接点击</div> : null}
            </div>
          </Card>
        </>
      ) : null}
    </div>
  )
}

function Imports() {
  const [filename, setFilename] = useState('')
  const [csv, setCsv] = useState('')
  const [preview, setPreview] = useState<any | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const history = useApi<{ rows: Array<{ id: string; filename: string; importedAtMs: number; rowCount: number; importedBy: string | null }> }>('/imports')

  async function pick(file: File | null) {
    if (!file) return
    setFilename(file.name)
    setCsv(await file.text())
    setPreview(null)
    setError(null)
  }

  async function doPreview() {
    setBusy(true); setError(null)
    try {
      const r = await api<any>('/imports/preview', { method: 'POST', body: { filename, csv } })
      setPreview(r)
    } catch (e) { setError((e as ApiError).message) } finally { setBusy(false) }
  }
  async function doImport() {
    setBusy(true); setError(null)
    try {
      const r = await api<any>('/imports', { method: 'POST', body: { filename, csv } })
      toast(r.duplicate ? '该文件已导入过（幂等跳过）' : `已导入 ${r.rowCount} 行`)
      setPreview(null); history.reload()
    } catch (e) { setError((e as ApiError).message) } finally { setBusy(false) }
  }

  return (
    <div className="stack">
      <Card title="导入平台报表" sub="CSV 列：day/日期、channel/渠道、campaign/活动、impressions/曝光、clicks/点击、spend/花费（元）">
        <div className="filterbar">
          <input type="file" accept=".csv,text/csv" className="btn" onChange={e => void pick(e.target.files?.[0] ?? null)} data-testid="import-file" />
          <button className="btn" onClick={doPreview} disabled={!csv || busy} data-testid="import-preview">预览</button>
          <button className="btn primary" onClick={doImport} disabled={!csv || busy} data-testid="import-commit">导入</button>
          <span className="hint">按文件哈希幂等；同一文件不会重复导入。</span>
        </div>
        {error ? <div className="error-box" style={{ marginTop: 10 }}>{error}</div> : null}
        {preview ? (
          <div style={{ marginTop: 14 }}>
            <div className="row"><b>预览</b><span className="dim">共 {preview.total} 行，{preview.errors.length} 个问题</span></div>
            {preview.errors.length ? <div className="banner danger" style={{ marginTop: 8 }}>{preview.errors.map((e: string, i: number) => <div key={i}>{e}</div>)}</div> : null}
            {preview.rows.length ? (
              <div className="table-wrap" style={{ marginTop: 8 }}>
                <table>
                  <thead><tr>{(preview.headers ?? []).map((h: string) => <th key={h}>{h}</th>)}</tr></thead>
                  <tbody>{preview.rows.map((r: any, i: number) => (
                    <tr key={i}><td>{r.day}</td><td>{r.channelId ?? '—'}</td><td>{r.campaignId ?? '—'}</td><td className="num">{r.impressions ?? '—'}</td><td className="num">{r.clicks ?? '—'}</td><td className="num">{r.spendCents === null ? '—' : fmt.money(r.spendCents)}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            ) : null}
          </div>
        ) : null}
      </Card>
      <Card title="导入记录" flush>
        {history.error ? <ErrorBox error={history.error} onRetry={history.reload} /> : null}
        {history.loading && !history.data ? <Loading /> : null}
        {history.data ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>文件</th><th className="num">行数</th><th>导入人</th><th>时间</th></tr></thead>
              <tbody>{history.data.rows.map(r => <tr key={r.id}><td>{r.filename}</td><td className="num">{r.rowCount}</td><td>{r.importedBy ?? '—'}</td><td>{fmt.time(r.importedAtMs)}</td></tr>)}</tbody>
            </table>
            {!history.data.rows.length ? <div className="table-empty">还没有导入记录</div> : null}
          </div>
        ) : null}
      </Card>
    </div>
  )
}

import { useState } from 'react'
import { fmt, qs, useApi } from '../api'
import { useRouter } from '../App'
import { Card, Chip, Drawer, Empty, ErrorBox, Loading, PageHead, Pager, Tabs } from '../ui'

type Tab = 'entries' | 'review' | 'assets' | 'release'
type Entry = {
  id: string; file: string; sourceId: string; path: string; status: string; reviewer: string | null
  reviewedAt: string | null; dimensions: string[]; note: string; sources: string[]
}
type Asset = {
  id: string; name: string; group: string; path: string; runtimePath: string | null
  width: number | null; height: number | null; format: string | null; status: string | null
  provenance: string | null; licence: string | null; aiGenerated: boolean | null; derivation: string | null
}

export function Content() {
  const { session } = useRouter()
  const [tab, setTab] = useState<Tab>('entries')
  void session
  return (
    <>
      <PageHead title="内容与资产" desc="文件与 release gate 是唯一事实来源；这里只读镜像，不提供批量通过。" />
      <Tabs<Tab> value={tab} onChange={setTab} items={[
        { key: 'entries', label: '内容条目' }, { key: 'review', label: '审核台账' }, { key: 'assets', label: '美术资产' }, { key: 'release', label: '版本与发布' },
      ]} />
      {tab === 'entries' ? <Entries /> : null}
      {tab === 'review' ? <Review /> : null}
      {tab === 'assets' ? <Assets /> : null}
      {tab === 'release' ? <Release /> : null}
    </>
  )
}

function Entries() {
  const [type, setType] = useState('')
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')
  const [applied, setApplied] = useState({ type: '', status: '', q: '' })
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState<Entry | null>(null)
  const files = useApi<{ rows: Entry[] }>('/content/entries?pageSize=200')
  const data = useApi<{ total: number; page: number; pageSize: number; rows: Entry[] }>(`/content/entries${qs({ ...applied, page, pageSize: 50 })}`, [applied, page])
  const types = [...new Set((files.data?.rows ?? []).map(e => e.file.replace(/\.json$/, '')))].sort()

  return (
    <div className="stack">
      <Card>
        <div className="filterbar">
          <label className="field"><span>类型</span>
            <select value={type} onChange={e => setType(e.target.value)} data-testid="content-type">
              <option value="">全部</option>{types.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="field"><span>审核状态</span>
            <select value={status} onChange={e => setStatus(e.target.value)}>
              <option value="">全部</option><option value="approved">已审</option><option value="pending">待审</option>
            </select>
          </label>
          <label className="field grow"><span>搜索</span><input value={q} onChange={e => setQ(e.target.value)} placeholder="条目 ID / 路径 / 备注" onKeyDown={e => { if (e.key === 'Enter') { setPage(1); setApplied({ type, status, q }) } }} /></label>
          <button className="btn primary" onClick={() => { setPage(1); setApplied({ type, status, q }) }}>筛选</button>
          <button className="btn" onClick={() => { setType(''); setStatus(''); setQ(''); setApplied({ type: '', status: '', q: '' }); setPage(1) }}>重置</button>
        </div>
        <div className="banner info">内容以文件和 release gate 为准；这里只读。审核状态来自 2026-10-25 的 AI 辅助审核台账。</div>
      </Card>
      {data.error ? <ErrorBox error={data.error} onRetry={data.reload} /> : null}
      {data.loading && !data.data ? <Loading /> : null}
      {data.data ? (
        <div className="table-wrap">
          <table>
            <thead><tr><th>条目</th><th>类型</th><th>路径</th><th>状态</th><th>审核人</th><th>日期</th><th></th></tr></thead>
            <tbody>{data.data.rows.map(e => (
              <tr key={e.id}>
                <td><span className="mono">{e.sourceId || e.id}</span></td>
                <td>{e.file.replace(/\.json$/, '')}</td>
                <td className="mono dim">{e.path}</td>
                <td><Chip kind={e.status === 'approved' ? 'ok' : 'warn'}>{e.status === 'approved' ? '已审' : '待审'}</Chip></td>
                <td>{e.reviewer ?? '—'}</td>
                <td>{e.reviewedAt ?? '—'}</td>
                <td><button className="btn sm" onClick={() => setOpen(e)}>查看</button></td>
              </tr>
            ))}</tbody>
          </table>
          {!data.data.rows.length ? <div className="table-empty">没有匹配的条目</div> : null}
          <div style={{ padding: '0 12px' }}><Pager page={data.data.page} pageSize={data.data.pageSize} total={data.data.total} onPage={setPage} /></div>
        </div>
      ) : null}
      {open ? (
        <Drawer title={open.sourceId || open.id} onClose={() => setOpen(null)}>
          <div className="kv">
            <div><dt>文件</dt><dd className="mono">{open.file}</dd></div>
            <div><dt>JSON 路径</dt><dd className="mono">{open.path}</dd></div>
            <div><dt>状态</dt><dd><Chip kind={open.status === 'approved' ? 'ok' : 'warn'}>{open.status}</Chip></dd></div>
            <div><dt>审核人</dt><dd>{open.reviewer ?? '—'}</dd></div>
            <div><dt>审核日期</dt><dd>{open.reviewedAt ?? '—'}</dd></div>
          </div>
          <div className="divider" />
          <div className="section-title">审核维度</div>
          <div className="tag-list">{open.dimensions.map(d => <Chip key={d} kind="mute" plain>{d}</Chip>)}</div>
          <div className="section-title" style={{ marginTop: 16 }}>审核备注</div>
          <p className="muted" style={{ lineHeight: 1.7 }}>{open.note || '—'}</p>
          <div className="section-title" style={{ marginTop: 16 }}>来源</div>
          <div className="tag-list">{open.sources.length ? open.sources.map(s => <span key={s} className="mono source-badge">{s}</span>) : <span className="dim">—</span>}</div>
          <div className="banner warn" style={{ marginTop: 18 }}>这是 AI 辅助的来源审核，不是持证植物学/儿科/法律签署。公开发布前需要人工专家复审。</div>
        </Drawer>
      ) : null}
    </div>
  )
}

function Review() {
  const data = useApi<{ review: any; byFile: Array<{ file: string; total: number; approved: number; pending: number }>; generatedAt: string }>('/content/review-summary')
  if (data.loading && !data.data) return <Loading />
  if (data.error) return <ErrorBox error={data.error} onRetry={data.reload} />
  if (!data.data) return null
  const r = data.data.review
  return (
    <div className="stack">
      <Card>
        <div className="grid grid-4">
          <div><div className="kpi-label">审核总数</div><div className="kpi-value">{r?.counts?.total ?? 0}</div></div>
          <div><div className="kpi-label">已签字</div><div className="kpi-value delta-up">{r?.counts?.approved ?? 0}</div></div>
          <div><div className="kpi-label">待人工复审</div><div className="kpi-value delta-down">{r?.counts?.pending ?? 0}</div></div>
          <div><div className="kpi-label">审核方式</div><div style={{ fontSize: 15, marginTop: 8 }}>AI 辅助</div><div className="hint">{r?.reviewedAt ?? '—'}</div></div>
        </div>
        <div className="banner warn" style={{ marginTop: 14 }}>{r?.method ?? '审核方法未知'}。人工复审未完成，后台不提供“全部通过”。</div>
        <div className="hint" style={{ marginTop: 8 }}>审核人：{r?.reviewer ?? '—'} · 快照生成 {fmt.time(Date.parse(data.data.generatedAt))}</div>
      </Card>
      <div className="table-wrap">
        <table>
          <thead><tr><th>内容文件</th><th className="num">条目</th><th className="num">已审</th><th className="num">待审</th><th>进度</th></tr></thead>
          <tbody>{data.data.byFile.map(f => (
            <tr key={f.file}>
              <td className="mono">{f.file}</td><td className="num">{f.total}</td><td className="num">{f.approved}</td><td className="num">{f.pending}</td>
              <td><div className="funnel-track" style={{ height: 10, width: 180 }}><div className="funnel-bar" style={{ width: `${f.total ? (f.approved / f.total) * 100 : 0}%` }} /></div></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  )
}

function Assets() {
  const [group, setGroup] = useState('')
  const [q, setQ] = useState('')
  const [applied, setApplied] = useState({ group: '', q: '' })
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState<Asset | null>(null)
  const data = useApi<{ total: number; page: number; pageSize: number; coverage: any; rows: Asset[] }>(`/assets${qs({ ...applied, page, pageSize: 48 })}`, [applied, page])
  const groups = data.data?.coverage?.groups ? Object.keys(data.data.coverage.groups) : []

  return (
    <div className="stack">
      <Card>
        <div className="grid grid-4">
          <div><div className="kpi-label">资产总数</div><div className="kpi-value">{data.data?.coverage?.total ?? '—'}</div></div>
          <div><div className="kpi-label">有运行时文件</div><div className="kpi-value">{data.data?.coverage?.withRuntimeFile ?? '—'}</div></div>
          <div><div className="kpi-label">已登记许可证</div><div className="kpi-value delta-down">{data.data?.coverage?.withLicence ?? 0}</div></div>
          <div><div className="kpi-label">AI 标注</div><div className="kpi-value">{data.data?.coverage?.aiLabelled ?? 0}</div></div>
        </div>
        <div className="banner warn" style={{ marginTop: 14 }}>台账字段不完整：缺少的许可证 / AI 标注 / 来源会显示为“未登记”。这是覆盖率缺口报告，不是已完成台账。</div>
        <div className="filterbar" style={{ marginTop: 12 }}>
          <label className="field"><span>分组</span><select value={group} onChange={e => setGroup(e.target.value)}><option value="">全部</option>{groups.map(g => <option key={g} value={g}>{g}</option>)}</select></label>
          <label className="field grow"><span>搜索</span><input value={q} onChange={e => setQ(e.target.value)} placeholder="资产 ID / 名称 / 路径" onKeyDown={e => { if (e.key === 'Enter') { setPage(1); setApplied({ group, q }) } }} /></label>
          <button className="btn primary" onClick={() => { setPage(1); setApplied({ group, q }) }}>筛选</button>
        </div>
      </Card>
      {data.error ? <ErrorBox error={data.error} onRetry={data.reload} /> : null}
      {data.loading && !data.data ? <Loading /> : null}
      {data.data ? (
        <>
          <div className="grid grid-4">
            {data.data.rows.map(a => (
              <button key={a.id} className="card" style={{ padding: 10, textAlign: 'left', cursor: 'pointer' }} onClick={() => setOpen(a)} data-testid={`asset-${a.id}`}>
                <div style={{ height: 120, background: 'var(--paper-2)', borderRadius: 6, display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
                  {a.runtimePath ? <img src={`/admin/media/${a.runtimePath}`} alt={a.name} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} /> : <span className="dim">无运行时文件</span>}
                </div>
                <div style={{ marginTop: 8, fontSize: 13, fontWeight: 600 }} className="ellipsis">{a.name}</div>
                <div className="hint ellipsis">{a.group} · {a.width ?? '?'}×{a.height ?? '?'}</div>
                <div className="tag-list" style={{ marginTop: 6 }}>
                  <Chip kind={a.runtimePath ? 'ok' : 'warn'}>{a.runtimePath ? '有文件' : '缺文件'}</Chip>
                  <Chip kind={a.licence ? 'ok' : 'mute'}>{a.licence ? '已登记' : '未登记'}</Chip>
                </div>
              </button>
            ))}
          </div>
          {!data.data.rows.length ? <Empty title="没有匹配的资产" /> : null}
          <Pager page={data.data.page} pageSize={data.data.pageSize} total={data.data.total} onPage={setPage} />
        </>
      ) : null}
      {open ? (
        <Drawer title={open.name} onClose={() => setOpen(null)}>
          {open.runtimePath ? <div style={{ background: 'var(--paper-2)', borderRadius: 8, padding: 12, textAlign: 'center' }}><img src={`/admin/media/${open.runtimePath}`} alt={open.name} style={{ maxWidth: '100%', maxHeight: 300 }} /></div> : null}
          <div className="kv" style={{ marginTop: 14 }}>
            <div><dt>ID</dt><dd className="mono">{open.id}</dd></div>
            <div><dt>分组</dt><dd>{open.group}</dd></div>
            <div><dt>清单路径</dt><dd className="mono">{open.path}</dd></div>
            <div><dt>运行时文件</dt><dd className="mono">{open.runtimePath ?? '未登记'}</dd></div>
            <div><dt>尺寸</dt><dd>{open.width ?? '?'} × {open.height ?? '?'}</dd></div>
            <div><dt>格式</dt><dd>{open.format ?? '—'}</dd></div>
            <div><dt>来源</dt><dd>{open.provenance ?? '未登记'}</dd></div>
            <div><dt>许可证</dt><dd>{open.licence ?? '未登记'}</dd></div>
            <div><dt>AI 标注</dt><dd>{open.aiGenerated === null ? '未标注' : open.aiGenerated ? 'AI 生成' : '非 AI'}</dd></div>
            <div><dt>派生</dt><dd>{open.derivation ?? '—'}</dd></div>
          </div>
          <div className="banner warn" style={{ marginTop: 16 }}>下载已禁用；如需对外交付，请走受控复制流程并登记来源。</div>
        </Drawer>
      ) : null}
    </div>
  )
}

function Release() {
  const data = useApi<{ stage: string; versions: any; release: any; generatedAt: string; missingSources: string[] }>('/release')
  if (data.loading && !data.data) return <Loading />
  if (data.error) return <ErrorBox error={data.error} onRetry={data.reload} />
  if (!data.data) return null
  const { versions, release } = data.data
  return (
    <div className="stack">
      <Card title="版本卡" sub={`快照生成于 ${fmt.time(Date.parse(data.data.generatedAt))}`}>
        <div className="grid grid-4">
          <div><div className="kpi-label">客户端构建</div><div className="kpi-value" style={{ fontSize: 20 }}>{versions?.clientBuild ?? '—'}</div></div>
          <div><div className="kpi-label">内容配置</div><div className="kpi-value" style={{ fontSize: 20 }}>{versions?.configVersion ?? '—'}</div></div>
          <div><div className="kpi-label">包版本</div><div className="kpi-value" style={{ fontSize: 20 }}>{versions?.packageVersion ?? '—'}</div></div>
          <div><div className="kpi-label">阶段</div><div className="kpi-value" style={{ fontSize: 20 }}>{data.data.stage}</div></div>
        </div>
        <div className="hint" style={{ marginTop: 10 }}>源码清单：{versions?.sourceManifest ?? '—'}</div>
      </Card>
      <Card title="preflight 阻塞项" sub={release?.preflight?.pass ? '通过' : '未通过'}>
        {release?.preflight?.blockers?.length ? (
          <div className="stack" style={{ gap: 8 }}>
            {release.preflight.blockers.map((b: any) => <div className="banner danger" key={b.code}><b className="mono">{b.code}</b> {b.msg}</div>)}
          </div>
        ) : <Empty title="没有阻塞项" hint="preflight 通过。" />}
        {release?.preflight?.warnings?.length ? <>
          <div className="section-title" style={{ marginTop: 16 }}>警告</div>
          {release.preflight.warnings.map((w: any) => <div className="banner warn" key={`${w.code}-${w.msg}`} style={{ marginBottom: 6 }}><b className="mono">{w.code}</b> {w.msg}</div>)}
        </> : null}
      </Card>
      {data.data.missingSources.length ? (
        <Card title="快照缺失来源">
          <div className="tag-list">{data.data.missingSources.map((s: string) => <span key={s} className="source-badge">{s}</span>)}</div>
        </Card>
      ) : null}
      <Card title="部署命令">
        <pre className="mono" style={{ background: 'var(--paper-2)', padding: 12, borderRadius: 8, overflowX: 'auto', margin: 0 }}>{`pnpm build:admin
# 部署 admin SPA + bencao-admin.service + migrations
./deploy/deploy.sh admin`}</pre>
        <div className="hint" style={{ marginTop: 8 }}>后台不执行部署命令；复制后由负责人执行。</div>
      </Card>
    </div>
  )
}

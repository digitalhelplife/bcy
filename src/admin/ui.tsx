import { useEffect, useState, type ReactNode } from 'react'
import { ApiError } from './api'
import { FEEDBACK_LABELS } from './api'

/* ---------------- states ---------------- */
export function Loading({ label = '加载中…' }: { label?: string }) {
  return <div className="loading"><span className="spinner" />{label}</div>
}

export function ErrorBox({ error, onRetry }: { error: ApiError | Error | null; onRetry?: () => void }) {
  if (!error) return null
  return (
    <div className="error-box">
      {error.message}
      {error instanceof ApiError && error.traceId ? <span className="dim"> · trace {error.traceId.slice(0, 8)}</span> : null}
      {onRetry ? <> <button className="btn link" onClick={onRetry}>重试</button></> : null}
    </div>
  )
}

export function Empty({ title = '暂无数据', hint, action }: { title?: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="sprout">❦</div>
      <div>{title}</div>
      {hint ? <div className="hint">{hint}</div> : null}
      {action ? <div style={{ marginTop: 12 }}>{action}</div> : null}
    </div>
  )
}

export function PageHead({ title, desc, actions }: { title: string; desc?: string; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1 className="page-title">{title}</h1>
        {desc ? <div className="page-desc">{desc}</div> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </div>
  )
}

export function Card({ title, sub, actions, children, flush, className = '' }: {
  title?: ReactNode; sub?: ReactNode; actions?: ReactNode; children: ReactNode; flush?: boolean; className?: string
}) {
  return (
    <section className={`card ${flush ? 'flush' : ''} ${className}`}>
      {(title || actions) ? (
        <div className={`card-head ${flush ? 'pad' : ''}`} style={flush ? { padding: '16px 18px 12px', marginBottom: 0 } : undefined}>
          <div>
            {title ? <div className="card-title">{title}</div> : null}
            {sub ? <div className="card-sub">{sub}</div> : null}
          </div>
          {actions ? <div className="card-actions">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  )
}

export function Chip({ kind = 'mute', children, plain }: { kind?: 'ok' | 'warn' | 'danger' | 'info' | 'mute'; children: ReactNode; plain?: boolean }) {
  return <span className={`chip ${kind} ${plain ? 'plain' : ''}`}>{children}</span>
}

export function FeedbackChip({ status }: { status: string }) {
  const kind = status === 'NEW' ? 'warn' : status === 'IN_PROGRESS' ? 'info' : status === 'RESOLVED' ? 'ok' : 'mute'
  return <Chip kind={kind}>{FEEDBACK_LABELS[status] ?? status}</Chip>
}

export function SourceBadge({ source }: { source: string }) {
  const cls = source.includes('埋点') ? 'telemetry' : source.includes('存档') ? 'save' : source.includes('会话') ? 'session' : 'file'
  return <span className={`source-badge ${cls}`}>{source}</span>
}

/* ---------------- tabs ---------------- */
export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: Array<{ key: T; label: string }> }) {
  return (
    <div className="tabs" role="tablist">
      {items.map(it => (
        <button key={it.key} role="tab" aria-selected={value === it.key} className={`tab ${value === it.key ? 'active' : ''}`} onClick={() => onChange(it.key)}>
          {it.label}
        </button>
      ))}
    </div>
  )
}

/* ---------------- drawer ---------------- */
export function Drawer({ title, onClose, children, footer }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <>
      <div className="overlay" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true">
        <div className="drawer-head">
          <div className="drawer-title">{title}</div>
          <div className="spacer" />
          <button className="btn ghost" onClick={onClose}>关闭</button>
        </div>
        <div className="drawer-body">{children}</div>
        {footer ? <div className="drawer-foot">{footer}</div> : null}
      </aside>
    </>
  )
}

/* ---------------- pager ---------------- */
export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  return (
    <div className="pagination">
      <span>共 {total} 条 · 第 {page}/{pages} 页</span>
      <button className="btn sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>上一页</button>
      <button className="btn sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>下一页</button>
    </div>
  )
}

/* ---------------- charts ---------------- */
export function LineChart({ days, series, height = 190 }: {
  days: string[]
  series: Array<{ name: string; color?: string; values: number[] }>
  height?: number
}) {
  const w = 720, h = height
  const pad = { l: 38, r: 14, t: 10, b: 24 }
  const max = Math.max(1, ...series.flatMap(s => s.values))
  const n = Math.max(1, days.length - 1)
  const x = (i: number) => pad.l + (i * (w - pad.l - pad.r)) / n
  const y = (v: number) => h - pad.b - (v / max) * (h - pad.t - pad.b)
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(t => Math.round(max * t))
  const labelEvery = Math.max(1, Math.ceil(days.length / 6))
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label="趋势图">
        {ticks.map((t, i) => {
          const yy = y(t)
          return (
            <g key={i}>
              <line className="grid-line" x1={pad.l} x2={w - pad.r} y1={yy} y2={yy} />
              <text className="axis" x={pad.l - 6} y={yy + 3} textAnchor="end">{t}</text>
            </g>
          )
        })}
        {days.map((d, i) => (i % labelEvery === 0 || i === days.length - 1
          ? <text key={d} className="axis" x={x(i)} y={h - 6} textAnchor="middle">{d.slice(5)}</text>
          : null))}
        {series.map((s, si) => {
          const pts = s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')
          const color = s.color ?? (si === 0 ? '#2F6F62' : '#B07A4A')
          return (
            <g key={s.name}>
              {si === 0 ? <polygon className="area" points={`${pad.l},${h - pad.b} ${pts} ${x(s.values.length - 1)},${h - pad.b}`} /> : null}
              <polyline className="line-path" style={{ stroke: color }} points={pts} />
            </g>
          )
        })}
      </svg>
      <div className="legend">
        {series.map((s, i) => <span key={s.name}><i style={{ background: s.color ?? (i === 0 ? '#2F6F62' : '#B07A4A') }} />{s.name}</span>)}
      </div>
    </div>
  )
}

export function Sparkline({ values, width = 84, height = 24 }: { values: number[]; width?: number; height?: number }) {
  if (!values.length) return null
  const max = Math.max(1, ...values)
  const pts = values.map((v, i) => `${(i * width) / Math.max(1, values.length - 1)},${height - (v / max) * (height - 2) - 1}`).join(' ')
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <polyline points={pts} fill="none" stroke="#2F6F62" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  )
}

export function Funnel({ steps }: { steps: Array<{ key: string; label: string; count: number; source?: string }> }) {
  const max = Math.max(1, ...steps.map(s => s.count))
  return (
    <div className="funnel">
      {steps.map((s, i) => {
        const prev = i > 0 ? steps[i - 1].count : null
        const rate = prev && prev > 0 ? Math.round((s.count / prev) * 1000) / 10 : null
        return (
          <div className="funnel-row" key={s.key}>
            <div className="funnel-label">{s.label}</div>
            <div className="funnel-track"><div className="funnel-bar" style={{ width: `${Math.max(1.5, (s.count / max) * 100)}%` }} /></div>
            <div className="funnel-count">{s.count.toLocaleString('zh-CN')}</div>
            <div className="funnel-rate">{rate === null ? '—' : `${rate}%`}</div>
          </div>
        )
      })}
    </div>
  )
}

export function Heatmap({ rows, offsets }: { rows: Array<{ cohortDay: string; cohortSize: number; values: Record<string, number> }>; offsets: number[] }) {
  if (!rows.length) return <Empty title="留存数据不足" hint="需要至少两天的遥测数据。" />
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="heat">
        <thead>
          <tr><th style={{ textAlign: 'left' }}>队列</th>{offsets.map(o => <th key={o}>D{o}</th>)}<th>人数</th></tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.cohortDay}>
              <td style={{ fontSize: 11, color: 'var(--ink-3)', textAlign: 'left', whiteSpace: 'nowrap' }}>{r.cohortDay.slice(5)}</td>
              {offsets.map(o => {
                const v = r.values[`d${o}`]
                const bg = v === undefined ? 'transparent' : `rgba(47,111,98,${Math.min(0.85, 0.08 + (v / 100) * 0.8)})`
                return (
                  <td key={o}>
                    <div className={`heat-cell ${v === undefined || v === 0 ? 'zero' : ''}`} style={{ background: bg, color: v && v > 55 ? '#fff' : 'var(--ink)' }} title={`${r.cohortDay} · D${o} · ${v ?? '—'}%`}>
                      {v === undefined ? '·' : `${v}%`}
                    </div>
                  </td>
                )
              })}
              <td style={{ fontSize: 11, color: 'var(--ink-3)', textAlign: 'right' }}>{r.cohortSize}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ---------------- copy / toast ---------------- */
export function CopyButton({ text, label = '复制' }: { text: string; label?: string }) {
  return (
    <button className="copy-btn" onClick={async () => {
      try { await navigator.clipboard.writeText(text); toast('已复制') } catch { toast('复制失败', 'error') }
    }}>{label}</button>
  )
}

type ToastDetail = { id: number; message: string; kind: 'ok' | 'error' }
let toastSeq = 0
export function toast(message: string, kind: 'ok' | 'error' = 'ok') {
  window.dispatchEvent(new CustomEvent('admin:toast', { detail: { id: ++toastSeq, message, kind } }))
}

export function Toaster() {
  const [items, setItems] = useState<ToastDetail[]>([])
  useEffect(() => {
    const onToast = (e: Event) => {
      const d = (e as CustomEvent<ToastDetail>).detail
      setItems(x => [...x, d])
      window.setTimeout(() => setItems(x => x.filter(i => i.id !== d.id)), 3200)
    }
    window.addEventListener('admin:toast', onToast)
    return () => window.removeEventListener('admin:toast', onToast)
  }, [])
  return <>{items.map(i => <div key={i.id} className={`toast ${i.kind === 'error' ? 'error' : ''}`}>{i.message}</div>)}</>
}

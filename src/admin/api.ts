import { useCallback, useEffect, useRef, useState } from 'react'

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public traceId?: string) { super(message) }
}

type Options = { method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'; body?: unknown }

export async function api<T>(path: string, opts: Options = {}): Promise<T> {
  const method = opts.method ?? 'GET'
  const headers: Record<string, string> = {}
  if (method !== 'GET') headers['x-bcy-admin'] = '1'
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  let r: Response
  try {
    r = await fetch(`/admin/api${path}`, {
      method, headers, credentials: 'same-origin', cache: 'no-store',
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    })
  } catch {
    throw new ApiError(0, 'NETWORK', '网络不可用，请检查连接后重试')
  }
  let payload: any = null
  try { payload = await r.json() } catch { /* non-JSON */ }
  if (!r.ok || !payload?.ok) {
    if (r.status === 401) window.dispatchEvent(new CustomEvent('admin:auth-expired'))
    throw new ApiError(r.status, payload?.error?.code ?? `HTTP_${r.status}`, payload?.error?.message ?? '服务暂时不可用', payload?.error?.traceId)
  }
  return payload.data as T
}

export type AsyncState<T> = { data: T | null; error: ApiError | null; loading: boolean }

export function useApi<T>(path: string | null, deps: unknown[] = []) {
  const [state, setState] = useState<AsyncState<T>>({ data: null, error: null, loading: !!path })
  const seq = useRef(0)

  const reload = useCallback(async () => {
    if (!path) return
    const id = ++seq.current
    setState(s => ({ ...s, loading: true, error: null }))
    try {
      const data = await api<T>(path)
      if (id === seq.current) setState({ data, error: null, loading: false })
    } catch (e) {
      if (id === seq.current) setState(s => ({ ...s, error: e as ApiError, loading: false }))
    }
  }, [path])

  useEffect(() => { void reload() }, deps.concat([reload]))

  return { ...state, reload }
}

export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue
    sp.set(k, String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}

/** Read the current URL query (shareable filters). */
export function readQuery(): Record<string, string> {
  const sp = new URLSearchParams(window.location.search)
  const out: Record<string, string> = {}
  sp.forEach((v, k) => { out[k] = v })
  return out
}

/** Replace the URL query without adding history entries. */
export function syncQuery(params: Record<string, string | undefined | null>): void {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, v)
  }
  const s = sp.toString()
  window.history.replaceState({}, '', `${window.location.pathname}${s ? `?${s}` : ''}`)
}

export const fmt = {
  time(ms: number | null | undefined): string {
    if (!ms) return '—'
    return new Date(ms).toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' })
  },
  day(ms: number | null | undefined): string {
    if (!ms) return '—'
    return new Date(ms + 8 * 3600_000).toISOString().slice(0, 10)
  },
  num(n: number | null | undefined): string {
    if (n === null || n === undefined || !Number.isFinite(n)) return '—'
    return n.toLocaleString('zh-CN')
  },
  pct(n: number | null | undefined): string {
    if (n === null || n === undefined || !Number.isFinite(n)) return '—'
    return `${n}%`
  },
  money(cents: number | null | undefined): string {
    if (cents === null || cents === undefined) return '—'
    return `¥${(cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  },
  short(id: string, n = 8): string {
    return id.length > n ? `${id.slice(0, n)}…` : id
  },
}

export const REALNAME_LABELS: Record<string, string> = {
  UNVERIFIED: '未实名', PENDING: '审核中', VERIFIED_ADULT: '已实名成年', VERIFIED_MINOR: '已实名未成年', FAILED: '审核失败',
}
export const ACCOUNT_LABELS: Record<string, string> = { ACTIVE: '正常', DELETED: '已注销', DELETE_PENDING: '销户处理中' }
export const FEEDBACK_LABELS: Record<string, string> = { NEW: '新', IN_PROGRESS: '处理中', RESOLVED: '已解决', ARCHIVED: '已归档' }
export const TUTORIAL_LABELS: Record<string, string> = {
  explore: '探索', plant: '种植', collect: '收集', decorate: '布置', complete: '已完成',
}

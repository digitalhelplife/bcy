import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { asset, type ShareTemplateId } from '../shared/content'
import { BusinessError, UnknownOutcomeError, type GameClient } from '../net/gameClient'
import type { FinishResult, PlantId, RunSummary } from '../shared/types'

export type Screen =
  | { name: 'boot' } | { name: 'map' } | { name: 'garden' } | { name: 'codex' } | { name: 'inventory' }
  | { name: 'share'; template?: ShareTemplateId; plantId?: PlantId }
  | { name: 'notebook' } | { name: 'settings' } | { name: 'season' }
  | { name: 'explore'; run: RunSummary }
  | { name: 'result'; run: RunSummary; proof: unknown | null; replay?: FinishResult }

export type AppCtx = {
  client: GameClient
  go: (s: Screen) => void
  toast: (text: string) => void
  confirm: (opts: ConfirmOpts) => void
  setLeaveGuard: (g: ((next: Screen) => boolean) | null) => void
}
export type ConfirmOpts = { title: string; body?: ReactNode; actions: { label: string; kind?: 'primary' | 'ghost' | 'danger'; onClick?: () => void }[] }

export const Ctx = createContext<AppCtx>(null as unknown as AppCtx)
export const useApp = () => useContext(Ctx)
export function useSnap() {
  const { client } = useApp()
  return useSyncExternalStore(client.subscribe, client.getSnapshot)
}
export function useNow(client: GameClient, everyMs = 1000) {
  const [now, setNow] = useState(() => client.serverNow())
  useEffect(() => { const t = setInterval(() => setNow(client.serverNow()), everyMs); return () => clearInterval(t) }, [client, everyMs])
  return now
}

/** `eager` for small icons inside sheets/result cards: lazy images there pop in late or stay blank (A6-B6). */
export const Img = ({ path, alt = '', className, eager }: { path: string; alt?: string; className?: string; eager?: boolean }) => (
  <img src={asset(path)} alt={alt} className={className} draggable={false} loading={eager ? 'eager' : 'lazy'} decoding="async" />
)

export function Btn({ children, onClick, kind = 'primary', disabled, small, testId }: { children: ReactNode; onClick?: () => void; kind?: 'primary' | 'ghost' | 'danger' | 'soft'; disabled?: boolean; small?: boolean; testId?: string }) {
  return <button type="button" data-testid={testId} className={`btn btn-${kind}${small ? ' btn-sm' : ''}`} disabled={disabled} onClick={onClick}>{children}</button>
}

export function Sheet({ children, onClose, title }: { children: ReactNode; onClose?: () => void; title?: string }) {
  return (
    <div className="sheet-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose?.() }}>
      <div className="sheet" role="dialog" aria-label={title}>
        {title && <div className="sheet-head"><h3>{title}</h3>{onClose && <button className="icon-btn" aria-label="关闭" onClick={onClose}><Img path="ui/ui_close" /></button>}</div>}
        {children}
      </div>
    </div>
  )
}

export function errorText(e: unknown): string {
  if (e instanceof UnknownOutcomeError) return '网络中断，操作结果未确认。请用“重试确认”继续，不会重复扣除或发放。'
  if (e instanceof BusinessError) return e.error.message
  if (e instanceof Error) return e.message
  return '出了点小问题，请重试'
}

export const fmtCountdown = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

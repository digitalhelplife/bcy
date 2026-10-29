import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { SessionUser, Permission } from '../shared/adminContract'
import { can } from '../shared/adminContract'
import { api } from './api'
import { Login } from './pages/Login'
import { Overview } from './pages/Overview'
import { Users } from './pages/Users'
import { UserDetail } from './pages/UserDetail'
import { Content } from './pages/Content'
import { Metrics, Feedback, Config, Audit } from './pages/Ops'
import { Promo } from './pages/Promo'
import { Admins, Environment, Me } from './pages/Settings'
import { Loading, PageHead, Toaster } from './ui'

export type GameInfo = { id: string; name: string; stage: string; timezone: string } | null
export type SessionPayload = { user: SessionUser; game: GameInfo; sessions?: unknown[] }

type RouterCtx = { path: string; navigate: (to: string) => void; session: SessionPayload; setSession: (s: SessionPayload) => void }
const Router = createContext<RouterCtx | null>(null)
export function useRouter() {
  const ctx = useContext(Router)
  if (!ctx) throw new Error('router context missing')
  return ctx
}

const basePath = () => {
  const p = window.location.pathname.replace(/^\/admin/, '')
  return p || '/'
}

export function App() {
  const [path, setPath] = useState(basePath)
  const [session, setSession] = useState<SessionPayload | null>(null)
  const [checking, setChecking] = useState(true)
  const [badges, setBadges] = useState<Record<string, number>>({})

  const navigate = (to: string) => {
    if (to === path) return
    window.history.pushState({}, '', `/admin${to === '/' ? '/' : to}`)
    setPath(to)
    window.scrollTo(0, 0)
  }

  useEffect(() => {
    const onPop = () => setPath(basePath())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  useEffect(() => {
    let alive = true
    api<SessionPayload>('/session')
      .then(s => { if (alive) setSession(s) })
      .catch(() => { if (alive) setSession(null) })
      .finally(() => { if (alive) setChecking(false) })
    const onExpired = () => setSession(null)
    window.addEventListener('admin:auth-expired', onExpired)
    return () => { alive = false; window.removeEventListener('admin:auth-expired', onExpired) }
  }, [])

  useEffect(() => {
    if (!session) return
    let alive = true
    const load = () => api<Record<string, number>>('/nav-badges').then(x => { if (alive) setBadges(x) }).catch(() => undefined)
    void load()
    const t = window.setInterval(load, 60_000)
    return () => { alive = false; window.clearInterval(t) }
  }, [session])

  const ctx = useMemo<RouterCtx | null>(() => (session ? { path, navigate, session, setSession } : null), [session, path])
  if (checking) return <Loading label="正在检查登录状态…" />
  if (!session || !ctx) return <Login onLogin={setSession} />
  return (
    <Router.Provider value={ctx}>
      <Shell path={path} session={session} navigate={navigate} badges={badges} onLogout={async () => { await api('/session', { method: 'DELETE' }).catch(() => undefined); setSession(null) }} />
      <Toaster />
    </Router.Provider>
  )
}

type NavItem = { to: string; label: string; permission?: Permission; badgeKey?: string }
type NavGroup = { label: string; items: NavItem[] }

const NAV: NavGroup[] = [
  { label: '', items: [{ to: '/', label: '总览', permission: 'overview.view' }] },
  { label: '用户', items: [{ to: '/users', label: '用户查询', permission: 'users.view' }] },
  { label: '内容与资产', items: [{ to: '/content', label: '内容 / 审核 / 资产', permission: 'content.view' }] },
  {
    label: '运营',
    items: [
      { to: '/ops/metrics', label: '数据看板', permission: 'metrics.view' },
      { to: '/ops/feedback', label: '反馈收件箱', permission: 'feedback.view', badgeKey: 'feedback' },
      { to: '/ops/config', label: '合规与日历', permission: 'config.view' },
      { to: '/ops/audit', label: '审计日志', permission: 'audit.view' },
    ],
  },
  { label: '推广', items: [{ to: '/promo', label: '渠道与活动', permission: 'promo.view' }] },
  {
    label: '设置',
    items: [
      { to: '/settings/admins', label: '管理员与角色', permission: 'admin.manage' },
      { to: '/settings/environment', label: '环境与版本', permission: 'environment.view' },
      { to: '/settings/me', label: '我的账号' },
    ],
  },
]

const TITLES: Record<string, string> = {
  '/': '总览', '/users': '用户', '/content': '内容与资产', '/ops/metrics': '数据看板', '/ops/feedback': '反馈收件箱',
  '/ops/config': '合规与日历', '/ops/audit': '审计日志', '/promo': '推广', '/settings/admins': '管理员与角色',
  '/settings/environment': '环境与版本', '/settings/me': '我的账号',
}

function titleFor(path: string): string {
  if (TITLES[path]) return TITLES[path]
  if (path.startsWith('/users/')) return '用户详情'
  return '运营后台'
}

function Shell({ path, session, navigate, badges, onLogout }: {
  path: string; session: SessionPayload; navigate: (to: string) => void; badges: Record<string, number>; onLogout: () => void
}) {
  const [menu, setMenu] = useState(false)
  const stage = session.game?.stage ?? 'S0'
  const role = session.user.role

  return (
    <div className="shell">
      <aside className="rail">
        <div className="rail-brand">
          <div className="brand-mark">本</div>
          <div>
            <b>本草小游记</b>
            <div className="dim" style={{ fontSize: 11 }}>运营后台</div>
          </div>
        </div>
        <nav className="rail-nav">
          {NAV.map(group => {
            const items = group.items.filter(i => !i.permission || can(role, i.permission))
            if (!items.length) return null
            return (
              <div className="nav-group" key={group.label || 'main'}>
                {group.label ? <div className="nav-label">{group.label}</div> : null}
                {items.map(item => {
                  const active = item.to === '/' ? path === '/' : path === item.to || path.startsWith(`${item.to}/`)
                  const badge = item.badgeKey ? badges[item.badgeKey] : undefined
                  return (
                    <a key={item.to} href={`/admin${item.to}`} className={`nav-link ${active ? 'active' : ''}`}
                      onClick={e => { e.preventDefault(); navigate(item.to) }}>
                      <span>{item.label}</span>
                      {badge ? <span className="nav-badge">{badge}</span> : null}
                    </a>
                  )
                })}
              </div>
            )
          })}
        </nav>
        <div className="rail-foot">
          <div>{session.user.environment === 'production' ? '正式环境' : '测试环境'}</div>
          <div>v0.1 · 只读为主</div>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="topbar-title">{titleFor(path)}</div>
          <span className="stage-badge">{stage === 'S0' ? 'S0 内测' : stage === 'S1' ? 'S1 封闭测试' : stage === 'S2' ? 'S2 申报' : 'S3 公开'}</span>
          <div className="topbar-spacer" />
          <div className="account">
            <button className="btn ghost" onClick={() => setMenu(v => !v)}>
              {session.user.username} · {roleLabel(role)} ▾
            </button>
            {menu ? (
              <div className="account-menu" onMouseLeave={() => setMenu(false)}>
                <button onClick={() => { setMenu(false); navigate('/settings/me') }}>我的账号</button>
                <button onClick={onLogout}>退出登录</button>
              </div>
            ) : null}
          </div>
        </header>
        <main className="content">
          <RouteView path={path} session={session} />
        </main>
      </div>
    </div>
  )
}

const ROLE_NAMES: Record<string, string> = { owner: '负责人', ops: '运营', support: '客服', reviewer: '内容审核', viewer: '只读' }
function roleLabel(role: string) { return ROLE_NAMES[role] ?? role }

function RouteView({ path, session }: { path: string; session: SessionPayload }) {
  const perm = permissionFor(path)
  if (perm && !can(session.user.role, perm)) return <Forbidden permission={perm} />
  if (path === '/') return <Overview />
  if (path === '/users') return <Users />
  const userMatch = path.match(/^\/users\/([^/]+)$/)
  if (userMatch) return <UserDetail id={decodeURIComponent(userMatch[1])} />
  if (path === '/content') return <Content />
  if (path === '/ops/metrics') return <Metrics />
  if (path === '/ops/feedback') return <Feedback />
  if (path === '/ops/config') return <Config />
  if (path === '/ops/audit') return <Audit />
  if (path === '/promo') return <Promo />
  if (path === '/settings/admins') return <Admins />
  if (path === '/settings/environment') return <Environment />
  if (path === '/settings/me') return <Me />
  return <PageHead title="页面不存在" desc="请从左侧导航进入。" />
}

function permissionFor(path: string): Permission | null {
  if (path === '/') return 'overview.view'
  if (path === '/users' || path.startsWith('/users/')) return 'users.view'
  if (path === '/content') return 'content.view'
  if (path === '/ops/metrics') return 'metrics.view'
  if (path === '/ops/feedback') return 'feedback.view'
  if (path === '/ops/config') return 'config.view'
  if (path === '/ops/audit') return 'audit.view'
  if (path === '/promo') return 'promo.view'
  if (path === '/settings/admins') return 'admin.manage'
  if (path === '/settings/environment') return 'environment.view'
  return null
}

function Forbidden({ permission }: { permission: Permission }) {
  const { session } = useRouter()
  return (
    <div className="card" style={{ maxWidth: 560, margin: '60px auto', textAlign: 'center' }}>
      <h2 className="page-title" style={{ fontSize: 20 }}>没有访问权限</h2>
      <p className="muted" style={{ marginTop: 8 }}>当前角色「{ROLE_NAMES[session.user.role] ?? session.user.role}」缺少 {permission} 权限。</p>
      <p className="hint">如需访问，请联系项目负责人调整角色。</p>
    </div>
  )
}

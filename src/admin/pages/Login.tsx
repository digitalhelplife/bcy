import { useState, type FormEvent } from 'react'
import { api, ApiError } from '../api'
import type { SessionPayload } from '../App'

export function Login({ onLogin }: { onLogin: (s: SessionPayload) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [totp, setTotp] = useState('')
  const [needTotp, setNeedTotp] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const data = await api<SessionPayload>('/session', { method: 'POST', body: { username, password, totp: totp || undefined } })
      onLogin(data)
    } catch (err) {
      const e2 = err as ApiError
      if (e2.code === 'TOTP_REQUIRED') { setNeedTotp(true); setError('该账号启用了动态验证码，请输入 6 位验证码') }
      else if (e2.code === 'BAD_TOTP') { setNeedTotp(true); setError('动态验证码错误') }
      else setError(e2.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-brand">
          <div className="brand-mark">本</div>
          <div>
            <div className="login-title">本草小游记 · 运营后台</div>
            <div className="login-sub">单游戏 · 内测运营驾驶舱</div>
          </div>
        </div>
        <form onSubmit={submit}>
          <label className="field">
            <span>用户名</span>
            <input value={username} onChange={e => setUsername(e.target.value)} autoComplete="username" data-testid="login-username" required autoFocus />
          </label>
          <label className="field">
            <span>密码</span>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" data-testid="login-password" required />
          </label>
          {needTotp ? (
            <label className="field">
              <span>动态验证码</span>
              <input value={totp} onChange={e => setTotp(e.target.value)} inputMode="numeric" maxLength={6} placeholder="6 位数字" data-testid="login-totp" />
            </label>
          ) : null}
          {error ? <div className="error-box" role="alert" data-testid="login-error">{error}</div> : null}
          <button className="btn primary" style={{ width: '100%', marginTop: 14, minHeight: 38 }} disabled={busy} data-testid="login-submit">
            {busy ? '登录中…' : '登录'}
          </button>
        </form>
        <div className="login-hint">
          只允许项目授权的运营人员登录。所有敏感操作都会记入审计日志。<br />
          忘记密码请联系项目负责人重置。
        </div>
      </div>
    </div>
  )
}

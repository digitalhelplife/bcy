// Auth gate screens (PRD F01, doc 06 §6/§7). Shown over every screen while the game cannot be served.
import { useEffect, useState } from 'react'
import { CLIENT_BUILD } from '../../shared/content'
import { COMPLIANCE, asset } from '../../shared/content'
import { minorWindow } from '../../shared/minorPolicy'
import { describeMinorRule, LEGAL_MINOR_RULE, type MinorRule } from '../../shared/compliance'
import { AuthApiError, sendSms, verifySms } from '../../net/authApi'
import { Btn, errorText, useApp, useSnap } from '../common'
import { TrustChips } from '../trust'

/** Account deletion must stay reachable from every gate (PRD F16), not only from Settings. */
function DeleteLink() {
  const { client, confirm, toast } = useApp()
  return <Btn kind="ghost" small testId="gate-delete" onClick={() => confirm({
    title: '确定注销账号？', body: '会删除服务器上的游戏进度和身份核验记录，且无法恢复。',
    actions: [{ label: '再想想', kind: 'ghost' }, { label: '确认注销', kind: 'danger', onClick: async () => {
      try { await client.accountDelete(); toast('账号已注销'); setTimeout(() => location.reload(), 1200) } catch (e) { toast(errorText(e)) }
    } }],
  })}>注销账号</Btn>
}

const hh = (h: number) => `${String(h).padStart(2, '0')}:00`
const fmtWindow = (ms: number, rule: MinorRule) => {
  const d = new Date(ms + 8 * 3600_000)
  const wk = '日一二三四五六'[d.getUTCDay()]
  return `${d.getUTCMonth() + 1} 月 ${d.getUTCDate()} 日（周${wk}）${hh(rule.startHour)}–${hh(rule.endHour)}`
}
const msg = (e: unknown) => (e instanceof AuthApiError ? e.error.message : errorText(e))

export function AuthGate() {
  const snap = useSnap()
  const g = snap.gate
  if (!g) return null
  return (
    <div className="screen boot auth-gate">
      <img className="boot-logo" src={asset('brand/brand_wordmark')} alt="本草小游记·成都篇" />
      {g.kind === 'login' && <LoginOrIntro />}
      {g.kind === 'realname' && (g.pending ? <PendingCard /> : <RealnameCard />)}
      {g.kind === 'restricted' && <RestrictedCard />}
      {g.kind === 'deleted' && <DeletedCard />}
      {g.kind === 'outdated' && <OutdatedCard need={g.minClientBuild} />}
      <p className="tiny muted health">{COMPLIANCE.healthGameAdvice}</p>
      <p className="tiny muted">适龄提示 {COMPLIANCE.ageRating.display} · <a href="./legal/privacy.html" target="_blank" rel="noopener">隐私政策</a> · <a href="./legal/terms.html" target="_blank" rel="noopener">用户协议</a></p>
    </div>
  )
}

const INTRO_KEY = 'bcy.realnameIntro.seen'
/** A5 G6: explain why and how before asking for a phone number and ID. */
function LoginOrIntro() {
  const [seen, setSeen] = useState(() => { try { return sessionStorage.getItem(INTRO_KEY) === '1' } catch { return false } })
  if (seen) return <LoginCard />
  const go = () => { try { sessionStorage.setItem(INTRO_KEY, '1') } catch { /* private mode */ } setSeen(true) }
  return (
    <section className="card realname-intro" data-testid="realname-intro">
      <h3>开始前，先说清楚三件事</h3>
      <div className="intro-previews" aria-label="游戏画面预览">
        {(['scenes/scene_dujiangyan_thumb', 'scenes/scene_qingcheng_thumb', 'garden/garden_base_bg'] as const).map(k => <img key={k} src={asset(k)} alt="" loading="lazy" />)}
      </div>
      <p className="tiny muted center">逛都江堰、青城山、街子古镇 · 认识 24 种植物 · 布置自己的川西小院</p>
      <dl className="intro-list">
        <dt>为什么要实名？</dt>
        <dd>国家对网络游戏有防沉迷规定，所有玩家都要用手机号登录并实名认证，未成年人只能在规定时段游戏。</dd>
        <dt>信息怎么保护？</dt>
        <dd>身份证号只在提交核验时使用，我们不保存；只加密保存核验结果和出生年月，用于防沉迷。手机号同样加密保存。随时可以注销账号并删除记录。</dd>
        <dt>和孩子一起玩？</dt>
        <dd data-testid="intro-family">家长用自己的手机号和身份信息登录，陪在孩子身边一起玩、一起讲；如果孩子要自己玩，请用孩子本人的信息实名，按未成年人规定时段游戏。请不要把家长账号交给孩子独自使用。</dd>
        <dt>我们不做什么</dt>
        <dd>不放广告、没有付费、不要定位权限，也不会替你自动发布任何内容。</dd>
      </dl>
      <TrustChips />
      <Btn onClick={go} testId="intro-continue">知道了，去登录</Btn>
    </section>
  )
}

function LoginCard() {
  const { client } = useApp()
  const snap = useSnap()
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [cooldown, setCooldown] = useState(0)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [debug, setDebug] = useState<string | null>(null)
  useEffect(() => { if (cooldown <= 0) return; const t = setTimeout(() => setCooldown(c => c - 1), 1000); return () => clearTimeout(t) }, [cooldown])
  const phoneOk = /^1[3-9]\d{9}$/.test(phone)
  const send = async () => {
    setErr(null); setBusy(true)
    try { const r = await sendSms(phone); setCooldown(Math.ceil(r.retryAfterMs / 1000)); setDebug(r.debugCode ?? null) } catch (e) {
      if (e instanceof AuthApiError && e.error.code === 'REALNAME_DISABLED') { void client.boot(); return }
      setErr(msg(e)); if (e instanceof AuthApiError && e.error.retryAfterMs) setCooldown(Math.ceil(e.error.retryAfterMs / 1000))
    } finally { setBusy(false) }
  }
  const login = async () => {
    setErr(null); setBusy(true)
    try { const t = await verifySms(phone, code); await client.loginWithTicket(t.loginTicket) } catch (e) {
      if (e instanceof AuthApiError && e.error.code === 'REALNAME_DISABLED') { void client.boot(); return }
      setErr(msg(e))
    } finally { setBusy(false) }
  }
  return (
    <section className="card">
      <h3>手机号登录</h3>
      <p className="tiny muted">按国家网络游戏防沉迷要求，需用手机号登录并完成实名认证后才能游戏。</p>
      <label className="field">手机号
        <input inputMode="numeric" autoComplete="tel" maxLength={11} value={phone} onChange={e => setPhone(e.target.value.replace(/\D/g, ''))} placeholder="11 位手机号" data-testid="login-phone" />
      </label>
      <div className="row code-row">
        <label className="field grow">验证码
          <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} placeholder="6 位数字" data-testid="login-code" />
        </label>
        <Btn kind="soft" small disabled={!phoneOk || cooldown > 0 || busy} onClick={send} testId="login-send">{cooldown > 0 ? `${cooldown} 秒` : '获取验证码'}</Btn>
      </div>
      {debug && <p className="tiny debug-code" data-testid="login-debug">测试环境验证码：{debug}（正式环境通过短信发送）</p>}
      {err && <p className="tiny err" role="alert">{err}</p>}
      <Btn disabled={!phoneOk || code.length !== 6 || busy} onClick={login} testId="login-submit">{busy ? '请稍候…' : '登录'}</Btn>
      {snap.authConfig?.environment === 'staging' && <p className="tiny muted">当前为测试环境：短信与实名核验为模拟服务，请勿填写真实身份证信息。</p>}
    </section>
  )
}

function RealnameCard() {
  const { client } = useApp()
  const [name, setName] = useState('')
  const [id, setId] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const submit = async () => {
    setErr(null); setBusy(true)
    try { await client.submitRealname(name.trim(), id.trim().toUpperCase()) } catch (e) {
      if (e instanceof AuthApiError && (e.error.code === 'REALNAME_REQUIRED' || e.error.code === 'UNAUTHORIZED')) { await client.logout(); return }
      setErr(msg(e))
    } finally { setBusy(false) }
  }
  return (
    <section className="card">
      <h3>实名认证</h3>
      <p className="tiny muted">姓名和身份证号仅用于国家网络游戏防沉迷实名核验；游戏不保存身份证号和姓名，只保留核验结果与出生年月。</p>
      <label className="field">姓名
        <input autoComplete="name" maxLength={30} value={name} onChange={e => setName(e.target.value)} placeholder="与身份证一致" data-testid="rn-name" />
      </label>
      <label className="field">身份证号
        <input autoComplete="off" maxLength={18} value={id} onChange={e => setId(e.target.value.replace(/[^\dxX]/g, ''))} placeholder="18 位" data-testid="rn-id" />
      </label>
      {err && <p className="tiny err" role="alert">{err}</p>}
      <Btn disabled={name.trim().length < 2 || id.length !== 18 || busy} onClick={submit} testId="rn-submit">{busy ? '核验中…' : '提交认证'}</Btn>
      <Btn kind="ghost" small onClick={() => void client.logout()}>换个手机号登录</Btn>
      <DeleteLink />
    </section>
  )
}

function PendingCard() {
  const { client } = useApp()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const check = async () => { setErr(null); setBusy(true); try { await client.refreshRealname() } catch (e) { setErr(msg(e)) } finally { setBusy(false) } }
  useEffect(() => { const t = setInterval(() => { void client.refreshRealname().catch(() => undefined) }, 15_000); return () => clearInterval(t) }, [client])
  return (
    <section className="card">
      <h3>实名认证审核中</h3>
      <p className="tiny">核验结果返回前暂不能游戏。通常很快完成，本页每 15 秒自动刷新一次。</p>
      {err && <p className="tiny err" role="alert">{err}</p>}
      <Btn disabled={busy} onClick={check} testId="rn-refresh">{busy ? '查询中…' : '刷新认证状态'}</Btn>
      <Btn kind="ghost" small onClick={() => void client.logout()}>退出登录</Btn>
      <DeleteLink />
    </section>
  )
}

function RestrictedCard() {
  const { client } = useApp()
  const snap = useSnap()
  // The server sends the rule configured in the admin console; older servers send none → national rule.
  const rule = snap.account?.minorPolicy.rule ?? LEGAL_MINOR_RULE
  const next = minorWindow(client.serverNow(), rule).nextWindowStartMs
  return (
    <section className="card" data-testid="gate-restricted">
      <h3>{rule.mode === 'block' ? '暂不向未成年人提供服务' : '现在不是可游戏时段'}</h3>
      <p>{rule.mode === 'block' ? '根据本游戏的未成年人保护设置，' : '根据国家规定，'}{describeMinorRule(rule)}。</p>
      {next && <p className="tiny">下一次可游戏时间：<b>{fmtWindow(next, rule)}</b></p>}
      <p className="tiny muted">去看看身边真实的植物吧，小院会一直为你保留。</p>
      <Btn onClick={() => void client.boot()}>到时间了，重新进入</Btn>
      <Btn kind="ghost" small onClick={() => void client.logout()}>退出登录</Btn>
      <DeleteLink />
    </section>
  )
}

function OutdatedCard({ need }: { need: string | null }) {
  // Cache-busting reload; progress lives on the server, so nothing local is lost.
  const reload = () => { const u = new URL(location.href); u.searchParams.set('v', String(Date.now())); location.replace(u.toString()) }
  return (
    <section className="card" data-testid="gate-outdated">
      <h3>游戏有新版本</h3>
      <p className="tiny">当前页面版本 {CLIENT_BUILD}{need ? `，需要 ${need} 或更新` : ''}。刷新后即可继续，游戏进度保存在服务器上，不会丢失。</p>
      <Btn onClick={reload}>刷新页面</Btn>
    </section>
  )
}
function DeletedCard() {
  const { client } = useApp()
  return (
    <section className="card">
      <h3>账号已注销</h3>
      <p className="tiny">该账号的游戏进度和身份信息已按注销流程删除，无法恢复。</p>
      <Btn onClick={() => void client.logout()}>重新登录</Btn>
    </section>
  )
}

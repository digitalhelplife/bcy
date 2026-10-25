// End-to-end auth flow against a deployed server (staging/mock providers only).
// Usage: NAKAMA_SERVER_KEY=... node backend/auth/flow.remote.mjs https://ex-game.tryliang.me
import { Client } from '@heroiclabs/nakama-js'
import { readFileSync } from 'node:fs'
const CLIENT_BUILD = process.env.CLIENT_BUILD || readFileSync(new URL('../../src/shared/content.ts', import.meta.url), 'utf8').match(/CLIENT_BUILD = '([^']+)'/)[1]
import { randomUUID } from 'node:crypto'

const BASE = (process.argv[2] || 'https://ex-game.tryliang.me').replace(/\/$/, '')
const u = new URL(BASE)
const client = new Client(process.env.NAKAMA_SERVER_KEY, u.hostname, u.port || (u.protocol === 'https:' ? '443' : '80'), u.protocol === 'https:')
let pass = 0, fail = 0
const check = (name, cond, extra = '') => { if (cond) { pass++; console.log('  ✓', name) } else { fail++; console.log('  ✗', name, extra) } }
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function http(method, path, body, headers = {}) {
  const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined })
  let j = null; try { j = await r.json() } catch { /* */ }
  return { status: r.status, j, headers: r.headers }
}
const rpc = async (session, id, payload = {}, write = false) => {
  const body = write ? { apiVersion: 1, clientBuild: CLIENT_BUILD, requestId: randomUUID(), expectedStateRevision: 0, payload } : { apiVersion: 1, clientBuild: CLIENT_BUILD, payload }
  try { const r = await client.rpc(session, id, body); return r.payload } catch (e) { return { httpStatus: e.status ?? 'ERR' } }
}
function makeId(birth) {
  const W = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2], C = '10X98765432'
  const b = '110101' + birth + String(Math.floor(Math.random() * 900) + 100); let s = 0
  for (let i = 0; i < 17; i++) s += Number(b[i]) * W[i]
  return b + C[s % 11]
}
const testPhone = () => '199' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0')
let lastSend = 0
async function login(phone) {
  const wait = 11_000 - (Date.now() - lastSend); if (wait > 0) await sleep(wait) // Nginx bcy_sms 6 r/min
  const s = await http('POST', '/auth/sms/send', { phone }); lastSend = Date.now()
  if (!s.j?.ok) throw new Error('sms send failed ' + JSON.stringify(s.j))
  const v = await http('POST', '/auth/sms/verify', { phone, code: s.j.data.debugCode })
  if (!v.j?.ok) throw new Error('verify failed ' + JSON.stringify(v.j))
  return { ticket: v.j.data.loginTicket, session: await client.authenticateCustom(v.j.data.loginTicket, true) }
}
const cleanup = []
// A crash mid-run must not leave realname switched on by this test: restore first, then fail.
process.on('unhandledRejection', async e => {
  console.error('FATAL', e?.message || e)
  try { if (globalThis.__restore) await globalThis.__restore() } finally { process.exit(1) }
})

console.log('admin console exposure')
const page = await fetch(BASE + '/admin/')
check('/admin/ served with strict CSP + DENY framing', page.status === 200 && /frame-ancestors 'none'/.test(page.headers.get('content-security-policy') || '') && page.headers.get('x-frame-options') === 'DENY', String(page.status))
check('/admin/api/config requires login (401)', (await http('GET', '/admin/api/config')).status === 401)
check('/admin POST without anti-CSRF header refused (403)', (await http('POST', '/admin/api/login', { password: 'x' })).status === 403)
const ADMIN = { 'x-bcy-admin': '1' }
let adminCookie = null, restore = null
async function admin(method, path, body) { return http(method, '/admin/api/' + path, body, { ...ADMIN, ...(adminCookie ? { cookie: adminCookie } : {}) }) }

console.log('config & exposure')
let cfg = await http('GET', '/auth/config')
check('auth config is staging with a runtime config version', cfg.j?.data?.environment === 'staging' && Number.isInteger(cfg.j?.data?.configVersion), JSON.stringify(cfg.j))
if (cfg.j?.data?.authMode === 'device') {
  // Realname is switched off in the admin console (testing default).
  const off = await http('POST', '/auth/sms/send', { phone: testPhone() })
  check('realname off → sms/send refused with REALNAME_DISABLED (no phone collected)', off.status === 403 && off.j?.error?.code === 'REALNAME_DISABLED', JSON.stringify(off.j))
  const dv = await client.authenticateDevice('bcy-e2e-' + randomUUID(), true)
  const st = await rpc(dv, 'game.account.status'), bs = await rpc(dv, 'game.bootstrap')
  check('realname off → device trial account is served', st.ok && st.data.authMode === 'device_trial' && bs.ok, JSON.stringify(bs).slice(0, 120))
  cleanup.push({ session: dv })
  if (!process.env.BCY_ADMIN_PASSWORD) {
    for (const c of cleanup) { const r = await rpc(c.session, 'game.account.delete', { confirm: true }, true); check('cleanup delete device account', r.ok === true) }
    console.log('\n(realname is off; set BCY_ADMIN_PASSWORD to also run the phone + realname flow)')
    console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
  }
  // Temporarily switch realname ON through the admin API; restored in the finally-handler below.
  const lg = await admin('POST', 'login', { password: process.env.BCY_ADMIN_PASSWORD })
  check('admin login', lg.status === 200, JSON.stringify(lg.j))
  adminCookie = (lg.headers.get('set-cookie') || '').split(';')[0]
  const cur = (await admin('GET', 'config')).j.data.config
  restore = { realnameEnabled: cur.realnameEnabled, minor: cur.minor }
  const on = await admin('POST', 'config', { config: { ...restore, realnameEnabled: true }, expectedVersion: cur.version, note: 'flow.remote 测试临时开启实名' })
  check('admin switches realname on', on.status === 200 && on.j.data.config.realnameEnabled === true, JSON.stringify(on.j).slice(0, 160))
  const restoreNow = async () => {
    if (!restore) return
    const now = (await admin('GET', 'config')).j.data.config
    const r = await admin('POST', 'config', { config: restore, expectedVersion: now.version, note: 'flow.remote 测试结束，恢复原配置' })
    console.log(r.status === 200 ? `restored admin config → v${r.j.data.config.version} realname=${r.j.data.config.realnameEnabled}` : 'RESTORE FAILED ' + JSON.stringify(r.j))
    restore = null
  }
  process.on('exit', () => { if (restore) console.log('WARNING: admin config was NOT restored — fix it at /admin/') })
  globalThis.__restore = restoreNow
  await sleep(14_000) // Nakama caches the runtime config for 10 s
  cfg = await http('GET', '/auth/config')
}
check('auth config is realname now', cfg.j?.data?.authMode === 'realname', JSON.stringify(cfg.j))
for (const p of ['/auth/account/delete', '/internal/ticket/consume', '/auth/healthz', '/internal/account/state?sub=x']) {
  const r = await http(p.includes('state') || p.includes('healthz') ? 'GET' : 'POST', p, p.includes('state') || p.includes('healthz') ? undefined : {})
  check(`${p} not exposed (404)`, r.status === 404, String(r.status))
}

console.log('sms login')
const phoneA = testPhone()
const sA = await http('POST', '/auth/sms/send', { phone: phoneA }); lastSend = Date.now()
check('send returns staging debug code', /^\d{6}$/.test(sA.j?.data?.debugCode || ''))
const again = await http('POST', '/auth/sms/send', { phone: phoneA })
check('resend within 60 s is rate limited', again.status === 429 && (again.j?.error?.code === 'RATE_LIMITED' || again.j === null), String(again.status))
const bad = await http('POST', '/auth/sms/verify', { phone: phoneA, code: sA.j.data.debugCode === '000000' ? '111111' : '000000' })
check('wrong code → CODE_INVALID', bad.j?.error?.code === 'CODE_INVALID')
const unk = await http('POST', '/auth/sms/send', { phone: phoneA, extra: 1 })
check('unknown field rejected', unk.status === 400 || unk.status === 429)
const vA = await http('POST', '/auth/sms/verify', { phone: phoneA, code: sA.j.data.debugCode })
check('verify returns LT- ticket without phone', /^LT-[A-Z2-7]{90}$/.test(vA.j?.data?.loginTicket || '') && !vA.j.data.loginTicket.includes(phoneA))
const sessA = await client.authenticateCustom(vA.j.data.loginTicket, true)
check('ticket → Nakama session', !!sessA.token)
let replay = null; try { await client.authenticateCustom(vA.j.data.loginTicket, true) } catch (e) { replay = e.status }
check('ticket is one-time (replay rejected)', replay !== null, String(replay))
let direct = null; try { await client.authenticateCustom('bcy-' + randomUUID(), true) } catch (e) { direct = e.status }
check('direct bcy- custom id rejected', direct !== null)

console.log('realname gate')
const st0 = await rpc(sessA, 'game.account.status')
check('status UNVERIFIED, phone_realname', st0.ok && st0.data.realnameStatus === 'UNVERIFIED' && st0.data.authMode === 'phone_realname')
check('status leaks no phone', !JSON.stringify(st0).includes(phoneA))
const b0 = await rpc(sessA, 'game.bootstrap')
check('bootstrap before realname → REALNAME_REQUIRED', b0.error?.code === 'REALNAME_REQUIRED', JSON.stringify(b0).slice(0, 120))
const dev = await client.authenticateDevice('bcy-e2e-' + randomUUID(), true)
cleanup.push({ session: dev })
const bd = await rpc(dev, 'game.bootstrap')
check('device-trial session gets no game service in realname mode', bd.error?.code === 'REALNAME_REQUIRED')
const tok = { authorization: `Bearer ${sessA.token}` }
const inv = await http('POST', '/auth/realname/submit', { name: '张三', idNumber: '110101199001011234' }, tok)
check('invalid ID checksum → REALNAME_INVALID', inv.j?.error?.code === 'REALNAME_INVALID' || inv.j?.error?.code === 'REALNAME_FAILED', JSON.stringify(inv.j))
const devSubmit = await http('POST', '/auth/realname/submit', { name: '张三', idNumber: makeId('19900101') }, { authorization: `Bearer ${dev.token}` })
check('device session cannot submit realname', devSubmit.j?.error?.code === 'REALNAME_REQUIRED')
const okA = await http('POST', '/auth/realname/submit', { name: '张三', idNumber: makeId('19900101') }, tok)
check('adult → VERIFIED_ADULT', okA.j?.data?.realnameStatus === 'VERIFIED_ADULT', JSON.stringify(okA.j))
await sleep(500)
const b1 = await rpc(sessA, 'game.bootstrap')
check('bootstrap after realname OK', b1.ok === true, JSON.stringify(b1).slice(0, 160))
const hb = await rpc(sessA, 'game.playtime.heartbeat', {}, true)
check('heartbeat returns status', hb.ok && hb.data.result?.realnameStatus === 'VERIFIED_ADULT', JSON.stringify(hb).slice(0, 160))
const again2 = await http('POST', '/auth/realname/submit', { name: '李四', idNumber: makeId('19850101') }, tok)
check('verified account cannot be re-verified with other identity', again2.j?.data?.realnameStatus === 'VERIFIED_ADULT')

console.log('minor')
const phoneM = testPhone(); const m = await login(phoneM); cleanup.push({ session: m.session, phone: phoneM })
const okM = await http('POST', '/auth/realname/submit', { name: '王小明', idNumber: makeId('20120601') }, { authorization: `Bearer ${m.session.token}` })
check('minor → VERIFIED_MINOR', okM.j?.data?.realnameStatus === 'VERIFIED_MINOR')
const mst = await rpc(m.session, 'game.account.status')
const bjNow = new Date(Date.now() + 8 * 3600_000); const wd = bjNow.getUTCDay(), h = bjNow.getUTCHours()
const inWindow = (wd === 5 || wd === 6 || wd === 0) && h === 20 // holidays ignored for the expectation
check(`minor restricted=${!inWindow} now (Beijing ${bjNow.toISOString().slice(0, 16)})`, mst.ok && mst.data.minorPolicy.restricted === !inWindow, JSON.stringify(mst.data?.minorPolicy))
if (!inWindow) {
  check('next window is 20:00 Beijing', new Date(mst.data.minorPolicy.nextWindowStartMs + 8 * 3600_000).getUTCHours() === 20)
  const mb = await rpc(m.session, 'game.bootstrap')
  check('minor outside window → MINOR_TIME_RESTRICTED', mb.error?.code === 'MINOR_TIME_RESTRICTED', JSON.stringify(mb).slice(0, 120))
  let refreshed = null; try { await client.sessionRefresh(m.session) ; refreshed = 'ok' } catch (e) { refreshed = e.status }
  console.log('    (minor session refresh after cut-off:', refreshed, ')')
}

console.log('pending')
const phoneP = testPhone(); const p = await login(phoneP); cleanup.push({ session: p.session, phone: phoneP })
const okP = await http('POST', '/auth/realname/submit', { name: '测试认证中', idNumber: makeId('19900101') }, { authorization: `Bearer ${p.session.token}` })
check('pending name → PENDING', okP.j?.data?.realnameStatus === 'PENDING')
await sleep(25_000) // Nakama localcache TTL 20 s
const pb = await rpc(p.session, 'game.bootstrap')
check('PENDING → REALNAME_PENDING', pb.error?.code === 'REALNAME_PENDING', JSON.stringify(pb).slice(0, 120))
await sleep(7000)
const ps = await http('GET', '/auth/realname/status', null, { authorization: `Bearer ${p.session.token}` })
check('pending resolves to VERIFIED_ADULT after 30 s', ps.j?.data?.realnameStatus === 'VERIFIED_ADULT', JSON.stringify(ps.j))

console.log('deletion')
const del = await rpc(sessA, 'game.account.delete', { confirm: true }, true)
check('account.delete OK', del.ok === true, JSON.stringify(del).slice(0, 160))
let rf = null; try { await client.sessionRefresh(sessA); rf = 'refreshed' } catch (e) { rf = e.status ?? 'rejected' }
check('refresh after deletion rejected', rf !== 'refreshed', String(rf))
const re = await login(phoneA); cleanup.push({ session: re.session, phone: phoneA })
const reSt = await rpc(re.session, 'game.account.status')
check('same phone after deletion = fresh UNVERIFIED account', reSt.ok && reSt.data.realnameStatus === 'UNVERIFIED' && re.session.user_id !== sessA.user_id)

console.log('cleanup')
for (const c of cleanup) {
  let r = await rpc(c.session, 'game.account.delete', { confirm: true }, true)
  if (!r.ok && c.phone) { const again = await login(c.phone); r = await rpc(again.session, 'game.account.delete', { confirm: true }, true) } // session revoked (minor cut-off)
  check(`cleanup delete ${c.phone ? 'phone' : 'device'} account`, r.ok === true, JSON.stringify(r).slice(0, 120))
}
if (globalThis.__restore) await globalThis.__restore()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)

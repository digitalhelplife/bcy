// Load test (doc 08 §12.3): N concurrent players, mixed read/write RPCs for D seconds; backend p95 <= 500 ms.
// Usage on the server: NAKAMA_SERVER_KEY=... node loadtest.mjs [vus=50] [seconds=300] [base=http://127.0.0.1:7350]
// Every virtual user authenticates with a throwaway device id and calls game.account.delete at the end.
const VUS = Number(process.argv[2] || 50)
const SECS = Number(process.argv[3] || 300)
const BASE = process.argv[4] || 'http://127.0.0.1:7350'
const KEY = process.env.NAKAMA_SERVER_KEY
if (!KEY) { console.error('NAKAMA_SERVER_KEY required'); process.exit(2) }
// Must be >= the server's BCY_MIN_CLIENT_BUILD (default: the deployed build), else writes get CLIENT_OUTDATED.
const CLIENT_BUILD = process.env.CLIENT_BUILD || '2.2.0'

const PROOF_FIND = { kind: 'find', foundTargetIds: ['target_yuzui', 'target_feishayan', 'target_baopingkou'], gates: { fog_revealed: true } }
const lat = {}; const errs = {}; let calls = 0
const rec = (name, ms, ok, code) => {
  (lat[name] ??= []).push(ms); calls++
  if (!ok) { const k = `${name}:${code}`; errs[k] = (errs[k] ?? 0) + 1 }
}
const uuid = () => crypto.randomUUID()
async function timed(name, fn) {
  const t = performance.now()
  try { const r = await fn(); rec(name, performance.now() - t, r.ok !== false, r.ok === false ? r.code : ''); return r }
  catch (e) { rec(name, performance.now() - t, false, 'NET'); return { ok: false, code: 'NET' } }
}
async function auth() {
  const res = await fetch(`${BASE}/v2/account/authenticate/device?create=true`, {
    method: 'POST', headers: { Authorization: 'Basic ' + Buffer.from(KEY + ':').toString('base64'), 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'loadtest-' + uuid() }),
  })
  if (!res.ok) return { ok: false, code: 'HTTP' + res.status }
  return { ok: true, token: (await res.json()).token }
}
async function rpc(token, id, body) {
  const res = await fetch(`${BASE}/v2/rpc/${id}`, {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(JSON.stringify(body)),
  })
  if (!res.ok) return { ok: false, code: 'HTTP' + res.status }
  const env = JSON.parse((await res.json()).payload)
  return env.ok ? { ok: true, env } : { ok: false, code: env.error?.code ?? 'ERR', env }
}
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function vu(i, deadline) {
  const a = await timed('auth.device', auth); if (!a.ok) return
  const t = a.token
  let rev = 0
  const read = (id, payload = {}) => timed(id, () => rpc(t, id, { apiVersion: 1, clientBuild: CLIENT_BUILD, payload }))
  const write = async (id, payload) => {
    const r = await timed(id, () => rpc(t, id, { apiVersion: 1, clientBuild: CLIENT_BUILD, requestId: uuid(), expectedStateRevision: rev, payload }))
    if (r.env?.stateRevision) rev = r.env.stateRevision
    return r
  }
  const b = await read('game.bootstrap'); rev = b.env?.data?.state?.stateRevision ?? 1
  let n = 0
  while (Date.now() < deadline) {
    // A realistic player loop: explore, settle, look at state, garden save, codex reads. ~1 action / 1.5 s.
    const s = await write('game.run.start', { levelId: 'dujiangyan_find', route: 'plant' })
    await sleep(800 + Math.random() * 700)
    if (s.ok) await write('game.run.finish', { runId: s.env.data.result.run.runId, proof: PROOF_FIND })
    await sleep(500 + Math.random() * 500)
    const st = await read('game.state.get'); if (st.env?.stateRevision) rev = st.env.stateRevision
    await sleep(500 + Math.random() * 500)
    if (n % 3 === 0) {
      const g = st.env?.data?.state?.garden
      if (g) await write('game.garden.save', { paletteId: g.paletteId, placements: g.placements })
    }
    if (n % 5 === 0) await read('game.account.status')
    n++
    await sleep(500 + Math.random() * 1000)
  }
  await write('game.account.delete', { confirm: true })
}

const pct = (arr, p) => { const s = [...arr].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0 }
const deadline = Date.now() + SECS * 1000
const t0 = Date.now()
// ramp up over 10 s
await Promise.all(Array.from({ length: VUS }, (_, i) => sleep((i * 10000) / VUS).then(() => vu(i, deadline))))
const all = Object.values(lat).flat()
const rows = Object.entries(lat).map(([k, v]) => ({ rpc: k, n: v.length, p50: pct(v, .5).toFixed(0), p95: pct(v, .95).toFixed(0), p99: pct(v, .99).toFixed(0), max: Math.max(...v).toFixed(0) }))
console.table(rows)
// Business rejections (the per-player run.start limit, stale revisions) are correct server behaviour, not faults.
const EXPECTED = /:(RATE_LIMITED|STATE_CONFLICT|RUN_ALREADY_ACTIVE)$/
const errTotal = Object.entries(errs).filter(([k]) => !EXPECTED.test(k)).reduce((a, [, b]) => a + b, 0)
const businessRejections = Object.entries(errs).filter(([k]) => EXPECTED.test(k)).reduce((a, [, b]) => a + b, 0)
const summary = { vus: VUS, seconds: Math.round((Date.now() - t0) / 1000), calls, rps: +(calls / ((Date.now() - t0) / 1000)).toFixed(1), p50: +pct(all, .5).toFixed(0), p95: +pct(all, .95).toFixed(0), p99: +pct(all, .99).toFixed(0), errorRate: +(errTotal / Math.max(1, calls)).toFixed(4), businessRejections, errors: errs }
console.log(JSON.stringify(summary))
console.log(summary.p95 <= 500 && summary.errorRate < 0.01 ? 'LOADTEST PASS (p95<=500ms, errors<1%)' : 'LOADTEST FAIL')

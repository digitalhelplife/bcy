import { Client } from '@heroiclabs/nakama-js'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
const env = Object.fromEntries(readFileSync('.env.production.local', 'utf8').split(/\n/).filter(Boolean).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)] }))
const key = env.VITE_NAKAMA_SERVER_KEY
const host = env.VITE_NAKAMA_HOST
const port = env.VITE_NAKAMA_PORT
const ssl = env.VITE_NAKAMA_SSL === 'true'
if (!key || !host) throw new Error('missing Nakama env')
const client = new Client(key, host, port, ssl, 15000)
const build = readFileSync('src/shared/content.ts', 'utf8').match(/CLIENT_BUILD = '([^']+)'/)?.[1]
if (!build) throw new Error('missing CLIENT_BUILD')
const body = (payload, extra = {}) => ({ apiVersion: 1, clientBuild: build, ...extra, payload })
const rpc = async (s, id, payload, extra = {}) => {
  const r = await client.rpc(s, id, body(payload, extra))
  const j = typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload
  return j
}
const must = (j, label) => { if (!j.ok) throw new Error(`${label}: ${j.error?.code} ${j.error?.message}`); return j }
const login = async (tag) => {
  const s = await client.authenticateDevice(`bcy-a7-${tag}-${randomUUID()}`, true)
  const b = must(await rpc(s, 'game.bootstrap', { clientBuild: build }), 'bootstrap')
  return { s, b }
}
const a = await login('src')
console.log('bootstrap', a.b.ok, 'rev', a.b.stateRevision, 'build', a.b.data?.minClientBuild)
let rev = a.b.stateRevision
const st = must(await rpc(a.s, 'game.run.start', { levelId: 'dujiangyan_find', route: 'plant' }, { requestId: randomUUID(), expectedStateRevision: rev }), 'run.start')
rev = st.stateRevision
const runId = st.data.result.run.runId
const proof = { kind: 'find', foundTargetIds: ['target_yuzui', 'target_feishayan', 'target_baopingkou'], gates: { fog_revealed: true } }
const fin = must(await rpc(a.s, 'game.run.finish', { runId, proof }, { requestId: randomUUID(), expectedStateRevision: rev }), 'run.finish')
rev = fin.stateRevision
console.log('run.finish', fin.ok, 'grant', JSON.stringify(fin.data.result.grants), 'rev', rev)
const set = must(await rpc(a.s, 'game.settings.update', { parentMode: true }, { requestId: randomUUID(), expectedStateRevision: rev }), 'settings')
rev = set.stateRevision
console.log('settings.parentMode', set.data.state.settings.parentMode)
const save = must(await rpc(a.s, 'game.garden.save', { paletteId: 'green', placements: [{ instanceId: 'a7-bench', itemId: 'decor_bench', x: 0, y: 0 }] }, { requestId: randomUUID(), expectedStateRevision: rev }), 'garden.save')
rev = save.stateRevision
console.log('garden.save', save.data.state.garden.placements.length)
const share = must(await rpc(a.s, 'game.garden.share.create', {}, { requestId: randomUUID() }), 'garden.share.create')
const code = share.data.result.code
const view = must(await rpc(a.s, 'game.garden.share.get', { code }), 'garden.share.get')
console.log('garden.share', view.data.mine, view.data.placements.length)
must(await rpc(a.s, 'game.garden.share.revoke', {}, { requestId: randomUUID() }), 'garden.share.revoke')
const tc = must(await rpc(a.s, 'game.transfer.create', {}, { requestId: randomUUID() }), 'transfer.create')
const tcode = tc.data.result.code
const b = await login('dst')
const claimed = must(await rpc(b.s, 'game.transfer.claim', { code: tcode }, { requestId: randomUUID(), expectedStateRevision: b.b.stateRevision }), 'transfer.claim')
console.log('transfer.claim', claimed.ok, 'levels', claimed.data.result.levelsCleared, 'plants', claimed.data.result.plantsDiscovered)
const status = must(await rpc(a.s, 'game.request.status', { requestId: randomUUID() }), 'request.status')
console.log('request.status', status.data.status)
must(await rpc(a.s, 'game.account.delete', { confirm: true }, { requestId: randomUUID() }), 'account.delete a')
must(await rpc(b.s, 'game.account.delete', { confirm: true }, { requestId: randomUUID() }), 'account.delete b')
console.log('REMOTE_SMOKE_OK')

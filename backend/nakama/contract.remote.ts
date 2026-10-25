// Remote contract test against a REAL Nakama server running backend/nakama/build/bencaoyou.js.
// Run:  NAKAMA_URL=https://ex-game.tryliang.me NAKAMA_SERVER_KEY=... pnpm test:nakama
// Each test creates a brand-new throwaway player (device, or SMS + mock realname in realname mode) and deletes it afterwards.
import { afterAll, describe, expect, it } from 'vitest'
import { SCENES, puzzlePieces, CLIENT_BUILD } from '../../src/shared/content'
import type { LevelId, Proof } from '../../src/shared/types'

const URL_ = process.env.NAKAMA_URL || 'https://ex-game.tryliang.me'
const KEY = process.env.NAKAMA_SERVER_KEY || ''
const uuid = () => crypto.randomUUID()

// Server auth mode decides how a throwaway player is created. In realname mode (doc 06 §8) a device session is
// refused, so each test logs in by SMS (staging mock provider returns debugCode) and passes adult mock realname.
// Costs one SMS per login: Nginx bcy_sms = 6 r/min per IP, auth service 30/day per IP.
const AUTH = await fetch(`${URL_}/auth/config`).then(r => (r.ok ? r.json() : null)).catch(() => null)
const REALNAME = AUTH?.data?.authMode === 'realname'
const TOKENS: string[] = []
let lastSms = 0
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
function adultId() {
  const W = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2], C = '10X98765432'
  const b = '11010119900101' + String(Math.floor(Math.random() * 900) + 100); let sum = 0
  for (let i = 0; i < 17; i++) sum += Number(b[i]) * W[i]
  return b + C[sum % 11]
}
const authPost = async (path: string, body: unknown, token?: string) => {
  const r = await fetch(`${URL_}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) })
  return { status: r.status, j: await r.json().catch(() => null) as any }
}
const basic = { Authorization: 'Basic ' + Buffer.from(KEY + ':').toString('base64'), 'Content-Type': 'application/json' }
async function login(): Promise<string> {
  let token: string
  if (!REALNAME) {
    const r = await fetch(`${URL_}/v2/account/authenticate/device?create=true`, { method: 'POST', headers: basic, body: JSON.stringify({ id: 'contract-' + uuid() }) })
    expect(r.status).toBe(200)
    token = (await r.json()).token
  } else {
    const wait = 11_000 - (Date.now() - lastSms); if (wait > 0) await sleep(wait)
    const phone = '199' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0')
    const sent = await authPost('/auth/sms/send', { phone }); lastSms = Date.now()
    expect(sent.j?.ok, `sms send ${sent.status} ${JSON.stringify(sent.j)}`).toBe(true)
    const v = await authPost('/auth/sms/verify', { phone, code: sent.j.data.debugCode })
    expect(v.j?.ok, JSON.stringify(v.j)).toBe(true)
    const r = await fetch(`${URL_}/v2/account/authenticate/custom?create=true`, { method: 'POST', headers: basic, body: JSON.stringify({ id: v.j.data.loginTicket }) })
    expect(r.status).toBe(200)
    token = (await r.json()).token
    const rn = await authPost('/auth/realname/submit', { name: '契约测试', idNumber: adultId() }, token)
    expect(rn.j?.ok, JSON.stringify(rn.j)).toBe(true)
  }
  TOKENS.push(token)
  return token
}
afterAll(async () => {
  // Remove every throwaway account (game data + identity) so the live server keeps no test players.
  for (const t of TOKENS) await rpc(t, 'game.account.delete', { apiVersion: 1, clientBuild: CLIENT_BUILD, requestId: uuid(), expectedStateRevision: 0, payload: { confirm: true } }).catch(() => undefined)
})
async function rpc(token: string, id: string, body: unknown): Promise<any> {
  const r = await fetch(`${URL_}/v2/rpc/${id}`, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(JSON.stringify(body)) })
  const j = await r.json()
  if (r.status !== 200) throw new Error(`HTTP ${r.status} ${JSON.stringify(j)}`)
  return JSON.parse(j.payload)
}
const read = (t: string, id: string, payload: object = {}) => rpc(t, id, { apiVersion: 1, clientBuild: CLIENT_BUILD, payload })
const write = (t: string, id: string, payload: object, rev: number, requestId = uuid()) => rpc(t, id, { apiVersion: 1, clientBuild: CLIENT_BUILD, requestId, expectedStateRevision: rev, payload })

function proofFor(levelId: LevelId): Proof {
  if (levelId.endsWith('find')) {
    const sc = SCENES[levelId.split('_')[0] as keyof typeof SCENES]
    return { kind: 'find', foundTargetIds: sc.targets.map(t => t.targetId), gates: sc.fog ? { [sc.fog.gate]: true } : {} }
  }
  return { kind: 'puzzle', slots: puzzlePieces(levelId).map(p => ({ pieceId: p.pieceId, slotIndex: p.slotIndex })) }
}
async function play(t: string, levelId: LevelId, route: 'plant' | 'decor', rev: number) {
  const s = await write(t, 'game.run.start', { levelId, route }, rev)
  expect(s.ok, JSON.stringify(s.error)).toBe(true)
  const f = await write(t, 'game.run.finish', { runId: s.data.result.run.runId, proof: proofFor(levelId) }, s.stateRevision)
  expect(f.ok, JSON.stringify(f.error)).toBe(true)
  return f
}

describe.skipIf(!KEY)('Nakama bencaoyou module (remote)', () => {
  it('bootstrap creates initial state once and is idempotent', async () => {
    const t = await login()
    const [a, b] = await Promise.all([read(t, 'game.bootstrap', { clientBuild: '1.1.0' }), read(t, 'game.bootstrap', { clientBuild: '1.1.0' })])
    expect(a.ok && b.ok).toBe(true)
    expect(a.data.state.stateRevision).toBe(1)
    expect(b.data.state.createdAtMs).toBe(a.data.state.createdAtMs)
    expect(a.data.state.inventory).toEqual({ decor_bench: 1, decor_clay_pot: 1 })
    expect(a.data.dayKey).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('full tutorial loop: find → mint seed → instant grow → claim → garden save', async () => {
    const t = await login(); await read(t, 'game.bootstrap', {})
    const f = await play(t, 'dujiangyan_find', 'plant', 1)
    expect(f.data.result.firstCompletion).toBe(true)
    expect(f.data.state.inventory.seed_mint).toBe(2)
    const ps = await write(t, 'game.plant.start', { plotId: 'plot_1', seedItemId: 'seed_mint' }, f.stateRevision)
    expect(ps.ok).toBe(true); expect(ps.data.result.tutorialInstant).toBe(true)
    const pc = await write(t, 'game.plant.claim', { plotId: 'plot_1', plantingId: ps.data.result.planting.plantingId }, ps.stateRevision)
    expect(pc.ok).toBe(true); expect(pc.data.state.inventory.plant_mint).toBe(1)
    const gs = await write(t, 'game.garden.save', { paletteId: 'green', placements: [{ instanceId: uuid(), itemId: 'plant_mint', x: 1, y: 1 }] }, pc.stateRevision)
    expect(gs.ok, JSON.stringify(gs.error)).toBe(true)
    expect(gs.data.state.garden.placements).toHaveLength(1)
    // second ordinary planting is NOT instant (300 s)
    const ps2 = await write(t, 'game.plant.start', { plotId: 'plot_2', seedItemId: 'seed_mint' }, gs.stateRevision)
    expect(ps2.data.result.tutorialInstant).toBe(false)
    const early = await write(t, 'game.plant.claim', { plotId: 'plot_2', plantingId: ps2.data.result.planting.plantingId }, ps2.stateRevision)
    expect(early.error.code).toBe('PLANT_NOT_READY')
  })

  it('idempotent replay, key reuse and stale revision', async () => {
    const t = await login(); await read(t, 'game.bootstrap', {})
    const rid = uuid()
    // v2.1: during the tutorial a new player's first exploration must use the plant route.
    const forced = await write(t, 'game.run.start', { levelId: 'dujiangyan_find', route: 'decor' }, 1)
    expect(forced.ok).toBe(false)
    const a = await write(t, 'game.run.start', { levelId: 'dujiangyan_find', route: 'plant' }, 1, rid)
    const b = await write(t, 'game.run.start', { levelId: 'dujiangyan_find', route: 'plant' }, 1, rid)
    expect(a.ok && b.ok).toBe(true); expect(b.replayed).toBe(true)
    expect(b.data.result.run.runId).toBe(a.data.result.run.runId)
    const reuse = await write(t, 'game.run.start', { levelId: 'dujiangyan_find', route: 'decor' }, 1, rid)
    expect(reuse.error.code).toBe('IDEMPOTENCY_KEY_REUSED')
    const stale = await write(t, 'game.tutorial.skip', {}, 1)
    expect(stale.error.code).toBe('STATE_CONFLICT')
    const status = await read(t, 'game.request.status', { requestId: rid })
    expect(status.data.status).toBe('FOUND')
    expect((await read(t, 'game.request.status', { requestId: uuid() })).data.status).toBe('NOT_FOUND')
  })

  it('concurrent duplicate finish settles exactly once', async () => {
    const t = await login(); await read(t, 'game.bootstrap', {})
    const s = await write(t, 'game.run.start', { levelId: 'dujiangyan_find', route: 'plant' }, 1)
    const runId = s.data.result.run.runId
    const proof = proofFor('dujiangyan_find')
    const res = await Promise.all([1, 2, 3].map(() => write(t, 'game.run.finish', { runId, proof }, s.stateRevision)))
    expect(res.every(r => r.ok)).toBe(true)
    const st = await read(t, 'game.state.get')
    expect(st.data.state.inventory.seed_mint).toBe(2)
    expect(st.data.state.stateRevision).toBe(3)
    const g = await read(t, 'game.run.get', { runId })
    expect(g.data.run.status).toBe('FINISHED')
  })

  it('locks, single active run, cancel, invalid proof', async () => {
    const t = await login(); await read(t, 'game.bootstrap', {})
    expect((await write(t, 'game.run.start', { levelId: 'qingcheng_find', route: 'plant' }, 1)).error.code).toBe('SCENE_LOCKED')
    const s = await write(t, 'game.run.start', { levelId: 'dujiangyan_puzzle', route: 'plant' }, 1)
    expect((await write(t, 'game.run.start', { levelId: 'dujiangyan_find', route: 'plant' }, 2)).error.code).toBe('ACTIVE_RUN_EXISTS')
    const bad = await write(t, 'game.run.finish', { runId: s.data.result.run.runId, proof: { kind: 'puzzle', slots: [] } }, 2)
    expect(bad.error.code).toBe('INVALID_PROOF')
    const c = await write(t, 'game.run.cancel', { runId: s.data.result.run.runId }, 2)
    expect(c.ok).toBe(true); expect(c.data.state.activeRunId).toBeNull()
    const fin = await write(t, 'game.run.finish', { runId: s.data.result.run.runId, proof: proofFor('dujiangyan_puzzle') }, 3)
    expect(fin.error.code).toBe('RUN_CANCELLED')
  })

  it('unlocks qingcheng after both dujiangyan levels and grants warm_wood', async () => {
    const t = await login(); await read(t, 'game.bootstrap', {})
    const a = await play(t, 'dujiangyan_find', 'plant', 1)
    const b = await play(t, 'dujiangyan_puzzle', 'decor', a.stateRevision)
    expect(b.data.result.newlyUnlockedSceneIds).toContain('qingcheng')
    expect(b.data.state.unlockedPaletteIds).toContain('warm_wood')
    const q = await write(t, 'game.run.start', { levelId: 'qingcheng_find', route: 'plant' }, b.stateRevision)
    expect(q.ok).toBe(true)
  })

  it('client cannot read or write protected storage directly', async () => {
    const t = await login(); await read(t, 'game.bootstrap', {})
    const w = await fetch(`${URL_}/v2/storage`, { method: 'PUT', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: JSON.stringify({ objects: [{ collection: 'game_player', key: 'state', value: '{"inventory":{"seed_mint":999}}' }] }) })
    expect(w.status).not.toBe(200)
    const r = await fetch(`${URL_}/v2/storage/game_player?limit=10`, { headers: { Authorization: 'Bearer ' + t } })
    const j = await r.json()
    expect(j.objects ?? []).toHaveLength(0)
    const d = await fetch(`${URL_}/v2/storage/delete`, { method: 'PUT', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: JSON.stringify({ object_ids: [{ collection: 'game_player', key: 'state' }] }) })
    expect(d.status).not.toBe(200)
    expect((await read(t, 'game.state.get')).data.state.stateRevision).toBe(1)
  })

  it('rejects bad envelopes', async () => {
    const t = await login(); await read(t, 'game.bootstrap', {})
    expect((await rpc(t, 'game.state.get', { apiVersion: 2, payload: {} })).error.code).toBe('UNSUPPORTED_API_VERSION')
    expect((await rpc(t, 'game.tutorial.skip', { apiVersion: 1, clientBuild: CLIENT_BUILD, payload: {} })).error.code).toBe('INVALID_PAYLOAD')
    expect((await write(t, 'game.plant.start', { plotId: 'plot_9', seedItemId: 'seed_mint' }, 1)).error.code).toBe('INVALID_PAYLOAD')
  })

  it('v2.1 learning & compliance RPCs', async () => {
    const t = await login(); const boot = await read(t, 'game.bootstrap', {})
    let rev: number = boot.data.state.stateRevision
    const step = async (id: string, payload: object) => { const r = await write(t, id, payload, rev); if (r.ok) rev = r.stateRevision; return r }
    expect(boot.data.state.plots).toHaveLength(8)
    // telemetry is rejected until the player opts in
    expect((await step('game.telemetry.track', { events: [{ eventName: 'app_open', fields: {} }] })).ok).toBe(false)
    const c = await step('game.consent.update', { privacyVersion: '2026-10-22', telemetry: true })
    expect(c.ok).toBe(true); expect(c.data.state.consent.telemetry).toBe(true)
    expect((await step('game.telemetry.track', { events: [{ eventName: 'app_open', fields: {} }] })).data.result.acceptedCount).toBe(1)
    expect((await step('game.telemetry.track', { events: [{ eventName: 'screen_view', fields: {} }] })).ok).toBe(false)
    // quiz needs discovery first
    expect((await step('game.quiz.complete', { plantId: 'mint', answers: [0, 0, 0] })).error.code).toBe('INVALID_PAYLOAD')
    // solar terms are not open before the 2026-11-01 season epoch (no test override on this server)
    const sv = (await read(t, 'game.state.get')).data
    if (sv.season && sv.season.openTermIds.length === 0) expect((await step('game.season.claim', { termId: 'shuangjiang' })).error.code).toBe('TERM_NOT_OPEN')
    // observe: plant mint via the tutorial loop, then record stage 0 once
    const st = await step('game.run.start', { levelId: 'dujiangyan_find', route: 'plant' })
    await step('game.run.finish', { runId: st.data.result.run.runId, proof: proofFor('dujiangyan_find') })
    const pl = await step('game.plant.start', { plotId: 'plot_1', seedItemId: 'seed_mint' })
    const plantingId = pl.data.result.planting.plantingId
    expect((await step('game.observe.record', { plantingId, stage: 3 })).ok).toBe(true) // tutorial mint is instantly mature
    expect((await step('game.observe.record', { plantingId, stage: 3 })).error.code).toBe('ALREADY_CLAIMED')
    const fb = await step('game.feedback.submit', { text: '联调测试反馈', contact: '' })
    expect(fb.ok).toBe(true)
    const acct = await read(t, 'game.account.status', {})
    expect(acct.ok).toBe(true)
    expect((await read(t, 'game.playtime.heartbeat', {})).ok || (await write(t, 'game.playtime.heartbeat', {}, rev)).ok).toBe(true)
  })
})

describe('min client build (BE-06)', () => {
  it('writes from an older build are refused with CLIENT_OUTDATED; reads still work', async () => {
    const t = await login()
    const boot = await read(t, 'game.bootstrap')
    expect(boot.ok).toBe(true)
    expect(boot.data.minClientBuild).toBe(CLIENT_BUILD)
    const old = await rpc(t, 'game.tutorial.skip', { apiVersion: 1, clientBuild: '1.0.0', requestId: uuid(), expectedStateRevision: boot.stateRevision, payload: {} })
    expect(old.ok).toBe(false); expect(old.error.code).toBe('CLIENT_OUTDATED')
    const none = await rpc(t, 'game.tutorial.skip', { apiVersion: 1, requestId: uuid(), expectedStateRevision: boot.stateRevision, payload: {} })
    expect(none.error.code).toBe('CLIENT_OUTDATED')
    expect((await rpc(t, 'game.state.get', { apiVersion: 1, clientBuild: '1.0.0', payload: {} })).ok).toBe(true)
    expect((await write(t, 'game.tutorial.skip', {}, boot.stateRevision)).ok).toBe(true)
  })
})

describe('A5 G7 progress transfer', () => {
  it('moves progress to a fresh account once; code is single-use; target with progress refused', async () => {
    const a = await login(); const b = await login()
    const ba = await read(a, 'game.bootstrap'); expect(ba.ok).toBe(true)
    const f = await play(a, 'dujiangyan_find', 'plant', ba.stateRevision)
    const c = await write(a, 'game.transfer.create', {}, f.stateRevision)
    expect(c.ok, JSON.stringify(c.error)).toBe(true)
    const code: string = c.data.result.code
    expect(code).toMatch(/^[2-9A-HJKMNP-Z]{8}$/)
    const bb = await read(b, 'game.bootstrap')
    const bad = await write(b, 'game.transfer.claim', { code: 'ZZZZZZZZ' }, bb.stateRevision)
    expect(bad.ok).toBe(false); expect(bad.error.code).toBe('TRANSFER_CODE_INVALID')
    const ok = await write(b, 'game.transfer.claim', { code }, bb.stateRevision)
    expect(ok.ok, JSON.stringify(ok.error)).toBe(true)
    const sb = await read(b, 'game.state.get')
    expect(sb.data.state.levels.dujiangyan_find.firstCompletedAtMs).toBeTruthy()
    const again = await write(b, 'game.transfer.claim', { code }, sb.stateRevision)
    expect(again.ok).toBe(false)
  })
})

describe('A5 G13 courtyard code', () => {
  it('read-only snapshot by code, only layout+palette returned, revoke kills it', async () => {
    const a = await login(); const b = await login()
    const ba = await read(a, 'game.bootstrap')
    const empty = await write(a, 'game.garden.share.create', {}, ba.stateRevision)
    expect(empty.ok).toBe(false) // empty courtyard
    const sv = await write(a, 'game.garden.save', { paletteId: 'green', placements: [{ instanceId: 'c1', itemId: 'decor_bench', x: 1, y: 1 }] }, ba.stateRevision)
    expect(sv.ok, JSON.stringify(sv.error)).toBe(true)
    const c = await write(a, 'game.garden.share.create', {}, sv.stateRevision)
    expect(c.ok, JSON.stringify(c.error)).toBe(true)
    const code: string = c.data.result.code
    const bb = await read(b, 'game.bootstrap')
    const g = await read(b, 'game.garden.share.get', { code })
    expect(g.ok, JSON.stringify(g.error)).toBe(true)
    expect(Object.keys(g.data).sort()).toEqual(['createdAtMs', 'mine', 'paletteId', 'placements', 'reactedToday'])
    expect(g.data.reactedToday).toBeNull()
    expect(g.data.mine).toBe(false)
    expect(g.data.placements.map((p: any) => p.itemId)).toEqual(['decor_bench'])
    expect(JSON.stringify(g.data)).not.toMatch(/userId|ownerUserId|phone|username/)
    // A6-C2 preset reactions: no free text, once per visitor per code per day, counts visible to the owner only
    const bad = await write(b, 'game.garden.share.react', { code, reaction: '<b>hi</b>' }, bb.stateRevision)
    expect(bad.ok).toBe(false); expect(bad.error.code).toBe('INVALID_PAYLOAD')
    const self = await write(a, 'game.garden.share.react', { code, reaction: 'heart' }, sv.stateRevision)
    expect(self.ok).toBe(false)
    const r1 = await write(b, 'game.garden.share.react', { code, reaction: 'flower' }, bb.stateRevision)
    expect(r1.ok, JSON.stringify(r1.error)).toBe(true); expect(r1.data.result).toEqual({ reaction: 'flower', already: false })
    const r2 = await write(b, 'game.garden.share.react', { code, reaction: 'heart' }, bb.stateRevision)
    expect(r2.ok, JSON.stringify(r2.error)).toBe(true); expect(r2.data.result).toEqual({ reaction: 'flower', already: true })
    const gv = await read(b, 'game.garden.share.get', { code })
    expect(gv.data.reactedToday).toBe('flower'); expect(gv.data.reactions).toBeUndefined()
    const go = await read(a, 'game.garden.share.get', { code })
    expect(go.data.mine).toBe(true); expect(go.data.reactions).toEqual({ flower: 1 })
    const rv = await write(a, 'game.garden.share.revoke', {}, sv.stateRevision)
    expect(rv.ok, JSON.stringify(rv.error)).toBe(true)
    const gone = await read(b, 'game.garden.share.get', { code })
    expect(gone.ok).toBe(false); expect(gone.error.code).toBe('TRANSFER_CODE_INVALID')
  })
})

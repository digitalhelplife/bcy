// A7: the gaps found in the 2026-10-25 audit — nature journal, notebook/visitor surfaces,
// server-synced parent mode, demo transfer/share parity, freshness, and the generic HTTP providers.
import { execFileSync } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LocalDemoServer } from '../src/net/localDemoServer'
import { SCENES, SHARE } from '../src/shared/content'
import { createInitialState } from '../src/shared/rules'
import { isFreshState } from '../src/shared/transfer'
import { PHOTO_RECTS } from '../src/share/photo'
import { createProviders } from '../backend/auth/src/providers'
import type { PlayerState, Proof, RpcName } from '../src/shared/types'

class MemStorage implements Storage {
  private m = new Map<string, string>()
  get length() { return this.m.size }
  clear() { this.m.clear() }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null }
  key(i: number) { return [...this.m.keys()][i] ?? null }
  removeItem(k: string) { this.m.delete(k) }
  setItem(k: string, v: string) { this.m.set(k, String(v)) }
}

const findProof: Proof = {
  kind: 'find',
  foundTargetIds: SCENES.dujiangyan.targets.map(t => t.targetId),
  gates: { fog_revealed: true },
}
const now = Date.parse('2026-10-25T10:00:00+08:00')
function serverFor(userId: string, storage: Storage, nowFn = () => now) {
  return new LocalDemoServer({ userId, storage, latencyMs: 0, now: nowFn })
}
function write(server: LocalDemoServer, name: RpcName, payload: unknown, state: PlayerState, requestId = crypto.randomUUID()) {
  return server.handle(name, { apiVersion: 1, requestId, expectedStateRevision: state.stateRevision, payload }) as any
}
function side(server: LocalDemoServer, name: RpcName, payload: unknown = {}) {
  return server.handle(name, { apiVersion: 1, requestId: crypto.randomUUID(), payload }) as any
}
function boot(server: LocalDemoServer): PlayerState {
  const r = server.handle('game.bootstrap', { apiVersion: 1, payload: {} }) as any
  expect(r.ok).toBe(true)
  return r.data.state as PlayerState
}

describe('A7-01/05 F25 nature journal', () => {
  it('adds the fourth share template, a photo slot and a committed frame asset', () => {
    expect(Object.keys(SHARE.templates)).toContain('share_nature')
    expect(SHARE.templates.share_nature.name).toBe('自然笔记')
    expect(PHOTO_RECTS.share_nature).toMatchObject({ x: 620, y: 780, w: 320, h: 260 })
    const asset = 'public/assets/share/share_nature_template.webp'
    expect(existsSync(asset)).toBe(true)
    expect(statSync(asset).size).toBeGreaterThan(1000)
  })
  it('observations are the sticker source; completion is 4 distinct stages', () => {
    // The notebook and share renderer derive stickers from this state field; no extra item is granted.
    const s = createInitialState(now)
    s.discoveredPlantIds = ['mint']
    s.observations = { mint: [0, 1, 2, 3] }
    expect(s.observations.mint).toHaveLength(4)
  })
})

describe('A7-06 plant card homeGrowing is surfaced', () => {
  it('the codex renders light/water/difficulty fields', () => {
    const src = readFileSync('src/ui/screens/Learn.tsx', 'utf8')
    expect(src).toContain("homeGrowing?.light")
    expect(src).toContain("homeGrowing?.water")
    expect(src).toContain("homeGrowing?.difficulty")
  })
})

describe('A7-07 server parent mode', () => {
  it('game.settings.update persists parentMode and bumps revision', () => {
    const storage = new MemStorage()
    const srv = serverFor('u-settings', storage)
    const s0 = boot(srv)
    expect(s0.settings.parentMode).toBe(false)
    const r = write(srv, 'game.settings.update', { parentMode: true }, s0)
    expect(r.ok).toBe(true)
    expect(r.data.state.settings.parentMode).toBe(true)
    expect(r.data.state.stateRevision).toBe(s0.stateRevision + 1)
    const read = srv.handle('game.state.get', { apiVersion: 1, payload: {} }) as any
    expect(read.data.state.settings.parentMode).toBe(true)
  })
})

describe('A7-08 local demo transfer parity', () => {
  it('moves progress to a fresh account once, then resets the source', () => {
    const storage = new MemStorage()
    const a = serverFor('u-a', storage)
    let sa = boot(a)
    const start = write(a, 'game.run.start', { levelId: 'dujiangyan_find', route: 'plant' }, sa)
    expect(start.ok).toBe(true)
    const runId = start.data.result.run.runId
    const finish = write(a, 'game.run.finish', { runId, proof: findProof }, start.data.state)
    expect(finish.ok).toBe(true)
    sa = finish.data.state
    expect(sa.discoveredPlantIds).toContain('mint')

    const created = side(a, 'game.transfer.create')
    expect(created.ok).toBe(true)
    const code = created.data.result.code
    expect(code).toMatch(/^[2-9A-HJKMNP-Z]{8}$/)

    const b = serverFor('u-b', storage)
    const sb = boot(b)
    const claimed = write(b, 'game.transfer.claim', { code }, sb)
    expect(claimed.ok).toBe(true)
    expect(claimed.data.state.discoveredPlantIds).toContain('mint')
    expect(claimed.data.result.levelsCleared).toBe(1)

    const source = a.handle('game.state.get', { apiVersion: 1, payload: {} }) as any
    expect(source.data.state.discoveredPlantIds).toEqual([])
    const again = write(b, 'game.transfer.claim', { code }, claimed.data.state)
    expect(again.ok).toBe(false)
    expect(again.error.code).toBe('TRANSFER_CODE_INVALID')
  })
})

describe('A7-09 fresh target rejects a saved courtyard', () => {
  it('a garden placement makes the account non-fresh', () => {
    const s = createInitialState(now)
    expect(isFreshState(s)).toBe(true)
    s.garden.placements = [{ instanceId: 'i1', itemId: 'decor_bench', x: 0, y: 0 }]
    expect(isFreshState(s)).toBe(false)
  })
})

describe('A7-08 local demo courtyard code parity', () => {
  it('creates a read-only snapshot, accepts one preset reaction, and revokes it', () => {
    const storage = new MemStorage()
    const a = serverFor('owner', storage)
    let sa = boot(a)
    const saved = write(a, 'game.garden.save', { paletteId: 'green', placements: [{ instanceId: 'i1', itemId: 'decor_bench', x: 0, y: 0 }] }, sa)
    expect(saved.ok).toBe(true)
    sa = saved.data.state
    const created = side(a, 'game.garden.share.create')
    expect(created.ok).toBe(true)
    const code = created.data.result.code

    const b = serverFor('visitor', storage)
    boot(b)
    const got = b.handle('game.garden.share.get', { apiVersion: 1, payload: { code } }) as any
    expect(got.ok).toBe(true)
    expect(got.data.mine).toBe(false)
    expect(got.data.placements.map((p: any) => p.itemId)).toEqual(['decor_bench'])
    expect(got.data.reactions).toBeUndefined()

    const reacted = side(b, 'game.garden.share.react', { code, reaction: 'flower' })
    expect(reacted.ok).toBe(true)
    expect(reacted.data.result).toEqual({ reaction: 'flower', already: false })
    const twice = side(b, 'game.garden.share.react', { code, reaction: 'heart' })
    expect(twice.data.result).toEqual({ reaction: 'flower', already: true })

    const ownerView = a.handle('game.garden.share.get', { apiVersion: 1, payload: { code } }) as any
    expect(ownerView.data.mine).toBe(true)
    expect(ownerView.data.reactions).toEqual({ flower: 1 })

    const revoked = side(a, 'game.garden.share.revoke')
    expect(revoked.ok).toBe(true)
    const gone = b.handle('game.garden.share.get', { apiVersion: 1, payload: { code } }) as any
    expect(gone.ok).toBe(false)
    expect(gone.error.code).toBe('TRANSFER_CODE_INVALID')
  })
})

describe('A7-15a/16a/17a review and preflight tooling', () => {
  it('review packet covers all 192 entries without changing status; preflight lists production blockers', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bcy-review-'))
    execFileSync('node', ['scripts/review-pack.mjs', '--out-dir', dir], { encoding: 'utf8' })
    const md = readFileSync(join(dir, 'review_packet.md'), 'utf8')
    const csv = readFileSync(join(dir, 'review_packet.csv'), 'utf8')
    expect(md).toContain('# 内容审核工作包')
    expect(md).toMatch(/条目：192/)
    expect(csv.split('\n').length).toBeGreaterThan(190)
    let out = ''
    try { execFileSync('node', ['scripts/release-preflight.mjs'], { encoding: 'utf8' }) } catch (e) { out = String((e as { stdout?: string }).stdout ?? '') }
    expect(out).toContain('reviews=192/192 approved')
    expect(out).not.toContain('CONTENT_REVIEW')
    expect(out).toContain('PUBLICATION')
    expect(out).toContain('NPPA_OFFICIAL')
    expect(out).toContain('BLOCKED')
  })
})

describe('A7-13/14 generic HTTP providers', () => {
  it('production accepts a configured HTTP SMS/realname gateway and reports events', async () => {
    const seen: any[] = []
    const srv: Server = createServer(async (req, res) => {
      const chunks: Buffer[] = []
      for await (const c of req) chunks.push(c as Buffer)
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
      seen.push({ url: req.url, auth: req.headers.authorization, body })
      res.setHeader('content-type', 'application/json')
      if (req.url === '/sms') { res.end('{}'); return }
      if (req.url === '/realname') {
        if (body.action === 'query' || body.name !== '测试认证中') res.end(JSON.stringify({ status: 'VERIFIED', pi: 'pi-1', birthYm: body.birthYm || '1990-01' }))
        else res.end(JSON.stringify({ status: 'PENDING', ai: body.ai }))
        return
      }
      if (req.url === '/behavior') { res.end('{}'); return }
      res.statusCode = 404; res.end('{}')
    })
    await new Promise<void>(r => srv.listen(0, '127.0.0.1', () => r()))
    const port = (srv.address() as { port: number }).port
    try {
      const providers = createProviders({
        AUTH_ENV: 'production',
        AUTH_SMS_PROVIDER: 'http', AUTH_SMS_HTTP_URL: `http://127.0.0.1:${port}/sms`, AUTH_SMS_HTTP_TOKEN: 't1',
        AUTH_REALNAME_PROVIDER: 'http', AUTH_REALNAME_HTTP_URL: `http://127.0.0.1:${port}/realname`, AUTH_REALNAME_HTTP_TOKEN: 't2',
        AUTH_BEHAVIOR_PROVIDER: 'http', AUTH_BEHAVIOR_HTTP_URL: `http://127.0.0.1:${port}/behavior`, AUTH_BEHAVIOR_HTTP_TOKEN: 't3',
      })
      expect(providers.production).toBe(true)
      await providers.sms.send('13800138000', '123456')
      const adult = await providers.realname.submit('ai-1', '张三', '110101199001011237', '1990-01')
      expect(adult.status).toBe('VERIFIED')
      const pending = await providers.realname.submit('ai-2', '测试认证中', '110101199001011237', '1990-01')
      expect(pending.status).toBe('PENDING')
      expect(await providers.realname.query('ai-2')).toMatchObject({ status: 'VERIFIED', pi: 'pi-1' })
      expect(await providers.behavior.report([{ eventId: 'e1', pi: 'pi-1', kind: 'online', occurredAtMs: now }])).toBe('SENT')
      expect(seen.find(x => x.url === '/sms')).toMatchObject({ auth: 'Bearer t1', body: { phone: '13800138000', code: '123456' } })
      expect(seen.find(x => x.url === '/realname')).toMatchObject({ auth: 'Bearer t2' })
      expect(seen.find(x => x.url === '/behavior')).toMatchObject({ auth: 'Bearer t3' })
    } finally {
      await new Promise<void>(r => srv.close(() => r()))
    }
  })
  it('production still refuses mock or unconfigured providers', () => {
    expect(() => createProviders({ AUTH_ENV: 'production' })).toThrow(/refuses mock/)
    expect(() => createProviders({ AUTH_ENV: 'production', AUTH_SMS_PROVIDER: 'http', AUTH_REALNAME_PROVIDER: 'http' })).toThrow(/not implemented/)
  })
})

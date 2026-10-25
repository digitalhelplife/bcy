// Lost-response recovery (spec: unknown outcome → retry with the identical request, server replays its receipt).
// Seen live on 2026-10-22: plant.claim was applied server-side (HTTP 200) but the response never reached the phone.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { LocalDemoServer } from '../src/net/localDemoServer'
import { TransportError, type Transport } from '../src/net/transport'
import type { GameClient as GC } from '../src/net/gameClient'
import { findFreeSpot } from '../src/shared/rules'
import type { RpcName, RpcResponse } from '../src/shared/types'

class MemStorage implements Storage {
  private m = new Map<string, string>()
  get length() { return this.m.size }
  clear() { this.m.clear() }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null }
  key(i: number) { return [...this.m.keys()][i] ?? null }
  removeItem(k: string) { this.m.delete(k) }
  setItem(k: string, v: string) { this.m.set(k, String(v)) }
}

/** Demo server behind a transport that can "lose" the response of the next call to a given RPC after it was applied. */
class LossyTransport implements Transport {
  mode = 'demo' as const
  authMode = 'device' as const
  userId = 'u-lossy'
  server = new LocalDemoServer({ userId: this.userId, storage: new MemStorage(), latencyMs: 0 })
  loseNext: RpcName | null = null
  sent: { name: RpcName; requestId?: string; replayed?: boolean }[] = []
  async connect() {}
  async rpc<T>(name: RpcName, body: unknown): Promise<RpcResponse<T>> {
    const res = this.server.handle(name, body) as RpcResponse<T>
    this.sent.push({ name, requestId: (body as { requestId?: string }).requestId, replayed: res.ok ? res.replayed : undefined })
    if (this.loseNext === name) { this.loseNext = null; throw new TransportError('连接中断', 'network') }
    return res
  }
}

let GameClient: typeof GC
let UnknownOutcomeError: typeof import('../src/net/gameClient').UnknownOutcomeError
beforeAll(async () => {
  const noop = () => {}
  vi.stubGlobal('window', { addEventListener: noop, removeEventListener: noop })
  vi.stubGlobal('document', { addEventListener: noop, visibilityState: 'visible' })
  vi.stubGlobal('navigator', { onLine: true })
  vi.stubGlobal('localStorage', new MemStorage())
  vi.stubGlobal('BroadcastChannel', undefined)
  ;({ GameClient, UnknownOutcomeError } = await import('../src/net/gameClient'))
})
afterAll(() => vi.unstubAllGlobals())

describe('lost response → 重试确认', () => {
  it('re-sends the identical request, server replays, client converges to one applied revision', async () => {
    const t = new LossyTransport()
    const client = new GameClient(t)
    await client.boot()
    expect(client.snapshot.phase).toBe('ready')
    const rev0 = client.snapshot.state!.stateRevision
    const spot = findFreeSpot([], 'decor_bench')!
    const placements = [{ instanceId: 'i-bench-1', itemId: 'decor_bench', ...spot }]

    t.loseNext = 'game.garden.save'
    await expect(client.gardenSave('green', placements)).rejects.toBeInstanceOf(UnknownOutcomeError)
    // Server applied it; the phone does not know yet.
    expect(client.snapshot.pending?.status).toBe('unknown')
    expect(client.snapshot.state!.stateRevision).toBe(rev0)

    const p = client.retryPending()
    // In flight: the banner must stay up as "正在确认…" (retried + sending), not vanish.
    expect(client.snapshot.pending).toMatchObject({ status: 'sending', retried: true })
    await p
    expect(client.snapshot.pending).toBeNull()

    const saves = t.sent.filter(s => s.name === 'game.garden.save')
    expect(saves).toHaveLength(2)
    expect(saves[1].requestId).toBe(saves[0].requestId)
    expect(saves[0].replayed).toBe(false)
    expect(saves[1].replayed).toBe(true)
    expect(client.snapshot.state!.stateRevision).toBe(rev0 + 1)
    expect(client.snapshot.state!.garden.placements).toEqual(placements)
  })

  it('persists the unknown write across a reload and offers it again', async () => {
    const t = new LossyTransport()
    const a = new GameClient(t)
    await a.boot()
    t.loseNext = 'game.garden.save'
    await expect(a.gardenSave('green', [])).rejects.toBeInstanceOf(UnknownOutcomeError)
    const b = new GameClient(t) // same localStorage → "page reload"
    await b.boot()
    expect(b.snapshot.pending).toMatchObject({ rpc: 'game.garden.save', status: 'unknown' })
    await b.retryPending()
    expect(b.snapshot.pending).toBeNull()
    expect(t.sent.filter(s => s.name === 'game.garden.save').map(s => s.replayed)).toEqual([false, true])
  })
})

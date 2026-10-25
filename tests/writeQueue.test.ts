// Seen live 2026-10-23 (smoke): a quick second tap while the previous write was still on the wire got
// “上一个操作还未确认”. In-flight writes must queue (bounded) and re-base on the new revision; unknown outcomes still block.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { LocalDemoServer } from '../src/net/localDemoServer'
import { TransportError, type Transport } from '../src/net/transport'
import type { GameClient as GC } from '../src/net/gameClient'
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
beforeAll(async () => {
  const noop = () => {}
  vi.stubGlobal('window', { addEventListener: noop, removeEventListener: noop })
  vi.stubGlobal('document', { addEventListener: noop, visibilityState: 'visible' })
  vi.stubGlobal('navigator', { onLine: true })
  vi.stubGlobal('localStorage', new MemStorage())
  vi.stubGlobal('BroadcastChannel', undefined)
  GameClient = (await import('../src/net/gameClient')).GameClient
})
afterAll(() => vi.unstubAllGlobals())

class SlowTransport extends LossyTransport {
  delayMs = 40
  async rpc<T>(name: RpcName, body: unknown): Promise<RpcResponse<T>> {
    if (name !== 'game.bootstrap' && name !== 'game.state.get') await new Promise(r => setTimeout(r, this.delayMs))
    return super.rpc<T>(name, body)
  }
}
describe('write queue', () => {
  it('a second write while the first is still sending waits, then succeeds on the new revision', async () => {
    const t = new SlowTransport()
    const c = new GameClient(t); await c.boot()
    const rev0 = c.snapshot.state!.stateRevision
    const a = c.tutorialSkip()
    const b = c.runStart('dujiangyan_find', 'plant')
    await expect(a).resolves.toBeTruthy()
    await expect(b).resolves.toBeTruthy()
    expect(c.snapshot.state!.stateRevision).toBeGreaterThan(rev0 + 1)
    expect(c.snapshot.pending).toBeNull()
    const writes = t.sent.filter(s => s.name !== 'game.bootstrap' && s.name !== 'game.state.get').map(s => s.name)
    expect(writes).toEqual(['game.tutorial.skip', 'game.run.start'])
  })
  it('a write whose outcome is unknown still blocks the next one', async () => {
    const t = new SlowTransport()
    const c = new GameClient(t); await c.boot()
    t.loseNext = 'game.tutorial.skip'
    await expect(c.tutorialSkip()).rejects.toThrow()
    expect(c.snapshot.pending?.status).toBe('unknown')
    await expect(c.runStart('dujiangyan_find', 'plant')).rejects.toThrow('上一个操作还未确认')
  })
})

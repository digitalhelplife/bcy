// BE-06 min client build: server-declared minimum / content version mismatch → 'outdated' gate, no writes.
// (transport helpers copied from lostResponse.test.ts)
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


class VersionTransport extends LossyTransport {
  minBuild: string | null = null
  configVersion: string | null = null
  async rpc<T>(name: RpcName, body: unknown): Promise<RpcResponse<T>> {
    const res = await super.rpc<T>(name, body) as any
    if (name === 'game.bootstrap' && res.ok) {
      if (this.minBuild) res.data = { ...res.data, minClientBuild: this.minBuild }
      if (this.configVersion) res.configVersion = this.configVersion
    }
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

describe('min client build gate', () => {
  it('every RPC envelope carries clientBuild', async () => {
    const t = new VersionTransport(); const seen: unknown[] = []
    const orig = t.rpc.bind(t); t.rpc = async (n: RpcName, b: unknown) => { seen.push(b); return orig(n, b) as any }
    const c = new GameClient(t); await c.boot()
    expect(c.snapshot.phase).toBe('ready')
    expect(seen.length).toBeGreaterThan(0)
    for (const b of seen) expect((b as { clientBuild?: string }).clientBuild).toMatch(/^\d+\.\d+\.\d+$/)
  })
  it('server minimum above this build → outdated gate, state not applied', async () => {
    const t = new VersionTransport(); t.minBuild = '99.0.0'
    const c = new GameClient(t); await c.boot()
    expect(c.snapshot.phase).toBe('gate')
    expect(c.snapshot.gate).toEqual({ kind: 'outdated', minClientBuild: '99.0.0' })
    expect(c.snapshot.state).toBeNull()
  })
  it('content version mismatch → outdated gate', async () => {
    const t = new VersionTransport(); t.configVersion = 'chengdu_content_v999'
    const c = new GameClient(t); await c.boot()
    expect(c.snapshot.gate?.kind).toBe('outdated')
  })
  // Seen live 2026-10-22: the server's minimum was raised while a page was open; that old page's writes were then
  // refused with CLIENT_OUTDATED and, not knowing the code, it did nothing visible. This build must show the gate.
  it('a write refused with CLIENT_OUTDATED after boot → outdated gate (not a silent no-op)', async () => {
    const t = new VersionTransport()
    const c = new GameClient(t); await c.boot()
    expect(c.snapshot.phase).toBe('ready')
    const orig = t.rpc.bind(t)
    t.rpc = async (n: RpcName, b: unknown) => n === 'game.run.start'
      ? { ok: false, apiVersion: 1, serverTimeMs: Date.now(), stateRevision: 0, error: { code: 'CLIENT_OUTDATED', message: '游戏已更新，请刷新页面后继续', retryable: false } } as any
      : orig(n, b) as any
    await expect(c.runStart('dujiangyan_find', 'plant')).rejects.toThrow()
    expect(c.snapshot.phase).toBe('gate')
    expect(c.snapshot.gate?.kind).toBe('outdated')
    expect(c.snapshot.pending).toBeNull()
  })
})

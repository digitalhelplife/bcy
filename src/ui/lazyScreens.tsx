// A5 G11: Phaser (≈1.2 MB) and the canvas screens load on demand instead of in the first-screen bundle.
// A failed chunk (deploy swapped files, weak network) shows a retry card instead of a blank screen.
import { Component, lazy, Suspense, type ReactNode } from 'react'
import { Btn } from './common'

const loadExplore = () => import('./screens/ExploreScreen')
const loadGarden = () => import('./screens/GardenScreen')
export const ExploreScreen = lazy(() => loadExplore().then(m => ({ default: m.ExploreScreen })))
export const ResultScreen = lazy(() => loadExplore().then(m => ({ default: m.ResultScreen })))
export const GardenScreen = lazy(() => loadGarden().then(m => ({ default: m.GardenScreen })))

/** Warm the chunks once the map is idle, so the first tap on a level is usually instant. */
export function prefetchCanvasScreens() {
  const go = () => { void loadExplore().catch(() => undefined); void loadGarden().catch(() => undefined) }
  const w = window as unknown as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => void }
  if (w.requestIdleCallback) w.requestIdleCallback(go, { timeout: 4000 }); else setTimeout(go, 2500)
}

class ChunkBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="screen center-col" data-testid="chunk-error">
        <p>画面没有加载成功，可能是网络不稳定或游戏刚更新。</p>
        <Btn onClick={() => location.reload()}>重新加载</Btn>
      </div>
    )
  }
}

export function Lazy({ children }: { children: ReactNode }) {
  return (
    <ChunkBoundary>
      <Suspense fallback={<div className="screen center-col"><p className="muted">正在准备画面…</p></div>}>{children}</Suspense>
    </ChunkBoundary>
  )
}

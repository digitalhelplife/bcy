import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { App } from './ui/App'
import { GameClient } from './net/gameClient'
import { createTransport, StorageUnavailableError } from './net/transport'
import { applyParentModeClass } from './ui/prefs'
import { configureSeason } from './shared/content'
import { registerServiceWorker } from './ui/sw'
applyParentModeClass()
// QA only: `?season=all` opens every solar term in the local dev preview. Production builds ignore it;
// the Nakama server uses its own BCY_SEASON_OVERRIDE runtime env.
if (import.meta.env.DEV && new URLSearchParams(location.search).get('season') === 'all') configureSeason({ override: 'all' })

function mount() {
  const root = createRoot(document.getElementById('root')!)
  try {
    const client = new GameClient(createTransport())
    ;(window as unknown as { __bcy?: GameClient }).__bcy = client
    // S0 builds may contain unreviewed content (release gate warnings) — label every page.
    const draft = (import.meta.env.VITE_RELEASE_STAGE ?? 'S0') === 'S0'
    root.render(<StrictMode><App client={client} />{draft && <div className="draft-badge" aria-hidden="true">内测 · 内容审核中 · 不可公开发布</div>}</StrictMode>)
  } catch (e) {
    const msg = e instanceof StorageUnavailableError ? e.message : '启动失败，请刷新重试。'
    root.render(<div className="screen boot"><p>{msg}</p><button className="btn btn-primary" onClick={() => location.reload()}>重试</button></div>)
  }
}
mount()

if (import.meta.env.DEV) {
  void (async () => {
    const [{ registerGameTuning }, { tuning }] = await Promise.all([
      import('../scripts/manus-tuning/adapter.js'), import('./tuning'),
    ])
    await registerGameTuning(tuning)
  })().catch(() => { /* tuning bridge is optional in preview */ })
}
registerServiceWorker()

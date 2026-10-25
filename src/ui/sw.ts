// A6-C3: register the static-file Service Worker in production builds only (never in dev, never inside iframes).
import { CLIENT_BUILD, CONFIG_VERSION } from '../shared/content'
declare const __BUILD_ID__: string
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  if (window.top !== window.self) return // embedded previews: keep plain network behaviour
  const id = `${CLIENT_BUILD}.${CONFIG_VERSION}.${typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : '0'}`
  window.addEventListener('load', () => { navigator.serviceWorker.register(`./sw.js?v=${encodeURIComponent(id)}`, { scope: './' }).catch(() => undefined) })
}

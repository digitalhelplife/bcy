/* A6-C3 offline shell. Static files only: game API, auth, admin and websocket traffic are NEVER intercepted or cached.
 * Navigation is network-first (falls back to the cached shell when offline); /assets and /fonts are cache-first.
 * The cache name carries the build id from the registration URL, so every deploy drops the previous cache. */
const BUILD = new URL(self.location.href).searchParams.get('v') || 'dev'
const PREFIX = 'bcy-static-'
const CACHE = PREFIX + BUILD
const NEVER = [/^\/v2\//, /^\/ws/, /^\/auth\//, /^\/admin/, /^\/console/, /^\/healthcheck/, /^\/demo\//]
const CACHE_FIRST = [/^\/assets\//, /^\/fonts\//]

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.add(new Request('./', { cache: 'reload' }))).catch(() => undefined).then(() => self.skipWaiting()))
})
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith(PREFIX) && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()))
})
self.addEventListener('fetch', e => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return
  if (NEVER.some(r => r.test(url.pathname))) return
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put('./', copy)) }
      return res
    }).catch(() => caches.match('./').then(r => r || Response.error())))
    return
  }
  if (CACHE_FIRST.some(r => r.test(url.pathname))) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)) }
      return res
    })))
  }
})

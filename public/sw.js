/* Queen SDA — service worker conservador.
   Solo cachea la carcasa estática (HTML, JS, CSS, iconos, manifiesto).
   Todo lo demás va network-first: los datos NUNCA se sirven de una caché vieja. */
const CACHE = 'queen-sda-shell-v2'
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icons/sad-192.png', '/icons/sad-512.png']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  const isShellAsset =
    url.origin === self.location.origin &&
    (request.mode === 'navigate' || /\.(?:js|css|png|svg|webmanifest|ico)$/.test(url.pathname))
  if (!isShellAsset) return // network-first por defecto para datos y cualquier otra cosa
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone()
            caches.open(CACHE).then((c) => c.put(request, copy))
          }
          return response
        })
        .catch(() => cached || caches.match('/index.html'))
      return cached || network
    }),
  )
})

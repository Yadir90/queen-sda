/* Queen SDA — service worker.
   Estrategia RED-PRIMERO para la carcasa (HTML, JS, CSS, iconos,
   manifiesto): la red manda y actualiza la caché en cada visita, así
   la app instalada nunca mezcla piezas de builds viejas; la caché
   solo responde cuando no hay conexión (funcionamiento offline de
   la carcasa). Los datos NUNCA se sirven de una caché: todo lo que
   no sea un asset de la carcasa va directo a la red, sin interceptar.
   v3: al activarse se borran las cachés anteriores (v2 incluida),
   que servían primero lo cacheado para JS/CSS. */
const CACHE = 'queen-sda-shell-v3'
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
  if (!isShellAsset) return // datos y cualquier otra cosa: red directa, sin caché
  event.respondWith(
    (async () => {
      try {
        const response = await fetch(request)
        if (response.ok) {
          const copy = response.clone()
          const cache = await caches.open(CACHE)
          await cache.put(request, copy)
        }
        return response
      } catch {
        // Sin conexión: respaldo desde la caché (la carcasa sigue abriendo).
        const cached = await caches.match(request)
        if (cached) return cached
        if (request.mode === 'navigate') {
          const shell = await caches.match('/index.html')
          if (shell) return shell
        }
        throw new Error('Sin conexión y sin copia en caché para este recurso.')
      }
    })(),
  )
})

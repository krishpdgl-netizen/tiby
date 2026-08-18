/* Tiby Service Worker — caching + offline shell */
const CACHE = 'tiby-v1'
const OFFLINE_URL = '/offline.html'

const PRECACHE = [
  '/',
  '/offline.html',
  '/manifest.json',
]

// Install: precache shell
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE))
  )
  self.skipWaiting()
})

// Activate: clear old caches
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  )
  self.clients.claim()
})

// Fetch: network-first for API, cache-first for assets
self.addEventListener('fetch', (e) => {
  const { request } = e
  const url = new URL(request.url)

  // API calls — always network, never cache
  if (url.pathname.startsWith('/api/')) return

  // Navigation — return cached shell, fallback to offline page
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request).catch(() =>
        caches.match(OFFLINE_URL)
      )
    )
    return
  }

  // Static assets — cache-first
  e.respondWith(
    caches.match(request).then((cached) =>
      cached || fetch(request).then((response) => {
        if (response.ok && request.method === 'GET') {
          const clone = response.clone()
          caches.open(CACHE).then((c) => c.put(request, clone))
        }
        return response
      })
    )
  )
})

// Handle messages from the main thread
self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting()
})

// Push notifications (future: MOM ready alert)
self.addEventListener('push', (e) => {
  const data = e.data?.json() || {}
  e.waitUntil(
    self.registration.showNotification(data.title || 'Tiby', {
      body: data.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: data.url || '/' },
    })
  )
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const target = e.notification.data?.url || '/'
  e.waitUntil(
    clients.matchAll({ type: 'window' }).then((cs) => {
      const existing = cs.find((c) => c.url === target && 'focus' in c)
      if (existing) return existing.focus()
      return clients.openWindow(target)
    })
  )
})

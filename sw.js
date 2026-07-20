// One Pot – service worker for offline brug
const CACHE = 'onepot-v2.1.2';
const ASSETS = ['./', 'index.html', 'style.css', 'data.js', 'i18n.js', 'app.js', 'apple-touch-icon.png'];

// Installer: cache alle filer (venter til siden siger 'tag over')
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS))
  );
});

// Lyt efter besked fra siden om at aktivere den nye version med det samme
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// Aktiver: ryd gamle caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Hent: prøv netværk først, fald tilbage til cache (så opdateringer hentes når der er net)
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then(r => r || caches.match('index.html')))
  );
});

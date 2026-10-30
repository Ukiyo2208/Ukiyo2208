// Bêta home — application installable : l'interface s'ouvre tout de suite (même réseau lent), puis se met à jour.
// Les données de la maison (/api, météo, caméras) ne sont jamais mises en cache.
const CACHE = 'beta-home-v7.14';
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(['./', './index.html', './css/beta.css', './manifest.webmanifest', './assets/icon-512.png', './assets/logo-mark.png'])).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return;
  // réseau d'abord pour le code (mises à jour immédiates), cache si hors ligne ; cache d'abord pour les images
  const img = /\.(png|jpe?g|webp|svg|gif)$/i.test(u.pathname);
  e.respondWith(img
    ? caches.match(e.request).then(r => r || fetch(e.request).then(res => { if (res.ok) { const cl = res.clone(); caches.open(CACHE).then(c => c.put(e.request, cl)); } return res; }))
    : fetch(e.request).then(res => { if (res.ok) { const cl = res.clone(); caches.open(CACHE).then(c => c.put(e.request, cl)); } return res; }).catch(() => caches.match(e.request).then(r => r || caches.match('./index.html'))));
});

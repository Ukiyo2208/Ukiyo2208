// Service worker minimal : rend l'appli installable et garde la coquille du site en cache
// (réseau d'abord, cache en secours). Les appels /api ne sont jamais mis en cache.
const CACHE = "beta-tool-v2";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
));

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  e.respondWith(fetch(e.request).then(resp => {
    if (resp.ok && resp.type === "basic") {
      const copy = resp.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
    }
    return resp;
  }).catch(() => caches.match(e.request)));
});

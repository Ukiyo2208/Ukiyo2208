// Service worker : rend l'appli installable, garde la coquille du site en cache
// (réseau d'abord, cache en secours) et affiche les notifications push.
// Les appels /api ne sont jamais mis en cache.
const CACHE = "beta-tool-v3";

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

self.addEventListener("push", e => {
  let m = {};
  try { m = e.data.json(); } catch { m = { body: e.data?.text() }; }
  e.waitUntil(self.registration.showNotification(m.title || "Bêta Tool", {
    body: m.body || "", icon: m.icon || "/brand/icon-192.png", badge: "/brand/icon-192.png", image: m.image,
    tag: m.tag, data: { url: m.url || "/" },
  }));
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || "/", location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    const open = list.find(c => new URL(c.url).origin === location.origin);
    if (open) return open.focus().then(c => c.navigate ? c.navigate(url) : c);
    return self.clients.openWindow(url);
  }));
});

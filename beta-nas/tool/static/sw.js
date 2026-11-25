// Service worker : appli installable, mode hors ligne et notifications push.
// - Pages et fichiers du site : réseau d'abord, cache en secours.
// - Quelques données (Ma journée, tâches, courses, agenda, inventaire…) : réseau d'abord, dernière
//   copie en secours quand le NAS est injoignable (jamais les mails).
// - Hors ligne, ajouter / cocher une tâche ou un article de courses est mis en file d'attente
//   (IndexedDB) et envoyé au retour du réseau.
const CACHE = "beta-tool-v4";
const DATA = "beta-tool-data-v1";
const OFFLINE_GET = [/^\/api\/config$/, /^\/api\/journee/, /^\/api\/tasks/, /^\/api\/shopping$/, /^\/api\/recipes$/, /^\/api\/agenda/,
  /^\/api\/inventory$/, /^\/api\/colis$/, /^\/api\/budget$/, /^\/api\/dashboard$/, /^\/api\/contacts$/, /^\/api\/notes$/];
const QUEUE_WRITE = [/^\/api\/tasks\/[^/]+\/items(\/[^/]+)?$/, /^\/api\/shopping(\/[^/]+)?$/];

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== DATA).map(k => caches.delete(k)))).then(() => self.clients.claim())
));

// --- File d'attente (IndexedDB) ------------------------------------------------------------------------
function db() {
  return new Promise((ok, ko) => {
    const r = indexedDB.open("beta-tool-offline", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("queue", { keyPath: "id", autoIncrement: true });
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ko(r.error);
  });
}
async function tx(mode, fn) {
  const d = await db();
  return new Promise((ok, ko) => {
    const t = d.transaction("queue", mode), s = t.objectStore("queue");
    const res = fn(s);
    t.oncomplete = () => ok(res?.result ?? res);
    t.onerror = () => ko(t.error);
  });
}
const enqueue = item => tx("readwrite", s => s.add(item));
const queued = () => tx("readonly", s => s.getAll());
const unqueue = id => tx("readwrite", s => s.delete(id));

async function notify(msg) {
  for (const c of await self.clients.matchAll({ type: "window" })) c.postMessage(msg);
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "X-Bt-Offline": "1" } });

/** Réponse « comme si » le NAS avait répondu, pour que l'appli continue de fonctionner hors ligne. */
async function fakeAnswer(url, method, body) {
  const p = url.pathname;
  if (p.startsWith("/api/tasks/")) {
    if (method === "POST") return json({ ...body, id: "off-" + Date.now().toString(36), done: false, created: Date.now() / 1000, offline: true });
    if (method === "PUT") return json({ item: { ...body, id: p.split("/").pop(), offline: true } });
    return json({ ok: true, offline: true });
  }
  // Liste de courses : on modifie la dernière copie gardée
  const cache = await caches.open(DATA);
  const hit = await cache.match("/api/shopping");
  const list = hit ? await hit.json() : { items: [], updated: 0, aisles: [] };
  const id = p.split("/").pop();
  if (method === "POST") (body.items || [body.text]).filter(Boolean).forEach(t => list.items.push({ id: "off-" + Math.random().toString(36).slice(2, 8), text: t, aisle: "Autres", checked: false, offline: true }));
  else if (method === "PUT") list.items.forEach(i => { if (i.id === id) Object.assign(i, body); });
  else if (method === "DELETE" && id !== "shopping") list.items = list.items.filter(i => i.id !== id);
  else if (method === "DELETE") list.items = list.items.filter(i => !i.checked);
  list.updated = Date.now() / 1000;
  await cache.put("/api/shopping", new Response(JSON.stringify(list), { headers: { "Content-Type": "application/json" } }));
  return json(list);
}

let replaying = null;  // un seul envoi à la fois, sinon une action pourrait partir deux fois
function replay() {
  replaying = replaying || doReplay().finally(() => { replaying = null; });
  return replaying;
}

async function doReplay() {
  const items = await queued();
  if (!items.length) return;
  const ids = {};  // identifiants créés hors ligne → vrais identifiants
  let done = 0;
  for (const it of items) {
    let url = it.url;
    for (const [off, real] of Object.entries(ids)) url = url.replace(off, real);
    if (/\/off-[a-z0-9]+$/.test(url)) { await unqueue(it.id); continue; }  // élément local sans équivalent
    try {
      const r = await fetch(url, { method: it.method, headers: { "Content-Type": "application/json" }, body: it.body, credentials: "same-origin" });
      if (r.status >= 500) break;
      if (r.ok && it.method === "POST" && it.fakeId) { try { const d = await r.clone().json(); if (d.id) ids[it.fakeId] = d.id; } catch {} }
      await unqueue(it.id);
      done++;
    } catch { break; }  // toujours pas de réseau
  }
  const left = (await queued()).length;
  notify({ type: "offline-sync", done, left });
}

self.addEventListener("message", e => {
  if (e.data === "replay") e.waitUntil(replay());
  if (e.data === "queue-count") e.waitUntil(queued().then(q => e.source?.postMessage({ type: "offline-queue", left: q.length })));
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  const p = url.pathname;
  if (e.request.method !== "GET") {
    if (!QUEUE_WRITE.some(r => r.test(p))) return;
    e.respondWith((async () => {
      const body = await e.request.clone().text();
      try { return await fetch(e.request); } catch {
        let parsed = {};
        try { parsed = JSON.parse(body || "{}"); } catch {}
        const answer = await fakeAnswer(url, e.request.method, parsed);
        let fakeId = null;
        try { fakeId = (await answer.clone().json()).id || null; } catch {}
        await enqueue({ url: p + url.search, method: e.request.method, body, fakeId, at: Date.now() });
        notify({ type: "offline-queue", left: (await queued()).length });
        return answer;
      }
    })());
    return;
  }
  if (p.startsWith("/api/")) {
    if (!OFFLINE_GET.some(r => r.test(p))) return;
    e.respondWith(fetch(e.request).then(resp => {
      if (resp.ok) { const copy = resp.clone(); caches.open(DATA).then(c => c.put(e.request, copy)); }
      return resp;
    }).catch(async () => {
      const hit = await caches.match(e.request, { cacheName: DATA });
      if (!hit) return json({ error: "Hors ligne : pas encore de copie de ces données sur cet appareil" }, 503);
      const h = new Headers(hit.headers);
      h.set("X-Bt-Offline", "1");
      return new Response(hit.body, { status: 200, headers: h });
    }));
    return;
  }
  e.respondWith(fetch(e.request).then(resp => {
    if (resp.ok && resp.type === "basic") {
      const copy = resp.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
    }
    return resp;
  }).catch(async () => (await caches.match(e.request)) || (e.request.mode === "navigate" ? caches.match("/") : undefined)));
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

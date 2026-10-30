// Serveur Bêta — côté serveur du pont Matter (Alexa, Google Home, Apple Maison) : liste des appareils partagés,
// leurs états, et les ordres reçus d'Alexa. Le pont lui-même tourne dans son conteneur (dossier bridge/).
'use strict';
const fs = require('fs'), path = require('path');

module.exports = function bridge(DATA, send, readBody, HUB, NOTIFY) {
  const FILE = path.join(DATA, 'bridge.json');
  let C = {}; try { C = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { }
  C = Object.assign({ items: [], status: null }, C);
  const persist = () => fs.writeFileSync(FILE, JSON.stringify(C, null, 1));
  const trig = {}, events = [];
  const fire = id => { trig[id] = Date.now() + 8000; };          // capteur « ouvert » 8 s : de quoi lancer une routine Alexa
  NOTIFY.hooks.ring.push(() => fire('sonnette'));

  async function state() {
    const brands = [...new Set(C.items.filter(i => i.brand).map(i => i.brand))], st = {};
    await Promise.all(brands.map(async b => { try { st[b] = (await HUB.states(b)).s || {}; } catch (e) { st[b] = {}; } }));
    return C.items.map(i => Object.assign({}, i, {
      state: i.type === 'button' ? { on: false } : i.type === 'trigger' ? { on: i.id === 'absent' ? NOTIFY.isAway() : (trig[i.id] || 0) > Date.now() } : (st[i.brand] && st[i.brand][i.id]) || {}
    }));
  }
  async function api(req, res, url) {
    const p = url.pathname, m = req.method;
    if (p === '/api/bridge' && m === 'GET') return send(res, 200, { items: C.items, status: C.status && Date.now() - C.status.at < 90000 ? C.status : (C.status ? Object.assign({}, C.status, { offline: true }) : null) });
    if (p === '/api/bridge' && m === 'PUT') {
      const b = await readBody(req) || {}; if (!Array.isArray(b.items)) return send(res, 400, { error: 'liste attendue' });
      C.items = b.items.slice(0, 150).filter(i => i && i.key && i.name).map(i => ({ key: String(i.key), name: String(i.name).slice(0, 32), type: i.type || 'device', kind: i.kind || '', brand: i.brand || '', id: String(i.id || ''), room: i.room || '', matter: i.matter !== false && i.kind !== 'lock', homekit: !!i.homekit })).filter(i => i.matter || i.homekit);   // matter : Alexa ; homekit : app Maison
      persist(); return send(res, 200, { items: C.items });
    }
    // utilisés par le conteneur du pont
    if (p === '/api/bridge/state' && m === 'GET') return send(res, 200, { items: await state() });
    if (p === '/api/bridge/status' && m === 'POST') { C.status = await readBody(req) || {}; C.status.at = Date.now(); persist(); return send(res, 200, { ok: true }); }
    if (p === '/api/bridge/command' && m === 'POST') {
      const b = await readBody(req) || {}, it = C.items.find(i => i.key === b.key); if (!it) return send(res, 404, { error: 'appareil non partagé' });
      if (it.type === 'button') { events.push({ t: Date.now(), type: 'button', id: it.id, name: it.name }); while (events.length > 50) events.shift(); return send(res, 200, { ok: true }); }
      if (it.type === 'trigger') return send(res, 200, { ok: true });
      await HUB.command(it.brand, it.id, b.patch || {});
      return send(res, 200, { ok: true });
    }
    // utilisés par Bêta home
    if (p === '/api/bridge/trigger' && m === 'POST') { const b = await readBody(req) || {}; fire(String(b.id || '')); return send(res, 200, { ok: true }); }
    // un seul écran lance la routine : le premier qui la réclame
    if (p === '/api/bridge/claim' && m === 'POST') { const b = await readBody(req) || {}, e = events.find(x => x.t === +b.t); if (!e || e.claimed) return send(res, 200, { ok: false }); e.claimed = true; return send(res, 200, { ok: true }); }
    if (p === '/api/bridge/events' && m === 'GET') { const t = +url.searchParams.get('since') || 0; return send(res, 200, { now: Date.now(), events: events.filter(e => e.t > t) }); }
    return false;
  }
  return { api };
};

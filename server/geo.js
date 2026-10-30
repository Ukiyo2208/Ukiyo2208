// Serveur Bêta — positions de la famille avec l'appli gratuite OwnTracks (iPhone / Android), sans Home Assistant.
// Le téléphone envoie sa position au NAS (mode HTTP) ; Bêta home l'affiche sur la Carte, garde l'historique
// sur le NAS et prévient quand quelqu'un arrive ou quitte la maison. Rien ne passe par un service tiers.
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');

module.exports = function geo(DATA, send, readBody, NOTIFY) {
  const FILE = path.join(DATA, 'geo.json'), DIR = path.join(DATA, 'geo');
  fs.mkdirSync(DIR, { recursive: true });
  let G = {}; try { G = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { }
  G = Object.assign({ users: {}, last: {}, home: null, inside: {} }, G);
  const persist = () => fs.writeFileSync(FILE, JSON.stringify(G, null, 1), { mode: 0o600 });
  const hash = (pw, salt) => crypto.scryptSync(String(pw), salt, 32).toString('hex');
  const R = 6371e3, rad = x => x * Math.PI / 180;
  const dist = (a, b) => { const dl = rad(b[0] - a[0]), dn = rad(b[1] - a[1]), h = Math.sin(dl / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
  const safe = uid => /^[\w.-]{1,40}$/.test(uid);

  // identification « Basic » configurée dans OwnTracks (utilisateur = identifiant Bêta, mot de passe généré)
  function who(req) {
    const m = /^Basic\s+(.+)$/i.exec(req.headers.authorization || ''); if (!m) return null;
    const raw = Buffer.from(m[1], 'base64').toString(), i = raw.indexOf(':'), uid = raw.slice(0, i), pw = raw.slice(i + 1), u = G.users[uid];
    if (!u || !u.hash) return null;
    const a = Buffer.from(hash(pw, u.salt), 'hex'), b = Buffer.from(u.hash, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b) ? uid : null;
  }
  // historique : un fichier par personne, une ligne par point ; on garde 180 jours
  function append(uid, p) {
    const f = path.join(DIR, uid + '.jsonl');
    fs.appendFileSync(f, JSON.stringify([p.lat, p.lon, Math.round(p.t / 1000), p.vel == null ? null : p.vel]) + '\n');
    try { if (fs.statSync(f).size > 8e6) { const from = Date.now() / 1000 - 180 * 86400; fs.writeFileSync(f, fs.readFileSync(f, 'utf8').split('\n').filter(l => { try { return JSON.parse(l)[2] > from; } catch (e) { return false; } }).join('\n') + '\n'); } } catch (e) { }
  }
  // arrivée / départ (avec une marge pour éviter les allers-retours dus au GPS)
  function presence(uid, p) {
    if (!G.home) return;
    const d = dist([G.home.lat, G.home.lon], [p.lat, p.lon]), r = G.home.r || 150, was = G.inside[uid];
    const now = d < r ? true : d > r + 100 ? false : was;
    if (now === was || now == null) return;
    G.inside[uid] = now;
    if (was == null) return;   // première position : on mémorise seulement
    const n = (G.users[uid] || {}).name || uid;
    if (NOTIFY) NOTIFY.notifyRule('presence', { title: now ? n + ' est arrivé(e) à la maison' : n + ' a quitté la maison', message: now ? 'Bienvenue !' : 'Position mise à jour par OwnTracks', go: 'carte', tags: [now ? 'house' : 'wave'], except: uid });
  }

  async function api(req, res, url) {
    const p = url.pathname, m = req.method;
    // réception d'une position envoyée par OwnTracks (pas de clé Bêta : identification propre à chaque personne)
    if (p === '/api/owntracks' && m === 'POST') {
      const uid = who(req); if (!uid) { res.setHeader('WWW-Authenticate', 'Basic realm="Bêta home"'); return send(res, 401, { error: 'identifiants OwnTracks refusés' }); }
      const b = await readBody(req) || {};
      if (b._type === 'location' && typeof b.lat === 'number' && typeof b.lon === 'number') {
        const pt = { lat: +b.lat.toFixed(6), lon: +b.lon.toFixed(6), acc: b.acc || null, t: (b.tst || Date.now() / 1000) * 1000, batt: b.batt == null ? null : b.batt, vel: b.vel == null ? null : b.vel, src: 'OwnTracks' };
        if (!G.last[uid] || pt.t >= G.last[uid].t) G.last[uid] = pt;
        append(uid, pt); presence(uid, pt); persist();
      }
      // en retour : la position des autres membres, visible dans OwnTracks
      const out = [];
      Object.keys(G.last).filter(id => id !== uid && G.users[id]).forEach(id => { const l = G.last[id], tid = (G.users[id].name || id).normalize('NFD').replace(/[\u0300-\u036f]/g, '').slice(0, 2).toUpperCase(); out.push({ _type: 'card', tid, name: G.users[id].name || id }, { _type: 'location', tid, lat: l.lat, lon: l.lon, tst: Math.round(l.t / 1000), acc: l.acc || 50 }); });
      return send(res, 200, out);
    }
    if (p === '/api/geo' && m === 'GET') {
      const users = {}; Object.keys(G.users).forEach(id => { users[id] = { name: G.users[id].name, ready: !!G.users[id].hash }; });
      return send(res, 200, { home: G.home, users, last: G.last, inside: G.inside });
    }
    // créer / renouveler l'accès OwnTracks d'une personne (le mot de passe n'est montré qu'une fois)
    if (p === '/api/geo/user' && m === 'POST') {
      const b = await readBody(req) || {}; if (!safe(b.uid || '')) return send(res, 400, { error: 'identifiant invalide' });
      if (b.remove) { delete G.users[b.uid]; delete G.last[b.uid]; delete G.inside[b.uid]; persist(); return send(res, 200, { ok: true }); }
      const pw = crypto.randomBytes(12).toString('base64url'), salt = crypto.randomBytes(16).toString('hex');
      G.users[b.uid] = { name: String(b.name || b.uid).slice(0, 40), salt, hash: hash(pw, salt) }; persist();
      return send(res, 200, { uid: b.uid, password: pw });
    }
    if (p === '/api/geo/home' && m === 'PUT') {
      const b = await readBody(req) || {}; if (typeof b.lat !== 'number' || typeof b.lon !== 'number') return send(res, 400, { error: 'position invalide' });
      G.home = { lat: b.lat, lon: b.lon, r: Math.max(50, Math.min(1000, +b.r || 150)) }; persist(); return send(res, 200, G.home);
    }
    if (p === '/api/geo/history' && m === 'GET') {
      const uid = url.searchParams.get('user') || ''; if (!safe(uid)) return send(res, 400, { error: 'identifiant invalide' });
      const from = (+url.searchParams.get('from') || Date.now() - 864e5) / 1000, to = (+url.searchParams.get('to') || Date.now()) / 1000, f = path.join(DIR, uid + '.jsonl');
      const pts = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(x => x && x[2] >= from && x[2] <= to) : [];
      return send(res, 200, pts.slice(-20000));
    }
    return false;
  }
  return { api, inside: () => Object.assign({}, G.inside), last: () => G.last, home: () => G.home };
};

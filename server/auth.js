// Serveur Bêta — comptes et écrans de confiance (« coffre »).
// - chaque écran est « associé » une fois avec un code à 6 chiffres affiché sur un écran admin (plus besoin de la clé BETA_KEY partout)
// - le code PIN de chaque personne est vérifié par le NAS (haché, jamais renvoyé)
// - en mode sécurisé, les réglages (marques, notifications, ponts, règles…) exigent une session administrateur
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');

module.exports = function auth(DATA, send, readBody, MASTER) {
  const FILE = path.join(DATA, 'auth.json');
  let C = {}; try { C = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { }
  C = Object.assign({ secure: false, users: {}, devices: {} }, C);
  const persist = () => fs.writeFileSync(FILE, JSON.stringify(C, null, 1), { mode: 0o600 });
  const hash = (pin, salt) => crypto.scryptSync(String(pin), salt, 32).toString('hex');
  const eq = (a, b) => { const x = Buffer.from(a, 'hex'), y = Buffer.from(b, 'hex'); return x.length === y.length && crypto.timingSafeEqual(x, y); };
  const sessions = {}, pairing = {}, tries = {};
  const tok = () => crypto.randomBytes(24).toString('base64url');
  const sha = t => crypto.createHash('sha256').update(String(t)).digest('hex');   // les jetons d'écran sont gardés hachés

  function checkPin(user, pin) {
    const u = C.users[user]; if (!u || !u.hash || !pin) return false;
    const t = tries[user] = tries[user] || { n: 0, at: 0 };
    if (t.n >= 5 && Date.now() - t.at < 5 * 6e4) return false;   // 5 essais puis 5 min d'attente
    const ok = eq(hash(pin, u.salt), u.hash); if (ok) t.n = 0; else { t.n++; t.at = Date.now(); } return ok;
  }
  const secure = () => !!C.secure && Object.values(C.users).some(u => u.admin && u.hash);
  // qui fait la requête : clé maître, écran associé, session d'une personne
  function who(req, url) {
    const key = req.headers['x-beta-key'] || '', dev = req.headers['x-beta-device'] || url.searchParams.get('d') || '', ses = sessions[req.headers['x-beta-session'] || ''];
    const d = dev && C.devices[sha(dev)];
    if (d) { d.last = Date.now(); }
    const s = ses && ses.exp > Date.now() ? ses : null;
    return { master: !!MASTER && key === MASTER, device: d ? d.name : '', ok: (!MASTER || key === MASTER) || !!d, user: s ? s.user : '', name: s ? s.name : '', admin: s ? s.admin : false };
  }
  // routes de réglages : session admin exigée en mode sécurisé
  const ADMIN = [[/^\/api\/hub\/\w+$/, ['PUT', 'DELETE']], [/^\/api\/hub\/\w+\/action\//, ['POST']], [/^\/api\/notify$/, ['PUT']], [/^\/api\/bridge$/, ['PUT']], [/^\/api\/geo\/(user|home)$/, ['POST', 'PUT']], [/^\/api\/engine$/, ['PUT']], [/^\/api\/cams$/, ['POST']], [/^\/api\/auth\/(secure|pair\/start|revoke|users|reset)$/, ['POST']]];
  const needAdmin = (p, m) => secure() && ADMIN.some(([re, ms]) => re.test(p) && ms.includes(m));

  async function api(req, res, url, w) {
    const p = url.pathname, m = req.method;
    if (p === '/api/auth' && m === 'GET') return send(res, 200, { secure: secure(), wanted: !!C.secure, users: Object.keys(C.users).map(id => ({ id, name: C.users[id].name, admin: !!C.users[id].admin, pin: !!C.users[id].hash })), devices: Object.keys(C.devices).map(h => ({ id: h.slice(0, 12), name: C.devices[h].name, at: C.devices[h].at, last: C.devices[h].last })), me: { device: w.device, master: w.master, user: w.user, admin: w.admin } });
    if (p === '/api/auth/users' && m === 'POST') {   // noms et rôles envoyés par Bêta home (les PIN restent ici)
      const b = await readBody(req) || {}; (b.users || []).forEach(u => { if (!/^[\w.-]{1,40}$/.test(u.id)) return; C.users[u.id] = Object.assign(C.users[u.id] || {}, { name: String(u.name || u.id).slice(0, 40), admin: !!u.admin }); });
      persist(); return send(res, 200, { ok: true });
    }
    if (p === '/api/auth/pin' && m === 'POST') {
      const b = await readBody(req) || {}, u = C.users[b.user]; if (!u) return send(res, 404, { error: 'personne inconnue' });
      if (!/^\d{4,8}$/.test(String(b.pin || ''))) return send(res, 400, { error: 'le code doit faire de 4 à 8 chiffres' });
      if (u.hash && !(w.admin || checkPin(b.user, b.old))) return send(res, 403, { error: 'ancien code incorrect' });
      if (!u.hash && secure() && !w.admin) return send(res, 403, { error: 'un administrateur doit le créer' });
      u.salt = crypto.randomBytes(16).toString('hex'); u.hash = hash(b.pin, u.salt); persist(); return send(res, 200, { ok: true });
    }
    if (p === '/api/auth/login' && m === 'POST') {
      const b = await readBody(req) || {}, u = C.users[b.user];
      if (!u || !checkPin(b.user, b.pin)) return send(res, 403, { error: (tries[b.user] || {}).n >= 5 ? 'trop d’essais : patientez 5 minutes' : 'code incorrect' });
      const t = tok(); sessions[t] = { user: b.user, name: u.name, admin: !!u.admin, exp: Date.now() + (b.long ? 12 : 1) * 36e5 };
      return send(res, 200, { session: t, user: b.user, name: u.name, admin: !!u.admin, exp: sessions[t].exp });
    }
    if (p === '/api/auth/logout' && m === 'POST') { delete sessions[req.headers['x-beta-session'] || '']; return send(res, 200, { ok: true }); }
    if (p === '/api/auth/secure' && m === 'POST') {
      const b = await readBody(req) || {};
      if (b.on && !Object.values(C.users).some(u => u.admin && u.hash)) return send(res, 400, { error: 'créez d’abord le code d’un administrateur' });
      C.secure = !!b.on; persist(); return send(res, 200, { secure: secure() });
    }
    if (p === '/api/auth/pair/start' && m === 'POST') { const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0'); pairing[code] = Date.now() + 10 * 6e4; return send(res, 200, { code, exp: pairing[code] }); }
    if (p === '/api/auth/revoke' && m === 'POST') { const b = await readBody(req) || {}; Object.keys(C.devices).filter(h => h.startsWith(b.id)).forEach(h => delete C.devices[h]); persist(); return send(res, 200, { ok: true }); }
    return false;
  }
  // association d'un écran (sans clé) : le code a été affiché sur un écran admin
  async function pair(req, res) {
    const b = await readBody(req) || {}, code = String(b.code || '').replace(/\D/g, '');
    if (!pairing[code] || pairing[code] < Date.now()) return send(res, 403, { error: 'code inconnu ou expiré' });
    delete pairing[code];
    const t = tok(); C.devices[sha(t)] = { name: String(b.name || 'Écran').slice(0, 40), at: Date.now(), last: Date.now() }; persist();
    return send(res, 200, { device: t });
  }
  return { api, pair, who, needAdmin, checkPin, secure };
};

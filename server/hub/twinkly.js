// Twinkly — guirlandes et rideaux lumineux. API locale « xled » (jeton obtenu en local, sans compte) : marche/arrêt, intensité, couleur.
'use strict';
const crypto = require('crypto');
const { json } = require('./net');
const hosts = c => String(c.hosts || '').split(/[\s,;]+/).map(h => h.replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter(Boolean);
const u = (h, p) => 'http://' + h + '/xled/v1/' + p;
const TOK = {};
async function token(h, fresh) {
  const t = TOK[h]; if (t && !fresh && t.exp > Date.now()) return t.v;
  const r = await json(u(h, 'login'), { body: { challenge: crypto.randomBytes(32).toString('base64') }, timeout: 5000 });
  if (!r || !r.authentication_token) throw new Error('Twinkly : connexion refusée');
  await json(u(h, 'verify'), { body: { 'challenge-response': r['challenge-response'] }, headers: { 'X-Auth-Token': r.authentication_token }, timeout: 5000 });
  TOK[h] = { v: r.authentication_token, exp: Date.now() + ((r.authentication_token_expires_in || 14400) - 120) * 1000 };
  return TOK[h].v;
}
async function call(h, p, body) {
  for (const fresh of [false, true]) {
    try { return await json(u(h, p), { headers: { 'X-Auth-Token': await token(h, fresh) }, body, method: body ? 'POST' : 'GET', timeout: 5000 }); }
    catch (e) { if (fresh || !/HTTP 401/.test(e.message)) throw e; }   // jeton expiré : on recommence une fois
  }
}
const hex = (r, g, b) => '#' + [r, g, b].map(v => ('0' + (v | 0).toString(16)).slice(-2)).join('');
module.exports = {
  id: 'twinkly', name: 'Twinkly', poll: 8000, secrets: [],
  async test(c) { const h = hosts(c); if (!h.length) throw new Error('adresse IP manquante'); const g = await json(u(h[0], 'gestalt'), { timeout: 5000 }); return h.length + ' décor(s) · ' + (g.product_name || g.device_name || 'Twinkly') + ' · ' + (g.number_of_led || '?') + ' LED'; },
  async devices(c) {
    const out = [];
    for (const h of hosts(c)) {
      try {
        const g = await json(u(h, 'gestalt'), { timeout: 5000 }), m = await call(h, 'led/mode'), b = await call(h, 'led/out/brightness').catch(() => ({})), col = await call(h, 'led/color').catch(() => null);
        out.push({ id: h, name: g.device_name || 'Twinkly ' + h, kind: 'rgb', info: (g.product_name || 'Twinkly') + ' · ' + (g.number_of_led || '?') + ' LED', state: { on: m.mode !== 'off', bri: b.mode === 'disabled' ? 100 : (b.value != null ? b.value : 100), color: col && col.red != null ? hex(col.red, col.green, col.blue) : undefined, rgb: true, last: m.mode !== 'off' ? m.mode : undefined } });
      } catch (e) { out.push({ id: h, name: 'Twinkly ' + h, kind: 'rgb', error: e.message, state: {} }); }
    }
    return out;
  },
  async command(c, id, p, cur) {
    cur = cur || {};
    if (p.color) { const n = parseInt(p.color.replace('#', ''), 16); await call(id, 'led/color', { red: n >> 16 & 255, green: n >> 8 & 255, blue: n & 255 }); await call(id, 'led/mode', { mode: 'color' }); }
    else if ('on' in p) await call(id, 'led/mode', { mode: p.on ? (cur.last && cur.last !== 'off' ? cur.last : 'movie') : 'off' });
    if ('bri' in p) await call(id, 'led/out/brightness', { mode: 'enabled', type: 'A', value: Math.max(0, Math.min(100, Math.round(p.bri))) });
  }
};

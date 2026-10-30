// Wallbox (Pulsar, Commander, Copper) — API du compte myWallbox : état, puissance, pause/reprise, verrouillage.
'use strict';
const { request, json } = require('./net');
const API = 'https://api.wall-box.com';
const T = {};
async function auth(c) {
  if (T[c.email] && Date.now() < T[c.email].exp) return T[c.email].h;
  const r = await request('https://user-api.wall-box.com/users/signin', { raw: true, headers: { Authorization: 'Basic ' + Buffer.from(c.email + ':' + c.password).toString('base64'), Partner: 'wallbox', 'Content-Type': 'application/json' }, method: 'GET' });
  const j = r.json(), tok = j && j.data && j.data.attributes && j.data.attributes.token; if (!tok) throw new Error('compte myWallbox refusé');
  T[c.email] = { h: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, exp: Date.now() + 50 * 6e4 }; return T[c.email].h;
}
const STATUS = { 193: 'En charge', 194: 'En charge', 195: 'En charge', 178: 'En pause', 182: 'En pause', 181: 'Prête (attente voiture)', 161: 'Prête', 162: 'Prête', 209: 'Verrouillée', 210: 'Verrouillée', 0: 'Débranchée', 14: 'Erreur', 15: 'Erreur' };
module.exports = {
  id: 'wallbox', name: 'Wallbox', poll: 30000, secrets: ['password'],
  async test(c) { const g = await json(API + '/v3/chargers/groups', { headers: await auth(c) }); return g.result.groups.reduce((a, x) => a + x.chargers.length, 0) + ' borne(s)'; },
  async devices(c) {
    const h = await auth(c), g = await json(API + '/v3/chargers/groups', { headers: h }), out = [];
    for (const ch of g.result.groups.flatMap(x => x.chargers)) {
      const s = await json(API + '/chargers/status/' + ch.id, { headers: h });
      out.push({ id: String(ch.id), name: 'Borne ' + (s.name || ch.name), kind: 'plug', info: (STATUS[s.status_id] || 'Statut ' + s.status_id) + (s.added_energy ? ' · ' + (+s.added_energy).toFixed(1).replace('.', ',') + ' kWh' : ''), state: { on: /En charge/.test(STATUS[s.status_id] || ''), w: Math.round((s.charging_power || 0) * 1000), locked: !!s.config_data && !!s.config_data.locked } });
    }
    return out;
  },
  async command(c, id, p) {
    const h = await auth(c);
    if ('on' in p) await request(API + '/v3/chargers/' + id + '/remote-action', { headers: h, body: { action: p.on ? 1 : 2 } });
    if ('locked' in p) await request(API + '/v2/charger/' + id, { method: 'PUT', headers: h, body: { locked: p.locked ? 1 : 0 } });
  }
};

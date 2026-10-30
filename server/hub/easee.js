// Easee (Home, Charge) — API officielle du compte Easee : état, puissance, pause/reprise de la charge.
'use strict';
const { request, json } = require('./net');
const API = 'https://api.easee.com/api';
const T = {};
async function auth(c) {
  if (T[c.email] && Date.now() < T[c.email].exp) return T[c.email].h;
  const j = await json(API + '/accounts/login', { body: { userName: c.email, password: c.password } });
  if (!j || !j.accessToken) throw new Error('compte Easee refusé');
  T[c.email] = { h: { Authorization: 'Bearer ' + j.accessToken }, exp: Date.now() + (j.expiresIn - 120) * 1000 }; return T[c.email].h;
}
const MODE = { 1: 'Débranchée', 2: 'Attente de démarrage', 3: 'En charge', 4: 'Charge terminée', 5: 'Erreur', 6: 'Prête', 7: 'Attente d’autorisation' };
module.exports = {
  id: 'easee', name: 'Easee', poll: 30000, secrets: ['password'],
  async test(c) { return (await json(API + '/chargers', { headers: await auth(c) })).length + ' borne(s)'; },
  async devices(c) {
    const h = await auth(c), out = [];
    for (const ch of await json(API + '/chargers', { headers: h })) {
      const s = await json(API + '/chargers/' + ch.id + '/state', { headers: h });
      out.push({ id: ch.id, name: 'Borne ' + (ch.name || ch.id), kind: 'plug', info: (MODE[s.chargerOpMode] || '') + (s.sessionEnergy ? ' · ' + (+s.sessionEnergy).toFixed(1).replace('.', ',') + ' kWh' : ''), state: { on: s.chargerOpMode === 3, w: Math.round((s.totalPower || 0) * 1000) } });
    }
    return out;
  },
  async command(c, id, p) { if ('on' in p) await request(API + '/chargers/' + id + '/commands/' + (p.on ? 'resume_charging' : 'pause_charging'), { headers: await auth(c), body: {} }); }
};

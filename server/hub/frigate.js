// Frigate (NVR libre sur le NAS) — détection locale des personnes, voitures, animaux sur toutes les caméras.
// Chaque caméra devient un détecteur « personne/objet détecté » dans Bêta home (utilisable pour les alertes).
'use strict';
const { request } = require('./net');
const base = c => { const h = String(c.host || '').trim().replace(/\/+$/, ''); return /^https?:\/\//.test(h) ? h : 'http://' + (/:\d+$/.test(h) ? h : h + ':5000'); };
const sess = {};
async function api(c, path, bin) {
  const b = base(c), h = {};
  if (c.user) {   // Frigate 0.14+ sur le port 8971 : connexion par identifiant
    if (!sess[b] || Date.now() - sess[b].at > 3600e3) { const r = await request(b + '/api/login', { insecure: true, body: { user: c.user, password: c.password || '' }, raw: true }); if (r.status >= 400) throw new Error('identifiant Frigate refusé'); sess[b] = { cookie: (r.headers['set-cookie'] || []).map(x => x.split(';')[0]).join('; '), at: Date.now() }; }
    h.Cookie = sess[b].cookie;
  }
  const r = await request(b + path, { insecure: true, headers: h, timeout: 8000 });
  return bin ? r.buf : r.json();
}
const LBL = { person: 'personne', car: 'voiture', dog: 'chien', cat: 'chat', bicycle: 'vélo', motorcycle: 'moto', bird: 'oiseau', package: 'colis' };
module.exports = {
  id: 'frigate', name: 'Frigate', poll: 3000, secrets: ['password'],
  async test(c) { const cfg = await api(c, '/api/config'); return Object.keys(cfg.cameras || {}).length + ' caméra(s) · Frigate ' + ((await api(c, '/api/version').catch(() => '')) || ''); },
  async devices(c) {
    const [cfg, ev] = await Promise.all([api(c, '/api/config'), api(c, '/api/events?limit=50&after=' + Math.floor(Date.now() / 1000 - 600))]);
    return Object.keys(cfg.cameras || {}).map(cam => {
      const mine = (ev || []).filter(e => e.camera === cam), live = mine.filter(e => !e.end_time || Date.now() / 1000 - e.end_time < 20), last = mine[0];
      return { id: cam, name: 'Détection ' + cam.replace(/_/g, ' '), kind: 'motion', info: 'Frigate', state: { on: live.length > 0, label: live[0] ? (LBL[live[0].label] || live[0].label) : '', last: last ? Math.round(last.start_time * 1000) : 0 } };
    });
  },
  async command() { },
  // pour la détection sur le serveur (server/plus.js) : évènements récents, photo d'un évènement, caméras et zones
  events: (c, after) => api(c, '/api/events?limit=30&include_thumbnails=0&after=' + Math.floor(after)),
  snap: (c, id) => api(c, '/api/events/' + encodeURIComponent(id) + '/snapshot.jpg?bbox=1', true),
  config: c => api(c, '/api/config'),
  LBL
};

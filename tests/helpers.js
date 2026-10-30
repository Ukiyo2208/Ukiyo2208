// Outils communs : dossier de données jetable, faux hub / notifications, serveurs HTTP de test
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
exports.tmp = name => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'beta-' + name + '-')); return d; };
exports.mocks = (states) => {
  const cmds = [], sent = [];
  let away = false;
  const HUB = { states: async () => ({ s: states || {} }), command: async (b, id, p) => { cmds.push([id, p]); if (states && states[id]) Object.assign(states[id], p); }, configured: () => [], cfg: () => ({}), brand: () => null };
  const NOTIFY = { hooks: { ring: [], away: [] }, isAway: () => away, setAway(v) { away = !!v; NOTIFY.hooks.away.forEach(f => f(away)); }, notifyRule: async (r, o) => { sent.push([r, o.title, o.message]); return 1; }, sendTo: async () => 1, snapshot: async () => null };
  return { HUB, NOTIFY, cmds, sent, GEO: { inside: () => ({}), home: () => ({ lat: 48.4917, lon: 7.6806 }) } };
};
exports.listen = (handler) => new Promise(ok => { const s = require('http').createServer(handler).listen(0, '127.0.0.1', () => ok({ server: s, url: 'http://127.0.0.1:' + s.address().port, port: s.address().port })); });

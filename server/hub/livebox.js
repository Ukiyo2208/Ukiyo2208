// Livebox (Orange) — API locale de la box : qui est à la maison (appareils connectés), Wi-Fi marche/arrêt.
'use strict';
const { request } = require('./net');
const root = c => 'http://' + String(c.host || '192.168.1.1').replace(/^https?:\/\//, '').replace(/\/+$/, '');
const S = {};
async function ws(c, service, method, parameters) {
  const go = async () => {
    const s = S[root(c)];
    const r = await request(root(c) + '/ws', { raw: true, timeout: 8000, headers: { 'Content-Type': 'application/x-sah-ws-4-call+json', Authorization: 'X-Sah ' + s.ctx, 'X-Context': s.ctx, Cookie: s.cookie }, body: JSON.stringify({ service, method, parameters: parameters || {} }) });
    return r;
  };
  if (!S[root(c)]) await login(c);
  let r = await go(); if (r.status === 401 || r.status === 403) { await login(c); r = await go(); }
  const j = r.json(); if (!j) throw new Error('Livebox injoignable'); if (j.errors && j.errors.length) throw new Error(j.errors[0].description || 'erreur Livebox');
  return j.status;
}
async function login(c) {
  const r = await request(root(c) + '/ws', { raw: true, timeout: 8000, headers: { 'Content-Type': 'application/x-sah-ws-4-call+json', Authorization: 'X-Sah-Login' }, body: JSON.stringify({ service: 'sah.Device.Information', method: 'createContext', parameters: { applicationName: 'webui', username: c.user || 'admin', password: c.password || '' } }) });
  const j = r.json(); if (!j || !j.data || !j.data.contextID) throw new Error('mot de passe de la Livebox refusé');
  S[root(c)] = { ctx: j.data.contextID, cookie: (r.headers['set-cookie'] || []).map(x => x.split(';')[0]).join('; ') };
}
const watched = c => String(c.presence || '').split(/[,;\n]+/).map(x => x.trim().toLowerCase()).filter(Boolean);
module.exports = {
  id: 'livebox', name: 'Livebox', poll: 15000, secrets: ['password'],
  async test(c) { const d = await ws(c, 'Devices', 'get', { expression: 'physical and !self and !voice' }); return d.filter(x => x.Active).length + ' appareil(s) connecté(s)'; },
  async devices(c) {
    const [d, w] = await Promise.all([ws(c, 'Devices', 'get', { expression: 'physical and !self and !voice' }), ws(c, 'NMC.Wifi', 'get').catch(() => null)]), out = [];
    if (w) out.push({ id: 'wifi', name: 'Wi-Fi Livebox', kind: 'plug', info: 'Couper / remettre le Wi-Fi', state: { on: !!w.Enable } });
    watched(c).forEach(n => { const h = d.find(x => (x.Name || '').toLowerCase() === n || (x.PhysAddress || '').toLowerCase() === n); out.push({ id: 'p:' + n, name: 'Présence ' + (h ? h.Name : n), kind: 'motion', info: h ? 'Connecté au réseau de la maison' : 'Appareil introuvable', state: { on: !!(h && h.Active) } }); });
    return out;
  },
  async command(c, id, p) { if (id === 'wifi' && 'on' in p) await ws(c, 'NMC.Wifi', 'set', { Enable: !!p.on, Status: !!p.on }); }
};

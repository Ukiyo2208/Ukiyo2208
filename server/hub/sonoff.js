// Sonoff (eWeLink) en mode « DIY » / LAN : Mini R2/R3, BASICR3, RFR3, S26R2, ZBMINI-L… API locale (port 8081), sans compte.
'use strict';
const { json } = require('./net');
const hosts = c => String(c.hosts || '').split(/[\s,;]+/).map(h => h.replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter(Boolean);
const base = h => 'http://' + (/:\d+$/.test(h) ? h : h + ':8081') + '/zeroconf/';
async function call(h, p, data) {
  const r = await json(base(h) + p, { method: 'POST', body: { deviceid: '', data: data || {} }, timeout: 5000 });
  if (!r || r.error) throw new Error(r && r.error === 401 ? 'mode DIY non activé' : 'erreur Sonoff ' + (r ? r.error : ''));
  return typeof r.data === 'string' ? JSON.parse(r.data || '{}') : (r.data || {});   // les anciens firmwares renvoient du texte
}
module.exports = {
  id: 'sonoff', name: 'Sonoff', poll: 5000, secrets: [],
  async test(c) { const h = hosts(c); if (!h.length) throw new Error('adresse IP manquante'); const d = await call(h[0], 'info'); return h.length + ' module(s) · firmware ' + (d.fwVersion || '?'); },
  async devices(c) {
    const out = [];
    for (const h of hosts(c)) {
      try { const d = await call(h, 'info'); out.push({ id: h, name: 'Sonoff ' + (d.deviceid ? d.deviceid.slice(-4) : h), kind: 'plug', info: 'Sonoff ' + (d.fwVersion ? 'v' + d.fwVersion : '') + (d.signalStrength ? ' · Wi-Fi ' + d.signalStrength + ' dBm' : ''), state: { on: d.switch === 'on' } }); }
      catch (e) { out.push({ id: h, name: 'Sonoff ' + h, kind: 'plug', error: e.message, state: {} }); }
    }
    return out;
  },
  async command(c, id, p) { if ('on' in p) await call(id, 'switch', { switch: p.on ? 'on' : 'off' }); }
};

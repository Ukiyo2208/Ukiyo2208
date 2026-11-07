// Tasmota — prises et modules reprogrammés, API HTTP locale (/cm?cmnd=…). Sans compte.
'use strict';
const { json } = require('./net');
const hosts = c => String(c.hosts || '').split(/[\s,;]+/).map(h => h.replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter(Boolean);
const cm = (c, h, cmnd) => json('http://' + h + '/cm?' + new URLSearchParams(Object.assign({ cmnd }, c.password ? { user: 'admin', password: c.password } : {})), { timeout: 4000 });
module.exports = {
  id: 'tasmota', name: 'Tasmota', poll: 3000, secrets: ['password'],
  async test(c) { const hs = hosts(c); if (!hs.length) throw new Error('adresse IP manquante'); const r = await Promise.all(hs.map(h => cm(c, h, 'Status').then(j => (j.Status && (j.Status.DeviceName || j.Status.FriendlyName[0])) || h, e => '⚠ ' + h + ' : ' + e.message))); if (r.every(x => x.startsWith('⚠'))) throw new Error(r.join(' · ')); return r.length + ' module(s) : ' + r.join(', '); },
  async devices(c) {
    return (await Promise.all(hosts(c).map(async h => { try {
      const j = await cm(c, h, 'Status 0'), st = j.StatusSTS || {}, names = (j.Status && j.Status.FriendlyName) || [], out = [];
      const pw = Object.keys(st).filter(k => /^POWER\d*$/.test(k));
      pw.forEach((k, i) => { const n = k.replace('POWER', '') || '1', light = st.Dimmer != null && i === 0; out.push({ id: h + '|' + n, name: names[+n - 1] || names[0] || 'Tasmota ' + h, kind: light ? (st.Color ? 'rgb' : 'light') : 'plug', state: Object.assign({ on: st[k] === 'ON' }, light ? { bri: st.Dimmer } : {}, light && st.Color && /^[0-9A-F]{6}/i.test(st.Color) ? { color: '#' + st.Color.slice(0, 6).toLowerCase() } : {}) }); });
      return out; } catch (e) { return []; } }))).flat();
  },
  async command(c, id, p) {
    const [h, n] = id.split('|');
    if ('on' in p) await cm(c, h, 'Power' + n + ' ' + (p.on ? 'On' : 'Off'));
    if ('bri' in p) await cm(c, h, 'Dimmer ' + Math.round(p.bri));
    if (p.color) await cm(c, h, 'Color ' + p.color.replace('#', ''));
  }
};

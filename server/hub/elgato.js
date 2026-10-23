// Elgato Key Light / Light Strip — API HTTP locale (port 9123), sans compte.
'use strict';
const { json } = require('./net');
const hosts = c => String(c.hosts || '').split(/[\s,;]+/).map(h => h.replace(/^https?:\/\//, '').replace(/[:/].*$/, '')).filter(Boolean);
const url = (h, p) => 'http://' + h + ':9123/elgato/' + p;
const kToCt = t => Math.round(1e6 / t);   // l'Elgato attend des mireds (143-344)

module.exports = {
  id: 'elgato', name: 'Elgato', poll: 5000, secrets: [],
  async test(c) { const h = hosts(c); if (!h.length) throw new Error('adresse IP manquante'); await json(url(h[0], 'lights'), { timeout: 5000 }); return h.length + ' lampe(s)'; },
  async devices(c) {
    const out = [];
    for (const h of hosts(c)) {
      try {
        const [info, l] = await Promise.all([json(url(h, 'accessory-info'), { timeout: 5000 }).catch(() => ({})), json(url(h, 'lights'), { timeout: 5000 })]);
        const s = l.lights[0];
        out.push({ id: h, name: info.displayName || info.productName || 'Elgato ' + h, kind: 'light', info: info.productName, state: { on: !!s.on, bri: s.brightness } });
      } catch (e) { out.push({ id: h, name: 'Elgato ' + h, kind: 'light', error: e.message, state: {} }); }
    }
    return out;
  },
  async command(c, id, p) {
    const l = {};
    if ('on' in p) l.on = p.on ? 1 : 0;
    if ('bri' in p) l.brightness = Math.max(3, Math.min(100, +p.bri));
    if ('ct' in p) l.temperature = Math.max(143, Math.min(344, kToCt(p.ct)));
    if (Object.keys(l).length) await json(url(id, 'lights'), { method: 'PUT', body: { numberOfLights: 1, lights: [l] } });
  }
};

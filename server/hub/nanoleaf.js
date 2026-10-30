// Nanoleaf — panneaux lumineux, API locale (port 16021). Appairage : maintenir le bouton marche 5-7 s puis « Appairer ».
'use strict';
const { request } = require('./net');
const host = c => String(c.host || '').replace(/^https?:\/\//, '').replace(/[:/].*$/, '');
const base = c => 'http://' + host(c) + ':16021/api/v1/' + c.token;
const call = async (url, o) => { const r = await request(url, Object.assign({ timeout: 5000 }, o)); return r.json(); };
function hexToHs(hex) { const n = parseInt(hex.slice(1), 16), r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0; if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return { hue: Math.round((h * 60 + 360) % 360), sat: Math.round(mx ? d / mx * 100 : 0) }; }
function hsToHex(h, s) { s /= 100; const f = n => { const k = (n + h / 60) % 6, v = 1 - s * Math.max(0, Math.min(k, 4 - k, 1)); return ('0' + Math.round(v * 255).toString(16)).slice(-2); }; return '#' + f(5) + f(3) + f(1); }
module.exports = {
  id: 'nanoleaf', name: 'Nanoleaf', poll: 4000, secrets: ['token'],
  actions: { async pair(c, b) { const h = b.host || c.host; if (!h) throw new Error('adresse IP manquante'); const r = await request('http://' + host({ host: h }) + ':16021/api/v1/new', { method: 'POST', body: '', raw: true, timeout: 5000 }); if (r.status === 403) throw new Error('maintenez d’abord le bouton marche 5 à 7 s (la LED clignote), puis réessayez dans les 30 s'); const j = r.json(); if (!j || !j.auth_token) throw new Error('appairage refusé'); return { host: h, token: j.auth_token }; } },
  async test(c) { if (!c.token) throw new Error('non appairé'); const j = await call(base(c) + '/'); return j.name + ' (' + j.model + ')'; },
  async devices(c) { if (!c.token) return []; const j = await call(base(c) + '/'), s = j.state; return [{ id: 'main', name: j.name || 'Nanoleaf', kind: 'rgb', info: j.model, state: { on: !!s.on.value, bri: s.brightness.value, color: hsToHex(s.hue.value, s.sat.value) } }]; },
  async command(c, id, p) {
    const b = {}; if ('on' in p) b.on = { value: !!p.on }; if ('bri' in p) b.brightness = { value: Math.round(p.bri) };
    if (p.color) { const hs = hexToHs(p.color); b.hue = { value: hs.hue }; b.sat = { value: hs.sat }; }
    if (Object.keys(b).length) await request(base(c) + '/state', { method: 'PUT', body: b, timeout: 5000 });
  }
};

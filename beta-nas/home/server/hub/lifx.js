// LIFX — protocole local UDP (port 56700). Ampoules et bandeaux LIFX, sans compte.
'use strict';
const dgram = require('dgram'), crypto = require('crypto');
const hosts = c => String(c.hosts || '').split(/[\s,;]+/).map(h => h.replace(/[:/].*$/, '')).filter(Boolean);
const SRC = crypto.randomBytes(4).readUInt32LE(0) || 1;
function msg(type, payload, seq) {
  const p = payload || Buffer.alloc(0), b = Buffer.alloc(36 + p.length);
  b.writeUInt16LE(b.length, 0); b.writeUInt16LE(1024 | (1 << 12) | (1 << 13), 2); b.writeUInt32LE(SRC, 4);
  b[22] = 1; b[23] = seq & 255; b.writeUInt16LE(type, 32); p.copy(b, 36); return b;
}
function ask(ip, type, payload, want) {
  return new Promise((ok, ko) => {
    const s = dgram.createSocket('udp4'), seq = Math.floor(Math.random() * 255); let n = 0;
    const end = (e, v) => { clearInterval(t); try { s.close(); } catch (x) { } e ? ko(e) : ok(v); };
    s.on('message', m => { if (m.length >= 36 && m.readUInt16LE(32) === want) end(null, m.slice(36)); });
    s.on('error', e => end(e));
    const b = msg(type, payload, seq), t = setInterval(() => { if (n++ > 5) return end(new Error('ampoule injoignable')); s.send(b, 56700, ip); }, 400); s.send(b, 56700, ip);
  });
}
const state = p => ({ h: p.readUInt16LE(0) / 65535 * 360, s: p.readUInt16LE(2) / 65535, v: p.readUInt16LE(4) / 65535, k: p.readUInt16LE(6), power: p.readUInt16LE(10), label: p.slice(12, 44).toString().replace(/\0+$/, '') });
const hex = (h, s) => { const f = n => { const k = (n + h / 60) % 6; return ('0' + Math.round((1 - s * Math.max(0, Math.min(k, 4 - k, 1))) * 255).toString(16)).slice(-2); }; return '#' + f(5) + f(3) + f(1); };
const hsb = hex => { const n = parseInt(hex.slice(1), 16), r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255, mx = Math.max(r, g, b), d = mx - Math.min(r, g, b); let h = 0; if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return { h: (h * 60 + 360) % 360, s: mx ? d / mx : 0 }; };
const getColor = ip => ask(ip, 101, null, 107).then(state);
function setColor(ip, h, s, v, k) { const p = Buffer.alloc(13); p.writeUInt16LE(Math.round(h / 360 * 65535) & 65535, 1); p.writeUInt16LE(Math.round(s * 65535), 3); p.writeUInt16LE(Math.round(v * 65535), 5); p.writeUInt16LE(k || 3500, 7); p.writeUInt32LE(300, 9); return ask(ip, 102, p, 107); }
module.exports = {
  id: 'lifx', name: 'LIFX', poll: 4000,
  async test(c) { const hs = hosts(c); if (!hs.length) throw new Error('adresse IP manquante'); const r = await Promise.all(hs.map(h => getColor(h).then(x => x.label || h, e => '⚠ ' + h + ' : ' + e.message))); if (r.every(x => x.startsWith('⚠'))) throw new Error(r.join(' · ')); return r.length + ' ampoule(s) : ' + r.join(', '); },
  async devices(c) { return (await Promise.all(hosts(c).map(h => getColor(h).then(x => ({ id: h, name: x.label || 'LIFX ' + h, kind: 'rgb', state: { on: x.power > 0, bri: Math.round(x.v * 100), color: hex(x.h, x.s) } }), () => null)))).filter(Boolean); },
  async command(c, h, p) {
    if ('on' in p) { const b = Buffer.alloc(6); b.writeUInt16LE(p.on ? 65535 : 0, 0); b.writeUInt32LE(300, 2); await ask(h, 117, b, 118); }
    if ('bri' in p || p.color) { const cur = await getColor(h), hs = p.color ? hsb(p.color) : { h: cur.h, s: cur.s }; await setColor(h, hs.h, hs.s, 'bri' in p ? p.bri / 100 : cur.v, cur.k); }
  },
  _test: { msg, state }
};

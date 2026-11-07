// Philips WiZ — ampoules Wi-Fi, protocole local UDP (port 38899). Sans compte.
'use strict';
const dgram = require('dgram');
const hosts = c => String(c.hosts || '').split(/[\s,;]+/).map(h => h.replace(/[:/].*$/, '')).filter(Boolean);
function udp(ip, msg) {
  return new Promise((ok, ko) => {
    const s = dgram.createSocket('udp4'), b = Buffer.from(JSON.stringify(msg)); let n = 0;
    const end = (e, v) => { clearInterval(t); try { s.close(); } catch (x) { } e ? ko(e) : ok(v); };
    s.on('message', m => { try { const j = JSON.parse(m.toString()); end(j.error ? new Error(j.error.message) : null, j.result || {}); } catch (e) { } });
    s.on('error', e => end(e));
    const t = setInterval(() => { if (n++ > 4) return end(new Error('ampoule injoignable')); s.send(b, 38899, ip); }, 500); s.send(b, 38899, ip);
  });
}
const hex = r => '#' + [r.r, r.g, r.b].map(v => ('0' + (v | 0).toString(16)).slice(-2)).join('');
module.exports = {
  id: 'wiz', name: 'Philips WiZ', poll: 4000,
  async test(c) { const hs = hosts(c); if (!hs.length) throw new Error('adresse IP manquante'); const r = await Promise.all(hs.map(h => udp(h, { method: 'getPilot', params: {} }).then(() => h, e => '⚠ ' + h + ' : ' + e.message))); if (r.every(x => x.startsWith('⚠'))) throw new Error(r.join(' · ')); return r.length + ' ampoule(s)'; },
  async devices(c) {
    return (await Promise.all(hosts(c).map(h => udp(h, { method: 'getPilot', params: {} }).then(r => ({ id: h, name: 'WiZ ' + h.split('.').pop(), kind: r.r != null ? 'rgb' : 'light', state: Object.assign({ on: !!r.state, bri: r.dimming || 0 }, r.r != null ? { color: hex(r) } : {}) }), () => null)))).filter(Boolean);
  },
  async command(c, h, p) {
    const q = {}; if ('on' in p) q.state = !!p.on; if ('bri' in p) { q.dimming = Math.max(10, Math.round(p.bri)); q.state = true; }
    if (p.color) { const n = parseInt(p.color.slice(1), 16); Object.assign(q, { r: n >> 16 & 255, g: n >> 8 & 255, b: n & 255, state: true }); }
    if (Object.keys(q).length) await udp(h, { method: 'setPilot', params: q });
  }
};

// Yeelight — lampes Xiaomi Yeelight, protocole local (TCP 55443). Activer « Contrôle LAN » dans l'app Yeelight.
'use strict';
const net = require('net');
const hosts = c => String(c.hosts || '').split(/[\s,;]+/).map(h => h.replace(/[:/].*$/, '')).filter(Boolean);
function cmd(ip, method, params) {
  return new Promise((ok, ko) => {
    const s = net.connect({ host: ip, port: 55443 }), id = Math.floor(Math.random() * 1e6); let buf = '';
    const end = (e, v) => { s.destroy(); e ? ko(e) : ok(v); };
    s.setTimeout(4000, () => end(new Error('lampe injoignable : activez le « Contrôle LAN »')));
    s.on('error', e => end(new Error('lampe injoignable (' + e.code + ') : activez le « Contrôle LAN »')));
    s.on('connect', () => s.write(JSON.stringify({ id, method, params }) + '\r\n'));
    s.on('data', d => { buf += d; buf.split('\r\n').forEach(l => { try { const j = JSON.parse(l); if (j.id === id) end(j.error ? new Error(j.error.message) : null, j.result); } catch (e) { } }); });
  });
}
module.exports = {
  id: 'yeelight', name: 'Yeelight', poll: 4000,
  async test(c) { const hs = hosts(c); if (!hs.length) throw new Error('adresse IP manquante'); const r = await Promise.all(hs.map(h => cmd(h, 'get_prop', ['power']).then(() => h, e => '⚠ ' + h + ' : ' + e.message))); if (r.every(x => x.startsWith('⚠'))) throw new Error(r.join(' · ')); return r.length + ' lampe(s)'; },
  async devices(c) {
    return (await Promise.all(hosts(c).map(h => cmd(h, 'get_prop', ['power', 'bright', 'rgb', 'name', 'color_mode']).then(v => ({ id: h, name: v[3] || 'Yeelight ' + h.split('.').pop(), kind: v[2] && v[2] !== '0' ? 'rgb' : 'light', state: Object.assign({ on: v[0] === 'on', bri: +v[1] || 0 }, v[2] && v[2] !== '0' ? { color: '#' + ('00000' + (+v[2]).toString(16)).slice(-6) } : {}) }), () => null)))).filter(Boolean);
  },
  async command(c, h, p) {
    if ('on' in p) await cmd(h, 'set_power', [p.on ? 'on' : 'off', 'smooth', 300]);
    if ('bri' in p) await cmd(h, 'set_bright', [Math.max(1, Math.round(p.bri)), 'smooth', 300]);
    if (p.color) await cmd(h, 'set_rgb', [parseInt(p.color.slice(1), 16), 'smooth', 300]);
  }
};

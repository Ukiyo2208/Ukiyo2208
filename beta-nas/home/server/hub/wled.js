// WLED — rubans et contrôleurs LED, API JSON locale (/json/state). Sans compte.
'use strict';
const { json } = require('./net');
const hosts = c => String(c.hosts || '').split(/[\s,;]+/).map(h => h.replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter(Boolean);
const hex = rgb => '#' + rgb.slice(0, 3).map(v => ('0' + (v | 0).toString(16)).slice(-2)).join('');
module.exports = {
  id: 'wled', name: 'WLED', poll: 3000,
  async test(c) { const hs = hosts(c); if (!hs.length) throw new Error('adresse IP manquante'); const r = await Promise.all(hs.map(h => json('http://' + h + '/json/info', { timeout: 4000 }).then(i => i.name, e => '⚠ ' + h + ' : ' + e.message))); if (r.every(x => x.startsWith('⚠'))) throw new Error(r.join(' · ')); return r.length + ' contrôleur(s) : ' + r.join(', '); },
  async devices(c) {
    return (await Promise.all(hosts(c).map(async h => { try { const j = await json('http://' + h + '/json', { timeout: 4000 }), s = j.state, col = (s.seg && s.seg[0] && s.seg[0].col && s.seg[0].col[0]) || [255, 160, 80];
      return { id: h, name: j.info.name || 'WLED ' + h, kind: 'rgb', info: j.info.leds && j.info.leds.count + ' LED', state: { on: !!s.on, bri: Math.round(s.bri / 2.55), color: hex(col) } }; } catch (e) { return null; } }))).filter(Boolean);
  },
  async command(c, h, p) {
    const b = {}; if ('on' in p) b.on = !!p.on; if ('bri' in p) { b.bri = Math.max(1, Math.round(p.bri * 2.55)); b.on = true; }
    if (p.color) { const n = parseInt(p.color.slice(1), 16); b.seg = [{ col: [[n >> 16 & 255, n >> 8 & 255, n & 255]] }]; b.on = true; }
    if (Object.keys(b).length) await json('http://' + h + '/json/state', { method: 'POST', body: b, timeout: 4000 });
  }
};

// Onkyo, Pioneer et Integra — amplis home-cinéma et chaînes réseau, protocole local eISCP (port 60128) : marche, volume, source.
'use strict';
const net = require('net');
const hosts = c => String(c.hosts || '').split(/[\s,;]+/).map(h => h.replace(/^https?:\/\//, '').replace(/[:/].*$/, '')).filter(Boolean);
const pkt = cmd => { const d = Buffer.from('!1' + cmd + '\r'), h = Buffer.alloc(16); h.write('ISCP'); h.writeUInt32BE(16, 4); h.writeUInt32BE(d.length, 8); h[12] = 1; return Buffer.concat([h, d]); };
// envoie des commandes et lit les réponses (« PWR01 », « MVL28 »…) jusqu'à avoir celles qu'on attend
function talk(ip, cmds, want) {
  return new Promise((ok, ko) => {
    const s = net.connect({ host: ip, port: 60128 }), got = {}; let buf = Buffer.alloc(0);
    const end = e => { s.destroy(); e ? ko(e) : ok(got); };
    s.setTimeout(3000, () => Object.keys(got).length ? end() : end(new Error('ampli injoignable')));
    s.on('error', e => end(new Error('ampli injoignable (' + e.code + ')')));
    s.on('connect', () => cmds.forEach(x => s.write(pkt(x))));
    s.on('data', d => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 16 && buf.toString('latin1', 0, 4) === 'ISCP') {
        const hs = buf.readUInt32BE(4), ds = buf.readUInt32BE(8); if (buf.length < hs + ds) break;
        const m = buf.toString('latin1', hs, hs + ds).replace(/^!1/, '').replace(/[\x1a\r\n]+$/, ''); buf = buf.slice(hs + ds);
        got[m.slice(0, 3)] = m.slice(3);
      }
      if ((want || []).every(k => k in got)) end();
    });
  });
}
const SRC = { '10': 'BD/DVD', '01': 'Câble/Sat', '02': 'Jeux', '05': 'PC', '12': 'TV', '22': 'Phono', '23': 'CD', '24': 'FM', '2B': 'Réseau', '2E': 'Bluetooth', '29': 'USB', '80': 'HDMI 5' };
module.exports = {
  id: 'onkyo', name: 'Onkyo / Pioneer', poll: 8000, secrets: [],
  async test(c) { const h = hosts(c); if (!h.length) throw new Error('adresse IP manquante'); const r = await talk(h[0], ['PWRQSTN'], ['PWR']); return h.length + ' ampli(s) · ' + (r.PWR === '01' ? 'allumé' : 'en veille'); },
  async devices(c) {
    const out = [];
    for (const h of hosts(c)) {
      try { const r = await talk(h, ['PWRQSTN', 'MVLQSTN', 'SLIQSTN'], ['PWR', 'MVL', 'SLI']); out.push({ id: h, name: 'Ampli ' + h.split('.').pop(), kind: 'speaker', info: 'Onkyo / Pioneer (eISCP)', state: { on: r.PWR === '01', vol: r.MVL && r.MVL !== 'N/A' ? parseInt(r.MVL, 16) : 0, src: SRC[r.SLI] || r.SLI || '' } }); }
      catch (e) { out.push({ id: h, name: 'Ampli ' + h, kind: 'speaker', error: e.message, state: {} }); }
    }
    return out;
  },
  async command(c, id, p) {
    const l = [];
    if ('on' in p) l.push(p.on ? 'PWR01' : 'PWR00');
    if ('vol' in p) l.push('MVL' + ('0' + Math.max(0, Math.min(100, Math.round(p.vol))).toString(16).toUpperCase()).slice(-2));
    if ('muted' in p) l.push(p.muted ? 'AMT01' : 'AMT00');
    if (l.length) await talk(id, l, l.map(x => x.slice(0, 3))).catch(e => { if (!/injoignable/.test(e.message)) throw e; });
  },
  _pkt: pkt
};

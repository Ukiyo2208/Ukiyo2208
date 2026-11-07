// Tuya en local (protocoles 3.3 et 3.4) — Lidl Silvercrest, Moes, Nedis, Konyks, Blitzwolf, Avatto… sans cloud ni appli.
// Il faut une fois la « clé locale » de chaque appareil (compte développeur iot.tuya.com ou outil tinytuya wizard).
'use strict';
const net = require('net'), crypto = require('crypto');
const PRE = Buffer.from('000055aa', 'hex'), SUF = Buffer.from('0000aa55', 'hex');
const ecb = (k, d, enc) => { const c = (enc ? crypto.createCipheriv : crypto.createDecipheriv)('aes-128-ecb', k, null); return Buffer.concat([c.update(d), c.final()]); };
const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
const crc32 = b => { let c = ~0; for (const x of b) { c ^= x; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return (~c) >>> 0; };
function pack(v, seq, cmd, payload, key) {
  const tail = v === '3.4' ? 32 : 4, h = Buffer.alloc(16); PRE.copy(h); h.writeUInt32BE(seq, 4); h.writeUInt32BE(cmd, 8); h.writeUInt32BE(payload.length + tail + 4, 12);
  const body = Buffer.concat([h, payload]), check = v === '3.4' ? hmac(key, body) : (() => { const b = Buffer.alloc(4); b.writeUInt32BE(crc32(body)); return b; })();
  return Buffer.concat([body, check, SUF]);
}
function unpack(buf, v) {   // → [{ cmd, payload }], reste
  const out = []; let i;
  while ((i = buf.indexOf(PRE)) >= 0 && buf.length >= i + 16) {
    const len = buf.readUInt32BE(i + 12); if (buf.length < i + 16 + len) break;
    const cmd = buf.readUInt32BE(i + 8), tail = v === '3.4' ? 36 : 8; let pl = buf.slice(i + 16, i + 16 + len - tail);
    if (pl.length >= 4 && pl.readUInt32BE(0) < 256 && ((pl.length - 4) % 16 === 0 || /^3\.[34]/.test(pl.slice(4, 7).toString()))) pl = pl.slice(4);   // code retour
    out.push({ cmd, payload: pl }); buf = buf.slice(i + 16 + len);
  }
  return [out, buf];
}
const list = c => String(c.devices || '').split(/\n+/).map(l => l.split(/\s*[,;|]\s*/)).filter(x => x[0] && x[1] && x[2]).map(([ip, id, key, ver, ...n]) => ({ ip, id, key: Buffer.from(key, 'utf8'), ver: /3\.4/.test(ver || '') ? '3.4' : '3.3', name: n.join(' ') || ('Tuya ' + id.slice(-4)) }));
// une conversation : connexion, (négociation 3.4), une requête, réponse avec les « dps »
function talk(d, cmd, json) {
  return new Promise((ok, ko) => {
    const s = net.connect({ host: d.ip, port: 6668 }); let buf = Buffer.alloc(0), seq = 1, key = d.key, done = false;
    const local = crypto.randomBytes(16), end = (e, v) => { if (done) return; done = true; s.destroy(); e ? ko(e) : ok(v); };
    s.setTimeout(6000, () => end(new Error('appareil Tuya injoignable')));
    s.on('error', e => end(new Error('appareil Tuya injoignable (' + (e.code || e.message) + ')')));
    s.on('close', () => end(new Error('l’appareil a coupé la connexion (clé locale incorrecte, ou appli Tuya ouverte à côté)')));
    const sendMain = () => {
      const v = d.ver, body = Buffer.from(JSON.stringify(json));
      let pl;
      if (v === '3.4') { const raw = cmd === 0x0d ? Buffer.concat([Buffer.from('3.4'), Buffer.alloc(12), body]) : body; pl = ecb(key, raw, true); }
      else pl = cmd === 7 ? Buffer.concat([Buffer.from('3.3'), Buffer.alloc(12), ecb(key, body, true)]) : ecb(key, body, true);
      s.write(pack(v, seq++, cmd, pl, key));
    };
    s.on('connect', () => { if (d.ver === '3.4') s.write(pack('3.4', seq++, 3, ecb(d.key, local, true), d.key)); else sendMain(); });
    s.on('data', x => {
      let msgs; [msgs, buf] = unpack(Buffer.concat([buf, x]), d.ver);
      for (const m of msgs) {
        if (m.cmd === 4) {   // 3.4 : réponse de négociation → clé de session
          const p = ecb(d.key, m.payload, false), remote = p.slice(0, 16);
          if (!hmac(d.key, local).equals(p.slice(16, 48))) return end(new Error('clé locale Tuya incorrecte'));
          s.write(pack('3.4', seq++, 5, ecb(d.key, hmac(d.key, remote), true), d.key));
          const x2 = Buffer.alloc(16); for (let i = 0; i < 16; i++) x2[i] = local[i] ^ remote[i];
          const c2 = crypto.createCipheriv('aes-128-ecb', d.key, null); c2.setAutoPadding(false); key = c2.update(x2);
          sendMain(); continue;
        }
        if (!m.payload.length) { if (cmd === 7 || cmd === 0x0d) end(null, {}); continue; }
        try {
          let p = m.payload; if (/^3\.[34]/.test(p.slice(0, 3).toString())) p = p.slice(15);
          let t = ecb(key, p, false); if (/^3\.[34]/.test(t.slice(0, 3).toString())) t = t.slice(15);
          const j = JSON.parse(t.toString()); end(null, j.dps || (j.data && j.data.dps) || {});
        } catch (e) { end(new Error('clé locale Tuya incorrecte')); }
      }
    });
  });
}
const query = d => talk(d, d.ver === '3.4' ? 0x10 : 0x0a, d.ver === '3.4' ? {} : { gwId: d.id, devId: d.id, uid: d.id, t: String(Math.floor(Date.now() / 1000)), dps: {} });
const control = (d, dps) => talk(d, d.ver === '3.4' ? 0x0d : 7, d.ver === '3.4' ? { protocol: 5, t: Math.floor(Date.now() / 1000), data: { dps } } : { devId: d.id, uid: d.id, t: String(Math.floor(Date.now() / 1000)), dps });
function shape(d, dps) {
  if (typeof dps['20'] === 'boolean') return [{ id: d.id, name: d.name, kind: 'light', state: { on: dps['20'], bri: dps['22'] != null ? Math.round(dps['22'] / 10) : 100 } }];
  if (typeof dps['1'] === 'string' && /open|close|stop/.test(dps['1'])) return [{ id: d.id, name: d.name, kind: 'cover', state: { pos: dps['2'] != null ? 100 - dps['2'] : (dps['1'] === 'open' ? 100 : 0) } }];
  const sw = Object.keys(dps).filter(k => +k <= 7 && typeof dps[k] === 'boolean');
  return sw.map(k => ({ id: d.id + (sw.length > 1 ? '#' + k : ''), name: d.name + (sw.length > 1 ? ' ' + k : ''), kind: 'plug', state: { on: dps[k], w: dps['19'] != null ? Math.round(dps['19'] / 10) : undefined } }));
}
module.exports = {
  id: 'tuya', name: 'Tuya (local)', poll: 5000, secrets: ['devices'],
  async test(c) { const l = list(c); if (!l.length) throw new Error('aucun appareil saisi'); const r = await Promise.all(l.map(d => query(d).then(() => 1, e => d.name + ' : ' + e.message))); const bad = r.filter(x => x !== 1); if (bad.length === l.length) throw new Error(bad[0]); return (l.length - bad.length) + '/' + l.length + ' appareil(s) répondent' + (bad.length ? ' · ' + bad.join(' · ') : ''); },
  async devices(c) { return (await Promise.all(list(c).map(d => query(d).then(dps => shape(d, dps).map(x => Object.assign(x, { info: 'Tuya ' + d.ver + ' · ' + d.ip })), e => [{ id: d.id, name: d.name, kind: 'plug', error: e.message, state: {} }])))).flat(); },
  async command(c, id, p) {
    const [did, dp] = id.split('#'), d = list(c).find(x => x.id === did); if (!d) throw new Error('appareil Tuya inconnu');
    const dps = {};
    if ('pos' in p) dps['2'] = 100 - Math.round(p.pos); else if (p.moving === 'stop') dps['1'] = 'stop';
    if ('on' in p) { const cur = await query(d); dps[typeof cur['20'] === 'boolean' ? '20' : dp || '1'] = !!p.on; }
    if ('bri' in p) { dps['20'] = true; dps['22'] = Math.max(10, Math.round(p.bri * 10)); }
    await control(d, dps);
  },
  _test: { pack, unpack, ecb, hmac }
};

// Broadlink (RM mini, RM4, RM4 Pro…) — télécommandes infrarouges, protocole local chiffré (AES).
// On « apprend » un code en appuyant sur la vraie télécommande ; il devient un bouton dans Bêta home
// (allumer la TV ou la clim, monter le volume, changer de chaîne…). Fonctionne aussi pour les eRemote compatibles.
'use strict';
const dgram = require('dgram'), crypto = require('crypto');
const KEY0 = Buffer.from('097628343fe99e23765c1513accf8b02', 'hex'), IV = Buffer.from('562e17996d093d28ddb3ba695a2e6f58', 'hex');
const aes = (k, d, enc) => { const c = (enc ? crypto.createCipheriv : crypto.createDecipheriv)('aes-128-cbc', k, IV); c.setAutoPadding(false); return Buffer.concat([c.update(d), c.final()]); };
const pad16 = b => Buffer.concat([b, Buffer.alloc((16 - b.length % 16) % 16)]);
const sum = b => { let s = 0xbeaf; for (const x of b) s = (s + x) & 0xffff; return s; };
function udp(ip, pkt) {
  return new Promise((ok, ko) => {
    const s = dgram.createSocket('udp4'); let n = 0;
    const end = (e, v) => { clearInterval(t); try { s.close(); } catch (x) { } e ? ko(e) : ok(v); };
    s.on('message', m => end(null, m)); s.on('error', e => end(e));
    const t = setInterval(() => { if (n++ > 4) return end(new Error('télécommande injoignable')); s.send(pkt, 80, ip); }, 700); s.send(pkt, 80, ip);
  });
}
const devs = {};   // session par IP : { type, mac, id, key, count }
async function hello(ip) {
  const p = Buffer.alloc(0x30); const d = new Date();
  p.writeInt32LE(-d.getTimezoneOffset() / 60, 0x08); p.writeUInt16LE(d.getFullYear(), 0x0c); p[0x0e] = d.getMinutes(); p[0x0f] = d.getHours(); p[0x10] = d.getFullYear() % 100; p[0x11] = d.getDay(); p[0x12] = d.getDate(); p[0x13] = d.getMonth() + 1; p[0x26] = 6;
  p.writeUInt16LE(sum(p), 0x20);
  const r = await udp(ip, p);
  return { type: r.readUInt16LE(0x34), mac: r.slice(0x3a, 0x40) };
}
async function packet(ip, cmd, payload, key, s) {
  const p = Buffer.alloc(0x38); Buffer.from('5aa5aa555aa5aa55', 'hex').copy(p, 0);
  s.count = (s.count + 1) & 0xffff;
  p.writeUInt16LE(s.type, 0x24); p[0x26] = cmd; p.writeUInt16LE(s.count, 0x28); s.mac.copy(p, 0x2a); p.writeUInt32LE(s.id || 0, 0x30);
  const pl = pad16(payload); p.writeUInt16LE(sum(pl), 0x34);
  const full = Buffer.concat([p, aes(key, pl, true)]); full.writeUInt16LE(sum(full), 0x20);
  const r = await udp(ip, full); const err = r.readInt16LE(0x22);
  if (err) throw new Error(err === -7 ? 'aucun code reçu' : 'erreur Broadlink ' + err);
  return aes(key, r.slice(0x38), false);
}
async function session(ip) {
  if (devs[ip] && devs[ip].key) return devs[ip];
  const h = await hello(ip), s = devs[ip] = { type: h.type, mac: h.mac, id: 0, count: Math.floor(Math.random() * 0xffff), rm4: h.type >= 0x51da };
  const a = Buffer.alloc(0x50); a.fill(0x31, 0x04, 0x13); a[0x1e] = 1; a[0x2d] = 1; Buffer.from('Test  1').copy(a, 0x30);
  const r = await packet(ip, 0x65, a, KEY0, s); s.id = r.readUInt32LE(0); s.key = r.slice(4, 20);
  return s;
}
async function rm(ip, command, data) {
  const s = await session(ip), d = data || Buffer.alloc(0);
  const body = s.rm4 ? Buffer.concat([Buffer.from([0, 0]), Buffer.alloc(4), d]) : Buffer.concat([Buffer.alloc(4), d]);
  if (s.rm4) { body.writeUInt16LE(d.length + 4, 0); body.writeUInt32LE(command, 2); } else body.writeUInt32LE(command, 0);
  const r = await packet(ip, 0x6a, body, s.key, s);
  return r.slice(s.rm4 ? 6 : 4);
}
const ipOf = c => String(c.host || '').replace(/[:/].*$/, '');
const codes = c => (c.codes && typeof c.codes === 'object') ? c.codes : {};
module.exports = {
  id: 'broadlink', name: 'Broadlink', poll: 60000,
  actions: {
    // apprendre : on appuie sur la vraie télécommande dans les 20 s
    async learn(c, b) {
      const ip = ipOf({ host: b.host || c.host }), nm = String(b.codeName || '').trim();
      if (!ip) throw new Error('adresse IP manquante'); if (!nm) throw new Error('donnez un nom au bouton (ex. « TV marche »)');
      await rm(ip, 3);
      for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 1000));
        try { const d = await rm(ip, 4); const code = d.slice(0, d.length).toString('base64'); if (d.length > 4) return { host: ip, codes: Object.assign({}, codes(c), { [nm]: code }), info: '« ' + nm + ' » appris' }; } catch (e) { if (!/aucun code/.test(e.message)) throw e; }
      }
      throw new Error('aucun appui reçu en 20 s : visez la télécommande Broadlink et réessayez');
    },
    async forget(c, b) { const nm = String(b.codeName || '').trim(), cs = Object.assign({}, codes(c)); if (!cs[nm]) throw new Error('bouton « ' + nm + ' » inconnu'); delete cs[nm]; return { codes: cs }; }
  },
  async test(c) { const ip = ipOf(c); if (!ip) throw new Error('adresse IP manquante'); const s = await session(ip); return 'télécommande prête (type 0x' + s.type.toString(16) + ') · ' + Object.keys(codes(c)).length + ' bouton(s) appris'; },
  async devices(c) { return Object.keys(codes(c)).map(n => ({ id: n, name: n, kind: 'scene', info: 'Code infrarouge', state: {} })); },
  async command(c, id, p) {
    const code = codes(c)[id]; if (!code) throw new Error('bouton inconnu : apprenez-le d’abord');
    if (p.run || 'on' in p) await rm(ipOf(c), 2, Buffer.from(code, 'base64'));
  },
  _test: { aes, sum }
};

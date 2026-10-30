// Fire TV, Android TV, Google TV, Nvidia Shield — par le « débogage réseau » (ADB) : marche/veille, volume, lecture,
// lancement d'une appli. Autoriser une fois sur la TV la clé « beta-home ».
'use strict';
const net = require('net'), crypto = require('crypto');
const C = { CNXN: 0x4e584e43, AUTH: 0x48545541, OPEN: 0x4e45504f, OKAY: 0x59414b4f, WRTE: 0x45545257, CLSE: 0x45534c43 };
const SHA1 = Buffer.from('3021300906052b0e03021a05000414', 'hex');
function msg(cmd, a0, a1, data) {
  data = data || Buffer.alloc(0); const h = Buffer.alloc(24); let sum = 0; for (const x of data) sum = (sum + x) >>> 0;
  h.writeUInt32LE(cmd, 0); h.writeUInt32LE(a0 >>> 0, 4); h.writeUInt32LE(a1 >>> 0, 8); h.writeUInt32LE(data.length, 12); h.writeUInt32LE(sum, 16); h.writeUInt32LE((cmd ^ 0xffffffff) >>> 0, 20);
  return Buffer.concat([h, data]);
}
// clé publique au format Android (mincrypt) : n0inv, n et rr en mots de 32 bits petit-boutiste
function androidPub(pem) {
  const j = crypto.createPublicKey(pem).export({ format: 'jwk' }), big = b => BigInt('0x' + Buffer.from(b, 'base64url').toString('hex'));
  const n = big(j.n), e = Number(big(j.e)), W = 64n, M = 1n << 32n, words = x => { const b = Buffer.alloc(256); for (let i = 0; i < 64; i++) { b.writeUInt32LE(Number(x & (M - 1n)), i * 4); x >>= 32n; } return b; };
  let inv = 1n, n0 = n % M; for (let i = 0; i < 5; i++) inv = (inv * (2n - n0 * inv)) % M;   // Newton : n0⁻¹ mod 2³²
  const n0inv = Number((M - inv) % M), rr = (1n << 4096n) % n, h = Buffer.alloc(4), t = Buffer.alloc(4), x = Buffer.alloc(4);
  h.writeUInt32LE(Number(W)); t.writeUInt32LE(n0inv); x.writeUInt32LE(e);
  return Buffer.concat([h, t, words(n), words(rr), x]).toString('base64') + ' beta-home@bêta';
}
function shell(c, cmd, waitAuth) {
  return new Promise((ok, ko) => {
    const s = net.connect({ host: String(c.host).replace(/:\d+$/, ''), port: +(String(c.host).split(':')[1] || 5555) }); let buf = Buffer.alloc(0), out = [], sentSig = false, remote = 0, done = false;
    const end = (e, v) => { if (done) return; done = true; s.destroy(); e ? ko(e) : ok(v); };
    s.setTimeout(waitAuth ? 40000 : 8000, () => end(new Error(waitAuth ? 'acceptez « beta-home » sur la TV (Toujours autoriser) puis réessayez' : 'TV injoignable (débogage réseau activé ?)')));
    s.on('error', e => end(new Error('TV injoignable (' + (e.code || e.message) + ') : activez le débogage ADB réseau')));
    s.on('connect', () => s.write(msg(C.CNXN, 0x01000000, 256 * 1024, Buffer.from('host::\0'))));
    s.on('data', d => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 24) {
        const cmd = buf.readUInt32LE(0), a0 = buf.readUInt32LE(4), a1 = buf.readUInt32LE(8), len = buf.readUInt32LE(12); if (buf.length < 24 + len) return;
        const data = buf.slice(24, 24 + len); buf = buf.slice(24 + len);
        if (cmd === C.AUTH && a0 === 1) {
          if (!c.adbKey) return end(new Error('clé ADB absente : « Autoriser »'));
          if (!sentSig) { sentSig = true; s.write(msg(C.AUTH, 2, 0, crypto.privateEncrypt({ key: c.adbKey, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.concat([SHA1, data])))); }
          else if (waitAuth) s.write(msg(C.AUTH, 3, 0, Buffer.from(androidPub(c.adbKey) + '\0')));
          else end(new Error('clé refusée par la TV : refaites « Autoriser »'));
        } else if (cmd === C.CNXN) s.write(msg(C.OPEN, 1, 0, Buffer.from('shell:' + cmd + '\0')));
        else if (cmd === C.OKAY) remote = a0;
        else if (cmd === C.WRTE) { out.push(data); s.write(msg(C.OKAY, 1, a0)); }
        else if (cmd === C.CLSE) { s.write(msg(C.CLSE, 1, remote || a0)); end(null, Buffer.concat(out).toString()); }
      }
    });
  });
}
const KEY = { media_play_pause: 85, media_play: 126, media_pause: 127, media_next_track: 87, media_previous_track: 88, volume_mute: 164, media_stop: 86 };
const APPS = { netflix: 'com.netflix.ninja', youtube: 'com.amazon.firetv.youtube', prime: 'com.amazon.avod', disney: 'com.disney.disneyplus', plex: 'com.plexapp.android', molotov: 'tv.molotov.app', canal: 'com.canal.android.canal', spotify: 'com.spotify.tv.android' };
module.exports = {
  id: 'androidtv', name: 'Fire TV / Android TV', poll: 10000, secrets: ['adbKey'],
  actions: {
    async pair(c, b) {   // crée la clé (une fois) puis demande l'accord sur la TV
      const host = b.host || c.host; if (!host) throw new Error('adresse IP de la TV manquante');
      const adbKey = c.adbKey || crypto.generateKeyPairSync('rsa', { modulusLength: 2048, publicExponent: 65537 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
      await shell({ host, adbKey }, 'echo ok', true);
      return { host, adbKey, info: 'TV autorisée' };
    }
  },
  async test(c) { const m = await shell(c, 'getprop ro.product.model'); return m.trim() || 'Android TV'; },
  async devices(c) {
    if (!c.adbKey) return [];
    let on = false, app = ''; try { const p = await shell(c, 'dumpsys power | grep -m1 mWakefulness='); on = /Awake/.test(p); } catch (e) { return [{ id: 'tv', name: c.name || 'Fire TV', kind: 'tv', error: e.message, state: { on: false } }]; }
    if (on) { try { app = ((await shell(c, 'dumpsys window | grep -m1 mCurrentFocus')).match(/ ([\w.]+)\//) || [])[1] || ''; } catch (e) { } }
    return [{ id: 'tv', name: c.name || 'Fire TV', kind: 'tv', info: app ? 'Appli : ' + app : 'Android TV', state: { on, src: app } }];
  },
  async command(c, id, p, cur) {
    if ('on' in p) await shell(c, 'input keyevent ' + (p.on ? 224 : 223));
    if ('vol' in p) { const d = Math.round((p.vol - (cur.vol || 20)) / 5); if (d) await shell(c, Array(Math.min(10, Math.abs(d))).fill('input keyevent ' + (d > 0 ? 24 : 25)).join(';')); }
    if (p.cmd && KEY[p.cmd]) await shell(c, 'input keyevent ' + KEY[p.cmd]);
    const pkg = p.app && (APPS[String(p.app).toLowerCase()] || p.app); if (pkg && /^[\w.]+$/.test(pkg)) await shell(c, 'monkey -p ' + pkg + ' -c android.intent.category.LAUNCHER 1');
  },
  _test: { msg, androidPub, C }
};

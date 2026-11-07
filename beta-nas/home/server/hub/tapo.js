// TP-Link Tapo (et Kasa récents) — protocole local « KLAP » (AES), avec le compte TP-Link (e-mail + mot de passe).
// Prises, multiprises, ampoules et rubans Tapo. Les caméras Tapo passent par « Découvrir » (go2rtc).
'use strict';
const crypto = require('crypto'), http = require('http');
const hosts = c => String(c.hosts || '').split(/[\s,;]+/).map(h => h.replace(/[:/].*$/, '')).filter(Boolean);
const sha1 = b => crypto.createHash('sha1').update(b).digest(), sha256 = b => crypto.createHash('sha256').update(b).digest();
function post(ip, path, body, cookie) {
  return new Promise((ok, ko) => {
    const r = http.request({ host: ip, port: 80, path, method: 'POST', timeout: 5000, headers: Object.assign({ 'Content-Type': 'application/octet-stream', 'Content-Length': body.length }, cookie ? { Cookie: cookie } : {}) }, res => { const ch = []; res.on('data', c => ch.push(c)); res.on('end', () => ok({ status: res.statusCode, body: Buffer.concat(ch), cookie: (res.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ') })); });
    r.on('timeout', () => r.destroy(new Error('appareil injoignable'))); r.on('error', e => ko(new Error('appareil injoignable (' + (e.code || e.message) + ')'))); r.end(body);
  });
}
const sessions = {};
async function session(c, ip) {
  const s = sessions[ip]; if (s && Date.now() - s.at < 20 * 6e4) return s;
  const auth = sha256(Buffer.concat([sha1(Buffer.from(c.email || '')), sha1(Buffer.from(c.password || ''))]));
  const local = crypto.randomBytes(16), h1 = await post(ip, '/app/handshake1', local);
  if (h1.status !== 200 || h1.body.length < 48) throw new Error('appareil non compatible KLAP (HTTP ' + h1.status + ')');
  const remote = h1.body.slice(0, 16), srvHash = h1.body.slice(16, 48);
  if (!sha256(Buffer.concat([local, remote, auth])).equals(srvHash)) throw new Error('e-mail ou mot de passe TP-Link refusé');
  const h2 = await post(ip, '/app/handshake2', sha256(Buffer.concat([remote, local, auth])), h1.cookie);
  if (h2.status !== 200) throw new Error('appairage refusé (HTTP ' + h2.status + ')');
  const mat = Buffer.concat([local, remote, auth]), full = sha256(Buffer.concat([Buffer.from('iv'), mat]));
  return (sessions[ip] = { at: Date.now(), cookie: h1.cookie, key: sha256(Buffer.concat([Buffer.from('lsk'), mat])).slice(0, 16), iv: full.slice(0, 12), seq: full.readInt32BE(28), sig: sha256(Buffer.concat([Buffer.from('ldk'), mat])).slice(0, 28) });
}
async function call(c, ip, method, params) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const s = await session(c, ip); s.seq = (s.seq + 1) | 0;
    const sq = Buffer.alloc(4); sq.writeInt32BE(s.seq);
    const ci = crypto.createCipheriv('aes-128-cbc', s.key, Buffer.concat([s.iv, sq])), ct = Buffer.concat([ci.update(JSON.stringify(params ? { method, params } : { method })), ci.final()]);
    const r = await post(ip, '/app/request?seq=' + s.seq, Buffer.concat([sha256(Buffer.concat([s.sig, sq, ct])), ct]), s.cookie);
    if (r.status !== 200) { delete sessions[ip]; continue; }
    const de = crypto.createDecipheriv('aes-128-cbc', s.key, Buffer.concat([s.iv, sq])), j = JSON.parse(Buffer.concat([de.update(r.body.slice(32)), de.final()]).toString());
    if (j.error_code) throw new Error('erreur Tapo ' + j.error_code); return j.result || {};
  }
  throw new Error('session refusée');
}
const name = i => { try { return Buffer.from(i.nickname || '', 'base64').toString() || i.model; } catch (e) { return i.model; } };
const hsvHex = (h, s) => { s /= 100; const f = n => { const k = (n + h / 60) % 6; return ('0' + Math.round((1 - s * Math.max(0, Math.min(k, 4 - k, 1))) * 255).toString(16)).slice(-2); }; return '#' + f(5) + f(3) + f(1); };
const hexHsv = hex => { const n = parseInt(hex.slice(1), 16), r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255, mx = Math.max(r, g, b), d = mx - Math.min(r, g, b); let h = 0; if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return { hue: Math.round((h * 60 + 360) % 360), saturation: Math.round(mx ? d / mx * 100 : 0) }; };
module.exports = {
  id: 'tapo', name: 'TP-Link Tapo', poll: 5000, secrets: ['password'],
  async test(c) { if (!c.email || !c.password) throw new Error('e-mail et mot de passe du compte TP-Link nécessaires'); const hs = hosts(c); if (!hs.length) throw new Error('adresse IP manquante'); const r = await Promise.all(hs.map(h => call(c, h, 'get_device_info').then(name, e => '⚠ ' + h + ' : ' + e.message))); if (r.every(x => x.startsWith('⚠'))) throw new Error(r.join(' · ')); return r.length + ' appareil(s) : ' + r.join(', '); },
  async devices(c) {
    return (await Promise.all(hosts(c).map(h => call(c, h, 'get_device_info').then(i => { const bulb = /BULB/i.test(i.type || '') || i.brightness != null, color = i.hue != null;
      return { id: h, name: name(i), kind: bulb ? (color ? 'rgb' : 'light') : 'plug', info: i.model, state: Object.assign({ on: !!i.device_on }, bulb ? { bri: i.brightness } : {}, color && !i.color_temp ? { color: hsvHex(i.hue, i.saturation) } : {}) }; }, () => null)))).filter(Boolean);
  },
  async command(c, h, p) {
    const q = {}; if ('on' in p) q.device_on = !!p.on; if ('bri' in p) { q.brightness = Math.max(1, Math.round(p.bri)); q.device_on = true; }
    if (p.color) Object.assign(q, hexHsv(p.color), { color_temp: 0, device_on: true });
    if (Object.keys(q).length) await call(c, h, 'set_device_info', q);
  },
  _test: { sessions }
};

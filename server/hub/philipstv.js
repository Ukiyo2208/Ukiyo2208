// TV Philips (Android TV, 2016 et +) — API locale « JointSpace » v6 (https 1926), appairage par code PIN affiché sur la TV.
'use strict';
const https = require('https'), crypto = require('crypto');
const host = c => String(c.host || '').replace(/^https?:\/\//, '').replace(/[:/].*$/, '');
// clé publique de l'API JointSpace (identique pour toutes les TV, publiée dans la documentation communautaire)
const SECRET = Buffer.from('ZmVay1EQVFOaZhwQ4Kv81ypLAZNczV9sG4KkseXWn1NEk6cXmPKO/MCa9sryslvLCFMnNe4Z4CPXzToowvhHvA==', 'base64');
const DEVICE = id => ({ device_name: 'beta-home', device_os: 'Android', app_id: 'org.betahome', app_name: 'Bêta home', type: 'native', id });
function raw(ip, path, body, auth) {
  return new Promise((ok, ko) => {
    const data = body == null ? null : JSON.stringify(body);
    const r = https.request({ host: ip, port: 1926, path, method: data ? 'POST' : 'GET', rejectUnauthorized: false, timeout: 6000, headers: Object.assign({ 'Content-Type': 'application/json' }, data ? { 'Content-Length': Buffer.byteLength(data) } : {}, auth ? { Authorization: auth } : {}) }, res => { let t = ''; res.setEncoding('utf8'); res.on('data', c => t += c); res.on('end', () => ok({ status: res.statusCode, text: t, www: res.headers['www-authenticate'] || '' })); });
    r.on('timeout', () => r.destroy(new Error('TV injoignable'))); r.on('error', e => ko(new Error('TV injoignable (' + (e.code || e.message) + ')'))); if (data) r.write(data); r.end();
  });
}
// authentification « Digest » (MD5) demandée par la TV
async function call(c, path, body) {
  const ip = host(c), first = await raw(ip, path, body);
  if (first.status !== 401) return first;
  const p = {}; first.www.replace(/(\w+)="?([^",]+)"?/g, (m, k, v) => { p[k] = v; });
  const md5 = s => crypto.createHash('md5').update(s).digest('hex'), nc = '00000001', cn = crypto.randomBytes(8).toString('hex'), method = body == null ? 'GET' : 'POST';
  const ha1 = md5(c.deviceId + ':' + p.realm + ':' + c.authKey), ha2 = md5(method + ':' + path), resp = p.qop ? md5([ha1, p.nonce, nc, cn, 'auth', ha2].join(':')) : md5([ha1, p.nonce, ha2].join(':'));
  return raw(ip, path, body, 'Digest username="' + c.deviceId + '", realm="' + p.realm + '", nonce="' + p.nonce + '", uri="' + path + '", response="' + resp + '"' + (p.qop ? ', qop=auth, nc=' + nc + ', cnonce="' + cn + '"' : '') + (p.opaque ? ', opaque="' + p.opaque + '"' : ''));
}
const j = r => { try { return JSON.parse(r.text); } catch (e) { return {}; } };
const KEYS = { media_play_pause: 'PlayPause', media_play: 'Play', media_pause: 'Pause', media_next_track: 'FastForward', media_previous_track: 'Rewind', volume_mute: 'Mute' };
module.exports = {
  id: 'philipstv', name: 'TV Philips', poll: 5000, secrets: ['authKey'],
  actions: {
    async pin(c, b) {   // étape 1 : la TV affiche un code
      const ip = host({ host: b.host || c.host }); if (!ip) throw new Error('adresse IP de la TV manquante');
      const id = crypto.randomBytes(8).toString('hex'), r = j(await raw(ip, '/6/pair/request', { scope: ['read', 'write', 'control'], device: DEVICE(id) }));
      if (!r.auth_key) throw new Error('la TV refuse l’appairage (Android TV Philips 2016 et + seulement)');
      return { host: ip, deviceId: id, authKey: r.auth_key, pairTs: r.timestamp, info: 'Code affiché sur la TV : saisissez-le puis « Valider le code »' };
    },
    async grant(c, b) {  // étape 2 : on renvoie le code avec la signature
      const pin = String(b.pinCode || '').trim(); if (!pin) throw new Error('saisissez le code affiché sur la TV');
      const sig = Buffer.from(crypto.createHmac('sha1', SECRET).update(String(c.pairTs) + pin).digest('hex')).toString('base64');
      const r = await call(c, '/6/pair/grant', { auth: { auth_AppId: '1', pin, auth_timestamp: c.pairTs, auth_signature: sig }, device: DEVICE(c.deviceId) });
      if (r.status !== 200) throw new Error('code refusé, recommencez « Afficher le code »'); return { status: 'ok', info: 'TV appairée' };
    }
  },
  async test(c) { if (!c.authKey) throw new Error('TV non appairée'); const s = j(await call(c, '/6/system')); return (s.name || 'TV Philips') + (s.model ? ' (' + s.model + ')' : ''); },
  async devices(c) {
    if (!c.authKey) return []; const [sys, pw, vol] = await Promise.all([call(c, '/6/system').then(j), call(c, '/6/powerstate').then(j).catch(() => ({})), call(c, '/6/audio/volume').then(j).catch(() => ({}))]);
    return [{ id: 'tv', name: sys.name || 'TV Philips', kind: 'tv', info: sys.model, state: { on: pw.powerstate === 'On', vol: vol.max ? Math.round(vol.current / vol.max * 100) : 0 } }];
  },
  async command(c, id, p) {
    if ('on' in p) await call(c, '/6/powerstate', { powerstate: p.on ? 'On' : 'Standby' });
    if ('vol' in p) { const v = j(await call(c, '/6/audio/volume')); await call(c, '/6/audio/volume', { current: Math.round((v.max || 60) * p.vol / 100), muted: false }); }
    if (p.cmd && KEYS[p.cmd]) await call(c, '/6/input/key', { key: KEYS[p.cmd] });
  }
};

// TV Philips (Android TV / Google TV) — API locale JointSpace v6 (https://IP:1926), appairage par code PIN affiché
// sur la TV. Les TV Philips non Android utilisent la même API sans appairage (http://IP:1925).
'use strict';
const crypto = require('crypto');
const { request } = require('./net');

// clé partagée publique de l'appairage JointSpace (identique pour toutes les TV Philips)
const SHARED = Buffer.from('ZmVay1EQVFOaZhwQ4Kv81ypLAZNczV9sG4KkseXWn1NEk6cXmPKO/MCa9sryslvLCFMnNe4Z4CPXzToowvhHvA==', 'base64');
const md5 = s => crypto.createHash('md5').update(s).digest('hex');
const host = c => String(c.host || '').replace(/^https?:\/\//, '').replace(/[:/].*$/, '');
const device = id => ({ device_name: 'Bêta OS', device_os: 'Android', app_id: 'beta.os', app_name: 'Bêta OS', type: 'native', id });
const pend = {};   // appairages en cours : hôte → { id, auth_key, timestamp }

// requête avec authentification « digest » (utilisateur = identifiant d'appareil, mot de passe = clé d'appairage)
async function digest(url, user, pass, o) {
  o = Object.assign({ insecure: true, raw: true, timeout: 8000 }, o);
  let r = await request(url, o);
  if (r.status === 401 && user) {
    const h = String(r.headers['www-authenticate'] || ''), g = k => (h.match(new RegExp(k + '="?([^",]+)"?')) || [])[1];
    const realm = g('realm'), nonce = g('nonce'), qop = g('qop') ? 'auth' : '', uri = new URL(url).pathname, nc = '00000001', cnonce = crypto.randomBytes(8).toString('hex');
    const ha1 = md5(user + ':' + realm + ':' + pass), ha2 = md5((o.method || (o.body != null ? 'POST' : 'GET')) + ':' + uri);
    const resp = qop ? md5([ha1, nonce, nc, cnonce, qop, ha2].join(':')) : md5([ha1, nonce, ha2].join(':'));
    o.headers = Object.assign({}, o.headers, { Authorization: 'Digest username="' + user + '", realm="' + realm + '", nonce="' + nonce + '", uri="' + uri + '", response="' + resp + '"' + (qop ? ', qop=' + qop + ', nc=' + nc + ', cnonce="' + cnonce + '"' : '') });
    r = await request(url, o);
  }
  if (r.status === 401) throw new Error('TV non appairée (refait l’appairage)');
  if (r.status >= 300) throw new Error('TV : HTTP ' + r.status);
  return r.json() || {};
}
const api = (c, path, body) => c.key ? digest('https://' + host(c) + ':1926/6/' + path, c.devId, c.key, body !== undefined ? { body } : {}) : digest('http://' + host(c) + ':1925/6/' + path, null, null, body !== undefined ? { body } : {});

module.exports = {
  id: 'philipstv', name: 'TV Philips', poll: 5000, secrets: ['key'],
  actions: {
    // 1er clic : la TV affiche un code ; 2e clic avec le code : appairage terminé
    async pair(c, b) {
      const h = host({ host: b.host || c.host }); if (!h) throw new Error('adresse IP de la TV manquante');
      if (!b.pin || !pend[h]) {
        const id = crypto.randomBytes(8).toString('hex');
        const r = await request('https://' + h + ':1926/6/pair/request', { insecure: true, timeout: 8000, body: { scope: ['read', 'write', 'control'], device: device(id) } }).catch(e => { throw new Error(/ECONNREFUSED/.test(e.message) ? 'cette TV n’a pas besoin d’appairage : enregistrez simplement son adresse' : e.message); });
        const j = r.json() || {};
        if (j.error_id !== 'SUCCESS') throw new Error('la TV refuse l’appairage (' + (j.error_id || r.status) + ')');
        pend[h] = { id, key: j.auth_key, ts: j.timestamp };
        throw new Error('un code s’affiche sur la TV : saisissez-le puis cliquez à nouveau « Appairer »');
      }
      const p = pend[h], pin = String(b.pin).trim();
      const sig = crypto.createHmac('sha1', SHARED).update(String(p.ts) + pin).digest('hex');
      await digest('https://' + h + ':1926/6/pair/grant', p.id, p.key, { body: { auth: { auth_AppId: '1', pin, auth_timestamp: p.ts, auth_signature: sig }, device: device(p.id) } })
        .catch(e => { delete pend[h]; throw new Error(/HTTP 4/.test(e.message) ? 'code incorrect : cliquez « Appairer » pour avoir un nouveau code' : e.message); });
      delete pend[h];
      return { host: h, devId: p.id, key: p.key, status: 'ok', info: 'TV appairée' };
    }
  },
  async test(c) {
    if (!host(c)) throw new Error('adresse IP de la TV manquante');
    const s = await api(c, 'system').catch(e => { throw new Error(c.key ? e.message : 'TV injoignable : si c’est une Android TV, cliquez d’abord « Appairer »'); });
    return (s.name || 'TV Philips') + (s.model ? ' · ' + s.model : '');
  },
  async devices(c) {
    if (!host(c)) return [];
    let s = {}, on = false, vol = {};
    try { s = await api(c, 'system'); } catch (e) { return [{ id: host(c), name: c.name || 'TV Philips', kind: 'tv', info: 'hors ligne', state: { on: false } }]; }
    try { on = (await api(c, 'powerstate')).powerstate === 'On'; } catch (e) { on = true; }
    try { vol = await api(c, 'audio/volume'); } catch (e) { }
    const st = { on };
    if (vol.max) st.vol = Math.round((vol.current || 0) * 100 / vol.max);
    return [{ id: host(c), name: s.name || 'TV Philips', kind: 'tv', info: 'Philips ' + (s.model || ''), state: st }];
  },
  async command(c, id, p) {
    if ('on' in p) { try { await api(c, 'powerstate', { powerstate: p.on ? 'On' : 'Standby' }); } catch (e) { await api(c, 'input/key', { key: 'Standby' }); } }
    if ('vol' in p) { const v = await api(c, 'audio/volume'); await api(c, 'audio/volume', { muted: false, current: Math.round(Math.max(0, Math.min(100, +p.vol)) * (v.max || 60) / 100) }); }
  }
};

// Requêtes HTTP avec authentification « Digest » (caméras Hikvision, Dahua, Amcrest…), en simple ou en flux continu.
'use strict';
const http = require('http'), https = require('https'), crypto = require('crypto');
const md5 = s => crypto.createHash('md5').update(s).digest('hex');
function raw(u, o, auth) {
  return new Promise((ok, ko) => {
    const lib = u.protocol === 'https:' ? https : http, body = o.body == null ? null : typeof o.body === 'string' ? o.body : JSON.stringify(o.body);
    const r = lib.request(u, { method: o.method || (body ? 'POST' : 'GET'), rejectUnauthorized: false, timeout: o.stream ? 0 : (o.timeout || 8000), headers: Object.assign({}, o.headers, body ? { 'Content-Length': Buffer.byteLength(body) } : {}, auth ? { Authorization: auth } : {}) }, ok);
    r.on('timeout', () => r.destroy(new Error('appareil injoignable'))); r.on('error', e => ko(new Error('appareil injoignable (' + (e.code || e.message) + ')')));
    if (body) r.write(body); r.end();
  });
}
const read = res => new Promise(ok => { const ch = []; res.on('data', c => ch.push(c)); res.on('end', () => ok(Buffer.concat(ch).toString('utf8'))); });
// o : { user, pass, method, body, headers, stream } — stream : renvoie la réponse sans la lire (flux d'évènements)
async function request(url, o) {
  o = o || {}; const u = new URL(url);
  let res = await raw(u, o);
  if (res.statusCode === 401 && o.user != null) {
    const h = String(res.headers['www-authenticate'] || ''); res.resume();
    let auth;
    if (/^Digest/i.test(h)) {
      const p = {}; h.replace(/(\w+)="?([^",]+)"?/g, (m, k, v) => { p[k] = v; });
      const nc = '00000001', cn = crypto.randomBytes(8).toString('hex'), path = u.pathname + u.search, ha1 = md5(o.user + ':' + p.realm + ':' + o.pass), ha2 = md5((o.method || (o.body != null ? 'POST' : 'GET')) + ':' + path);
      const qop = p.qop ? 'auth' : '', resp = qop ? md5([ha1, p.nonce, nc, cn, qop, ha2].join(':')) : md5([ha1, p.nonce, ha2].join(':'));
      auth = 'Digest username="' + o.user + '", realm="' + p.realm + '", nonce="' + p.nonce + '", uri="' + path + '", response="' + resp + '"' + (qop ? ', qop=auth, nc=' + nc + ', cnonce="' + cn + '"' : '') + (p.opaque ? ', opaque="' + p.opaque + '"' : '') + (p.algorithm ? ', algorithm=' + p.algorithm : '');
    } else auth = 'Basic ' + Buffer.from(o.user + ':' + o.pass).toString('base64');
    res = await raw(u, o, auth);
  }
  if (res.statusCode === 401) { res.resume(); throw new Error('identifiant ou mot de passe refusé'); }
  if (o.stream) return res;
  const text = await read(res);
  if (res.statusCode >= 400) throw new Error('HTTP ' + res.statusCode);
  return text;
}
// flux d'évènements tenu ouvert en permanence, reconnecté tout seul ; onChunk(texte)
function keepStream(url, o, onChunk, state) {
  if (state.on) return; state.on = true;
  const go = async () => {
    try {
      const res = await request(url, Object.assign({}, o, { stream: true }));
      state.err = ''; res.setEncoding('utf8'); res.on('data', onChunk);
      res.on('end', () => setTimeout(go, 3000)); res.on('error', () => setTimeout(go, 5000));
    } catch (e) { state.err = e.message; setTimeout(go, 15000); }
  };
  go();
}
module.exports = { request, keepStream };

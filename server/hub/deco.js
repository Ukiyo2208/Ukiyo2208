// TP-Link Deco (Wi-Fi maillé) — API locale de l'interface web de la borne principale :
// bornes (en ligne, firmware, IP), appareils connectés (Wi-Fi 2,4/5 GHz, câble, débit), IP internet, qui est à la maison.
// Connexion : adresse de la borne principale + mot de passe administrateur (celui de l'app Deco / compte TP-Link).
// Le protocole chiffre chaque requête (clé RSA donnée par la borne + AES-CBC), comme l'interface web.
'use strict';
const crypto = require('crypto');
const { request } = require('./net');
const root = c => 'http://' + String(c.host || '192.168.68.1').replace(/^https?:\/\//, '').replace(/\/+$/, '');
const S = {}, sk = c => root(c) + '|' + crypto.createHash('md5').update(String(c.password)).digest('hex');   // sessions par borne (et mot de passe) : { stok, cookie, key, iv, seq, sign:[n,e], hash, at }
const digits = n => Array.from({ length: n }, () => crypto.randomInt(0, 10)).join('');
// chiffrement RSA PKCS#1 v1.5 par blocs (taille de clé - 11 octets), résultat en hexadécimal
function rsa(nHex, eHex, text) {
  const b64 = h => Buffer.from(h.length % 2 ? '0' + h : h, 'hex').toString('base64url');
  const key = crypto.createPublicKey({ key: { kty: 'RSA', n: b64(nHex), e: b64(eHex) }, format: 'jwk' }), size = Math.ceil(nHex.length / 2) - 11, buf = Buffer.from(text);
  let out = ''; for (let i = 0; i < buf.length; i += size) out += crypto.publicEncrypt({ key, padding: crypto.constants.RSA_PKCS1_PADDING }, buf.subarray(i, i + size)).toString('hex');
  return out;
}
const aesEnc = (s, text) => { const c = crypto.createCipheriv('aes-128-cbc', Buffer.from(s.key), Buffer.from(s.iv)); return Buffer.concat([c.update(text), c.final()]).toString('base64'); };
const aesDec = (s, b64) => { const d = crypto.createDecipheriv('aes-128-cbc', Buffer.from(s.key), Buffer.from(s.iv)); return Buffer.concat([d.update(Buffer.from(b64, 'base64')), d.final()]).toString(); };
const form = o => Object.keys(o).map(k => k + '=' + encodeURIComponent(o[k])).join('&');
async function plain(c, path) {   // étapes de connexion non chiffrées : clés publiques
  const r = await request(root(c) + '/cgi-bin/luci/;stok=' + path, { body: 'operation=read', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 8000 });
  const j = r.json(); if (!j || j.error_code) throw new Error('Deco : réponse inattendue'); return j.result;
}
async function enc(c, s, path, body) {
  const data = aesEnc(s, JSON.stringify(body)), sign = rsa(s.sign[0], s.sign[1], 'k=' + s.key + '&i=' + s.iv + '&h=' + s.hash + '&s=' + (s.seq + data.length));
  const r = await request(root(c) + '/cgi-bin/luci/;stok=' + (s.stok || '') + path, { body: form({ sign, data }), headers: Object.assign({ 'Content-Type': 'application/x-www-form-urlencoded' }, s.cookie ? { Cookie: s.cookie } : {}), raw: true, timeout: 10000 });
  if (r.status === 401 || r.status === 403) { const e = new Error('session expirée'); e.auth = true; throw e; }
  const j = r.json(); if (!j || !j.data) throw new Error('Deco : HTTP ' + r.status);
  const out = JSON.parse(aesDec(s, j.data));
  if (out.error_code && out.error_code !== 0) { const e = new Error(out.error_code === -5002 || out.error_code === -5001 ? 'mot de passe refusé par le Deco' : 'Deco : erreur ' + out.error_code); e.auth = /-500/.test(String(out.error_code)); throw e; }
  return { out, headers: r.headers };
}
async function login(c) {
  if (!c.password) throw new Error('mot de passe administrateur du Deco requis');
  const pw = (await plain(c, '/login?form=keys')).password, au = await plain(c, '/login?form=auth');
  const s = { key: digits(16), iv: digits(16), seq: +au.seq, sign: au.key, hash: crypto.createHash('md5').update('admin' + c.password).digest('hex'), stok: '' };
  const { out, headers } = await enc(c, s, '/login?form=login', { params: { password: rsa(pw[0], pw[1], c.password) }, operation: 'login' });
  s.stok = out.result.stok; s.cookie = (headers['set-cookie'] || []).map(x => x.split(';')[0]).join('; '); s.at = Date.now();
  return (S[sk(c)] = s);
}
async function call(c, path, body) {
  for (let i = 0; i < 2; i++) {
    const s = S[sk(c)] && Date.now() - S[sk(c)].at < 50 * 6e4 ? S[sk(c)] : await login(c);
    try { return (await enc(c, s, path, body)).out.result; } catch (e) { if (e.auth && i === 0) { delete S[sk(c)]; continue; } throw e; }
  }
}
const b64name = v => { try { const t = Buffer.from(String(v || ''), 'base64').toString('utf8'); return /^[\x20-\x7e -￿]+$/.test(t) && t.length ? t : v; } catch (e) { return v; } };
const watched = c => String(c.presence || '').split(/[,;\n]+/).map(x => x.trim().toLowerCase()).filter(Boolean);
async function clients(c) { const r = await call(c, '/admin/client?form=client_list', { operation: 'read', params: { device_mac: 'default' } }); return (r.client_list || []).map(x => ({ name: b64name(x.name), mac: String(x.mac || '').toLowerCase().replace(/-/g, ':'), ip: x.ip, online: x.online !== false, link: x.wire_type === 'wired' || x.connection_type === 'wired' ? 'ethernet' : 'wifi', band: { band2_4: '2,4 GHz', band5: '5 GHz', band6: '6 GHz' }[x.connection_type] || '', guest: x.interface === 'guest', down: +x.down_speed || 0, up: +x.up_speed || 0, type: x.client_type || '', ap: x.access_host || '' })); }
module.exports = {
  id: 'deco', name: 'TP-Link Deco', poll: 20000, secrets: ['password'],
  actions: {
    async reboot(c) { const nodes = (await call(c, '/admin/device?form=device_list', { operation: 'read' })).device_list || []; await call(c, '/admin/device?form=system', { operation: 'reboot', params: { mac_list: nodes.map(n => ({ mac: n.mac })) } }); return { info: 'Redémarrage des bornes Deco demandé' }; }
  },
  async test(c) { const n = (await call(c, '/admin/device?form=device_list', { operation: 'read' })).device_list || [], cl = await clients(c); return n.length + ' borne(s), ' + cl.filter(x => x.online).length + ' appareil(s) connecté(s)'; },
  async devices(c) {
    const cl = await clients(c), out = [];
    watched(c).forEach(n => { const x = cl.find(y => (y.name || '').toLowerCase() === n || y.mac === n.replace(/-/g, ':')); out.push({ id: 'p:' + n, name: 'Présence ' + (x ? x.name : n), kind: 'motion', info: x ? 'Connecté au Wi-Fi Deco' : 'Appareil introuvable', state: { on: !!(x && x.online) } }); });
    return out;
  },
  async info(c) {
    const [dl, cl, wan, perf] = await Promise.all([call(c, '/admin/device?form=device_list', { operation: 'read' }), clients(c), call(c, '/admin/network?form=wan_ipv4', { operation: 'read' }).catch(() => null), call(c, '/admin/network?form=performance', { operation: 'read' }).catch(() => null)]);
    const nodes = (dl.device_list || []).map(n => ({ name: b64name(n.custom_nickname || n.nickname) || n.device_model, model: n.device_model, ip: n.device_ip, mac: n.mac, role: n.role === 'master' ? 'principale' : 'satellite', online: (n.inet_status || n.group_status || 'online') !== 'offline' && n.group_status !== 'disconnected', fw: n.software_ver, signal: n.signal_level || null }));
    const w = (wan && (wan.wan || {}).ip_info) || {}, m = nodes.find(n => n.role === 'principale') || nodes[0] || {};
    return { box: { name: 'TP-Link Deco', model: m.model, firmware: m.fw, wan: { state: (dl.device_list || []).some(n => n.inet_status === 'online') ? 'connecté' : 'inconnu', ip: w.ip || '', gateway: w.gateway || '', dns: [w.dns1, w.dns2].filter(Boolean).join(', ') }, cpu: perf ? Math.round((perf.cpu_usage || 0) * 100) : null, mem: perf ? Math.round((perf.mem_usage || 0) * 100) : null }, nodes, clients: cl, actions: ['reboot'] };
  },
  async command() { },
  _crypto: { rsa, aesEnc, aesDec }
};

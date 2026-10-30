// Bbox (Bouygues) — API locale : qui est à la maison (appareils connectés), Wi-Fi marche/arrêt (mot de passe de la box).
'use strict';
const { request } = require('./net');
const root = c => 'https://' + String(c.host || 'mabbox.bytel.fr').replace(/^https?:\/\//, '').replace(/\/+$/, '') + '/api/v1';
let cookie = '';
async function auth(c) {
  if (cookie) return cookie;
  if (!c.password) throw new Error('mot de passe de la Bbox requis pour le Wi-Fi');
  const r = await request(root(c) + '/login', { insecure: true, raw: true, form: { password: c.password, remember: 1 } });
  cookie = (r.headers['set-cookie'] || []).map(x => x.split(';')[0]).join('; '); if (!cookie) throw new Error('mot de passe de la Bbox refusé'); return cookie;
}
const get = async (c, p) => (await request(root(c) + p, { insecure: true, timeout: 8000, headers: cookie ? { Cookie: cookie } : {} })).json();
const watched = c => String(c.presence || '').split(/[,;\n]+/).map(x => x.trim().toLowerCase()).filter(Boolean);
module.exports = {
  id: 'bbox', name: 'Bbox', poll: 15000, secrets: ['password'],
  async test(c) { const h = (await get(c, '/hosts'))[0].hosts.list; return h.filter(x => x.active).length + ' appareil(s) connecté(s)'; },
  async devices(c) {
    const h = (await get(c, '/hosts'))[0].hosts.list, out = [];
    if (c.password) { try { await auth(c); const w = (await get(c, '/wireless'))[0].wireless; out.push({ id: 'wifi', name: 'Wi-Fi Bbox', kind: 'plug', info: 'Couper / remettre le Wi-Fi', state: { on: w.radio && w.radio['24'] ? !!w.radio['24'].enable : !!w.status } }); } catch (e) { cookie = ''; } }
    watched(c).forEach(n => { const x = h.find(y => (y.hostname || '').toLowerCase() === n || (y.macaddress || '').toLowerCase() === n); out.push({ id: 'p:' + n, name: 'Présence ' + (x ? x.hostname : n), kind: 'motion', info: x ? 'Connecté au réseau de la maison' : 'Appareil introuvable', state: { on: !!(x && x.active) } }); });
    return out;
  },
  async command(c, id, p) {
    if (id !== 'wifi' || !('on' in p)) return;
    await auth(c); const t = (await get(c, '/device/token'))[0].device.token;
    await request(root(c) + '/wireless?btoken=' + t, { insecure: true, method: 'PUT', headers: { Cookie: cookie }, form: { 'radio.enable': p.on ? 1 : 0 } });
  }
};

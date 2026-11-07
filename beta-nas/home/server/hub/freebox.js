// Freebox (Free) — API locale officielle : qui est à la maison (téléphones connectés), Wi-Fi marche/arrêt.
// Appairage : « Autoriser » puis appuyer sur la flèche › de l'écran de la Freebox Server.
'use strict';
const crypto = require('crypto');
const { request } = require('./net');
const APP = { app_id: 'fr.betahome', app_name: 'Bêta home', app_version: '1.0', device_name: 'Serveur Bêta' };
const root = c => 'http://' + String(c.host || 'mafreebox.freebox.fr').replace(/^https?:\/\//, '').replace(/\/+$/, '');
const S = {};
async function call(c, path, o) {
  o = o || {};
  const r = await request(root(c) + '/api/v8' + path, Object.assign({ raw: true, timeout: 8000 }, o));
  const j = r.json(); if (!j) throw new Error('Freebox injoignable');
  if (!j.success) { const e = new Error(j.msg || j.error_code || 'erreur Freebox'); e.code = j.error_code; throw e; }
  return j.result;
}
async function session(c) {
  if (S[c.appToken] && Date.now() - S[c.appToken].at < 20 * 6e4) return S[c.appToken].tok;
  if (!c.appToken) throw new Error('Freebox non appairée : « Autoriser »');
  const ch = await call(c, '/login/'), password = crypto.createHmac('sha1', c.appToken).update(ch.challenge).digest('hex');
  const s = await call(c, '/login/session/', { body: { app_id: APP.app_id, password } });
  S[c.appToken] = { tok: s.session_token, at: Date.now() }; return s.session_token;
}
async function api(c, path, o) {
  for (let i = 0; i < 2; i++) {
    const t = await session(c);
    try { return await call(c, path, Object.assign({}, o, { headers: { 'X-Fbx-App-Auth': t } })); }
    catch (e) { if (e.code === 'auth_required' || e.code === 'invalid_session') { delete S[c.appToken]; continue; } if (e.code === 'insufficient_rights') throw new Error('droit manquant : Freebox OS › Paramètres › Gestion des accès › Applications › Bêta home › cochez « Modification des réglages »'); throw e; }
  }
}
const watched = c => String(c.presence || '').split(/[,;\n]+/).map(x => x.trim().toLowerCase()).filter(Boolean);
module.exports = {
  id: 'freebox', name: 'Freebox', poll: 15000, secrets: ['appToken'],
  actions: {
    async pair(c) {
      const r = await call(c, '/login/authorize/', { body: APP });
      for (let i = 0; i < 45; i++) {
        await new Promise(ok => setTimeout(ok, 2000));
        const s = await call(c, '/login/authorize/' + r.track_id);
        if (s.status === 'granted') return { appToken: r.app_token, info: 'Freebox appairée' };
        if (s.status === 'denied' || s.status === 'timeout') throw new Error('refusé sur la Freebox (ou délai dépassé)');
      }
      throw new Error('appuyez sur la flèche › de l’écran de la Freebox pour autoriser Bêta home');
    }
  },
  async test(c) { const h = await api(c, '/lan/browser/pub/'); return h.filter(x => x.active).length + ' appareil(s) connecté(s)'; },
  async devices(c) {
    const [hosts, wifi] = await Promise.all([api(c, '/lan/browser/pub/'), api(c, '/wifi/config/').catch(() => null)]), w = watched(c), out = [];
    if (wifi) out.push({ id: 'wifi', name: 'Wi-Fi Freebox', kind: 'plug', info: 'Couper / remettre le Wi-Fi', state: { on: !!wifi.enabled } });
    w.forEach(n => {
      const h = hosts.find(x => (x.primary_name || '').toLowerCase() === n || ((x.l2ident || {}).id || '').toLowerCase() === n);
      out.push({ id: 'p:' + n, name: 'Présence ' + (h ? h.primary_name : n), kind: 'motion', info: h ? 'Connecté au réseau de la maison' : 'Appareil introuvable', state: { on: !!(h && h.active) } });
    });
    return out;
  },
  async info(c) {
    const [cn, sys, hosts, wifi] = await Promise.all([api(c, '/connection/'), api(c, '/system/').catch(() => ({})), api(c, '/lan/browser/pub/'), api(c, '/wifi/config/').catch(() => null)]);
    const mb = v => v != null ? Math.round(+v / 125000) : null;   // octets/s → Mbit/s
    return { box: { name: 'Freebox', model: sys.board_name || sys.model_info && sys.model_info.pretty_name || 'Freebox', firmware: sys.firmware_version || '', uptime: +sys.uptime_val || null,
      wan: { state: cn.state === 'up' ? 'connecté' : cn.state, type: cn.media === 'ftth' ? 'Fibre' : cn.media === 'xdsl' ? 'ADSL/VDSL' : cn.media || '', ip: cn.ipv4 || '', ip6: cn.ipv6 || '', down: mb(cn.rate_down), up: mb(cn.rate_up), maxDown: cn.bandwidth_down ? Math.round(cn.bandwidth_down / 1e6) : null, maxUp: cn.bandwidth_up ? Math.round(cn.bandwidth_up / 1e6) : null },
      wifi: wifi ? { on: !!wifi.enabled } : null },
      clients: hosts.map(h => { const ap = (h.access_point || {}), wl = ap.type === 'wifi'; return { name: h.primary_name || (h.l2ident || {}).id, ip: ((h.l3connectivities || []).find(x => x.af === 'ipv4') || {}).addr || '', mac: String((h.l2ident || {}).id || '').toLowerCase(), online: !!h.active, link: wl ? 'wifi' : 'ethernet', band: wl ? (((ap.wifi_information || {}).band || '').replace('2d4g', '2,4 GHz').replace('5g', '5 GHz')) : '', type: h.host_type || '' }; }), actions: [] };
  },
  async command(c, id, p) { if (id === 'wifi' && 'on' in p) await api(c, '/wifi/config/', { method: 'PUT', body: { enabled: !!p.on } }); }
};

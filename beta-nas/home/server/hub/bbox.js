// Bbox (Bouygues Telecom) — API locale : état de la ligne (fibre/ADSL), débits, IP, appareils connectés,
// qui est à la maison, Wi-Fi marche/arrêt et redémarrage (mot de passe administrateur de la box).
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
  // Wi-Fi invités (nom, mot de passe, marche/arrêt) et blocage d'un appareil (contrôle parental)
  async guest(c) { await auth(c); const g = (await get(c, '/wireless/guest'))[0] || {}, e = (await get(c, '/wireless/guestenable'))[0] || {}, w = g.wireless || g; return { ssid: (w.guest || w).ssid || w.ssid || '', pass: (w.guest || w).passphrase || w.passphrase || '', on: !!(((e.wireless || e).guestenable || e).enable != null ? +((e.wireless || e).guestenable || e).enable : 0) }; },
  async guestSet(c, on) { await auth(c); const t = (await get(c, '/device/token'))[0].device.token; await request(root(c) + '/wireless/guestenable?btoken=' + t, { insecure: true, method: 'PUT', headers: { Cookie: cookie }, form: { enable: on ? 1 : 0 } }); },
  async block(c, mac, on) {
    await auth(c); const h = (await get(c, '/hosts'))[0].hosts.list.find(x => String(x.macaddress || '').toLowerCase() === String(mac).toLowerCase()); if (!h) throw new Error('appareil inconnu de la Bbox : ' + mac);
    const t = (await get(c, '/device/token'))[0].device.token;
    await request(root(c) + '/hosts/' + h.id + '?btoken=' + t, { insecure: true, method: 'PUT', headers: { Cookie: cookie }, form: { blocked: on ? 1 : 0 } });
  },
  actions: {
    async reboot(c) { await auth(c); const t = (await get(c, '/device/token'))[0].device.token; await request(root(c) + '/device/reboot?btoken=' + t, { insecure: true, method: 'POST', headers: { Cookie: cookie }, body: '' }); return { info: 'Redémarrage de la Bbox demandé' }; }
  },
  async info(c) {
    if (c.password) { try { await auth(c); } catch (e) { cookie = ''; } }
    const q = p => get(c, p).then(r => (Array.isArray(r) ? r[0] : r) || {}).catch(() => ({}));
    const [dev, ip, st, ftth, xdsl, hosts, wl] = await Promise.all([q('/device'), q('/wan/ip'), q('/wan/ip/stats'), q('/wan/ftth'), q('/wan/xdsl'), q('/hosts'), q('/wireless')]);
    const d = dev.device || {}, w = (ip.wan || {}), xs = (xdsl.wan || {}).xdsl || {}, fb = (ftth.wan || {}).ftth || {}, stats = (((st.wan || {}).ip || {}).stats) || {}, wi = wl.wireless || {};
    const fibre = !!(fb.state || (w.link || {}).type === 'FTTH'), kb = v => v != null && !isNaN(v) ? Math.round(+v / 1000) : null;   // kbit/s → Mbit/s
    return {
      box: { name: 'Bbox', model: d.modelname || d.modelclass || 'Bbox', firmware: (d.main || {}).version || '', uptime: +d.uptime || null, serial: d.serialnumber || '',
        wan: { state: ((w.internet || {}).state === 2 || (w.ip || {}).state === 'Up') ? 'connecté' : (w.ip || {}).state || 'inconnu', type: fibre ? 'Fibre' : xs.state ? 'ADSL/VDSL' + (xs.modulation ? ' (' + xs.modulation + ')' : '') : '', ip: (w.ip || {}).address || '', ip6: (((w.ip || {}).ip6address || [])[0] || {}).ipaddress || '',
          syncDown: fibre ? null : kb((xs.down || {}).bitrates), syncUp: fibre ? null : kb((xs.up || {}).bitrates), down: kb((stats.rx || {}).bandwidth), up: kb((stats.tx || {}).bandwidth), maxDown: kb((stats.rx || {}).maxBandwidth), maxUp: kb((stats.tx || {}).maxBandwidth) },
        wifi: wi.radio ? { on: !!(wi.radio['24'] || {}).enable || !!(wi.radio['5'] || {}).enable, ssid: ((wi.ssid || {})['24'] || {}).id || ((wi.ssid || {})['5'] || {}).id || '' } : null },
      clients: (((hosts.hosts || {}).list) || []).map(h => ({ name: h.hostname || h.macaddress, ip: h.ipaddress, mac: String(h.macaddress || '').toLowerCase(), online: !!h.active, link: /wifi/i.test(h.link || '') ? 'wifi' : 'ethernet', band: /5/.test(h.link || '') && /wifi/i.test(h.link || '') ? '5 GHz' : /wifi/i.test(h.link || '') ? '2,4 GHz' : '', type: h.devicetype || '', last: h.lastseen || null })),
      actions: c.password ? ['reboot'] : []
    };
  },
  async command(c, id, p) {
    if (id !== 'wifi' || !('on' in p)) return;
    await auth(c); const t = (await get(c, '/device/token'))[0].device.token;
    await request(root(c) + '/wireless?btoken=' + t, { insecure: true, method: 'PUT', headers: { Cookie: cookie }, form: { 'radio.enable': p.on ? 1 : 0 } });
  }
};

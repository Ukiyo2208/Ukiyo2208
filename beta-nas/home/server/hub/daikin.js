// Daikin — climatisations avec adaptateur Wi-Fi local (BRP069…, API HTTP /aircon/…). Sans compte.
'use strict';
const { request } = require('./net');
const hosts = c => String(c.hosts || '').split(/[\s,;]+/).map(h => h.replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter(Boolean);
const kv = t => { const o = {}; String(t).split(',').forEach(p => { const i = p.indexOf('='); if (i > 0) o[p.slice(0, i)] = decodeURIComponent(p.slice(i + 1)); }); return o; };
const get = async (h, p) => { const o = kv((await request('http://' + h + p, { timeout: 5000 })).text); if (o.ret && o.ret !== 'OK') throw new Error('réponse ' + o.ret + ' (adaptateur récent à clé : non pris en charge)'); return o; };
const MODE = { 0: 'Auto', 1: 'Auto', 7: 'Auto', 2: 'Sec', 3: 'Froid', 4: 'Chaud', 6: 'Ventilation' }, MODEI = { 'Auto': 1, 'Chaud/froid': 1, 'Sec': 2, 'Froid': 3, 'Chaud': 4, 'Ventilation': 6 };
module.exports = {
  id: 'daikin', name: 'Daikin', poll: 6000,
  async test(c) { const hs = hosts(c); if (!hs.length) throw new Error('adresse IP manquante'); const r = await Promise.all(hs.map(h => get(h, '/common/basic_info').then(i => i.name || h, e => '⚠ ' + h + ' : ' + e.message))); if (r.every(x => x.startsWith('⚠'))) throw new Error(r.join(' · ')); return r.length + ' clim(s) : ' + r.join(', '); },
  async devices(c) {
    return (await Promise.all(hosts(c).map(async h => { try {
      const [b, ci, si] = await Promise.all([get(h, '/common/basic_info'), get(h, '/aircon/get_control_info'), get(h, '/aircon/get_sensor_info').catch(() => ({}))]);
      return { id: h, name: b.name || 'Clim ' + h, kind: 'clim', state: { on: ci.pow === '1', temp: parseFloat(ci.stemp) || 21, hvac: MODE[ci.mode] || 'Auto', cur: si.htemp ? parseFloat(si.htemp) : undefined, modes: ['Auto', 'Chaud', 'Froid', 'Sec', 'Ventilation'] } };
    } catch (e) { return null; } }))).filter(Boolean);
  },
  async command(c, h, p) {
    const ci = await get(h, '/aircon/get_control_info'), o = { pow: ci.pow, mode: ci.mode, stemp: ci.stemp, shum: ci.shum || '0', f_rate: ci.f_rate || 'A', f_dir: ci.f_dir || '0' };
    if ('on' in p) o.pow = p.on ? '1' : '0';
    if (p.hvac === 'Arrêt') o.pow = '0'; else if (p.hvac && MODEI[p.hvac] != null) { o.mode = String(MODEI[p.hvac]); o.pow = '1'; }
    if ('temp' in p) { o.stemp = (+p.temp).toFixed(1); o.pow = '1'; }
    if (o.mode === '2' || o.mode === '6') o.stemp = ci['dt' + o.mode] || '--';   // sec / ventilation : pas de consigne
    await request('http://' + h + '/aircon/set_control_info?' + new URLSearchParams(o), { timeout: 5000 });
  }
};

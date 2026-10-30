// Jeedom — tous les équipements de la box domotique française, en local avec la clé API (Réglages › Système › Configuration › API).
// Les commandes sont reconnues par leur « type générique » Jeedom (Outils › Types génériques), comme pour l'application mobile.
'use strict';
const { json } = require('./net');
const api = c => { const h = String(c.host || '').trim().replace(/\/+$/, ''); return (/^https?:/.test(h) ? h : 'http://' + h) + '/core/api/jeeApi.php'; };
const q = (c, o) => api(c) + '?' + new URLSearchParams(Object.assign({ apikey: c.apikey || '' }, o)).toString();
const CMDS = {};   // équipement → identifiants de ses commandes (allumer, éteindre, curseur…), gardés entre deux relevés
const val = x => { const v = x.state !== undefined ? x.state : x.currentValue !== undefined ? x.currentValue : x.value; return v === '' || v == null ? null : v; };
function map(eq, room) {
  const g = {}; (eq.cmds || []).forEach(x => { if (x.generic_type && !g[x.generic_type]) g[x.generic_type] = x; });
  const id = String(eq.id), v = k => g[k] ? val(g[k]) : null, ids = k => g[k] && g[k].id, o = [], b = { room, info: 'Jeedom · ' + (eq.eqType_name || '') };
  CMDS[id] = { on: ids('LIGHT_ON') || ids('ENERGY_ON'), off: ids('LIGHT_OFF') || ids('ENERGY_OFF'), slider: ids('LIGHT_SLIDER') || ids('FLAP_SLIDER'), color: ids('LIGHT_SET_COLOR'), up: ids('FLAP_UP'), down: ids('FLAP_DOWN'), stop: ids('FLAP_STOP'), setpoint: ids('THERMOSTAT_SET_SETPOINT'), lock: ids('LOCK_CLOSE'), unlock: ids('LOCK_OPEN'), max: g.LIGHT_SLIDER && g.LIGHT_SLIDER.configuration && +g.LIGHT_SLIDER.configuration.maxValue || 99 };
  if (g.LIGHT_STATE || g.LIGHT_ON) { const s = v('LIGHT_STATE'), n = s == null ? null : +s; o.push(Object.assign({ id, name: eq.name, kind: g.LIGHT_SET_COLOR ? 'rgb' : 'light', state: { on: n == null ? false : n > 0, bri: n != null && n > 1 ? Math.round(n / CMDS[id].max * 100) : undefined, color: v('LIGHT_COLOR') || undefined } }, b)); }
  else if (g.FLAP_STATE || g.FLAP_UP) o.push(Object.assign({ id, name: eq.name, kind: 'cover', state: { pos: Math.round(+v('FLAP_STATE') || 0) } }, b));
  else if (g.THERMOSTAT_SETPOINT || g.THERMOSTAT_SET_SETPOINT) o.push(Object.assign({ id, name: eq.name, kind: 'clim', state: { on: true, temp: +v('THERMOSTAT_SETPOINT') || 19, cur: v('THERMOSTAT_TEMPERATURE') != null ? +v('THERMOSTAT_TEMPERATURE') : undefined, modes: ['Auto'] } }, b));
  else if (g.LOCK_STATE) o.push(Object.assign({ id, name: eq.name, kind: 'lock', state: { locked: +v('LOCK_STATE') === 1 } }, b));
  else if (g.ENERGY_STATE || g.ENERGY_ON) o.push(Object.assign({ id, name: eq.name, kind: 'plug', state: { on: +v('ENERGY_STATE') > 0 } }, b));
  if (g.TEMPERATURE) o.push(Object.assign({ id: id + '|t', name: eq.name + ' — température', kind: 'temp', state: { val: +v('TEMPERATURE'), unit: '°C' } }, b));
  if (g.HUMIDITY) o.push(Object.assign({ id: id + '|h', name: eq.name + ' — humidité', kind: 'hum', state: { val: +v('HUMIDITY'), unit: '%' } }, b));
  if (g.POWER) o.push(Object.assign({ id: id + '|w', name: eq.name + ' — consommation', kind: 'meter', state: { val: Math.round(+v('POWER') || 0), unit: 'W' } }, b));
  if (g.PRESENCE) o.push(Object.assign({ id: id + '|m', name: eq.name, kind: 'motion', state: { on: +v('PRESENCE') > 0 } }, b));
  // ouvertures : convention Jeedom 1 = fermé, 0 = ouvert
  const op = g.OPENING || g.OPENING_WINDOW; if (op) o.push(Object.assign({ id: id + '|c', name: eq.name, kind: 'door', state: { on: +val(op) === 0 } }, b));
  if (g.FLOOD) o.push(Object.assign({ id: id + '|l', name: eq.name, kind: 'leak', state: { on: +v('FLOOD') > 0 } }, b));
  return o;
}
async function full(c) { const r = await json(q(c, { type: 'fullData' }), { timeout: 15000 }); if (!Array.isArray(r)) throw new Error(r && r.error ? 'Jeedom : ' + (r.error.message || r.error) : 'réponse Jeedom inattendue (clé API ?)'); return r; }
const run = (c, cmd, extra) => cmd ? json(q(c, Object.assign({ type: 'cmd', id: cmd }, extra || {})), { timeout: 8000 }) : Promise.reject(new Error('commande absente dans Jeedom (type générique)'));
module.exports = {
  id: 'jeedom', name: 'Jeedom', poll: 8000, secrets: ['apikey'],
  async test(c) { const r = await full(c); return r.reduce((n, o) => n + (o.eqLogics || []).filter(e => +e.isEnable).length, 0) + ' équipement(s) dans ' + r.length + ' objet(s)'; },
  async devices(c) { return (await full(c)).flatMap(o => (o.eqLogics || []).filter(e => +e.isEnable !== 0).flatMap(e => map(e, o.name || ''))); },
  async command(c, id, p) {
    if (id.includes('|')) return;
    if (!CMDS[id]) await module.exports.devices(c);
    const k = CMDS[id] || {};
    if ('bri' in p && k.slider) await run(c, k.slider, { slider: Math.round(p.bri / 100 * (k.max || 99)) });
    else if ('on' in p) await run(c, p.on ? k.on : k.off);
    if (p.color && k.color) await run(c, k.color, { color: p.color });
    if ('pos' in p) { if (k.slider) await run(c, k.slider, { slider: Math.round(p.pos) }); else await run(c, p.pos > 0 ? k.up : k.down); }
    if (p.moving === 'stop') await run(c, k.stop);
    if ('temp' in p) await run(c, k.setpoint, { slider: +p.temp });
    if ('locked' in p) await run(c, p.locked ? k.lock : k.unlock);
  },
  _map: map
};

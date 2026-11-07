// Home Assistant (facultatif) — pour que le serveur Bêta du NAS pilote aussi les appareils de Home Assistant :
// règles « Si… alors… », scènes, chauffage, alarme, arrosage, Siri… fonctionnent alors avec ou sans Home Assistant.
// Adresse de Home Assistant + jeton d'accès longue durée (profil › Sécurité).
'use strict';
const { request } = require('./net');
const base = c => String(c.url || '').trim().replace(/\/+$/, '');
const H = c => ({ Authorization: 'Bearer ' + c.token });
async function api(c, path, body) { if (!base(c) || !c.token) throw new Error('adresse et jeton de Home Assistant requis'); return (await request(base(c) + path, { headers: H(c), body, insecure: true, timeout: 10000 })).json(); }
const DOM = ['light', 'switch', 'input_boolean', 'fan', 'cover', 'climate', 'lock', 'vacuum', 'media_player', 'valve', 'binary_sensor', 'sensor', 'water_heater', 'humidifier', 'lawn_mower', 'scene', 'script'];
function kind(s) {
  const [d] = s.entity_id.split('.'), a = s.attributes || {}, dc = a.device_class || '';
  if (d === 'light') return (a.supported_color_modes || []).some(m => /rgb|hs|xy/.test(m)) ? 'rgb' : 'light';
  if (d === 'switch' || d === 'input_boolean') return dc === 'outlet' ? 'plug' : 'switch';
  if (d === 'cover') return dc === 'garage' || dc === 'gate' ? 'garage' : dc === 'awning' ? 'awning' : 'cover';
  if (d === 'climate') return 'clim'; if (d === 'water_heater') return 'heater';
  if (d === 'binary_sensor') return /door|window|opening|garage_door/.test(dc) ? 'door' : /motion|occupancy|presence/.test(dc) ? 'motion' : dc === 'moisture' ? 'leak' : 'door';
  if (d === 'sensor') return dc === 'temperature' ? 'temp' : dc === 'humidity' ? 'hum' : dc === 'carbon_dioxide' ? 'co2' : dc === 'power' ? 'power' : 'meter';
  if (d === 'lawn_mower') return 'mower';
  return { fan: 'fan', lock: 'lock', vacuum: 'vacuum', media_player: 'media', valve: 'valve', humidifier: 'fan', scene: 'scene', script: 'scene' }[d] || 'switch';
}
function state(s) {
  const a = s.attributes || {}, d = s.entity_id.split('.')[0], o = { on: ['on', 'open', 'opening', 'playing', 'heat', 'cool', 'auto', 'heat_cool', 'dry', 'fan_only', 'cleaning', 'mowing', 'unlocked'].includes(s.state) };
  if (a.brightness != null) o.bri = Math.round(a.brightness / 2.55);
  if (a.color_temp_kelvin) o.ct = a.color_temp_kelvin;
  if (a.rgb_color) o.color = '#' + a.rgb_color.map(v => ('0' + (+v).toString(16)).slice(-2)).join('');
  if (d === 'cover' || d === 'valve') { o.pos = a.current_position != null ? a.current_position : s.state === 'open' ? 100 : 0; o.on = o.pos > 0; }
  if (d === 'climate' || d === 'water_heater') { o.temp = a.temperature; o.cur = a.current_temperature; o.hvac = s.state; o.on = s.state !== 'off'; }
  if (d === 'lock') o.locked = s.state === 'locked';
  if (d === 'vacuum' || d === 'lawn_mower') { o.status = s.state === 'cleaning' || s.state === 'mowing' ? (d === 'vacuum' ? 'cleaning' : 'mowing') : 'docked'; if (a.battery_level != null) o.bat = a.battery_level; }
  if (d === 'sensor') { const v = parseFloat(s.state); o.val = isNaN(v) ? null : v; if (a.device_class === 'power' && !isNaN(v)) o.w = /kW/.test(a.unit_of_measurement || '') ? v * 1000 : v; delete o.on; }
  if (a.battery_level != null) o.bat = a.battery_level; else if (a.battery != null) o.bat = a.battery;
  if (s.state === 'unavailable') o.unavailable = true;
  return o;
}
module.exports = {
  id: 'homeassistant', name: 'Home Assistant', poll: 4000, secrets: ['token'],
  async test(c) { const st = await api(c, '/api/states'); return st.length + ' entités · ' + ((await api(c, '/api/config').catch(() => ({}))).version || ''); },
  async devices(c) { return (await api(c, '/api/states')).filter(s => DOM.includes(s.entity_id.split('.')[0])).map(s => ({ id: s.entity_id, name: (s.attributes || {}).friendly_name || s.entity_id, kind: kind(s), info: 'Home Assistant', state: state(s) })); },
  async command(c, id, p) {
    const d = id.split('.')[0], call = (svc, data, dom) => api(c, '/api/services/' + (dom || d) + '/' + svc, Object.assign({ entity_id: id }, data || {}));
    if (d === 'scene' || d === 'script') return call('turn_on');
    if (d === 'cover' || d === 'valve') { if ('pos' in p) return p.pos >= 100 ? call('open_' + d) : p.pos <= 0 ? call('close_' + d) : call('set_' + d + '_position', { position: Math.round(p.pos) }); if (p.moving === 'stop') return call('stop_' + d); if ('on' in p) return call(p.on ? 'open_' + d : 'close_' + d); return; }
    if (d === 'lock') return 'locked' in p ? call(p.locked ? 'lock' : 'unlock') : undefined;
    if (d === 'vacuum') return call(p.status === 'cleaning' ? 'start' : 'return_to_base');
    if (d === 'lawn_mower') return call(p.status === 'mowing' ? 'start_mowing' : 'dock');
    if (d === 'climate' || d === 'water_heater') {
      if (p.on === false) return call('turn_off');
      if ('temp' in p) { if (d === 'climate' && p.hvac) await call('set_hvac_mode', { hvac_mode: p.hvac }); return call('set_temperature', { temperature: p.temp }); }
      return p.on ? call('turn_on') : undefined;
    }
    if (d === 'light') {
      if (p.on === false) return call('turn_off');
      const data = {}; if (p.bri != null) data.brightness_pct = Math.round(p.bri); if (p.ct) data.color_temp_kelvin = Math.round(p.ct); if (p.color) data.rgb_color = [1, 3, 5].map(i => parseInt(p.color.slice(i, i + 2), 16));
      return call('turn_on', data);
    }
    if (d === 'media_player' && 'vol' in p) return call('volume_set', { volume_level: p.vol / 100 });
    if ('on' in p) return call(p.on ? 'turn_on' : 'turn_off', null, d === 'binary_sensor' || d === 'sensor' ? 'homeassistant' : d);
  }
};

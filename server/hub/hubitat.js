// Hubitat Elevation — tous les appareils de la box (Zigbee, Z-Wave…) par l'application « Maker API », en local.
'use strict';
const { json, request } = require('./net');
const base = c => { const h = String(c.host || '').trim().replace(/\/+$/, ''); return (/^https?:/.test(h) ? h : 'http://' + h) + '/apps/api/' + String(c.appId || '').trim(); };
const tk = c => 'access_token=' + encodeURIComponent(c.token || '');
// Maker API : attributs en objet (récent) ou en liste [{ name, currentValue }] (ancien)
const attrs = d => Array.isArray(d.attributes) ? Object.fromEntries(d.attributes.map(a => [a.name, a.currentValue])) : (d.attributes || {});
const caps = d => (d.capabilities || []).map(x => typeof x === 'string' ? x : x.name || '').filter(Boolean);
function map(d) {
  const a = attrs(d), cp = caps(d), has = k => cp.includes(k), o = [], b = { info: 'Hubitat · ' + (d.type || ''), room: d.room || '' }, name = d.label || d.name;
  if (has('WindowShade') || has('WindowBlind')) o.push(Object.assign({ id: String(d.id), name, kind: 'cover', state: { pos: +a.position || (a.windowShade === 'open' ? 100 : 0) } }, b));
  else if (has('Lock')) o.push(Object.assign({ id: String(d.id), name, kind: 'lock', state: { locked: a.lock === 'locked' } }, b));
  else if (has('Thermostat') || has('ThermostatHeatingSetpoint')) o.push(Object.assign({ id: String(d.id), name, kind: 'clim', state: { on: a.thermostatMode !== 'off', temp: +(a.heatingSetpoint || a.thermostatSetpoint) || 20, cur: a.temperature != null ? +a.temperature : undefined, modes: ['Auto', 'Chaud', 'Froid', 'Arrêt'] } }, b));
  else if (has('Switch') && (has('SwitchLevel') || has('ColorControl') || /light|bulb|dimmer/i.test(d.type || ''))) o.push(Object.assign({ id: String(d.id), name, kind: has('ColorControl') ? 'rgb' : 'light', state: { on: a.switch === 'on', bri: a.level != null ? +a.level : undefined } }, b));
  else if (has('Switch')) o.push(Object.assign({ id: String(d.id), name, kind: 'plug', state: { on: a.switch === 'on' } }, b));
  if (has('TemperatureMeasurement') && !o.some(x => x.kind === 'clim')) o.push(Object.assign({ id: d.id + '|t', name: name + ' — température', kind: 'temp', state: { val: +a.temperature, unit: '°C' } }, b));
  if (has('RelativeHumidityMeasurement')) o.push(Object.assign({ id: d.id + '|h', name: name + ' — humidité', kind: 'hum', state: { val: +a.humidity, unit: '%' } }, b));
  if (has('PowerMeter')) o.push(Object.assign({ id: d.id + '|w', name: name + ' — consommation', kind: 'meter', state: { val: Math.round(+a.power || 0), unit: 'W' } }, b));
  if (has('MotionSensor')) o.push(Object.assign({ id: d.id + '|m', name, kind: 'motion', state: { on: a.motion === 'active' } }, b));
  if (has('ContactSensor')) o.push(Object.assign({ id: d.id + '|c', name, kind: 'door', state: { on: a.contact === 'open' } }, b));
  if (has('WaterSensor')) o.push(Object.assign({ id: d.id + '|l', name, kind: 'leak', state: { on: a.water === 'wet' } }, b));
  return o;
}
const cmd = (c, id, ...x) => request(base(c) + '/devices/' + id + '/' + x.map(encodeURIComponent).join('/') + '?' + tk(c), { timeout: 8000 });
module.exports = {
  id: 'hubitat', name: 'Hubitat', poll: 6000, secrets: ['token'],
  async test(c) { const l = await json(base(c) + '/devices?' + tk(c), { timeout: 8000 }); return l.length + ' appareil(s) partagé(s) dans Maker API'; },
  async devices(c) { return (await json(base(c) + '/devices/all?' + tk(c), { timeout: 10000 })).flatMap(map); },
  async command(c, id, p) {
    if (id.includes('|')) return;
    if ('bri' in p) await cmd(c, id, 'setLevel', Math.round(p.bri));
    else if ('on' in p) await cmd(c, id, p.on ? 'on' : 'off');
    if ('pos' in p) await cmd(c, id, 'setPosition', Math.round(p.pos));
    if (p.moving === 'stop') await cmd(c, id, 'stopPositionChange').catch(() => { });
    if ('locked' in p) await cmd(c, id, p.locked ? 'lock' : 'unlock');
    if ('temp' in p) await cmd(c, id, 'setHeatingSetpoint', +p.temp);
    if (p.hvac) await cmd(c, id, 'setThermostatMode', { Auto: 'auto', Chaud: 'heat', Froid: 'cool', Arrêt: 'off' }[p.hvac] || 'auto');
  },
  _map: map
};

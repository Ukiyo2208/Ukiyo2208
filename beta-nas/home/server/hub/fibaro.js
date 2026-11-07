// Fibaro Home Center 2 / 3 / Lite et Yubii Home — tous les appareils Z-Wave de la box, par son API REST locale.
'use strict';
const { json, request } = require('./net');
const base = c => { const h = String(c.host || '').trim().replace(/\/+$/, ''); return (/^https?:/.test(h) ? h : 'http://' + h) + '/api/'; };
const H = c => ({ Authorization: 'Basic ' + Buffer.from((c.user || 'admin') + ':' + (c.password || '')).toString('base64') });
const v = d => d.properties ? d.properties.value : undefined;
const T = (d, re) => re.test(d.type || '') || re.test(d.baseType || '');
function map(d, room) {
  const id = String(d.id), b = { room, info: 'Fibaro · ' + String(d.type || '').replace('com.fibaro.', '') }, x = v(d), on = x === true || x === 'true' || +x > 0;
  if (T(d, /rollerShutter|remoteBaseShutter|FGRM/i)) return [Object.assign({ id, name: d.name, kind: 'cover', state: { pos: Math.round(+x || 0) } }, b)];
  if (T(d, /doorLock/i)) return [Object.assign({ id, name: d.name, kind: 'lock', state: { locked: !!(d.properties && (d.properties.secured || on)) } }, b)];
  if (T(d, /hvac|thermostat/i)) return [Object.assign({ id, name: d.name, kind: 'clim', state: { on: (d.properties || {}).thermostatMode !== 'Off', temp: +((d.properties || {}).heatingThermostatSetpoint || x) || 20, modes: ['Auto'] } }, b)];
  if (T(d, /colorController|RGBW/i)) return [Object.assign({ id, name: d.name, kind: 'rgb', state: { on, bri: Math.round(+x || 0) } }, b)];
  if (T(d, /multilevelSwitch|dimmer|FGD/i)) return [Object.assign({ id, name: d.name, kind: 'light', state: { on, bri: Math.round(+x || 0) } }, b)];
  if (T(d, /binarySwitch|FGWP|FGS/i)) return [Object.assign({ id, name: d.name, kind: /lum|lamp|light|éclair/i.test(d.name) ? 'light' : 'plug', state: { on } }, b)];
  if (T(d, /temperatureSensor/i)) return [Object.assign({ id, name: d.name, kind: 'temp', state: { val: +x, unit: '°C' } }, b)];
  if (T(d, /humiditySensor/i)) return [Object.assign({ id, name: d.name, kind: 'hum', state: { val: +x, unit: '%' } }, b)];
  if (T(d, /doorSensor|windowSensor|doorWindowSensor/i)) return [Object.assign({ id, name: d.name, kind: 'door', state: { on } }, b)];
  if (T(d, /motionSensor/i)) return [Object.assign({ id, name: d.name, kind: 'motion', state: { on } }, b)];
  if (T(d, /floodSensor/i)) return [Object.assign({ id, name: d.name, kind: 'leak', state: { on } }, b)];
  if (T(d, /powerMeter|energyMeter/i)) return [Object.assign({ id, name: d.name, kind: 'meter', state: { val: Math.round(+x || 0), unit: 'W' } }, b)];
  return [];
}
async function act(c, id, name, args) {
  // Home Center 3 : POST /api/devices/{id}/action/{name} ; Home Center 2 : GET /api/callAction
  const r = await request(base(c) + 'devices/' + id + '/action/' + name, { headers: H(c), body: { args: args || [] }, raw: true, timeout: 8000 });
  if (r.status === 404 || r.status === 405) { const q = new URLSearchParams({ deviceID: id, name }); (args || []).forEach((a, i) => q.set('arg' + (i + 1), a)); return request(base(c) + 'callAction?' + q.toString(), { headers: H(c), timeout: 8000 }); }
  if (r.status >= 300) throw new Error('Fibaro : HTTP ' + r.status);
}
module.exports = {
  id: 'fibaro', name: 'Fibaro', poll: 6000, secrets: ['password'],
  async test(c) { const l = await json(base(c) + 'devices?enabled=true&visible=true', { headers: H(c), timeout: 10000 }); return l.length + ' appareil(s), ' + l.filter(d => map(d, '').length).length + ' repris'; },
  async devices(c) {
    const [l, r] = await Promise.all([json(base(c) + 'devices?enabled=true&visible=true', { headers: H(c), timeout: 10000 }), json(base(c) + 'rooms', { headers: H(c), timeout: 10000 }).catch(() => [])]);
    const rooms = Object.fromEntries((r || []).map(x => [x.id, x.name]));
    return l.flatMap(d => map(d, rooms[d.roomID] || ''));
  },
  async command(c, id, p) {
    if ('bri' in p) await act(c, id, 'setValue', [Math.round(Math.min(99, p.bri))]);
    else if ('on' in p) await act(c, id, p.on ? 'turnOn' : 'turnOff');
    if ('pos' in p) await act(c, id, 'setValue', [Math.round(Math.min(99, p.pos))]);
    if (p.moving === 'stop') await act(c, id, 'stop');
    if ('locked' in p) await act(c, id, p.locked ? 'secure' : 'unsecure');
    if ('temp' in p) await act(c, id, 'setHeatingThermostatSetpoint', [+p.temp]);
  },
  _map: map
};

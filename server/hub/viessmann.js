// Viessmann (ViCare) — chaudière, PAC : températures, eau chaude. API officielle (offre gratuite « Basic »), OAuth avec PKCE.
'use strict';
const { json, request } = require('./net');
const API = 'https://api.viessmann.com/iot/v2';
const val = (f, name, k) => { const x = f.find(y => y.feature === name); return x && x.properties && x.properties[k || 'value'] ? x.properties[k || 'value'].value : undefined; };
const GW = {};
async function gw(c, H) {
  if (GW[c.clientId]) return GW[c.clientId];
  const r = await json(API + '/equipment/installations?includeGateways=true', { headers: H }), inst = r.data[0], g = inst.gateways[0];
  return (GW[c.clientId] = { inst: inst.id, serial: g.serial, dev: (g.devices.find(d => d.deviceType === 'heating') || g.devices[0] || { id: '0' }).id, name: inst.description || 'Viessmann' });
}
module.exports = {
  id: 'viessmann', name: 'Viessmann', poll: 300000, secrets: ['tokens'],
  oauth: { auth: 'https://iam.viessmann.com/idp/v3/authorize', token: 'https://iam.viessmann.com/idp/v3/token', scope: 'IoT User offline_access', pkce: true },
  async test(c, h) { const g = await gw(c, await h.auth()); return g.name + ' (' + g.serial + ')'; },
  async devices(c, h) {
    const H = await h.auth(), g = await gw(c, H), f = (await json(API + '/features/installations/' + g.inst + '/gateways/' + g.serial + '/devices/' + g.dev + '/features', { headers: H })).data, out = [];
    const ext = val(f, 'heating.sensors.temperature.outside'); if (ext != null) out.push({ id: 'outside', name: 'Température extérieure (chaudière)', kind: 'temp', info: 'Viessmann', state: { val: ext, unit: '°C' } });
    const sup = val(f, 'heating.circuits.0.sensors.temperature.supply'); if (sup != null) out.push({ id: 'supply', name: 'Départ chauffage', kind: 'temp', info: 'Viessmann', state: { val: sup, unit: '°C' } });
    const dhw = val(f, 'heating.dhw.sensors.temperature.hotWaterStorage'), set = val(f, 'heating.dhw.temperature.main');
    if (dhw != null || set != null) out.push({ id: 'dhw', name: 'Eau chaude', kind: 'heater', info: 'Viessmann', state: { on: val(f, 'heating.dhw', 'active') !== false, temp: set, val: dhw } });
    return out;
  },
  async command(c, id, p, cur, h) {
    const H = await h.auth(), g = await gw(c, H), base = API + '/features/installations/' + g.inst + '/gateways/' + g.serial + '/devices/' + g.dev + '/features/';
    if (id === 'dhw' && 'temp' in p) await request(base + 'heating.dhw.temperature.main/commands/setTargetTemperature', { headers: H, body: { temperature: Math.round(p.temp) } });
    if (id === 'dhw' && p.mode === 'Boost') await request(base + 'heating.dhw.oneTimeCharge/commands/activate', { headers: H, body: {} });
  }
};

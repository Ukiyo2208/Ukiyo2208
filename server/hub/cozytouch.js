// Cozytouch (Atlantic, Thermor, Sauter) — radiateurs, chauffe-eau, PAC. Passe par le cloud Atlantic (API non officielle,
// la même que l'appli Cozytouch) : lecture des températures, consigne, chauffe-eau.
'use strict';
const { request, json } = require('./net');
const ATL = 'https://apis.groupe-atlantic.com', OVK = 'https://ha110-1.overkiz.com/enduser-mobile-web/enduserAPI';
const CLIENT = 'Q3RfMUpWeVRtSUxYOEllZkE3YVVOQmpGblpVYTp5YnNWeUVHUnpHMWYxUmxVa0g5b19KdklSRkZp';   // identifiant public de l'appli Cozytouch
const S = {};
async function login(c) {
  const t = await json(ATL + '/token', { headers: { Authorization: 'Basic ' + CLIENT }, form: { grant_type: 'password', username: 'GA-PRIVATEPERSON/' + c.email, password: c.password } }).catch(() => null);
  if (!t || !t.access_token) throw new Error('compte Cozytouch refusé');
  const jwt = (await request(ATL + '/magellan/accounts/jwt', { headers: { Authorization: 'Bearer ' + t.access_token } })).text.replace(/"/g, '');
  const r = await request(OVK + '/login', { form: { jwt }, raw: true });
  const ck = (r.headers['set-cookie'] || []).map(x => x.split(';')[0]).join('; '); if (!ck || r.status >= 400) throw new Error('connexion Cozytouch refusée');
  S[c.email] = ck;
}
async function api(c, path, body) {
  if (!S[c.email]) await login(c);
  let r = await request(OVK + path, { raw: true, headers: { Cookie: S[c.email] }, body });
  if (r.status === 401) { await login(c); r = await request(OVK + path, { raw: true, headers: { Cookie: S[c.email] }, body }); }
  if (r.status >= 400) throw new Error('HTTP ' + r.status); return r.json();
}
const st = (d, n) => { const s = (d.states || []).find(x => x.name === n); return s ? s.value : undefined; };
function map(d) {
  const ui = d.uiClass, t = st(d, 'core:TargetTemperatureState') ?? st(d, 'core:ComfortRoomTemperatureState');
  if (ui === 'HeatingSystem' || ui === 'HeatPump') { const mode = st(d, 'io:TargetHeatingLevelState') || st(d, 'core:OperatingModeState'); return { kind: 'clim', state: { on: !/off|standby/i.test(String(mode || '')), temp: t || 19, hvac: 'Chaud' } }; }
  if (ui === 'WaterHeatingSystem') return { kind: 'heater', state: { on: !/off|standby/i.test(String(st(d, 'core:OperatingModeState') || '')), temp: st(d, 'core:WaterTargetTemperatureState') ?? t ?? 55, val: st(d, 'core:WaterTemperatureState') ?? st(d, 'modbuslink:MiddleWaterTemperatureState') } };
  if (ui === 'TemperatureSensor') return { kind: 'temp', state: { val: st(d, 'core:TemperatureState'), unit: '°C' } };
  if (ui === 'ElectricitySensor') return { kind: 'meter', state: { val: st(d, 'core:ElectricPowerConsumptionState') || 0, unit: 'W' } };
  return null;
}
module.exports = {
  id: 'cozytouch', name: 'Cozytouch', poll: 60000, secrets: ['password'],
  async test(c) { const d = await api(c, '/setup/devices'); return d.filter(map).length + ' appareil(s) Atlantic / Thermor / Sauter'; },
  async devices(c) { return (await api(c, '/setup/devices')).map(d => { const m = map(d); return m && { id: d.deviceURL, name: d.label, kind: m.kind, info: d.controllableName.split(':').pop(), state: m.state }; }).filter(Boolean); },
  async command(c, id, p) {
    const cmds = [];
    if ('temp' in p) cmds.push({ name: 'setTargetTemperature', parameters: [p.temp] });
    if ('on' in p) cmds.push({ name: 'setOperatingMode', parameters: [p.on ? 'internal' : 'standby'] });
    if (p.mode === 'Boost') cmds.push({ name: 'setBoostModeDuration', parameters: [1] });
    if (cmds.length) await api(c, '/exec/apply', { label: 'Bêta home', actions: [{ deviceURL: id, commands: cmds }] });
  }
};

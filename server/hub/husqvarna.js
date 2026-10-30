// Husqvarna Automower et Gardena smart system — tondeuses robots, arrosage, capteurs. API officielle Husqvarna Group
// (clé d'application gratuite sur developer.husqvarnagroup.cloud, reliée à votre compte).
'use strict';
const { json, request } = require('./net');
const AUTH = 'https://api.authentication.husqvarnagroup.dev/v1/oauth2/token', AMC = 'https://api.amc.husqvarna.dev/v1', GAR = 'https://api.smart.gardena.dev/v1';
const T = {};
async function H(c) {
  if (!T[c.appKey] || Date.now() > T[c.appKey].exp) {
    const r = await json(AUTH, { form: { grant_type: 'client_credentials', client_id: c.appKey, client_secret: c.appSecret } }).catch(() => null);
    if (!r || !r.access_token) throw new Error('clé ou secret d’application Husqvarna refusé');
    T[c.appKey] = { tok: r.access_token, exp: Date.now() + (r.expires_in - 120) * 1000 };
  }
  return { Authorization: 'Bearer ' + T[c.appKey].tok, 'X-Api-Key': c.appKey, 'Authorization-Provider': 'husqvarna', 'Content-Type': 'application/vnd.api+json' };
}
const MOW = { MOWING: 'mowing', LEAVING: 'mowing', GOING_HOME: 'returning', CHARGING: 'docked', PARKED_IN_CS: 'docked', IN_OPERATION: 'mowing', PAUSED: 'paused', STOPPED: 'paused', ERROR: 'error' };
module.exports = {
  id: 'husqvarna', name: 'Husqvarna / Gardena', poll: 60000, secrets: ['appSecret'],
  async test(c) { const h = await H(c); const m = await json(AMC + '/mowers', { headers: h }).catch(() => ({ data: [] })), g = await json(GAR + '/locations', { headers: h }).catch(() => ({ data: [] })); return m.data.length + ' tondeuse(s) · ' + g.data.length + ' jardin(s) Gardena'; },
  async devices(c) {
    const h = await H(c), out = [];
    try { (await json(AMC + '/mowers', { headers: h })).data.forEach(m => { const a = m.attributes; out.push({ id: 'm:' + m.id, name: a.system.name, kind: 'mower', info: 'Automower ' + a.system.model, state: { status: MOW[a.mower.activity] || MOW[a.mower.state] || 'docked', bat: a.battery.batteryPercent } }); }); } catch (e) { }
    try {
      for (const loc of (await json(GAR + '/locations', { headers: h })).data) {
        const inc = (await json(GAR + '/locations/' + loc.id, { headers: h })).included || [], byDev = {};
        inc.forEach(x => { const d = (x.relationships && x.relationships.device && x.relationships.device.data && x.relationships.device.data.id) || x.id; (byDev[d] = byDev[d] || []).push(x); });
        Object.values(byDev).forEach(list => {
          const com = list.find(x => x.type === 'COMMON'), name = com ? com.attributes.name.value : 'Gardena';
          list.filter(x => x.type === 'VALVE').forEach(v => out.push({ id: 'v:' + v.id, name: (v.attributes.name && v.attributes.name.value) || name, kind: 'valve', info: 'Gardena', state: { on: /WATERING/.test(v.attributes.activity.value), min: 10 } }));
          list.filter(x => x.type === 'POWER_SOCKET').forEach(v => out.push({ id: 's:' + v.id, name, kind: 'plug', info: 'Prise Gardena', state: { on: /ON/.test(v.attributes.activity.value) } }));
          list.filter(x => x.type === 'MOWER').forEach(v => out.push({ id: 'g:' + v.id, name, kind: 'mower', info: 'Gardena Sileno', state: { status: /MOWING|LEAVING/.test(v.attributes.activity.value) ? 'mowing' : /GOING_HOME/.test(v.attributes.activity.value) ? 'returning' : 'docked', bat: com && com.attributes.batteryLevel ? com.attributes.batteryLevel.value : 100 } }));
          list.filter(x => x.type === 'SENSOR').forEach(v => { if (v.attributes.soilHumidity) out.push({ id: 'h:' + v.id, name: 'Humidité du sol ' + name, kind: 'hum', info: 'Capteur Gardena', state: { val: v.attributes.soilHumidity.value, unit: '%' } }); if (v.attributes.soilTemperature) out.push({ id: 't:' + v.id, name: 'Température du sol ' + name, kind: 'temp', info: 'Capteur Gardena', state: { val: v.attributes.soilTemperature.value, unit: '°C' } }); });
        });
      }
    } catch (e) { }
    return out;
  },
  async command(c, id, p, cur) {
    const h = await H(c), [t, sid] = [id[0], id.slice(2)];
    if (t === 'm') { const a = p.status === 'mowing' ? { type: 'ResumeSchedule' } : p.status === 'docked' || p.status === 'returning' ? { type: 'ParkUntilNextSchedule' } : p.status === 'paused' ? { type: 'Pause' } : null; if (a) await request(AMC + '/mowers/' + sid + '/actions', { headers: h, body: { data: a } }); return; }
    const cmd = (type, attributes) => request(GAR + '/command/' + sid, { method: 'PUT', headers: h, body: { data: { id: 'beta' + Date.now(), type, attributes } } });
    if (t === 'v' && 'on' in p) return cmd('VALVE_CONTROL', p.on ? { command: 'START_SECONDS_TO_OVERRIDE', seconds: (cur.min || 10) * 60 } : { command: 'STOP_UNTIL_NEXT_TASK' });
    if (t === 's' && 'on' in p) return cmd('POWER_SOCKET_CONTROL', p.on ? { command: 'START_OVERRIDE' } : { command: 'STOP_UNTIL_NEXT_TASK' });
    if (t === 'g' && p.status) return cmd('MOWER_CONTROL', p.status === 'mowing' ? { command: 'START_SECONDS_TO_OVERRIDE', seconds: 3 * 3600 } : { command: 'PARK_UNTIL_NEXT_TASK' });
  }
};

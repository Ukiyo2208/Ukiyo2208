// Samsung SmartThings — API officielle (TV, lave-linge, climatisation…). Connexion OAuth :
// les jetons personnels SmartThings expirent en 24 h, le jeton OAuth se renouvelle seul.
'use strict';
const { json } = require('./net');
const API = 'https://api.smartthings.com/v1';

const caps = d => new Set([].concat(...(d.components || []).map(c => (c.capabilities || []).map(x => x.id))));
function kindOf(d) {
  const c = caps(d), cat = ((d.components || [])[0] && (d.components[0].categories || [])[0] || {}).name || '';
  if (c.has('washerOperatingState') || c.has('dryerOperatingState') || c.has('dishwasherOperatingState') || /Washer|Dryer|Dishwasher|Refrigerator|Oven/.test(cat)) return 'app';
  if (c.has('airConditionerMode') || /AirConditioner/.test(cat)) return 'clim';
  if (c.has('tvChannel') || c.has('samsungvd.mediaInputSource') || /Television/.test(cat)) return 'tv';
  if (c.has('robotCleanerMovement')) return 'vacuum';
  if (c.has('switch')) return 'plug';
  if (c.has('temperatureMeasurement')) return 'temp';
  return '';
}
const v = (m, cap, attr) => m[cap] && m[cap][attr] ? m[cap][attr].value : undefined;
const JOB = { run: 'En cours', pause: 'En pause', stop: 'Arrêté' };
function state(kind, s) {
  const m = (s.components && s.components.main) || {}, out = {};
  const sw = v(m, 'switch', 'switch'); if (sw != null) out.on = sw === 'on';
  if (kind === 'tv') { const vol = v(m, 'audioVolume', 'volume'); if (vol != null) out.vol = vol; }
  if (kind === 'clim') { const t = v(m, 'thermostatCoolingSetpoint', 'coolingSetpoint'); if (t != null) out.temp = t; }
  if (kind === 'app') {
    const ms = v(m, 'washerOperatingState', 'machineState') || v(m, 'dryerOperatingState', 'machineState') || v(m, 'dishwasherOperatingState', 'machineState');
    const end = v(m, 'washerOperatingState', 'completionTime') || v(m, 'dryerOperatingState', 'completionTime');
    if (ms) { out.on = ms === 'run'; out.prog = (JOB[ms] || ms) + (ms === 'run' && end ? ' · fin ' + new Date(end).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: process.env.TZ || 'Europe/Paris' }) : ''); }
  }
  if (kind === 'temp') { const t = v(m, 'temperatureMeasurement', 'temperature'); if (t != null) { out.val = t; out.unit = '°C'; } }
  return out;
}

module.exports = {
  id: 'smartthings', name: 'Samsung SmartThings', poll: 30000, secrets: ['clientSecret', 'tokens'],
  oauth: { auth: 'https://api.smartthings.com/oauth/authorize', token: 'https://api.smartthings.com/oauth/token', scope: 'r:devices:* x:devices:* r:locations:*', basic: true },
  async test(c, h) { const r = await json(API + '/devices', { headers: await h.auth() }); return (r.items || []).length + ' appareil(s)'; },
  async devices(c, h) {
    const H = await h.auth(), r = await json(API + '/devices', { headers: H }), rooms = {};
    for (const loc of [...new Set((r.items || []).map(d => d.locationId))]) {
      try { (await json(API + '/locations/' + loc + '/rooms', { headers: H })).items.forEach(x => { rooms[x.roomId] = x.name; }); } catch (e) { }
    }
    const out = [];
    for (const d of r.items || []) {
      const kind = kindOf(d); if (!kind) continue;
      let s = {}; try { s = state(kind, await json(API + '/devices/' + d.deviceId + '/status', { headers: H })); } catch (e) { }
      out.push({ id: d.deviceId, name: d.label || d.name, kind, room: rooms[d.roomId] || '', info: d.name, state: s });
    }
    return out;
  },
  async command(c, id, p, cur, h) {
    const cmds = [];
    if ('on' in p) cmds.push({ component: 'main', capability: 'switch', command: p.on ? 'on' : 'off' });
    if ('vol' in p) cmds.push({ component: 'main', capability: 'audioVolume', command: 'setVolume', arguments: [Math.round(p.vol)] });
    if ('temp' in p) cmds.push({ component: 'main', capability: 'thermostatCoolingSetpoint', command: 'setCoolingSetpoint', arguments: [p.temp] });
    if (cmds.length) await json(API + '/devices/' + id + '/commands', { headers: await h.auth(), body: { commands: cmds } });
  }
};

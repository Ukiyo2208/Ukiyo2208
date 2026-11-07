// Valetudo — aspirateurs robots libérés du cloud (Dreame, Roborock, Xiaomi…) : état, batterie, départ, retour à la base.
'use strict';
const { json, request } = require('./net');
const hosts = c => String(c.hosts || '').split(/[,;\s]+/).filter(Boolean);
const ST = { idle: 'docked', docked: 'docked', cleaning: 'cleaning', returning: 'returning', paused: 'paused', error: 'error', manual_control: 'cleaning', moving: 'cleaning' };
module.exports = {
  id: 'valetudo', name: 'Valetudo', poll: 5000,
  async test(c) { const ip = hosts(c)[0]; if (!ip) throw new Error('adresse IP manquante'); const r = await json('http://' + ip + '/api/v2/robot'); return r.manufacturer + ' ' + r.modelName; },
  async devices(c) {
    return Promise.all(hosts(c).map(async ip => {
      const [r, a] = await Promise.all([json('http://' + ip + '/api/v2/robot').catch(() => ({})), json('http://' + ip + '/api/v2/robot/state/attributes')]);
      const st = (a.find(x => x.__class === 'StatusStateAttribute') || {}).value, bat = (a.find(x => x.__class === 'BatteryStateAttribute') || {}).level;
      return { id: ip, name: (r.modelName ? r.manufacturer + ' ' + r.modelName : 'Aspirateur ' + ip), kind: 'vacuum', info: 'Valetudo', state: { status: ST[st] || 'docked', bat: bat == null ? 100 : bat } };
    }));
  },
  async command(c, ip, p) {
    const a = p.status === 'cleaning' ? 'start' : p.status === 'docked' || p.status === 'returning' ? 'home' : p.status === 'paused' ? 'pause' : p.on === true ? 'start' : p.on === false ? 'home' : null;
    if (a) await request('http://' + ip + '/api/v2/robot/capabilities/BasicControlCapability', { method: 'PUT', body: { action: a } });
  }
};

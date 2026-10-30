// Sensibo (Sky, Air, Air Pro) — rend n'importe quelle clim infrarouge connectée. API officielle avec clé.
'use strict';
const { json, request } = require('./net');
const API = 'https://home.sensibo.com/api/v2';
const M = { cool: 'Froid', heat: 'Chaud', auto: 'Auto', dry: 'Sec', fan: 'Ventilation' }, B = { Froid: 'cool', Chaud: 'heat', Auto: 'auto', Sec: 'dry', Ventilation: 'fan' };
const pods = async c => (await json(API + '/users/me/pods?fields=id,room,acState,measurements&apiKey=' + encodeURIComponent(c.apiKey))).result;
module.exports = {
  id: 'sensibo', name: 'Sensibo', poll: 30000, secrets: ['apiKey'],
  async test(c) { return (await pods(c)).length + ' clim(s)'; },
  async devices(c) { return (await pods(c)).map(p => ({ id: p.id, name: 'Clim ' + p.room.name, room: p.room.name, kind: 'clim', info: 'Sensibo', state: { on: !!p.acState.on, temp: p.acState.targetTemperature, cur: p.measurements && p.measurements.temperature, hum: p.measurements && p.measurements.humidity, hvac: M[p.acState.mode] || 'Auto', ac: p.acState } })); },
  async command(c, id, p, cur) {
    const ac = Object.assign({}, cur.ac || {});
    if ('on' in p) ac.on = !!p.on; if ('temp' in p) ac.targetTemperature = Math.round(p.temp); if (p.hvac) { if (p.hvac === 'Arrêt') ac.on = false; else ac.mode = B[p.hvac] || ac.mode; }
    await request(API + '/pods/' + id + '/acStates?apiKey=' + encodeURIComponent(c.apiKey), { body: { acState: ac } });
  }
};

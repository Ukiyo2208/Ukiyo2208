// Airzone — climatisation gainable par zones (Easyzone, Flexa, Aidoo) : API locale du serveur Web Airzone (port 3000).
'use strict';
const { json } = require('./net');
const base = c => { const h = String(c.host || '').trim().replace(/^https?:\/\//, '').replace(/\/+$/, ''); return 'http://' + (/:\d+$/.test(h) ? h : h + ':3000') + '/api/v1/hvac'; };
const MODE = { 1: 'Arrêt', 2: 'Froid', 3: 'Chaud', 4: 'Ventilation', 5: 'Sec', 7: 'Auto' }, MODEI = { Froid: 2, Chaud: 3, Ventilation: 4, Sec: 5, Auto: 7 };
async function zones(c) {
  const r = await json(base(c), { method: 'POST', body: { systemID: 0, zoneID: 0 }, timeout: 8000 });
  return r.systems ? r.systems.flatMap(s => s.data || []) : (r.data || []);   // plusieurs systèmes ou un seul
}
module.exports = {
  id: 'airzone', name: 'Airzone', poll: 15000, secrets: [],
  async test(c) { const z = await zones(c); return z.length + ' zone(s)'; },
  async devices(c) {
    return (await zones(c)).map(z => ({ id: z.systemID + ':' + z.zoneID, name: z.name || 'Zone ' + z.zoneID, room: z.name || '', kind: 'clim', info: 'Airzone · système ' + z.systemID, state: { on: !!z.on, temp: z.setpoint, cur: z.roomTemp, curhum: z.humidity, hvac: z.on ? MODE[z.mode] || 'Auto' : 'Arrêt', modes: ['Auto', 'Chaud', 'Froid', 'Sec', 'Ventilation'], min: z.minTemp, max: z.maxTemp } }));
  },
  async command(c, id, p) {
    const [systemID, zoneID] = id.split(':').map(Number), put = o => json(base(c), { method: 'PUT', body: Object.assign({ systemID, zoneID }, o), timeout: 8000 });
    if (p.hvac === 'Arrêt') return put({ on: 0 });
    if ('on' in p) await put({ on: p.on ? 1 : 0 });
    if (p.hvac && MODEI[p.hvac]) { await put({ on: 1 }); await put({ mode: MODEI[p.hvac] }).catch(() => { }); }   // le mode se règle sur la zone maître
    if ('temp' in p) await put({ setpoint: +p.temp });
  }
};

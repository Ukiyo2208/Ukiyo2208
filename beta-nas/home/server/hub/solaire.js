// Panneaux solaires — production en direct, en local : Fronius, Enphase (Envoy), SMA et Huawei (Modbus TCP).
'use strict';
const { json } = require('./net');
const { read } = require('./modbus');
const host = c => String(c.host || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
const s32 = b => b.readInt32BE(0), u32 = b => b.readUInt32BE(0);
async function measure(c) {
  const t = c.type || 'fronius';
  if (t === 'fronius') { const r = (await json('http://' + host(c) + '/solar_api/v1/GetPowerFlowRealtimeData.fcgi', { timeout: 6000 })).Body.Data.Site; return { pv: r.P_PV || 0, grid: r.P_Grid, load: r.P_Load == null ? null : -r.P_Load, day: r.E_Day }; }
  if (t === 'enphase') {
    const r = await json('https://' + host(c) + '/production.json?details=1', { insecure: true, timeout: 8000, headers: c.token ? { Authorization: 'Bearer ' + c.token } : {} });
    const prod = (r.production || []).find(x => x.type === 'eim' && x.activeCount) || (r.production || [])[0] || {}, cons = (r.consumption || []).find(x => x.measurementType === 'total-consumption') || {}, net = (r.consumption || []).find(x => x.measurementType === 'net-consumption') || {};
    return { pv: prod.wNow || 0, load: cons.wNow, grid: net.wNow, day: prod.whToday };
  }
  if (t === 'sma') { const [p, e] = await Promise.all([read(host(c), +c.port || 502, +c.unit || 3, 30775, 2), read(host(c), +c.port || 502, +c.unit || 3, 30535, 2).catch(() => null)]); const v = s32(p); return { pv: v === -2147483648 ? 0 : v, day: e ? u32(e) : null }; }
  if (t === 'huawei') { const [p, e] = await Promise.all([read(host(c), +c.port || 502, +c.unit || 1, 32080, 2), read(host(c), +c.port || 502, +c.unit || 1, 32114, 2).catch(() => null)]); return { pv: s32(p), day: e ? u32(e) * 10 : null }; }
  throw new Error('type d’onduleur inconnu');
}
module.exports = {
  id: 'solaire', name: 'Panneaux solaires', poll: 10000, secrets: ['token'],
  async test(c) { const m = await measure(c); return 'Production : ' + Math.round(m.pv) + ' W'; },
  async devices(c) {
    const m = await measure(c), out = [{ id: 'pv', name: 'Production solaire', kind: 'meter', info: m.day != null ? 'Aujourd’hui : ' + (m.day / 1000).toFixed(1).replace('.', ',') + ' kWh' : (c.type || 'fronius'), state: { val: Math.round(m.pv), unit: 'W', day: m.day } }];
    if (m.grid != null) out.push({ id: 'grid', name: 'Réseau (+ achat / − revente)', kind: 'meter', info: 'Échange avec le réseau', state: { val: Math.round(m.grid), unit: 'W' } });
    if (m.load != null) out.push({ id: 'load', name: 'Consommation de la maison', kind: 'meter', info: 'Mesurée par l’onduleur', state: { val: Math.round(m.load), unit: 'W' } });
    return out;
  },
  async command() { }
};

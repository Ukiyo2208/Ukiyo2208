// Ecowitt (GW1100, GW2000, HP2550, stations Froggit) — votre station météo, en local : température, humidité, vent, pluie.
'use strict';
const { json } = require('./net');
const num = v => parseFloat(String(v).replace(',', '.'));
module.exports = {
  id: 'ecowitt', name: 'Ecowitt', poll: 30000,
  async test(c) { const d = await json('http://' + String(c.host).replace(/^https?:\/\//, '') + '/get_livedata_info', { timeout: 6000 }); return (d.common_list || []).length + ' mesure(s)'; },
  async devices(c) {
    const d = await json('http://' + String(c.host).replace(/^https?:\/\//, '') + '/get_livedata_info', { timeout: 6000 }), out = [], cl = {};
    (d.common_list || []).forEach(x => { cl[x.id] = x; });
    const temp = x => x && (/F/.test(x.unit || '') ? Math.round((num(x.val) - 32) / 1.8 * 10) / 10 : num(x.val));
    if (cl['0x02']) out.push({ id: 'out_t', name: 'Température extérieure', kind: 'temp', info: 'Station Ecowitt', state: { val: temp(cl['0x02']), unit: '°C' } });
    if (cl['0x07']) out.push({ id: 'out_h', name: 'Humidité extérieure', kind: 'hum', info: 'Station Ecowitt', state: { val: num(cl['0x07'].val), unit: '%' } });
    if (cl['0x0B']) out.push({ id: 'wind', name: 'Vent', kind: 'meter', info: 'Rafales ' + (cl['0x0C'] ? cl['0x0C'].val : '—'), state: { val: num(cl['0x0B'].val), unit: (cl['0x0B'].val.match(/[a-z/]+/i) || ['km/h'])[0] } });
    (d.wh25 || []).forEach(x => { out.push({ id: 'in_t', name: 'Température intérieure', kind: 'temp', info: 'Console Ecowitt', state: { val: /F/.test(x.unit || '') ? Math.round((num(x.intemp) - 32) / 1.8 * 10) / 10 : num(x.intemp), unit: '°C' } }); out.push({ id: 'in_h', name: 'Humidité intérieure', kind: 'hum', info: 'Console Ecowitt', state: { val: num(x.inhumi), unit: '%' } }); });
    (d.rain || []).forEach(x => { if (x.id === '0x0D') out.push({ id: 'rain', name: 'Pluie du jour', kind: 'meter', info: 'Pluviomètre', state: { val: num(x.val), unit: 'mm' } }); });
    (d.ch_aisle || []).forEach(x => { out.push({ id: 'ch' + x.channel + '_t', name: (x.name || 'Capteur ' + x.channel) + ' — température', kind: 'temp', info: 'Capteur Ecowitt', state: { val: /F/.test(x.unit || '') ? Math.round((num(x.temp) - 32) / 1.8 * 10) / 10 : num(x.temp), unit: '°C' } }); if (x.humidity) out.push({ id: 'ch' + x.channel + '_h', name: (x.name || 'Capteur ' + x.channel) + ' — humidité', kind: 'hum', info: 'Capteur Ecowitt', state: { val: num(x.humidity), unit: '%' } }); });
    return out;
  },
  async command() { }
};

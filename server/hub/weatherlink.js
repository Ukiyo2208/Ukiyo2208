// Davis WeatherLink Live — station météo Vantage Pro2 / Vue, en local : température, humidité, vent, pluie (et l'intérieur).
'use strict';
const { json } = require('./net');
const F = f => Math.round((f - 32) / 1.8 * 10) / 10, MPH = v => Math.round(v * 1.609);
const RAIN = { 1: 0.254, 2: 0.2, 3: 0.1, 4: 0.0254 };   // taille d'un « coup » de pluviomètre, en mm
async function cond(c) { const r = await json('http://' + String(c.host || '').replace(/^https?:\/\//, '').replace(/\/+$/, '') + '/v1/current_conditions', { timeout: 8000 }); if (!r || !r.data) throw new Error('réponse WeatherLink inattendue'); return r.data.conditions || []; }
module.exports = {
  id: 'weatherlink', name: 'Davis WeatherLink', poll: 30000, secrets: [],
  async test(c) { const l = await cond(c); return l.length + ' capteur(s)'; },
  async devices(c) {
    const out = [], b = { info: 'Davis WeatherLink' };
    for (const x of await cond(c)) {
      if (x.data_structure_type === 1 && x.temp != null) {
        out.push(Object.assign({ id: 'out_t', name: 'Température extérieure', kind: 'temp', state: { val: F(x.temp), unit: '°C' } }, b));
        if (x.hum != null) out.push(Object.assign({ id: 'out_h', name: 'Humidité extérieure', kind: 'hum', state: { val: x.hum, unit: '%' } }, b));
        if (x.wind_speed_last != null) out.push(Object.assign({ id: 'wind', name: 'Vent', kind: 'meter', info: 'Rafales ' + MPH(x.wind_speed_hi_last_10_min || 0) + ' km/h', state: { val: MPH(x.wind_speed_last), unit: 'km/h' } }));
        if (x.rainfall_daily != null) out.push(Object.assign({ id: 'rain', name: 'Pluie du jour', kind: 'meter', state: { val: Math.round(x.rainfall_daily * (RAIN[x.rain_size] || 0.2) * 10) / 10, unit: 'mm' } }, b));
      }
      if (x.data_structure_type === 4) {
        if (x.temp_in != null) out.push(Object.assign({ id: 'in_t', name: 'Température intérieure', kind: 'temp', state: { val: F(x.temp_in), unit: '°C' } }, b));
        if (x.hum_in != null) out.push(Object.assign({ id: 'in_h', name: 'Humidité intérieure', kind: 'hum', state: { val: x.hum_in, unit: '%' } }, b));
      }
    }
    return out;
  },
  async command() { }
};

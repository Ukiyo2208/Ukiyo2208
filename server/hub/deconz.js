// deCONZ / Phoscon (clé ConBee, RaspBee) — lampes, prises, volets et capteurs Zigbee, API locale.
'use strict';
const { request, json } = require('./net');
const base = c => 'http://' + String(c.host || '').replace(/^https?:\/\//, '').replace(/\/+$/, '') + '/api';
module.exports = {
  id: 'deconz', name: 'deCONZ / Phoscon', poll: 3000, secrets: ['apiKey'],
  actions: {
    async pair(c, b) {   // Phoscon › Passerelle › Avancé › « Authentifier l'application », puis Appairer dans les 60 s
      const r = await json(base({ host: b.host || c.host }), { body: { devicetype: 'beta-home' } }).catch(e => { throw new Error('déverrouillez d’abord la passerelle dans Phoscon (Avancé › Authentifier l’application)'); });
      const k = r && r[0] && r[0].success && r[0].success.username; if (!k) throw new Error('déverrouillez d’abord la passerelle dans Phoscon');
      return { host: b.host || c.host, apiKey: k, info: 'Passerelle appairée' };
    }
  },
  async test(c) { const l = await json(base(c) + '/' + c.apiKey + '/lights'), s = await json(base(c) + '/' + c.apiKey + '/sensors'); return Object.keys(l).length + ' lampe(s) · ' + Object.keys(s).length + ' capteur(s)'; },
  async devices(c) {
    const [l, s] = await Promise.all([json(base(c) + '/' + c.apiKey + '/lights'), json(base(c) + '/' + c.apiKey + '/sensors')]), out = [];
    Object.keys(l).forEach(id => { const d = l[id], st = d.state || {};
      if (/window covering/i.test(d.type)) out.push({ id: 'l' + id, name: d.name, kind: 'cover', info: d.modelid, state: { pos: 100 - (st.lift || 0) } });
      else if (/plug|outlet|on\/off/i.test(d.type)) out.push({ id: 'l' + id, name: d.name, kind: 'plug', info: d.modelid, state: { on: !!st.on } });
      else out.push({ id: 'l' + id, name: d.name, kind: st.hue != null || st.xy ? 'rgb' : 'light', info: d.modelid, state: { on: !!st.on, bri: Math.round((st.bri || 0) / 2.54) } }); });
    Object.keys(s).forEach(id => { const d = s[id], st = d.state || {}, k = { ZHAOpenClose: ['door', { on: !!st.open }], ZHAPresence: ['motion', { on: !!st.presence }], ZHAWater: ['leak', { on: !!st.water }], ZHATemperature: ['temp', { val: st.temperature / 100, unit: '°C' }], ZHAHumidity: ['hum', { val: st.humidity / 100, unit: '%' }], ZHAPower: ['meter', { val: st.power, unit: 'W' }] }[d.type];
      if (k) out.push({ id: 's' + id, name: d.name, kind: k[0], info: d.modelid, state: k[1] }); });
    return out;
  },
  async command(c, id, p) {
    if (id[0] !== 'l') return;
    const b = {}; if ('on' in p) b.on = !!p.on; if ('bri' in p) { b.on = true; b.bri = Math.round(p.bri * 2.54); } if ('pos' in p) b.lift = 100 - Math.round(p.pos); if (p.moving === 'stop') b.stop = true;
    await request(base(c) + '/' + c.apiKey + '/lights/' + id.slice(1) + '/state', { method: 'PUT', body: b });
  }
};

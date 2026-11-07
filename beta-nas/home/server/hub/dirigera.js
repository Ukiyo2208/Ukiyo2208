// IKEA Dirigera — la passerelle IKEA Home smart, en local : lampes, prises, stores, capteurs (mouvement, ouverture, fuite, air).
'use strict';
const crypto = require('crypto');
const { request, json } = require('./net');
const base = c => 'https://' + String(c.host || '').replace(/^https?:\/\//, '').replace(/[:/].*$/, '') + ':8443/v1';
const H = c => ({ Authorization: 'Bearer ' + c.token });
module.exports = {
  id: 'dirigera', name: 'IKEA Dirigera', poll: 3000, secrets: ['token'],
  actions: {
    async pair(c, b) {   // appuyez sur le bouton « action » au dos de la passerelle quand demandé
      const cc = { host: b.host || c.host }, v = crypto.randomBytes(48).toString('base64url'), ch = crypto.createHash('sha256').update(v).digest('base64url');
      const a = await json(base(cc) + '/oauth/authorize?audience=homesmart.local&response_type=code&code_challenge=' + ch + '&code_challenge_method=S256', { insecure: true });
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const r = await request(base(cc) + '/oauth/token', { insecure: true, raw: true, form: { code: a.code, name: 'beta-home', grant_type: 'authorization_code', code_verifier: v } });
        const j = r.json(); if (j && j.access_token) return { host: cc.host, token: j.access_token, info: 'Passerelle appairée' };
      }
      throw new Error('appuyez sur le bouton « action » au dos de la passerelle Dirigera, puis réessayez');
    }
  },
  async test(c) { if (!c.token) throw new Error('passerelle non appairée'); const d = await json(base(c) + '/devices', { insecure: true, headers: H(c) }); return d.length + ' appareil(s) IKEA'; },
  async devices(c) {
    if (!c.token) return [];
    return (await json(base(c) + '/devices', { insecure: true, headers: H(c) })).map(d => {
      const a = d.attributes || {}, base0 = { id: d.id, name: a.customName || d.deviceType, room: d.room ? d.room.name : '', info: 'IKEA ' + (a.model || d.deviceType) };
      switch (d.deviceType) {
        case 'light': return Object.assign(base0, { kind: a.colorHue != null ? 'rgb' : 'light', state: { on: !!a.isOn, bri: a.lightLevel || 0 } });
        case 'outlet': return Object.assign(base0, { kind: 'plug', state: { on: !!a.isOn, w: a.currentActivePower } });
        case 'blinds': return Object.assign(base0, { kind: 'cover', state: { pos: 100 - (a.blindsCurrentLevel || 0) } });
        case 'motionSensor': case 'occupancySensor': return Object.assign(base0, { kind: 'motion', state: { on: !!a.isDetected } });
        case 'openCloseSensor': return Object.assign(base0, { kind: 'door', state: { on: !!a.isOpen } });
        case 'waterSensor': return Object.assign(base0, { kind: 'leak', state: { on: !!a.waterLeakDetected } });
        case 'environmentSensor': return Object.assign(base0, { kind: a.currentCO2 != null ? 'co2' : 'temp', state: a.currentCO2 != null ? { val: a.currentCO2, unit: 'ppm' } : { val: a.currentTemperature, unit: '°C' } });
        case 'airPurifier': return Object.assign(base0, { kind: 'fan', state: { on: a.fanMode !== 'off', pct: a.motorState } });
      }
      return null;
    }).filter(Boolean);
  },
  async command(c, id, p) {
    const at = {}; if ('on' in p) at.isOn = !!p.on; if ('bri' in p) at.lightLevel = Math.max(1, Math.round(p.bri)); if ('pos' in p) at.blindsTargetLevel = 100 - Math.round(p.pos);
    if (p.moving === 'stop') at.blindsState = 'stopped';
    if (Object.keys(at).length) await request(base(c) + '/devices/' + id, { insecure: true, method: 'PATCH', headers: H(c), body: [{ attributes: at }] });
  }
};

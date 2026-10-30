// SwitchBot — Bot, rideaux, stores, prises, thermomètres, capteurs. API officielle v1.1 (jeton + clé secrète de l'appli).
'use strict';
const crypto = require('crypto');
const { json } = require('./net');
const API = 'https://api.switch-bot.com/v1.1';
function H(c) { const t = Date.now(), nonce = crypto.randomUUID(), sign = crypto.createHmac('sha256', c.secret).update(c.token + t + nonce).digest('base64'); return { Authorization: c.token, sign, t: String(t), nonce, 'Content-Type': 'application/json' }; }
const get = async (c, p) => { const r = await json(API + p, { headers: H(c) }); if (r.statusCode !== 100) throw new Error(r.message || 'erreur SwitchBot'); return r.body; };
const cmd = (c, id, command, parameter) => json(API + '/devices/' + id + '/commands', { headers: H(c), body: { command, parameter: parameter || 'default', commandType: 'command' } });
function shape(d, s) {
  const t = d.deviceType;
  if (t === 'Bot') return ['plug', { on: s.power === 'on' }];
  if (/Curtain|Roller Shade|Blind Tilt/.test(t)) return ['cover', { pos: 100 - (s.slidePosition || 0) }];
  if (/Plug|Relay Switch/.test(t)) return ['plug', { on: s.power === 'on', w: s.weight || s.power_w }];
  if (/Meter|Hub 2|WoIOSensor/.test(t)) return ['temp', { val: s.temperature, unit: '°C' }];
  if (/Contact/.test(t)) return ['door', { on: s.openState === 'open' || s.openState === 'timeOutNotClose' }];
  if (/Motion/.test(t)) return ['motion', { on: !!s.moveDetected }];
  if (/Leak|Water/.test(t)) return ['leak', { on: s.status === 1 }];
  if (/Bulb|Strip|Ceiling/.test(t)) return ['light', { on: s.power === 'on', bri: s.brightness }];
  return null;
}
module.exports = {
  id: 'switchbot', name: 'SwitchBot', poll: 120000, secrets: ['token', 'secret'],
  async test(c) { const b = await get(c, '/devices'); return b.deviceList.length + ' appareil(s) · ' + (b.infraredRemoteList || []).length + ' télécommande(s) IR'; },
  async devices(c) {
    const b = await get(c, '/devices'), out = [];
    for (const d of b.deviceList) { if (/^Hub( Mini| Plus)?$/.test(d.deviceType)) continue; let s = {}; try { s = await get(c, '/devices/' + d.deviceId + '/status'); } catch (e) { } const k = shape(d, s); if (k) out.push({ id: d.deviceId, name: d.deviceName, kind: k[0], info: 'SwitchBot ' + d.deviceType, state: k[1] }); }
    (b.infraredRemoteList || []).forEach(r => out.push({ id: 'ir:' + r.deviceId, name: r.deviceName, kind: /Air Conditioner/.test(r.remoteType) ? 'clim' : /TV/.test(r.remoteType) ? 'tv' : 'plug', info: 'Télécommande IR SwitchBot', state: {} }));
    return out;
  },
  async command(c, id, p) {
    const ir = id.startsWith('ir:'), did = ir ? id.slice(3) : id;
    if ('pos' in p) return cmd(c, did, 'setPosition', '0,ff,' + (100 - Math.round(p.pos)));
    if ('bri' in p) return cmd(c, did, 'setBrightness', String(Math.round(p.bri)));
    if ('on' in p) return cmd(c, did, p.on ? 'turnOn' : 'turnOff');
    if (p.run) return cmd(c, did, 'press');
  }
};

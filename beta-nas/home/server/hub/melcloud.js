// Mitsubishi Electric MELCloud — climatisations et pompes à chaleur air/air avec interface Wi-Fi MAC-5xx (identifiants de l'application MELCloud).
'use strict';
const { json } = require('./net');
const API = 'https://app.melcloud.com/Mitsubishi.Wifi.Client/';
const SES = {};
const MODE = { 1: 'Chaud', 2: 'Sec', 3: 'Froid', 7: 'Ventilation', 8: 'Auto' }, MODEI = { Chaud: 1, Sec: 2, Froid: 3, Ventilation: 7, Auto: 8 };
async function key(c, fresh) {
  const s = SES[c.user]; if (s && !fresh && s.exp > Date.now()) return s.k;
  const r = await json(API + 'Login/ClientLogin', { body: { Email: c.user, Password: c.password, Language: 7, AppVersion: '1.32.1.0', Persist: true, CaptchaResponse: null }, timeout: 15000 });
  if (!r || r.ErrorId != null || !r.LoginData) throw new Error('MELCloud : ' + (r && r.ErrorId === 1 ? 'identifiants refusés' : 'connexion impossible'));
  SES[c.user] = { k: r.LoginData.ContextKey, exp: Date.now() + 6 * 36e5 }; return SES[c.user].k;
}
// les appareils sont rangés par bâtiment, étage et zone
const flat = st => [].concat(st.Devices || [], ...(st.Floors || []).map(f => [].concat(f.Devices || [], ...(f.Areas || []).map(a => a.Devices || []))), ...(st.Areas || []).map(a => a.Devices || []));
module.exports = {
  id: 'melcloud', name: 'MELCloud', poll: 60000, secrets: ['password'],
  async test(c) { const l = await module.exports.devices(c); return l.length + ' climatisation(s)'; },
  async devices(c) {
    const b = await json(API + 'User/ListDevices', { headers: { 'X-MitsContextKey': await key(c) }, timeout: 15000 });
    return (b || []).flatMap(x => flat(x.Structure || {}).filter(d => d.Device && (d.Device.DeviceType === 0 || d.Device.DeviceType == null)).map(d => {
      const v = d.Device;
      return { id: d.DeviceID + ':' + d.BuildingID, name: d.DeviceName, kind: 'clim', info: 'MELCloud · ' + (x.Name || ''), state: { on: !!v.Power, temp: v.SetTemperature, cur: v.RoomTemperature, hvac: v.Power ? MODE[v.OperationMode] || 'Auto' : 'Arrêt', modes: ['Auto', 'Chaud', 'Froid', 'Sec', 'Ventilation'] } };
    }));
  },
  async command(c, id, p, cur) {
    cur = cur || {}; const [dev] = id.split(':'), b = { DeviceID: +dev, EffectiveFlags: 0, HasPendingCommand: true, Power: !!cur.on, SetTemperature: cur.temp, OperationMode: MODEI[cur.hvac] || 8 };
    if ('on' in p) { b.Power = !!p.on; b.EffectiveFlags |= 1; }
    if (p.hvac) { if (p.hvac === 'Arrêt') { b.Power = false; b.EffectiveFlags |= 1; } else { b.Power = true; b.OperationMode = MODEI[p.hvac] || 8; b.EffectiveFlags |= 3; } }
    if ('temp' in p) { b.SetTemperature = Math.round(p.temp * 2) / 2; b.EffectiveFlags |= 4; }
    if (b.EffectiveFlags) await json(API + 'Device/SetAta', { body: b, headers: { 'X-MitsContextKey': await key(c) }, timeout: 15000 });
  }
};

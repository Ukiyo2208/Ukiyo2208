// tado° — thermostats et têtes de radiateur, clims (Smart AC). API du compte tado, connexion par code (sans mot de passe stocké).
'use strict';
const { json, request } = require('./net');
const CLIENT = '1bb50063-6b0c-4d11-bd99-387f4a91cc46', LOGIN = 'https://login.tado.com/oauth2', API = 'https://my.tado.com/api/v2';
async function auth(c, h) {
  const t = c.tokens || {}; if (!t.refresh) throw new Error('compte tado non relié : « Se connecter »');
  if (t.access && Date.now() < t.exp - 60000) return { Authorization: 'Bearer ' + t.access };
  const r = await json(LOGIN + '/token', { form: { client_id: CLIENT, grant_type: 'refresh_token', refresh_token: t.refresh } }).catch(() => null);
  if (!r || !r.access_token) throw new Error('session tado expirée : « Se connecter » à nouveau');
  const tokens = { access: r.access_token, refresh: r.refresh_token || t.refresh, exp: Date.now() + r.expires_in * 1000 }; c.tokens = tokens; if (h && h.save) h.save({ tokens });
  return { Authorization: 'Bearer ' + tokens.access };
}
const home = async (c, H) => { if (!c.homeId) c.homeId = (await json(API + '/me', { headers: H })).homes[0].id; return c.homeId; };
const MODE = { COOL: 'Froid', HEAT: 'Chaud', DRY: 'Sec', FAN: 'Ventilation', AUTO: 'Auto' }, BACK = { Froid: 'COOL', Chaud: 'HEAT', Sec: 'DRY', Ventilation: 'FAN', Auto: 'AUTO' };
module.exports = {
  id: 'tado', name: 'tado°', poll: 60000, secrets: ['tokens', 'deviceCode'],
  actions: {
    async login() {   // étape 1 : un lien + un code à valider sur le site tado
      const r = await json(LOGIN + '/device_authorize', { form: { client_id: CLIENT, scope: 'offline_access' } });
      return { deviceCode: r.device_code, info: 'Ouvrez ' + r.verification_uri_complete + ' , connectez-vous et validez, puis « Terminer »' };
    },
    async finish(c) {
      if (!c.deviceCode) throw new Error('commencez par « Se connecter »');
      const r = await json(LOGIN + '/token', { form: { client_id: CLIENT, device_code: c.deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' } }).catch(() => null);
      if (!r || !r.access_token) throw new Error('pas encore validé sur le site tado');
      return { deviceCode: '', tokens: { access: r.access_token, refresh: r.refresh_token, exp: Date.now() + r.expires_in * 1000 }, status: 'ok', info: 'Compte tado relié' };
    }
  },
  async test(c, h) { const H = await auth(c, h), me = await json(API + '/me', { headers: H }); return me.homes.map(x => x.name).join(', '); },
  async devices(c, h) {
    const H = await auth(c, h), id = await home(c, H), [zones, st] = await Promise.all([json(API + '/homes/' + id + '/zones', { headers: H }), json(API + '/homes/' + id + '/zoneStates', { headers: H })]);
    return zones.filter(z => z.type !== 'HOT_WATER').map(z => {
      const s = (st.zoneStates || {})[z.id] || {}, set = s.setting || {}, sd = s.sensorDataPoints || {};
      return { id: String(z.id), name: z.name, room: z.name, kind: 'clim', info: z.type === 'AIR_CONDITIONING' ? 'Clim tado' : 'Chauffage tado', state: { on: set.power === 'ON', temp: set.temperature ? set.temperature.celsius : 20, cur: sd.insideTemperature ? sd.insideTemperature.celsius : null, hum: sd.humidity ? sd.humidity.percentage : null, hvac: z.type === 'AIR_CONDITIONING' ? (MODE[set.mode] || 'Auto') : 'Chaud', type: z.type } };
    });
  },
  async command(c, id, p, cur, h) {
    const H = await auth(c, h), hid = await home(c, H), url = API + '/homes/' + hid + '/zones/' + id + '/overlay';
    if (p.hvac === 'Auto' && cur.type !== 'AIR_CONDITIONING') return request(url, { method: 'DELETE', headers: H });   // retour au programme
    const type = cur.type || 'HEATING', on = 'on' in p ? p.on : cur.on !== false, setting = { type, power: on ? 'ON' : 'OFF' };
    if (on) { setting.temperature = { celsius: 'temp' in p ? p.temp : cur.temp || 20 }; if (type === 'AIR_CONDITIONING') setting.mode = BACK[p.hvac || cur.hvac] || 'COOL'; }
    await request(url, { method: 'PUT', headers: H, body: { setting, termination: { typeSkillBasedApp: 'NEXT_TIME_BLOCK' } } });
  }
};

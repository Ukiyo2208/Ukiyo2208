// Somfy TaHoma (switch, v2…) — API locale officielle « mode développeur ».
// Le jeton local est généré une seule fois via le cloud Somfy (e-mail + mot de passe, non conservés),
// ensuite tout passe en direct par la box sur le réseau : https://IP-de-la-box:8443
'use strict';
const { request, json } = require('./net');
const CLOUD = 'https://ha101-1.overkiz.com/enduser-mobile-web/enduserAPI';   // serveur Somfy Europe

const base = c => 'https://' + String(c.host || ('gateway-' + c.pin + '.local')).replace(/^https?:\/\//, '').replace(/:\d+$/, '').replace(/\/.*$/, '') + ':8443/enduser-mobile-web/1/enduserAPI';
const api = (c, path, body) => json(base(c) + path, { insecure: true, headers: { Authorization: 'Bearer ' + c.token }, body });
const KIND = { RollerShutter: 'cover', ExteriorVenetianBlind: 'cover', VenetianBlind: 'cover', Window: 'cover', Curtain: 'cover', Shutter: 'cover', GarageDoor: 'garage', Gate: 'garage', Awning: 'awning', ExteriorScreen: 'awning', Pergola: 'awning', Light: 'light', OnOff: 'plug' };
const st = (d, n) => { const s = (d.states || []).find(x => x.name === n); return s ? s.value : undefined; };
function state(d) {
  const kind = KIND[d.uiClass];
  if (kind === 'light' || kind === 'plug') return { on: st(d, 'core:OnOffState') === 'on' };
  const cl = st(d, 'core:ClosureState'), oc = st(d, 'core:OpenClosedState');
  if (typeof cl === 'number') return { pos: 100 - cl };                 // Somfy : 100 = fermé ; Bêta OS : 100 = ouvert
  if (oc) return { pos: oc === 'closed' ? 0 : 100 };
  return {};                                                           // moteurs RTS : pas de retour d'état
}

module.exports = {
  id: 'tahoma', name: 'Somfy TaHoma', poll: 5000, secrets: ['token'],
  actions: {
    // crée et active le jeton local à partir du compte Somfy
    async token(c, b) {
      if (!b.pin || !b.email || !b.password) throw new Error('PIN, e-mail et mot de passe requis');
      const login = await request(CLOUD + '/login', { form: { userId: b.email, userPassword: b.password } });
      const cookie = (login.headers['set-cookie'] || []).map(x => x.split(';')[0]).join('; ');
      if (!cookie) throw new Error('connexion Somfy refusée');
      const g = await json(CLOUD + '/config/' + b.pin + '/local/tokens/generate', { headers: { Cookie: cookie } });
      await request(CLOUD + '/config/' + b.pin + '/local/tokens', { headers: { Cookie: cookie }, body: { label: 'Bêta OS', token: g.token, scope: 'devmode' } });
      return { pin: b.pin, host: b.host || c.host || '', token: g.token };
    }
  },
  async test(c) {
    if (!c.token) throw new Error('jeton manquant : utilisez « Créer le jeton »');
    const g = await api(c, '/setup/gateways');
    return (g && g[0] && g[0].connectivity ? 'Box ' + g[0].connectivity.protocolVersion : 'Box') + ' en ligne';
  },
  async devices(c) {
    return (await api(c, '/setup/devices')).filter(d => KIND[d.uiClass]).map(d => ({ id: d.deviceURL, name: d.label, kind: KIND[d.uiClass], info: d.controllableName, state: state(d) }));
  },
  async command(c, id, p, cur) {
    let cmd;
    if ('moving' in p && p.moving === 'stop') cmd = { name: 'stop' };
    else if ('pos' in p) cmd = p.pos >= 100 ? { name: 'open' } : p.pos <= 0 ? { name: 'close' } : { name: 'setClosure', parameters: [100 - Math.round(p.pos)] };
    else if ('on' in p) cmd = { name: p.on ? 'on' : 'off' };
    if (!cmd) return;
    await api(c, '/exec/apply', { label: 'Bêta OS', actions: [{ deviceURL: id, commands: [cmd] }] });
  }
};

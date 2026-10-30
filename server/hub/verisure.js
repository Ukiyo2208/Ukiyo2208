// Verisure — alarme (état, armer, désarmer), détecteurs d'ouverture. API NON officielle (celle de l'appli « My Verisure ») :
// elle peut changer sans prévenir. Connexion avec code SMS une fois, puis l'appareil est « de confiance ».
'use strict';
const { request } = require('./net');
const BASES = ['https://automation01.verisure.com', 'https://automation02.verisure.com'];
const HEAD = { APPLICATION_ID: 'PS_PYTHON', Accept: 'application/json' };
const cookiesOf = r => (r.headers['set-cookie'] || []).map(x => x.split(';')[0]);
const merge = (old, add) => { const m = {}; String(old || '').split('; ').concat(add).filter(Boolean).forEach(x => { const i = x.indexOf('='); m[x.slice(0, i)] = x.slice(i + 1); }); return Object.keys(m).map(k => k + '=' + m[k]).join('; '); };
async function post(path, o, base) {
  for (const b of base ? [base] : BASES) {
    try { const r = await request(b + path, Object.assign({ raw: true, timeout: 15000 }, o)); if (r.status < 500) return Object.assign(r, { base: b }); } catch (e) { }
  }
  throw new Error('serveurs Verisure injoignables');
}
async function gql(c, h, op, query, variables) {
  let r = await post('/graphql', { headers: Object.assign({}, HEAD, { Cookie: c.session }), body: [{ operationName: op, variables, query }] }, c.base);
  if (r.status === 401) { await relog(c, h); r = await post('/graphql', { headers: Object.assign({}, HEAD, { Cookie: c.session }), body: [{ operationName: op, variables, query }] }, c.base); }
  const j = r.json(); const x = Array.isArray(j) ? j[0] : j; if (x && x.errors && x.errors.length) throw new Error(x.errors[0].message); return x && x.data;
}
async function relog(c, h) {   // grâce au cookie « de confiance », pas de nouveau SMS
  const r = await post('/auth/login', { method: 'POST', headers: Object.assign({}, HEAD, { Authorization: 'Basic ' + Buffer.from(c.email + ':' + c.password).toString('base64'), Cookie: c.session || '' }) });
  if (r.status >= 400) throw new Error('connexion Verisure refusée : refaites « Se connecter »');
  c.session = merge(c.session, cookiesOf(r)); c.base = r.base; if (h && h.save) h.save({ session: c.session, base: c.base });
}
const giid = async (c, h) => c.giid || (await gql(c, h, 'fetchAllInstallations', 'query fetchAllInstallations($email: String!) { account(email: $email) { installations { giid alias } } }', { email: c.email })).account.installations[0].giid;
const MODE = { DISARMED: 'disarmed', ARMED_HOME: 'armed_home', ARMED_AWAY: 'armed_away' };
module.exports = {
  id: 'verisure', name: 'Verisure', poll: 60000, secrets: ['password', 'session', 'code'],
  actions: {
    async login(c, b) {
      const email = b.email || c.email, password = b.password && b.password !== '••••' ? b.password : c.password;
      if (!email || !password) throw new Error('e-mail et mot de passe Verisure requis');
      const r = await post('/auth/login', { method: 'POST', headers: Object.assign({}, HEAD, { Authorization: 'Basic ' + Buffer.from(email + ':' + password).toString('base64') }) });
      if (r.status >= 400) throw new Error('e-mail ou mot de passe Verisure refusé');
      const j = r.json() || {}, session = merge('', cookiesOf(r));
      if (j.stepUpToken || /stepUp|mfa/i.test(r.text)) { await post('/auth/mfa?type=phone', { method: 'POST', headers: Object.assign({}, HEAD, { Cookie: session }) }, r.base); return { email, password, session, base: r.base, info: 'Code envoyé par SMS : saisissez-le puis « Valider le code »' }; }
      return { email, password, session, base: r.base, status: 'ok', info: 'Compte Verisure relié' };
    },
    async verify(c, b) {
      const code = String(b.smsCode || '').trim(); if (!code) throw new Error('saisissez le code reçu par SMS');
      const r = await post('/auth/mfa/validate', { headers: Object.assign({}, HEAD, { Cookie: c.session }), body: { token: code } }, c.base);
      if (r.status >= 400) throw new Error('code refusé');
      let session = merge(c.session, cookiesOf(r));
      const t = await post('/auth/trust', { method: 'POST', headers: Object.assign({}, HEAD, { Cookie: session }) }, c.base); session = merge(session, cookiesOf(t));
      return { session, status: 'ok', info: 'Compte Verisure relié (appareil de confiance)' };
    }
  },
  async test(c, h) { if (!c.session) throw new Error('utilisez « Se connecter »'); const g = await giid(c, h); return 'Installation ' + g; },
  async devices(c, h) {
    if (!c.session) return [];
    const g = await giid(c, h), d = await gql(c, h, 'Overview', 'query Overview($giid: String!) { installation(giid: $giid) { armState { type statusType date name changedVia } doorWindows { device { deviceLabel area } type state } climates { device { deviceLabel area } temperatureValue humidityValue } } }', { giid: g }), i = d.installation, out = [];
    out.push({ id: 'alarm', name: 'Alarme Verisure', kind: 'alarm', info: i.armState.name ? 'Dernier changement : ' + i.armState.name : 'Verisure', state: { mode: MODE[i.armState.statusType] || 'disarmed' } });
    (i.doorWindows || []).forEach(x => out.push({ id: 'dw:' + x.device.deviceLabel, name: x.device.area || 'Ouverture', room: x.device.area, kind: 'door', info: 'Détecteur Verisure', state: { on: x.state === 'OPEN' } }));
    (i.climates || []).forEach(x => { if (x.temperatureValue != null) out.push({ id: 'cl:' + x.device.deviceLabel, name: 'Température ' + (x.device.area || ''), room: x.device.area, kind: 'temp', info: 'Détecteur Verisure', state: { val: x.temperatureValue, unit: '°C' } }); });
    return out;
  },
  async command(c, id, p, cur, h) {
    if (id !== 'alarm' || !p.mode) return;
    const code = String(p.code || c.code || ''); if (!code) throw new Error('code de l’alarme requis');
    const g = await giid(c, h), m = { disarmed: 'armStateDisarm', armed_home: 'armStateArmHome', armed_away: 'armStateArmAway' }[p.mode]; if (!m) return;
    await gql(c, h, m, 'mutation ' + m + '($giid: String!, $code: String!) { ' + m + '(giid: $giid, code: $code) }', { giid: g, code });
  }
};

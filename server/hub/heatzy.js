// Heatzy — boîtiers fil pilote (Pilote, Pilote Pro, Glow, Onyx) pour radiateurs électriques : Confort, Éco, Hors-gel, Arrêt.
// API cloud Heatzy (identifiants de l'application). Les anciens « Pilote v1 » répondent en chinois : traduits ici.
'use strict';
const { json } = require('./net');
const API = 'https://euapi.gizwits.com/app/', APP = 'c70a66ff039d41b4a220e198b0fcc8b3';
const SES = {};
const V1 = { '舒适': 'Confort', '经济': 'Éco', '解冻': 'Hors-gel', '停止': 'Arrêt' }, V2 = { cft: 'Confort', cft1: 'Confort', cft2: 'Confort', eco: 'Éco', fro: 'Hors-gel', stop: 'Arrêt', off: 'Arrêt' };
const TO2 = { Confort: 'cft', 'Éco': 'eco', 'Hors-gel': 'fro', 'Arrêt': 'stop' }, TO1 = { Confort: 0, 'Éco': 1, 'Hors-gel': 2, 'Arrêt': 3 };
async function token(c, fresh) {
  const k = c.user, s = SES[k]; if (s && !fresh && s.exp > Date.now()) return s.t;
  const r = await json(API + 'login', { body: { username: c.user, password: c.password, lang: 'fr' }, headers: { 'X-Gizwits-Application-Id': APP }, timeout: 10000 });
  if (!r || !r.token) throw new Error('Heatzy : identifiants refusés');
  SES[k] = { t: r.token, exp: (r.expire_at ? r.expire_at * 1000 : Date.now() + 864e5) - 36e5 }; return r.token;
}
const H = async c => ({ 'X-Gizwits-Application-Id': APP, 'X-Gizwits-User-token': await token(c) });
const modeOf = a => { const m = a && a.mode; return V1[m] || V2[m] || (typeof m === 'number' ? ['Confort', 'Éco', 'Hors-gel', 'Arrêt'][m] : 'Confort'); };
module.exports = {
  id: 'heatzy', name: 'Heatzy', poll: 30000, secrets: ['password'],
  async test(c) { const b = await json(API + 'bindings?limit=50&skip=0', { headers: await H(c), timeout: 10000 }); return (b.devices || []).length + ' boîtier(s) Heatzy'; },
  async devices(c) {
    const h = await H(c), b = await json(API + 'bindings?limit=50&skip=0', { headers: h, timeout: 10000 }), out = [];
    for (const d of b.devices || []) {
      try { const l = await json(API + 'devdata/' + d.did + '/latest', { headers: h, timeout: 10000 }), m = modeOf(l.attr);
        out.push({ id: d.did, name: d.dev_alias || d.product_name || 'Radiateur', kind: 'clim', info: 'Heatzy ' + (d.product_name || '') + (d.is_online === false ? ' · hors ligne' : ''), state: { on: m !== 'Arrêt', hvac: m === 'Arrêt' ? 'Arrêt' : 'Chaud', preset: m === 'Arrêt' ? 'Aucun' : m, presets: ['Confort', 'Éco', 'Hors-gel'], modes: ['Chaud', 'Arrêt'], temp: l.attr && l.attr.cft_tempL ? l.attr.cft_tempL / 10 : undefined, v1: !!V1[l.attr && l.attr.mode] } }); }
      catch (e) { out.push({ id: d.did, name: d.dev_alias || 'Radiateur', kind: 'clim', error: e.message, state: {} }); }
    }
    return out;
  },
  async command(c, id, p, cur) {
    const m = p.preset && p.preset !== 'Aucun' ? p.preset : p.hvac === 'Arrêt' || p.on === false ? 'Arrêt' : p.hvac === 'Chaud' || p.on === true ? 'Confort' : null;
    if (!m) return;
    const body = cur && cur.v1 ? { raw: [1, 1, TO1[m]] } : { attrs: { mode: TO2[m] } };
    await json(API + 'control/' + id, { body, headers: await H(c), timeout: 10000 });
  },
  _modeOf: modeOf
};

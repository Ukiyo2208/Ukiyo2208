// Viessmann (ViCare) — API officielle, connexion OAuth (PKCE, sans secret). Lecture seule :
// température extérieure, départ chauffage, eau chaude. Régler le thermostat exige l'offre payante « Advanced ».
// Quota de l'offre gratuite : 1 450 appels par jour → relecture toutes les 5 minutes, installations gardées 6 h.
'use strict';
const { json } = require('./net');
const API = 'https://api.viessmann-climatesolutions.com/iot/v1';
let inst = { at: 0, list: [] };

const val = (F, name, k) => { const f = F[name], p = f && f.properties && f.properties[k || 'value']; return p ? p.value : undefined; };
async function installations(h) {
  if (Date.now() - inst.at < 6 * 36e5 && inst.list.length) return inst.list;
  const r = await json(API + '/equipment/installations?includeGateways=true', { headers: await h.auth() });
  inst = { at: Date.now(), list: [] };
  (r.data || []).forEach(i => (i.gateways || []).forEach(g => (g.devices || []).filter(d => d.deviceType === 'heating').forEach(d => inst.list.push({ iid: i.id, serial: g.serial, did: d.id, name: i.description || d.modelId || 'Chaudière', model: d.modelId }))));
  return inst.list;
}

module.exports = {
  id: 'viessmann', name: 'Viessmann', poll: 300000, secrets: ['tokens'],
  oauth: { auth: 'https://iam.viessmann-climatesolutions.com/idp/v3/authorize', token: 'https://iam.viessmann-climatesolutions.com/idp/v3/token', scope: 'IoT User offline_access', pkce: true },
  async test(c, h) { inst.at = 0; const l = await installations(h); if (!l.length) throw new Error('aucune chaudière trouvée sur ce compte'); return l.length + ' chaudière(s) · ' + (l[0].model || ''); },
  async devices(c, h) {
    const out = [];
    for (const d of await installations(h)) {
      const r = await json(API + '/features/installations/' + d.iid + '/gateways/' + d.serial + '/devices/' + d.did + '/features', { headers: await h.auth() }), F = {};
      (r.data || []).forEach(f => { if (f.isEnabled !== false) F[f.feature] = f; });
      const base = d.iid + '|' + d.serial + '|' + d.did + '|', round = v => Math.round(v * 10) / 10;
      const out1 = val(F, 'heating.sensors.temperature.outside'), sup = val(F, 'heating.circuits.0.sensors.temperature.supply'), dhw = val(F, 'heating.dhw.sensors.temperature.hotWaterStorage'), dhwT = val(F, 'heating.dhw.temperature.main');
      const prog = val(F, 'heating.circuits.0.operating.programs.active'), mode = val(F, 'heating.dhw.operating.modes.active') || val(F, 'heating.circuits.0.operating.modes.active');
      const PRG = { normal: 'Normal', reduced: 'Réduit', comfort: 'Confort', eco: 'Éco', standby: 'Veille', dhw: 'Eau chaude seule', dhwAndHeating: 'Chauffage + eau chaude', balanced: 'Équilibré', off: 'Arrêt' };
      if (typeof out1 === 'number') out.push({ id: base + 'outside', name: 'Température extérieure', kind: 'temp', info: d.name, state: { val: round(out1), unit: '°C' } });
      if (typeof sup === 'number') out.push({ id: base + 'supply', name: 'Départ chauffage', kind: 'temp', info: d.name + (prog ? ' · programme ' + (PRG[prog] || prog) : ''), state: { val: round(sup), unit: '°C' } });
      if (typeof dhw === 'number' || typeof dhwT === 'number') out.push({ id: base + 'dhw', name: 'Eau chaude', kind: 'heater', info: d.name, state: Object.assign({ on: val(F, 'heating.dhw', 'active') !== false, mode: PRG[mode] || mode || '—' }, typeof dhwT === 'number' ? { temp: dhwT } : {}, typeof dhw === 'number' ? { val: round(dhw) } : {}) });
    }
    return out;
  },
  async command() { throw new Error('Viessmann : lecture seule (le réglage du chauffage demande l’offre payante « Advanced »)'); }
};

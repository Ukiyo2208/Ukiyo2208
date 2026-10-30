// Appareils par adresse web — tout appareil qui se commande par une simple URL (ESPEasy, modules maison, relais Wi-Fi,
// box domotiques…). Une ligne par appareil :  Nom | type | URL allumer | URL éteindre | URL état | clé de l'état
//   type : prise, lumière, volet, capteur (°C, %, W…)   — « POST » devant une URL pour l'envoyer en POST.
'use strict';
const { request } = require('./net');
const KINDS = { prise: 'plug', lumiere: 'light', 'lumière': 'light', volet: 'cover', capteur: 'meter', temperature: 'temp', 'température': 'temp', humidite: 'hum', 'humidité': 'hum', porte: 'door', mouvement: 'motion' };
function lines(c) {
  return String(c.devices || '').split(/\r?\n|;;/).map(l => l.trim()).filter(l => l && !l.startsWith('#')).map((l, i) => {
    const [name, type, on, off, st, key, unit] = l.split('|').map(x => (x || '').trim());
    return { id: 'h' + i + '_' + (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 12), name: name || 'Appareil ' + (i + 1), kind: KINDS[(type || 'prise').toLowerCase()] || 'plug', on, off, st, key, unit };
  });
}
const call = u => { const m = /^(POST|PUT|GET)\s+(.*)$/i.exec(u || ''); return request(m ? m[2] : u, { method: m ? m[1].toUpperCase() : 'GET', body: m && m[1].toUpperCase() !== 'GET' ? '' : undefined, timeout: 6000 }); };
// valeur dans la réponse : clé « a.b.0.c » pour du JSON, sinon le texte ou une expression régulière /…/
function pick(r, key) {
  if (key && key.startsWith('/')) { const m = new RegExp(key.replace(/^\/|\/$/g, '')).exec(r.text); return m ? (m[1] !== undefined ? m[1] : m[0]) : null; }
  const j = r.json(); if (j == null || !key) return j != null && typeof j !== 'object' ? j : r.text.trim();
  return key.split('.').reduce((o, k) => o == null ? o : o[k], j);
}
const truthy = v => v === true || /^(1|on|true|open|ouvert|yes|oui)$/i.test(String(v).trim()) || (typeof v === 'number' && v > 0);
module.exports = {
  id: 'http', name: 'Adresse web (HTTP)', poll: 10000, secrets: [],
  async test(c) { const l = lines(c); if (!l.length) throw new Error('aucun appareil décrit'); const bad = l.filter(x => !x.on && !x.st); if (bad.length) throw new Error('« ' + bad[0].name + ' » : il manque l’URL'); return l.length + ' appareil(s)'; },
  async devices(c) {
    return Promise.all(lines(c).map(async x => {
      const d = { id: x.id, name: x.name, kind: x.kind, info: 'Adresse web', state: {} };
      if (!x.st) return d;
      try {
        const v = pick(await call(x.st), x.key);
        if (['meter', 'temp', 'hum'].includes(x.kind)) d.state = { val: v == null ? null : parseFloat(String(v).replace(',', '.')), unit: x.unit || (x.kind === 'temp' ? '°C' : x.kind === 'hum' ? '%' : '') };
        else if (x.kind === 'cover') d.state = { pos: isNaN(+v) ? (truthy(v) ? 100 : 0) : +v };
        else d.state = { on: truthy(v) };
      } catch (e) { d.error = e.message; }
      return d;
    }));
  },
  async command(c, id, p) {
    const x = lines(c).find(l => l.id === id); if (!x) throw new Error('appareil inconnu');
    const on = 'on' in p ? p.on : 'pos' in p ? p.pos > 0 : 'bri' in p ? p.bri > 0 : null;
    if (on === null) return;
    const u = on ? x.on : x.off; if (!u) throw new Error('pas d’URL pour ' + (on ? 'allumer' : 'éteindre'));
    await call(u.replace(/\{val\}/g, String(Math.round(p.bri != null ? p.bri : p.pos != null ? p.pos : on ? 100 : 0))));
  },
  _lines: lines, _pick: pick
};

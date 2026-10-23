// Apple HomePod (et Apple TV) — en local via pyatv, dans le pont Python. Musique en cours, lecture/pause, volume.
'use strict';
const { py } = require('./py');

module.exports = {
  id: 'homepod', name: 'Apple HomePod', poll: 5000, secrets: [],
  actions: {
    // recherche des HomePod / Apple TV sur le réseau (ou aux adresses IP données)
    async scan(c, b) {
      const l = await py(c, '/homepod/scan', { hosts: b.hosts || c.hosts || '' }, { timeout: 20000 });
      if (!l.length) throw new Error('aucun appareil Apple trouvé : saisissez leurs adresses IP');
      return { hosts: b.hosts || c.hosts || '', known: l, status: 'ok', info: l.length + ' appareil(s) Apple trouvé(s)' };
    },
    // appairage (seulement si l'appareil le demande) : 1er clic = un code s'affiche, 2e clic avec le code
    async pair(c, b) {
      const want = String(b.device || '').toLowerCase(), d = (c.known || []).find(x => x.name.toLowerCase() === want || x.address === want) || (c.known || [])[0];
      if (!d) throw new Error('lancez d’abord « Rechercher »');
      if (!b.pin) { const r = await py(c, '/homepod/pair/start', { id: d.id }); if (r.pin) throw new Error('saisissez le code affiché par « ' + d.name + ' » puis cliquez à nouveau « Appairer »'); }
      await py(c, '/homepod/pair/finish', { id: d.id, pin: b.pin || '' });
      return { info: '« ' + d.name + ' » appairé' };
    }
  },
  async test(c) {
    await py(c, '/health');
    const n = (c.known || []).length;
    if (!n) throw new Error('pont Python prêt : cliquez « Rechercher »');
    return n + ' appareil(s) Apple';
  },
  async devices(c) {
    const known = c.known || []; if (!known.length) return [];
    const st = await py(c, '/homepod/states?ids=' + known.map(d => encodeURIComponent(d.id)).join(','), null, { timeout: 25000 });
    return known.map(d => { const s = st[d.id] || {}; return { id: d.id, name: d.name, kind: d.kind, info: d.model + (s.error ? ' · ' + s.error : ''), state: s.error ? {} : s }; });
  },
  async command(c, id, p) {
    const patch = {}; if ('on' in p) patch.on = !!p.on; if ('vol' in p) patch.vol = Math.max(0, Math.min(100, +p.vol));
    if (Object.keys(patch).length) await py(c, '/homepod/command', { id, patch });
  }
};

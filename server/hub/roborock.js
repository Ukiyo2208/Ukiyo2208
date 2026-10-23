// Roborock — via python-roborock (API non officielle, compte Roborock) dans le pont Python.
// Connexion par code reçu par e-mail, puis départ, pause, retour à la base, batterie.
'use strict';
const { py } = require('./py');

module.exports = {
  id: 'roborock', name: 'Roborock', poll: 30000, secrets: [],
  actions: {
    async code(c, b) { if (!b.email) throw new Error('e-mail du compte Roborock manquant'); await py(c, '/roborock/code', { email: b.email }); return { email: b.email, info: 'Code envoyé à ' + b.email }; },
    async login(c, b) { const email = b.email || c.email; if (!email || !b.code) throw new Error('e-mail et code requis'); await py(c, '/roborock/login', { email, code: b.code }, { timeout: 30000 }); return { email, status: 'ok', info: 'Compte relié' }; }
  },
  async test(c) { const l = await py(c, '/roborock/devices', null, { timeout: 45000 }); return l.length + ' robot(s)' + (l[0] ? ' · ' + l[0].model : ''); },
  async devices(c) {
    return (await py(c, '/roborock/devices', null, { timeout: 45000 })).map(d => ({ id: d.id, name: d.name, kind: 'vacuum', info: d.model + (d.error ? ' · ' + d.error : ''), state: d.state || {} }));
  },
  async command(c, id, p) { if (p.status) await py(c, '/roborock/command', { id, patch: { status: p.status === 'zone' ? 'cleaning' : p.status } }, { timeout: 30000 }); }
};

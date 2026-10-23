// Appels au pont Python (server/py/bridge.py) : HomePod et Roborock. Même clé secrète que le serveur Bêta.
'use strict';
const { request } = require('./net');
const base = c => String(c.url || 'http://host.docker.internal:8099').replace(/\/+$/, '');
async function py(c, path, body, o) {
  const r = await request(base(c) + path, Object.assign({ headers: { 'X-Beta-Key': process.env.BETA_KEY || '' }, body, raw: true }, o)).catch(e => { throw new Error(/injoignable/.test(e.message) ? 'pont Python injoignable (service « py » du projet Docker)' : e.message); });
  const j = r.json();
  if (r.status >= 300) throw new Error((j && j.error) || 'pont Python : HTTP ' + r.status);
  return j;
}
module.exports = { py };

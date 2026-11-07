// UniFi Protect (Ubiquiti) — caméras et sonnettes G4 : mouvement, détection intelligente, appui sur la sonnette.
// Utilisez un compte local en lecture seule créé dans UniFi OS.
'use strict';
const { request } = require('./net');
const base = c => 'https://' + String(c.host || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
const S = {};
async function api(c, path) {
  const b = base(c);
  for (let i = 0; i < 2; i++) {
    if (!S[b]) {
      const r = await request(b + '/api/auth/login', { insecure: true, body: { username: c.user, password: c.password, rememberMe: true }, raw: true });
      if (r.status >= 400) throw new Error('identifiant UniFi refusé');
      S[b] = { cookie: (r.headers['set-cookie'] || []).map(x => x.split(';')[0]).join('; '), csrf: r.headers['x-csrf-token'] || '' };
    }
    const r = await request(b + path, { insecure: true, headers: { Cookie: S[b].cookie, 'X-CSRF-Token': S[b].csrf }, raw: true, timeout: 10000 });
    if (r.status === 401) { delete S[b]; continue; }
    if (r.status >= 400) throw new Error('HTTP ' + r.status);
    return r.json();
  }
  throw new Error('session UniFi refusée');
}
module.exports = {
  id: 'unifiprotect', name: 'UniFi Protect', poll: 3000, secrets: ['password'],
  async test(c) { const b = await api(c, '/proxy/protect/api/bootstrap'); return (b.cameras || []).length + ' caméra(s) · ' + ((b.nvr && b.nvr.name) || 'Protect'); },
  async devices(c) {
    const b = await api(c, '/proxy/protect/api/bootstrap'), now = Date.now(), out = [];
    (b.cameras || []).forEach(cam => {
      const recent = t => t && now - t < 20000;
      out.push({ id: cam.id, name: 'Détection ' + cam.name, kind: 'motion', info: cam.marketName || cam.type, state: { on: !!cam.isMotionDetected || !!cam.isSmartDetected || recent(cam.lastMotion), last: cam.lastMotion || 0 } });
      if (cam.featureFlags && cam.featureFlags.isDoorbell) out.push({ id: cam.id + '#ring', name: 'Sonnette ' + cam.name, kind: 'motion', info: 'Appui sur la sonnette', state: { on: recent(cam.lastRing), pressed: cam.lastRing || 0 } });
    });
    return out;
  },
  async command() { }
};

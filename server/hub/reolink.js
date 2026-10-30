// Reolink (caméras et sonnette vidéo) — API locale : détection de mouvement, de personne/véhicule/animal, appui sur la sonnette.
'use strict';
const { request } = require('./net');
const hosts = c => String(c.hosts || '').split(/[,;\s]+/).filter(Boolean);
const tok = {};
async function cmd(c, ip, name, param) {
  const b = (/^https?:/.test(ip) ? ip : 'http://' + ip).replace(/\/+$/, '');
  const call = async (q, body) => { const r = await request(b + '/api.cgi?' + q, { insecure: true, body, timeout: 6000 }); const j = r.json(); return Array.isArray(j) ? j[0] : j; };
  if (!tok[ip] || Date.now() > tok[ip].exp) {
    const r = await call('cmd=Login', [{ cmd: 'Login', param: { User: { Version: '0', userName: c.user || 'admin', password: c.password || '' } } }]);
    if (!r || r.code !== 0) throw new Error('identifiant Reolink refusé'); tok[ip] = { t: r.value.Token.name, exp: Date.now() + (r.value.Token.leaseTime - 60) * 1000 };
  }
  const r = await call('cmd=' + name + '&token=' + tok[ip].t, [{ cmd: name, action: 0, param: param || { channel: 0 } }]);
  if (r && r.code !== 0) { if (r.error && /login|token/i.test(r.error.detail || '')) delete tok[ip]; throw new Error((r.error && r.error.detail) || 'erreur Reolink'); }
  return r.value;
}
module.exports = {
  id: 'reolink', name: 'Reolink', poll: 2000, secrets: ['password'],
  async test(c) { const ip = hosts(c)[0]; if (!ip) throw new Error('adresse IP manquante'); const d = await cmd(c, ip, 'GetDevInfo'); return (d.DevInfo.name || d.DevInfo.model) + ' (' + d.DevInfo.model + ')'; },
  async devices(c) {
    const out = [];
    await Promise.all(hosts(c).map(async ip => {
      try {
        const [info, md, ai] = await Promise.all([cmd(c, ip, 'GetDevInfo'), cmd(c, ip, 'GetMdState'), cmd(c, ip, 'GetAiState').catch(() => ({}))]);
        const nm = info.DevInfo.name || info.DevInfo.model, a = k => ai[k] && ai[k].support && ai[k].alarm_state === 1;
        out.push({ id: ip, name: 'Détection ' + nm, kind: 'motion', info: info.DevInfo.model, state: { on: md.state === 1 || a('people') || a('vehicle') || a('dog_cat'), label: a('people') ? 'personne' : a('vehicle') ? 'véhicule' : a('dog_cat') ? 'animal' : md.state === 1 ? 'mouvement' : '' } });
        if (/doorbell|D340|D500/i.test(info.DevInfo.model + info.DevInfo.type)) {   // sonnette : appui (visiteur)
          const ev = await cmd(c, ip, 'GetEvents').catch(() => null), v = ev && ev.visitor ? ev.visitor.alarm_state === 1 : !!(ai.visitor && ai.visitor.alarm_state === 1);
          out.push({ id: ip + '#visitor', name: 'Sonnette ' + nm, kind: 'motion', info: 'Appui sur la sonnette', state: { on: v } });
        }
      } catch (e) { out.push({ id: ip, name: 'Caméra ' + ip, kind: 'motion', error: e.message, state: {} }); }
    }));
    return out;
  },
  async command() { }
};

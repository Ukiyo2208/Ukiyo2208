// Dahua (et Amcrest, Imou en local, interphones VTO) — flux d'évènements : mouvement, personne, appui sur l'interphone.
'use strict';
const { request, keepStream } = require('./digest');
const hosts = c => String(c.hosts || '').split(/[,;\s]+/).filter(Boolean);
const st = {};
const base = ip => /^https?:/.test(ip) ? ip.replace(/\/+$/, '') : 'http://' + ip;
function listen(c, ip) {
  const s = st[ip] = st[ip] || { last: {}, bell: 0 };
  keepStream(base(ip) + '/cgi-bin/eventManager.cgi?action=attach&codes=[All]&heartbeat=20', { user: c.user || 'admin', pass: c.password || '' }, chunk => {
    String(chunk).split(/\r?\n/).forEach(l => {
      const m = l.match(/Code=(\w+);action=(\w+)/); if (!m) return;
      if (/Start|Pulse/.test(m[2])) { if (/Invite|CallNoAnswered|DoorBell|BackKeyLight/.test(m[1])) s.bell = Date.now(); else if (/Motion|Human|Cross|Intrusion|Smart/.test(m[1])) s.last[m[1]] = Date.now(); }
      if (m[2] === 'Stop') delete s.last[m[1]];
    });
  }, s);
}
module.exports = {
  id: 'dahua', name: 'Dahua / Amcrest', poll: 2000, secrets: ['password'],
  init(c) { hosts(c).forEach(ip => listen(c, ip)); },
  async test(c) { const ip = hosts(c)[0]; if (!ip) throw new Error('adresse IP manquante'); const t = await request(base(ip) + '/cgi-bin/magicBox.cgi?action=getDeviceType', { user: c.user || 'admin', pass: c.password || '' }); return 'Dahua ' + (t.split('=')[1] || '').trim(); },
  async devices(c) {
    const out = [];
    hosts(c).forEach(ip => {
      listen(c, ip); const s = st[ip], now = Date.now(), live = Object.keys(s.last).filter(k => now - s.last[k] < 60000);
      out.push({ id: ip, name: 'Détection ' + ip, kind: 'motion', info: s.err || 'Dahua', state: { on: live.length > 0, label: live.some(k => /Human/.test(k)) ? 'personne' : live.length ? 'mouvement' : '' } });
      out.push({ id: ip + '#bell', name: 'Interphone ' + ip, kind: 'motion', info: 'Appui (interphones VTO)', state: { on: now - s.bell < 15000, pressed: s.bell } });
    });
    return out;
  },
  async command() { }
};

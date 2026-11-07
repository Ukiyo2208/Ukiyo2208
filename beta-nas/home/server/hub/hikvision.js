// Hikvision (et HiLook, Annke…) — flux d'évènements ISAPI : mouvement, franchissement de ligne, intrusion, personne.
'use strict';
const { request, keepStream } = require('./digest');
const hosts = c => String(c.hosts || '').split(/[,;\s]+/).filter(Boolean);
const st = {};   // ip → { last: { type: date }, on, err }
const base = ip => /^https?:/.test(ip) ? ip.replace(/\/+$/, '') : 'http://' + ip;
function listen(c, ip) {
  const s = st[ip] = st[ip] || { last: {} };
  let buf = '';
  keepStream(base(ip) + '/ISAPI/Event/notification/alertStream', { user: c.user || 'admin', pass: c.password || '' }, chunk => {
    buf = (buf + chunk).slice(-20000);
    let m; const re = /<EventNotificationAlert[\s\S]*?<\/EventNotificationAlert>/g;
    while ((m = re.exec(buf))) {
      const x = m[0], type = (x.match(/<eventType>([^<]+)/) || [])[1], state = (x.match(/<eventState>([^<]+)/) || [])[1];
      if (type && state === 'active' && !/videoloss/i.test(type)) s.last[type] = Date.now();
    }
    buf = buf.slice(buf.lastIndexOf('</EventNotificationAlert>') + 1);
  }, s);
}
const T = { VMD: 'mouvement', linedetection: 'ligne franchie', fielddetection: 'intrusion', regionEntrance: 'entrée de zone', humanDetection: 'personne', PIR: 'mouvement' };
module.exports = {
  id: 'hikvision', name: 'Hikvision', poll: 2000, secrets: ['password'],
  init(c) { hosts(c).forEach(ip => listen(c, ip)); },
  async test(c) { const ip = hosts(c)[0]; if (!ip) throw new Error('adresse IP manquante'); const x = await request(base(ip) + '/ISAPI/System/deviceInfo', { user: c.user || 'admin', pass: c.password || '' }); return ((x.match(/<deviceName>([^<]+)/) || [])[1] || 'Hikvision') + ' (' + ((x.match(/<model>([^<]+)/) || [])[1] || '') + ')'; },
  async devices(c) {
    return hosts(c).map(ip => {
      listen(c, ip); const s = st[ip], now = Date.now(), live = Object.keys(s.last).filter(k => now - s.last[k] < 10000);
      return { id: ip, name: 'Détection ' + ip, kind: 'motion', info: s.err || 'Hikvision', state: { on: live.length > 0, label: live.map(k => T[k] || k).join(', ') } };
    });
  },
  async command() { }
};

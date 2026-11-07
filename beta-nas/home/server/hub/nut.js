// Onduleurs — serveur NUT (Network UPS Tools) : le NAS UGREEN/Synology, un Raspberry Pi ou un onduleur Eaton réseau.
// Charge de la batterie, autonomie, charge de l'onduleur, et alerte quand la maison passe sur batterie (coupure de courant).
'use strict';
const net = require('net');
const host = c => String(c.host || '').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
function talk(c, lines) {
  return new Promise((ok, ko) => {
    const [h, p] = host(c).split(':'), s = net.connect({ host: h, port: +p || 3493 }); let buf = '';
    const end = e => { s.destroy(); e ? ko(e) : ok(buf); };
    s.setTimeout(5000, () => end(new Error('serveur NUT injoignable')));
    s.on('error', e => end(new Error('serveur NUT injoignable (' + e.code + ')')));
    s.on('connect', () => s.write((c.user ? 'USERNAME ' + c.user + '\nPASSWORD ' + (c.password || '') + '\n' : '') + lines.join('\n') + '\n'));
    s.on('data', d => { buf += d; const n = (buf.match(/^END LIST /gm) || []).length; if (/^ERR /m.test(buf) && !/^ERR (USERNAME|PASSWORD)/m.test(buf)) end(new Error('NUT : ' + buf.match(/^ERR (.*)$/m)[1])); else if (n >= lines.length) end(); });
  });
}
const vars = txt => Object.fromEntries([...txt.matchAll(/^VAR \S+ (\S+) "(.*)"$/gm)].map(m => [m[1], m[2]]));
async function upsList(c) { return [...(await talk(c, ['LIST UPS'])).matchAll(/^UPS (\S+) "(.*)"$/gm)].map(m => ({ id: m[1], desc: m[2] })); }
const STATUS = s => /OB/.test(s) ? (/LB/.test(s) ? 'sur batterie, batterie faible !' : 'sur batterie (coupure de courant)') : /CHRG/.test(s) ? 'sur secteur, en charge' : /OL/.test(s) ? 'sur secteur' : s || '—';
module.exports = {
  id: 'nut', name: 'Onduleur (NUT)', poll: 20000, secrets: ['password'],
  async test(c) { const l = await upsList(c); if (!l.length) throw new Error('aucun onduleur déclaré dans NUT'); return l.map(u => u.id).join(', '); },
  async devices(c) {
    const out = [];
    for (const u of await upsList(c)) {
      const v = vars(await talk(c, ['LIST VAR ' + u.id])), st = v['ups.status'] || '', name = v['device.model'] || v['ups.model'] || u.desc || u.id, info = 'Onduleur · ' + STATUS(st);
      out.push({ id: u.id + '|ob', name: 'Coupure de courant', kind: 'door', info, state: { on: /OB/.test(st) } });
      if (v['battery.charge'] != null) out.push({ id: u.id + '|bat', name: name + ' — batterie', kind: 'meter', info, state: { val: +v['battery.charge'], unit: '%' } });
      if (v['battery.runtime'] != null) out.push({ id: u.id + '|run', name: name + ' — autonomie', kind: 'meter', info, state: { val: Math.round(+v['battery.runtime'] / 60), unit: 'min' } });
      if (v['ups.load'] != null) out.push({ id: u.id + '|load', name: name + ' — charge', kind: 'meter', info, state: { val: +v['ups.load'], unit: '%' } });
    }
    return out;
  },
  async command() { },
  _vars: vars, _status: STATUS
};

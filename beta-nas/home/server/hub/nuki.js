// Nuki (Smart Lock, Opener) — par le Nuki Bridge, API locale : verrouiller, déverrouiller, état de la porte, batterie.
'use strict';
const { json } = require('./net');
const base = c => 'http://' + String(c.host || '').replace(/^https?:\/\//, '').replace(/[:/].*$/, '') + ':' + (c.port || 8080);
const q = (c, path) => json(base(c) + path + (path.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(c.token || ''), { timeout: 30000 });
module.exports = {
  id: 'nuki', name: 'Nuki', poll: 10000, secrets: ['token'],
  async test(c) { return (await q(c, '/list')).length + ' serrure(s) Nuki'; },
  async devices(c) {
    const out = [];
    (await q(c, '/list')).forEach(l => {
      const s = l.lastKnownState || {}, bat = s.batteryCritical ? ' · pile faible' : s.batteryChargeState != null ? ' · pile ' + s.batteryChargeState + ' %' : '';
      if (l.deviceType === 2) out.push({ id: l.nukiId + ':2', name: l.name, kind: 'plug', info: 'Nuki Opener' + bat, state: { on: s.state === 3 } });
      else out.push({ id: l.nukiId + ':' + l.deviceType, name: l.name, kind: 'lock', info: 'Nuki Smart Lock' + bat, state: { locked: s.state === 1 } });
      if (s.doorsensorState === 2 || s.doorsensorState === 3) out.push({ id: l.nukiId + ':door', name: 'Porte ' + l.name, kind: 'door', info: 'Capteur de porte Nuki', state: { on: s.doorsensorState === 3 } });
    });
    return out;
  },
  async command(c, id, p) {
    const [nid, type] = id.split(':'); if (type === 'door') return;
    if ('locked' in p) await q(c, '/lockAction?nukiId=' + nid + '&deviceType=' + type + '&action=' + (p.locked ? 2 : 1));
    if (type === '2' && p.on) await q(c, '/lockAction?nukiId=' + nid + '&deviceType=2&action=3');   // Opener : ouvrir la porte de l'immeuble
  }
};

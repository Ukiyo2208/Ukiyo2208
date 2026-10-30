// Volumio — lecteur audio réseau (Raspberry Pi, Primo…) : ce qui est lu, lecture/pause, suivant, volume. API REST locale.
'use strict';
const { json, request } = require('./net');
const hosts = c => String(c.hosts || '').split(/[\s,;]+/).map(h => h.replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter(Boolean);
const cmd = (h, q) => request('http://' + h + '/api/v1/commands/?' + new URLSearchParams(q).toString(), { timeout: 5000 });
module.exports = {
  id: 'volumio', name: 'Volumio', poll: 6000, secrets: [],
  async test(c) { const h = hosts(c); if (!h.length) throw new Error('adresse IP manquante'); await json('http://' + h[0] + '/api/v1/getState', { timeout: 5000 }); return h.length + ' lecteur(s)'; },
  async devices(c) {
    const out = [];
    for (const h of hosts(c)) {
      try { const s = await json('http://' + h + '/api/v1/getState', { timeout: 5000 }); out.push({ id: h, name: 'Volumio ' + h.split('.').pop(), kind: 'speaker', info: 'Volumio' + (s.service ? ' · ' + s.service : ''), state: { on: true, playing: s.status === 'play', title: (s.artist ? s.artist + ' — ' : '') + (s.title || ''), vol: s.volume || 0, muted: !!s.mute } }); }
      catch (e) { out.push({ id: h, name: 'Volumio ' + h, kind: 'speaker', error: e.message, state: { on: false } }); }
    }
    return out;
  },
  async command(c, id, p) {
    const m = { media_play_pause: 'toggle', media_play: 'play', media_pause: 'pause', media_stop: 'stop', media_next_track: 'next', media_previous_track: 'prev' }[p.cmd] || (p.on === false ? 'stop' : null);
    if (m) await cmd(id, { cmd: m });
    if ('vol' in p) await cmd(id, { cmd: 'volume', volume: Math.round(p.vol) });
  }
};

// Lyrion Music Server (ex-Logitech Media Server) — lecteurs Squeezebox, piCorePlayer, Squeezelite. API JSON locale (port 9000).
'use strict';
const { json } = require('./net');
const url = c => { const h = String(c.host || '').trim().replace(/^https?:\/\//, '').replace(/\/+$/, ''); return 'http://' + (/:\d+$/.test(h) ? h : h + ':9000') + '/jsonrpc.js'; };
const H = c => c.user ? { Authorization: 'Basic ' + Buffer.from(c.user + ':' + (c.password || '')).toString('base64') } : {};
const req = (c, pid, cmd) => json(url(c), { body: { id: 1, method: 'slim.request', params: [pid || '', cmd] }, headers: H(c), timeout: 6000 }).then(r => r.result || {});
module.exports = {
  id: 'lms', name: 'Lyrion / Squeezebox', poll: 6000, secrets: ['password'],
  async test(c) { const r = await req(c, '', ['players', 0, 99]); return (r.players_loop || []).length + ' lecteur(s)'; },
  async devices(c) {
    const r = await req(c, '', ['players', 0, 99]), out = [];
    for (const p of r.players_loop || []) {
      const s = await req(c, p.playerid, ['status', '-', 1, 'tags:al']).catch(() => ({})), t = (s.playlist_loop || [])[0] || {};
      out.push({ id: p.playerid, name: p.name, kind: 'speaker', info: 'Squeezebox · ' + (p.modelname || p.model || ''), state: { on: !!+(s.power != null ? s.power : p.power), playing: s.mode === 'play', title: (t.artist ? t.artist + ' — ' : '') + (t.title || ''), vol: Math.abs(+s['mixer volume'] || 0) } });
    }
    return out;
  },
  async command(c, id, p) {
    if ('on' in p) await req(c, id, ['power', p.on ? 1 : 0]);
    const m = { media_play_pause: ['pause'], media_play: ['play'], media_pause: ['pause', 1], media_stop: ['stop'], media_next_track: ['playlist', 'index', '+1'], media_previous_track: ['playlist', 'index', '-1'] }[p.cmd];
    if (m) await req(c, id, m);
    if ('vol' in p) await req(c, id, ['mixer', 'volume', Math.round(p.vol)]);
  }
};

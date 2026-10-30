// Kodi (LibreELEC, OSMC, Fire TV, NVIDIA Shield…) — ce qui est lu, lecture/pause, suivant, volume. JSON-RPC local (Réglages › Services › Contrôle).
'use strict';
const { json } = require('./net');
const hosts = c => String(c.hosts || '').split(/[\s,;]+/).map(h => h.replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter(Boolean);
const H = c => c.user ? { Authorization: 'Basic ' + Buffer.from(c.user + ':' + (c.password || '')).toString('base64') } : {};
async function rpc(c, h, method, params) {
  const r = await json('http://' + (/:\d+$/.test(h) ? h : h + ':8080') + '/jsonrpc', { body: { jsonrpc: '2.0', id: 1, method, params: params || {} }, headers: H(c), timeout: 5000 });
  if (r && r.error) throw new Error('Kodi : ' + r.error.message); return r && r.result;
}
module.exports = {
  id: 'kodi', name: 'Kodi', poll: 6000, secrets: ['password'],
  async test(c) { const h = hosts(c); if (!h.length) throw new Error('adresse IP manquante'); const r = await rpc(c, h[0], 'Application.GetProperties', { properties: ['name', 'version'] }); return h.length + ' Kodi · ' + r.name + ' ' + r.version.major; },
  async devices(c) {
    const out = [];
    for (const h of hosts(c)) {
      try {
        const [pl, app] = await Promise.all([rpc(c, h, 'Player.GetActivePlayers'), rpc(c, h, 'Application.GetProperties', { properties: ['volume', 'muted'] })]);
        let title = '', playing = false;
        if (pl && pl[0]) { const id = pl[0].playerid, [it, pr] = await Promise.all([rpc(c, h, 'Player.GetItem', { playerid: id, properties: ['title', 'showtitle', 'artist'] }), rpc(c, h, 'Player.GetProperties', { playerid: id, properties: ['speed'] })]); const i = it.item || {}; title = (i.showtitle ? i.showtitle + ' — ' : (i.artist && i.artist.length ? i.artist.join(', ') + ' — ' : '')) + (i.title || i.label || ''); playing = pr.speed > 0; }
        out.push({ id: h, name: 'Kodi ' + h.split(':')[0].split('.').pop(), kind: 'tv', info: 'Kodi', state: { on: true, playing, title, vol: app.volume, muted: app.muted } });
      } catch (e) { out.push({ id: h, name: 'Kodi ' + h, kind: 'tv', error: e.message, state: { on: false } }); }
    }
    return out;
  },
  async command(c, id, p) {
    const pl = await rpc(c, id, 'Player.GetActivePlayers'), pid = pl && pl[0] && pl[0].playerid;
    const go = { media_play_pause: 'PlayPause', media_play: 'PlayPause', media_pause: 'PlayPause', media_stop: 'Stop' }[p.cmd] || (p.on === false ? 'Stop' : null);
    if (go && pid != null) await rpc(c, id, 'Player.' + go, { playerid: pid });
    if ((p.cmd === 'media_next_track' || p.cmd === 'media_previous_track') && pid != null) await rpc(c, id, 'Player.GoTo', { playerid: pid, to: p.cmd === 'media_next_track' ? 'next' : 'previous' });
    if ('vol' in p) await rpc(c, id, 'Application.SetVolume', { volume: Math.round(p.vol) });
    if ('muted' in p) await rpc(c, id, 'Application.SetMute', { mute: !!p.muted });
  }
};

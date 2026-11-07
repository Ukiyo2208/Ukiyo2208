// Spotify — piloter la lecture sur n'importe quel appareil Spotify Connect (enceintes, TV, ordinateur). API officielle (OAuth).
'use strict';
const { json, request } = require('./net');
const API = 'https://api.spotify.com/v1';
module.exports = {
  id: 'spotify', name: 'Spotify', poll: 10000, secrets: ['clientSecret', 'tokens'],
  oauth: { auth: 'https://accounts.spotify.com/authorize', token: 'https://accounts.spotify.com/api/token', scope: 'user-read-playback-state user-modify-playback-state user-read-currently-playing', basic: true },
  async test(c, h) { const d = await json(API + '/me/player/devices', { headers: await h.auth() }); return d.devices.length + ' appareil(s) Spotify Connect visible(s)'; },
  async devices(c, h) {
    const H = await h.auth(), [d, pl] = await Promise.all([json(API + '/me/player/devices', { headers: H }), request(API + '/me/player', { headers: H, raw: true }).then(r => r.status === 200 ? r.json() : null)]);
    const it = pl && pl.item;
    return d.devices.map(x => ({ id: x.id, name: 'Spotify · ' + x.name, kind: 'speaker', info: x.type, state: { on: x.is_active && !!(pl && pl.is_playing), vol: x.volume_percent || 0, playing: !!(x.is_active && pl && pl.is_playing), title: x.is_active && it ? it.name : '', artist: x.is_active && it && it.artists ? it.artists.map(a => a.name).join(', ') : '', art: x.is_active && it && it.album && it.album.images[0] ? it.album.images[0].url : '' } }));
  },
  async command(c, id, p, cur, h) {
    const H = await h.auth(), q = '?device_id=' + encodeURIComponent(id), put = (path, body) => request(API + '/me/player' + path, { method: 'PUT', headers: H, body: body || {} });
    if (p.on === true || p.cmd === 'media_play') return put('/play' + q);
    if (p.on === false || p.cmd === 'media_pause') return put('/pause' + q);
    if (p.cmd === 'media_play_pause') return put((cur.playing ? '/pause' : '/play') + q);
    if (p.cmd === 'media_next_track') return request(API + '/me/player/next' + q, { headers: H, body: {} });
    if (p.cmd === 'media_previous_track') return request(API + '/me/player/previous' + q, { headers: H, body: {} });
    if ('vol' in p) return put('/volume?volume_percent=' + Math.round(p.vol) + '&device_id=' + encodeURIComponent(id));
    if (p.play && /^spotify:/.test(p.play)) return put('/play' + q, /:track:/.test(p.play) ? { uris: [p.play] } : { context_uri: p.play });
  }
};

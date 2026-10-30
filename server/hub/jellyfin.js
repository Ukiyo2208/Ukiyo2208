// Jellyfin (et Emby) — ce qui est regardé en ce moment sur chaque appareil, lecture/pause, volume. API locale avec clé.
'use strict';
const { json, request } = require('./net');
const base = c => { const h = String(c.host || '').trim().replace(/\/+$/, ''); return /^https?:/.test(h) ? h : 'http://' + (/:\d+$/.test(h) ? h : h + ':8096'); };
const H = c => ({ 'X-Emby-Token': c.apiKey || '' });
module.exports = {
  id: 'jellyfin', name: 'Jellyfin', poll: 8000, secrets: ['apiKey'],
  async test(c) { const i = await json(base(c) + '/System/Info', { headers: H(c) }); return i.ServerName + ' · ' + i.Version; },
  async devices(c) {
    const s = await json(base(c) + '/Sessions?ActiveWithinSeconds=900', { headers: H(c) });
    return s.filter(x => x.SupportsRemoteControl || x.NowPlayingItem).map(x => { const it = x.NowPlayingItem, ps = x.PlayState || {};
      return { id: x.DeviceId, name: 'Jellyfin · ' + x.DeviceName, kind: 'tv', info: (x.Client || '') + (x.UserName ? ' · ' + x.UserName : ''), state: { on: !!it, playing: !!it && !ps.IsPaused, vol: ps.VolumeLevel || 0, title: it ? (it.SeriesName ? it.SeriesName + ' — ' : '') + it.Name : '', session: x.Id } }; });
  },
  async command(c, id, p, cur) {
    const s = cur.session || ((await json(base(c) + '/Sessions', { headers: H(c) })).find(x => x.DeviceId === id) || {}).Id; if (!s) throw new Error('appareil Jellyfin inactif');
    const k = { media_play_pause: 'PlayPause', media_play: 'Unpause', media_pause: 'Pause', media_next_track: 'NextTrack', media_previous_track: 'PreviousTrack', media_stop: 'Stop' }[p.cmd] || (p.on === false ? 'Stop' : null);
    if (k) await request(base(c) + '/Sessions/' + s + '/Playing/' + k, { headers: H(c), body: {} });
    if ('vol' in p) await request(base(c) + '/Sessions/' + s + '/Command', { headers: H(c), body: { Name: 'SetVolume', Arguments: { Volume: String(Math.round(p.vol)) } } });
  }
};

// Bose SoundTouch — enceintes : marche, volume, lecture, présélections. API locale (port 8090).
'use strict';
const { request } = require('./net');
const hosts = c => String(c.hosts || '').split(/[,;\s]+/).filter(Boolean);
const get = async (ip, p) => (await request('http://' + ip + ':8090/' + p, { timeout: 5000 })).text;
const post = (ip, p, xml) => request('http://' + ip + ':8090/' + p, { body: xml, headers: { 'Content-Type': 'application/xml' } });
const tag = (x, t) => (x.match(new RegExp('<' + t + '[^>]*>([^<]*)<')) || [])[1] || '';
const key = async (ip, k) => { await post(ip, 'key', '<key state="press" sender="Gabbo">' + k + '</key>'); await post(ip, 'key', '<key state="release" sender="Gabbo">' + k + '</key>'); };
module.exports = {
  id: 'bose', name: 'Bose SoundTouch', poll: 5000,
  async test(c) { const ip = hosts(c)[0]; if (!ip) throw new Error('adresse IP manquante'); return tag(await get(ip, 'info'), 'name'); },
  async devices(c) {
    return Promise.all(hosts(c).map(async ip => {
      const [i, np, v] = await Promise.all([get(ip, 'info'), get(ip, 'now_playing'), get(ip, 'volume')]), src = (np.match(/source="(\w+)"/) || [])[1] || '';
      return { id: ip, name: tag(i, 'name') || 'Bose ' + ip, kind: 'speaker', info: 'Bose ' + tag(i, 'type'), state: { on: src !== 'STANDBY', vol: +tag(v, 'actualvolume') || 0, src, playing: /PLAY_STATE/.test(np) && /<playStatus>PLAY_STATE/.test(np), title: tag(np, 'track') || tag(np, 'stationName'), artist: tag(np, 'artist') } };
    }));
  },
  async command(c, ip, p, cur) {
    if ('on' in p && !!p.on !== !!cur.on) await key(ip, 'POWER');
    if ('vol' in p) await post(ip, 'volume', '<volume>' + Math.round(p.vol) + '</volume>');
    const k = { media_play_pause: 'PLAY_PAUSE', media_play: 'PLAY', media_pause: 'PAUSE', media_next_track: 'NEXT_TRACK', media_previous_track: 'PREV_TRACK', volume_mute: 'MUTE' }[p.cmd]; if (k) await key(ip, k);
  }
};

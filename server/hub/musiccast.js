// Yamaha MusicCast — amplis, barres de son, enceintes : marche, volume, source, lecture. API locale.
'use strict';
const { json } = require('./net');
const hosts = c => String(c.hosts || '').split(/[,;\s]+/).filter(Boolean);
const api = (ip, p) => json('http://' + ip + '/YamahaExtendedControl/v1/' + p, { timeout: 5000 });
module.exports = {
  id: 'musiccast', name: 'Yamaha MusicCast', poll: 5000,
  async test(c) { const ip = hosts(c)[0]; if (!ip) throw new Error('adresse IP manquante'); const i = await api(ip, 'system/getDeviceInfo'); return i.model_name; },
  async devices(c) {
    return Promise.all(hosts(c).map(async ip => {
      const [n, s, pi] = await Promise.all([api(ip, 'system/getNameText?id=main').catch(() => ({})), api(ip, 'main/getStatus'), api(ip, 'netusb/getPlayInfo').catch(() => ({}))]);
      return { id: ip, name: n.text || 'MusicCast ' + ip, kind: 'speaker', info: 'Yamaha · ' + s.input, state: { on: s.power === 'on', vol: Math.round(s.volume / (s.max_volume || 100) * 100), src: s.input, playing: pi.playback === 'play', title: pi.track || '', artist: pi.artist || '', max: s.max_volume } };
    }));
  },
  async command(c, ip, p, cur) {
    if ('on' in p) await api(ip, 'main/setPower?power=' + (p.on ? 'on' : 'standby'));
    if ('vol' in p) await api(ip, 'main/setVolume?volume=' + Math.round(p.vol / 100 * (cur.max || 100)));
    const k = { media_play_pause: cur.playing ? 'pause' : 'play', media_play: 'play', media_pause: 'pause', media_next_track: 'next', media_previous_track: 'previous', media_stop: 'stop' }[p.cmd];
    if (k) await api(ip, 'netusb/setPlayback?playback=' + k);
    if (p.cmd === 'volume_mute') await api(ip, 'main/setMute?enable=true');
  }
};

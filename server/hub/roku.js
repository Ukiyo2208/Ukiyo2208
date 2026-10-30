// Roku — TV et lecteurs Roku, protocole local ECP (port 8060). Sans compte.
'use strict';
const { request } = require('./net');
const hosts = c => String(c.hosts || '').split(/[\s,;]+/).map(h => h.replace(/^https?:\/\//, '').replace(/[:/].*$/, '')).filter(Boolean);
const tag = (x, t) => ((x.match(new RegExp('<' + t + '>([^<]*)</' + t + '>')) || [])[1] || '').trim();
const key = (h, k) => request('http://' + h + ':8060/keypress/' + k, { method: 'POST', body: '', timeout: 4000 });
module.exports = {
  id: 'roku', name: 'Roku', poll: 5000,
  async test(c) { const hs = hosts(c); if (!hs.length) throw new Error('adresse IP manquante'); const r = await Promise.all(hs.map(h => request('http://' + h + ':8060/query/device-info', { timeout: 4000 }).then(x => tag(x.text, 'user-device-name') || tag(x.text, 'model-name'), e => '⚠ ' + h + ' : ' + e.message))); if (r.every(x => x.startsWith('⚠'))) throw new Error(r.join(' · ')); return r.length + ' appareil(s) : ' + r.join(', '); },
  async devices(c) {
    return (await Promise.all(hosts(c).map(async h => { try {
      const d = (await request('http://' + h + ':8060/query/device-info', { timeout: 4000 })).text, a = await request('http://' + h + ':8060/query/active-app', { timeout: 4000 }).then(r => r.text).catch(() => '');
      const app = (a.match(/<app[^>]*>([^<]*)<\/app>/) || [])[1] || '';
      return { id: h, name: tag(d, 'user-device-name') || tag(d, 'model-name') || 'Roku', kind: 'tv', state: { on: tag(d, 'power-mode') === 'PowerOn', src: app, title: app } };
    } catch (e) { return null; } }))).filter(Boolean);
  },
  async command(c, h, p, cur) {
    if ('on' in p) await key(h, p.on ? 'PowerOn' : 'PowerOff');
    if ('vol' in p) { const d = Math.round((p.vol - ((cur && cur.vol) || 50)) / 5); for (let i = 0; i < Math.min(10, Math.abs(d)); i++) await key(h, d > 0 ? 'VolumeUp' : 'VolumeDown'); }
    const K = { media_play_pause: 'Play', media_play: 'Play', media_pause: 'Play', media_next_track: 'Fwd', media_previous_track: 'Rev', volume_mute: 'VolumeMute' };
    if (p.cmd && K[p.cmd]) await key(h, K[p.cmd]);
  }
};

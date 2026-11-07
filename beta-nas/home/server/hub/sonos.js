// Sonos — API locale UPnP de chaque enceinte (port 1400) : lecture, pause, volume, titre en cours,
// et lecture d'une radio ou d'un fichier par son adresse. Sans compte, sans cloud.
'use strict';
const { request } = require('./net');
const hosts = c => String(c.hosts || '').split(/[\s,;]+/).map(h => h.replace(/^https?:\/\//, '').replace(/[:/].*$/, '')).filter(Boolean);
const SVC = { av: ['/MediaRenderer/AVTransport/Control', 'urn:schemas-upnp-org:service:AVTransport:1'], rc: ['/MediaRenderer/RenderingControl/Control', 'urn:schemas-upnp-org:service:RenderingControl:1'] };
const xmlEsc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unEsc = s => String(s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
async function soap(h, svc, action, args) {
  const [path, ns] = SVC[svc];
  const body = '<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:' + action + ' xmlns:u="' + ns + '">' +
    Object.keys(args).map(k => '<' + k + '>' + xmlEsc(args[k]) + '</' + k + '>').join('') + '</u:' + action + '></s:Body></s:Envelope>';
  const r = await request('http://' + h + ':1400' + path, { method: 'POST', body, headers: { 'Content-Type': 'text/xml; charset="utf-8"', SOAPACTION: '"' + ns + '#' + action + '"' }, timeout: 5000 });
  return r.text;
}
const tag = (x, t) => (x.match(new RegExp('<' + t + '>([\\s\\S]*?)</' + t + '>')) || [])[1] || '';
async function one(h) {
  const d = (await request('http://' + h + ':1400/xml/device_description.xml', { timeout: 4000 })).text;
  const [tr, vol, pos] = await Promise.all([soap(h, 'av', 'GetTransportInfo', { InstanceID: 0 }), soap(h, 'rc', 'GetVolume', { InstanceID: 0, Channel: 'Master' }), soap(h, 'av', 'GetPositionInfo', { InstanceID: 0 }).catch(() => '')]);
  const meta = unEsc(tag(pos, 'TrackMetaData')), title = unEsc(tag(meta, 'r:streamContent') || tag(meta, 'dc:title')), artist = unEsc(tag(meta, 'dc:creator'));
  return { id: h, name: tag(d, 'roomName') || tag(d, 'displayName') || 'Sonos ' + h, info: tag(d, 'modelName'), kind: 'speaker',
    state: { on: tag(tr, 'CurrentTransportState') === 'PLAYING', vol: +tag(vol, 'CurrentVolume') || 0, title: [title, artist].filter(Boolean).join(' · ') } };
}

module.exports = {
  id: 'sonos', name: 'Sonos', poll: 4000,
  async test(c) {
    const hs = hosts(c); if (!hs.length) throw new Error('ajoutez au moins une adresse IP');
    const r = await Promise.all(hs.map(h => one(h).then(d => d.name, e => '⚠ ' + h + ' : ' + e.message)));
    if (r.every(x => x.startsWith('⚠'))) throw new Error(r.join(' · '));
    return r.length + ' enceinte(s) : ' + r.join(', ');
  },
  async devices(c) { return (await Promise.all(hosts(c).map(h => one(h).catch(() => null)))).filter(Boolean); },
  async command(c, h, p) {
    if (p.play) { // radio ou fichier : flux HTTP lu directement par l'enceinte
      const uri = /^https?:\/\//.test(p.play) && /radio|stream|icecast|mp3|aac|live|\.m3u|:\d+\/?$/i.test(p.play) ? p.play.replace(/^https?:\/\//, 'x-rincon-mp3radio://') : p.play;
      await soap(h, 'av', 'SetAVTransportURI', { InstanceID: 0, CurrentURI: uri, CurrentURIMetaData: '' });
      return soap(h, 'av', 'Play', { InstanceID: 0, Speed: 1 });
    }
    if ('vol' in p) await soap(h, 'rc', 'SetVolume', { InstanceID: 0, Channel: 'Master', DesiredVolume: Math.max(0, Math.min(100, Math.round(p.vol))) });
    if ('on' in p) return soap(h, 'av', p.on ? 'Play' : 'Pause', { InstanceID: 0, Speed: 1 });
    const cmd = { media_play_pause: null, media_play: 'Play', media_pause: 'Pause', media_next_track: 'Next', media_previous_track: 'Previous', media_stop: 'Stop' };
    if (p.cmd && p.cmd in cmd) {
      let a = cmd[p.cmd]; if (!a) a = (await soap(h, 'av', 'GetTransportInfo', { InstanceID: 0 })).includes('PLAYING') ? 'Pause' : 'Play';
      return soap(h, 'av', a, a === 'Play' ? { InstanceID: 0, Speed: 1 } : { InstanceID: 0 });
    }
  }
};

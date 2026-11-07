// Denon / Marantz — amplis et home-cinéma, API HTTP locale (port 80, ou 8080 sur les modèles récents).
'use strict';
const { request } = require('./net');
const hosts = c => String(c.hosts || '').split(/[\s,;]+/).map(h => h.replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter(Boolean);
const port = {};   // port trouvé par appareil
async function get(h, path) {
  const tries = port[h] ? [port[h]] : [80, 8080];
  for (const p of tries) { try { const r = await request('http://' + h.replace(/:\d+$/, '') + ':' + p + path, { timeout: 4000 }); port[h] = p; return r.text; } catch (e) { if (p === tries[tries.length - 1]) throw e; } }
}
const val = (x, t) => ((x.match(new RegExp('<' + t + '>\\s*<value>([^<]*)</value>')) || [])[1] || '').trim();
const send = (h, code) => get(h, '/goform/formiPhoneAppDirect.xml?' + encodeURIComponent(code));
const SRC = { 'TV': 'TV', 'Blu-ray': 'BD', 'Lecteur': 'BD', 'Jeux': 'GAME', 'Console': 'GAME', 'Box': 'SAT/CBL', 'Satellite': 'SAT/CBL', 'Bluetooth': 'BT', 'Réseau': 'NET', 'Tuner': 'TUNER', 'HDMI 1': 'TV', 'HDMI 2': 'BD', 'HDMI 3': 'GAME' };
module.exports = {
  id: 'denon', name: 'Denon / Marantz', poll: 4000,
  async test(c) { const hs = hosts(c); if (!hs.length) throw new Error('adresse IP manquante'); const r = await Promise.all(hs.map(h => get(h, '/goform/formMainZone_MainZoneXmlStatusLite.xml').then(x => val(x, 'Power') ? h : '⚠ ' + h + ' : réponse inattendue', e => '⚠ ' + h + ' : ' + e.message))); if (r.every(x => x.startsWith('⚠'))) throw new Error(r.join(' · ')); return r.length + ' appareil(s)'; },
  async devices(c) {
    return (await Promise.all(hosts(c).map(async h => { try {
      const x = await get(h, '/goform/formMainZone_MainZoneXmlStatusLite.xml'), y = await get(h, '/goform/formMainZone_MainZoneXml.xml').catch(() => '');
      const db = parseFloat(val(x, 'MasterVolume')), name = val(y, 'FriendlyName') || 'Ampli ' + h;
      return { id: h, name, kind: 'speaker', info: 'Denon / Marantz', state: { on: val(x, 'Power') === 'ON', vol: isNaN(db) ? 0 : Math.round(Math.max(0, Math.min(98, db + 80)) / 98 * 100), src: val(x, 'InputFuncSelect') } };
    } catch (e) { return null; } }))).filter(Boolean);
  },
  async command(c, h, p) {
    if ('on' in p) await send(h, p.on ? 'PWON' : 'PWSTANDBY');
    if ('vol' in p) await send(h, 'MV' + String(Math.round(Math.max(0, Math.min(100, p.vol)) * 0.98)).padStart(2, '0'));
    if (p.src) await send(h, 'SI' + (SRC[p.src] || String(p.src).toUpperCase()));
    if (p.cmd === 'volume_mute') await send(h, 'MUON');
  }
};

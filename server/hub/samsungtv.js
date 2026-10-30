// TV Samsung (Tizen, 2016 et +) — télécommande locale par WebSocket (wss 8002). Autoriser une fois sur la TV.
'use strict';
const { connect } = require('./ws'), { json } = require('./net'), wol = require('./wol');
const host = c => String(c.host || '').replace(/^https?:\/\//, '').replace(/[:/].*$/, '');
const NAME = Buffer.from('Bêta home').toString('base64');
const url = c => 'wss://' + host(c) + ':8002/api/v2/channels/samsung.remote.control?name=' + NAME + (c.token ? '&token=' + c.token : '');
async function keys(c, list) {
  const ws = await connect(url(c));
  await new Promise((ok, ko) => { ws.onmessage = m => { const j = JSON.parse(m); if (j.event === 'ms.channel.connect') ok(); if (j.event === 'ms.channel.unauthorized') ko(new Error('refusé sur la TV : refaites « Autoriser »')); }; setTimeout(() => ko(new Error('la TV n’a pas répondu')), 6000); });
  for (const k of list) { ws.send({ method: 'ms.remote.control', params: { Cmd: 'Click', DataOfCmd: k, Option: 'false', TypeOfRemote: 'SendRemoteKey' } }); await new Promise(r => setTimeout(r, 120)); }
  ws.close();
}
const KEYS = { media_play_pause: 'KEY_PLAY', media_play: 'KEY_PLAY', media_pause: 'KEY_PAUSE', media_next_track: 'KEY_FF', media_previous_track: 'KEY_REWIND', volume_mute: 'KEY_MUTE' };
module.exports = {
  id: 'samsungtv', name: 'TV Samsung', poll: 6000, secrets: ['token'],
  actions: {
    async pair(c, b) {   // une fenêtre « Autoriser » apparaît sur la TV : acceptez-la
      const h = host({ host: b.host || c.host }); if (!h) throw new Error('adresse IP de la TV manquante');
      const ws = await connect('wss://' + h + ':8002/api/v2/channels/samsung.remote.control?name=' + NAME, { timeout: 8000 });
      const token = await new Promise((ok, ko) => { ws.onmessage = m => { const j = JSON.parse(m); if (j.event === 'ms.channel.connect') ok(j.data && j.data.token); if (j.event === 'ms.channel.unauthorized') ko(new Error('refusé sur la TV')); }; setTimeout(() => ko(new Error('pas de réponse : acceptez la fenêtre sur la TV dans les 30 s')), 30000); });
      ws.close(); const info = await json('http://' + h + ':8001/api/v2/', { timeout: 4000 }).catch(() => ({}));
      return { host: h, token: token || '', mac: (info.device && info.device.wifiMac) || c.mac || '', info: 'TV autorisée' };
    }
  },
  async test(c) { const i = await json('http://' + host(c) + ':8001/api/v2/', { timeout: 4000 }); return (i.device && (i.device.name || i.device.modelName)) || 'TV Samsung'; },
  async devices(c) {
    if (!host(c)) return []; let i = null; try { i = await json('http://' + host(c) + ':8001/api/v2/', { timeout: 3000 }); } catch (e) { }
    return [{ id: 'tv', name: (i && i.device && i.device.name) || c.name || 'TV Samsung', kind: 'tv', state: { on: !!i && (!i.device.PowerState || i.device.PowerState === 'on') } }];
  },
  async command(c, id, p, cur) {
    if (p.on === true && !(cur && cur.on)) return wol(c.mac);
    if (p.on === false) return keys(c, ['KEY_POWER']);
    if ('vol' in p) { const d = Math.round((p.vol - ((cur && cur.vol) || 20)) / 2); return keys(c, Array(Math.min(15, Math.abs(d))).fill(d > 0 ? 'KEY_VOLUP' : 'KEY_VOLDOWN')); }
    if (p.cmd && KEYS[p.cmd]) return keys(c, [KEYS[p.cmd]]);
  }
};

// TV LG (webOS) — API locale par WebSocket (port 3000, ou 3001 chiffré). Accepter une fois sur la TV.
'use strict';
const { connect, rpc } = require('./ws'), wol = require('./wol');
const host = c => String(c.host || '').replace(/^wss?:\/\//, '').replace(/[:/].*$/, '');
const PERMS = ['LAUNCH', 'LAUNCH_WEBAPP', 'APP_TO_APP', 'CONTROL_AUDIO', 'CONTROL_DISPLAY', 'CONTROL_INPUT_MEDIA_PLAYBACK', 'CONTROL_POWER', 'READ_INSTALLED_APPS', 'READ_RUNNING_APPS', 'READ_CURRENT_CHANNEL', 'READ_INPUT_DEVICE_LIST', 'READ_POWER_STATE', 'READ_TV_CHANNEL_LIST', 'WRITE_NOTIFICATION_TOAST', 'CONTROL_INPUT_TV', 'CONTROL_INPUT_JOYSTICK'];
async function open(c, prompt) {
  let ws; try { ws = await connect('wss://' + host(c) + ':3001'); } catch (e) { ws = await connect('ws://' + host(c) + ':3000'); }
  const call = rpc(ws, 'id');
  const reg = { type: 'register', id: 'reg' + Date.now(), payload: { forcePairing: false, pairingType: 'PROMPT', 'client-key': c.clientKey || undefined, manifest: { manifestVersion: 1, appVersion: '1.0', permissions: PERMS } } };
  // la réponse « registered » arrive après l'éventuel accord sur la TV
  const key = await new Promise((ok, ko) => { const prev = ws.onmessage; ws.onmessage = (m, j) => { j = j || JSON.parse(m); if (j.id === reg.id) { if (j.type === 'registered') { ws.onmessage = prev; ok(j.payload['client-key']); } else if (j.type === 'error') ko(new Error(j.error || 'refusé sur la TV')); } else if (prev) prev(m, j); }; ws.send(reg); setTimeout(() => ko(new Error(prompt ? 'acceptez la demande sur la TV dans les 30 s' : 'la TV ne répond pas')), prompt ? 30000 : 6000); });
  return { ws, call, key };
}
const req = (call, uri, payload) => call({ type: 'request', uri, payload: payload || {} }).then(r => { if (r.type === 'error') throw new Error(r.error); return r.payload || {}; });
const KEYS = { media_play_pause: 'ssap://media.controls/play', media_play: 'ssap://media.controls/play', media_pause: 'ssap://media.controls/pause', media_next_track: 'ssap://media.controls/fastForward', media_previous_track: 'ssap://media.controls/rewind' };
module.exports = {
  id: 'lgtv', name: 'TV LG', poll: 6000, secrets: ['clientKey'],
  actions: { async pair(c, b) { const h = host({ host: b.host || c.host }); if (!h) throw new Error('adresse IP de la TV manquante'); const t = await open({ host: h }, true); t.ws.close(); return { host: h, clientKey: t.key, info: 'TV appairée' }; } },
  async test(c) { if (!c.clientKey) throw new Error('TV non appairée'); const t = await open(c); const i = await req(t.call, 'ssap://system/getSystemInfo').catch(() => ({})); t.ws.close(); return i.modelName || 'TV LG'; },
  async devices(c) {
    if (!c.clientKey) return [];
    try { const t = await open(c), [v, app] = await Promise.all([req(t.call, 'ssap://audio/getVolume').catch(() => ({})), req(t.call, 'ssap://com.webos.applicationManager/getForegroundAppInfo').catch(() => ({}))]); t.ws.close();
      const vol = v.volumeStatus ? v.volumeStatus.volume : v.volume; return [{ id: 'tv', name: c.name || 'TV LG', kind: 'tv', state: { on: true, vol: vol || 0, src: app.appId || '' } }]; }
    catch (e) { return [{ id: 'tv', name: c.name || 'TV LG', kind: 'tv', state: { on: false } }]; }
  },
  async command(c, id, p) {
    if (p.on === true) return wol(c.mac);
    const t = await open(c);
    try {
      if (p.on === false) await req(t.call, 'ssap://system/turnOff');
      if ('vol' in p) await req(t.call, 'ssap://audio/setVolume', { volume: Math.round(p.vol) });
      if (p.cmd === 'volume_mute') await req(t.call, 'ssap://audio/setMute', { mute: true });
      if (p.cmd && KEYS[p.cmd]) await req(t.call, KEYS[p.cmd]);
      if (p.say) await req(t.call, 'ssap://system.notifications/createToast', { message: String(p.say).slice(0, 120) });   // message à l'écran
    } finally { t.ws.close(); }
  }
};

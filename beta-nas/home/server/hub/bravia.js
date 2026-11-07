// TV Sony Bravia (Android / Google TV) — API locale avec « clé pré-partagée » : marche, volume, source, télécommande.
'use strict';
const { json } = require('./net');
const host = c => String(c.host || '').replace(/^https?:\/\//, '').replace(/[:/].*$/, '');
let n = 1;
async function rpc(c, svc, method, params, version) {
  const r = await json('http://' + host(c) + '/sony/' + svc, { timeout: 5000, headers: { 'X-Auth-PSK': c.psk || '' }, body: { method, id: n++, params: params ? [params] : [], version: version || '1.0' } });
  if (r.error) { if (r.error[0] === 403) throw new Error('clé pré-partagée refusée'); throw new Error(r.error[1] || 'erreur Bravia'); } return r.result || [];
}
const IRCC = { media_play: 'AAAAAgAAAJcAAAAaAw==', media_pause: 'AAAAAgAAAJcAAAAZAw==', media_play_pause: 'AAAAAgAAAJcAAAAaAw==', media_next_track: 'AAAAAgAAAJcAAAA9Aw==', media_previous_track: 'AAAAAgAAAJcAAAA8Aw==', volume_mute: 'AAAAAQAAAAEAAAAUAw==' };
module.exports = {
  id: 'bravia', name: 'TV Sony Bravia', poll: 6000, secrets: ['psk'],
  async test(c) { const i = await rpc(c, 'system', 'getSystemInformation'); return (i[0] && i[0].model) || 'Bravia'; },
  async devices(c) {
    const p = await rpc(c, 'system', 'getPowerStatus'), on = p[0] && p[0].status === 'active';
    let vol = 0; if (on) { try { const v = await rpc(c, 'audio', 'getVolumeInformation'); const sp = (v[0] || []).find(x => x.target === 'speaker') || (v[0] || [])[0]; vol = sp ? sp.volume : 0; } catch (e) { } }
    return [{ id: 'tv', name: c.name || 'TV Sony', kind: 'tv', info: 'Sony Bravia', state: { on, vol } }];
  },
  async command(c, id, p) {
    if ('on' in p) await rpc(c, 'system', 'setPowerStatus', { status: !!p.on });
    if ('vol' in p) await rpc(c, 'audio', 'setAudioVolume', { target: 'speaker', volume: String(Math.round(p.vol)) });
    if (p.cmd && IRCC[p.cmd]) { const { request } = require('./net'); await request('http://' + host(c) + '/sony/IRCC', { headers: { 'X-Auth-PSK': c.psk || '', SOAPACTION: '"urn:schemas-sony-com:service:IRCC:1#X_SendIRCC"', 'Content-Type': 'text/xml; charset=UTF-8' }, body: '<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:X_SendIRCC xmlns:u="urn:schemas-sony-com:service:IRCC:1"><IRCCCode>' + IRCC[p.cmd] + '</IRCCCode></u:X_SendIRCC></s:Body></s:Envelope>' }); }
  }
};

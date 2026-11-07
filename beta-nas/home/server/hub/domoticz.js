// Domoticz — tous les appareils de votre serveur Domoticz (RFXCom, Z-Wave, Zigbee…), par son API JSON locale.
'use strict';
const { json } = require('./net');
const base = c => { const h = String(c.host || '').trim().replace(/\/+$/, ''); return (/^https?:/.test(h) ? h : 'http://' + h) + '/json.htm?'; };
const H = c => c.user ? { Authorization: 'Basic ' + Buffer.from(c.user + ':' + (c.password || '')).toString('base64') } : {};
const get = (c, o) => json(base(c) + new URLSearchParams(o).toString(), { headers: H(c), timeout: 10000, insecure: true });
async function list(c) {
  let r = await get(c, { type: 'command', param: 'getdevices', filter: 'all', used: 'true' }).catch(() => null);   // Domoticz 2023.2 et plus
  if (!r || r.status !== 'OK') r = await get(c, { type: 'devices', filter: 'all', used: 'true' });                  // anciennes versions
  if (!r || r.status !== 'OK') throw new Error('Domoticz : ' + (r && r.message || 'accès refusé'));
  return r.result || [];
}
const num = s => parseFloat(String(s || '').replace(',', '.'));
function map(d) {
  const id = String(d.idx), b = { info: 'Domoticz · ' + [d.Type, d.SubType].filter(Boolean).join(' / ') }, st = d.SwitchType || '', on = !/^(Off|Closed|Locked|Normal|No Motion)$/i.test(d.Status || 'Off');
  if (/Blinds/i.test(st)) return [Object.assign({ id, name: d.Name, kind: 'cover', state: { pos: /Percentage/i.test(st) ? Math.round(num(d.Level)) : /Open/i.test(d.Status) ? 100 : 0 } }, b)];
  if (/Door Contact|Contact/i.test(st)) return [Object.assign({ id, name: d.Name, kind: 'door', state: { on: /Open/i.test(d.Status) } }, b)];
  if (/Motion/i.test(st)) return [Object.assign({ id, name: d.Name, kind: 'motion', state: { on } }, b)];
  if (/Door Lock/i.test(st)) return [Object.assign({ id, name: d.Name, kind: 'lock', state: { locked: /Locked/i.test(d.Status) } }, b)];
  if (/Dimmer/i.test(st) || /Color Switch/i.test(d.Type || '')) return [Object.assign({ id, name: d.Name, kind: /Color/i.test(d.Type || '') ? 'rgb' : 'light', state: { on, bri: Math.round(num(d.Level)) || undefined } }, b)];
  if (/On\/Off/i.test(st) || /Light\/Switch|Lighting/i.test(d.Type || '')) return [Object.assign({ id, name: d.Name, kind: /lum|lamp|light|éclair/i.test(d.Name) ? 'light' : 'plug', state: { on } }, b)];
  if (/Thermostat/i.test(d.Type || '') || /SetPoint/i.test(d.SubType || '')) return [Object.assign({ id, name: d.Name, kind: 'clim', state: { on: true, temp: num(d.SetPoint || d.Data) || 20, modes: ['Auto'] } }, b)];
  const o = [];
  if (d.Temp !== undefined) o.push(Object.assign({ id: id + '|t', name: d.Name + (d.Humidity !== undefined ? ' — température' : ''), kind: 'temp', state: { val: num(d.Temp), unit: '°C' } }, b));
  if (d.Humidity !== undefined) o.push(Object.assign({ id: id + '|h', name: d.Name + ' — humidité', kind: 'hum', state: { val: num(d.Humidity), unit: '%' } }, b));
  if (d.Usage !== undefined && /Watt/i.test(d.Usage)) o.push(Object.assign({ id: id + '|w', name: d.Name, kind: 'meter', state: { val: Math.round(num(d.Usage)), unit: 'W' } }, b));
  return o;
}
module.exports = {
  id: 'domoticz', name: 'Domoticz', poll: 8000, secrets: ['password'],
  async test(c) { const l = await list(c); return l.length + ' appareil(s), ' + l.flatMap(map).length + ' repris'; },
  async devices(c) { return (await list(c)).flatMap(map); },
  async command(c, id, p) {
    if (id.includes('|')) return;
    const sw = (cmd, level) => get(c, Object.assign({ type: 'command', param: 'switchlight', idx: id, switchcmd: cmd }, level != null ? { level } : {}));
    if ('bri' in p) await sw('Set Level', Math.round(p.bri));
    else if ('on' in p) await sw(p.on ? 'On' : 'Off');
    if ('pos' in p) await (p.pos > 0 && p.pos < 100 ? sw('Set Level', Math.round(p.pos)) : sw(p.pos > 0 ? 'Open' : 'Close'));
    if (p.moving === 'stop') await sw('Stop');
    if ('locked' in p) await sw(p.locked ? 'On' : 'Off');
    if ('temp' in p) await get(c, { type: 'command', param: 'setsetpoint', idx: id, setpoint: +p.temp });
  },
  _map: map
};

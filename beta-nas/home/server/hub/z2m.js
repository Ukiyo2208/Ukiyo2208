// Zigbee2MQTT — tous les appareils Zigbee (Aqara, IKEA, Xiaomi, Philips, Lidl, Tuya…) via le broker MQTT.
// Liste des appareils : <base>/bridge/devices ; états : <base>/<nom> ; commandes : <base>/<nom>/set.
'use strict';
const { Client } = require('./mqtt');
const { xyToHex, hexToXy } = require('./net');
const conns = {};
function conn(c) {
  const k = [c.host, c.port, c.user, c.base].join('|');
  if (conns[k]) return conns[k];
  Object.keys(conns).forEach(x => { conns[x].cl.close(); delete conns[x]; });
  const base = (c.base || 'zigbee2mqtt').replace(/\/+$/, ''), cl = new Client({ host: c.host, port: +c.port || 1883, user: c.user, pass: c.password }), z = conns[k] = { cl, base, devs: [], st: {} };
  cl.on((t, p) => {
    if (t === base + '/bridge/devices') { try { z.devs = JSON.parse(p.toString()).filter(d => d.type !== 'Coordinator' && d.definition && !d.disabled); z.at = Date.now(); } catch (e) { } return; }
    const n = t.slice(base.length + 1); if (!n || n.includes('/')) return;
    try { z.st[n] = Object.assign(z.st[n] || {}, JSON.parse(p.toString())); } catch (e) { }
  });
  cl.subscribe(base + '/bridge/devices'); cl.subscribe(base + '/+');
  return z;
}
const feats = e => (e.features || []).map(f => f.property || f.name);
function kindOf(d) {
  const ex = d.definition.exposes || [], types = ex.map(e => e.type), props = ex.flatMap(e => [e.property || e.name].concat(feats(e)));
  if (types.includes('light')) { const l = ex.find(e => e.type === 'light'); return feats(l).some(f => /color_(xy|hs)/.test(f)) ? 'rgb' : 'light'; }
  if (types.includes('cover')) return 'cover'; if (types.includes('climate')) return 'clim'; if (types.includes('lock')) return 'lock'; if (types.includes('fan')) return 'fan';
  if (types.includes('switch')) return 'plug';
  if (props.includes('contact')) return 'door'; if (props.includes('occupancy')) return 'motion'; if (props.includes('water_leak')) return 'leak';
  if (props.includes('co2')) return 'co2'; if (props.includes('temperature')) return 'temp'; if (props.includes('humidity')) return 'hum'; if (props.includes('power')) return 'meter';
  return null;
}
function state(k, s) {
  s = s || {}; const o = {};
  if ('state' in s) o.on = String(s.state).toUpperCase() === 'ON';
  if (s.brightness != null) o.bri = Math.round(s.brightness / 2.54);
  if (s.color) { if (s.color.hex) o.color = s.color.hex; else if (s.color.x != null) o.color = xyToHex(s.color.x, s.color.y); }
  if (s.position != null) o.pos = s.position;
  if (k === 'clim') { if (s.occupied_heating_setpoint != null) o.temp = s.occupied_heating_setpoint; if (s.local_temperature != null) o.cur = s.local_temperature; if (s.system_mode) o.on = s.system_mode !== 'off'; }
  if (k === 'lock' && s.state) o.locked = s.state === 'LOCK';
  if (k === 'door' && 'contact' in s) o.on = !s.contact; if (k === 'motion' && 'occupancy' in s) o.on = !!s.occupancy; if (k === 'leak' && 'water_leak' in s) o.on = !!s.water_leak;
  if (k === 'temp' && s.temperature != null) Object.assign(o, { val: s.temperature, unit: '°C' }); if (k === 'hum' && s.humidity != null) Object.assign(o, { val: s.humidity, unit: '%' });
  if (k === 'co2' && s.co2 != null) Object.assign(o, { val: s.co2, unit: 'ppm' }); if (k === 'meter' && s.power != null) Object.assign(o, { val: s.power, unit: 'W' });
  return o;
}
module.exports = {
  id: 'z2m', name: 'Zigbee2MQTT', poll: 2000, secrets: ['password'],
  async test(c) {
    if (!c.host) throw new Error('adresse du broker MQTT manquante');
    const z = conn(c); await z.cl.ready(5000);
    const t0 = Date.now(); while (!z.at && Date.now() - t0 < 4000) await new Promise(r => setTimeout(r, 200));
    if (!z.at) throw new Error('connecté au broker, mais rien de Zigbee2MQTT sur « ' + z.base + ' » : vérifiez le préfixe (base_topic)');
    return z.devs.length + ' appareil(s) Zigbee';
  },
  async devices(c) {
    if (!c.host) return []; const z = conn(c); await z.cl.ready(5000).catch(() => { });
    const t0 = Date.now(); while (!z.at && Date.now() - t0 < 3000) await new Promise(r => setTimeout(r, 200));
    return z.devs.map(d => { const k = kindOf(d); if (!k) return null; if (!z.st[d.friendly_name] && z.cl.ok) try { z.cl.publish(z.base + '/' + d.friendly_name + '/get', { state: '' }); } catch (e) { }
      return { id: d.friendly_name, name: d.friendly_name.replace(/_/g, ' '), kind: k, info: [d.definition.vendor, d.definition.model].filter(Boolean).join(' '), state: state(k, z.st[d.friendly_name]) }; }).filter(Boolean);
  },
  async command(c, id, p) {
    const z = conn(c), b = {};
    if ('on' in p) b.state = p.on ? 'ON' : 'OFF';
    if ('bri' in p) { b.brightness = Math.round(p.bri * 2.54); b.state = 'ON'; }
    if (p.color) b.color = { hex: p.color };
    if ('pos' in p) b.position = Math.round(p.pos); if (p.moving === 'stop') b.state = 'STOP';
    if ('temp' in p) b.occupied_heating_setpoint = +p.temp; if (p.hvac) b.system_mode = p.hvac === 'Arrêt' ? 'off' : p.hvac === 'Froid' ? 'cool' : p.hvac === 'Chaud' ? 'heat' : 'auto';
    if ('locked' in p) b.state = p.locked ? 'LOCK' : 'UNLOCK';
    if (Object.keys(b).length) z.cl.publish(z.base + '/' + id + '/set', b);
  },
  _test: { kindOf, state, hexToXy }
};

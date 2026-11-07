// MQTT « découverte » — tous les appareils qui s'annoncent au format Home Assistant sur votre broker MQTT :
// LinknLink (firmware HA), OpenBeken, Tasmota/ESPHome/Shelly en mode MQTT, Zigbee2MQTT, Valetudo… sans Home Assistant.
'use strict';
const { Client } = require('./mqtt');
const A = { '~': '~', stat_t: 'state_topic', cmd_t: 'command_topic', pl_on: 'payload_on', pl_off: 'payload_off', stat_on: 'state_on', stat_off: 'state_off', val_tpl: 'value_template', dev_cla: 'device_class', uniq_id: 'unique_id', unit_of_meas: 'unit_of_measurement', pos_t: 'position_topic', set_pos_t: 'set_position_topic', bri_cmd_t: 'brightness_command_topic', bri_stat_t: 'brightness_state_topic', bri_scl: 'brightness_scale', pl_open: 'payload_open', pl_cls: 'payload_close', pl_stop: 'payload_stop', stat_open: 'state_open', stat_clsd: 'state_closed', schema: 'schema', dev: 'device', json_attr_t: 'json_attributes_topic' };
let M = null;
function conn(c) {
  const k = [c.host, c.port, c.user, c.prefix].join('|'); if (M && M.k === k) return M;
  if (M) M.cl.close();
  const pre = (c.prefix || 'homeassistant').replace(/\/+$/, ''), cl = new Client({ host: c.host, port: +c.port || 1883, user: c.user, pass: c.password }), m = M = { k, cl, ent: {}, val: {} };
  cl.on((t, p) => {
    const s = p.toString();
    if (t.startsWith(pre + '/') && t.endsWith('/config')) {
      const comp = t.split('/')[1]; if (!s) return;
      let j; try { j = JSON.parse(s); } catch (e) { return; }
      const o = {}; Object.keys(j).forEach(x => { o[A[x] || x] = j[x]; });
      if (o['~']) Object.keys(o).forEach(x => { if (typeof o[x] === 'string' && /_topic$/.test(x)) o[x] = o[x].replace(/^~|~$/, o['~']); });
      o.comp = comp; o.id = o.unique_id || t; m.ent[o.id] = o;
      [o.state_topic, o.position_topic, o.brightness_state_topic].filter(Boolean).forEach(x => cl.subscribe(x));
      return;
    }
    m.val[t] = s;
  });
  cl.subscribe(pre + '/+/+/config'); cl.subscribe(pre + '/+/+/+/config');
  return m;
}
// « {{ value_json.temperature }} » → valeur ; sinon le texte brut
function render(tpl, raw) {
  if (raw == null) return undefined; if (!tpl) return raw;
  const mm = String(tpl).match(/value_json((?:\.[\w]+|\[['"][^'"]+['"]\])+)/);
  if (mm) { try { let v = JSON.parse(raw); mm[1].replace(/\.(\w+)|\[['"]([^'"]+)['"]\]/g, (x, a, b) => { v = v == null ? v : v[a || b]; }); return v; } catch (e) { return undefined; } }
  return raw;
}
const KIND = { door: 'door', window: 'door', garage_door: 'door', opening: 'door', motion: 'motion', occupancy: 'motion', presence: 'motion', moisture: 'leak' };
function shape(e, m) {
  const raw = m.val[e.state_topic], v = render(e.value_template, raw), nm = e.name || (e.device && e.device.name) || e.id, dn = e.device && e.device.name && e.name && !String(e.name).includes(e.device.name) ? e.device.name + ' ' + e.name : nm, info = 'MQTT · ' + ((e.device && (e.device.model || e.device.manufacturer)) || e.comp);
  const isOn = x => x === (e.state_on || e.payload_on || 'ON') || x === true || x === 'on' || x === 'ON';
  switch (e.comp) {
    case 'switch': return { kind: 'plug', name: dn, info, state: { on: isOn(v) } };
    case 'light': { if (e.schema === 'json') { let j = {}; try { j = JSON.parse(raw || '{}'); } catch (x) { } return { kind: 'light', name: dn, info, state: { on: j.state === 'ON', bri: j.brightness != null ? Math.round(j.brightness / (e.brightness_scale || 255) * 100) : 100 } }; }
      const b = render(null, m.val[e.brightness_state_topic]); return { kind: 'light', name: dn, info, state: { on: isOn(v), bri: b != null ? Math.round(b / (e.brightness_scale || 255) * 100) : 100 } }; }
    case 'cover': { const pos = render(e.position_template, m.val[e.position_topic]); return { kind: 'cover', name: dn, info, state: { pos: pos != null ? +pos : v === (e.state_open || 'open') ? 100 : 0 } }; }
    case 'binary_sensor': return { kind: KIND[e.device_class] || 'motion', name: dn, info, state: { on: isOn(v) } };
    case 'sensor': { const dc = e.device_class, k = dc === 'temperature' ? 'temp' : dc === 'humidity' ? 'hum' : dc === 'carbon_dioxide' ? 'co2' : dc === 'power' ? 'meter' : null; return k && { kind: k, name: dn, info, state: { val: v == null ? null : +v, unit: e.unit_of_measurement || '' } }; }
    case 'button': return { kind: 'scene', name: dn, info, state: {} };
  }
  return null;
}
module.exports = {
  id: 'mqttha', name: 'MQTT (découverte)', poll: 3000, secrets: ['password'],
  async test(c) { const m = conn(c); await m.cl.ready(5000); await new Promise(r => setTimeout(r, 1500)); return Object.keys(m.ent).length + ' entité(s) annoncée(s) sur le broker'; },
  async devices(c) { const m = conn(c); await m.cl.ready(5000); return Object.values(m.ent).map(e => { const s = shape(e, m); return s && Object.assign({ id: e.id }, s); }).filter(Boolean); },
  async command(c, id, p) {
    const m = conn(c), e = m.ent[id]; if (!e) throw new Error('appareil MQTT inconnu');
    const pub = (t, v) => m.cl.publish(t, typeof v === 'string' ? v : JSON.stringify(v));
    if (e.comp === 'light' && e.schema === 'json') { const b = {}; if ('on' in p) b.state = p.on ? 'ON' : 'OFF'; if ('bri' in p) { b.state = 'ON'; b.brightness = Math.round(p.bri / 100 * (e.brightness_scale || 255)); } return pub(e.command_topic, b); }
    if ('bri' in p && e.brightness_command_topic) return pub(e.brightness_command_topic, String(Math.round(p.bri / 100 * (e.brightness_scale || 255))));
    if ('pos' in p && e.set_position_topic) return pub(e.set_position_topic, String(Math.round(p.pos)));
    if ('pos' in p) return pub(e.command_topic, p.pos >= 50 ? (e.payload_open || 'OPEN') : (e.payload_close || 'CLOSE'));
    if (p.moving === 'stop') return pub(e.command_topic, e.payload_stop || 'STOP');
    if ('on' in p) return pub(e.command_topic, p.on ? (e.payload_on || 'ON') : (e.payload_off || 'OFF'));
    if (p.run) return pub(e.command_topic, e.payload_press || 'PRESS');
  }
};

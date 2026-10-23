// LinknLink (eRemote HA, eMotion, eTHS…) et tout appareil MQTT à « découverte automatique » (format Home Assistant,
// utilisé aussi par Zigbee2MQTT, Tasmota…). Pas besoin de Home Assistant : le serveur Bêta lit directement les
// annonces publiées sur le serveur MQTT (Mosquitto, installé avec le serveur Bêta).
'use strict';
const { connect } = require('./mqtt');

// abréviations des annonces de découverte
const ABBR = { '~': '~', stat_t: 'state_topic', cmd_t: 'command_topic', val_tpl: 'value_template', pl_on: 'payload_on', pl_off: 'payload_off', stat_on: 'state_on', stat_off: 'state_off', pl_prs: 'payload_press',
  unit_of_meas: 'unit_of_measurement', dev_cla: 'device_class', uniq_id: 'unique_id', obj_id: 'object_id', dev: 'device', bri_cmd_t: 'brightness_command_topic', bri_stat_t: 'brightness_state_topic', bri_scl: 'brightness_scale', bri_val_tpl: 'brightness_value_template',
  mode_cmd_t: 'mode_command_topic', mode_stat_t: 'mode_state_topic', mode_stat_tpl: 'mode_state_template', temp_cmd_t: 'temperature_command_topic', temp_stat_t: 'temperature_state_topic', temp_stat_tpl: 'temperature_state_template', curr_temp_t: 'current_temperature_topic', curr_temp_tpl: 'current_temperature_template',
  pos_t: 'position_topic', pos_tpl: 'position_template', set_pos_t: 'set_position_topic', pl_open: 'payload_open', pl_cls: 'payload_close', pl_stop: 'payload_stop', stat_open: 'state_open', stat_clsd: 'state_closed', schema: 'schema', opts: 'options', ops: 'options' };
function expand(o) {
  const out = {};
  for (const k in o) out[ABBR[k] || k] = o[k];
  const base = out['~'];
  if (base) for (const k in out) if (typeof out[k] === 'string' && /_topic$/.test(k)) out[k] = out[k].replace(/^~|~$/, base);
  if (out.device) { const d = out.device; out.device = { name: d.name, model: d.model || d.mdl, manufacturer: d.manufacturer || d.mf }; }
  return out;
}
// gabarits courants : {{ value }}, {{ value_json.a.b }}, {{ value_json['x'] }} (le reste est lu tel quel)
function tpl(t, raw) {
  if (!t) return raw;
  const m = String(t).match(/value_json((?:\.\w+|\[['"][^'"]+['"]\]|\[\d+\])+)/);
  if (!m) return raw;
  try { let v = JSON.parse(raw); for (const k of m[1].match(/\.\w+|\[[^\]]+\]/g)) { v = v == null ? v : v[k.replace(/^\.|^\[['"]?|['"]?\]$/g, '')]; } return v; } catch (e) { return raw; }
}
const KIND = (comp, c) => comp === 'light' ? 'light' : comp === 'switch' ? 'plug' : comp === 'climate' ? 'clim' : comp === 'cover' ? 'cover' : comp === 'button' || comp === 'scene' ? 'scene'
  : comp === 'sensor' ? ({ temperature: 'temp', humidity: 'hum', carbon_dioxide: 'co2', power: 'meter' }[c.device_class] || (/°C|°F/.test(c.unit_of_measurement || '') ? 'temp' : c.unit_of_measurement === '%' ? 'hum' : /W$/.test(c.unit_of_measurement || '') ? 'meter' : ''))
  : comp === 'binary_sensor' ? ({ motion: 'motion', occupancy: 'motion', presence: 'motion', moisture: 'leak', door: 'door', window: 'door', opening: 'door', garage_door: 'door' }[c.device_class] || '') : '';

// modes de clim : MQTT ↔ libellés de Bêta OS
const MODE = { off: 'Arrêt', auto: 'Auto', heat_cool: 'Chaud/froid', heat: 'Chaud', cool: 'Froid', dry: 'Sec', fan_only: 'Ventilation' };
const UNMODE = Object.fromEntries(Object.entries(MODE).map(([k, v]) => [v, k]));
let M = null, key = '';
const ENT = {};   // id → { comp, c, kind, s }
function ensure(cfg) {
  const k = [cfg.url, cfg.user, cfg.pass, cfg.prefix].join('|');
  if (M && k === key) return M;
  if (M) M.end();
  key = k; Object.keys(ENT).forEach(id => delete ENT[id]);
  if (!cfg.url) return (M = null);
  const prefix = cfg.prefix || 'homeassistant';
  M = connect({ url: cfg.url, user: cfg.user, pass: cfg.pass });
  M.onmessage = (topic, payload) => {
    const m = topic.match(new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/(\\w+)/(?:([^/]+)/)?([^/]+)/config$'));
    if (m) {
      const id = m[1] + ':' + (m[2] ? m[2] + '/' : '') + m[3];
      if (!payload) { delete ENT[id]; return; }
      let c; try { c = expand(JSON.parse(payload)); } catch (e) { return; }
      const kind = KIND(m[1], c); if (!kind) return;
      const name = [c.device && c.device.name, c.name].filter(Boolean).join(' ') || id;
      ENT[id] = { comp: m[1], c, kind, name, s: ENT[id] ? ENT[id].s : {} };
      ['state_topic', 'brightness_state_topic', 'mode_state_topic', 'temperature_state_topic', 'current_temperature_topic', 'position_topic'].forEach(k => { if (c[k]) M.subscribe(c[k]); });
      return;
    }
    for (const id in ENT) update(ENT[id], topic, payload);
  };
  M.subscribe(prefix + '/#');
  return M;
}
function update(e, topic, raw) {
  const c = e.c, s = e.s;
  if (topic === c.state_topic) {
    if (e.comp === 'light' && c.schema === 'json') { try { const j = JSON.parse(raw); if (j.state) s.on = j.state === 'ON'; if (j.brightness != null) s.bri = Math.round(j.brightness * 100 / (c.brightness_scale || 255)); } catch (e2) { } }
    else if (e.kind === 'temp' || e.kind === 'hum' || e.kind === 'co2' || e.kind === 'meter') { const v = parseFloat(tpl(c.value_template, raw)); if (!isNaN(v)) { s.val = Math.round(v * 10) / 10; s.unit = c.unit_of_measurement || ''; } }
    else if (e.comp === 'cover' && !c.position_topic) { const v = String(tpl(c.value_template, raw)); s.pos = v === (c.state_closed || 'closed') ? 0 : 100; }
    else { const v = String(tpl(c.value_template, raw)); s.on = v === String(c.state_on || c.payload_on || 'ON') || v === 'true' || v === 'on'; }
  }
  if (topic === c.brightness_state_topic) { const v = parseFloat(tpl(c.brightness_value_template, raw)); if (!isNaN(v)) s.bri = Math.round(v * 100 / (c.brightness_scale || 255)); }
  if (topic === c.mode_state_topic) { const v = String(tpl(c.mode_state_template, raw)); s.on = v !== 'off'; s.hvac = MODE[v] || v; }
  if (topic === c.temperature_state_topic) { const v = parseFloat(tpl(c.temperature_state_template, raw)); if (!isNaN(v)) s.temp = v; }
  if (topic === c.position_topic) { const v = parseFloat(tpl(c.position_template, raw)); if (!isNaN(v)) s.pos = v; }
}
const wait = ms => new Promise(r => setTimeout(r, ms));

module.exports = {
  id: 'linknlink', name: 'LinknLink (MQTT)', poll: 1000, secrets: ['pass'],
  async test(c) {
    if (!c.url) throw new Error('adresse du serveur MQTT manquante');
    const m = ensure(c); for (let i = 0; i < 20 && !m.connected && !m.error; i++) await wait(150);
    if (!m.connected) throw new Error(m.error || 'serveur MQTT injoignable');
    await wait(800); return Object.keys(ENT).length + ' appareil(s) annoncé(s)';
  },
  async devices(c) {
    const m = ensure(c); if (!m) throw new Error('adresse du serveur MQTT manquante');
    if (!m.connected) { for (let i = 0; i < 20 && !m.connected && !m.error; i++) await wait(150); if (!m.connected) throw new Error(m.error || 'serveur MQTT injoignable'); await wait(800); }
    return Object.keys(ENT).map(id => { const e = ENT[id]; return { id, name: e.name, kind: e.kind, info: (e.c.device && [e.c.device.manufacturer, e.c.device.model].filter(Boolean).join(' ')) || 'MQTT', state: Object.assign({}, e.s) }; });
  },
  async command(cfg, id, p) {
    const m = ensure(cfg), e = ENT[id]; if (!e) throw new Error('appareil inconnu (attendez son annonce MQTT)');
    const c = e.c, pub = (t, v) => { if (!t) throw new Error('cet appareil ne se commande pas'); m.publish(t, typeof v === 'object' ? JSON.stringify(v) : v); };
    if (e.kind === 'scene') { if (p.run || p.on) pub(c.command_topic, c.payload_press || 'PRESS'); return; }
    if (e.comp === 'light' && c.schema === 'json') { const b = {}; if ('on' in p) b.state = p.on ? 'ON' : 'OFF'; if ('bri' in p) { b.state = 'ON'; b.brightness = Math.round(p.bri * (c.brightness_scale || 255) / 100); } return pub(c.command_topic, b); }
    if (e.comp === 'climate') {
      if ('temp' in p) pub(c.temperature_command_topic, p.temp);
      if ('on' in p || 'hvac' in p) { const modes = c.modes || ['off', 'auto', 'cool', 'heat']; const asked = p.hvac && UNMODE[p.hvac], cur = UNMODE[e.s.hvac] || e.s.hvac, want = p.on === false || asked === 'off' ? 'off' : asked && modes.includes(asked) ? asked : cur && cur !== 'off' ? cur : modes.find(x => x !== 'off') || 'auto'; pub(c.mode_command_topic, want); }
      return;
    }
    if (e.comp === 'cover') {
      if ('moving' in p && p.moving === 'stop') return pub(c.command_topic, c.payload_stop || 'STOP');
      if ('pos' in p) return p.pos > 0 && p.pos < 100 && c.set_position_topic ? pub(c.set_position_topic, Math.round(p.pos)) : pub(c.command_topic, p.pos >= 100 ? c.payload_open || 'OPEN' : c.payload_close || 'CLOSE');
      return;
    }
    if ('bri' in p && c.brightness_command_topic) pub(c.brightness_command_topic, Math.round(p.bri * (c.brightness_scale || 255) / 100));
    if ('on' in p) pub(c.command_topic, p.on ? (c.payload_on || 'ON') : (c.payload_off || 'OFF'));
  },
  _test: { expand, tpl }
};

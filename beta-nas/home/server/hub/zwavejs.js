// Z-Wave JS UI (ou zwave-js-server) — tous les appareils Z-Wave par son serveur WebSocket (port 3000), en local.
'use strict';
const { connect, rpc } = require('./ws');
let Z = null;   // { ws, call, nodes: Map, err, url }
const url = c => { const h = String(c.host || '').trim().replace(/^wss?:\/\//, '').replace(/\/.*$/, ''); return 'ws://' + (/:\d+$/.test(h) ? h : h + ':3000'); };
async function conn(c) {
  if (Z && Z.url === url(c) && Z.ws.open) return Z;
  if (Z) try { Z.ws.close(); } catch (e) { }
  const ws = await connect(url(c)), call = rpc(ws, 'messageId'), z = Z = { ws, call, url: url(c), nodes: new Map() };
  const ver = ws.early.map(m => { try { return JSON.parse(m); } catch (e) { return {}; } }).find(m => m.type === 'version') || {};
  const ask = async (command, args) => { const r = await call(Object.assign({ command }, args || {}), 15000); if (r.success === false) throw new Error((r.message || r.errorCode || 'erreur Z-Wave')); return r.result; };
  z.ask = ask;
  await ask('set_api_schema', { schemaVersion: Math.min(ver.maxSchemaVersion || 32, 35) }).catch(() => { });
  const res = await ask('start_listening');
  res.state.nodes.forEach(n => z.nodes.set(n.nodeId, n));
  const prev = ws.onmessage;   // évènements : mise à jour des valeurs en direct
  ws.onmessage = (m, j) => {
    j = j || JSON.parse(m);
    if (j.type === 'event' && j.event && j.event.source === 'node' && j.event.event === 'value updated') {
      const n = z.nodes.get(j.event.nodeId), a = j.event.args; if (!n) return;
      const v = (n.values || []).find(x => x.commandClass === a.commandClass && x.endpoint === a.endpoint && x.property === a.property && x.propertyKey === a.propertyKey);
      if (v) v.value = a.newValue; else (n.values = n.values || []).push(Object.assign({}, a, { value: a.newValue }));
    } else if (prev) prev(m, j);
  };
  ws.onclose = () => { if (Z === z) Z = null; };
  return z;
}
const val = (n, cc, prop, key, ep) => { const v = (n.values || []).find(x => x.commandClass === cc && x.property === prop && (key === undefined || x.propertyKey === key) && (ep === undefined || (x.endpoint || 0) === ep)); return v && v.value; };
function shape(n) {
  const nm = n.name || n.label || ((n.deviceConfig && n.deviceConfig.description) || 'Z-Wave ' + n.nodeId), room = n.location || '', info = 'Z-Wave · ' + ((n.deviceConfig && n.deviceConfig.label) || n.nodeId), out = [], id = String(n.nodeId);
  const sw = val(n, 37, 'currentValue'), lvl = val(n, 38, 'currentValue'), gen = ((n.deviceClass || {}).specific || {}).label || '';
  if (lvl != null) out.push({ id, name: nm, room, info, kind: /motor|blind|shade|window/i.test(gen + nm) ? 'cover' : 'light', state: /motor|blind|shade|window/i.test(gen + nm) ? { pos: Math.round(lvl / 99 * 100) } : { on: lvl > 0, bri: Math.round(lvl / 99 * 100) } });
  else if (sw != null) out.push({ id, name: nm, room, info, kind: 'plug', state: { on: !!sw, w: val(n, 50, 'value', 66049) } });
  const lock = val(n, 98, 'currentMode'); if (lock != null) out.push({ id, name: nm, room, info, kind: 'lock', state: { locked: lock === 255 } });
  const sp = val(n, 67, 'setpoint', 1); if (sp != null) out.push({ id, name: nm, room, info, kind: 'clim', state: { on: val(n, 64, 'mode') !== 0, temp: sp, cur: val(n, 49, 'Air temperature'), hvac: 'Chaud' } });
  const door = val(n, 113, 'Access Control', 'Door state'), bin = (n.values || []).find(x => x.commandClass === 48);
  if (door != null) out.push({ id: id + '#door', name: nm, room, info, kind: 'door', state: { on: door === 22 } });
  else if (bin && /door|window/i.test(bin.property)) out.push({ id: id + '#door', name: nm, room, info, kind: 'door', state: { on: !!bin.value } });
  const mot = val(n, 113, 'Home Security', 'Motion sensor status'); if (mot != null || (bin && /motion/i.test(bin.property))) out.push({ id: id + '#motion', name: nm, room, info, kind: 'motion', state: { on: mot != null ? mot === 8 : !!bin.value } });
  const wat = val(n, 113, 'Water Alarm', 'Sensor status'); if (wat != null) out.push({ id: id + '#leak', name: nm, room, info, kind: 'leak', state: { on: wat === 2 } });
  if (!sp) { const t = val(n, 49, 'Air temperature'); if (t != null) out.push({ id: id + '#t', name: nm, room, info, kind: 'temp', state: { val: t, unit: '°C' } }); }
  const h = val(n, 49, 'Humidity'); if (h != null) out.push({ id: id + '#h', name: nm, room, info, kind: 'hum', state: { val: h, unit: '%' } });
  return out;
}
const set = (z, nodeId, commandClass, property, value, propertyKey) => z.ask('node.set_value', { nodeId, valueId: Object.assign({ commandClass, endpoint: 0, property }, propertyKey != null ? { propertyKey } : {}), value });
module.exports = {
  id: 'zwavejs', name: 'Z-Wave JS', poll: 3000,
  async test(c) { const z = await conn(c); return (z.nodes.size - 1) + ' appareil(s) Z-Wave'; },
  async devices(c) { const z = await conn(c); return [...z.nodes.values()].filter(n => !n.isControllerNode).flatMap(shape); },
  async command(c, id, p) {
    const z = await conn(c), nid = +id.split('#')[0], n = z.nodes.get(nid); if (!n || id.includes('#')) return;
    if ('locked' in p) return set(z, nid, 98, 'targetMode', p.locked ? 255 : 0);
    if ('temp' in p) return set(z, nid, 67, 'setpoint', p.temp, 1);
    if (val(n, 38, 'currentValue') != null) { if ('pos' in p) return set(z, nid, 38, 'targetValue', Math.round(p.pos * 0.99)); if ('bri' in p) return set(z, nid, 38, 'targetValue', Math.max(1, Math.round(p.bri * 0.99))); if ('on' in p) return set(z, nid, 38, 'targetValue', p.on ? 255 : 0); if (p.moving === 'stop') return set(z, nid, 38, 'Up', false); }
    if ('on' in p) return set(z, nid, 37, 'targetValue', !!p.on);
  }
};

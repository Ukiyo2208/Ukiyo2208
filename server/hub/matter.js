// Matter (contrôleur) — via le conteneur « python-matter-server » (WebSocket local, port 5580).
// Ajoutez n'importe quel appareil Matter avec son code d'appairage (ou le code « partager » d'une autre appli :
// Aqara, Alexa, Google Home, Apple Maison) : il est piloté ensuite 100 % en local.
'use strict';
const { connect, rpc } = require('./ws');
const url = c => { const h = String(c.host || '').trim().replace(/^wss?:\/\//, '').replace(/\/.*$/, ''); return 'ws://' + (/:\d+$/.test(h) ? h : h + ':5580') + '/ws'; };
async function withM(c, fn) {
  const ws = await connect(url(c)), call = rpc(ws, 'message_id');
  // le message d'accueil du serveur (sans identifiant) est simplement ignoré par rpc()
  const cmd = async (command, args, ms) => { const r = await call({ command, args: args || {} }, ms); if (r.error_code != null) throw new Error(r.details || 'erreur Matter ' + r.error_code); return r.result; };
  try { return await fn(cmd); } finally { ws.close(); }
}
// clusters Matter → type de tuile Bêta
const A = (n, ep, cl, at) => n.attributes[ep + '/' + cl + '/' + at];
function endpoints(n) { const s = new Set(); Object.keys(n.attributes || {}).forEach(k => { const e = +k.split('/')[0]; if (e) s.add(e); }); return [...s].sort((a, b) => a - b); }
const has = (n, ep, cl) => Object.keys(n.attributes).some(k => k.startsWith(ep + '/' + cl + '/'));
const KIND = {};   // type de chaque appareil (mémorisé à la lecture) pour choisir la bonne commande
const MODES = { 0: 'Arrêt', 1: 'Auto', 3: 'Froid', 4: 'Chaud', 7: 'Ventilation', 8: 'Sec' }, MODE_ID = { 'Arrêt': 0, Auto: 1, Froid: 3, Chaud: 4, Ventilation: 7, Sec: 8 };
function toDevices(n) {
  const label = A(n, 0, 40, 5) || A(n, 0, 40, 3) || 'Appareil Matter', maker = A(n, 0, 40, 1) || '', eps = endpoints(n), out = [];
  for (const ep of eps) {
    const id = n.node_id + '-' + ep, name = (A(n, ep, 57, 5) || label) + (eps.length > 1 && !A(n, ep, 57, 5) ? ' ' + ep : ''), info = [maker, A(n, 0, 40, 3)].filter(Boolean).join(' ');
    const on = A(n, ep, 6, 0);
    if (has(n, ep, 513)) out.push({ id, name, kind: 'clim', info, state: { on: A(n, ep, 513, 28) !== 0, cur: (A(n, ep, 513, 0) || 0) / 100, temp: ((A(n, ep, 513, 28) === 3 ? A(n, ep, 513, 17) : A(n, ep, 513, 18)) || 2000) / 100, hvac: MODES[A(n, ep, 513, 28)] || 'Auto' } });
    else if (has(n, ep, 258)) out.push({ id, name, kind: 'cover', info, state: { pos: 100 - Math.round((A(n, ep, 258, 14) || 0) / 100) } });
    else if (has(n, ep, 257)) out.push({ id, name, kind: 'lock', info, state: { locked: A(n, ep, 257, 0) === 1 } });
    else if (has(n, ep, 768) && on != null) out.push({ id, name, kind: 'rgb', info, state: { on: !!on, bri: Math.round((A(n, ep, 8, 0) || 254) / 2.54) } });
    else if (has(n, ep, 8) && on != null) out.push({ id, name, kind: 'light', info, state: { on: !!on, bri: Math.round((A(n, ep, 8, 0) || 254) / 2.54) } });
    else if (on != null) out.push({ id, name, kind: 'plug', info, state: { on: !!on, w: A(n, ep, 144, 8) != null ? Math.round(A(n, ep, 144, 8) / 1000) : undefined } });
    else if (has(n, ep, 1026)) out.push({ id, name, kind: 'temp', info, state: { val: (A(n, ep, 1026, 0) || 0) / 100 } });
    else if (has(n, ep, 1029)) out.push({ id, name, kind: 'hum', info, state: { val: Math.round((A(n, ep, 1029, 0) || 0) / 100) } });
    else if (has(n, ep, 1030)) out.push({ id, name, kind: 'motion', info, state: { on: !!(A(n, ep, 1030, 0) & 1) } });
    else if (has(n, ep, 69)) out.push({ id, name, kind: 'door', info, state: { on: A(n, ep, 69, 0) === false } });   // contact : false = ouvert
  }
  if (n.available === false) out.forEach(d => { d.info = 'hors ligne'; });
  return out;
}
module.exports = {
  id: 'matter', name: 'Matter', poll: 5000,
  actions: {
    // code à 11 chiffres ou QR « MT:… » ; pour un appareil déjà dans une autre appli : utilisez son code de partage
    async commission(c, b) {
      const code = String(b.pairCode || '').replace(/[\s-]/g, ''); if (!code) throw new Error('saisissez le code d’appairage Matter');
      const n = await withM(Object.assign({}, c, b.host ? { host: b.host } : {}), cmd => cmd('commission_with_code', { code, network_only: true }, 120000));
      return { info: 'Appareil ajouté (nœud ' + (n && n.node_id) + ')' };
    }
  },
  async test(c) { if (!c.host) throw new Error('adresse du serveur Matter manquante'); const nodes = await withM(c, cmd => cmd('get_nodes')); return nodes.length + ' appareil(s) Matter'; },
  async devices(c) { if (!c.host) return []; const nodes = await withM(c, cmd => cmd('get_nodes')), list = nodes.flatMap(toDevices); list.forEach(d => { KIND[d.id] = d.kind; }); return list; },
  async command(c, id, p, cur) {
    const [node, ep] = String(id).split('-').map(Number);
    return withM(c, async cmd => {
      const dc = (cluster, name, payload) => cmd('device_command', { node_id: node, endpoint_id: ep, cluster_id: cluster, command_name: name, payload: payload || {} });
      const wa = (path, value) => cmd('write_attribute', { node_id: node, attribute_path: ep + '/' + path, value });
      const k = KIND[id] || '';
      if (k === 'clim') {   // thermostat / clim
        if ('on' in p) await wa('513/28', p.on ? MODE_ID[(cur && cur.hvac !== 'Arrêt' && cur.hvac) || 'Auto'] : 0);
        if ('hvac' in p && p.hvac in MODE_ID) await wa('513/28', MODE_ID[p.hvac]);
        if ('temp' in p) await wa((cur && cur.hvac === 'Froid' ? '513/17' : '513/18'), Math.round(p.temp * 100));
        return;
      }
      if ('pos' in p) return dc(258, 'GoToLiftPercentage', { liftPercent100thsValue: (100 - Math.round(p.pos)) * 100 });
      if (p.moving === 'stop') return dc(258, 'StopMotion');
      if (k === 'lock' && 'locked' in p) return cmd('device_command', { node_id: node, endpoint_id: ep, cluster_id: 257, command_name: p.locked ? 'LockDoor' : 'UnlockDoor', payload: {}, timed_request_timeout_ms: 10000 });   // serrure : requête « minutée » exigée par Matter
      if ('bri' in p) return dc(8, 'MoveToLevelWithOnOff', { level: Math.max(1, Math.round(p.bri * 2.54)), transitionTime: 0 });
      if ('on' in p) return dc(6, p.on ? 'On' : 'Off');
    });
  },
  _test: { toDevices }
};

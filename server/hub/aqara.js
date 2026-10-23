// Aqara (Hub M3) et tout appareil Matter — via le service Matter installé à côté du serveur Bêta
// (python-matter-server : un simple contrôleur Matter, sans Home Assistant). Le Hub M3 partage ses appareils
// par son pont Matter ; on l'ajoute une fois avec son code d'appairage, puis tout reste en local.
'use strict';

const CL = { onoff: 6, level: 8, color: 768, temp: 1026, hum: 1029, occ: 1030, bool: 69, cover: 258, bridged: 57, basic: 40, desc: 29 };
let W = null, key = '', nodes = {}, seq = 0, wait = {}, err = '';
function ensure(c) {
  const url = c.url || 'ws://host.docker.internal:5580/ws';
  if (W && key === url && W.readyState <= 1) return W;
  if (W) try { W.close(); } catch (e) { }
  key = url; nodes = {}; err = '';
  W = new WebSocket(url);
  W.onopen = () => send('start_listening').then(list => { (list || []).forEach(n => { nodes[n.node_id] = n; }); W.ready = true; }).catch(e => { err = e.message; });
  W.onerror = () => { err = 'service Matter injoignable (' + url + ')'; };
  W.onclose = () => { W.ready = false; };
  W.onmessage = ev => {
    let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (m.message_id && wait[m.message_id]) { const w = wait[m.message_id]; delete wait[m.message_id]; clearTimeout(w.t); 'error_code' in m ? w.ko(new Error(m.details || 'erreur Matter ' + m.error_code)) : w.ok(m.result); return; }
    if (m.event === 'node_added' || m.event === 'node_updated') nodes[m.data.node_id] = m.data;
    else if (m.event === 'node_removed') delete nodes[m.data];
    else if (m.event === 'attribute_updated') { const [id, path, v] = m.data; if (nodes[id]) nodes[id].attributes[path] = v; }
  };
  return W;
}
function send(command, args, ms) {
  return new Promise((ok, ko) => {
    if (!W || W.readyState !== 1) return ko(new Error(err || 'service Matter non connecté'));
    const id = String(++seq); wait[id] = { ok, ko, t: setTimeout(() => { delete wait[id]; ko(new Error('le service Matter ne répond pas')); }, ms || 20000) };
    W.send(JSON.stringify(Object.assign({ message_id: id, command }, args ? { args } : {})));
  });
}
const ready = async c => { ensure(c); for (let i = 0; i < 30 && !W.ready && !err; i++) await new Promise(r => setTimeout(r, 150)); if (!W.ready) throw new Error(err || 'service Matter injoignable'); };

// un appareil Bêta OS par point d'accès (endpoint) utile de chaque nœud Matter
function list() {
  const out = [];
  for (const n of Object.values(nodes)) {
    const A = n.attributes || {}, eps = [...new Set(Object.keys(A).map(k => +k.split('/')[0]))].filter(e => e > 0);
    const has = (e, cl) => Object.keys(A).some(k => k.startsWith(e + '/' + cl + '/'));
    const a = (e, cl, at) => A[e + '/' + cl + '/' + at];
    const types = e => (a(e, CL.desc, 0) || []).map(t => t['0'] != null ? t['0'] : t.deviceType);
    for (const e of eps) {
      const ty = types(e); let kind = '';
      if (has(e, CL.cover)) kind = 'cover';
      else if (has(e, CL.onoff)) kind = has(e, CL.level) || ty.some(t => t >= 256 && t <= 269 && t !== 266) ? (has(e, CL.color) ? 'rgb' : 'light') : 'plug';
      else if (has(e, CL.temp)) kind = 'temp';
      else if (has(e, CL.hum)) kind = 'hum';
      else if (has(e, CL.occ)) kind = 'motion';
      else if (has(e, CL.bool)) kind = ty.includes(67) ? 'leak' : 'door';
      if (!kind) continue;
      const s = {};
      if (a(e, CL.onoff, 0) != null) s.on = !!a(e, CL.onoff, 0);
      if (a(e, CL.level, 0) != null && kind !== 'plug') s.bri = Math.round(a(e, CL.level, 0) * 100 / 254);
      if (kind === 'temp' && a(e, CL.temp, 0) != null) { s.val = Math.round(a(e, CL.temp, 0) / 10) / 10; s.unit = '°C'; }
      if (kind === 'hum' && a(e, CL.hum, 0) != null) { s.val = Math.round(a(e, CL.hum, 0) / 100); s.unit = '%'; }
      if (kind === 'motion') s.on = !!(a(e, CL.occ, 0) & 1);
      if (kind === 'door') s.on = a(e, CL.bool, 0) === false;          // contact fermé = true
      if (kind === 'leak') s.on = !!a(e, CL.bool, 0);
      if (kind === 'cover' && a(e, CL.cover, 14) != null) s.pos = 100 - Math.round(a(e, CL.cover, 14) / 100);   // Matter : 0 = ouvert
      const name = a(e, CL.bridged, 5) || a(e, CL.bridged, 3) || a(0, CL.basic, 5) || a(0, CL.basic, 3) || 'Appareil Matter ' + n.node_id + '-' + e;
      out.push({ id: n.node_id + '/' + e, name, kind, info: (a(e, CL.bridged, 3) ? [a(e, CL.bridged, 1), a(e, CL.bridged, 3)].filter(Boolean).join(' ') : 'via ' + (a(0, CL.basic, 3) || 'Matter')) + (n.available === false ? ' · hors ligne' : ''), state: s });
    }
  }
  return out;
}

module.exports = {
  id: 'aqara', name: 'Aqara (Matter)', poll: 1000, secrets: [],
  actions: {
    // ajoute le pont Matter du Hub M3 (ou un appareil Matter) avec son code d'appairage
    async commission(c, b) {
      const code = String(b.code || '').replace(/[\s-]/g, ''); if (!code) throw new Error('code d’appairage manquant');
      await ready(c);
      await send('commission_with_code', { code: /^MT:/i.test(code) ? code.toUpperCase() : code, network_only: true }, 180000);
      await new Promise(r => setTimeout(r, 1500));
      return { status: 'ok', info: 'Ajouté · ' + list().length + ' appareil(s) Matter' };
    }
  },
  async test(c) { await ready(c); const n = Object.keys(nodes).length; return n ? n + ' nœud(s) Matter · ' + list().length + ' appareil(s)' : 'service Matter prêt, ajoutez le Hub M3 avec son code'; },
  async devices(c) { await ready(c); return list(); },
  async command(c, id, p) {
    await ready(c);
    const [node_id, endpoint_id] = id.split('/').map(Number), cmd = (cluster_id, command_name, payload) => send('device_command', { node_id, endpoint_id, cluster_id, command_name, payload: payload || {} });
    if ('moving' in p && p.moving === 'stop') return cmd(CL.cover, 'StopMotion');
    if ('pos' in p) return p.pos >= 100 ? cmd(CL.cover, 'UpOrOpen') : p.pos <= 0 ? cmd(CL.cover, 'DownOrClose') : cmd(CL.cover, 'GoToLiftPercentage', { liftPercent100thsValue: Math.round((100 - p.pos) * 100) });
    if ('bri' in p && p.bri > 0) return cmd(CL.level, 'MoveToLevelWithOnOff', { level: Math.max(1, Math.round(p.bri * 254 / 100)), transitionTime: 0, optionsMask: 0, optionsOverride: 0 });
    if ('on' in p) return cmd(CL.onoff, p.on ? 'On' : 'Off');
  }
};

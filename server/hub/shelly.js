// Shelly — API locale (génération 1 : /status, /relay ; génération 2 et + : RPC /rpc/…).
// Prises, relais, variateurs et volets, sans compte ni cloud. Adresse IP de chaque Shelly.
'use strict';
const { request } = require('./net');
const hosts = c => String(c.hosts || '').split(/[\s,;]+/).map(h => h.replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter(Boolean);
const auth = c => c.password ? { Authorization: 'Basic ' + Buffer.from('admin:' + c.password).toString('base64') } : {};
const get = async (c, h, p) => { const r = await request('http://' + h + p, { headers: auth(c), timeout: 4000 }); const j = r.json(); if (j == null) throw new Error('réponse illisible'); return j; };

async function info(c, h) {
  const s = await get(c, h, '/shelly');
  return { gen: s.gen || 1, model: s.model || s.type || 'Shelly', name: s.name || '' };
}
async function list(c, h) {
  const i = await info(c, h), out = [], base = i.name || (i.model + ' ' + h.split('.').pop());
  if (i.gen >= 2) {
    const st = await get(c, h, '/rpc/Shelly.GetStatus'), cfg = await get(c, h, '/rpc/Shelly.GetConfig').catch(() => ({}));
    Object.keys(st).forEach(k => {
      const m = k.match(/^(switch|light|cover):(\d+)$/); if (!m) return;
      const v = st[k], nm = (cfg[k] && cfg[k].name) || base + (st[m[1] + ':1'] ? ' ' + (+m[2] + 1) : '');
      if (m[1] === 'switch') out.push({ id: h + '|switch:' + m[2], name: nm, kind: 'plug', state: { on: !!v.output } });
      if (m[1] === 'light') out.push({ id: h + '|light:' + m[2], name: nm, kind: 'light', state: { on: !!v.output, bri: v.brightness } });
      if (m[1] === 'cover') out.push({ id: h + '|cover:' + m[2], name: nm, kind: 'cover', state: { pos: v.current_pos != null ? v.current_pos : (v.state === 'open' ? 100 : 0) } });
    });
  } else {
    const st = await get(c, h, '/status'), set = await get(c, h, '/settings').catch(() => ({}));
    if (set.mode === 'roller' && st.rollers) st.rollers.forEach((r, n) => out.push({ id: h + '|roller:' + n, name: base, kind: 'cover', state: { pos: r.current_pos } }));
    else (st.relays || []).forEach((r, n) => out.push({ id: h + '|relay:' + n, name: ((set.relays || [])[n] || {}).name || base + (st.relays.length > 1 ? ' ' + (n + 1) : ''), kind: 'plug', state: { on: !!r.ison } }));
    (st.lights || []).forEach((l, n) => out.push({ id: h + '|light:' + n, name: base, kind: 'light', state: { on: !!l.ison, bri: l.brightness } }));
  }
  return out;
}

module.exports = {
  id: 'shelly', name: 'Shelly', poll: 3000, secrets: ['password'],
  async test(c) {
    const hs = hosts(c); if (!hs.length) throw new Error('ajoutez au moins une adresse IP');
    const r = await Promise.all(hs.map(h => info(c, h).then(i => i.model, e => '⚠ ' + h + ' : ' + e.message)));
    if (r.every(x => x.startsWith('⚠'))) throw new Error(r.join(' · '));
    return r.length + ' Shelly : ' + r.join(', ');
  },
  async devices(c) { return (await Promise.all(hosts(c).map(h => list(c, h).catch(() => [])))).flat(); },
  async command(c, id, p) {
    const [h, comp] = id.split('|'), [t, n] = comp.split(':'), q = o => '?' + new URLSearchParams(o).toString();
    if (t === 'switch') return get(c, h, '/rpc/Switch.Set' + q({ id: n, on: !!p.on }));
    if (t === 'relay') return get(c, h, '/relay/' + n + q({ turn: p.on ? 'on' : 'off' }));
    if (t === 'light') {
      const gen2 = !/^\d+$/.test(n) || (await info(c, h)).gen >= 2, o = {};
      if (gen2) { o.id = n; if ('on' in p) o.on = !!p.on; if ('bri' in p) { o.brightness = Math.round(p.bri); o.on = true; } return get(c, h, '/rpc/Light.Set' + q(o)); }
      if ('on' in p) o.turn = p.on ? 'on' : 'off'; if ('bri' in p) { o.brightness = Math.round(p.bri); o.turn = 'on'; } return get(c, h, '/light/' + n + q(o));
    }
    if (t === 'cover') { if (p.moving === 'stop') return get(c, h, '/rpc/Cover.Stop' + q({ id: n })); if ('pos' in p) return get(c, h, '/rpc/Cover.GoToPosition' + q({ id: n, pos: Math.round(p.pos) })); }
    if (t === 'roller') { if (p.moving === 'stop') return get(c, h, '/roller/' + n + q({ go: 'stop' })); if ('pos' in p) return get(c, h, '/roller/' + n + q({ go: 'to_pos', roller_pos: Math.round(p.pos) })); }
  }
};

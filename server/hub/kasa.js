// TP-Link Kasa (anciens modèles) — protocole local TCP 9999 (chiffrement XOR). Prises, multiprises, interrupteurs, ampoules.
'use strict';
const net = require('net');
const hosts = c => String(c.hosts || '').split(/[\s,;]+/).map(h => h.replace(/[:/].*$/, '')).filter(Boolean);
const enc = s => { const b = Buffer.from(s), o = Buffer.alloc(4 + b.length); o.writeUInt32BE(b.length); let k = 171; for (let i = 0; i < b.length; i++) { k = b[i] ^ k; o[4 + i] = k; } return o; };
const dec = b => { let k = 171; const o = Buffer.alloc(b.length); for (let i = 0; i < b.length; i++) { o[i] = b[i] ^ k; k = b[i]; } return o.toString(); };
function send(ip, obj) {
  return new Promise((ok, ko) => {
    const s = net.connect({ host: ip, port: 9999 }); let buf = Buffer.alloc(0);
    const end = (e, v) => { s.destroy(); e ? ko(e) : ok(v); };
    s.setTimeout(4000, () => end(new Error('appareil injoignable')));
    s.on('error', e => end(new Error('appareil injoignable (' + e.code + ') — modèle récent ? essayez la fiche « Tapo »')));
    s.on('connect', () => s.write(enc(JSON.stringify(obj))));
    s.on('data', d => { buf = Buffer.concat([buf, d]); if (buf.length >= 4 && buf.length >= 4 + buf.readUInt32BE(0)) { try { end(null, JSON.parse(dec(buf.slice(4, 4 + buf.readUInt32BE(0))))); } catch (e) { end(e); } } });
  });
}
const info = ip => send(ip, { system: { get_sysinfo: {} } }).then(r => r.system.get_sysinfo);
const LS = 'smartlife.iot.smartbulb.lightingservice';
const hsvHex = (h, s, v) => { s /= 100; v = 1; const f = n => { const k = (n + h / 60) % 6; return ('0' + Math.round((v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255).toString(16)).slice(-2); }; return '#' + f(5) + f(3) + f(1); };
const hexHsv = hex => { const n = parseInt(hex.slice(1), 16), r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255, mx = Math.max(r, g, b), d = mx - Math.min(r, g, b); let h = 0; if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return { hue: Math.round((h * 60 + 360) % 360), saturation: Math.round(mx ? d / mx * 100 : 0) }; };
module.exports = {
  id: 'kasa', name: 'TP-Link Kasa', poll: 4000,
  async test(c) { const hs = hosts(c); if (!hs.length) throw new Error('adresse IP manquante'); const r = await Promise.all(hs.map(h => info(h).then(i => i.alias, e => '⚠ ' + h + ' : ' + e.message))); if (r.every(x => x.startsWith('⚠'))) throw new Error(r.join(' · ')); return r.length + ' appareil(s) : ' + r.join(', '); },
  async devices(c) {
    return (await Promise.all(hosts(c).map(async h => { try { const i = await info(h);
      if (i.children && i.children.length) return i.children.map(ch => ({ id: h + '|' + ch.id, name: ch.alias, kind: 'plug', info: i.model, state: { on: !!ch.state } }));
      if (i.light_state) { const l = i.light_state.on_off ? i.light_state : Object.assign({ on_off: 0 }, i.light_state.dft_on_state || {}); return [{ id: h, name: i.alias, kind: i.is_color ? 'rgb' : 'light', info: i.model, state: Object.assign({ on: !!i.light_state.on_off, bri: l.brightness }, i.is_color ? { color: hsvHex(l.hue || 0, l.saturation || 0) } : {}) }]; }
      return [{ id: h, name: i.alias, kind: 'brightness' in i ? 'light' : 'plug', info: i.model, state: Object.assign({ on: !!i.relay_state }, 'brightness' in i ? { bri: i.brightness } : {}) }];
    } catch (e) { return []; } }))).flat();
  },
  async command(c, id, p) {
    const [h, child] = id.split('|'), ctx = child ? { context: { child_ids: [child] } } : {};
    const i = child ? {} : await info(h);
    if (i.light_state) { const st = { ignore_default: 1, transition_period: 300 }; if ('on' in p) st.on_off = p.on ? 1 : 0; if ('bri' in p) { st.brightness = Math.round(p.bri); st.on_off = 1; } if (p.color) Object.assign(st, hexHsv(p.color), { color_temp: 0, on_off: 1 }); return send(h, { [LS]: { transition_light_state: st } }); }
    if ('on' in p) await send(h, Object.assign({ system: { set_relay_state: { state: p.on ? 1 : 0 } } }, ctx));
    if ('bri' in p) await send(h, { 'smartlife.iot.dimmer': { set_brightness: { brightness: Math.round(p.bri) } } });
  },
  _test: { enc, dec }
};

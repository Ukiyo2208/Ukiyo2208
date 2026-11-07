// myStrom — prises (WiFi Switch : consommation et température) et ampoules (WiFi Bulb). API REST locale, sans compte.
'use strict';
const { json, request } = require('./net');
const hosts = c => String(c.hosts || '').split(/[\s,;]+/).map(h => h.replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter(Boolean);
async function probe(h) {
  try { const r = await json('http://' + h + '/report', { timeout: 5000 }); if (r && 'relay' in r) return { type: 'switch', r }; } catch (e) { }
  const b = await json('http://' + h + '/api/v1/device', { timeout: 5000 }); const mac = Object.keys(b || {})[0]; if (!mac) throw new Error('appareil myStrom non reconnu');
  return { type: 'bulb', mac, r: b[mac] };
}
module.exports = {
  id: 'mystrom', name: 'myStrom', poll: 6000, secrets: [],
  async test(c) { const h = hosts(c); if (!h.length) throw new Error('adresse IP manquante'); const p = await probe(h[0]); return h.length + ' appareil(s) · ' + (p.type === 'bulb' ? 'ampoule' : 'prise'); },
  async devices(c) {
    const out = [];
    for (const h of hosts(c)) {
      try {
        const p = await probe(h);
        if (p.type === 'switch') {
          out.push({ id: h, name: 'Prise myStrom ' + h.split('.').pop(), kind: 'plug', info: 'myStrom WiFi Switch', state: { on: !!p.r.relay } });
          out.push({ id: h + '|w', name: 'Consommation myStrom ' + h.split('.').pop(), kind: 'meter', info: 'myStrom', state: { val: Math.round(p.r.power || 0), unit: 'W' } });
          if (p.r.temperature != null) out.push({ id: h + '|t', name: 'Température myStrom ' + h.split('.').pop(), kind: 'temp', info: 'myStrom', state: { val: Math.round(p.r.temperature * 10) / 10, unit: '°C' } });
        } else {
          const v = String(p.r.color || '').split(';'), bri = p.r.mode === 'hsv' && v.length === 3 ? +v[2] : 100;
          out.push({ id: h + '|' + p.mac, name: 'Ampoule myStrom ' + h.split('.').pop(), kind: 'light', info: 'myStrom WiFi Bulb', state: { on: !!p.r.on, bri } });
        }
      } catch (e) { out.push({ id: h, name: 'myStrom ' + h, kind: 'plug', error: e.message, state: {} }); }
    }
    return out;
  },
  async command(c, id, p) {
    const [h, mac] = id.split('|');
    if (mac === 'w' || mac === 't') return;
    if (!mac) { if ('on' in p) await request('http://' + h + '/relay?state=' + (p.on ? 1 : 0), { timeout: 5000 }); return; }
    const form = {};
    if ('on' in p) form.action = p.on ? 'on' : 'off';
    if ('bri' in p) { form.action = 'on'; form.color = '0;0;' + Math.max(1, Math.min(100, Math.round(p.bri))); form.mode = 'hsv'; form.ramp = '300'; }
    if (Object.keys(form).length) await request('http://' + h + '/api/v1/device/' + mac, { form, timeout: 5000 });
  }
};

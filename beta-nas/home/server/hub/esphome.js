// ESPHome — API web locale du module (composant « web_server: » à ajouter dans le YAML de l'appareil).
// Les états arrivent par le flux /events ; les commandes sont de simples requêtes POST.
'use strict';
const http = require('http');
const { request } = require('./net');
const hosts = c => String(c.hosts || '').split(/[\s,;]+/).map(h => h.replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter(Boolean);
const auth = c => c.password ? { Authorization: 'Basic ' + Buffer.from((c.user || 'admin') + ':' + c.password).toString('base64') } : {};
const KIND = { switch: 'plug', light: 'light', cover: 'cover', fan: 'fan', binary_sensor: 'door', sensor: 'temp', lock: 'lock', valve: 'valve' };

// lit le flux d'événements quelques instants : l'appareil y envoie l'état de toutes ses entités
function events(c, h, ms) {
  return new Promise((ok, ko) => {
    const out = {}; let buf = '', done = false;
    const end = () => { if (done) return; done = true; req.destroy(); ok(out); };
    const req = http.get({ host: h.split(':')[0], port: +h.split(':')[1] || 80, path: '/events', headers: auth(c), timeout: 4000 }, res => {
      if (res.statusCode === 401) { done = true; req.destroy(); return ko(new Error('mot de passe du web_server refusé')); }
      if (res.statusCode !== 200) { done = true; req.destroy(); return ko(new Error('web_server absent (HTTP ' + res.statusCode + ') : ajoutez « web_server: » au YAML')); }
      res.setEncoding('utf8');
      res.on('data', ch => {
        buf += ch; let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          const ev = (block.match(/^event: ?(.*)$/m) || [])[1], data = (block.match(/^data: ?(.*)$/m) || [])[1];
          if (ev === 'state' && data) try { const j = JSON.parse(data); if (j.id) out[j.id] = j; } catch (e) { }
        }
      });
      setTimeout(end, ms);
    });
    req.on('timeout', () => { if (!done) { done = true; req.destroy(); ko(new Error('module injoignable')); } });
    req.on('error', e => { if (!done) { done = true; ko(new Error('module injoignable (' + e.code + ')')); } });
  });
}
const human = s => s.replace(/_/g, ' ').replace(/^./, x => x.toUpperCase());
function toDev(h, j) {
  const [dom, ...rest] = j.id.split('-'), oid = rest.join('-'), kind = KIND[dom]; if (!kind) return null;
  const st = {}, on = String(j.state || '').toUpperCase();
  if (dom === 'switch' || dom === 'light' || dom === 'fan') st.on = on === 'ON' || j.value === true;
  if (dom === 'light' && j.brightness != null) st.bri = Math.round(j.brightness / 2.55);
  if (dom === 'cover' || dom === 'valve') st.pos = j.position != null ? Math.round(j.position * 100) : on === 'OPEN' ? 100 : 0;
  if (dom === 'binary_sensor') st.on = on === 'ON' || j.value === true;
  if (dom === 'lock') st.locked = on === 'LOCKED';
  if (dom === 'sensor') { st.val = typeof j.value === 'number' ? Math.round(j.value * 10) / 10 : parseFloat(j.state); st.unit = (String(j.state || '').match(/[^\d.\-\s]+.*$/) || [''])[0].trim(); }
  const k = dom === 'sensor' ? (/%/.test(st.unit) ? 'hum' : /W/.test(st.unit) ? 'meter' : /ppm/.test(st.unit) ? 'co2' : 'temp') : dom === 'binary_sensor' ? (/motion|mouvement|pir|presence/i.test(oid) ? 'motion' : /leak|fuite|water/i.test(oid) ? 'leak' : 'door') : kind;
  return { id: h + '|' + dom + '|' + oid, name: j.name || human(oid), kind: k, state: st };
}

module.exports = {
  id: 'esphome', name: 'ESPHome', poll: 5000, secrets: ['password'],
  async test(c) {
    const hs = hosts(c); if (!hs.length) throw new Error('ajoutez au moins une adresse IP');
    const r = await Promise.all(hs.map(h => events(c, h, 1500).then(o => Object.keys(o).length + ' entité(s)', e => '⚠ ' + h + ' : ' + e.message)));
    if (r.every(x => x.startsWith('⚠'))) throw new Error(r.join(' · '));
    return hs.length + ' module(s) : ' + r.join(', ');
  },
  async devices(c) { return (await Promise.all(hosts(c).map(h => events(c, h, 1500).then(o => Object.values(o).map(j => toDev(h, j)).filter(Boolean), () => [])))).flat(); },
  async command(c, id, p) {
    const [h, dom, oid] = id.split('|'), go = (action, q) => request('http://' + h + '/' + dom + '/' + oid + '/' + action + (q ? '?' + new URLSearchParams(q) : ''), { method: 'POST', headers: auth(c), body: '', timeout: 5000 });
    if ((dom === 'switch' || dom === 'fan') && 'on' in p) return go(p.on ? 'turn_on' : 'turn_off');
    if (dom === 'light') { if ('bri' in p) return go('turn_on', { brightness: Math.round(p.bri * 2.55) }); if ('on' in p) return go(p.on ? 'turn_on' : 'turn_off'); }
    if (dom === 'cover' || dom === 'valve') { if (p.moving === 'stop') return go('stop'); if ('pos' in p) return p.pos >= 100 ? go('open') : p.pos <= 0 ? go('close') : go('set', { position: (p.pos / 100).toFixed(2) }); }
    if (dom === 'lock' && 'locked' in p) return go(p.locked ? 'lock' : 'unlock');
  },
  _test: { toDev }
};

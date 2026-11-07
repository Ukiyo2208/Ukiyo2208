// Homey Pro (2019 et 2023) — tous les appareils de la box Athom, en local avec une clé API (Réglages › Clés API).
'use strict';
const { json, request } = require('./net');
const base = c => { const h = String(c.host || '').trim().replace(/\/+$/, ''); return /^https?:/.test(h) ? h : 'http://' + h; };
const H = c => ({ Authorization: 'Bearer ' + (c.token || '') });
const cap = (d, k) => d.capabilitiesObj && d.capabilitiesObj[k] ? d.capabilitiesObj[k].value : undefined;
const has = (d, k) => !!(d.capabilitiesObj && k in d.capabilitiesObj);
// une fiche Homey → un ou plusieurs appareils Bêta (un capteur multi-mesures donne plusieurs appareils)
function map(d, room) {
  const o = [], b = { room, info: 'Homey · ' + (d.driverId || d.class || '').split(':').pop() }, cl = d.class;
  if (cl === 'light' || (has(d, 'dim') && has(d, 'onoff') && !['windowcoverings', 'blinds', 'curtain'].includes(cl))) o.push(Object.assign({ id: d.id, name: d.name, kind: has(d, 'light_hue') ? 'rgb' : 'light', state: { on: !!cap(d, 'onoff'), bri: has(d, 'dim') ? Math.round((cap(d, 'dim') || 0) * 100) : undefined } }, b));
  else if (['windowcoverings', 'blinds', 'curtain', 'sunshade'].includes(cl) || has(d, 'windowcoverings_set')) o.push(Object.assign({ id: d.id, name: d.name, kind: 'cover', state: { pos: Math.round((cap(d, 'windowcoverings_set') || 0) * 100) } }, b));
  else if (['thermostat', 'heater'].includes(cl) || has(d, 'target_temperature')) o.push(Object.assign({ id: d.id, name: d.name, kind: 'clim', state: { on: has(d, 'onoff') ? !!cap(d, 'onoff') : true, temp: cap(d, 'target_temperature'), cur: cap(d, 'measure_temperature'), modes: ['Auto', 'Arrêt'] } }, b));
  else if (cl === 'lock' || has(d, 'locked')) o.push(Object.assign({ id: d.id, name: d.name, kind: 'lock', state: { locked: !!cap(d, 'locked') } }, b));
  else if (['tv', 'speaker', 'amplifier'].includes(cl)) o.push(Object.assign({ id: d.id, name: d.name, kind: cl === 'tv' ? 'tv' : 'speaker', state: { on: !!cap(d, 'onoff'), vol: has(d, 'volume_set') ? Math.round(cap(d, 'volume_set') * 100) : undefined } }, b));
  else if (cl === 'fan') o.push(Object.assign({ id: d.id, name: d.name, kind: 'fan', state: { on: !!cap(d, 'onoff') } }, b));
  else if (has(d, 'onoff')) o.push(Object.assign({ id: d.id, name: d.name, kind: 'plug', state: { on: !!cap(d, 'onoff') } }, b));
  // mesures (aussi pour les prises qui mesurent la consommation, les thermostats…)
  if (has(d, 'measure_temperature') && !o.some(x => x.kind === 'clim')) o.push(Object.assign({ id: d.id + '|t', name: d.name + ' — température', kind: 'temp', state: { val: cap(d, 'measure_temperature'), unit: '°C' } }, b));
  if (has(d, 'measure_humidity')) o.push(Object.assign({ id: d.id + '|h', name: d.name + ' — humidité', kind: 'hum', state: { val: cap(d, 'measure_humidity'), unit: '%' } }, b));
  if (has(d, 'measure_power')) o.push(Object.assign({ id: d.id + '|w', name: d.name + ' — consommation', kind: 'meter', state: { val: Math.round(cap(d, 'measure_power') || 0), unit: 'W' } }, b));
  if (has(d, 'alarm_motion')) o.push(Object.assign({ id: d.id + '|m', name: d.name, kind: 'motion', state: { on: !!cap(d, 'alarm_motion') } }, b));
  if (has(d, 'alarm_contact')) o.push(Object.assign({ id: d.id + '|c', name: d.name, kind: 'door', state: { on: !!cap(d, 'alarm_contact') } }, b));
  if (has(d, 'alarm_water')) o.push(Object.assign({ id: d.id + '|l', name: d.name, kind: 'leak', state: { on: !!cap(d, 'alarm_water') } }, b));
  return o;
}
const set = (c, id, k, value) => request(base(c) + '/api/manager/devices/device/' + id + '/capability/' + k, { method: 'PUT', headers: H(c), body: { value }, timeout: 8000 });
module.exports = {
  id: 'homey', name: 'Homey', poll: 6000, secrets: ['token'],
  async test(c) { const d = await json(base(c) + '/api/manager/devices/device/', { headers: H(c), timeout: 8000 }); return Object.keys(d || {}).length + ' appareil(s) dans Homey'; },
  async devices(c) {
    const [d, z] = await Promise.all([json(base(c) + '/api/manager/devices/device/', { headers: H(c), timeout: 10000 }), json(base(c) + '/api/manager/zones/zone/', { headers: H(c), timeout: 10000 }).catch(() => ({}))]);
    return Object.values(d || {}).flatMap(x => map(x, (z[x.zone] || {}).name || ''));
  },
  async command(c, id, p) {
    if (id.includes('|')) return;
    if ('on' in p) await set(c, id, 'onoff', !!p.on);
    if ('bri' in p) await set(c, id, 'dim', Math.max(0, Math.min(1, p.bri / 100)));
    if ('pos' in p) await set(c, id, 'windowcoverings_set', Math.max(0, Math.min(1, p.pos / 100)));
    if (p.moving === 'stop') await set(c, id, 'windowcoverings_state', 'idle').catch(() => { });
    if ('temp' in p) await set(c, id, 'target_temperature', +p.temp);
    if (p.hvac === 'Arrêt') await set(c, id, 'onoff', false).catch(() => { });
    if ('locked' in p) await set(c, id, 'locked', !!p.locked);
    if ('vol' in p) await set(c, id, 'volume_set', Math.max(0, Math.min(1, p.vol / 100)));
  },
  _map: map
};

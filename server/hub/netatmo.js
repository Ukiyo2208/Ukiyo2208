// Netatmo (thermostat, vannes, station météo) et Legrand « with Netatmo » (prises, interrupteurs, volets Céliane / dooxie).
// API officielle, connexion OAuth avec votre compte Netatmo.
'use strict';
const { json, request } = require('./net');
const API = 'https://api.netatmo.com';
const ON_TYPES = /^(BNLD|BNIL|BNSL|BNCX|BNXM|NLP|NLPT|NLPM|NLPO|NLPD|NLL|NLLV|NLF|NLFN|NLFE|NLM|NLIS|NLD|NLC|NLDD|NLPS)$/;
module.exports = {
  id: 'netatmo', name: 'Netatmo / Legrand', poll: 30000, secrets: ['clientSecret', 'tokens'],
  oauth: { auth: API + '/oauth2/authorize', token: API + '/oauth2/token', scope: 'read_thermostat write_thermostat read_station read_magellan write_magellan read_bubendorff write_bubendorff read_smarther write_smarther read_camera read_presence read_smokedetector read_carbonmonoxidedetector' },
  async test(c, h) { const r = await json(API + '/api/homesdata', { headers: await h.auth() }); return (r.body.homes || []).map(x => x.name).join(', ') || 'Compte relié'; },
  async devices(c, h) {
    const H = await h.auth(), data = await json(API + '/api/homesdata', { headers: H }), out = [];
    for (const home of data.body.homes || []) {
      const s = (await json(API + '/api/homestatus?home_id=' + home.id, { headers: H })).body.home || {}, rn = {};
      (home.rooms || []).forEach(r => { rn[r.id] = r.name; });
      (s.rooms || []).forEach(r => { if (r.therm_setpoint_temperature == null) return; out.push({ id: home.id + '|room|' + r.id, name: 'Chauffage ' + (rn[r.id] || r.id), room: rn[r.id] || '', kind: 'clim', info: 'Thermostat Netatmo', state: { on: r.therm_setpoint_mode !== 'off', temp: r.therm_setpoint_temperature, cur: r.therm_measured_temperature, hvac: 'Chaud' } }); });
      (s.modules || []).forEach(m => {
        const def = (home.modules || []).find(x => x.id === m.id) || {}, room = rn[def.room_id] || '', id = home.id + '|mod|' + m.id;
        if (m.current_position != null) out.push({ id, name: def.name || 'Volet', room, kind: 'cover', info: 'Legrand / Bubendorff', state: { pos: m.current_position } });
        else if (m.on != null && ON_TYPES.test(m.type || def.type || '')) out.push({ id, name: def.name || 'Lumière', room, kind: m.brightness != null ? 'light' : 'plug', info: 'Legrand with Netatmo', state: m.brightness != null ? { on: !!m.on, bri: m.brightness } : { on: !!m.on, w: m.power } });
      });
    }
    try {   // station météo
      const st = await json(API + '/api/getstationsdata', { headers: H });
      (st.body.devices || []).forEach(d => [d].concat(d.modules || []).forEach(m => { const v = m.dashboard_data || {}, nm = m.module_name || m.station_name;
        if (v.Temperature != null) out.push({ id: 'st|' + m._id + '|t', name: 'Température ' + nm, kind: 'temp', info: 'Station Netatmo', state: { val: v.Temperature, unit: '°C' } });
        if (v.Humidity != null) out.push({ id: 'st|' + m._id + '|h', name: 'Humidité ' + nm, kind: 'hum', info: 'Station Netatmo', state: { val: v.Humidity, unit: '%' } });
        if (v.CO2 != null) out.push({ id: 'st|' + m._id + '|c', name: 'CO₂ ' + nm, kind: 'co2', info: 'Station Netatmo', state: { val: v.CO2, unit: 'ppm' } }); }));
    } catch (e) { }
    return out;
  },
  async command(c, id, p, cur, h) {
    const [home, type, mid] = id.split('|'), H = await h.auth();
    if (type === 'room') {
      if (p.on === false) return request(API + '/api/setroomthermpoint', { headers: H, form: { home_id: home, room_id: mid, mode: 'off' } });
      if ('temp' in p || p.on === true) return request(API + '/api/setroomthermpoint', { headers: H, form: Object.assign({ home_id: home, room_id: mid }, 'temp' in p ? { mode: 'manual', temp: p.temp, endtime: Math.floor(Date.now() / 1000) + 3 * 3600 } : { mode: 'home' }) });
      if (p.hvac === 'Auto') return request(API + '/api/setroomthermpoint', { headers: H, form: { home_id: home, room_id: mid, mode: 'home' } });
    }
    if (type === 'mod') {
      const m = { id: mid }; if ('on' in p) m.on = !!p.on; if ('bri' in p) m.brightness = Math.round(p.bri); if ('pos' in p) m.target_position = Math.round(p.pos); if (p.moving === 'stop') m.target_position = -1;
      return request(API + '/api/setstate', { headers: H, body: { home: { id: home, modules: [m] } } });
    }
  }
};

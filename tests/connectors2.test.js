// Connecteurs 7.19 : chaque marque testée contre un faux appareil qui répond comme le vrai (HTTP, eISCP, NUT, IPP)
'use strict';
const test = require('node:test'), assert = require('node:assert'), path = require('path'), net = require('net');
const { listen } = require('./helpers');
const R = path.join(__dirname, '..', 'server', 'hub') + '/';
// faux appareil HTTP : renvoie la réponse de la route et note les appels
async function fake(routes) {
  const calls = [];
  const { server, port } = await listen((q, r) => { let b = ''; q.on('data', c => b += c); q.on('end', () => {
    calls.push({ m: q.method, u: q.url, b, h: q.headers });
    const k = Object.keys(routes).find(x => q.url.startsWith(x.replace(/^\w+ /, '')) && (!/^\w+ /.test(x) || x.startsWith(q.method + ' ')));
    if (!k) { r.writeHead(404); return r.end('{}'); }
    const v = typeof routes[k] === 'function' ? routes[k](q, b) : routes[k];
    if (v && v.__code) { r.writeHead(v.__code); return r.end(''); }
    r.setHeader('Content-Type', Buffer.isBuffer(v) ? 'application/ipp' : 'application/json'); r.end(Buffer.isBuffer(v) ? v : typeof v === 'string' ? v : JSON.stringify(v));
  }); });
  return { calls, host: '127.0.0.1:' + port, close: () => server.close() };
}

test('Sonoff (mode DIY) : état, commande, ancien firmware qui répond en texte', async () => {
  let sw = 'off';
  const f = await fake({ '/zeroconf/info': () => ({ error: 0, data: JSON.stringify({ switch: sw, fwVersion: '3.5.0', deviceid: '1000abcd' }) }), '/zeroconf/switch': (q, b) => { sw = JSON.parse(b).data.switch; return { error: 0, data: {} }; } });
  const S = require(R + 'sonoff'), c = { hosts: f.host };
  assert.match(await S.test(c), /1 module/);
  assert.strictEqual((await S.devices(c))[0].state.on, false);
  await S.command(c, f.host, { on: true }); assert.strictEqual(sw, 'on');
  assert.strictEqual((await S.devices(c))[0].name, 'Sonoff abcd');
  f.close();
});

test('myStrom : prise (consommation, température) et ampoule', async () => {
  const p = await fake({ '/report': { power: 12.4, relay: true, temperature: 21.36 }, '/relay': {} });
  const M = require(R + 'mystrom'), d = await M.devices({ hosts: p.host });
  assert.deepStrictEqual(d.map(x => x.kind), ['plug', 'meter', 'temp']);
  assert.strictEqual(d[1].state.val, 12); assert.strictEqual(d[2].state.val, 21.4);
  await M.command({}, p.host, { on: false }); assert.ok(p.calls.some(x => x.u === '/relay?state=0'));
  p.close();
  const b = await fake({ '/report': { __code: 404 }, 'GET /api/v1/device': { AABBCC: { on: true, color: '0;0;40', mode: 'hsv' } }, 'POST /api/v1/device/AABBCC': {} });
  const d2 = await M.devices({ hosts: b.host }); assert.strictEqual(d2[0].kind, 'light'); assert.strictEqual(d2[0].state.bri, 40);
  await M.command({}, d2[0].id, { bri: 75 }); assert.match(b.calls.find(x => x.m === 'POST').b, /color=0%3B0%3B75/);
  b.close();
});

test('Twinkly : connexion locale (défi / vérification), marche, intensité, couleur', async () => {
  let mode = 'off', bri = 100, verified = false;
  const f = await fake({
    '/xled/v1/gestalt': { device_name: 'Sapin', product_name: 'Twinkly Strings', number_of_led: 250 },
    '/xled/v1/login': () => ({ authentication_token: 'T0K', 'challenge-response': 'abc', authentication_token_expires_in: 14400 }),
    '/xled/v1/verify': q => { verified = q.headers['x-auth-token'] === 'T0K'; return { code: 1000 }; },
    '/xled/v1/led/mode': (q, b) => { if (q.headers['x-auth-token'] !== 'T0K') return { __code: 401 }; if (b) mode = JSON.parse(b).mode; return { mode, code: 1000 }; },
    '/xled/v1/led/out/brightness': (q, b) => { if (b) bri = JSON.parse(b).value; return { mode: 'enabled', value: bri }; },
    '/xled/v1/led/color': { red: 255, green: 0, blue: 0 }
  });
  const T = require(R + 'twinkly'), c = { hosts: f.host };
  assert.match(await T.test(c), /250 LED/);
  const d = (await T.devices(c))[0]; assert.ok(verified); assert.strictEqual(d.state.on, false); assert.strictEqual(d.state.color, '#ff0000');
  await T.command(c, f.host, { on: true }, d.state); assert.strictEqual(mode, 'movie');
  await T.command(c, f.host, { bri: 30 }, d.state); assert.strictEqual(bri, 30);
  f.close();
});

test('Homey et Hubitat : lumière, volet, thermostat, capteurs', () => {
  const H = require(R + 'homey')._map;
  const l = H({ id: 'a', name: 'Salon', class: 'light', capabilitiesObj: { onoff: { value: true }, dim: { value: .5 }, measure_power: { value: 7.6 } } }, 'Salon');
  assert.deepStrictEqual(l.map(x => [x.kind, x.state.on !== undefined ? x.state.on : x.state.val]), [['light', true], ['meter', 8]]); assert.strictEqual(l[0].state.bri, 50);
  assert.strictEqual(H({ id: 'b', name: 'Volet', class: 'windowcoverings', capabilitiesObj: { windowcoverings_set: { value: .3 } } }, '')[0].state.pos, 30);
  const th = H({ id: 'c', name: 'Thermostat', class: 'thermostat', capabilitiesObj: { target_temperature: { value: 20 }, measure_temperature: { value: 19.2 }, measure_humidity: { value: 51 } } }, '');
  assert.deepStrictEqual(th.map(x => x.kind), ['clim', 'hum']); assert.strictEqual(th[0].state.cur, 19.2);
  const U = require(R + 'hubitat')._map;
  const s = U({ id: 5, label: 'Capteur entrée', type: 'Aqara', capabilities: ['ContactSensor', 'TemperatureMeasurement'], attributes: [{ name: 'contact', currentValue: 'open' }, { name: 'temperature', currentValue: '18.5' }] });
  assert.deepStrictEqual(s.map(x => [x.kind, x.state.on !== undefined ? x.state.on : x.state.val]), [['temp', 18.5], ['door', true]]);
  assert.strictEqual(U({ id: 6, label: 'Plafonnier', capabilities: ['Switch', 'SwitchLevel'], attributes: { switch: 'on', level: 80 } })[0].kind, 'light');
});

test('Jeedom : équipements par types génériques, commande par identifiant', async () => {
  const full = [{ name: 'Salon', eqLogics: [
    { id: 10, name: 'Plafonnier', isEnable: '1', eqType_name: 'zwavejs', cmds: [{ id: 101, generic_type: 'LIGHT_STATE', state: '66' }, { id: 102, generic_type: 'LIGHT_ON' }, { id: 103, generic_type: 'LIGHT_OFF' }, { id: 104, generic_type: 'LIGHT_SLIDER', configuration: { maxValue: 99 } }] },
    { id: 11, name: 'Fenêtre', isEnable: '1', cmds: [{ id: 111, generic_type: 'OPENING', state: '0' }, { id: 112, generic_type: 'TEMPERATURE', state: '19.5' }] },
    { id: 12, name: 'Volet', isEnable: '1', cmds: [{ id: 121, generic_type: 'FLAP_STATE', state: 40 }, { id: 122, generic_type: 'FLAP_UP' }, { id: 123, generic_type: 'FLAP_DOWN' }, { id: 124, generic_type: 'FLAP_STOP' }] }] }];
  const f = await fake({ '/core/api/jeeApi.php': q => /type=fullData/.test(q.url) ? full : { ok: 1 } });
  const J = require(R + 'jeedom'), c = { host: f.host, apikey: 'k' }, d = await J.devices(c);
  assert.deepStrictEqual(d.map(x => x.kind), ['light', 'temp', 'door', 'cover']);
  assert.strictEqual(d[0].state.bri, 67); assert.strictEqual(d[2].state.on, true); assert.strictEqual(d[3].state.pos, 40);
  await J.command(c, '10', { bri: 50 }); assert.match(f.calls.pop().u, /type=cmd&id=104&slider=50/);
  await J.command(c, '12', { pos: 0 }); assert.match(f.calls.pop().u, /id=123/);
  await J.command(c, '12', { moving: 'stop' }); assert.match(f.calls.pop().u, /id=124/);
  f.close();
});

test('eedomus et Domoticz : reconnaissance des appareils et commandes', async () => {
  const E = require(R + 'eedomus')._kind;
  assert.deepStrictEqual(['Lampe', 'Volet roulant', 'Température', 'Prise', 'Détecteur de mouvement', 'Ouverture de porte', 'Inconnu'].map(E), ['light', 'cover', 'temp', 'plug', 'motion', 'door', '']);
  const f = await fake({ '/json.htm': q => /getdevices/.test(q.url) ? { status: 'OK', result: [{ idx: '3', Name: 'Lampe salon', Type: 'Light/Switch', SwitchType: 'Dimmer', Status: 'Set Level: 40 %', Level: 40 }, { idx: '4', Name: 'Volet', Type: 'Light/Switch', SwitchType: 'Blinds Percentage', Status: 'Open', Level: 70 }, { idx: '5', Name: 'Cave', Type: 'Temp + Humidity', Temp: 14.2, Humidity: 70 }] } : { status: 'OK' } });
  const D = require(R + 'domoticz'), c = { host: f.host }, d = await D.devices(c);
  assert.deepStrictEqual(d.map(x => x.kind), ['light', 'cover', 'temp', 'hum']); assert.strictEqual(d[0].state.bri, 40); assert.strictEqual(d[1].state.pos, 70);
  await D.command(c, '3', { bri: 80 }); assert.match(decodeURIComponent(f.calls.pop().u), /switchcmd=Set\+Level&level=80/);
  await D.command(c, '4', { pos: 0 }); assert.match(f.calls.pop().u, /switchcmd=Close/);
  f.close();
});

test('Fibaro : types Z-Wave et action Home Center 3', async () => {
  const F = require(R + 'fibaro')._map;
  assert.deepStrictEqual([{ type: 'com.fibaro.FGD212', properties: { value: 55 } }, { type: 'com.fibaro.FGRM222', properties: { value: 99 } }, { type: 'com.fibaro.doorSensor', properties: { value: true } }, { type: 'com.fibaro.temperatureSensor', properties: { value: 21.5 } }].map(d => F(Object.assign({ id: 1, name: 'x' }, d), '')[0].kind), ['light', 'cover', 'door', 'temp']);
  const f = await fake({ 'POST /api/devices/7/action/setValue': {} });
  await require(R + 'fibaro').command({ host: f.host, password: 'p' }, '7', { bri: 120 });
  assert.deepStrictEqual(JSON.parse(f.calls[0].b), { args: [99] }); assert.match(f.calls[0].h.authorization, /^Basic /);
  f.close();
});

test('Heatzy : modes des boîtiers récents et des anciens « Pilote v1 »', () => {
  const m = require(R + 'heatzy')._modeOf;
  assert.deepStrictEqual([{ mode: 'cft' }, { mode: 'eco' }, { mode: 'fro' }, { mode: 'stop' }, { mode: '舒适' }, { mode: '解冻' }].map(m), ['Confort', 'Éco', 'Hors-gel', 'Arrêt', 'Confort', 'Hors-gel']);
});

test('Airzone, Kodi, Lyrion, Volumio, WeatherLink : faux appareils', async () => {
  const az = await fake({ 'POST /api/v1/hvac': { systems: [{ data: [{ systemID: 1, zoneID: 2, name: 'Chambre', on: 1, roomTemp: 22.4, setpoint: 21, mode: 3 }] }] }, 'PUT /api/v1/hvac': {} });
  const A = require(R + 'airzone'), ad = await A.devices({ host: az.host });
  assert.strictEqual(ad[0].state.hvac, 'Chaud'); await A.command({ host: az.host }, '1:2', { temp: 20 }); assert.deepStrictEqual(JSON.parse(az.calls.pop().b), { systemID: 1, zoneID: 2, setpoint: 20 }); az.close();
  const kd = await fake({ '/jsonrpc': (q, b) => { const r = JSON.parse(b); return { result: { 'Player.GetActivePlayers': [{ playerid: 1 }], 'Application.GetProperties': { volume: 60, muted: false, name: 'Kodi', version: { major: 21 } }, 'Player.GetItem': { item: { title: 'Dune', showtitle: '' } }, 'Player.GetProperties': { speed: 1 } }[r.method] || 'OK' }; } });
  const K = require(R + 'kodi'), kdev = (await K.devices({ hosts: kd.host }))[0];
  assert.strictEqual(kdev.state.title, 'Dune'); assert.ok(kdev.state.playing); await K.command({}, kd.host, { cmd: 'media_play_pause' }); assert.match(kd.calls.pop().b, /Player.PlayPause/); kd.close();
  const lm = await fake({ '/jsonrpc.js': (q, b) => { const p = JSON.parse(b).params; return p[1][0] === 'players' ? { result: { players_loop: [{ playerid: 'aa:bb', name: 'Cuisine', power: 1 }] } } : { result: { mode: 'play', power: 1, 'mixer volume': 35, playlist_loop: [{ title: 'Song', artist: 'Band' }] } }; } });
  const L = require(R + 'lms'), ld = (await L.devices({ host: lm.host }))[0];
  assert.strictEqual(ld.state.title, 'Band — Song'); assert.strictEqual(ld.state.vol, 35); lm.close();
  const vo = await fake({ '/api/v1/getState': { status: 'pause', title: 'Morceau', artist: 'Artiste', volume: 40 }, '/api/v1/commands/': {} });
  const V = require(R + 'volumio'); assert.strictEqual((await V.devices({ hosts: vo.host }))[0].state.playing, false);
  await V.command({}, vo.host, { cmd: 'media_next_track' }); assert.match(vo.calls.pop().u, /cmd=next/); vo.close();
  const wl = await fake({ '/v1/current_conditions': { data: { conditions: [{ data_structure_type: 1, temp: 50, hum: 80, wind_speed_last: 10, rainfall_daily: 12, rain_size: 2 }, { data_structure_type: 4, temp_in: 68, hum_in: 45 }] } } });
  const w = await require(R + 'weatherlink').devices({ host: wl.host });
  assert.deepStrictEqual(w.map(x => x.state.val), [10, 80, 16, 2.4, 20, 45]); wl.close();
});

test('Onkyo (eISCP) et onduleur NUT : faux serveurs TCP', async () => {
  const P = require(R + 'onkyo')._pkt, rx = [];
  const amp = net.createServer(s => s.on('data', d => d.toString('latin1').split('ISCP').filter(Boolean).forEach(x => { const m = x.slice(12).replace(/^!1|\r$/g, ''); rx.push(m); if (m === 'PWRQSTN') s.write(P('PWR01')); if (m === 'MVLQSTN') s.write(P('MVL28')); if (m === 'SLIQSTN') s.write(P('SLI2B')); }))).listen(0, '127.0.0.1');
  await new Promise(r => amp.on('listening', r));
  const O = require(R + 'onkyo');
  // le connecteur parle au port 60128 : on le redirige vers le faux ampli
  const orig = net.connect; net.connect = o => orig({ host: o.host, port: o.port === 60128 ? amp.address().port : o.port });
  try {
    const d = (await O.devices({ hosts: '127.0.0.1' }))[0];
    assert.deepStrictEqual(d.state, { on: true, vol: 40, src: 'Réseau' });
    await O.command({}, '127.0.0.1', { vol: 30 }).catch(() => { }); assert.ok(rx.includes('MVL1E'));
  } finally { net.connect = orig; amp.close(); }
  const ups = net.createServer(s => s.on('data', d => { const t = d.toString(); if (/LIST UPS/.test(t)) s.write('BEGIN LIST UPS\nUPS eaton "Eaton 5E"\nEND LIST UPS\n'); if (/LIST VAR/.test(t)) s.write('BEGIN LIST VAR eaton\nVAR eaton battery.charge "87"\nVAR eaton battery.runtime "1260"\nVAR eaton ups.load "23"\nVAR eaton ups.status "OB DISCHRG"\nEND LIST VAR eaton\n'); })).listen(0, '127.0.0.1');
  await new Promise(r => ups.on('listening', r));
  const n = await require(R + 'nut').devices({ host: '127.0.0.1:' + ups.address().port });
  assert.deepStrictEqual(n.map(x => [x.kind, x.state.on !== undefined ? x.state.on : x.state.val]), [['door', true], ['meter', 87], ['meter', 21], ['meter', 23]]);
  assert.match(n[0].info, /sur batterie/); ups.close();
});

test('Imprimante IPP : niveaux d’encre (requête et réponse IPP encodées)', async () => {
  const I = require(R + 'ipp');
  const reqBuf = I._body('ipp://x/ipp/print'); assert.strictEqual(reqBuf.readUInt16BE(2), 0x0b);
  // réponse : succès, deux cartouches
  const parts = [Buffer.from([2, 0, 0, 0, 0, 0, 0, 1, 0x04])];
  const a = (tag, name, val) => { const n = Buffer.from(name), v = Buffer.isBuffer(val) ? val : Buffer.from(val), b = Buffer.alloc(5 + n.length + v.length); b[0] = tag; b.writeUInt16BE(n.length, 1); n.copy(b, 3); b.writeUInt16BE(v.length, 3 + n.length); v.copy(b, 5 + n.length); parts.push(b); };
  const int = x => { const b = Buffer.alloc(4); b.writeInt32BE(x); return b; };
  a(0x41, 'printer-make-and-model', 'HP OfficeJet'); a(0x21, 'marker-levels', int(64)); a(0x21, '', int(12)); a(0x41, 'marker-names', 'Noir'); a(0x41, '', 'Couleur'); a(0x23, 'printer-state', int(3)); parts.push(Buffer.from([3]));
  const f = await fake({ '/ipp/print': Buffer.concat(parts) });
  const port = f.host.split(':')[1], d = await I.devices({ hosts: '127.0.0.1:' + port });
  assert.deepStrictEqual(d.map(x => [x.name, x.state.val]), [['HP OfficeJet — Noir', 64], ['HP OfficeJet — Couleur', 12]]);
  assert.match(d[0].info, /prête/); f.close();
});

test('Adresse web (HTTP) : description par lignes, état JSON ou texte, commandes', async () => {
  let relay = false;
  const f = await fake({ '/state': () => ({ status: { relay } }), '/on': () => { relay = true; return 'ok'; }, '/off': () => { relay = false; return 'ok'; }, '/cuve': 'Niveau : 73 %' });
  const H = require(R + 'http'), u = 'http://' + f.host, c = { devices: 'Pompe | prise | ' + u + '/on | ' + u + '/off | ' + u + '/state | status.relay\nCuve | capteur | | | ' + u + '/cuve | /(\\d+) %/ | %' };
  assert.match(await H.test(c), /2 appareil/);
  let d = await H.devices(c); assert.strictEqual(d[0].state.on, false); assert.deepStrictEqual(d[1].state, { val: 73, unit: '%' });
  await H.command(c, d[0].id, { on: true }); d = await H.devices(c); assert.strictEqual(d[0].state.on, true);
  await assert.rejects(H.test({ devices: 'Sans URL | prise' }), /il manque/);
  f.close();
});

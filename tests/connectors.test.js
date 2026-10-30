// Connecteurs : TP-Link Deco (protocole chiffré, faux Deco), Home Assistant (faux serveur), Bbox (réponses simulées)
'use strict';
const test = require('node:test'), assert = require('node:assert'), crypto = require('crypto'), path = require('path');
const { listen } = require('./helpers');
const R = path.join(__dirname, '..', 'server', 'hub') + '/';

test('TP-Link Deco : connexion chiffrée, bornes, clients, présence, mauvais mot de passe', async () => {
  const mk = () => { const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 }); const j = publicKey.export({ format: 'jwk' }), hex = b => Buffer.from(b, 'base64url').toString('hex'); return { priv: privateKey, n: hex(j.n), e: hex(j.e), size: 128 }; };
  const PW = mk(), SG = mk(), SEQ = 77;
  const dec = (k, hex) => { const b = Buffer.from(hex, 'hex'), o = []; for (let i = 0; i < b.length; i += k.size) o.push(crypto.privateDecrypt({ key: k.priv, padding: crypto.constants.RSA_PKCS1_PADDING }, b.subarray(i, i + k.size))); return Buffer.concat(o).toString(); };
  const aes = (k, iv, t, d) => { const c = (d ? crypto.createDecipheriv : crypto.createCipheriv)('aes-128-cbc', Buffer.from(k), Buffer.from(iv)); return d ? Buffer.concat([c.update(Buffer.from(t, 'base64')), c.final()]).toString() : Buffer.concat([c.update(t), c.final()]).toString('base64'); };
  const b64 = s => Buffer.from(s).toString('base64');
  const { server, port } = await listen((q, r) => { let b = ''; q.on('data', c => b += c); q.on('end', () => {
    const out = o => r.end(JSON.stringify(o));
    if (/form=keys/.test(q.url)) return out({ error_code: 0, result: { password: [PW.n, PW.e] } });
    if (/form=auth/.test(q.url)) return out({ error_code: 0, result: { key: [SG.n, SG.e], seq: SEQ } });
    const f = new URLSearchParams(b), sig = Object.fromEntries(new URLSearchParams(dec(SG, f.get('sign'))));
    if (+sig.s !== SEQ + f.get('data').length) { r.writeHead(403); return r.end(); }
    const qq = JSON.parse(aes(sig.k, sig.i, f.get('data'), true)), reply = o => out({ data: aes(sig.k, sig.i, JSON.stringify(o)) });
    if (/form=login/.test(q.url)) { if (dec(PW, qq.params.password) !== 'secret') return reply({ error_code: -5002 }); r.setHeader('Set-Cookie', 'sysauth=abc'); return reply({ error_code: 0, result: { stok: 'tok' } }); }
    if (!q.url.includes(';stok=tok/')) { r.writeHead(401); return r.end(); }
    if (/device_list/.test(q.url)) return reply({ error_code: 0, result: { device_list: [{ nickname: b64('Salon'), device_model: 'X50', device_ip: '192.168.68.1', mac: 'AA', role: 'master', inet_status: 'online' }] } });
    if (/client_list/.test(q.url)) return reply({ error_code: 0, result: { client_list: [{ name: b64('iPhone de Bastien'), mac: '11-22', ip: '192.168.68.20', online: true, connection_type: 'band5' }] } });
    reply({ error_code: 0, result: {} });
  }); });
  const D = require(R + 'deco'), c = { host: '127.0.0.1:' + port, password: 'secret', presence: 'iPhone de Bastien' };
  assert.match(await D.test(c), /1 borne\(s\), 1 appareil/);
  assert.deepStrictEqual((await D.devices(c))[0].state, { on: true });
  const i = await D.info(c); assert.strictEqual(i.nodes[0].name, 'Salon'); assert.strictEqual(i.clients[0].band, '5 GHz');
  await assert.rejects(D.test({ host: c.host, password: 'faux' }), /mot de passe refusé/);
  server.close();
});

test('Home Assistant : entités → appareils, commandes → services', async () => {
  const calls = [];
  const ST = [{ entity_id: 'light.salon', state: 'on', attributes: { friendly_name: 'Lampe', brightness: 128, supported_color_modes: ['color_temp'] } }, { entity_id: 'cover.volet', state: 'open', attributes: { current_position: 60 } }, { entity_id: 'sensor.conso', state: '1.2', attributes: { device_class: 'power', unit_of_measurement: 'kW' } }];
  const { server, url } = await listen((q, r) => { let b = ''; q.on('data', c => b += c); q.on('end', () => { if (q.headers.authorization !== 'Bearer t') { r.writeHead(401); return r.end('{}'); } if (q.url === '/api/states') return r.end(JSON.stringify(ST)); if (q.url === '/api/config') return r.end('{"version":"x"}'); calls.push(q.url + ' ' + b); r.end('[]'); }); });
  const H = require(R + 'homeassistant'), c = { url, token: 't' };
  const d = await H.devices(c);
  assert.deepStrictEqual(d.map(x => x.kind), ['light', 'cover', 'power']);
  assert.strictEqual(d[2].state.w, 1200);
  await H.command(c, 'light.salon', { on: true, bri: 40, ct: 2700 }); await H.command(c, 'cover.volet', { pos: 0 });
  assert.match(calls[0], /light\/turn_on .*"brightness_pct":40.*"color_temp_kelvin":2700/); assert.match(calls[1], /cover\/close_cover/);
  server.close();
});

test('Bbox : ligne, débits, appareils (réponses simulées)', async () => {
  const net = require(R + 'net'), r0 = net.request;
  const Rr = { '/device': [{ device: { modelname: 'Bbox Ultym', main: { version: '23.4' }, uptime: 100 } }], '/wan/ip': [{ wan: { internet: { state: 2 }, ip: { address: '92.1.2.3', state: 'Up' }, link: { type: 'FTTH' } } }], '/wan/ip/stats': [{ wan: { ip: { stats: { rx: { bandwidth: 120000, maxBandwidth: 2000000 }, tx: { bandwidth: 20000 } } } } }], '/wan/ftth': [{ wan: { ftth: { state: 'up' } } }], '/hosts': [{ hosts: { list: [{ hostname: 'NAS', ipaddress: '1', macaddress: 'AA', active: 1, link: 'Ethernet' }, { hostname: 'iPhone', ipaddress: '2', macaddress: 'BB', active: 1, link: 'Wifi 5' }] } }], '/wireless': [{ wireless: { radio: { 24: { enable: 1 } }, ssid: { 24: { id: 'Bbox-1' } } } }] };
  net.request = async u => { const j = Rr[u.replace(/^.*\/api\/v1/, '').split('?')[0]]; return { status: j ? 200 : 404, headers: {}, text: '', json: () => j }; };
  delete require.cache[require.resolve(R + 'bbox')];
  const B = require(R + 'bbox'), i = await B.info({ host: 'x' });
  net.request = r0;
  assert.strictEqual(i.box.wan.type, 'Fibre'); assert.strictEqual(i.box.wan.down, 120); assert.strictEqual(i.box.wan.maxDown, 2000);
  assert.deepStrictEqual(i.clients.map(c => c.link + ':' + c.band), ['ethernet:', 'wifi:5 GHz']);
});

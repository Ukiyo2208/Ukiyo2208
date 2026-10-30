// Serveur Bêta — découverte du réseau local : caméras (ONVIF, RTSP), appareils Bonjour/mDNS
// (HomeKit, Matter, Hue, Elgato, Shelly, Chromecast, AirPlay, Sonos…) et UPnP/SSDP (TV, box, NAS…).
// Rien ne sort du réseau local. Aucune dépendance : uniquement les modules de Node.js.
'use strict';
const dgram = require('dgram'), net = require('net'), os = require('os'), http = require('http'), crypto = require('crypto');

/* ---------- mDNS / Bonjour ---------- */
const SERVICES = ['_hap._tcp', '_matter._tcp', '_matterc._udp', '_hue._tcp', '_elg._tcp', '_shelly._tcp', '_googlecast._tcp', '_airplay._tcp', '_raop._tcp', '_sonos._tcp',
  '_spotify-connect._tcp', '_home-assistant._tcp', '_esphomelib._tcp', '_kizboxdev._tcp', '_rtsp._tcp', '_axis-video._tcp', '_ipp._tcp', '_printer._tcp', '_smb._tcp', '_amzn-wplay._tcp', '_wled._tcp', '_nanoleafapi._tcp', '_mqtt._tcp', '_heos-audio._tcp', '_http._tcp'];
function dnsName(name) { return Buffer.concat(name.split('.').filter(Boolean).map(l => { const b = Buffer.from(l); return Buffer.concat([Buffer.from([b.length]), b]); }).concat([Buffer.from([0])])); }
function dnsQuery(names) {
  const h = Buffer.alloc(12); h.writeUInt16BE(names.length, 4);
  return Buffer.concat([h].concat(names.map(n => Buffer.concat([dnsName(n + '.local'), Buffer.from([0, 12, 0, 1])]))));   // PTR, IN
}
function readName(buf, off) {
  const parts = []; let jumped = false, end = off, guard = 0;
  while (guard++ < 64) {
    const len = buf[off]; if (len === undefined) break;
    if (len === 0) { if (!jumped) end = off + 1; break; }
    if ((len & 0xc0) === 0xc0) { if (!jumped) end = off + 2; off = ((len & 0x3f) << 8) | buf[off + 1]; jumped = true; continue; }
    parts.push(buf.toString('utf8', off + 1, off + 1 + len)); off += len + 1;
  }
  return [parts.join('.'), end];
}
// lit une réponse DNS : enregistrements PTR, SRV, TXT, A
function parseDNS(buf) {
  const out = []; if (buf.length < 12) return out;
  const qd = buf.readUInt16BE(4), an = buf.readUInt16BE(6) + buf.readUInt16BE(8) + buf.readUInt16BE(10);
  let off = 12;
  for (let i = 0; i < qd; i++) { off = readName(buf, off)[1] + 4; }
  for (let i = 0; i < an && off < buf.length; i++) {
    const [name, o1] = readName(buf, off); off = o1;
    const type = buf.readUInt16BE(off), rdlen = buf.readUInt16BE(off + 8), rd = off + 10; off = rd + rdlen;
    const r = { name, type };
    if (type === 12) r.ptr = readName(buf, rd)[0];
    else if (type === 33) { r.port = buf.readUInt16BE(rd + 4); r.target = readName(buf, rd + 6)[0]; }
    else if (type === 16) { r.txt = {}; let p = rd; while (p < rd + rdlen) { const l = buf[p]; const s = buf.toString('utf8', p + 1, p + 1 + l); const i = s.indexOf('='); if (i > 0) r.txt[s.slice(0, i).toLowerCase()] = s.slice(i + 1); p += l + 1; } }
    else if (type === 1 && rdlen === 4) r.a = [buf[rd], buf[rd + 1], buf[rd + 2], buf[rd + 3]].join('.');
    out.push(r);
  }
  return out;
}
function mdns(ms) {
  return new Promise(done => {
    const recs = [], from = {};
    let sock; try { sock = dgram.createSocket({ type: 'udp4', reuseAddr: true }); } catch (e) { return done([]); }
    sock.on('error', () => { try { sock.close(); } catch (e) { } done([]); });
    sock.on('message', (m, rinfo) => { try { parseDNS(m).forEach(r => { r.from = rinfo.address; recs.push(r); }); } catch (e) { } });
    sock.bind(0, () => {
      try { sock.setMulticastTTL(255); } catch (e) { }
      const q = dnsQuery(SERVICES); sock.send(q, 5353, '224.0.0.251'); setTimeout(() => { try { sock.send(q, 5353, '224.0.0.251'); } catch (e) { } }, 700);
    });
    setTimeout(() => {
      try { sock.close(); } catch (e) { }
      // regroupe par instance de service : nom, adresse, port, TXT
      const inst = {};
      recs.filter(r => r.type === 12 && r.ptr && /\._(tcp|udp)\.local$/.test(r.name)).forEach(r => { inst[r.ptr] = inst[r.ptr] || { svc: r.name.replace(/\.local$/, ''), name: r.ptr.split('._')[0], ip: r.from }; });
      recs.forEach(r => { const i = inst[r.name]; if (!i) return; if (r.type === 33) { i.port = r.port; i.host = r.target; } if (r.type === 16) i.txt = Object.assign(i.txt || {}, r.txt); });
      const hostIp = {}; recs.filter(r => r.type === 1).forEach(r => { hostIp[r.name] = r.a; });
      done(Object.values(inst).map(i => Object.assign(i, { ip: (i.host && hostIp[i.host]) || i.ip })));
      void from;
    }, ms);
  });
}

/* ---------- ONVIF (WS-Discovery) : presque toutes les caméras IP ---------- */
function onvifProbe(ms) {
  return new Promise(done => {
    const found = {};
    let sock; try { sock = dgram.createSocket({ type: 'udp4', reuseAddr: true }); } catch (e) { return done([]); }
    const id = 'uuid:' + crypto.randomUUID();
    const msg = '<?xml version="1.0" encoding="UTF-8"?><e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope" xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing" xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery" xmlns:dn="http://www.onvif.org/ver10/network/wsdl"><e:Header><w:MessageID>' + id + '</w:MessageID><w:To e:mustUnderstand="true">urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To><w:Action e:mustUnderstand="true">http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action></e:Header><e:Body><d:Probe><d:Types>dn:NetworkVideoTransmitter</d:Types></d:Probe></e:Body></e:Envelope>';
    sock.on('error', () => { try { sock.close(); } catch (e) { } done(Object.values(found)); });
    sock.on('message', (m, rinfo) => { const c = parseOnvif(m.toString()); if (c) found[rinfo.address] = Object.assign({ ip: rinfo.address }, c); });
    sock.bind(0, () => { const b = Buffer.from(msg); sock.send(b, 3702, '239.255.255.250'); setTimeout(() => { try { sock.send(b, 3702, '239.255.255.250'); } catch (e) { } }, 600); });
    setTimeout(() => { try { sock.close(); } catch (e) { } done(Object.values(found)); }, ms);
  });
}
function parseOnvif(xml) {
  if (!/ProbeMatch/i.test(xml)) return null;
  const x = (xml.match(/XAddrs>([^<]+)</) || [])[1] || '', scopes = decodeURIComponent((xml.match(/Scopes>([^<]+)</) || [])[1] || '');
  const sc = k => ((scopes.match(new RegExp('onvif://www\\.onvif\\.org/' + k + '/([^\\s]+)')) || [])[1] || '').replace(/_/g, ' ');
  return { xaddr: x.trim().split(/\s+/)[0], name: sc('name'), model: sc('hardware'), where: sc('location/city') || sc('location') };
}

/* ---------- UPnP / SSDP ---------- */
function ssdp(ms) {
  return new Promise(done => {
    const found = {};
    let sock; try { sock = dgram.createSocket({ type: 'udp4', reuseAddr: true }); } catch (e) { return done([]); }
    sock.on('error', () => { try { sock.close(); } catch (e) { } done(Object.values(found)); });
    sock.on('message', (m, rinfo) => { const h = parseSSDP(m.toString()); if (h.location && !found[h.location]) found[h.location] = Object.assign({ ip: rinfo.address }, h); });
    sock.bind(0, () => { const q = Buffer.from('M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ssdp:all\r\n\r\n'); sock.send(q, 1900, '239.255.255.250'); });
    setTimeout(async () => {
      try { sock.close(); } catch (e) { }
      const list = Object.values(found).slice(0, 40);
      await Promise.all(list.map(async d => { try { const xml = await get(d.location, 1500); const t = k => ((xml.match(new RegExp('<' + k + '>([^<]*)</' + k + '>')) || [])[1] || '').trim(); Object.assign(d, { name: t('friendlyName'), maker: t('manufacturer'), model: t('modelName'), dtype: t('deviceType') }); } catch (e) { } }));
      done(list);
    }, ms);
  });
}
function parseSSDP(s) { const h = {}; s.split(/\r?\n/).forEach(l => { const i = l.indexOf(':'); if (i > 0) h[l.slice(0, i).trim().toLowerCase()] = l.slice(i + 1).trim(); }); return { location: h.location, server: h.server, st: h.st }; }
function get(url, ms) { return new Promise((ok, ko) => { const r = http.get(url, { timeout: ms }, res => { let b = ''; res.setEncoding('utf8'); res.on('data', c => { if (b.length < 200000) b += c; }); res.on('end', () => ok(b)); }); r.on('timeout', () => { r.destroy(); ko(new Error('délai')); }); r.on('error', ko); }); }

/* ---------- RTSP : caméras sans ONVIF (port 554 / 8554 ouvert) ---------- */
function subnets() { return Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal && /^(10|172|192)\./.test(i.address)).map(i => i.address.split('.').slice(0, 3).join('.')); }
function portOpen(ip, port, ms) { return new Promise(ok => { const s = net.connect({ host: ip, port }); const end = v => { s.destroy(); ok(v); }; s.setTimeout(ms, () => end(false)); s.on('connect', () => end(true)); s.on('error', () => end(false)); }); }
async function rtspScan(ms) {
  const ips = [...new Set(subnets())].slice(0, 2).flatMap(n => Array.from({ length: 254 }, (_, i) => n + '.' + (i + 1)));
  const out = [], queue = ips.slice();
  const worker = async () => { while (queue.length) { const ip = queue.shift(); for (const port of [554, 8554]) if (await portOpen(ip, port, ms)) { out.push({ ip, port }); break; } } };
  await Promise.all(Array.from({ length: 64 }, worker));
  return out;
}

/* ---------- classement : quoi, quelle marque, comment le relier ---------- */
const KIND = [
  [/_hue\._tcp|philips hue|hue bridge/i, 'hub', 'Philips Hue', 'brand:hue'], [/_elg\._tcp|elgato/i, 'lampe', 'Elgato', 'brand:elgato'], [/_kizboxdev|tahoma|somfy/i, 'hub', 'Somfy TaHoma', 'brand:tahoma'],
  [/_shelly\._tcp|shelly/i, 'prise', 'Shelly', 'brand:shelly'], [/_esphomelib/i, 'module', 'ESPHome', 'brand:esphome'], [/_home-assistant/i, 'hub', 'Home Assistant', ''],
  [/_matterc?\._(tcp|udp)/i, 'matter', 'Matter', 'brand:matter'], [/_hap\._tcp/i, 'homekit', 'HomeKit', 'homekit'],
  [/_sonos|sonos/i, 'multimedia', 'Sonos', 'brand:sonos'], [/_googlecast|chromecast|google home|nest/i, 'multimedia', 'Google Cast', 'brand:cast'], [/_airplay|_raop/i, 'multimedia', 'AirPlay', 'airplay'],
  [/_spotify-connect/i, 'multimedia', 'Spotify Connect', ''], [/_amzn-wplay|amazon|echo/i, 'multimedia', 'Amazon Echo / Fire', 'alexa'],
  [/_wled\._tcp|wled/i, 'lampe', 'WLED', 'brand:wled'], [/_nanoleaf|nanoleaf/i, 'lampe', 'Nanoleaf', 'brand:nanoleaf'], [/_mqtt\._tcp|mosquitto/i, 'hub', 'Broker MQTT', 'brand:z2m'],
  [/_heos-audio|denon|marantz/i, 'multimedia', 'Denon / Marantz', 'brand:denon'], [/roku/i, 'multimedia', 'Roku', 'brand:roku'], [/yeelight/i, 'lampe', 'Yeelight', 'brand:yeelight'], [/daikin/i, 'clim', 'Daikin', 'brand:daikin'],
  [/_ipp|_printer|printer|imprim/i, 'imprimante', 'Imprimante', ''], [/_smb\._tcp|nas|ugreen|synology|qnap/i, 'nas', 'NAS / partage', ''],
  [/samsung.*(tv|tizen)|tizen|\[tv\] samsung/i, 'multimedia', 'TV Samsung', 'brand:samsungtv'], [/webos|lg electronics|\blg tv/i, 'multimedia', 'TV LG', 'brand:lgtv'], [/philips.*(tv|android)|jointspace|_philipstv/i, 'multimedia', 'TV Philips', 'brand:philipstv'],
  [/\bkasa\b|tp-link smart|smartplug|^hs1\d\d|\bkp\d{3}/i, 'prise', 'TP-Link Kasa', 'brand:kasa'], [/tapo/i, 'prise', 'TP-Link Tapo', 'brand:tapo'], [/lifx/i, 'lampe', 'LIFX', 'brand:lifx'], [/broadlink|rm4|rm mini/i, 'telecommande', 'Broadlink', 'brand:broadlink'],
  [/mediarenderer|samsung|lg |webos|bravia|philips tv|tv/i, 'multimedia', 'TV / lecteur', ''], [/internetgatewaydevice|freebox|livebox|bbox|fritz/i, 'box', 'Box internet', '']
];
function classify(d) {
  const s = [d.svc, d.name, d.maker, d.model, d.dtype, d.server, d.txt && JSON.stringify(d.txt)].filter(Boolean).join(' ');
  const k = KIND.find(x => x[0].test(s));
  return k ? { type: k[1], brand: (d.maker && !/^(upnp|linux)/i.test(d.maker)) ? d.maker : k[2], link: k[3] } : { type: 'autre', brand: d.maker || '', link: '' };
}

/* ---------- diffusion UDP : prises Kasa, ampoules LIFX, télécommandes Broadlink (sans mDNS) ---------- */
function udpProbe(ms) {
  return new Promise(ok => {
    const s = dgram.createSocket('udp4'), out = [];
    const kasa = Buffer.from('{"system":{"get_sysinfo":{}}}'), kx = b => { let k = 171; const o = Buffer.alloc(b.length); for (let i = 0; i < b.length; i++) { o[i] = b[i] ^ k; k = o[i]; } return o; };
    const kd = b => { let k = 171; const o = Buffer.alloc(b.length); for (let i = 0; i < b.length; i++) { o[i] = b[i] ^ k; k = b[i]; } return o; };
    const lifx = Buffer.alloc(36); lifx.writeUInt16LE(36, 0); lifx.writeUInt16LE(0x3400, 2); lifx.writeUInt16LE(2, 32);   // GetService
    const bl = Buffer.alloc(0x30); bl[0x26] = 6; { let c = 0xbeaf; for (const x of bl) c = (c + x) & 0xffff; bl.writeUInt16LE(c, 0x20); }
    s.on('message', (m, r) => {
      try {
        if (r.port === 9999) { const j = JSON.parse(kd(m).toString()).system.get_sysinfo; out.push({ ip: r.address, svc: 'kasa', name: j.alias, model: j.model, maker: 'TP-Link Kasa' }); }
        else if (r.port === 56700 && m.readUInt16LE(32) === 3) out.push({ ip: r.address, svc: 'lifx', name: 'Ampoule LIFX', maker: 'LIFX' });
        else if (r.port === 80 && m.length >= 0x40) out.push({ ip: r.address, svc: 'broadlink', name: 'Broadlink ' + m.readUInt16LE(0x34).toString(16), maker: 'Broadlink' });
      } catch (e) { }
    });
    s.on('error', () => ok(out));
    s.bind(() => {
      try { s.setBroadcast(true); } catch (e) { }
      const targets = ['255.255.255.255'].concat(subnets().map(n => n + '.255'));
      targets.forEach(t => { s.send(kx(kasa), 9999, t, () => { }); s.send(lifx, 56700, t, () => { }); s.send(bl, 80, t, () => { }); });
      setTimeout(() => { try { s.close(); } catch (e) { } ok(out); }, ms);
    });
  });
}

async function scan(opts) {
  opts = opts || {};
  const t0 = Date.now();
  const [cams, md, up, rt, ud] = await Promise.all([onvifProbe(3000), mdns(3000), ssdp(3500), opts.rtsp === false ? [] : rtspScan(350), udpProbe(2500)]);
  const dev = {};
  const add = (ip, o) => { const k = ip; dev[k] = Object.assign(dev[k] || { ip, via: [] }, o, { via: [...new Set([...(dev[k] ? dev[k].via : []), o.via])] }); };
  cams.forEach(c => add(c.ip, { via: 'ONVIF', type: 'camera', name: c.name || 'Caméra ' + c.ip, brand: c.model || '', model: c.model, onvif: c.xaddr, link: 'camera' }));
  rt.forEach(r => { if (!dev[r.ip] || dev[r.ip].type !== 'camera') add(r.ip, { via: 'RTSP', type: 'camera', name: (dev[r.ip] && dev[r.ip].name) || 'Caméra ' + r.ip, rtspPort: r.port, link: 'camera' }); });
  md.forEach(m => { if (!m.ip) return; const c = classify(m); const cur = dev[m.ip]; if (cur && cur.type === 'camera') { cur.via = [...new Set(cur.via.concat('mDNS'))]; if (/_hap/.test(m.svc)) cur.homekit = true; return; } add(m.ip, Object.assign({ via: 'mDNS', name: (m.txt && (m.txt.fn || m.txt.friendly_name)) || m.name, svc: (cur && cur.svc ? cur.svc + ', ' : '') + m.svc, port: m.port }, cur && cur.type !== 'autre' && c.type === 'autre' ? {} : c)); });
  up.forEach(u => { const c = classify(u), cur = dev[u.ip]; if (cur && cur.type !== 'autre') { cur.via = [...new Set(cur.via.concat('UPnP'))]; if (!cur.model && u.model) cur.model = u.model; return; } add(u.ip, Object.assign({ via: 'UPnP', name: u.name || u.server || u.ip, model: u.model }, c)); });
  ud.forEach(u => { if (!dev[u.ip] || dev[u.ip].type === 'autre') add(u.ip, Object.assign({ via: 'UDP', name: u.name || u.ip, model: u.model }, classify(u))); });
  const list = Object.values(dev).sort((a, b) => (a.type === 'camera' ? 0 : 1) - (b.type === 'camera' ? 0 : 1) || a.ip.localeCompare(b.ip, undefined, { numeric: true }));
  return { at: Date.now(), took: Date.now() - t0, subnets: subnets(), devices: list };
}

/* ---------- ONVIF : récupérer l'adresse vidéo (RTSP) et l'image d'une caméra ---------- */
function soap(xaddr, body, user, pass) {
  const nonce = crypto.randomBytes(16), created = new Date().toISOString();
  const digest = crypto.createHash('sha1').update(Buffer.concat([nonce, Buffer.from(created), Buffer.from(pass || '')])).digest('base64');
  const sec = user ? '<s:Header><Security s:mustUnderstand="1" xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"><UsernameToken><Username>' + user.replace(/[<&]/g, '') + '</Username><Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">' + digest + '</Password><Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">' + nonce.toString('base64') + '</Nonce><Created xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">' + created + '</Created></UsernameToken></Security></s:Header>' : '';
  const xml = '<?xml version="1.0" encoding="UTF-8"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:trt="http://www.onvif.org/ver10/media/wsdl" xmlns:tt="http://www.onvif.org/ver10/schema">' + sec + '<s:Body>' + body + '</s:Body></s:Envelope>';
  return new Promise((ok, ko) => {
    const u = new URL(xaddr), r = http.request({ host: u.hostname, port: u.port || 80, path: u.pathname, method: 'POST', timeout: 5000, headers: { 'Content-Type': 'application/soap+xml; charset=utf-8', 'Content-Length': Buffer.byteLength(xml) } }, res => { let b = ''; res.setEncoding('utf8'); res.on('data', c => b += c); res.on('end', () => res.statusCode >= 400 ? ko(new Error(/NotAuthorized|Sender/i.test(b) ? 'identifiant ou mot de passe refusé' : 'HTTP ' + res.statusCode)) : ok(b)); });
    r.on('timeout', () => { r.destroy(); ko(new Error('la caméra ne répond pas')); }); r.on('error', ko); r.end(xml);
  });
}
async function onvifStream(o) {
  const xaddr = o.xaddr.replace(/device_service.*/, 'device_service');
  const prof = await soap(xaddr, '<trt:GetProfiles/>', o.user, o.pass);
  const tokens = [...prof.matchAll(/Profiles[^>]*token="([^"]+)"/g)].map(m => m[1]); if (!tokens.length) throw new Error('aucun flux vidéo');
  const res = [];
  for (const t of tokens.slice(0, 3)) {
    const x = await soap(xaddr, '<trt:GetStreamUri><trt:StreamSetup><tt:Stream>RTP-Unicast</tt:Stream><tt:Transport><tt:Protocol>RTSP</tt:Protocol></tt:Transport></trt:StreamSetup><trt:ProfileToken>' + t + '</trt:ProfileToken></trt:GetStreamUri>', o.user, o.pass);
    const uri = (x.match(/Uri>([^<]+)</) || [])[1]; let snap = '';
    try { snap = ((await soap(xaddr, '<trt:GetSnapshotUri><trt:ProfileToken>' + t + '</trt:ProfileToken></trt:GetSnapshotUri>', o.user, o.pass)).match(/Uri>([^<]+)</) || [])[1] || ''; } catch (e) { }
    if (uri) res.push({ profile: t, rtsp: uri.replace(/&amp;/g, '&'), snapshot: snap.replace(/&amp;/g, '&') });
  }
  return res;
}

module.exports = { scan, onvifStream, _test: { udpProbe, parseDNS, dnsQuery, parseOnvif, parseSSDP, classify } };

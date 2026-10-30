// OCPP 1.6J — n'importe quelle borne de recharge compatible (Schneider EVlink / Charge, ABB, Alfen, Keba, Zaptec…)
// se connecte directement au serveur Bêta : ws://IP-du-NAS:9220/<nom-de-la-borne>. Suivi, départ/arrêt, limite de puissance.
'use strict';
const http = require('http'), crypto = require('crypto');
const CP = {};                         // borne → { send, status, w, kwh, tx, model, at }
let srv = null, port = 0;
const pend = {};
function frame(s, txt) { const d = Buffer.from(txt), h = d.length < 126 ? Buffer.from([0x81, d.length]) : d.length < 65536 ? Buffer.from([0x81, 126, d.length >> 8, d.length & 255]) : (() => { const b = Buffer.alloc(10); b[0] = 0x81; b[1] = 127; b.writeBigUInt64BE(BigInt(d.length), 2); return b; })(); s.write(Buffer.concat([h, d])); }
function handle(id, m) {
  const cp = CP[id], [type, mid, a, p] = m;
  if (type === 3 || type === 4) { const w = pend[mid]; if (w) { delete pend[mid]; type === 3 ? w.ok(a) : w.ko(new Error(p || a || 'refusé par la borne')); } return; }
  if (type !== 2) return;
  const now = new Date().toISOString(); let res = {};
  if (a === 'BootNotification') { cp.model = [p.chargePointVendor, p.chargePointModel].filter(Boolean).join(' '); res = { status: 'Accepted', currentTime: now, interval: 300 }; }
  else if (a === 'Heartbeat') res = { currentTime: now };
  else if (a === 'StatusNotification') { if (p.connectorId) cp.status = p.status; }
  else if (a === 'MeterValues' || a === 'StopTransaction' && p.transactionData) {
    (p.meterValue || p.transactionData || []).forEach(mv => (mv.sampledValue || []).forEach(sv => {
      const v = parseFloat(sv.value), k = sv.unit === 'kW' || sv.unit === 'kWh' ? 1000 : 1;
      if ((sv.measurand || 'Energy.Active.Import.Register') === 'Energy.Active.Import.Register') cp.wh = v * k;
      if (sv.measurand === 'Power.Active.Import' && !sv.phase) cp.w = v * k;
    }));
  }
  if (a === 'Authorize') res = { idTagInfo: { status: 'Accepted' } };
  if (a === 'StartTransaction') { cp.tx = Math.floor(Date.now() / 1000) % 1e9; cp.start = p.meterStart || 0; res = { transactionId: cp.tx, idTagInfo: { status: 'Accepted' } }; }
  if (a === 'StopTransaction') { cp.tx = null; cp.w = 0; res = { idTagInfo: { status: 'Accepted' } }; }
  if (a === 'DataTransfer') res = { status: 'Accepted' };
  cp.at = Date.now(); cp.send(JSON.stringify([3, mid, res]));
}
function start(p) {
  if (srv && port === p) return; if (srv) srv.close();
  port = p; srv = http.createServer((q, r) => { r.writeHead(426); r.end('OCPP 1.6J'); });
  srv.on('upgrade', (req, s) => {
    const id = decodeURIComponent(req.url.split('?')[0].split('/').filter(Boolean).pop() || 'borne');
    const acc = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    s.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + acc + '\r\n' + (/ocpp1\.6/.test(req.headers['sec-websocket-protocol'] || '') ? 'Sec-WebSocket-Protocol: ocpp1.6\r\n' : '') + '\r\n');
    const cp = CP[id] = Object.assign(CP[id] || { status: 'Available', w: 0, wh: 0 }, { send: t => frame(s, t), online: true, at: Date.now() });
    let buf = Buffer.alloc(0), frag = [];
    s.on('data', d => {
      buf = Buffer.concat([buf, d]);
      for (;;) {
        if (buf.length < 2) return; let len = buf[1] & 127, off = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; } else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
        const masked = buf[1] & 128, mk = masked ? buf.slice(off, off + 4) : null; if (masked) off += 4; if (buf.length < off + len) return;
        let pl = buf.slice(off, off + len); if (mk) pl = Buffer.from(pl.map((b, i) => b ^ mk[i % 4]));
        const op = buf[0] & 15, fin = buf[0] & 128; buf = buf.slice(off + len);
        if (op === 9) { s.write(Buffer.concat([Buffer.from([0x8a, pl.length]), pl])); continue; }
        if (op === 8) { s.end(); return; }
        if (op <= 2) { frag.push(pl); if (fin) { const t = Buffer.concat(frag).toString(); frag = []; try { handle(id, JSON.parse(t)); } catch (e) { } } }
      }
    });
    s.on('close', () => { cp.online = false; }); s.on('error', () => { cp.online = false; });
  });
  srv.on('error', e => console.warn('OCPP : port ' + p + ' — ' + e.message));
  srv.listen(p);
}
function call(id, action, payload) {
  const cp = CP[id]; if (!cp || !cp.online) return Promise.reject(new Error('borne déconnectée'));
  const mid = crypto.randomBytes(6).toString('hex');
  return new Promise((ok, ko) => { pend[mid] = { ok, ko }; cp.send(JSON.stringify([2, mid, action, payload])); setTimeout(() => { if (pend[mid]) { delete pend[mid]; ko(new Error('la borne ne répond pas')); } }, 15000); });
}
const ST = { Available: 'Libre', Preparing: 'Voiture branchée', Charging: 'En charge', SuspendedEV: 'En pause (voiture)', SuspendedEVSE: 'En pause (borne)', Finishing: 'Charge terminée', Reserved: 'Réservée', Unavailable: 'Indisponible', Faulted: 'En défaut' };
module.exports = {
  id: 'ocpp', name: 'Borne OCPP', poll: 5000,
  init(c) { start(+c.port || 9220); },
  async test(c) { start(+c.port || 9220); const n = Object.values(CP).filter(x => x.online).length; return n ? n + ' borne(s) connectée(s)' : 'En attente : réglez la borne sur ws://IP-du-NAS:' + (+c.port || 9220) + '/ma-borne'; },
  async devices(c) {
    start(+c.port || 9220);
    return Object.keys(CP).map(id => { const x = CP[id]; return { id, name: 'Borne ' + id, kind: 'plug', info: (x.online ? ST[x.status] || x.status : 'Déconnectée') + (x.model ? ' · ' + x.model : '') + (x.tx && x.wh ? ' · ' + ((x.wh - x.start) / 1000).toFixed(1).replace('.', ',') + ' kWh' : ''), state: { on: x.status === 'Charging', w: Math.round(x.w || 0) } }; });
  },
  async command(c, id, p) {
    if (p.on === true) { const r = await call(id, 'RemoteStartTransaction', { connectorId: 1, idTag: 'BETAHOME' }); if (r.status !== 'Accepted') throw new Error('départ refusé par la borne'); }
    if (p.on === false) { const tx = CP[id] && CP[id].tx; if (tx == null) throw new Error('aucune charge en cours'); await call(id, 'RemoteStopTransaction', { transactionId: tx }); }
    if (p.amps) await call(id, 'SetChargingProfile', { connectorId: 0, csChargingProfiles: { chargingProfileId: 1, stackLevel: 0, chargingProfilePurpose: 'TxDefaultProfile', chargingProfileKind: 'Absolute', chargingSchedule: { chargingRateUnit: 'A', chargingSchedulePeriod: [{ startPeriod: 0, limit: Math.max(6, Math.min(32, +p.amps)) }] } } });
  },
  _test: { CP, call }
};

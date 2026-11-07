// Client WebSocket minimal (sans dépendance) : ws:// et wss:// (certificats auto-signés des TV acceptés).
// Utilisé par les TV Samsung et LG, Music Assistant et le serveur Matter.
'use strict';
const net = require('net'), tls = require('tls'), crypto = require('crypto');

function connect(url, o) {
  o = o || {};
  return new Promise((ok, ko) => {
    const u = new URL(url), secure = u.protocol === 'wss:', port = +u.port || (secure ? 443 : 80), key = crypto.randomBytes(16).toString('base64');
    const sock = secure ? tls.connect(Object.assign({ host: u.hostname, port, rejectUnauthorized: false }, net.isIP(u.hostname) ? {} : { servername: u.hostname })) : net.connect({ host: u.hostname, port });
    const ws = { onmessage: null, onclose: null, open: false, send, close, sock, early: [] };   // early : messages reçus avant qu'on écoute
    let buf = Buffer.alloc(0), head = true, frag = [];
    const timer = setTimeout(() => { sock.destroy(); ko(new Error('appareil injoignable')); }, o.timeout || 6000);
    sock.on(secure ? 'secureConnect' : 'connect', () => {
      sock.write('GET ' + u.pathname + u.search + ' HTTP/1.1\r\nHost: ' + u.host + '\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ' + key + '\r\nSec-WebSocket-Version: 13\r\n' + (o.headers ? Object.entries(o.headers).map(([k, v]) => k + ': ' + v + '\r\n').join('') : '') + '\r\n');
    });
    sock.on('data', d => {
      buf = Buffer.concat([buf, d]);
      if (head) {
        const i = buf.indexOf('\r\n\r\n'); if (i < 0) return;
        const h = buf.slice(0, i).toString(); buf = buf.slice(i + 4); head = false;
        if (!/^HTTP\/1\.1 101/.test(h)) { clearTimeout(timer); sock.destroy(); return ko(new Error('connexion refusée (' + h.split('\r\n')[0] + ')')); }
        clearTimeout(timer); ws.open = true; ok(ws);
      }
      for (;;) {
        if (buf.length < 2) return;
        const fin = buf[0] & 0x80, op = buf[0] & 0x0f, masked = buf[1] & 0x80; let len = buf[1] & 0x7f, off = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; } else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
        const mk = masked ? buf.slice(off, off + 4) : null; if (masked) off += 4;
        if (buf.length < off + len) return;
        let p = buf.slice(off, off + len); buf = buf.slice(off + len);
        if (mk) p = Buffer.from(p.map((b, i) => b ^ mk[i % 4]));
        if (op === 9) { frame(10, p); continue; }        // ping → pong
        if (op === 8) { close(); continue; }
        if (op === 1 || op === 2 || op === 0) { frag.push(p); if (fin) { const m = Buffer.concat(frag).toString('utf8'); frag = []; if (ws.onmessage) try { ws.onmessage(m); } catch (e) { } else ws.early.push(m); } }
      }
    });
    sock.on('error', e => { clearTimeout(timer); if (!ws.open) ko(new Error('appareil injoignable (' + (e.code || e.message) + ')')); });
    sock.on('close', () => { ws.open = false; if (ws.onclose) ws.onclose(); });
    function frame(op, data) {
      const mask = crypto.randomBytes(4), len = data.length;
      const h = len < 126 ? Buffer.from([0x80 | op, 0x80 | len]) : len < 65536 ? Buffer.from([0x80 | op, 0x80 | 126, len >> 8, len & 255]) : (() => { const b = Buffer.alloc(10); b[0] = 0x80 | op; b[1] = 0x80 | 127; b.writeBigUInt64BE(BigInt(len), 2); return b; })();
      sock.write(Buffer.concat([h, mask, Buffer.from(data.map((b, i) => b ^ mask[i % 4]))]));
    }
    function send(m) { frame(1, Buffer.from(typeof m === 'string' ? m : JSON.stringify(m))); }
    function close() { if (!ws.open) return; ws.open = false; try { frame(8, Buffer.alloc(0)); } catch (e) { } sock.end(); }
  });
}
// petite file de requêtes/réponses JSON au-dessus d'une connexion (identifiants de message)
function rpc(ws, idKey) {
  const wait = new Map(); let n = 1;
  const prev = ws.onmessage;
  ws.onmessage = m => { let j; try { j = JSON.parse(m); } catch (e) { return; } const w = wait.get(String(j[idKey])); if (w) { wait.delete(String(j[idKey])); w(j); } else if (prev) prev(m, j); };
  return (msg, ms) => new Promise((ok, ko) => { const id = String(msg[idKey] || n++); msg[idKey] = msg[idKey] || id; wait.set(id, ok); ws.send(msg); setTimeout(() => { if (wait.delete(id)) ko(new Error('pas de réponse')); }, ms || 8000); });
}
module.exports = { connect, rpc };

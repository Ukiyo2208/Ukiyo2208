// Serveur WebSocket minimal (RFC 6455), sans dépendance — utilisé par l'OCPP des bornes de recharge.
'use strict';
const crypto = require('crypto');
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

// accepte la connexion ; protocol : sous-protocole exigé (ex. « ocpp1.6 »). Renvoie null si refusée.
function accept(req, socket, protocol) {
  const key = req.headers['sec-websocket-key'], asked = String(req.headers['sec-websocket-protocol'] || '').split(',').map(s => s.trim());
  if (!key || (protocol && !asked.includes(protocol))) { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); return null; }
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + crypto.createHash('sha1').update(key + GUID).digest('base64') + '\r\n' + (protocol ? 'Sec-WebSocket-Protocol: ' + protocol + '\r\n' : '') + '\r\n');
  socket.setNoDelay(true);
  const ws = { onmessage: null, onclose: null, open: true }, frag = [];
  let buf = Buffer.alloc(0);
  const frame = (op, data) => {
    const p = Buffer.isBuffer(data) ? data : Buffer.from(String(data || '')), n = p.length;
    const h = n < 126 ? Buffer.from([0x80 | op, n]) : n < 65536 ? Buffer.from([0x80 | op, 126, n >> 8, n & 255]) : Buffer.concat([Buffer.from([0x80 | op, 127, 0, 0, 0, 0]), Buffer.from([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255])]);
    if (ws.open) socket.write(Buffer.concat([h, p]));
  };
  ws.send = t => frame(1, t);
  ws.close = () => { if (!ws.open) return; frame(8, ''); ws.open = false; socket.end(); };
  const done = () => { if (ws.closed) return; ws.closed = true; ws.open = false; clearInterval(ping); if (ws.onclose) ws.onclose(); };
  const ping = setInterval(() => frame(9, 'beta'), 30000);
  socket.on('data', d => {
    buf = Buffer.concat([buf, d]);
    for (;;) {
      if (buf.length < 2) return;
      const fin = buf[0] & 0x80, op = buf[0] & 15, masked = buf[1] & 0x80;
      let n = buf[1] & 127, off = 2;
      if (n === 126) { if (buf.length < 4) return; n = buf.readUInt16BE(2); off = 4; }
      else if (n === 127) { if (buf.length < 10) return; n = buf.readUInt32BE(6); off = 10; }
      if (n > 4e6) return socket.destroy();
      const mk = masked ? buf.slice(off, off + 4) : null; if (masked) off += 4;
      if (buf.length < off + n) return;
      const p = Buffer.from(buf.slice(off, off + n)); buf = buf.slice(off + n);
      if (mk) for (let i = 0; i < p.length; i++) p[i] ^= mk[i & 3];
      if (op === 8) { ws.close(); return done(); }
      if (op === 9) { frame(10, p); continue; }
      if (op === 10) continue;
      if (op === 1 || op === 0) { frag.push(p); if (fin && ws.onmessage) { const t = Buffer.concat(frag).toString('utf8'); frag.length = 0; ws.onmessage(t); } else if (fin) frag.length = 0; }
    }
  });
  socket.on('close', done); socket.on('error', done);
  return ws;
}

module.exports = { accept };

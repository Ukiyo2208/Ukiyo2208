// Lecture Modbus TCP minimale (onduleurs SMA, Huawei…) : registres « holding » (fonction 3).
'use strict';
const net = require('net');
let tid = 1;
function read(host, port, unit, addr, count) {
  return new Promise((ok, ko) => {
    const s = net.connect({ host, port: port || 502 }), id = tid++ & 0xffff, q = Buffer.alloc(12);
    q.writeUInt16BE(id, 0); q.writeUInt16BE(0, 2); q.writeUInt16BE(6, 4); q[6] = unit; q[7] = 3; q.writeUInt16BE(addr, 8); q.writeUInt16BE(count, 10);
    let buf = Buffer.alloc(0); const end = (e, v) => { s.destroy(); e ? ko(e) : ok(v); };
    s.setTimeout(5000, () => end(new Error('onduleur injoignable (Modbus)')));
    s.on('connect', () => s.write(q)); s.on('error', e => end(new Error('onduleur injoignable (' + (e.code || e.message) + ')')));
    s.on('data', d => { buf = Buffer.concat([buf, d]); if (buf.length < 9) return; if (buf[7] & 0x80) return end(new Error('erreur Modbus ' + buf[8])); if (buf.length >= 9 + buf[8]) end(null, buf.slice(9, 9 + buf[8])); });
  });
}
module.exports = { read };

// Client MQTT 3.1.1 minimal (QoS 0), sans dépendance — se reconnecte tout seul.
'use strict';
const net = require('net');

const str = s => { const b = Buffer.from(String(s), 'utf8'); return Buffer.concat([Buffer.from([b.length >> 8, b.length & 255]), b]); };
const varint = n => { const o = []; do { let d = n % 128; n = Math.floor(n / 128); if (n > 0) d |= 128; o.push(d); } while (n > 0); return Buffer.from(o); };
const packet = (h, body) => Buffer.concat([Buffer.from([h]), varint(body.length), body]);

function connect(o) {
  const u = new URL(/^mqtts?:\/\//.test(o.url || '') ? o.url : 'mqtt://' + (o.url || '127.0.0.1'));
  const c = { connected: false, error: '', subs: new Set(), onmessage: null, stopped: false };
  let sock, buf = Buffer.alloc(0), pid = 1, ping, retry;
  const send = b => { if (sock && c.connected) sock.write(b); };
  function open() {
    clearTimeout(retry); buf = Buffer.alloc(0);
    sock = net.connect(+u.port || 1883, u.hostname);
    sock.setTimeout(90000, () => sock.destroy(new Error('délai dépassé')));
    sock.on('connect', () => {
      const flags = 0x02 | (o.user ? 0x80 : 0) | (o.pass ? 0x40 : 0);
      const body = Buffer.concat([str('MQTT'), Buffer.from([4, flags, 0, 60]), str('beta-os-' + Math.random().toString(36).slice(2, 8)), o.user ? str(o.user) : Buffer.alloc(0), o.pass ? str(o.pass) : Buffer.alloc(0)]);
      sock.write(packet(0x10, body));
    });
    sock.on('data', d => {
      buf = Buffer.concat([buf, d]);
      for (;;) {
        if (buf.length < 2) return;
        let n = 0, m = 1, i = 1, b;
        do { if (i >= buf.length) return; b = buf[i++]; n += (b & 127) * m; m *= 128; } while (b & 128);
        if (buf.length < i + n) return;
        const type = buf[0] >> 4, qos = (buf[0] >> 1) & 3, p = buf.slice(i, i + n); buf = buf.slice(i + n);
        if (type === 2) {
          if (p[1] !== 0) { c.error = p[1] === 4 || p[1] === 5 ? 'identifiants MQTT refusés' : 'connexion MQTT refusée (' + p[1] + ')'; sock.destroy(); return; }
          c.connected = true; c.error = '';
          c.subs.forEach(t => subscribe(t, true));
          ping = setInterval(() => send(Buffer.from([0xc0, 0])), 30000);
        } else if (type === 3) {
          const tl = p.readUInt16BE(0), topic = p.slice(2, 2 + tl).toString('utf8'), off = 2 + tl + (qos ? 2 : 0);
          if (qos === 1) send(Buffer.from([0x40, 2, p[2 + tl], p[3 + tl]]));
          if (c.onmessage) try { c.onmessage(topic, p.slice(off).toString('utf8')); } catch (e) { }
        }
      }
    });
    sock.on('error', e => { c.error = e.code === 'ECONNREFUSED' ? 'serveur MQTT injoignable' : e.message; });
    sock.on('close', () => { c.connected = false; clearInterval(ping); if (!c.stopped) retry = setTimeout(open, 5000); });
  }
  function subscribe(topic, again) {
    if (!again) c.subs.add(topic);
    const id = pid = pid % 65535 + 1;
    send(packet(0x82, Buffer.concat([Buffer.from([id >> 8, id & 255]), str(topic), Buffer.from([0])])));
  }
  c.subscribe = t => subscribe(t);
  c.publish = (topic, payload, retain) => { if (!c.connected) throw new Error('serveur MQTT non connecté'); send(packet(0x30 | (retain ? 1 : 0), Buffer.concat([str(topic), Buffer.from(String(payload), 'utf8')]))); };
  c.end = () => { c.stopped = true; clearTimeout(retry); if (sock) sock.destroy(); };
  open();
  return c;
}

module.exports = { connect };

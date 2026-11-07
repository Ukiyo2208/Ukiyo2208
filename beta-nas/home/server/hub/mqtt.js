// Client MQTT 3.1.1 minimal (sans dépendance) : connexion, abonnement, publication, reconnexion.
'use strict';
const net = require('net');
const rlen = n => { const b = []; do { let x = n % 128; n = Math.floor(n / 128); if (n) x |= 128; b.push(x); } while (n); return Buffer.from(b); };
const s16 = s => { const b = Buffer.from(s, 'utf8'), l = Buffer.alloc(2); l.writeUInt16BE(b.length); return Buffer.concat([l, b]); };
const pkt = (type, body) => Buffer.concat([Buffer.from([type]), rlen(body.length), body]);

class Client {
  constructor(o) { this.o = o; this.subs = new Set(); this.handlers = []; this.ok = false; this.err = ''; this.pid = 1; this.connect(); }
  connect() {
    const o = this.o, s = this.sock = net.connect({ host: o.host, port: o.port || 1883 });
    let buf = Buffer.alloc(0);
    s.setKeepAlive(true);
    s.on('connect', () => {
      let flags = 0x02; const pl = [s16(o.clientId || 'beta-home-' + Math.random().toString(16).slice(2, 8))];
      if (o.user) { flags |= 0x80; pl.push(s16(o.user)); } if (o.pass) { flags |= 0x40; pl.push(s16(o.pass)); }
      s.write(pkt(0x10, Buffer.concat([s16('MQTT'), Buffer.from([4, flags, 0, 60])].concat(pl))));
    });
    s.on('data', d => {
      buf = Buffer.concat([buf, d]);
      for (;;) {
        if (buf.length < 2) break;
        let mul = 1, len = 0, i = 1, b; do { b = buf[i++]; if (b === undefined) return; len += (b & 127) * mul; mul *= 128; } while (b & 128);
        if (buf.length < i + len) break;
        const type = buf[0] >> 4, flags = buf[0] & 15, body = buf.slice(i, i + len); buf = buf.slice(i + len);
        if (type === 2) { if (body[1] === 0) { this.ok = true; this.err = ''; this.subs.forEach(t => this._sub(t)); this.ping = setInterval(() => s.write(Buffer.from([0xc0, 0])), 30000); } else { this.err = body[1] === 4 || body[1] === 5 ? 'identifiant ou mot de passe MQTT refusé' : 'connexion MQTT refusée (' + body[1] + ')'; s.destroy(); } }
        if (type === 3) { const tl = body.readUInt16BE(0), topic = body.toString('utf8', 2, 2 + tl), qos = (flags >> 1) & 3, off = 2 + tl + (qos ? 2 : 0); this.handlers.forEach(h => { try { h(topic, body.slice(off)); } catch (e) { } }); }
      }
    });
    s.on('error', e => { this.err = 'broker MQTT injoignable (' + (e.code || e.message) + ')'; });
    s.on('close', () => { this.ok = false; clearInterval(this.ping); if (!this.closed) setTimeout(() => this.connect(), 5000); });
  }
  _sub(t) { const id = Buffer.alloc(2); id.writeUInt16BE(this.pid++ & 0xffff || 1); this.sock.write(pkt(0x82, Buffer.concat([id, s16(t), Buffer.from([0])]))); }
  subscribe(t) { this.subs.add(t); if (this.ok) this._sub(t); }
  publish(t, payload, retain) { if (!this.ok) throw new Error(this.err || 'MQTT non connecté'); this.sock.write(pkt(0x30 | (retain ? 1 : 0), Buffer.concat([s16(t), Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload))]))); }
  on(fn) { this.handlers.push(fn); }
  close() { this.closed = true; this.sock.destroy(); }
  ready(ms) { return new Promise((ok, ko) => { const t0 = Date.now(), w = () => this.ok ? ok() : Date.now() - t0 > ms ? ko(new Error(this.err || 'broker MQTT injoignable')) : setTimeout(w, 100); w(); }); }
}
module.exports = { Client };

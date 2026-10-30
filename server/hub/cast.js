// Google Cast (Chromecast, Google/Nest Home, TV Android, enceintes « Chromecast built-in »).
// Protocole Cast v2 implémenté ici sans dépendance : connexion TLS sur le port 8009, messages
// protobuf « CastMessage ». Volume, lecture/pause, arrêt, et lecture d'une radio par son adresse.
'use strict';
const tls = require('tls');
const NS = { con: 'urn:x-cast:com.google.cast.tp.connection', hb: 'urn:x-cast:com.google.cast.tp.heartbeat', rcv: 'urn:x-cast:com.google.cast.receiver', media: 'urn:x-cast:com.google.cast.media' };
const MEDIA_APP = 'CC1AD845';   // « Default Media Receiver » de Google

/* ---------- protobuf minimal pour CastMessage ---------- */
const varint = n => { const b = []; do { let x = n & 0x7f; n >>>= 7; if (n) x |= 0x80; b.push(x); } while (n); return Buffer.from(b); };
const field = (no, wt, v) => Buffer.concat([varint((no << 3) | wt), v]);
const str = (no, s) => { const b = Buffer.from(s, 'utf8'); return field(no, 2, Buffer.concat([varint(b.length), b])); };
function encode(src, dst, ns, payload) {
  const msg = Buffer.concat([field(1, 0, varint(0)), str(2, src), str(3, dst), str(4, ns), field(5, 0, varint(0)), str(6, JSON.stringify(payload))]);
  const len = Buffer.alloc(4); len.writeUInt32BE(msg.length); return Buffer.concat([len, msg]);
}
function decode(buf) {
  const m = {}; let i = 0;
  const rv = () => { let r = 0, s = 0, b; do { b = buf[i++]; r |= (b & 0x7f) << s; s += 7; } while (b & 0x80); return r >>> 0; };
  while (i < buf.length) { const k = rv(), no = k >> 3, wt = k & 7; if (wt === 0) m[no] = rv(); else if (wt === 2) { const l = rv(); m[no] = buf.toString('utf8', i, i + l); i += l; } else break; }
  let data = null; try { data = JSON.parse(m[6] || 'null'); } catch (e) { }
  return { src: m[2], dst: m[3], ns: m[4], data };
}

/* ---------- une session courte avec l'appareil ---------- */
function session(host, fn) {
  return new Promise((ok, ko) => {
    const sock = tls.connect({ host, port: 8009, rejectUnauthorized: false, timeout: 6000 });
    let buf = Buffer.alloc(0), rid = 1, waiters = [], done = false;
    const finish = (e, v) => { if (done) return; done = true; try { sock.destroy(); } catch (x) { } e ? ko(e) : ok(v); };
    const send = (dst, ns, p) => sock.write(encode('sender-0', dst, ns, p));
    const ask = (dst, ns, p, pred) => new Promise((res, rej) => { const id = rid++; waiters.push({ id, pred: pred || (d => d.requestId === id), res }); send(dst, ns, Object.assign({ requestId: id }, p)); setTimeout(() => rej(new Error('pas de réponse de l’appareil')), 5000); });
    sock.on('data', d => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 4 && buf.length >= 4 + buf.readUInt32BE(0)) {
        const m = decode(buf.slice(4, 4 + buf.readUInt32BE(0))); buf = buf.slice(4 + buf.readUInt32BE(0));
        if (m.data && m.data.type === 'PING') send(m.src, NS.hb, { type: 'PONG' });
        waiters = waiters.filter(w => { if (m.data && w.pred(m.data, m)) { w.res(m.data); return false; } return true; });
      }
    });
    sock.on('timeout', () => finish(new Error('appareil injoignable')));
    sock.on('error', e => finish(new Error('appareil injoignable (' + (e.code || e.message) + ')')));
    sock.on('secureConnect', async () => {
      try { send('receiver-0', NS.con, { type: 'CONNECT' }); finish(null, await fn({ send, ask })); } catch (e) { finish(e); }
    });
  });
}
const status = s => s.ask('receiver-0', NS.rcv, { type: 'GET_STATUS' }).then(d => d.status || {});
const hosts = c => String(c.hosts || '').split(/[,;\n]+/).map(x => x.trim()).filter(Boolean).map(x => { const [ip, ...n] = x.split(/\s*[:=]\s*(?=\D)/); return { ip: ip.trim(), name: n.join(' ').trim() }; });

module.exports = {
  id: 'cast', name: 'Google Cast', poll: 5000,
  async test(c) {
    const hs = hosts(c); if (!hs.length) throw new Error('ajoutez au moins une adresse IP');
    const r = await Promise.all(hs.map(h => session(h.ip, status).then(st => (h.name || h.ip) + ((st.applications || [])[0] ? ' (' + st.applications[0].displayName + ')' : ''), e => '⚠ ' + h.ip + ' : ' + e.message)));
    if (r.every(x => x.startsWith('⚠'))) throw new Error(r.join(' · '));
    return r.length + ' appareil(s) : ' + r.join(', ');
  },
  async devices(c) {
    return (await Promise.all(hosts(c).map(h => session(h.ip, status).then(st => {
      const app = (st.applications || [])[0], vol = st.volume || {};
      return { id: h.ip, name: h.name || 'Chromecast ' + h.ip, kind: 'speaker', state: { on: !!app && !app.isIdleScreen, vol: Math.round((vol.level || 0) * 100), title: app && !app.isIdleScreen ? (app.statusText || app.displayName || '') : '' } };
    }, () => null)))).filter(Boolean);
  },
  async command(c, ip, p) {
    return session(ip, async s => {
      if ('vol' in p) await s.ask('receiver-0', NS.rcv, { type: 'SET_VOLUME', volume: { level: Math.max(0, Math.min(1, p.vol / 100)) } });
      if (p.play) {   // lance le lecteur de Google puis la radio / le fichier
        let st = await status(s), app = (st.applications || []).find(a => a.appId === MEDIA_APP);
        if (!app) { st = await s.ask('receiver-0', NS.rcv, { type: 'LAUNCH', appId: MEDIA_APP }, d => d.type === 'RECEIVER_STATUS' && (d.status.applications || []).some(a => a.appId === MEDIA_APP)).then(d => d.status); app = st.applications.find(a => a.appId === MEDIA_APP); }
        s.send(app.transportId, NS.con, { type: 'CONNECT' });
        return s.ask(app.transportId, NS.media, { type: 'LOAD', autoplay: true, media: { contentId: p.play, contentType: /\.(aac|m4a)/i.test(p.play) ? 'audio/aac' : 'audio/mpeg', streamType: 'LIVE', metadata: { metadataType: 3, title: p.title || 'Bêta home' } } }, d => d.type === 'MEDIA_STATUS' || d.type === 'LOAD_FAILED');
      }
      if ('on' in p || p.cmd) {
        const st = await status(s), app = (st.applications || []).find(a => !a.isIdleScreen); if (!app) return;
        if (p.on === false && !p.cmd) return s.ask('receiver-0', NS.rcv, { type: 'STOP', sessionId: app.sessionId });
        s.send(app.transportId, NS.con, { type: 'CONNECT' });
        const ms = await s.ask(app.transportId, NS.media, { type: 'GET_STATUS' }, d => d.type === 'MEDIA_STATUS'), cur = (ms.status || [])[0]; if (!cur) return;
        const t = p.cmd === 'media_play_pause' ? (cur.playerState === 'PLAYING' ? 'PAUSE' : 'PLAY') : p.cmd === 'media_pause' ? 'PAUSE' : p.cmd === 'media_stop' ? 'STOP' : 'PLAY';
        return s.ask(app.transportId, NS.media, { type: t, mediaSessionId: cur.mediaSessionId }, d => d.type === 'MEDIA_STATUS');
      }
    });
  },
  _test: { encode, decode }
};

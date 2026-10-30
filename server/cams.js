// Serveur Bêta — caméras sans Home Assistant : découverte, adresses vidéo gardées sur le NAS,
// images et direct pour Bêta home, et pont HomeKit pour les seules caméras (via go2rtc).
// go2rtc (gratuit, libre) tourne à côté dans Docker : il lit les flux RTSP, les publie en HomeKit
// et fournit les images. Ce module écrit sa configuration et le redémarre quand elle change.
'use strict';
const fs = require('fs'), path = require('path'), http = require('http'), crypto = require('crypto');
const D = require('./discover');

module.exports = function cams(DATA, send, readBody) {
  const FILE = path.join(DATA, 'cams.json'), YAML = process.env.GO2RTC_CONFIG || path.join(DATA, 'go2rtc.yaml');
  const GO = (process.env.GO2RTC_URL || 'http://127.0.0.1:1984').replace(/\/+$/, '');
  let CAMS = []; try { CAMS = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { }
  const persist = () => fs.writeFileSync(FILE, JSON.stringify(CAMS, null, 1), { mode: 0o600 });
  let last = null;                                   // dernière découverte
  const safeId = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'camera';
  const view = c => ({ id: c.id, name: c.name, ip: c.ip, homekit: !!c.homekit, pin: c.homekit ? c.pin : '', hasStream: !!c.rtsp, rtsp: c.rtsp ? c.rtsp.replace(/\/\/[^@/]*@/, '//••••@') : '' });
  const pin = () => { const n = () => crypto.randomInt(0, 10); let p; do { p = Array.from({ length: 8 }, n).join(''); } while (/^(\d)\1+$/.test(p) || ['12345678', '87654321'].includes(p)); return p; };

  /* ---------- configuration de go2rtc (garde les appairages HomeKit déjà faits) ---------- */
  function keepHomekit() {
    // go2rtc écrit lui-même ses clés d'appairage dans le fichier : on les conserve, caméra par caméra
    const keep = {}; let txt = ''; try { txt = fs.readFileSync(YAML, 'utf8'); } catch (e) { return keep; }
    const m = txt.match(/^homekit:\n((?:[ \t].*\n?|\n)*)/m); if (!m) return keep;
    let cur = null;
    m[1].split('\n').forEach(l => { const h = l.match(/^ {2}([\w-]+):\s*$/); if (h) { cur = h[1]; keep[cur] = []; return; } if (cur && /^ {4}/.test(l) && !/^ {4}(pin|name):/.test(l)) keep[cur].push(l); });
    return keep;
  }
  const q = s => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  function writeConfig() {
    const keep = keepHomekit(), live = CAMS.filter(c => c.rtsp);
    let y = '# Écrit par Bêta home — les lignes de pairings / device_* sont gérées par go2rtc\napi:\n  listen: ":1984"\nrtsp:\n  listen: ":8554"\nstreams:\n';
    live.forEach(c => { y += '  ' + c.id + ': ' + q(c.rtsp) + '\n'; });
    const hk = live.filter(c => c.homekit);
    if (hk.length) { y += 'homekit:\n'; hk.forEach(c => { y += '  ' + c.id + ':\n    pin: ' + c.pin + '\n    name: ' + q(c.name) + '\n' + (keep[c.id] || []).filter(Boolean).join('\n') + ((keep[c.id] || []).filter(Boolean).length ? '\n' : ''); }); }
    fs.writeFileSync(YAML, y, { mode: 0o600 });
    return restart();
  }
  function goReq(p, method) { return new Promise((ok, ko) => { const r = http.request(GO + p, { method: method || 'GET', timeout: 4000 }, res => { const ch = []; res.on('data', c => ch.push(c)); res.on('end', () => ok({ status: res.statusCode, type: res.headers['content-type'], body: Buffer.concat(ch) })); }); r.on('timeout', () => { r.destroy(); ko(new Error('go2rtc ne répond pas')); }); r.on('error', ko); r.end(); }); }
  async function restart() { try { await goReq('/api/restart', 'POST'); return 'ok'; } catch (e) { return 'go2rtc injoignable : ' + e.message; } }

  /* ---------- API ---------- */
  async function api(req, res, url) {
    const p = url.pathname, m = req.method;
    if (p === '/api/discover' && m === 'POST') { const b = (await readBody(req)) || {}; last = await D.scan({ rtsp: b.rtsp !== false }); return send(res, 200, last); }
    if (p === '/api/discover' && m === 'GET') return send(res, 200, last || { devices: [] });
    if (p === '/api/cams/onvif' && m === 'POST') { const b = (await readBody(req)) || {}; if (!/^https?:\/\//.test(b.xaddr || '')) return send(res, 400, { error: 'adresse ONVIF manquante' }); try { return send(res, 200, { streams: await D.onvifStream(b) }); } catch (e) { return send(res, 200, { error: e.message }); } }
    if (p === '/api/cams' && m === 'GET') { let go = null; try { go = JSON.parse((await goReq('/api/streams')).body.toString()); } catch (e) { } return send(res, 200, { cams: CAMS.map(view), go2rtc: !!go }); }
    if (p === '/api/cams' && m === 'POST') {
      const b = (await readBody(req)) || {}; if (!Array.isArray(b.cams)) return send(res, 400, { error: 'liste attendue' });
      const ids = new Set();
      CAMS = b.cams.map(c => {
        const old = CAMS.find(x => x.id === c.id) || {};
        let id = old.id || safeId(c.name); while (ids.has(id)) id += '_2'; ids.add(id);
        const rtsp = c.rtsp && !c.rtsp.includes('••••') ? String(c.rtsp).trim() : old.rtsp || '';
        if (rtsp && !/^(rtsp|rtsps|http|https|rtmp):\/\//.test(rtsp)) throw new Error('adresse vidéo invalide : ' + c.name);
        return { id, name: String(c.name || id).slice(0, 60), ip: c.ip || old.ip || '', rtsp, homekit: !!c.homekit, pin: c.homekit ? (old.pin || pin()) : '' };
      });
      persist(); const go = await writeConfig();
      return send(res, 200, { ok: true, cams: CAMS.map(view), go2rtc: go });
    }
    let r;
    if ((r = p.match(/^\/api\/cams\/(frame|mjpeg)\/([\w-]+)$/)) && m === 'GET') {
      const c = CAMS.find(x => x.id === r[2]); if (!c) return send(res, 404, { error: 'caméra inconnue' });
      if (r[1] === 'frame') { try { const g = await goReq('/api/frame.jpeg?src=' + c.id); if (g.status !== 200) throw new Error('pas d’image'); res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store' }); return res.end(g.body); } catch (e) { return send(res, 502, { error: e.message }); } }
      // direct : flux MJPEG relayé depuis go2rtc
      const up = http.get(GO + '/api/stream.mjpeg?src=' + c.id, g => { res.writeHead(g.statusCode, { 'Content-Type': g.headers['content-type'] || 'multipart/x-mixed-replace', 'Cache-Control': 'no-store' }); g.pipe(res); });
      up.on('error', () => send(res, 502, { error: 'go2rtc injoignable' })); req.on('close', () => up.destroy()); return;
    }
    return false;
  }
  return { api, mediaPath: p => /^\/api\/cams\/(frame|mjpeg)\//.test(p) };
};

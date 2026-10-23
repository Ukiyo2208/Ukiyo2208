// Serveur Bêta — à lancer sur le NAS (Docker). Node.js 20+, aucune dépendance.
// - sert l'application Bêta OS
// - garde les sauvegardes, le journal partagé et des données clé/valeur
// - relaie les services que le navigateur ne peut pas joindre (Nextcloud, NAS, test des mails)
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), tls = require('tls'), net = require('net');

const PORT = +process.env.PORT || 8090;
const ROOT = path.resolve(process.env.APP_DIR || path.join(__dirname, '..'));
const DATA = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const KEY = process.env.BETA_KEY || '';
const KEEP = +process.env.BACKUP_KEEP || 30;
const VERSION = '1.0.0';
for (const d of ['', 'store', 'backups']) fs.mkdirSync(path.join(DATA, d), { recursive: true });
if (!KEY) console.warn('⚠️  BETA_KEY n’est pas défini : l’API est ouverte à tout le réseau.');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const send = (res, code, body, type) => { res.writeHead(code, { 'Content-Type': type || 'application/json; charset=utf-8' }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
const cors = (req, res) => { res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*'); res.setHeader('Vary', 'Origin'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Beta-Key'); res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS'); };
const readBody = req => new Promise((ok, ko) => { let n = 0; const ch = []; req.on('data', c => { n += c.length; if (n > 25e6) { ko(new Error('trop gros')); req.destroy(); } else ch.push(c); }); req.on('end', () => { try { const t = Buffer.concat(ch).toString('utf8'); ok(t ? JSON.parse(t) : null); } catch (e) { ko(new Error('JSON invalide')); } }); });
const safe = s => /^[\w.-]{1,80}$/.test(s) && !s.includes('..');
const HUB = require('./hub')(DATA, send, readBody);   // appareils connectés en direct (Somfy, Hue, SmartThings…)

/* ---------- API ---------- */
async function api(req, res, url) {
  const p = url.pathname, m = req.method;
  if (p === '/api/ping') return send(res, 200, { ok: true, name: 'Serveur Bêta', version: VERSION, time: Date.now(), hub: true });
  if (p === '/api/hub/oauth/callback') return HUB.callback(req, res, url);
  if (KEY && req.headers['x-beta-key'] !== KEY) return send(res, 401, { error: 'clé invalide' });
  if (p === '/api/hub' || p.startsWith('/api/hub/')) return HUB.api(req, res, url);

  let r;
  if ((r = p.match(/^\/api\/store\/([\w-]+)$/))) {
    const f = path.join(DATA, 'store', r[1] + '.json');
    if (m === 'GET') return fs.existsSync(f) ? send(res, 200, fs.readFileSync(f)) : send(res, 404, { error: 'introuvable' });
    if (m === 'PUT' || m === 'POST') { fs.writeFileSync(f, JSON.stringify(await readBody(req))); return send(res, 200, { ok: true }); }
  }
  if (p === '/api/journal') {
    const f = path.join(DATA, 'journal.jsonl');
    if (m === 'POST') { const list = await readBody(req); if (!Array.isArray(list)) return send(res, 400, { error: 'liste attendue' }); fs.appendFileSync(f, list.map(e => JSON.stringify(e)).join('\n') + (list.length ? '\n' : '')); return send(res, 200, { ok: true, n: list.length }); }
    if (m === 'GET') {
      const since = +url.searchParams.get('since') || 0, lim = Math.min(+url.searchParams.get('limit') || 5000, 50000);
      const out = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(e => e && e.t > since) : [];
      return send(res, 200, out.slice(-lim));
    }
  }
  if (p === '/api/backup' && m === 'POST') {
    const b = await readBody(req), d = new Date(), pad = n => String(n).padStart(2, '0');
    const name = 'beta-' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '_' + pad(d.getHours()) + pad(d.getMinutes()) + '.json';
    fs.writeFileSync(path.join(DATA, 'backups', name), JSON.stringify(b));
    const all = fs.readdirSync(path.join(DATA, 'backups')).filter(f => f.endsWith('.json')).sort();
    all.slice(0, Math.max(0, all.length - KEEP)).forEach(f => fs.unlinkSync(path.join(DATA, 'backups', f)));
    return send(res, 200, { ok: true, name });
  }
  if (p === '/api/backups' && m === 'GET') return send(res, 200, fs.readdirSync(path.join(DATA, 'backups')).filter(f => f.endsWith('.json')).sort().reverse().map(f => ({ name: f, size: fs.statSync(path.join(DATA, 'backups', f)).size })));
  if ((r = p.match(/^\/api\/backup\/(.+)$/)) && m === 'GET') { const n = decodeURIComponent(r[1]); if (!safe(n)) return send(res, 400, { error: 'nom invalide' }); const f = path.join(DATA, 'backups', n); return fs.existsSync(f) ? send(res, 200, fs.readFileSync(f)) : send(res, 404, { error: 'introuvable' }); }
  if (p === '/api/proxy' && m === 'POST') {
    const b = await readBody(req); if (!b || !/^https?:\/\//.test(b.url || '')) return send(res, 400, { error: 'url invalide' });
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 15000);
    try { const rr = await fetch(b.url, { method: b.method || 'GET', headers: b.headers || {}, body: b.body, signal: ctl.signal }); const text = (await rr.text()).slice(0, 5e6); return send(res, 200, { status: rr.status, type: rr.headers.get('content-type'), body: text }); }
    catch (e) { return send(res, 502, { error: e.name === 'AbortError' ? 'délai dépassé' : e.message }); } finally { clearTimeout(t); }
  }
  if (p === '/api/mail/test' && m === 'POST') { const b = await readBody(req); return send(res, 200, await imapLogin(b || {})); }
  return send(res, 404, { error: 'route inconnue' });
}

/* test IMAP : connexion TLS + LOGIN, sans rien lire ni envoyer d'autre */
function imapLogin(o) {
  return new Promise(done => {
    const host = String(o.imap || ''), port = +o.port || 993; if (!host || !o.user) return done({ ok: false, error: 'serveur ou adresse manquant' });
    const q = s => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
    let buf = '', step = 0, fin = false;
    const end = r => { if (fin) return; fin = true; try { sock.end(); } catch (e) { } done(r); };
    const sock = port === 143 ? net.connect(port, host) : tls.connect({ host, port, servername: host });
    sock.setTimeout(10000, () => end({ ok: false, error: 'délai dépassé' }));
    sock.on('error', e => end({ ok: false, error: e.message }));
    sock.on('data', d => {
      buf += d.toString();
      if (step === 0 && /^\* (OK|PREAUTH)/m.test(buf)) { step = 1; buf = ''; sock.write('a1 LOGIN ' + q(o.user) + ' ' + q(o.pass || '') + '\r\n'); }
      else if (step === 1 && /^a1 (OK|NO|BAD)/m.test(buf)) { const ok = /^a1 OK/m.test(buf); sock.write('a2 LOGOUT\r\n'); end(ok ? { ok: true } : { ok: false, error: 'identifiants refusés' }); }
    });
  });
}

/* ---------- fichiers de l'application ---------- */
function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname); if (rel.endsWith('/')) rel += 'index.html';
  const f = path.resolve(ROOT, '.' + rel);
  if (!f.startsWith(ROOT) || f.startsWith(DATA) || /\/server\//.test(f.slice(ROOT.length))) return send(res, 403, 'Interdit', 'text/plain');
  fs.stat(f, (e, st) => {
    if (e || !st.isFile()) return send(res, 404, 'Introuvable', 'text/plain');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream', 'Cache-Control': /\.(jpg|png|webp|svg)$/.test(f) ? 'max-age=86400' : 'no-cache' });
    fs.createReadStream(f).pipe(res);
  });
}

const srv = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) {
    cors(req, res);
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    try { await api(req, res, url); } catch (e) { send(res, 500, { error: e.message }); }
  } else serveStatic(req, res, url);
});
srv.on('upgrade', (req, socket) => HUB.upgrade(req, socket));   // bornes de recharge OCPP (ws://IP-du-NAS:8090/ocpp/…)
srv.listen(PORT, () => console.log('Serveur Bêta ' + VERSION + ' sur http://0.0.0.0:' + PORT + ' — application : ' + ROOT + ' — données : ' + DATA));

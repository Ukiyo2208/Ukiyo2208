// Serveur Bêta — à lancer sur le NAS (Docker). Node.js 20+, aucune dépendance.
// - sert l'application Bêta home
// - garde les sauvegardes, le journal partagé et des données clé/valeur
// - relaie les services que le navigateur ne peut pas joindre (Nextcloud, NAS, test des mails)
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), tls = require('tls'), net = require('net');

const PORT = +process.env.PORT || 8090;
const ROOT = path.resolve(process.env.APP_DIR || path.join(__dirname, '..'));
const DATA = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const KEY = process.env.BETA_KEY || '';
const KEEP = +process.env.BACKUP_KEEP || 30;
const VERSION = '7.20';
for (const d of ['', 'store', 'backups']) fs.mkdirSync(path.join(DATA, d), { recursive: true });
if (!KEY) console.warn('⚠️  BETA_KEY n’est pas défini : l’API est ouverte à tout le réseau.');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const send = (res, code, body, type) => { res.writeHead(code, { 'Content-Type': type || 'application/json; charset=utf-8' }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
const cors = (req, res) => { res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*'); res.setHeader('Vary', 'Origin'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Beta-Key, X-Beta-Device, X-Beta-Session'); res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS'); };
const readBody = req => new Promise((ok, ko) => { let n = 0; const ch = []; req.on('data', c => { n += c.length; if (n > 25e6) { ko(new Error('trop gros')); req.destroy(); } else ch.push(c); }); req.on('end', () => { try { const t = Buffer.concat(ch).toString('utf8'); ok(t ? JSON.parse(t) : null); } catch (e) { ko(new Error('JSON invalide')); } }); });
const safe = s => /^[\w.-]{1,80}$/.test(s) && !s.includes('..');
const HUB = require('./hub')(DATA, send, readBody);   // appareils connectés en direct (Somfy, Hue, SmartThings…)
const CAMS = require('./cams')(DATA, send, readBody); // découverte du réseau, caméras et pont HomeKit (go2rtc)
const NOTIFY = require('./notify')(DATA, send, readBody, HUB, CAMS);   // notifications ntfy, sonnette, surveillance 24 h/24
// derniers avertissements et erreurs du serveur (tableau d'administration)
const LOGS = [];
['warn', 'error'].forEach(k => { const f = console[k].bind(console); console[k] = (...a) => { LOGS.push({ t: Date.now(), lvl: k, msg: a.map(x => x instanceof Error ? x.message : typeof x === 'string' ? x : JSON.stringify(x)).join(' ').slice(0, 400) }); if (LOGS.length > 200) LOGS.shift(); f(...a); }; });
process.on('unhandledRejection', e => console.error('promesse : ' + (e && e.message || e)));
// modules facultatifs : chacun peut manquer ou être coupé (BETA_OFF=geo,bridge,engine,plus) sans gêner les autres
const OFF = String(process.env.BETA_OFF || '').split(/[,; ]+/).filter(Boolean);
const opt = (name, f) => { if (OFF.includes(name)) { console.log('module ' + name + ' coupé (BETA_OFF)'); return null; } try { return f(); } catch (e) { console.warn('⚠️  module ' + name + ' désactivé : ' + e.message); return null; } };
const GEO = opt('geo', () => require('./geo')(DATA, send, readBody, NOTIFY));           // positions OwnTracks
const BRIDGE = opt('bridge', () => require('./bridge')(DATA, send, readBody, HUB, NOTIFY)); // pont Matter : Alexa, Google Home, Maison
const AUTH = require('./auth')(DATA, send, readBody, KEY);             // écrans associés, codes PIN, mode sécurisé
const GEO0 = GEO || { inside: () => ({}), home: () => null, last: () => null };
const ENGINE = opt('engine', () => require('./engine')(DATA, send, readBody, { HUB, NOTIFY, GEO: GEO0, BRIDGE, CAMS, AUTH }));   // cerveau : routines, règles, présence, alarme
if (GEO) GEO.onFail = req => fail(req);
if (BRIDGE && ENGINE) BRIDGE.setRunner((id, by) => ENGINE.runRoutine(id, by));   // « Alexa, allume Soirée ciné » exécuté par le NAS
const PLUS = ENGINE ? opt('plus', () => require('./plus')(DATA, send, readBody, { HUB, NOTIFY, ENGINE, AUTH })) : null;   // sauvegardes, scènes, chauffage, énergie, arrosage, Siri, listes, Frigate
const EXTRA = ENGINE ? opt('extra', () => require('./extra')(DATA, send, readBody, { HUB, NOTIFY, ENGINE, PLUS, LOGS, MODS: () => MODS })) : null;   // réseau, réveil, matin, interphone, rappels, administration
const FAMILLE = ENGINE ? opt('famille', () => require('./famille')(DATA, send, readBody, { HUB, NOTIFY, ENGINE, PLUS, EXTRA })) : null;   // calendriers, colis, missions, photos, vacances, sonnette, recharge
const MODS = { hub: true, discover: true, notify: true, geo: !!GEO, bridge: !!BRIDGE, engine: !!ENGINE, auth: true, plus: !!PLUS, extra: !!EXTRA, famille: !!FAMILLE };
const VEILLE = opt('veille', () => require('./veille')(DATA, send, readBody, { HUB, NOTIFY, ENGINE, VERSION }));   // veille des marques : pannes, API modifiées, nouvelles versions
const DIAG = require('./diag')(DATA, send, { HUB, AUTH, KEY, MODS: () => MODS, ENGINE });   // « Tester toute la maison »
// fichiers qui contiennent des mots de passe : lisibles par le serveur seulement
['hub.json', 'auth.json', 'notify.json', 'plus.json', 'extra.json', 'famille.json', 'engine.json', 'geo.json', 'bridge.json'].forEach(f => { try { fs.chmodSync(path.join(DATA, f), 0o600); } catch (e) { } });

/* ---------- essais refusés : 30 par adresse en 10 minutes, puis blocage ---------- */
const FAILS = new Map();
const ipOf = req => (req.socket && req.socket.remoteAddress || '').replace(/^::ffff:/, '');
function fail(req, w) { const ip = ipOf(req), now = Date.now(), f = FAILS.get(ip) || { n: 0, at: now }; if (now - f.at > 10 * 6e4) { f.n = 0; f.at = now; } f.n += w || 1; FAILS.set(ip, f); if (f.n === 30) console.warn('trop d’essais refusés depuis ' + ip + ' : bloqué 10 minutes'); }
const blocked = req => { const f = FAILS.get(ipOf(req)); return !!f && f.n >= 30 && Date.now() - f.at < 10 * 6e4; };
setInterval(() => { const t = Date.now(); FAILS.forEach((f, ip) => { if (t - f.at > 10 * 6e4) FAILS.delete(ip); }); }, 6e4);

/* ---------- API ---------- */
async function api(req, res, url) {
  const p = url.pathname, m = req.method;
  if (p === '/api/ping') return send(res, 200, Object.assign({ ok: true, name: 'Serveur Bêta', version: VERSION, time: Date.now(), sha: process.env.BETA_SHA || 'dev' }, MODS));
  if (p === '/api/hub/oauth/callback') return HUB.callback(req, res, url);
  if (p === '/api/owntracks') { if (!GEO) return send(res, 503, { error: 'module géolocalisation coupé' }); if (blocked(req)) return send(res, 429, { error: 'trop d’essais refusés' }); const r0 = await GEO.api(req, res, url); return r0 === false ? send(res, 405, { error: 'OwnTracks envoie ses positions en POST' }) : undefined; }   // identifiants propres à chaque téléphone
  if (p === '/api/auth/pair' && m === 'POST') { if (blocked(req)) return send(res, 429, { error: 'trop d’essais : réessayez dans 10 minutes' }); fail(req, 3); return AUTH.pair(req, res); }   // compte comme 1/3 d'échec : 10 codes essayés au plus   // association d'un écran avec le code à 6 chiffres
  // les images de caméras s'affichent dans une balise <img> : la clé peut alors venir de l'adresse (?k=)
  // idem pour la sonnette appelée par un bouton (Shelly, ESPHome…) qui ne sait pas ajouter d'en-tête
  if (blocked(req)) return send(res, 429, { error: 'trop d’essais refusés : réessayez dans 10 minutes' });
  const w = AUTH.who(req, url);
  const keyOk = w.ok || ((CAMS.mediaPath(p) || p === '/api/notify/ring' || (FAMILLE && FAMILLE.mediaOk(p))) && url.searchParams.get('k') === KEY);
  if (!keyOk) { fail(req); return send(res, 401, { error: 'clé invalide' }); }
  if (AUTH.needAdmin(p, m) && !w.admin) return send(res, 401, { error: 'réservé à un administrateur (code PIN)', need: 'admin' });
  if (p === '/api/auth' || p.startsWith('/api/auth/')) { const r0 = await AUTH.api(req, res, url, w); if (r0 !== false) return; }
  if (ENGINE && (p === '/api/engine' || p.startsWith('/api/engine/') || p === '/api/history')) { const r0 = await ENGINE.api(req, res, url, w); if (r0 !== false) return; }
  if (VEILLE && (p === '/api/veille' || p.startsWith('/api/veille/'))) { const r0 = await VEILLE.api(req, res, url); if (r0 !== false) return; }
  if (p === '/api/diag') { const r0 = await DIAG.api(req, res, url); if (r0 !== false) return; }
  if (FAMILLE && (p === '/api/famille' || p.startsWith('/api/famille/') || p === '/api/photos' || p === '/api/photos/file')) { const r0 = await FAMILLE.api(req, res, url, w); if (r0 !== false) return; }
  if (EXTRA && (p === '/api/extra' || p.startsWith('/api/extra/'))) { const r0 = await EXTRA.api(req, res, url, w); if (r0 !== false) return; }
  if (PLUS && (p === '/api/plus' || p.startsWith('/api/plus/') || p === '/api/quick' || p === '/api/energy')) { const r0 = await PLUS.api(req, res, url, w); if (r0 !== false) return; }
  if (p === '/api/hub' || p.startsWith('/api/hub/')) return HUB.api(req, res, url);
  if (p === '/api/discover' || p.startsWith('/api/cams')) { const r0 = await CAMS.api(req, res, url); if (r0 !== false) return; }
  if (BRIDGE && (p === '/api/bridge' || p.startsWith('/api/bridge/'))) { const r0 = await BRIDGE.api(req, res, url); if (r0 !== false) return; }
  if (GEO && (p === '/api/geo' || p.startsWith('/api/geo/'))) { const r0 = await GEO.api(req, res, url); if (r0 !== false) return; }
  if (p === '/api/notify' || p.startsWith('/api/notify/')) { const r0 = await NOTIFY.api(req, res, url); if (r0 !== false) return; }

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
// - les fichiers texte partent compressés (gzip) avec un ETag : les tablettes ne retéléchargent que ce qui a changé
// - « un seul fichier » : index.html charge bundle.js, qui regroupe les ~45 scripts (beaucoup plus rapide sur une tablette Fire)
//   chaque script est isolé (une erreur n'empêche pas les suivants) ; BETA_BUNDLE=0 pour revenir aux fichiers séparés
const zlib = require('zlib'), vm = require('vm'), crypto = require('crypto');
const BUNDLE = process.env.BETA_BUNDLE !== '0';
const SC = new Map();   // fichier → { key, etag, raw, gz, type }
const HIDDEN = /(^|\/)(\.[^/]*|server|livrable|tests|tools|node_modules|docs)(\/|$)/;   // jamais servis : .git, sources du serveur, archives…
function cached(key, type, build) {
  const c = SC.get(type); if (c && c.key === key) return c;
  const raw = Buffer.isBuffer(build) ? build : Buffer.from(build()), etag = '"' + crypto.createHash('sha1').update(raw).digest('base64').slice(0, 20) + '"';
  const o = { key, etag, raw, gz: zlib.gzipSync(raw, { level: 9 }), type }; SC.set(type, o); return o;
}
function bundleParts() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), files = [...html.matchAll(/<script src="(js\/[^"?]+)"><\/script>\n?/g)].map(m => m[1]);
  const key = files.map(f => { try { return f + ':' + fs.statSync(path.join(ROOT, f)).mtimeMs; } catch (e) { return f; } }).join('|') + '|' + fs.statSync(path.join(ROOT, 'index.html')).mtimeMs;
  return { html, files, key };
}
function bundleJs() {
  const { files, key } = bundleParts();
  return cached(key, 'bundle', () => files.map(f => {
    let code = ''; try { code = fs.readFileSync(path.join(ROOT, f), 'utf8'); new vm.Script(code, { filename: f }); }
    catch (e) { console.warn('bundle : ' + f + ' ignoré (' + e.message + ')'); return '/* ' + f + ' : erreur de syntaxe, ignoré */'; }
    return '/* ' + f + ' */\ntry {\n' + code + '\n} catch (e) { console.error("' + f + ' : " + (e && e.message)); }';
  }).join('\n;\n'));
}
function bundleHtml() {
  const { html, key } = bundleParts(), js = bundleJs();
  return cached(key, 'html', () => { let first = true; return html.replace(/<script src="js\/[^"?]+"><\/script>\n?/g, () => first ? (first = false, '<script src="bundle.js?v=' + js.etag.replace(/\W/g, '').slice(0, 10) + '"></script>\n') : ''); });
}
function sendC(req, res, c, type, cache) {
  const h = { 'Content-Type': type, 'Cache-Control': cache || 'no-cache', ETag: c.etag, Vary: 'Accept-Encoding', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
  if (req.headers['if-none-match'] === c.etag) { res.writeHead(304, h); return res.end(); }
  const gz = /\bgzip\b/.test(req.headers['accept-encoding'] || ''); if (gz) h['Content-Encoding'] = 'gzip';
  res.writeHead(200, h); res.end(gz ? c.gz : c.raw);
}
function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname); if (rel.endsWith('/')) rel += 'index.html';
  const f = path.resolve(ROOT, '.' + rel);
  if (!f.startsWith(ROOT) || f.startsWith(DATA) || HIDDEN.test(f.slice(ROOT.length))) return send(res, 403, 'Interdit', 'text/plain');
  try {
    if (BUNDLE && rel === '/index.html') return sendC(req, res, bundleHtml(), MIME['.html']);
    if (BUNDLE && rel === '/bundle.js') return sendC(req, res, bundleJs(), MIME['.js'], url.searchParams.get('v') ? 'max-age=31536000, immutable' : 'no-cache');
  } catch (e) { console.warn('bundle : ' + e.message); }
  fs.stat(f, (e, st) => {
    if (e || !st.isFile()) return send(res, 404, 'Introuvable', 'text/plain');
    const ext = path.extname(f).toLowerCase(), type = MIME[ext] || 'application/octet-stream';
    if (/\.(js|css|html|json|svg|webmanifest)$/.test(ext) && st.size < 5e6) return sendC(req, res, cached(st.mtimeMs + ':' + st.size, f, () => fs.readFileSync(f)), type, ext === '.svg' ? 'max-age=86400' : 'no-cache');
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': /\.(jpg|jpeg|png|webp|gif)$/.test(ext) ? 'max-age=604800' : 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    fs.createReadStream(f).pipe(res);
  });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) {
    cors(req, res);
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    try { await api(req, res, url); } catch (e) { if (!res.headersSent) send(res, /JSON invalide|trop gros/.test(e.message) ? 400 : 500, { error: e.message }); }
  } else serveStatic(req, res, url);
}).listen(PORT, () => console.log('Serveur Bêta ' + VERSION + ' sur http://0.0.0.0:' + PORT + ' — application : ' + ROOT + ' — données : ' + DATA));

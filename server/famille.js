// Serveur Bêta 7.15 — famille et maison :
// - calendriers iCloud (lien public .ics ou identifiant Apple + mot de passe d'application, CalDAV)
// - colis : numéros de suivi trouvés dans les mails (IMAP) ou saisis, état La Poste/Colissimo/Chronopost (clé gratuite)
// - missions des enfants avec points et récompenses ; mode baby-sitter ; cadre photo (dossier du NAS ou Immich)
// - mode vacances en un bouton, résumé « pendant votre absence », bilan du mois
// - sonnette : photo de chaque visite, réponses rapides lues par la tablette de l'entrée ; recharge de la voiture au meilleur prix
'use strict';
const fs = require('fs'), path = require('path'), tls = require('tls'), net = require('net'), crypto = require('crypto');

module.exports = function famille(DATA, send, readBody, M) {
  const { HUB, NOTIFY, ENGINE, PLUS, EXTRA } = M, X = ENGINE.X, E = X.C, P = PLUS ? PLUS.C : null;
  const FILE = path.join(DATA, 'famille.json'), VIS = path.join(DATA, 'visits');
  fs.mkdirSync(VIS, { recursive: true });
  const DEF = {
    cals: [],              // { id, name, who, color, ics } ou { …, caldav: true }
    icloud: { user: '', pass: '' },
    mail: { on: false, imap: '', port: 993, user: '', pass: '', days: 14 }, laposte: '',
    parcels: [],           // { id, carrier, number, label, status, state ('transit'|'today'|'delivered'), at, src }
    chores: [], done: [], rewards: [], spent: [],
    sitter: { on: false, until: 0, name: '', rooms: [], contacts: [], notes: '', bedtime: '' },
    photos: { dir: '', immich: '', key: '', mode: 'random' },
    vac: { on: false, back: '', preheat: 12, prev: {}, restored: false, since: 0 },
    absence: { start: 0, items: [] }, lastSummary: null,
    stats: {},             // AAAA-MM → compteurs
    door: { tablet: '', replies: ['J’arrive !', 'Laissez le colis devant la porte, merci', 'Nous ne sommes pas disponibles'] },
    ev: { on: false, dev: '', hours: 4, ready: '07:00', avoidRed: true }
  };
  let C = {}; try { C = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { }
  Object.keys(DEF).forEach(k => { C[k] = DEF[k] && typeof DEF[k] === 'object' && !Array.isArray(DEF[k]) ? Object.assign({}, DEF[k], C[k]) : C[k] !== undefined ? C[k] : DEF[k]; });
  let pT = 0; const persist = () => { clearTimeout(pT); pT = setTimeout(() => fs.writeFile(FILE, JSON.stringify(C, null, 1), { mode: 0o600 }, () => { }), 300); };
  const uid = () => Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
  const ymd = X.ymd, ym = d => ymd(d || new Date()).slice(0, 7);
  const stat = (k, n) => { const m = C.stats[ym()] = C.stats[ym()] || {}; m[k] = (m[k] || 0) + (n || 1); persist(); };

  /* ======================= 1. calendriers (iCalendar / CalDAV iCloud) ======================= */
  const unfold = t => String(t).replace(/\r?\n[ \t]/g, '');
  const val = (ev, k) => { const m = ev.match(new RegExp('^' + k + '(;[^:\\n]*)?:(.*)$', 'm')); return m ? { p: m[1] || '', v: m[2].trim() } : null; };
  function icsDate(x) {
    if (!x) return null; const v = x.v, allDay = /VALUE=DATE(?!-)/.test(x.p) || /^\d{8}$/.test(v), m = v.match(/^(\d{4})(\d\d)(\d\d)(?:T(\d\d)(\d\d)(\d\d)?(Z)?)?/); if (!m) return null;
    const d = m[7] ? new Date(Date.UTC(+m[1], m[2] - 1, +m[3], +m[4] || 0, +m[5] || 0)) : new Date(+m[1], m[2] - 1, +m[3], +m[4] || 0, +m[5] || 0);   // TZID : heure locale (le NAS est à l'heure de Paris)
    return { d, allDay };
  }
  const txt = s => String(s || '').replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();
  function expand(ev, from, to) {   // occurrences d'un évènement (RRULE simple : quotidien, hebdo, mensuel, annuel)
    const s = icsDate(val(ev, 'DTSTART')); if (!s) return [];
    const e = icsDate(val(ev, 'DTEND')), dur = e ? +e.d - +s.d : s.allDay ? 864e5 : 36e5;
    const rr = (val(ev, 'RRULE') || {}).v, ex = (ev.match(/^EXDATE[^:]*:(.*)$/gm) || []).flatMap(l => l.split(':')[1].split(',')).map(v => (icsDate({ v, p: '' }) || {}).d).filter(Boolean).map(d => +d);
    const out = [], push = d => { if (+d + dur > from && +d < to && !ex.includes(+d)) out.push(d); };
    if (!rr) { push(s.d); return out.map(d => ({ d, allDay: s.allDay, dur })); }
    const R = Object.fromEntries(rr.split(';').map(x => x.split('='))), iv = +R.INTERVAL || 1, until = R.UNTIL ? (icsDate({ v: R.UNTIL, p: '' }) || {}).d : null, max = +R.COUNT || 1e4;
    const BD = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 }, days = R.BYDAY ? R.BYDAY.split(',').map(x => BD[x.slice(-2)]) : null;
    let n = 0, d = new Date(s.d);
    for (let i = 0; i < 3000 && n < max; i++) {
      if (until && d > until) break; if (+d > to) break;
      if (R.FREQ === 'WEEKLY' && days) {
        const wk = new Date(d); wk.setDate(d.getDate() - d.getDay());
        for (const dd of days.slice().sort()) { const x = new Date(wk); x.setDate(wk.getDate() + dd); x.setHours(s.d.getHours(), s.d.getMinutes(), 0, 0); if (x < s.d || (until && x > until) || n >= max) continue; n++; push(x); }
        d.setDate(d.getDate() + 7 * iv); continue;
      }
      n++; push(new Date(d));
      if (R.FREQ === 'DAILY') d.setDate(d.getDate() + iv); else if (R.FREQ === 'WEEKLY') d.setDate(d.getDate() + 7 * iv); else if (R.FREQ === 'MONTHLY') d.setMonth(d.getMonth() + iv); else if (R.FREQ === 'YEARLY') d.setFullYear(d.getFullYear() + iv); else break;
    }
    return out.map(x => ({ d: x, allDay: s.allDay, dur }));
  }
  function parseIcs(text, cal, from, to) {
    const out = [];
    unfold(text).split('BEGIN:VEVENT').slice(1).forEach(raw => {
      const ev = raw.split('END:VEVENT')[0], title = txt((val(ev, 'SUMMARY') || {}).v) || 'Évènement', id = (val(ev, 'UID') || {}).v || title;
      if (/^RECURRENCE-ID/m.test(ev)) return;   // exceptions d'une série : ignorées (la série suffit pour l'affichage)
      expand(ev, from, to).forEach(o => out.push({ id: 'ic:' + cal.id + ':' + id + ':' + +o.d, date: ymd(o.d), time: o.allDay ? '' : X.hm(o.d), dur: Math.round(o.dur / 6e4), title, where: txt((val(ev, 'LOCATION') || {}).v), cal: cal.name, who: cal.who || '', color: cal.color || '' }));
    });
    return out;
  }
  // CalDAV d'iCloud : principal → dossier des calendriers → évènements de la période
  const dav = async (url, method, body, depth) => { const r = await fetch(url, { method, headers: { Authorization: 'Basic ' + Buffer.from(C.icloud.user + ':' + C.icloud.pass).toString('base64'), Depth: String(depth == null ? 0 : depth), 'Content-Type': 'application/xml; charset=utf-8' }, body, signal: AbortSignal.timeout(20000) }); if (r.status === 401) throw new Error('identifiant Apple ou mot de passe d’application refusé'); if (r.status >= 400) throw new Error('iCloud : HTTP ' + r.status); return { text: await r.text(), url: r.url }; };
  const href = (xml, tag) => { const m = xml.match(new RegExp('<[^>]*' + tag + '[^>]*>\\s*<[^>]*href[^>]*>([^<]+)<', 'i')); return m && m[1].trim(); };
  async function icloudCals() {
    const root = process.env.ICLOUD_CALDAV || 'https://caldav.icloud.com';
    const p1 = await dav(root + '/', 'PROPFIND', '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>');
    const pr = href(p1.text, 'current-user-principal'); if (!pr) throw new Error('compte iCloud introuvable');
    const base = new URL(p1.url).origin, p2 = await dav(new URL(pr, base).href, 'PROPFIND', '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>');
    const home = href(p2.text, 'calendar-home-set'); if (!home) throw new Error('calendriers iCloud introuvables');
    const homeUrl = new URL(home, new URL(p2.url).origin).href, p3 = await dav(homeUrl, 'PROPFIND', '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:a="http://apple.com/ns/ical/"><d:prop><d:displayname/><d:resourcetype/><a:calendar-color/></d:prop></d:propfind>', 1);
    return p3.text.split(/<[^>]*:?response>/i).filter(x => /calendar[\s/>]/i.test(x.match(/<[^>]*resourcetype[^>]*>([\s\S]*?)<\/[^>]*resourcetype>/i) ? RegExp.$1 : '') && /href/i.test(x)).map(x => ({ url: new URL((x.match(/<[^>]*href[^>]*>([^<]+)</i) || [])[1], homeUrl).href, name: ((x.match(/<[^>]*displayname[^>]*>([^<]*)</i) || [])[1] || 'Calendrier').trim(), color: ((x.match(/<[^>]*calendar-color[^>]*>(#[0-9a-f]{6})/i) || [])[1] || '') }));
  }
  const stamp = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  let calCache = { at: 0, list: [], err: {} };
  async function events(days) {
    if (Date.now() - calCache.at < 10 * 6e4) return calCache;
    const from = new Date(); from.setHours(0, 0, 0, 0); const to = new Date(+from + (days || 31) * 864e5), out = [], err = {};
    for (const c of C.cals) {
      try {
        if (c.caldav) {
          const r = await dav(c.url, 'REPORT', '<?xml version="1.0"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="' + stamp(from) + '" end="' + stamp(to) + '"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>', 1);
          const datas = (r.text.match(/<[^>]*calendar-data[^>]*>([\s\S]*?)<\/[^>]*calendar-data>/gi) || []).map(x => x.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&#13;/g, ''));
          datas.forEach(t => out.push(...parseIcs(t, c, +from, +to)));
        } else if (c.ics) {
          const r = await fetch(c.ics.replace(/^webcal:/i, 'https:'), { signal: AbortSignal.timeout(20000) }); if (!r.ok) throw new Error('HTTP ' + r.status);
          out.push(...parseIcs(await r.text(), c, +from, +to));
        }
      } catch (e) { err[c.id] = e.message; }
    }
    calCache = { at: Date.now(), list: out.sort((a, b) => (a.date + a.time) < (b.date + b.time) ? -1 : 1), err }; return calCache;
  }

  /* ======================= 2. colis ======================= */
  const CARRIERS = [
    ['UPS', /\b1Z[0-9A-Z]{16}\b/g, n => 'https://www.ups.com/track?loc=fr_FR&tracknum=' + n],
    ['Amazon', /\bTBA\d{12}\b/g, () => 'https://www.amazon.fr/gp/your-account/order-history'],
    ['Colissimo', /\b\d[A-Z]\d{11}\b/g, n => 'https://www.laposte.fr/outils/suivre-vos-envois?code=' + n],
    ['Chronopost', /\b[A-Z]{2}\d{9}FR\b/g, n => 'https://www.chronopost.fr/tracking-no-cms/suivi-page?listeNumerosLT=' + n],
    ['La Poste', /\b[A-Z]{2}\d{9}[A-Z]{2}\b/g, n => 'https://www.laposte.fr/outils/suivre-vos-envois?code=' + n],
    ['DHL', /(?<=DHL[\s\S]{0,300})\b(?:JJD\d{16,20}|\d{10})\b/g, n => 'https://www.dhl.com/fr-fr/home/suivi.html?tracking-id=' + n],
    ['Mondial Relay', /(?<=Mondial Relay[\s\S]{0,300})\b\d{8}\b/gi, n => 'https://www.mondialrelay.fr/suivi-de-colis/?numeroExpedition=' + n],
    ['GLS', /(?<=GLS[\s\S]{0,300})\b\d{11,12}\b/g, n => 'https://gls-group.com/FR/fr/suivi-colis?match=' + n],
    ['DPD', /(?<=DPD[\s\S]{0,300})\b\d{14}\b/g, n => 'https://trace.dpd.fr/fr/trace/' + n]
  ];
  const trackUrl = p => ((CARRIERS.find(c => c[0] === p.carrier) || [])[2] || (() => ''))(p.number);
  const stateOf = s => /sera livr|livraison prévue|à livrer|will be delivered/i.test(s) ? (/aujourd/i.test(s) ? 'today' : 'transit') : /\b(a été |est )?livr[ée]e?s?(?![a-zé])|distribué|delivered|remis au destinataire|déposé dans (votre )?boîte/i.test(s) ? 'delivered' : /aujourd.?hui|en cours de livraison|out for delivery|en livraison|arrive aujourd/i.test(s) ? 'today' : 'transit';
  function addParcel(o) {
    const n = String(o.number || '').toUpperCase().replace(/\s/g, ''); if (!n) return null;
    let p = C.parcels.find(x => x.number === n);
    if (!p) { p = { id: uid(), carrier: o.carrier || 'Colis', number: n, label: o.label || '', status: '', state: 'transit', at: Date.now(), src: o.src || 'manuel' }; C.parcels.unshift(p); C.parcels.length = Math.min(C.parcels.length, 60); }
    if (o.label && !p.label) p.label = o.label;
    if (o.status) { const st = stateOf(o.status); if (st === 'delivered' || p.state !== 'delivered') { if (st !== p.state && st === 'delivered') { stat('parcels'); absenceAdd('📦 Colis livré : ' + (p.label || p.carrier)); } p.state = st; p.status = o.status; p.upd = Date.now(); } }
    persist(); return p;
  }
  // IMAP minimal (lecture seule) : derniers mails, objet + début du texte
  function imapFetch(o) {
    return new Promise((done, fail) => {
      const port = +o.port || 993, sock = port === 143 ? net.connect(port, o.imap) : tls.connect({ host: o.imap, port, servername: o.imap, rejectUnauthorized: !o.insecure });
      let buf = Buffer.alloc(0), tag = 0, step = 0, ids = [], msgs = [], cur = -1; const q = s => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
      const cmd = c => { tag++; sock.write('a' + tag + ' ' + c + '\r\n'); };
      const end = (e, r) => { try { sock.end(); } catch (x) { } e ? fail(e) : done(r); };
      sock.setTimeout(30000, () => end(new Error('délai dépassé')));
      sock.on('error', e => end(e));
      sock.on('data', d => {
        buf = Buffer.concat([buf, d]); const s = buf.toString('latin1');
        if (step === 0 && /^\* (OK|PREAUTH)/m.test(s)) { step = 1; buf = Buffer.alloc(0); return cmd('LOGIN ' + q(o.user) + ' ' + q(o.pass)); }
        if (!new RegExp('^a' + tag + ' (OK|NO|BAD)', 'm').test(s)) return;
        if (!new RegExp('^a' + tag + ' OK', 'm').test(s)) return end(new Error(step === 1 ? 'identifiants mail refusés' : 'IMAP : ' + (s.match(new RegExp('^a' + tag + ' \\w+ (.*)$', 'm')) || [])[1]));
        if (step === 1) { step = 2; buf = Buffer.alloc(0); return cmd('EXAMINE INBOX'); }
        if (step === 2) { step = 3; buf = Buffer.alloc(0); const d0 = new Date(Date.now() - (o.days || 14) * 864e5); return cmd('SEARCH SINCE ' + d0.getDate() + '-' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d0.getMonth()] + '-' + d0.getFullYear()); }
        if (step === 3) { ids = ((s.match(/^\* SEARCH ([\d ]*)/m) || [])[1] || '').trim().split(/\s+/).filter(Boolean).slice(-60); buf = Buffer.alloc(0); if (!ids.length) return end(null, []); step = 4; return cmd('FETCH ' + ids.join(',') + ' (BODY.PEEK[HEADER.FIELDS (SUBJECT FROM DATE)] BODY.PEEK[TEXT]<0.40000>)'); }
        if (step === 4) { step = 5; const raw = buf.toString('utf8'); buf = Buffer.alloc(0); cmd('LOGOUT'); return end(null, raw.split(/^\* \d+ FETCH /m).slice(1)); }
      });
    });
  }
  const decQP = s => s.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (m, h) => String.fromCharCode(parseInt(h, 16)));
  const decWord = s => s.replace(/=\?([^?]+)\?([BQ])\?([^?]*)\?=/gi, (m, cs, e, t) => { try { return e.toUpperCase() === 'B' ? Buffer.from(t, 'base64').toString('utf8') : Buffer.from(decQP(t.replace(/_/g, ' ')), 'latin1').toString('utf8'); } catch (x) { return t; } });
  function mailText(raw) {
    let body = raw.replace(/<[^>]+>/g, ' ');
    body = body.replace(/Content-Transfer-Encoding:\s*base64\s*\r?\n(?:[^\r\n]+\r?\n)*?\r?\n([A-Za-z0-9+/=\r\n]{40,})/gi, (m, b) => { try { return Buffer.from(b.replace(/\s/g, ''), 'base64').toString('utf8').replace(/<[^>]+>/g, ' '); } catch (e) { return ''; } });
    return decQP(body).replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
  }
  let mailState = { at: 0, err: '', n: 0 };
  async function scanMail() {
    const o = C.mail; if (!o.on || !o.imap || !o.user) return;
    try {
      const list = await imapFetch(o); let n = 0;
      for (const raw of list) {
        const subj = decWord((raw.match(/^Subject:\s*(.*(?:\r?\n[ \t].*)*)/mi) || [])[1] || '').replace(/\r?\n[ \t]/g, ' ').trim(), from = decWord((raw.match(/^From:\s*(.*)/mi) || [])[1] || '').replace(/<.*>/, '').replace(/"/g, '').trim();
        if (!/colis|livraison|expédi|envoi|commande|suivi|tracking|delivery|chronopost|colissimo|dhl|ups|gls|dpd|mondial relay|amazon/i.test(subj + ' ' + from)) continue;
        const text = subj + ' ' + mailText(raw);
        for (const [name, re] of CARRIERS) { const m = text.match(re); if (m) { [...new Set(m)].slice(0, 3).forEach(num => { addParcel({ carrier: name, number: num, label: from || subj.slice(0, 50), status: subj, src: 'mail' }); n++; }); break; } }
        if (/amazon/i.test(from) && /arrive aujourd|livr[ée]|en cours de livraison/i.test(subj) && !CARRIERS.some(c => text.match(c[1]))) addParcel({ carrier: 'Amazon', number: 'AMZ-' + crypto.createHash('md5').update(subj).digest('hex').slice(0, 8), label: subj.slice(0, 60), status: subj, src: 'mail' });
      }
      mailState = { at: Date.now(), err: '', n };
    } catch (e) { mailState = { at: Date.now(), err: e.message, n: 0 }; }
  }
  async function laposte(p) {
    if (!C.laposte || !/Colissimo|La Poste|Chronopost/.test(p.carrier) || p.state === 'delivered') return;
    try {
      const r = await fetch('https://api.laposte.fr/suivi/v2/idships/' + encodeURIComponent(p.number) + '?lang=fr_FR', { headers: { 'X-Okapi-Key': C.laposte, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
      const j = await r.json(), sh = j.shipment || {}, ev = (sh.event || [])[0];
      if (ev) addParcel({ number: p.number, status: ev.label + (sh.isFinal ? ' (livré)' : '') });
      if (sh.deliveryDate) { p.eta = sh.deliveryDate; persist(); }
    } catch (e) { }
  }
  setInterval(() => { scanMail().catch(() => { }); C.parcels.filter(p => p.state !== 'delivered').slice(0, 15).forEach(laposte); C.parcels = C.parcels.filter(p => p.state !== 'delivered' || Date.now() - (p.upd || p.at) < 7 * 864e5); }, 30 * 6e4);
  setTimeout(() => scanMail().catch(() => { }), 30000);

  /* ======================= 3. missions des enfants ======================= */
  const choreDue = (c, d) => !c.days || !c.days.length || c.days.includes(d.getDay());
  function points(who) { return C.done.filter(x => x.who === who && x.ok !== false).reduce((s, x) => s + (+x.pts || 0), 0) - C.spent.filter(x => x.who === who).reduce((s, x) => s + (+x.cost || 0), 0); }

  /* ======================= 5. photos (dossier du NAS ou Immich) ======================= */
  const PDIR = () => C.photos.dir || process.env.PHOTO_DIR || '';
  let pIndex = { at: 0, list: [] };
  function exifDate(f) {   // date de prise de vue (EXIF DateTimeOriginal) en lisant le début du JPEG
    try { const fd = fs.openSync(f, 'r'), b = Buffer.alloc(65536), n = fs.readSync(fd, b, 0, 65536, 0); fs.closeSync(fd); const s = b.subarray(0, n).toString('latin1'), m = s.match(/(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)/); return m ? new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5]) : null; } catch (e) { return null; }
  }
  function indexPhotos() {
    const root = PDIR(); if (!root || !fs.existsSync(root)) { pIndex = { at: Date.now(), list: [] }; return; }
    const list = [], walk = (d, depth) => { if (depth > 6 || list.length > 20000) return; let es = []; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; } for (const e of es) { if (e.name.startsWith('.') || e.name.startsWith('@')) continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p, depth + 1); else if (/\.(jpe?g|png|webp)$/i.test(e.name)) list.push(p); } };
    walk(root, 0);
    pIndex = { at: Date.now(), list: list.map(p => { let t = null; if (/\.jpe?g$/i.test(p)) t = exifDate(p); if (!t) { try { t = fs.statSync(p).mtime; } catch (e) { } } return { id: crypto.createHash('md5').update(p).digest('hex').slice(0, 16), p, t: t ? +t : 0 }; }) };
  }
  setTimeout(indexPhotos, 8000); setInterval(indexPhotos, 12 * 36e5);
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[a[i], a[j]] = [a[j], a[i]]; } return a; };
  async function photoList(mode, n) {
    n = Math.min(+n || 30, 100);
    if (C.photos.immich && C.photos.key) {
      const base = C.photos.immich.replace(/\/+$/, ''), H = { 'x-api-key': C.photos.key, 'Content-Type': 'application/json', Accept: 'application/json' };
      if (mode === 'memories') {
        const out = [], now = new Date();
        for (let y = 1; y <= 10 && out.length < n; y++) { const a = new Date(now.getFullYear() - y, now.getMonth(), now.getDate() - 1), b = new Date(now.getFullYear() - y, now.getMonth(), now.getDate() + 2); try { const r = await (await fetch(base + '/api/search/metadata', { method: 'POST', headers: H, body: JSON.stringify({ takenAfter: a.toISOString(), takenBefore: b.toISOString(), type: 'IMAGE', size: 20 }), signal: AbortSignal.timeout(15000) })).json(); ((r.assets || {}).items || []).forEach(x => out.push({ id: 'im:' + x.id, t: Date.parse(x.fileCreatedAt), y })); } catch (e) { } }
        if (out.length) return shuffle(out).slice(0, n);
      }
      const r = await (await fetch(base + '/api/search/random', { method: 'POST', headers: H, body: JSON.stringify({ size: n, type: 'IMAGE' }), signal: AbortSignal.timeout(15000) })).json();
      return (Array.isArray(r) ? r : []).map(x => ({ id: 'im:' + x.id, t: Date.parse(x.fileCreatedAt) }));
    }
    if (!pIndex.list.length) return [];
    if (mode === 'memories') { const now = new Date(), md = d => (d.getMonth() + 1) * 100 + d.getDate(), k = md(now); const l = pIndex.list.filter(x => x.t && Math.abs(md(new Date(x.t)) - k) <= 2 && new Date(x.t).getFullYear() < now.getFullYear()); if (l.length) return shuffle(l.slice()).slice(0, n).map(x => ({ id: x.id, t: x.t, y: now.getFullYear() - new Date(x.t).getFullYear() })); }
    return shuffle(pIndex.list.slice()).slice(0, n).map(x => ({ id: x.id, t: x.t }));
  }

  /* ======================= 6. mode vacances ======================= */
  async function vacation(on, back) {
    const v = C.vac;
    if (on) {
      v.on = true; v.back = back || ''; v.since = Date.now(); v.restored = false; v.prev = {};
      if (P) { (P.heat.zones || []).forEach(z => { v.prev[z.id] = z.mode || 'auto'; z.mode = 'frost'; }); P.sim.mode = P.sim.mode === 'off' ? 'away' : P.sim.mode; }
      NOTIFY.setAway(true, 'mode vacances', 'vacances');
      if (E.alarm && E.alarm.on) X.setAlarm('armed_away', 'mode vacances', true);
      X.note('Mode vacances activé' + (back ? ' jusqu’au ' + new Date(back).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) : ''), 'walk');
    } else {
      restoreHeat(); v.on = false; X.note('Mode vacances terminé', 'homeFill'); persist();
      if (NOTIFY.isAway()) NOTIFY.setAway(false, 'retour de vacances', 'vacances');   // déclenche le résumé « pendant votre absence »
    }
    persist();
  }
  function restoreHeat() { if (!P || C.vac.restored) return; (P.heat.zones || []).forEach(z => { if (C.vac.prev[z.id]) z.mode = C.vac.prev[z.id]; }); C.vac.restored = true; X.note('Chauffage relancé pour le retour', 'flame'); persist(); }
  function vacTick() {
    const v = C.vac; if (!v.on || !v.back) return;
    if (!v.restored && Date.now() >= Date.parse(v.back) - (+v.preheat || 12) * 36e5) { restoreHeat(); NOTIFY.notifyRule('away', { title: 'Retour de vacances', message: 'Le chauffage est relancé : la maison sera chaude à votre arrivée.', go: 'chauffage', tags: ['fire'] }); }
  }

  /* ======================= 7. pendant votre absence ======================= */
  function absenceAdd(t) { if (NOTIFY.isAway()) { C.absence.items.push({ t: Date.now(), txt: t }); if (C.absence.items.length > 300) C.absence.items.shift(); persist(); } }
  NOTIFY.hooks.away.push(on => {
    if (on) { C.absence = { start: Date.now(), items: [] }; persist(); return; }
    const a = C.absence; if (!a.start) return;
    const it = a.items, cnt = re => it.filter(x => re.test(x.txt)).length, hrs = Math.round((Date.now() - a.start) / 36e5);
    let kwh = null, eur = null; try { if (PLUS) { const e = PLUS.energy(Math.min(31, Math.ceil((Date.now() - a.start) / 864e5) + 1)); const since = ymd(new Date(a.start)); const d = e.days.filter(x => x.date >= since); kwh = d.reduce((s, x) => s + x.kwh, 0); eur = d.reduce((s, x) => s + x.eur, 0); } } catch (e) { }
    const sum = { start: a.start, end: Date.now(), hours: hrs, rings: cnt(/^🔔/), people: cnt(/^🚶/), cars: cnt(/^🚗/), opens: cnt(/^🚪/), alarms: cnt(/^🚨/), parcels: cnt(/^📦/), outages: cnt(/^🌐/), kwh, eur, items: it.slice(-60) };
    C.lastSummary = sum; C.absence = { start: 0, items: [] }; if (C.vac.on) vacation(false); persist();
    X.emit({ type: 'absence', summary: sum });
    const parts = [sum.rings && sum.rings + ' coup(s) de sonnette', sum.parcels && sum.parcels + ' colis', sum.people && sum.people + ' passage(s) détecté(s)', sum.alarms && sum.alarms + ' alarme(s)', sum.outages && sum.outages + ' coupure(s) internet', eur != null && kwh > 0 ? kwh.toFixed(1).replace('.', ',') + ' kWh (' + eur.toFixed(2).replace('.', ',') + ' €)' : ''].filter(Boolean);
    NOTIFY.notifyRule('away', { title: 'Bon retour à la maison', message: (hrs >= 1 ? 'Pendant ces ' + (hrs >= 48 ? Math.round(hrs / 24) + ' jours' : hrs + ' h') + ' : ' : '') + (parts.join(', ') || 'rien à signaler.'), go: 'securite', tags: ['house'] });
  });
  X.EXT.listen.push(ev => {
    if (ev.type === 'doorbell') { stat('rings'); absenceAdd('🔔 On a sonné'); }
    if (ev.type === 'detect') { stat('detect'); if (ev.label === 'person') absenceAdd('🚶 Personne vue : ' + ev.cam); if (ev.label === 'car') absenceAdd('🚗 Voiture vue : ' + ev.cam); }
    if (ev.type === 'alarm' && ev.status === 'triggered') { stat('alarms'); absenceAdd('🚨 Alarme déclenchée'); }
    if (ev.type === 'device' && ev.cur && ev.prev && !ev.prev.on && ev.cur.on && ['door', 'motion'].includes((E.devices[ev.dev] || {}).kind)) absenceAdd(((E.devices[ev.dev] || {}).kind === 'door' ? '🚪 Ouverture : ' : '🚶 Mouvement : ') + ((E.devices[ev.dev] || {}).name || ''));
    if (ev.type === 'presence' && ev.ev === 'arrive') stat('arrivals');
  });
  NOTIFY.hooks.ring.push(() => { ring().catch(() => { }); });

  /* ======================= 9. sonnette : visites et réponses ======================= */
  async function ring() {
    const img = await NOTIFY.snapshot().catch(() => null), id = Date.now().toString(36);
    if (img && img.length > 500) fs.writeFileSync(path.join(VIS, id + '.jpg'), img);
    try { const l = fs.readdirSync(VIS).filter(n => n.endsWith('.jpg')).sort(); l.slice(0, Math.max(0, l.length - 200)).forEach(n => fs.unlinkSync(path.join(VIS, n))); } catch (e) { }
    X.emit({ type: 'ring', visit: img ? id : '', replies: C.door.replies });
  }
  const visits = () => { try { return fs.readdirSync(VIS).filter(n => n.endsWith('.jpg')).sort().reverse().slice(0, 60).map(n => ({ id: n.slice(0, -4), t: parseInt(n, 36) })); } catch (e) { return []; } };

  /* ======================= 8. bilan du mois ======================= */
  function report(month) {
    const m = month || ym(), [y, mo] = m.split('-').map(Number), prevM = ym(new Date(y, mo - 2, 15)), st = C.stats[m] || {}, sp = C.stats[prevM] || {};
    let en = null, enP = null; try { if (PLUS) { const e = PLUS.energy(70), f = k => e.days.filter(x => x.date.startsWith(k)).reduce((a, x) => ({ kwh: a.kwh + x.kwh, eur: a.eur + x.eur }), { kwh: 0, eur: 0 }); en = f(m); enP = f(prevM); } } catch (e) { }
    const tempo = P ? Object.keys(P.tempoDays || {}).filter(k => k.startsWith(m)).reduce((a, k) => { a[P.tempoDays[k]] = (a[P.tempoDays[k]] || 0) + 1; return a; }, {}) : {};
    const outs = EXTRA ? (EXTRA._test.C.net.outages || []).filter(o => ym(new Date(o.start)) === m) : [];
    return { month: m, prev: prevM, energy: en, energyPrev: enP, tempo, outages: outs.length, outageMin: outs.reduce((s, o) => s + Math.round(((o.end || Date.now()) - o.start) / 6e4), 0), rings: st.rings || 0, ringsPrev: sp.rings || 0, alarms: st.alarms || 0, detect: st.detect || 0, parcels: st.parcels || 0, chores: C.done.filter(x => ym(new Date(x.at)) === m).length, rules: st.rules || 0 };
  }

  /* ======================= 12. recharge de la voiture au meilleur moment ======================= */
  function priceAt(ts) {
    const T = P ? P.tariff : { mode: 'base', base: 0.2 }, t = X.hm(new Date(ts)), inS = (a, b) => a <= b ? t >= a && t < b : t >= a || t < b;
    if (T.mode === 'base') return +T.base; if (T.mode === 'hphc') return inS(T.hcFrom, T.hcTo) ? +T.hc : +T.hp;
    const day = ymd(new Date(ts - 6 * 36e5)), tp = X.S.tempo || {}, col = (P.tempoDays || {})[day] || (day === ymd(new Date(Date.now() - 6 * 36e5)) ? tp.today : day === ymd(new Date(Date.now() + 18 * 36e5)) ? tp.tomorrow : '') || 'blanc';   // inconnu : on suppose blanc
    const p = T.tempo[col] || T.tempo.blanc; return inS('22:00', '06:00') ? +p[0] : +p[1];
  }
  let evPlan = { slots: [], at: 0 };
  function planEV(now) {
    const v = C.ev, ready = new Date(now); ready.setHours(+v.ready.slice(0, 2), +v.ready.slice(3, 5), 0, 0); if (ready <= now) ready.setDate(ready.getDate() + 1);
    const h0 = Math.floor(+now / 36e5) * 36e5, slots = [];
    for (let t = h0; t + 36e5 <= +ready + 1; t += 36e5) { const p = priceAt(t + 18e5), red = v.avoidRed && P && P.tariff.mode === 'tempo' && p >= 0.5; slots.push({ t, p, red }); }
    const need = Math.min(slots.length, Math.ceil(+v.hours || 4)), pick = slots.filter(s => !s.red).sort((a, b) => a.p - b.p || a.t - b.t).slice(0, need).map(s => s.t);
    evPlan = { at: Date.now(), ready: +ready, slots: slots.map(s => ({ t: s.t, p: s.p, on: pick.includes(s.t) })), cost: slots.filter(s => pick.includes(s.t)).reduce((a, s) => a + s.p, 0) };
  }
  let evLast = null;
  function evTick(now) {
    const v = C.ev; if (!v.on || !v.dev || !E.devices[v.dev]) return;
    if (!evPlan.at || now.getMinutes() === 0 || Date.now() - evPlan.at > 36e5) planEV(now);
    const h = Math.floor(+now / 36e5) * 36e5, s = evPlan.slots.find(x => x.t === h), on = !!(s && s.on);
    if (evLast === on) return; evLast = on;
    X.command(v.dev, { on }).then(() => X.note('Recharge ' + (on ? 'lancée (heure la moins chère)' : 'en pause'), 'charger')).catch(() => { });
  }

  /* ======================= boucle ======================= */
  X.EXT.tick.push(({ now, t, minute }) => {
    if (!minute) return;
    vacTick(); evTick(now);
    if (C.sitter.on && C.sitter.until && Date.now() > C.sitter.until) { C.sitter.on = false; persist(); X.emit({ type: 'sitter', on: false }); }
    if (t === '10:05' && now.getDate() === 1) { const r = report(ym(new Date(Date.now() - 2 * 864e5))); NOTIFY.notifyRule('reminder', { title: 'Bilan de ' + new Date(r.month + '-15').toLocaleDateString('fr-FR', { month: 'long' }), message: [r.energy && r.energy.kwh ? '⚡ ' + r.energy.eur.toFixed(2).replace('.', ',') + ' € (' + Math.round(r.energy.kwh) + ' kWh)' + (r.energyPrev && r.energyPrev.eur ? ', ' + (r.energy.eur >= r.energyPrev.eur ? '+' : '') + Math.round((r.energy.eur / r.energyPrev.eur - 1) * 100) + ' %' : '') : '', r.tempo.rouge ? '🔴 ' + r.tempo.rouge + ' jour(s) rouge(s)' : '', r.outages ? '🌐 ' + r.outages + ' coupure(s) internet' : '', '🔔 ' + r.rings + ' coup(s) de sonnette', r.parcels ? '📦 ' + r.parcels + ' colis' : ''].filter(Boolean).join('\n'), go: 'bilan', tags: ['bar_chart'] }); }
  });
  // compteur des règles déclenchées (bilan)
  const nt0 = X.note; X.note = (txt, icon) => { if (icon === 'sparkle' && !/^Routine|^Scène/.test(txt)) stat('rules'); return nt0(txt, icon); };
  // coupures internet pendant l'absence
  if (EXTRA) setInterval(() => { const l = EXTRA._test.C.net.outages || []; if (l.length && l[0].start > Date.now() - 6.5e4 && !l[0].end) absenceAdd('🌐 Internet coupé'); }, 6e4);

  /* ======================= API ======================= */
  const mask = v => v ? '••••' : '';
  const view = () => Object.assign({}, C, { icloud: { user: C.icloud.user, pass: mask(C.icloud.pass) }, mail: Object.assign({}, C.mail, { pass: mask(C.mail.pass) }), laposte: mask(C.laposte), photos: Object.assign({}, C.photos, { key: mask(C.photos.key) }), absence: undefined, stats: undefined, done: C.done.slice(-200) });
  async function api(req, res, url, w) {
    const p = url.pathname, m = req.method, q = k => url.searchParams.get(k) || '';
    if (p === '/api/famille' && m === 'GET') return send(res, 200, Object.assign(view(), { state: { points: Object.fromEntries([...new Set(C.chores.map(c => c.who))].map(u => [u, points(u)])), mail: mailState, photos: { count: pIndex.list.length, dir: PDIR() }, ev: evPlan, visits: visits().slice(0, 12) } }));
    if (p === '/api/famille' && m === 'PUT') {
      const b = await readBody(req) || {};
      ['cals', 'chores', 'rewards', 'parcels'].forEach(k => { if (Array.isArray(b[k])) C[k] = b[k]; });
      [['icloud', ['pass']], ['mail', ['pass']], ['photos', ['key']], ['sitter', []], ['door', []], ['ev', []], ['vac', []]].forEach(([k, sec]) => { if (b[k] && typeof b[k] === 'object') { const old = {}; sec.forEach(s => { old[s] = C[k][s]; }); Object.assign(C[k], b[k]); sec.forEach(s => { if (b[k][s] === '••••' || b[k][s] == null) C[k][s] = old[s]; }); } });
      if (b.laposte !== undefined && b.laposte !== '••••') C.laposte = String(b.laposte).trim();
      if (b.cals || b.icloud) calCache.at = 0; if (b.photos) setTimeout(indexPhotos, 100); if (b.ev) evPlan.at = 0; if (b.sitter) X.emit({ type: 'sitter', on: !!C.sitter.on });
      persist(); return send(res, 200, view());
    }
    if (p === '/api/famille/events' && m === 'GET') return send(res, 200, await events(+q('days') || 31));
    if (p === '/api/famille/icloud/calendars' && m === 'GET') { try { return send(res, 200, await icloudCals()); } catch (e) { return send(res, 400, { error: e.message }); } }
    if (p === '/api/famille/parcels' && m === 'GET') return send(res, 200, { list: C.parcels.map(x => Object.assign({ url: trackUrl(x) }, x)), mail: mailState });
    if (p === '/api/famille/parcels' && m === 'POST') { const b = await readBody(req) || {}; if (b.del) { C.parcels = C.parcels.filter(x => x.id !== b.del); persist(); } else if (b.scan) { await scanMail(); } else if (b.delivered) { const x = C.parcels.find(y => y.id === b.delivered); if (x) { x.state = 'delivered'; x.upd = Date.now(); persist(); } } else { const n = String(b.number || '').toUpperCase().replace(/\s/g, ''), car = (CARRIERS.find(c => { c[1].lastIndex = 0; return new RegExp(c[1].source).test(n); }) || ['Colis'])[0]; const x = addParcel({ number: n, carrier: b.carrier || car, label: b.label, src: 'manuel' }); if (x) await laposte(x); } return send(res, 200, { list: C.parcels.map(x => Object.assign({ url: trackUrl(x) }, x)), mail: mailState }); }
    if (p === '/api/famille/mail/test' && m === 'POST') { try { const l = await imapFetch(Object.assign({}, C.mail, { days: 3 })); return send(res, 200, { ok: true, n: l.length }); } catch (e) { return send(res, 200, { ok: false, error: e.message }); } }
    if (p === '/api/famille/chore' && m === 'POST') {
      const b = await readBody(req) || {};
      if (b.done) { const c = C.chores.find(x => x.id === b.done); if (!c) return send(res, 404, { error: 'mission inconnue' }); const day = ymd(new Date()); const ex = C.done.find(x => x.chore === c.id && x.day === day && x.who === c.who); if (ex) C.done = C.done.filter(x => x !== ex); else C.done.push({ chore: c.id, who: c.who, day, at: Date.now(), pts: +c.points || 1, name: c.name }); }
      if (b.reward) { const r = C.rewards.find(x => x.id === b.reward); if (!r) return send(res, 404, { error: 'récompense inconnue' }); if (points(b.who) < +r.cost) return send(res, 400, { error: 'pas assez de points' }); C.spent.push({ who: b.who, reward: r.id, name: r.name, cost: +r.cost, at: Date.now() }); X.note('🎁 ' + b.who + ' : ' + r.name, 'heart'); NOTIFY.notifyRule('reminder', { title: 'Récompense demandée', message: b.who + ' échange ' + r.cost + ' points contre « ' + r.name + ' »', go: 'missions', tags: ['gift'] }); }
      C.done = C.done.filter(x => Date.now() - x.at < 120 * 864e5); persist();
      return send(res, 200, { done: C.done.slice(-200), spent: C.spent.slice(-50), points: Object.fromEntries([...new Set(C.chores.map(c => c.who))].map(u => [u, points(u)])) });
    }
    if (p === '/api/photos' && m === 'GET') { try { return send(res, 200, await photoList(q('mode'), q('n'))); } catch (e) { return send(res, 502, { error: e.message }); } }
    if (p === '/api/photos/file' && m === 'GET') {
      const id = q('id');
      if (id.startsWith('im:')) { try { const r = await fetch(C.photos.immich.replace(/\/+$/, '') + '/api/assets/' + encodeURIComponent(id.slice(3)) + '/thumbnail?size=preview', { headers: { 'x-api-key': C.photos.key }, signal: AbortSignal.timeout(20000) }); if (!r.ok) throw new Error('Immich : HTTP ' + r.status); res.writeHead(200, { 'Content-Type': r.headers.get('content-type') || 'image/jpeg', 'Cache-Control': 'max-age=86400' }); return res.end(Buffer.from(await r.arrayBuffer())); } catch (e) { return send(res, 502, { error: e.message }); } }
      const f = pIndex.list.find(x => x.id === id); if (!f) return send(res, 404, { error: 'photo inconnue' });
      res.writeHead(200, { 'Content-Type': /\.png$/i.test(f.p) ? 'image/png' : /\.webp$/i.test(f.p) ? 'image/webp' : 'image/jpeg', 'Cache-Control': 'max-age=86400' }); return fs.createReadStream(f.p).pipe(res);
    }
    if (p === '/api/famille/vacances' && m === 'POST') { const b = await readBody(req) || {}; if (b.preheat) C.vac.preheat = +b.preheat; await vacation(!!b.on, b.back); return send(res, 200, C.vac); }
    if (p === '/api/famille/absence' && m === 'GET') return send(res, 200, { current: C.absence.start ? C.absence : null, last: C.lastSummary });
    if (p === '/api/famille/bilan' && m === 'GET') return send(res, 200, report(q('month')));
    if (p === '/api/famille/visits' && m === 'GET') return send(res, 200, visits());
    if ((p === '/api/famille/visit') && m === 'GET') { const id = q('id').replace(/[^\w]/g, ''), f = path.join(VIS, id + '.jpg'); if (!fs.existsSync(f)) return send(res, 404, { error: 'photo inconnue' }); res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'max-age=86400' }); return fs.createReadStream(f).pipe(res); }
    if (p === '/api/famille/door/reply' && m === 'POST') { const b = await readBody(req) || {}, text = String(b.text || '').slice(0, 200); if (!C.door.tablet) return send(res, 400, { error: 'choisissez la tablette de l’entrée (Outils › Sonnette)' }); await HUB.command('fully', C.door.tablet, { on: true, say: text }).catch(e => { throw e; }); X.note('Réponse à la porte : « ' + text + ' »', 'bellFill'); return send(res, 200, { ok: true }); }
    if (p === '/api/famille/sitter' && m === 'POST') { const b = await readBody(req) || {}; Object.assign(C.sitter, b, { on: !!b.on }); if (b.on && b.hours) C.sitter.until = Date.now() + +b.hours * 36e5; persist(); X.emit({ type: 'sitter', on: C.sitter.on }); return send(res, 200, C.sitter); }
    if (p === '/api/famille/ev' && m === 'GET') { if (C.ev.on && !evPlan.at) planEV(new Date()); return send(res, 200, Object.assign({ cfg: C.ev }, evPlan)); }
    return false;
  }
  return { api, mediaOk: p => p === '/api/photos/file' || p === '/api/famille/visit', _test: { scanMail, mailState: () => mailState, parseIcs, expand, addParcel, mailText, decWord, stateOf, CARRIERS, report, planEV, priceAt, evPlan: () => evPlan, C, photoList, indexPhotos, icloudCals, events } };
};

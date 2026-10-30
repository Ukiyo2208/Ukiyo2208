// Serveur Bêta — le « cerveau » de la maison, sur le NAS, 24 h/24 (même tablettes éteintes) :
// - routines et règles « Si… alors… » (heure, lever/coucher du soleil, état d'un appareil, présence, sonnette, Tempo, vigilance…)
// - présence de la famille (OwnTracks + téléphones vus par la box) et mode absent automatique
// - alarme maison (détecteurs d'ouverture et de mouvement, délais d'entrée/sortie, sirènes, annonces sur les tablettes)
// - historique des mesures (températures, consommation…), santé de la maison (hors ligne, piles faibles)
// - EDF Tempo, vigilance Météo-France, calendrier des collectes de déchets
'use strict';
const fs = require('fs'), path = require('path');

module.exports = function engine(DATA, send, readBody, M) {
  const { HUB, NOTIFY, GEO } = M;
  const FILE = path.join(DATA, 'engine.json'), HDIR = path.join(DATA, 'history');
  fs.mkdirSync(HDIR, { recursive: true });
  let C = {}; try { C = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { }
  C = Object.assign({ devices: {}, routines: [], rules: [], users: [], home: null, presence: { auto: false, delay: 10, away: 'depart', home: 'retour', alarm: false }, tempo: { on: false, notify: true }, vigil: { key: '', dept: '67', level: 3 }, trash: { rules: [], ics: '', at: '19:00' }, alarm: { on: false, entry: 30, exit: 60, away: [], night: [], doors: [], sirens: [], say: true, code: '' }, history: true, state: {} }, C);
  const persist = () => fs.writeFileSync(FILE, JSON.stringify(C, null, 1), { mode: 0o600 });
  const S = Object.assign({ alarm: { status: 'disarmed', mode: '', until: 0 }, presence: {}, tempo: null, vigil: null, fired: {} }, C.state);   // état gardé entre deux redémarrages
  const save = () => { C.state = { alarm: S.alarm, presence: S.presence, tempo: S.tempo, vigil: S.vigil, fired: S.fired }; persist(); };
  const events = [];
  const emit = ev => { ev.t = Date.now(); events.push(ev); while (events.length > 100) events.shift(); };
  const log = [];   // journal des règles (affiché dans Bêta home)
  const trace = [];   // pourquoi chaque règle s'est déclenchée… ou pas (« bloquée car il ne fait pas nuit »), simulations comprises
  const addTrace = x => { x.t = Date.now(); trace.unshift(x); trace.length = Math.min(trace.length, 150); };
  const EXT = { acts: {}, tick: [], conds: {}, off: new Set(), listen: [], tempoAdvice: false };   // extensions (server/plus.js) : actions « scène », « liste »…, tâches de la boucle
  const note = (txt, icon) => { log.unshift({ t: Date.now(), txt, icon: icon || 'sparkle' }); log.length = Math.min(log.length, 80); };
  let cur = {}, prev = {};   // états des appareils (identifiants Bêta)

  /* ---------- soleil (calcul NOAA simplifié) ---------- */
  function sun(lat, lon, d) {
    const rad = Math.PI / 180, day = Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 0)) / 864e5);
    const g = 2 * Math.PI / 365 * (day - 1), eq = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
    const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
    const ha = Math.acos(Math.cos(90.833 * rad) / (Math.cos(lat * rad) * Math.cos(decl)) - Math.tan(lat * rad) * Math.tan(decl)) / rad;
    const base = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
    return { rise: new Date(base + (720 - 4 * (lon + ha) - eq) * 6e4), set: new Date(base + (720 - 4 * (lon - ha) - eq) * 6e4) };
  }
  const home = () => C.home || GEO.home() || { lat: 48.5734, lon: 7.7521 };
  const hm = d => String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  const isNight = () => { const h = home(), s = sun(h.lat, h.lon, new Date()), n = Date.now(); return n < +s.rise || n > +s.set; };

  /* ---------- appareils ---------- */
  async function readStates() {
    const brands = [...new Set(Object.values(C.devices).map(d => d.brand))], st = {};
    await Promise.all(brands.map(async b => { try { st[b] = (await HUB.states(b)) || {}; } catch (e) { st[b] = { s: {}, err: e.message }; } }));
    const out = {};
    Object.keys(C.devices).forEach(id => { const d = C.devices[id], s = st[d.brand] && st[d.brand].s && st[d.brand].s[d.bid]; out[id] = s ? Object.assign({}, s) : null; });
    return { out, st };
  }
  async function command(id, patch) {
    const d = C.devices[id]; if (!d) throw new Error('appareil inconnu du serveur : ' + id);
    await HUB.command(d.brand, d.bid, patch, cur[id] || {});
    cur[id] = Object.assign({}, cur[id], patch);
  }

  /* ---------- routines ---------- */
  async function runRoutine(id, by) {
    const r = C.routines.find(x => x.id === id); if (!r) return;
    for (const a of r.actions || []) { try { await command(a.dev, a.patch); } catch (e) { } }
    if (r.away === true) NOTIFY.setAway(true, by || r.name, 'routine'); if (r.away === false) NOTIFY.setAway(false, by || r.name, 'routine');
    if (r.alarm) setAlarm(r.alarm === 'off' ? 'disarmed' : r.alarm, null, true);
    emit({ type: 'routine', id, name: r.name });   // les écrans font le reste (musique, appareils de démo)
    note('Routine « ' + r.name + ' »' + (by ? ' (' + by + ')' : ''), 'play');
  }

  /* ---------- règles « Si… alors… » ---------- */
  const cmp = (v, op, x) => { if (op === 'changes') return true; if (v == null) return false; if (op === '>') return +v > +x; if (op === '<') return +v < +x; if (op === '!=') return String(v) !== String(x); return String(v) === String(x); };
  const val = (st, prop) => st ? (prop === 'open' ? (st.pos != null ? st.pos > 0 : !!st.on) : st[prop]) : undefined;
  function condOk(c) {
    if (c.type === 'away') return NOTIFY.isAway() === !!c.is;
    if (c.type === 'night') return isNight() === (c.is !== false);
    if (c.type === 'between') { const t = hm(new Date()); return c.from <= c.to ? t >= c.from && t < c.to : t >= c.from || t < c.to; }
    if (c.type === 'days') return (c.days || []).includes(new Date().getDay());
    if (c.type === 'device') return cmp(val(cur[c.dev], c.prop), c.op, c.value);
    if (c.type === 'someone') return Object.values(S.presence).some(Boolean) === (c.is !== false);
    if (c.type === 'alarm') return S.alarm.status === c.is;
    if (c.type === 'tempo') return !!S.tempo && S.tempo.today === c.color;
    if (EXT.conds[c.type]) return EXT.conds[c.type](c);
    return true;
  }
  function trigMatch(t, ev) {
    if (t.type !== ev.type) return false;
    if (t.type === 'time') return t.at === ev.hm && (!t.days || !t.days.length || t.days.includes(ev.day));
    if (t.type === 'sun') return t.ev === ev.ev;
    if (t.type === 'device') { if (t.dev !== ev.dev || t.for) return false; const a = val(ev.prev, t.prop), b = val(ev.cur, t.prop); return a !== b && cmp(b, t.op, t.value) && (t.op === 'changes' || !cmp(a, t.op, t.value)); }
    if (t.type === 'presence') return t.ev === ev.ev && (!t.user || t.user === ev.user);
    if (t.type === 'away') return !!t.on === !!ev.on;
    if (t.type === 'tempo') return t.color === ev.color;
    if (t.type === 'vigil') return ev.level >= (t.level || 3);
    if (t.type === 'alarm') return t.status === ev.status;
    if (t.type === 'detect') return (!t.cam || t.cam === ev.cam) && (!t.label || t.label === ev.label);
    if (t.type === 'list') return !t.list || t.list === ev.list;
    return t.type === 'doorbell';
  }
  const running = {};
  async function fire(rule, why, o) {
    o = o || {};
    if (!o.dry && running[rule.id] && Date.now() - running[rule.id] < 20000) return;   // pas de rafale
    const failed = (rule.if || []).filter(c => !condOk(c));
    if (failed.length) { addTrace({ id: rule.id, name: rule.name, why, ok: false, failed, sim: !!o.sim, dry: !!o.dry }); return; }
    if (o.dry) { addTrace({ id: rule.id, name: rule.name, why, ok: true, dry: true, sim: true, acts: rule.then || [] }); return; }   // simulation : rien n'est exécuté
    addTrace({ id: rule.id, name: rule.name, why, ok: true, sim: !!o.sim, acts: rule.then || [] });
    running[rule.id] = Date.now(); S.fired[rule.id] = Date.now(); note((rule.name || 'Règle') + (why ? ' · ' + why : ''), 'sparkle');
    for (const a of rule.then || []) {
      try {
        if (EXT.acts[a.type]) await EXT.acts[a.type](a, rule);
        else if (a.type === 'device') await command(a.dev, a.patch);
        else if (a.type === 'routine') await runRoutine(a.id, rule.name);
        else if (a.type === 'notify') await NOTIFY.sendTo({ title: a.title || rule.name || 'Bêta home', message: a.message || '', critical: a.critical, urgent: a.urgent, go: a.go || 'accueil', image: a.photo ? await NOTIFY.snapshot().catch(() => null) || undefined : undefined }, a.who || 'all');
        else if (a.type === 'say') { await say(a.text); }
        else if (a.type === 'away') NOTIFY.setAway(!!a.on, rule.name, 'règle');
        else if (a.type === 'alarm') setAlarm(a.mode, null, true);
        else if (a.type === 'delay') await new Promise(r => setTimeout(r, Math.min(3600, +a.sec || 0) * 1000));
      } catch (e) { note('⚠ ' + (rule.name || 'Règle') + ' : ' + e.message, 'alert'); }
    }
    save();
  }
  function dispatch(ev) { if (!ev.sim) EXT.listen.forEach(f => { try { f(ev); } catch (e) { } }); if (EXT.off.has('regles') && !ev.sim) return; (C.rules || []).filter(r => r.on !== false && (r.when || []).some(t => trigMatch(t, ev))).forEach(r => fire(r, ev.why, { dry: ev.dry, sim: ev.sim })); }
  // annonce sur les tablettes (Fully Kiosk) et sur les écrans ouverts
  async function say(text) {
    emit({ type: 'say', text });
    if (HUB.configured().includes('fully')) { const tabs = Object.keys(((await HUB.states('fully')) || {}).s || {}); await Promise.all(tabs.map(ip => HUB.command('fully', ip, { on: true, say: text }).catch(() => { }))); }
  }

  /* ---------- présence et mode absent automatique ---------- */
  const leftAt = {};
  function presence(st) {
    const inside = GEO.inside(), now = Date.now(), before = Object.assign({}, S.presence);
    (C.users || []).forEach(u => {
      const srcs = []; if (u.ot && inside[u.id] != null) srcs.push(!!inside[u.id]);
      (u.net || []).forEach(n => { const x = st[n.brand] && st[n.brand].s && st[n.brand].s[n.bid]; if (x) srcs.push(!!x.on); });
      if (!srcs.length) return;
      const here = srcs.some(Boolean);
      if (here) { delete leftAt[u.id]; if (S.presence[u.id] !== true) { S.presence[u.id] = true; if (before[u.id] === false) { dispatch({ type: 'presence', ev: 'arrive', user: u.id, why: u.name + ' arrive' }); note(u.name + ' est rentré(e)', 'homeFill'); } } }
      else { leftAt[u.id] = leftAt[u.id] || now; if (S.presence[u.id] !== false && now - leftAt[u.id] >= (C.presence.delay || 10) * 6e4) { S.presence[u.id] = false; dispatch({ type: 'presence', ev: 'leave', user: u.id, why: u.name + ' part' }); note(u.name + ' est parti(e)', 'walk'); } }
    });
    const was = Object.values(before).some(Boolean), is = Object.values(S.presence).some(Boolean), known = Object.keys(S.presence).length;
    if (known && was && !is) { dispatch({ type: 'presence', ev: 'all_away', why: 'tout le monde est parti' }); if (C.presence.auto) autoAway(true); }
    if (known && !was && is && Object.keys(before).length) { dispatch({ type: 'presence', ev: 'first_home', why: 'premier retour' }); if (C.presence.auto) autoAway(false); }
    if (JSON.stringify(before) !== JSON.stringify(S.presence)) save();
  }
  async function autoAway(away) {
    if (NOTIFY.isAway() === away) return;
    NOTIFY.setAway(away, 'la présence', 'auto');
    const r = away ? C.presence.away : C.presence.home; if (r) await runRoutine(r, 'automatique');
    if (C.presence.alarm && C.alarm.on) setAlarm(away ? 'armed_away' : 'disarmed', null, true);
  }

  /* ---------- alarme maison ---------- */
  function setAlarm(mode, by, trusted) {
    const a = S.alarm;
    if (mode === 'disarmed') { if (a.status === 'triggered') sirens(false); Object.assign(a, { status: 'disarmed', mode: '', until: 0, by: by || '' }); emit({ type: 'alarm', status: 'disarmed' }); note('Alarme désactivée' + (by ? ' par ' + by : ''), 'shieldCheck'); dispatch({ type: 'alarm', status: 'disarmed' }); save(); return true; }
    const m = mode === 'armed_night' ? 'night' : 'away';
    Object.assign(a, { status: C.alarm.exit > 0 && m === 'away' ? 'arming' : 'armed', mode: m, until: Date.now() + (m === 'away' ? C.alarm.exit : 0) * 1000, by: by || '' });
    emit({ type: 'alarm', status: a.status, mode: m, until: a.until }); note('Alarme ' + (m === 'night' ? 'nuit' : 'absence') + ' activée' + (by ? ' par ' + by : ''), 'shieldCheck');
    if (a.status === 'arming' && C.alarm.say) say('Alarme activée dans ' + C.alarm.exit + ' secondes');
    save(); return true;
  }
  async function sirens(on) { for (const id of C.alarm.sirens || []) { try { await command(id, { on }); } catch (e) { } } }
  async function trigger(why) {
    const a = S.alarm; if (a.status === 'triggered') return;
    Object.assign(a, { status: 'triggered', until: 0, why }); save();
    emit({ type: 'alarm', status: 'triggered', why }); note('ALARME : ' + why, 'alert'); dispatch({ type: 'alarm', status: 'triggered' });
    sirens(true);
    if (C.alarm.say) say('Alarme ! ' + why + '. Intrusion détectée.');
    const img = await NOTIFY.snapshot().catch(() => null);
    NOTIFY.sendTo({ title: 'ALARME DÉCLENCHÉE', message: why, critical: 1, go: 'absence', image: img || undefined, tags: ['rotating_light'] }, 'all');
  }
  function alarmTick(changes) {
    const a = S.alarm, now = Date.now();
    if (a.status === 'arming' && now >= a.until) { a.status = 'armed'; emit({ type: 'alarm', status: 'armed', mode: a.mode }); save(); }
    if (a.status === 'entry' && now >= a.until) trigger(a.why || 'Pas de code saisi');
    if (a.status !== 'armed') return;
    const watch = a.mode === 'night' ? C.alarm.night : C.alarm.away;
    changes.forEach(({ id, p, c }) => {
      if (!watch.includes(id) || !c) return;
      const d = C.devices[id], opened = (c.on && !(p && p.on)) || (c.pos > 0 && !(p && p.pos > 0));
      if (!opened) return;
      const why = (d.kind === 'motion' ? 'Mouvement : ' : 'Ouverture : ') + d.name + (d.room ? ' (' + d.room + ')' : '');
      if ((C.alarm.doors || []).includes(id) && C.alarm.entry > 0) { Object.assign(a, { status: 'entry', until: now + C.alarm.entry * 1000, why }); emit({ type: 'alarm', status: 'entry', until: a.until, why }); if (C.alarm.say) say('Alarme : saisissez votre code'); save(); }
      else trigger(why);
    });
  }

  /* ---------- historique des mesures ---------- */
  const lastH = {};
  const metric = (k, s) => !s ? null : ['temp', 'hum', 'co2', 'meter'].includes(k) ? s.val : k === 'clim' ? s.cur : k === 'plug' || k === 'power' ? s.w : null;
  function record() {
    if (C.history === false) return;
    const now = Date.now();
    Object.keys(C.devices).forEach(id => {
      const v = metric(C.devices[id].kind, cur[id]); if (v == null || isNaN(v)) return;
      const l = lastH[id]; if (l && now - l.t < 15 * 6e4 && Math.abs(v - l.v) < Math.max(0.2, Math.abs(l.v) * 0.03)) return;
      lastH[id] = { t: now, v: +v }; fs.appendFile(path.join(HDIR, id.replace(/[^\w.-]/g, '_') + '.jsonl'), JSON.stringify([Math.round(now / 1000), +(+v).toFixed(2)]) + '\n', () => { });
    });
  }
  function history(id, from, to, max) {
    const f = path.join(HDIR, String(id).replace(/[^\w.-]/g, '_') + '.jsonl'); if (!fs.existsSync(f)) return [];
    const pts = fs.readFileSync(f, 'utf8').split('\n').map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(x => x && x[0] * 1000 >= from && x[0] * 1000 <= to);
    if (pts.length <= max) return pts;
    const step = (to - from) / 1000 / max, out = [];   // moyenne par tranche
    for (let i = 0, b = 0; b < max; b++) { const end = from / 1000 + (b + 1) * step; let s = 0, n = 0, t = 0; while (i < pts.length && pts[i][0] < end) { s += pts[i][1]; t += pts[i][0]; n++; i++; } if (n) out.push([Math.round(t / n), +(s / n).toFixed(2)]); }
    return out;
  }
  setInterval(() => {   // un an d'historique au plus
    fs.readdir(HDIR, (e, list) => (list || []).forEach(n => { const f = path.join(HDIR, n); try { if (fs.statSync(f).size < 4e6) return; const from = Date.now() / 1000 - 366 * 86400; fs.writeFileSync(f, fs.readFileSync(f, 'utf8').split('\n').filter(l => { try { return JSON.parse(l)[0] > from; } catch (x) { return false; } }).join('\n') + '\n'); } catch (x) { } }));
  }, 6 * 36e5);

  /* ---------- santé de la maison ---------- */
  let health = { at: 0, brands: [], devices: [] };
  const known = {};
  function checkHealth(st) {
    const brands = Object.keys(st).filter(b => st[b].err).map(b => ({ id: b, err: st[b].err })), devices = [];
    Object.keys(C.devices).forEach(id => {
      const d = C.devices[id], s = cur[id];
      if (!s && !(st[d.brand] && st[d.brand].err)) devices.push({ id, name: d.name, room: d.room, issue: 'hors ligne', lvl: 2 });
      const bat = s && (s.bat != null ? s.bat : s.battery != null ? s.battery : null);
      if (bat != null && bat <= 20) devices.push({ id, name: d.name, room: d.room, issue: 'pile faible (' + Math.round(bat) + ' %)', lvl: bat <= 10 ? 2 : 1 });
    });
    health = { at: Date.now(), brands, devices };
    const keys = brands.map(b => 'b:' + b.id).concat(devices.map(d => d.id + ':' + d.issue.split(' ')[0]));
    const fresh = keys.filter(k => !known[k]); keys.forEach(k => { known[k] = known[k] || Date.now(); }); Object.keys(known).forEach(k => { if (!keys.includes(k)) delete known[k]; });
    if (fresh.length && Date.now() - started > 5 * 6e4) {
      const txt = devices.filter(d => fresh.includes(d.id + ':' + d.issue.split(' ')[0])).map(d => d.name + ' : ' + d.issue).concat(EXT.brandWatch ? [] : brands.filter(b => fresh.includes('b:' + b.id)).map(b => b.id + ' : ' + b.err));   // pannes de marques : veille.js
      if (txt.length) NOTIFY.notifyRule('health', { title: 'Santé de la maison', message: txt.slice(0, 5).join(' · '), go: 'sante', tags: ['warning'] });
    }
  }

  /* ---------- EDF Tempo, vigilance Météo-France ---------- */
  const TEMPO = { 1: 'bleu', 2: 'blanc', 3: 'rouge' };
  async function fetchTempo() {
    if (!C.tempo.on) return;
    try {
      const g = async d => { const r = await fetch('https://www.api-couleur-tempo.fr/api/jourTempo/' + d, { signal: AbortSignal.timeout(15000) }); return r.ok ? r.json() : null; };
      const [a, b] = await Promise.all([g('today'), g('tomorrow')]), old = S.tempo || {};
      S.tempo = { today: TEMPO[a && a.codeJour] || '', tomorrow: TEMPO[b && b.codeJour] || '', date: a && a.dateJour, at: Date.now() };
      if (S.tempo.tomorrow && S.tempo.tomorrow !== old.tomorrow) {
        dispatch({ type: 'tempo', color: S.tempo.tomorrow, why: 'demain jour ' + S.tempo.tomorrow });
        if (S.tempo.tomorrow === 'rouge' && C.tempo.notify && !EXT.tempoAdvice) NOTIFY.notifyRule('tempo', { title: 'Demain : jour ROUGE Tempo', message: 'Électricité très chère demain de 6 h à 22 h : décalez machines et recharge.', urgent: 1, go: 'energie', tags: ['red_circle'] });
      }
      save();
    } catch (e) { }
  }
  const PHEN = { 1: 'vent violent', 2: 'pluie-inondation', 3: 'orages', 4: 'crues', 5: 'neige-verglas', 6: 'canicule', 7: 'grand froid', 8: 'avalanches', 9: 'vagues-submersion' }, COL = { 1: 'vert', 2: 'jaune', 3: 'orange', 4: 'rouge' };
  async function fetchVigil() {
    if (!C.vigil.key) return;
    try {
      const r = await fetch('https://public-api.meteofrance.fr/public/DPVigilance/v1/cartevigilance/encours', { headers: { apikey: C.vigil.key, accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json(), out = [];
      ((j.product || {}).periods || []).forEach(p => (((p.timelaps || {}).domain_ids) || []).filter(d => String(d.domain_id) === String(C.vigil.dept)).forEach(d => {
        (d.phenomenon_items || []).filter(x => +x.phenomenon_max_color_id >= 2).forEach(x => out.push({ when: p.echeance === 'J' ? 'aujourd’hui' : 'demain', phen: PHEN[x.phenomenon_id] || 'phénomène ' + x.phenomenon_id, level: +x.phenomenon_max_color_id, color: COL[x.phenomenon_max_color_id] }));
      }));
      const max = out.reduce((m, x) => Math.max(m, x.level), 1), old = (S.vigil || {}).max || 1;
      S.vigil = { max, color: COL[max], items: out, at: Date.now(), err: '' };
      if (max >= (C.vigil.level || 3) && max > old) {
        dispatch({ type: 'vigil', level: max, why: 'vigilance ' + COL[max] });
        const top = out.filter(x => x.level === max);
        NOTIFY.notifyRule('weather', { title: 'Vigilance ' + COL[max].toUpperCase() + ' — ' + (C.vigil.dept === '67' ? 'Bas-Rhin' : 'dép. ' + C.vigil.dept), message: top.map(x => x.phen + ' (' + x.when + ')').join(', '), urgent: max >= 3 ? 1 : 0, critical: max >= 4 ? 1 : 0, go: 'accueil', tags: ['warning'] });
      }
      save();
    } catch (e) { S.vigil = Object.assign({}, S.vigil, { err: e.message }); }
  }

  /* ---------- collectes de déchets ---------- */
  let icsCache = { at: 0, list: [] };
  async function icsList() {
    if (!C.trash.ics || Date.now() - icsCache.at < 12 * 36e5) return icsCache.list;
    try {
      const t = await (await fetch(C.trash.ics, { signal: AbortSignal.timeout(20000) })).text(), out = [];
      t.replace(/\r?\n[ \t]/g, '').split('BEGIN:VEVENT').slice(1).forEach(ev => { const d = (ev.match(/DTSTART[^:]*:(\d{8})/) || [])[1], n = (ev.match(/SUMMARY[^:]*:(.*)/) || [])[1]; if (d && n) out.push({ date: d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6, 8), name: n.trim().replace(/\\,/g, ','), color: '' }); });
      icsCache = { at: Date.now(), list: out };
    } catch (e) { }
    return icsCache.list;
  }
  const ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  async function trashDays(days) {
    const out = [], t0 = new Date(); t0.setHours(12, 0, 0, 0);
    for (let i = 0; i < days; i++) {
      const d = new Date(+t0 + i * 864e5);
      (C.trash.rules || []).forEach(r => {
        if (+r.day !== d.getDay()) return;
        if ((+r.every || 1) > 1 && r.ref) { const w = Math.round((+d - +new Date(r.ref + 'T12:00:00')) / (7 * 864e5)); if (((w % r.every) + r.every) % r.every) return; }
        if (r.month && d.getDate() > 7) return;   // « premier … du mois »
        out.push({ date: ymd(d), name: r.name, color: r.color || '' });
      });
    }
    const end = ymd(new Date(+t0 + days * 864e5)), today = ymd(t0);
    (await icsList()).filter(e => e.date >= today && e.date < end).forEach(e => out.push(e));
    return out.sort((a, b) => a.date < b.date ? -1 : 1);
  }

  /* ---------- boucle principale ---------- */
  const started = Date.now(); let lastMin = '', lastSunDay = '', sunT = null, busy = false;
  async function loop() {
    if (busy) return; busy = true;
    try {
      const { out, st } = await readStates(); prev = cur; cur = out;
      const changes = Object.keys(cur).filter(id => prev[id] && cur[id] && JSON.stringify(prev[id]) !== JSON.stringify(cur[id])).map(id => ({ id, p: prev[id], c: cur[id] }));
      changes.forEach(({ id, p, c }) => dispatch({ type: 'device', dev: id, prev: p, cur: c, why: (C.devices[id] || {}).name }));
      // règles « depuis X minutes » (porte ouverte depuis 10 min…)
      (C.rules || []).filter(r => r.on !== false).forEach(r => (r.when || []).filter(t => t.type === 'device' && t.for).forEach(t => {
        const k = r.id + '|' + t.dev, ok = cmp(val(cur[t.dev], t.prop), t.op, t.value);
        if (!ok) { delete S.fired[k]; delete running[k + 's']; return; }
        running[k + 's'] = running[k + 's'] || Date.now();
        if (!S.fired[k] && Date.now() - running[k + 's'] >= t.for * 6e4) { S.fired[k] = Date.now(); fire(r, (C.devices[t.dev] || {}).name + ' depuis ' + t.for + ' min'); }
      }));
      presence(st); alarmTick(changes); record();
      const now = new Date(), t = hm(now), minute = t !== lastMin;
      EXT.tick.forEach(f => { try { f({ changes, st, t, now, minute }); } catch (e) { console.warn('extension : ' + e.message); } });
      if (minute) {
        lastMin = t;
        dispatch({ type: 'time', hm: t, day: now.getDay() });
        C.routines.filter(r => r.sched && r.time === t && (!r.days || !r.days.length || r.days.includes(now.getDay()))).forEach(r => runRoutine(r.id, 'programmée'));
        const h = home(); if (lastSunDay !== ymd(now)) { lastSunDay = ymd(now); sunT = sun(h.lat, h.lon, now); }
        (C.rules || []).forEach(r => (r.when || []).filter(x => x.type === 'sun').forEach(x => { const at = new Date(+sunT[x.ev === 'sunrise' ? 'rise' : 'set'] + (+x.off || 0) * 6e4); if (hm(at) === t) fire(r, x.ev === 'sunrise' ? 'lever du soleil' : 'coucher du soleil'); }));
        if (t === (C.trash.at || '19:00')) { const tm = ymd(new Date(Date.now() + 864e5)), l = (await trashDays(2)).filter(e => e.date === tm); if (l.length) NOTIFY.notifyRule('trash', { title: 'Poubelles', message: 'À sortir ce soir : ' + l.map(e => e.name).join(', '), go: 'calendrier', tags: ['wastebasket'] }); }
        if (/^(06|11|17):0[5]$/.test(t)) fetchTempo();
        if (/:(00|30)$/.test(t)) fetchVigil();
        if (now.getMinutes() % 2 === 0) checkHealth(st);
      }
    } catch (e) { console.warn('cerveau : ' + e.message); }
    busy = false;
  }
  setInterval(loop, 4000);
  setTimeout(() => { fetchTempo(); fetchVigil(); }, 5000);
  NOTIFY.hooks.ring.push(() => dispatch({ type: 'doorbell', why: 'on sonne' }));
  NOTIFY.hooks.away.push(on => { dispatch({ type: 'away', on, why: on ? 'mode absent' : 'retour' }); emit({ type: 'away', on }); });

  /* ---------- API ---------- */
  const view = () => Object.assign({}, C, { vigil: Object.assign({}, C.vigil, { key: C.vigil.key ? '••••' : '' }), alarm: Object.assign({}, C.alarm, { code: C.alarm.code ? '••••' : '' }), state: undefined });
  async function api(req, res, url, who) {
    const p = url.pathname, m = req.method;
    if (p === '/api/engine' && m === 'GET') return send(res, 200, view());
    if (p === '/api/engine' && m === 'PUT') {   // configuration envoyée par Bêta home (appareils, routines, règles, réglages)
      const b = await readBody(req) || {};
      // types vérifiés : une configuration malformée ne doit jamais casser le cerveau
      ['routines', 'rules', 'users'].forEach(k => { if (Array.isArray(b[k])) C[k] = b[k].filter(x => x && typeof x === 'object'); });
      if (b.devices && typeof b.devices === 'object' && !Array.isArray(b.devices)) C.devices = b.devices;
      if (b.home === null || (b.home && typeof b.home.lat === 'number' && typeof b.home.lon === 'number')) C.home = b.home;
      ['presence', 'tempo', 'trash'].forEach(k => { if (b[k]) C[k] = Object.assign(C[k], b[k]); });
      if (b.vigil) { const old = C.vigil.key; C.vigil = Object.assign(C.vigil, b.vigil); if (b.vigil.key === '••••' || b.vigil.key == null) C.vigil.key = old; }
      if (b.alarm) { const code = b.alarm.code, old = C.alarm.code; C.alarm = Object.assign(C.alarm, b.alarm); if (code === '••••' || code == null) C.alarm.code = old; }
      if (b.history !== undefined) C.history = !!b.history;
      persist(); if (b.tempo) fetchTempo(); if (b.vigil) fetchVigil();
      return send(res, 200, view());
    }
    if (p === '/api/engine/status' && m === 'GET') return send(res, 200, { now: Date.now(), away: NOTIFY.isAway(), presence: S.presence, alarm: S.alarm, tempo: S.tempo, vigil: S.vigil, night: isNight(), sun: sunT, log: log.slice(0, 30), fired: S.fired });
    if (p === '/api/engine/trace' && m === 'GET') { const id = url.searchParams.get('id'); return send(res, 200, trace.filter(x => !id || x.id === id).slice(0, 60)); }
    // mode test : un évènement « pour de faux » ; par défaut les actions ne sont pas exécutées (dry)
    if (p === '/api/engine/sim' && m === 'POST') {
      const b = await readBody(req) || {}, dry = b.real !== true, t0 = Date.now(), ev = { sim: true, dry };
      if (b.kind === 'device') { const c0 = cur[b.dev] || {}; Object.assign(ev, { type: 'device', dev: b.dev, prev: c0, cur: Object.assign({}, c0, b.state || {}), why: 'simulation : ' + ((C.devices[b.dev] || {}).name || b.dev) }); }
      else if (b.kind === 'presence') Object.assign(ev, { type: 'presence', ev: b.ev, user: b.user, why: 'simulation : ' + ({ arrive: 'arrivée', leave: 'départ', all_away: 'tout le monde part', first_home: 'premier retour' }[b.ev] || b.ev) });
      else if (b.kind === 'time') { const d = new Date(); Object.assign(ev, { type: 'time', hm: b.at || hm(d), day: b.day != null ? +b.day : d.getDay(), why: 'simulation : ' + (b.at || hm(d)) }); }
      else if (b.kind === 'sun') { ev.why = 'simulation : ' + (b.ev === 'sunrise' ? 'lever' : 'coucher') + ' du soleil'; (C.rules || []).filter(r => r.on !== false && (r.when || []).some(x => x.type === 'sun' && x.ev === b.ev)).forEach(r => fire(r, ev.why, ev)); }
      else Object.assign(ev, { type: b.kind, on: b.on, color: b.color, level: +b.level || 3, status: b.status, cam: b.cam, label: b.label, list: b.list, why: 'simulation : ' + b.kind });
      if (ev.type) dispatch(ev);
      await new Promise(r => setTimeout(r, 250));
      return send(res, 200, { dry, trace: trace.filter(x => x.t >= t0) });
    }
    if (p === '/api/engine/events' && m === 'GET') { const t = +url.searchParams.get('since') || 0; return send(res, 200, { now: Date.now(), events: events.filter(e => e.t > t), alarm: S.alarm, away: NOTIFY.isAway() }); }
    if (p === '/api/engine/claim' && m === 'POST') { const b = await readBody(req) || {}, e = events.find(x => x.t === +b.t && x.type === b.type); if (!e || e.claimed) return send(res, 200, { ok: false }); e.claimed = true; return send(res, 200, { ok: true }); }
    if (p === '/api/engine/routine' && m === 'POST') { const b = await readBody(req) || {}; await runRoutine(b.id, b.by); return send(res, 200, { ok: true }); }
    if (p === '/api/engine/rule' && m === 'POST') { const b = await readBody(req) || {}, r = C.rules.find(x => x.id === b.id); if (!r) return send(res, 404, { error: 'règle inconnue' }); await fire(Object.assign({}, r, { if: [] }), 'test'); return send(res, 200, { ok: true }); }
    if (p === '/api/engine/alarm' && m === 'POST') {
      const b = await readBody(req) || {};
      if (!C.alarm.on) return send(res, 400, { error: 'alarme non configurée' });
      if (b.mode === 'disarmed' && S.alarm.status !== 'disarmed') {   // désarmer : code exigé
        const okPin = M.AUTH && b.user && b.pin ? M.AUTH.checkPin(b.user, b.pin) : false, okCode = C.alarm.code && b.pin && String(b.pin) === String(C.alarm.code);
        if (!okPin && !okCode && !(M.AUTH && !M.AUTH.secure() && !C.alarm.code)) { note('Code d’alarme refusé', 'lock'); return send(res, 403, { error: 'code refusé' }); }
      }
      setAlarm(b.mode, b.by || (who && who.name)); return send(res, 200, { alarm: S.alarm });
    }
    if (p === '/api/history' && m === 'GET') { const to = +url.searchParams.get('to') || Date.now(), from = +url.searchParams.get('from') || to - 864e5; return send(res, 200, history(url.searchParams.get('dev'), from, to, Math.min(+url.searchParams.get('max') || 300, 2000))); }
    if (p === '/api/engine/health' && m === 'GET') { if (!health.at) { const { st } = await readStates(); checkHealth(st); } return send(res, 200, health); }
    if (p === '/api/engine/trash' && m === 'GET') return send(res, 200, await trashDays(Math.min(+url.searchParams.get('days') || 45, 120)));
    return false;
  }
  // pour server/plus.js
  const X = { C, S, EXT, cur: () => cur, command, dispatch, emit, note, say, isNight, home, hm, ymd, sun, runRoutine, setAlarm, trigger, save, persist, history, HDIR, trashDays };
  return { api, runRoutine, isNight, X, status: () => ({ alarm: S.alarm, presence: S.presence }), _test: { sun, trashDays, history } };
};

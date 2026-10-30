// Serveur Bêta 7.12 — tout ce qui rend la maison plus solide et plus pratique, 24 h/24 sur le NAS :
// - sauvegarde chiffrée complète (réglages, règles, appareils, historique) et restauration ; copie chaque nuit (clé USB)
// - mises à jour depuis l'application (Watchtower)
// - scènes par pièce et par moment de la journée, lumière adaptative (chaude le soir, vive le matin)
// - chauffage intelligent : planning par zone, éco en absence ou fenêtre ouverte, jours rouges Tempo
// - énergie : coût en euros par appareil et par jour (base, heures creuses, Tempo), alerte de consommation anormale
// - arrosage selon la météo (Open-Meteo, gratuit) ; simulation de présence pendant les vacances
// - raccourcis Siri et widgets iPhone (/api/quick) ; listes de courses et tâches ; messages sur les tablettes
// - détection de personnes et voitures avec Frigate (photo, zones, alarme)
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto'), zlib = require('zlib');

module.exports = function plus(DATA, send, readBody, M) {
  const { HUB, NOTIFY, ENGINE, AUTH } = M, X = ENGINE.X, E = X.C;   // E : configuration du cerveau (appareils, règles…)
  const FILE = path.join(DATA, 'plus.json');
  const DEF = {
    backup: { auto: true, at: '03:30', dir: '', keep: 14, pass: '', history: true },
    scenes: [], adaptive: { on: false, rooms: [] },
    heat: { zones: [] },
    // tarifs TTC au kWh (à ajuster avec votre facture) ; Tempo : [heures creuses, heures pleines]
    tariff: { mode: 'tempo', base: 0.2016, hp: 0.2146, hc: 0.1696, hcFrom: '22:00', hcTo: '06:00', tempo: { bleu: [0.1288, 0.1552], blanc: [0.1447, 0.1792], rouge: [0.1518, 0.6586] }, sub: 0, alert: true },
    water: { on: false, devs: [], times: ['06:30'], days: [], dur: 15, rain: 3, fcst: 4, cold: 8 },
    sim: { mode: 'away', devs: [], end: '23:30', jitter: 10 },
    detect: { on: false, labels: ['person'], cams: {}, away: false, cool: 3 },
    lists: { courses: [], taches: [] }, board: [], tempoDays: {}, off: []   // off : modules coupés dans Paramètres › Modules
  };
  let C = {}; try { C = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { }
  Object.keys(DEF).forEach(k => { C[k] = DEF[k] && typeof DEF[k] === 'object' && !Array.isArray(DEF[k]) ? Object.assign({}, DEF[k], C[k]) : C[k] !== undefined ? C[k] : DEF[k]; });
  const on = m => !(C.off || []).includes(m), syncOff = () => { X.EXT.off.clear(); (C.off || []).forEach(m => X.EXT.off.add(m)); };
  let pT = 0; const persist = () => { clearTimeout(pT); pT = setTimeout(() => fs.writeFile(FILE, JSON.stringify(C, null, 1), { mode: 0o600 }, () => { }), 300); };
  const kind = id => (E.devices[id] || {}).kind || '', dname = id => (E.devices[id] || {}).name || id, cur = () => X.cur();
  const uid = () => Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
  const LIGHT = ['light', 'rgb'];

  /* ======================= 1. sauvegarde chiffrée et restauration ======================= */
  function encrypt(obj, pass) {
    const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12), key = crypto.scryptSync(String(pass), salt, 32), c = crypto.createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.concat([c.update(zlib.gzipSync(Buffer.from(JSON.stringify(obj)))), c.final()]);
    return { beta: 'backup', v: 1, alg: 'aes-256-gcm/scrypt/gzip', at: Date.now(), salt: salt.toString('base64'), iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), data: data.toString('base64') };
  }
  function decrypt(b, pass) {
    if (!b || b.beta !== 'backup' || !b.data) throw new Error('ce fichier n’est pas une sauvegarde Bêta home');
    try {
      const d = crypto.createDecipheriv('aes-256-gcm', crypto.scryptSync(String(pass), Buffer.from(b.salt, 'base64'), 32), Buffer.from(b.iv, 'base64'));
      d.setAuthTag(Buffer.from(b.tag, 'base64'));
      return JSON.parse(zlib.gunzipSync(Buffer.concat([d.update(Buffer.from(b.data, 'base64')), d.final()])).toString());
    } catch (e) { throw new Error('mot de passe incorrect ou fichier abîmé'); }
  }
  const OKNAME = /^((store|history)\/)?[\w.-]+\.(json|jsonl|yaml)$/;
  function collect(full) {
    const files = {}, rd = (dir, pre) => { try { fs.readdirSync(path.join(DATA, dir)).forEach(n => { const rel = (pre || '') + n; if (OKNAME.test(rel) && fs.statSync(path.join(DATA, dir, n)).isFile()) files[rel] = fs.readFileSync(path.join(DATA, dir, n), 'utf8'); }); } catch (e) { } };
    rd(''); rd('store', 'store/'); if (full) rd('history', 'history/');
    let client = null;   // dernière sauvegarde envoyée par un écran (réglages de Bêta home)
    try { const l = fs.readdirSync(path.join(DATA, 'backups')).filter(n => /^beta-.*\.json$/.test(n)).sort(); if (l.length) client = JSON.parse(fs.readFileSync(path.join(DATA, 'backups', l[l.length - 1]), 'utf8')).data || null; } catch (e) { }
    return { at: Date.now(), version: process.env.BETA_SHA || 'dev', files, client };
  }
  function restore(o) {
    let n = 0;
    Object.keys(o.files || {}).forEach(rel => { if (!OKNAME.test(rel)) return; const f = path.join(DATA, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, o.files[rel], { mode: 0o600 }); n++; });
    return n;
  }
  function autoBackup() {
    const b = C.backup, d = new Date(), name = 'auto-' + X.ymd(d), dir = path.join(DATA, 'backups');
    try {
      const o = collect(b.history !== false);
      if (b.pass) { const enc = JSON.stringify(encrypt(o, b.pass)); fs.writeFileSync(path.join(dir, name + '.betabak'), enc, { mode: 0o600 }); if (b.dir) { fs.mkdirSync(b.dir, { recursive: true }); fs.writeFileSync(path.join(b.dir, 'beta-home-' + name + '.betabak'), enc); } }
      else fs.writeFileSync(path.join(dir, name + '.json'), JSON.stringify(o), { mode: 0o600 });
      const prune = (where, re) => { const l = fs.readdirSync(where).filter(n => re.test(n)).sort(); l.slice(0, Math.max(0, l.length - (b.keep || 14))).forEach(n => fs.unlinkSync(path.join(where, n))); };
      prune(dir, /^auto-/); if (b.dir && b.pass) prune(b.dir, /^beta-home-auto-/);
      b.last = { at: Date.now(), ok: true, name }; X.note('Sauvegarde de la nuit enregistrée' + (b.dir && b.pass ? ' (copie : ' + b.dir + ')' : ''), 'cloudUp');
    } catch (e) { b.last = { at: Date.now(), ok: false, err: e.message }; X.note('⚠ Sauvegarde de la nuit : ' + e.message, 'alert'); NOTIFY.notifyRule('health', { title: 'Sauvegarde impossible', message: e.message, go: 'parametres', tags: ['warning'] }); }
    persist();
  }

  /* ======================= 4. mises à jour (Watchtower) ======================= */
  const SHA = process.env.BETA_SHA || 'dev', REPO = process.env.BETA_REPO || 'ukiyo2208/ukiyo2208', BRANCH = process.env.BETA_BRANCH || 'main';
  const WT = (process.env.WATCHTOWER_URL || 'http://127.0.0.1:8092').replace(/\/+$/, ''), WTK = process.env.WATCHTOWER_TOKEN || '';
  let upd = { at: 0 };
  async function checkUpdate(force) {
    if (!force && Date.now() - upd.at < 36e5) return upd;
    try {
      const r = await fetch('https://api.github.com/repos/' + REPO + '/commits/' + BRANCH, { headers: { 'User-Agent': 'beta-home', Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error(r.status === 404 ? 'dépôt privé ou introuvable (' + REPO + ')' : 'GitHub : HTTP ' + r.status);
      const j = await r.json();
      upd = { at: Date.now(), latest: { sha: j.sha, date: j.commit && j.commit.committer && j.commit.committer.date, msg: String((j.commit && j.commit.message) || '').split('\n')[0] } };
    } catch (e) { upd = { at: Date.now(), err: e.message }; }
    return upd;
  }

  /* ======================= 5. scènes et lumière adaptative ======================= */
  // courbe de la journée : [heure, luminosité %, température de couleur K]
  const CURVE = [[0, 20, 2200], [6, 45, 2900], [9, 100, 4500], [13, 100, 5000], [17, 90, 4000], [20, 60, 2700], [22, 35, 2300], [24, 20, 2200]];
  function moment(d) {
    d = d || new Date(); const h = d.getHours() + d.getMinutes() / 60, i = CURVE.findIndex((p, j) => h >= p[0] && h < CURVE[j + 1][0]), a = CURVE[i], b = CURVE[i + 1], k = (h - a[0]) / (b[0] - a[0]);
    const H = d.getHours();
    return { bri: Math.round(a[1] + (b[1] - a[1]) * k), ct: Math.round((a[2] + (b[2] - a[2]) * k) / 50) * 50, name: H >= 5 && H < 10 ? 'matin' : H >= 10 && H < 18 ? 'jour' : H >= 18 && H < 22 ? 'soir' : 'nuit' };
  }
  const adapt = (id, p, sc) => sc && sc.adaptive && p.on && LIGHT.includes(kind(id)) ? Object.assign({}, p, { bri: moment().bri, ct: moment().ct }) : p;
  async function runScene(id, by) {
    const sc = C.scenes.find(x => x.id === id); if (!sc) throw new Error('scène inconnue');
    await Promise.all(Object.keys(sc.states || {}).filter(d => E.devices[d]).map(d => X.command(d, adapt(d, sc.states[d], sc)).catch(() => { })));
    (X.EXT.onScene || []).forEach(f => { try { f(sc, by); } catch (e) { } });
    X.emit({ type: 'scene', id, name: sc.name }); X.note('Scène « ' + sc.name + ' »' + (by ? ' (' + by + ')' : ''), 'sparkle');
    return sc;
  }
  const sceneFor = room => { const m = moment().name, l = C.scenes.filter(s => s.room === room); return l.find(s => (s.moments || []).includes(m)) || l[0]; };
  // lumière adaptative : ne touche qu'une lampe qu'on vient d'allumer, ou qu'elle règle déjà elle-même ;
  // une luminosité choisie à la main ou par une scène (cinéma à 8 %…) est respectée jusqu'à la prochaine extinction
  const adaptSet = {}, onAt = {};
  function adaptTrack(changes) { changes.forEach(({ id, p, c }) => { if (!LIGHT.includes(kind(id))) return; if (c.on && !p.on) onAt[id] = Date.now(); if (!c.on && p.on) { delete onAt[id]; delete adaptSet[id]; } }); }
  function adaptTick() {
    if (!C.adaptive.on) return; const m = moment(), c = cur();
    Object.keys(E.devices).filter(id => LIGHT.includes(kind(id)) && (!C.adaptive.rooms.length || C.adaptive.rooms.includes(E.devices[id].room))).forEach(id => {
      const s = c[id], a = adaptSet[id]; if (!s || !s.on || s.bri == null) return;
      const fresh = onAt[id] && Date.now() - onAt[id] < 3 * 6e4, ours = a && Math.abs(s.bri - a.bri) <= 4;
      if (!fresh && !ours) return;
      if (ours && Math.abs(a.bri - m.bri) < 3 && a.ct === m.ct) return;
      adaptSet[id] = { bri: m.bri, ct: m.ct }; delete onAt[id]; X.command(id, { bri: m.bri, ct: m.ct }).catch(() => { });
    });
  }

  /* ======================= 6. chauffage intelligent ======================= */
  const heatState = {}, heatSent = {}, winSince = {};
  const inSched = (z, d) => { const t = X.hm(d), day = d.getDay(); return (z.sched || []).some(p => (!p.days || !p.days.length || p.days.includes(day)) && (p.from <= p.to ? t >= p.from && t < p.to : t >= p.from || t < p.to)); };
  function heatTarget(z, d) {
    const c = cur(), frost = +z.frost || 7;
    if (z.mode === 'off') return { off: true, why: 'arrêt' };
    const open = (z.windows || []).some(id => { const s = c[id]; return s && (s.on || s.pos > 0); });
    if (open) winSince[z.id] = winSince[z.id] || Date.now(); else delete winSince[z.id];
    if (z.winOff !== false && open && Date.now() - winSince[z.id] >= (z.winDelay != null && z.winDelay !== '' ? +z.winDelay : 2) * 6e4) return { off: true, why: 'fenêtre ouverte', win: true };
    let t, why;
    if (z.boost > Date.now()) { t = (+z.comfort || 20) + 1; why = 'boost jusqu’à ' + X.hm(new Date(z.boost)); }
    else if (z.mode === 'comfort') { t = +z.comfort || 20; why = 'confort (manuel)'; }
    else if (z.mode === 'eco') { t = +z.eco || 17; why = 'éco (manuel)'; }
    else if (z.mode === 'frost') { t = frost; why = 'hors-gel'; }
    else if (z.awayEco !== false && NOTIFY.isAway()) { t = +z.eco || 17; why = 'mode absent'; }
    else if (inSched(z, d)) { t = +z.comfort || 20; why = 'planning : confort'; }
    else { t = +z.eco || 17; why = 'planning : éco'; }
    const tp = X.S.tempo, h = d.getHours();
    if (+z.tempoRed && tp && tp.today === 'rouge' && h >= 6 && h < 22 && z.mode !== 'frost') { t += +z.tempoRed; why += ' · jour rouge ' + z.tempoRed + ' °C'; }
    return { target: Math.max(frost, Math.round(t * 2) / 2), why, win: open };
  }
  function heatTick(d) {
    (C.heat.zones || []).filter(z => z.on !== false).forEach(z => {
      const r = heatTarget(z, d), s = z.sensor && cur()[z.sensor];
      heatState[z.id] = Object.assign(r, { temp: s ? (s.val != null ? s.val : s.cur) : null, at: Date.now() });
      (z.devs || []).filter(id => E.devices[id]).forEach(id => {
        const patch = r.off ? { on: false } : { on: true, temp: r.target }, k = JSON.stringify(patch), h = heatSent[id];
        if (h && h.k === k && Date.now() - h.at < 36e5) return;   // renvoyé au plus une fois par heure s'il ne change pas
        heatSent[id] = { k, at: Date.now() }; X.command(id, patch).catch(e => X.note('⚠ Chauffage ' + dname(id) + ' : ' + e.message, 'alert'));
      });
    });
  }

  /* ======================= 7. énergie : kWh et euros ======================= */
  const tempoOf = ts => { const d = new Date(ts - 6 * 36e5); return C.tempoDays[X.ymd(d)] || 'bleu'; };   // un jour Tempo va de 6 h à 6 h
  const isHC = (ts, from, to) => { const t = X.hm(new Date(ts)); return from <= to ? t >= from && t < to : t >= from || t < to; };
  function price(ts) {
    const T = C.tariff;
    if (T.mode === 'base') return +T.base;
    if (T.mode === 'hphc') return isHC(ts, T.hcFrom, T.hcTo) ? +T.hc : +T.hp;
    const p = T.tempo[tempoOf(ts)] || T.tempo.bleu; return isHC(ts, '22:00', '06:00') ? +p[0] : +p[1];
  }
  // consommation d'un appareil par heure : la puissance (W) est tenue jusqu'à la mesure suivante (20 min au plus)
  function hourly(id, from, to) {
    const pts = X.history(id, from - 36e5, to, 1e9), out = {};
    for (let i = 0; i < pts.length; i++) {
      let a = Math.max(pts[i][0] * 1000, from); const b = Math.min(pts[i + 1] ? pts[i + 1][0] * 1000 : Math.min(to, Date.now()), pts[i][0] * 1000 + 20 * 6e4, to), w = Math.max(0, pts[i][1]);
      while (a < b) { const h = Math.floor(a / 36e5) * 36e5, e = Math.min(b, h + 36e5); out[h] = (out[h] || 0) + w * (e - a) / 36e5 / 1000; a = e; }
    }
    return out;
  }
  let enCache = { at: 0 };
  function energy(days) {
    if (Date.now() - enCache.at < 5 * 6e4 && enCache.days >= days) return enCache.r;
    const end = Date.now(), d0 = new Date(); d0.setHours(0, 0, 0, 0); const from = +d0 - (days - 1) * 864e5;
    const devs = Object.keys(E.devices).filter(id => ['plug', 'power'].includes(kind(id))), byDay = {}, dev = {};
    devs.forEach(id => {
      const h = hourly(id, from, end); dev[id] = { name: dname(id), room: E.devices[id].room || '', kwh: 0, eur: 0 };
      Object.keys(h).forEach(t => { const k = X.ymd(new Date(+t)), e = h[t], eur = e * price(+t), D = byDay[k] = byDay[k] || { date: k, kwh: 0, eur: 0, dev: {} }; D.kwh += e; D.eur += eur; D.dev[id] = (D.dev[id] || 0) + e; dev[id].kwh += e; dev[id].eur += eur; });
    });
    const list = []; for (let i = 0; i < days; i++) { const k = X.ymd(new Date(from + i * 864e5 + 36e5)); list.push(byDay[k] || { date: k, kwh: 0, eur: 0, dev: {} }); }
    list.forEach(x => { x.kwh = +x.kwh.toFixed(3); x.eur = +x.eur.toFixed(3); x.tempo = C.tariff.mode === 'tempo' ? C.tempoDays[x.date] || '' : ''; Object.keys(x.dev).forEach(k => { x.dev[k] = +x.dev[k].toFixed(3); }); });
    Object.values(dev).forEach(v => { v.kwh = +v.kwh.toFixed(2); v.eur = +v.eur.toFixed(2); });
    const ym = X.ymd(new Date()).slice(0, 7), pm = new Date(); pm.setDate(1); pm.setMonth(pm.getMonth() - 1); const pym = X.ymd(pm).slice(0, 7);
    const sum = f => list.filter(f).reduce((a, x) => ({ kwh: a.kwh + x.kwh, eur: a.eur + x.eur }), { kwh: 0, eur: 0 });
    const r = { days: list, devices: dev, month: sum(x => x.date.startsWith(ym)), prev: sum(x => x.date.startsWith(pym)), tariff: C.tariff, tracked: devs.length };
    enCache = { at: Date.now(), days, r }; return r;
  }
  let enAlerted = '';
  function energyAlert() {
    if (!C.tariff.alert) return; const d0 = new Date(); d0.setHours(0, 0, 0, 0); const span = Date.now() - +d0; if (span < 3 * 36e5 || enAlerted === X.ymd(d0)) return;
    const devs = Object.keys(E.devices).filter(id => ['plug', 'power'].includes(kind(id))); if (!devs.length) return;
    const tot = (a, b) => { const per = {}; let s = 0; devs.forEach(id => { const h = hourly(id, a, b); per[id] = Object.values(h).reduce((x, y) => x + y, 0); s += per[id]; }); return { s, per }; };
    const today = tot(+d0, Date.now()), past = []; for (let i = 1; i <= 7; i++) past.push(tot(+d0 - i * 864e5, +d0 - i * 864e5 + span).s);
    const avg = past.reduce((a, b) => a + b, 0) / 7; if (avg < 0.3 || !(today.s > avg * 1.5 && today.s - avg > 1)) return;
    enAlerted = X.ymd(d0); const top = Object.keys(today.per).sort((a, b) => today.per[b] - today.per[a])[0];
    X.note('Consommation inhabituelle : ' + today.s.toFixed(1) + ' kWh (habituellement ' + avg.toFixed(1) + ')', 'boltPlain');
    NOTIFY.notifyRule('energy', { title: 'Consommation inhabituelle', message: today.s.toFixed(1).replace('.', ',') + ' kWh depuis minuit, contre ' + avg.toFixed(1).replace('.', ',') + ' kWh d’habitude à cette heure. Le plus gourmand : ' + dname(top) + '.', go: 'energie', tags: ['zap'] });
  }

  /* ======================= 8. arrosage selon la météo ======================= */
  const W = { running: false, dev: '', until: 0, last: null };
  async function weather() {
    const h = X.home(), r = await fetch('https://api.open-meteo.com/v1/forecast?latitude=' + h.lat + '&longitude=' + h.lon + '&daily=precipitation_sum,temperature_2m_max&past_days=1&forecast_days=2&timezone=Europe%2FParis', { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error('Open-Meteo : HTTP ' + r.status); const d = (await r.json()).daily || {};
    return { past: +(d.precipitation_sum || [])[0] || 0, today: +(d.precipitation_sum || [])[1] || 0, tmax: +(d.temperature_2m_max || [])[1] };
  }
  async function waterDecide() {
    const w = C.water; let m;
    try { m = await weather(); } catch (e) { return { skip: false, why: 'météo indisponible (' + e.message + ') : arrosage quand même' }; }
    if (m.past >= w.rain) return Object.assign(m, { skip: true, why: 'il a plu ' + m.past.toFixed(1) + ' mm hier' });
    if (m.today >= w.fcst) return Object.assign(m, { skip: true, why: m.today.toFixed(1) + ' mm de pluie prévus aujourd’hui' });
    if (m.tmax < w.cold) return Object.assign(m, { skip: true, why: 'il fera frais (' + Math.round(m.tmax) + ' °C)' });
    return Object.assign(m, { skip: false, why: 'sec : ' + m.past.toFixed(1) + ' mm hier, ' + m.today.toFixed(1) + ' mm prévus, ' + Math.round(m.tmax) + ' °C' });
  }
  async function waterRun(by, force) {
    if (W.running) return; const w = C.water, devs = (w.devs || []).filter(id => E.devices[id]); if (!devs.length) return;
    const dec = force ? { skip: false, why: 'lancé à la main' } : await waterDecide(); W.last = Object.assign({ at: Date.now(), by }, dec);
    if (dec.skip) { X.note('Arrosage annulé : ' + dec.why, 'dropFill'); NOTIFY.notifyRule('water', { title: 'Arrosage annulé', message: dec.why.charAt(0).toUpperCase() + dec.why.slice(1), go: 'exterieur', tags: ['umbrella'] }); persist(); return; }
    W.running = true; X.note('Arrosage : ' + dec.why, 'dropFill');
    for (const id of devs) {
      if (!W.running) break;
      W.dev = id; W.until = Date.now() + (+w.dur || 15) * 6e4;
      try { await X.command(id, { on: true }); } catch (e) { X.note('⚠ Arrosage ' + dname(id) + ' : ' + e.message, 'alert'); continue; }
      while (W.running && Date.now() < W.until) await new Promise(r => setTimeout(r, 5000));
      await X.command(id, { on: false }).catch(() => { });
    }
    W.running = false; W.dev = ''; W.until = 0; persist();
  }

  /* ======================= 13. simulation de présence ======================= */
  const SIMF = path.join(X.HDIR, '_sim.jsonl'), simOn = new Set(), byUs = {};
  let simDone = [], simPlan = null;
  const simDevs = () => (C.sim.devs && C.sim.devs.length ? C.sim.devs : Object.keys(E.devices).filter(id => LIGHT.includes(kind(id)))).filter(id => E.devices[id]);
  const simActive = () => C.sim.mode === 'on' || (C.sim.mode === 'away' && NOTIFY.isAway());
  function simRecord(changes) {   // on apprend les habitudes : allumages et volets, hors simulation
    if (simActive()) return;
    const lines = changes.filter(({ id, p, c }) => (LIGHT.includes(kind(id)) && !!p.on !== !!c.on) || (kind(id) === 'cover' && p.pos !== c.pos)).filter(x => !(byUs[x.id] > Date.now() - 15000)).map(({ id, c }) => JSON.stringify([Math.round(Date.now() / 1000), id, c.on ? 1 : 0, c.pos != null ? c.pos : null]));
    if (lines.length) fs.appendFile(SIMF, lines.join('\n') + '\n', () => { });
  }
  function simEvents(from, to) { try { return fs.readFileSync(SIMF, 'utf8').split('\n').map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(x => x && x[0] * 1000 >= from && x[0] * 1000 < to); } catch (e) { return []; } }
  const jit = (e, max) => (parseInt(crypto.createHash('md5').update(e.join('|')).digest('hex').slice(0, 6), 16) % Math.max(1, max * 60)) * 1000;
  async function simDo(id, patch, why) { byUs[id] = Date.now(); if (patch.on) simOn.add(id); else simOn.delete(id); simDone.unshift({ t: Date.now(), id, name: dname(id), patch, why }); simDone.length = Math.min(simDone.length, 40); await X.command(id, patch).catch(() => { }); }
  function simTick(d) {
    if (!simActive()) { if (simOn.size) [...simOn].forEach(id => simDo(id, { on: false }, 'fin de la simulation')); simPlan = null; return; }
    const t = X.hm(d), devs = simDevs(), h = X.home(), s = X.sun(h.lat, h.lon, d), start = new Date(+s.set - 30 * 6e4);
    if (t === C.sim.end) { [...simOn].forEach(id => simDo(id, { on: false }, 'coucher')); return; }
    if (d < start || t > C.sim.end) return;
    // rejouer les gestes de la même heure, une semaine plus tôt (ou deux), décalés de quelques minutes
    const now = +d, j = (+C.sim.jitter || 10);
    for (const back of [7, 14]) {
      const ref = now - back * 864e5, evs = simEvents(ref - j * 6e4 - 6e4, ref + 6e4).filter(e => devs.includes(e[1]));
      if (!simEvents(now - back * 864e5 - 12 * 36e5, now - back * 864e5 + 12 * 36e5).length) continue;   // rien d'enregistré ce jour-là
      evs.filter(e => { const at = e[0] * 1000 + jit(e, j); return at >= ref - 6e4 && at < ref; }).forEach(e => simDo(e[1], e[3] != null && kind(e[1]) === 'cover' ? { pos: e[3] } : { on: !!e[2] }, 'comme le ' + new Date(e[0] * 1000).toLocaleDateString('fr-FR', { weekday: 'long' })));
      return;
    }
    // pas encore d'habitudes : petit scénario de soirée
    const day = X.ymd(d);
    if (!simPlan || simPlan.day !== day) {
      const live = devs.filter(id => /salon|séjour|sejour|cuisine|entrée/i.test(E.devices[id].room || '')), bed = devs.filter(id => /chambre|suite/i.test(E.devices[id].room || ''));
      const at = (base, add) => X.hm(new Date(+base + add * 6e4)), r = () => Math.floor(Math.random() * j);
      const end = new Date(d); end.setHours(+C.sim.end.slice(0, 2), +C.sim.end.slice(3), 0, 0);
      const plan = [];
      (live.length ? live : devs).slice(0, 2).forEach((id, i) => { plan.push({ at: at(start, 15 + r() + i * 7), id, patch: { on: true } }); plan.push({ at: at(end, -60 - r()), id, patch: { on: false } }); });
      bed.slice(0, 1).forEach(id => { plan.push({ at: at(end, -70 + r()), id, patch: { on: true } }); plan.push({ at: at(end, -10 - r()), id, patch: { on: false } }); });
      simPlan = { day, plan, set: {} };
    }
    // état voulu pour chaque appareil = dernier pas du scénario déjà passé (utile si l'absence commence en pleine soirée)
    [...new Set(simPlan.plan.map(p => p.id))].forEach(id => { const p = simPlan.plan.filter(x => x.id === id && x.at <= t).sort((a, b) => a.at < b.at ? -1 : 1).pop(); if (p && simPlan.set[id] !== p.patch.on) { simPlan.set[id] = p.patch.on; simDo(id, p.patch, 'scénario de soirée'); } });
  }
  setInterval(() => { try { const from = Date.now() - 35 * 864e5, l = simEvents(from, Date.now() + 1); fs.writeFileSync(SIMF, l.map(x => JSON.stringify(x)).join('\n') + (l.length ? '\n' : '')); } catch (e) { } }, 24 * 36e5);

  /* ======================= 14. détection de personnes (Frigate) ======================= */
  const seen = new Set(), recent = [], coolT = {}; let detAfter = Date.now() / 1000 - 30;
  async function detectTick() {
    if (!on('detection') || !C.detect.on || !HUB.configured().includes('frigate')) return;
    const F = HUB.brand('frigate'), fc = HUB.cfg('frigate'); let evs;
    try { evs = await F.events(fc, detAfter - 60); } catch (e) { return; }
    for (const e of (evs || []).slice().reverse()) {
      if (seen.has(e.id)) continue;
      const cc = C.detect.cams[e.camera] || {}, labels = cc.labels && cc.labels.length ? cc.labels : C.detect.labels;
      if (cc.off || !labels.includes(e.label)) { seen.add(e.id); continue; }
      const zones = e.zones || (e.data && e.data.zones) || [];
      if (cc.zones && cc.zones.length && !zones.some(z => cc.zones.includes(z))) { if (e.end_time) seen.add(e.id); continue; }   // pas encore dans la zone choisie
      seen.add(e.id); detAfter = Math.max(detAfter, e.start_time || 0);
      const lbl = F.LBL[e.label] || e.label, cam = String(e.camera).replace(/_/g, ' ');
      recent.unshift({ t: Math.round((e.start_time || Date.now() / 1000) * 1000), id: e.id, cam: e.camera, label: e.label, zones }); recent.length = Math.min(recent.length, 30);
      X.dispatch({ type: 'detect', cam: e.camera, label: e.label, why: lbl + ' — ' + cam }); X.emit({ type: 'detect', cam: e.camera, label: e.label });
      if (cc.alarm && e.label === 'person' && X.S.alarm.status === 'armed') X.trigger('Personne détectée : ' + cam);
      const k = e.camera + ':' + e.label;
      if ((C.detect.away && !NOTIFY.isAway()) || Date.now() - (coolT[k] || 0) < (+C.detect.cool || 3) * 6e4) continue;
      coolT[k] = Date.now();
      const img = await F.snap(fc, e.id).catch(() => null);
      NOTIFY.notifyRule('person', { title: lbl.charAt(0).toUpperCase() + lbl.slice(1) + ' — ' + cam, message: 'Détecté à ' + X.hm(new Date()) + (zones.length ? ' (' + zones.join(', ') + ')' : ''), image: img && img.length > 500 ? img : undefined, go: 'exterieur', urgent: 1, tags: [e.label === 'car' ? 'red_car' : e.label === 'package' ? 'package' : 'bust_in_silhouette'] });
    }
    if (seen.size > 2000) [...seen].slice(0, 1000).forEach(x => seen.delete(x));
  }
  setInterval(() => detectTick().catch(() => { }), 10000);

  /* ======================= 11-12. listes partagées et messages sur les tablettes ======================= */
  const board = () => (C.board = C.board.filter(m => !m.until || m.until > Date.now()));
  function listOp(b) {
    const L = C.lists[b.list]; if (!L) throw new Error('liste inconnue');
    if (b.op === 'add') { const text = String(b.text || '').trim().slice(0, 140); if (!text) throw new Error('texte vide'); text.split(/\s*(?:,|\bet\b)\s*/).filter(Boolean).slice(0, 10).forEach(t => { if (!L.some(x => !x.done && x.text.toLowerCase() === t.toLowerCase())) L.push({ id: uid(), text: t.charAt(0).toUpperCase() + t.slice(1), done: false, by: String(b.by || '').slice(0, 40), who: b.who || '', due: b.due || '', at: Date.now() }); }); X.dispatch({ type: 'list', list: b.list, why: 'ajout à la liste ' + b.list }); }
    else if (b.op === 'toggle') { const x = L.find(i => i.id === b.id); if (x) { x.done = !x.done; x.doneAt = Date.now(); x.doneBy = b.by || ''; } }
    else if (b.op === 'edit') { const x = L.find(i => i.id === b.id); if (x) ['text', 'who', 'due'].forEach(k => { if (b[k] !== undefined) x[k] = String(b[k]).slice(0, 140); }); }
    else if (b.op === 'del') C.lists[b.list] = L.filter(i => i.id !== b.id);
    else if (b.op === 'clear') C.lists[b.list] = L.filter(i => !i.done);
    persist(); X.emit({ type: 'lists' });
  }
  function boardAdd(b) { const text = String(b.text || '').trim().slice(0, 200); if (!text) throw new Error('message vide'); board().unshift({ id: uid(), text, by: String(b.by || '').slice(0, 40), at: Date.now(), until: Date.now() + Math.min(+b.hours || 12, 24 * 14) * 36e5, color: b.color || '' }); C.board.length = Math.min(C.board.length, 20); persist(); X.emit({ type: 'lists' }); X.emit({ type: 'say', text: 'Nouveau message' + (b.by ? ' de ' + b.by : '') + ' : ' + text, board: true }); }

  /* ======================= actions et conditions des règles « Si… alors… » ======================= */
  X.EXT.acts.scene = (a, rule) => runScene(a.id, rule.name);
  X.EXT.acts.list = a => listOp({ op: 'add', list: a.list || 'courses', text: a.text, by: 'Bêta' });
  X.EXT.acts.board = a => boardAdd({ text: a.text, by: 'Bêta', hours: a.hours || 6 });
  X.EXT.acts.heat = a => { const z = C.heat.zones.find(x => x.id === a.zone); if (z) { z.mode = a.mode || 'auto'; if (a.mode === 'boost') { z.mode = 'auto'; z.boost = Date.now() + 36e5; } persist(); heatTick(new Date()); } };
  X.EXT.acts.water = () => { waterRun('règle'); };
  X.EXT.conds.sim = c => simActive() === (c.is !== false);
  X.EXT.claims = X.EXT.claims || [];
  X.EXT.claims.push(() => (C.heat.zones || []).filter(z => z.on !== false).flatMap(z => (z.devs || []).map(dev => ({ dev, by: 'Chauffage « ' + (z.name || 'zone') + ' »' }))).concat(C.water.on ? (C.water.devs || []).map(dev => ({ dev, by: 'Arrosage' })) : []));

  /* ======================= boucle (toutes les 4 s, travaux à la minute) ======================= */
  X.EXT.tick.push(({ changes, now, t, minute }) => {
    simRecord(changes); adaptTrack(changes);
    if (!minute) return;
    if (X.S.tempo && X.S.tempo.today) { const k = X.S.tempo.date ? String(X.S.tempo.date).slice(0, 10) : X.ymd(new Date(Date.now() - 6 * 36e5)); if (C.tempoDays[k] !== X.S.tempo.today) { C.tempoDays[k] = X.S.tempo.today; const ks = Object.keys(C.tempoDays).sort(); ks.slice(0, Math.max(0, ks.length - 400)).forEach(x => delete C.tempoDays[x]); persist(); } }
    if (on('chauffage')) heatTick(now);
    if (on('simulation')) simTick(now);
    if (on('scenes')) adaptTick();
    if (on('energie') && /:05$/.test(t)) energyAlert();
    if (C.backup.auto && t === (C.backup.at || '03:30')) autoBackup();
    const w = C.water; if (on('arrosage') && w.on && (w.times || []).includes(t) && (!w.days || !w.days.length || w.days.includes(now.getDay()))) waterRun('programmé');
  });

  /* ======================= API ======================= */
  const view = () => Object.assign({}, C, { backup: Object.assign({}, C.backup, { pass: C.backup.pass ? '••••' : '' }), lists: undefined, board: undefined, tempoDays: undefined });
  const tok = s => s ? String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '') : '';
  const findBy = (list, q) => list.find(x => x.id === q) || list.find(x => tok(x.name) === tok(q)) || list.find(x => tok(x.name).includes(tok(q)));
  async function quick(url, w) {   // Siri, Raccourcis, widgets : une adresse simple, réponse à lire à voix haute
    const q = k => url.searchParams.get(k) || '', what = q('do') || 'status', by = q('by') || w.device || 'iPhone';
    if (what === 'status') {
      const temps = Object.keys(E.devices).filter(id => kind(id) === 'temp' && cur()[id] && cur()[id].val != null && !/ext|jardin|terrasse|dehors/i.test(E.devices[id].room || '')).map(id => +cur()[id].val);
      const pres = Object.values(X.S.presence || {}), al = X.S.alarm.status, tr = (await X.trashDays(2)).filter(e => e.date === X.ymd(new Date(Date.now() + 864e5)));
      const r = { alarm: al, away: NOTIFY.isAway(), home: pres.filter(Boolean).length, people: pres.length, temp: temps.length ? +(temps.reduce((a, b) => a + b, 0) / temps.length).toFixed(1) : null, tempo: X.S.tempo, trash: tr.map(e => e.name), courses: C.lists.courses.filter(x => !x.done).length, tasks: C.lists.taches.filter(x => !x.done).length, message: (board()[0] || {}).text || '' };
      r.say = 'Alarme ' + ({ disarmed: 'désactivée', armed: 'activée', arming: 'en cours d’activation', entry: 'en attente du code', triggered: 'DÉCLENCHÉE' }[al] || al) + '. ' + (r.people ? r.home + ' personne' + (r.home > 1 ? 's' : '') + ' à la maison. ' : '') + (r.temp != null ? 'Il fait ' + String(r.temp).replace('.', ',') + ' degrés. ' : '') + (r.trash.length ? 'Ce soir, sortir : ' + r.trash.join(', ') + '. ' : '') + (r.courses ? r.courses + ' article' + (r.courses > 1 ? 's' : '') + ' sur la liste de courses.' : '');
      return r;
    }
    if (what === 'list') return { routines: E.routines.map(r => ({ id: r.id, name: r.name })), scenes: C.scenes.map(s => ({ id: s.id, name: s.name, room: s.room })), zones: C.heat.zones.map(z => ({ id: z.id, name: z.name })), lists: Object.keys(C.lists), devices: Object.keys(E.devices).map(id => ({ id, name: E.devices[id].name, room: E.devices[id].room })) };
    if (what === 'routine') { const r = findBy(E.routines, q('id') || q('name')); if (!r) throw new Error('routine introuvable'); await X.runRoutine(r.id, by); return { ok: true, say: 'Routine ' + r.name + ' lancée.' }; }
    if (what === 'scene') { const s = q('room') && !q('id') ? sceneFor(q('room')) : findBy(C.scenes, q('id') || q('name')); if (!s) throw new Error('scène introuvable'); await runScene(s.id, by); return { ok: true, say: 'Scène ' + s.name + '.' }; }
    if (what === 'add') { const list = /t[aâ]che/i.test(q('list')) ? 'taches' : 'courses'; listOp({ op: 'add', list, text: q('text'), by }); return { ok: true, say: q('text') + ' ajouté à la liste ' + (list === 'courses' ? 'de courses' : 'des tâches') + '.' }; }
    if (what === 'courses') { const l = C.lists.courses.filter(x => !x.done); return { items: l.map(x => x.text), say: l.length ? 'Sur la liste : ' + l.map(x => x.text).join(', ') + '.' : 'La liste de courses est vide.' }; }
    if (what === 'msg') { boardAdd({ text: q('text'), by, hours: q('hours') || 12 }); return { ok: true, say: 'Message affiché sur les tablettes.' }; }
    if (what === 'alarm') {
      const mode = q('mode') || 'armed_away';
      if (mode === 'disarmed') { const u = q('user'), pin = q('pin'); if (!((u && pin && AUTH.checkPin(u, pin)) || (E.alarm.code && pin === String(E.alarm.code)))) throw new Error('code refusé'); }
      if (!E.alarm.on) throw new Error('alarme non configurée'); X.setAlarm(mode, by); return { ok: true, say: mode === 'disarmed' ? 'Alarme désactivée.' : 'Alarme activée' + (mode === 'armed_night' ? ' pour la nuit.' : '.') };
    }
    if (what === 'toggle' || what === 'on' || what === 'off') {
      const ids = Object.keys(E.devices), id = ids.find(i => i === q('dev')) || ids.find(i => tok(E.devices[i].name) === tok(q('dev'))) || ids.find(i => tok(E.devices[i].name).includes(tok(q('dev')))); if (!id) throw new Error('appareil introuvable');
      const s = cur()[id] || {}, k = kind(id), on = what === 'toggle' ? !(s.on || s.pos > 0) : what === 'on';
      await X.command(id, ['cover', 'awning', 'garage'].includes(k) ? { pos: on ? 100 : 0 } : k === 'lock' ? { locked: !on } : { on }); return { ok: true, say: E.devices[id].name + (on ? ' allumé' : ' éteint') + '.' };
    }
    if (what === 'heat') { const z = findBy(C.heat.zones, q('id') || q('name')); if (!z) throw new Error('zone introuvable'); X.EXT.acts.heat({ zone: z.id, mode: q('mode') || 'boost' }); return { ok: true, say: 'Chauffage ' + z.name + ' : ' + ({ boost: 'boost pour une heure', comfort: 'confort', eco: 'éco', off: 'arrêt', auto: 'automatique', frost: 'hors-gel' }[q('mode') || 'boost'] || q('mode')) + '.' }; }
    const ex = X.EXT.quick && X.EXT.quick(what, q); if (ex) return ex;
    throw new Error('action inconnue : ' + what);
  }
  async function api(req, res, url, w) {
    const p = url.pathname, m = req.method;
    if (p === '/api/quick') { try { const r = await quick(url, w || {}); return url.searchParams.get('fmt') === 'text' ? send(res, 200, r.say || 'OK', 'text/plain; charset=utf-8') : send(res, 200, r); } catch (e) { return url.searchParams.get('fmt') === 'text' ? send(res, 400, e.message, 'text/plain; charset=utf-8') : send(res, 400, { error: e.message, say: e.message }); } }
    if (p === '/api/energy' && m === 'GET') return send(res, 200, energy(Math.min(Math.max(+url.searchParams.get('days') || 62, 7), 400)));
    if (p === '/api/plus' && m === 'GET') return send(res, 200, Object.assign(view(), { state: { heat: heatState, water: W, sim: { active: simActive(), done: simDone.slice(0, 15), learned: simEvents(Date.now() - 14 * 864e5, Date.now() + 1).length }, detect: recent.slice(0, 15), moment: moment(), version: SHA, update: upd, watchtower: !!WTK, backups: listBackups() } }));
    if (p === '/api/plus' && m === 'PUT') {
      const b = await readBody(req) || {};
      ['scenes', 'off'].forEach(k => { if (Array.isArray(b[k])) C[k] = b[k]; }); syncOff();
      ['adaptive', 'heat', 'water', 'sim', 'detect', 'tariff'].forEach(k => { if (b[k] && typeof b[k] === 'object') C[k] = Object.assign(C[k], b[k]); });
      if (b.backup) { const old = C.backup.pass; C.backup = Object.assign(C.backup, b.backup); if (b.backup.pass === '••••' || b.backup.pass == null) C.backup.pass = old; }
      // listes attendues : une valeur d'un autre type est remplacée par une liste vide (évite de casser les tâches du NAS)
      [[C.heat, 'zones'], [C.water, 'devs'], [C.water, 'times'], [C.water, 'days'], [C.sim, 'devs'], [C.detect, 'labels'], [C.adaptive, 'rooms']].forEach(([o, k]) => { if (!Array.isArray(o[k])) o[k] = []; });
      if (!C.detect.cams || typeof C.detect.cams !== 'object') C.detect.cams = {};
      enCache.at = 0; persist(); if (b.heat) heatTick(new Date());
      return send(res, 200, view());
    }
    if (p === '/api/plus/backup' && m === 'POST') { const b = await readBody(req) || {}; if (String(b.pass || '').length < 6) return send(res, 400, { error: 'mot de passe de 6 caractères au moins' }); const o = collect(b.history !== false); if (b.client) o.client = b.client; return send(res, 200, encrypt(o, b.pass)); }
    if (p === '/api/plus/restore' && m === 'POST') {
      const b = await readBody(req) || {}; let o; try { o = decrypt(typeof b.blob === 'string' ? JSON.parse(b.blob) : b.blob, b.pass || ''); } catch (e) { return send(res, 400, { error: e.message }); }
      if (b.check) return send(res, 200, { ok: true, at: o.at, files: Object.keys(o.files || {}).length, client: !!o.client });
      const n = restore(o); send(res, 200, { ok: true, files: n, client: o.client || null, restart: true });
      console.log('Restauration de ' + n + ' fichier(s) : redémarrage du serveur Bêta…'); setTimeout(() => process.exit(0), 1500); return;
    }
    let r;
    if ((r = p.match(/^\/api\/plus\/backups\/([\w.-]+)$/)) && m === 'GET') { const f = path.join(DATA, 'backups', r[1]); return /^auto-/.test(r[1]) && fs.existsSync(f) ? send(res, 200, fs.readFileSync(f)) : send(res, 404, { error: 'introuvable' }); }
    if (p === '/api/plus/backup/now' && m === 'POST') { autoBackup(); return send(res, 200, C.backup.last || {}); }
    if (p === '/api/plus/update' && m === 'GET') { const u = await checkUpdate(url.searchParams.get('force') === '1'); return send(res, 200, { current: SHA, repo: REPO, branch: BRANCH, latest: u.latest || null, err: u.err || '', upToDate: !!(u.latest && SHA !== 'dev' && u.latest.sha.startsWith(SHA)), watchtower: !!WTK }); }
    if (p === '/api/plus/update' && m === 'POST') {
      if (!WTK) return send(res, 400, { error: 'Watchtower n’est pas installé (voir docker-compose.yml)' });
      try { const rr = await fetch(WT + '/v1/update', { headers: { Authorization: 'Bearer ' + WTK }, signal: AbortSignal.timeout(8000) }); if (!rr.ok) throw new Error('Watchtower : HTTP ' + rr.status); } catch (e) { if (e.name !== 'TimeoutError') return send(res, 502, { error: e.message }); }
      X.note('Mise à jour demandée', 'download'); return send(res, 200, { ok: true });
    }
    if (p === '/api/plus/scene' && m === 'POST') { const b = await readBody(req) || {}; try { const s = b.room && !b.id ? sceneFor(b.room) : null; await runScene(s ? s.id : b.id, b.by); return send(res, 200, { ok: true, id: s ? s.id : b.id }); } catch (e) { return send(res, 404, { error: e.message }); } }
    if (p === '/api/plus/heat/mode' && m === 'POST') { const b = await readBody(req) || {}; X.EXT.acts.heat({ zone: b.id, mode: b.mode }); return send(res, 200, { zones: C.heat.zones, state: heatState }); }
    if (p === '/api/plus/water/check' && m === 'POST') return send(res, 200, await waterDecide());
    if (p === '/api/plus/water/run' && m === 'POST') { const b = await readBody(req) || {}; waterRun(b.by || 'écran', b.force !== false); return send(res, 200, { ok: true }); }
    if (p === '/api/plus/water/stop' && m === 'POST') { W.running = false; return send(res, 200, { ok: true }); }
    if (p === '/api/plus/detect/cams' && m === 'GET') {
      if (!HUB.configured().includes('frigate')) return send(res, 200, { cams: [], err: 'Frigate n’est pas relié (Marques › Frigate)' });
      try { const cfg = await HUB.brand('frigate').config(HUB.cfg('frigate')); return send(res, 200, { cams: Object.keys(cfg.cameras || {}).map(id => ({ id, zones: Object.keys((cfg.cameras[id] || {}).zones || {}), track: (((cfg.cameras[id] || {}).objects || {}).track) || ['person'] })) }); } catch (e) { return send(res, 200, { cams: [], err: e.message }); }
    }
    if (p === '/api/plus/lists' && m === 'GET') return send(res, 200, { lists: C.lists, board: board() });
    if (p === '/api/plus/lists' && m === 'POST') { const b = await readBody(req) || {}; try { listOp(b); } catch (e) { return send(res, 400, { error: e.message }); } return send(res, 200, { lists: C.lists, board: board() }); }
    if (p === '/api/plus/board' && m === 'POST') { const b = await readBody(req) || {}; try { if (b.del) C.board = C.board.filter(x => x.id !== b.del); else boardAdd(b); } catch (e) { return send(res, 400, { error: e.message }); } persist(); X.emit({ type: 'lists' }); return send(res, 200, { board: board() }); }
    return false;
  }
  function listBackups() { try { return fs.readdirSync(path.join(DATA, 'backups')).filter(n => /^auto-/.test(n)).sort().reverse().slice(0, 30).map(n => ({ name: n, size: fs.statSync(path.join(DATA, 'backups', n)).size, enc: /\.betabak$/.test(n) })); } catch (e) { return []; } }
  syncOff(); setTimeout(() => checkUpdate().catch(() => { }), 20000);
  return { api, C, energy, runScene, _test: { moment, price, hourly, energy, heatTarget, waterDecide, encrypt, decrypt, collect, simTick, C } };
};

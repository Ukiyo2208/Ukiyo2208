/* Bêta OS — journal des actions (qui, quoi, quand, météo, saison), export CSV et suggestions
   de routines/automatismes tirées des habitudes de chaque utilisateur. */
(function () {
  const B = window.BOS, { S, DATA, esc, F, T, RENDER, box, WX } = B;
  const BG = 'assets/bg/generic.jpg', MAX = 6000;
  if (!Array.isArray(S.journal)) S.journal = [];
  const SEASON = { printemps: 'Printemps', ete: 'Été', automne: 'Automne', hiver: 'Hiver' };
  const SRC = { ui: 'Écran', ia: 'Bêta IA', routine: 'Routine', auto: 'Automatisme', scene: 'Action rapide', ha: 'Home Assistant', timer: 'Minuterie', voice: 'Voix' };

  /* ---------- contexte : d'où vient l'action ---------- */
  const wrapAct = (names, src) => names.forEach(n => { const f = B.ACT[n]; if (!f) return; B.ACT[n] = (el, e) => { const p = B.src; B.src = B.src || src; try { return f(el, e); } finally { setTimeout(() => { B.src = p; }, 0); } }; });
  wrapAct(['ia', 'iaHome', 'iaAsk', 'iaPage', 'iaSheetSend', 'iaChip'], 'ia');
  wrapAct(['scene'], 'scene');
  wrapAct(['routine', 'lockRoutine'], 'routine');
  if (B.runRoutine) { const r0 = B.runRoutine; B.runRoutine = (id, q) => { const p = B.src; B.src = B.src || 'routine'; try { return r0(id, q); } finally { B.src = p; } }; }

  /* ---------- description lisible d'un changement ---------- */
  function describe(d, p) {
    if ('on' in p) return [p.on ? 'on' : 'off', p.on ? (d.type === 'valve' || d.type === 'sprinkler' ? 'ouvert' : 'allumé') : (d.type === 'valve' || d.type === 'sprinkler' ? 'fermé' : 'éteint')];
    if (p.moving === 'up') return ['open', 'ouverture'];
    if (p.moving === 'down') return ['close', 'fermeture'];
    if ('pos' in p) return p.pos >= 100 ? ['open', 'ouvert'] : p.pos <= 0 ? ['close', 'fermé'] : ['pos', 'position ' + p.pos + ' %'];
    if ('temp' in p) return ['temp', 'consigne ' + String(p.temp).replace('.', ',') + ' °C'];
    if ('locked' in p) return [p.locked ? 'lock' : 'unlock', p.locked ? 'verrouillé' : 'déverrouillé'];
    if ('mode' in p) return ['mode', 'mode ' + p.mode];
    if ('status' in p) return ['status', ({ cleaning: 'nettoyage lancé', returning: 'retour base', zone: 'nettoyage zone', docked: 'à la base', mowing: 'tonte lancée' })[p.status] || p.status];
    if ('color' in p) return ['color', 'couleur ' + p.color];
    if ('bri' in p) return ['bri', 'luminosité ' + p.bri + ' %'];
    if ('vol' in p) return ['vol', 'volume ' + p.vol + ' %'];
    if ('src' in p) return ['src', 'source ' + p.src];
    if ('hvac' in p) return ['hvac', 'mode ' + p.hvac];
    if ('preset' in p) return ['preset', 'préréglage ' + p.preset];
    if (p.run) return ['run', 'lancée'];
    if (p.cmd) return ['cmd', p.cmd.replace('media_', '').replace(/_/g, ' ')];
    return null;
  }
  const IGNORE = new Set(['moving', 'bat', 'lit', 'cur', 'title', 'srcs', 'unit', 'val', 'offAt', 'code', 'kw', 'car', 'modes', 'presets', 'fanms', 'swings', 'action', 'min', 'max', 'step', 'curhum', 'effects', 'kmin', 'kmax', 'cmodes', 'favs']);
  function add(e) {
    S.journal.unshift(e);
    if (S.journal.length > MAX) S.journal.length = MAX;
    B.save(); B.emit('journal');
    if (pending) pending.push(e);
  }
  function ctx() {
    const u = B.user();
    return { u: u.id, un: u.name, temp: WX.now.temp, wc: WX.now.code, wx: B.wxText(WX.now.code), se: B.fx ? B.fx.season() : '', night: B.isNight() };
  }
  B.on('dev', ({ id, patch, silent }) => {
    const d = DATA.DEVICES[id]; if (!d) return;
    const keys = Object.keys(patch).filter(k => !IGNORE.has(k) || (k === 'moving' && (patch.moving === 'up' || patch.moving === 'down')));
    if (!keys.length) return;
    const src = B.src || (silent && !(patch.moving === 'up' || patch.moving === 'down') ? null : 'ui');
    if (!src) return;
    const ds = describe(d, patch); if (!ds) return;
    add(Object.assign({ t: Date.now(), d: id, n: d.name, r: d.room, f: B.floorOf ? B.floorOf(id) : '', a: ds[0], txt: ds[1], src }, ctx()));
  });
  // musique et Plex
  if (B.Music) { const p0 = B.Music.play.bind(B.Music); B.Music.play = function (id) { const r = p0(id); const s = this.cur(); add(Object.assign({ t: Date.now(), d: 'music', n: 'Musique', r: '', a: 'play', txt: 'lecture « ' + s.name + ' »', src: B.src || 'ui', v: s.id }, ctx())); return r; }; }

  const J = {
    all: () => S.journal,
    forDev(id, days) { const t0 = new Date(); t0.setHours(0, 0, 0, 0); const lim = +t0 - ((days || 1) - 1) * 864e5; return S.journal.filter(e => e.d === id && e.t >= lim); },
    add
  };
  B.Journal = J;

  /* ---------- analyse des habitudes ---------- */
  const isWE = t => [0, 6].includes(new Date(t).getDay());
  const mins = t => { const d = new Date(t); return d.getHours() * 60 + d.getMinutes(); };
  const hhmm = m => String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(Math.round(m % 60 / 5) * 5 % 60).padStart(2, '0');
  function analyze() {
    const human = S.journal.filter(e => ['ui', 'ia', 'voice'].includes(e.src) && DATA.DEVICES[e.d] && ['on', 'off', 'open', 'close', 'lock', 'unlock', 'status'].includes(e.a));
    const groups = {};
    human.forEach(e => { const k = e.u + '|' + e.d + '|' + e.a + (e.a === 'status' ? ':' + e.txt : ''); (groups[k] = groups[k] || []).push(e); });
    const out = [];
    Object.entries(groups).forEach(([k, list]) => {
      const [u, id, a] = k.split('|');
      [['wd', 'en semaine', [1, 2, 3, 4, 5]], ['we', 'le week-end', [0, 6]]].forEach(([dt, label, days]) => {
        const pts = list.filter(e => (dt === 'we') === isWE(e.t)).map(e => ({ m: mins(e.t), day: F.ymd(new Date(e.t)), e })).sort((x, y) => x.m - y.m);
        let best = null;
        for (let i = 0; i < pts.length; i++) {
          const win = pts.filter(p => p.m >= pts[i].m && p.m <= pts[i].m + 40), dset = new Set(win.map(p => p.day));
          if (dset.size >= 3 && (!best || dset.size > best.days.size)) best = { win, days: dset };
        }
        if (!best) return;
        const ms = best.win.map(p => p.m).sort((x, y) => x - y), med = ms[Math.floor(ms.length / 2)];
        const spanDays = new Set(S.journal.filter(e => (dt === 'we') === isWE(e.t)).map(e => F.ymd(new Date(e.t)))).size || 1;
        const conf = Math.min(1, best.days.size / Math.max(3, spanDays));
        const e0 = best.win[0].e, rain = best.win.filter(p => p.e.wc >= 51).length / best.win.length;
        const exists = (S.autos || []).some(x => x.act && x.act.type === 'device' && x.act.v === id && x.act.a === a && x.trig.v === hhmm(med));
        out.push({ key: k + '|' + dt, u, un: e0.un, id, a, name: e0.n, room: e0.r, txt: e0.txt, at: hhmm(med), days, label, n: best.days.size, conf, rain, exists });
      });
    });
    // tendances liées à la météo (information)
    const hot = human.filter(e => DATA.DEVICES[e.d].type === 'clim' && e.a === 'on');
    if (hot.length >= 3) { const avg = hot.reduce((s, e) => s + (e.temp || 0), 0) / hot.length; out.push({ info: true, key: 'clim-temp', un: 'Toute la famille', txt: 'La clim est souvent allumée quand il fait environ ' + Math.round(avg) + ' °C dehors.', conf: .6 }); }
    const rainLights = human.filter(e => e.a === 'on' && e.wc >= 51 && !e.night && DATA.DEVICES[e.d].type === 'light');
    if (rainLights.length >= 3) out.push({ info: true, key: 'rain-light', un: 'Toute la famille', txt: 'Les lumières sont allumées en journée quand il pleut (' + rainLights.length + ' fois) : une automatisation « pluie → lumières du salon » pourrait aider.', conf: .5 });
    return out.sort((x, y) => (y.conf - x.conf) || ((y.n || 0) - (x.n || 0)));
  }
  B.analyzeHabits = analyze;

  /* ---------- page Journal ---------- */
  let flt = { u: '', f: '', q: '', p: 7 };
  RENDER.jlist = () => {
    const lim = Date.now() - flt.p * 864e5, q = flt.q.toLowerCase();
    const list = S.journal.filter(e => e.t >= lim && (!flt.u || e.u === flt.u) && (!flt.f || e.f === flt.f) && (!q || (e.n + ' ' + e.r + ' ' + e.txt).toLowerCase().includes(q))).slice(0, 400);
    const users = S.users.map(u => '<option value="' + u.id + '"' + (flt.u === u.id ? ' selected' : '') + '>' + esc(u.name) + '</option>').join('');
    const fls = (B.floors ? B.floors(true) : []).map(f => '<option value="' + f.id + '"' + (flt.f === f.id ? ' selected' : '') + '>' + esc(f.name) + '</option>').join('');
    let lastDay = '';
    return '<div class="row jfilt"><select class="search" data-change="jF" data-k="u"><option value="">Tout le monde</option>' + users + '</select><select class="search" data-change="jF" data-k="f"><option value="">Tous les niveaux</option>' + fls + '</select>' +
      '<select class="search" data-change="jF" data-k="p">' + [[1, 'Aujourd’hui'], [7, '7 jours'], [30, '30 jours'], [365, 'Tout']].map(o => '<option value="' + o[0] + '"' + (flt.p === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select>' +
      '<input class="search" placeholder="Rechercher…" value="' + esc(flt.q) + '" data-change="jF" data-k="q"></div>' +
      '<div class="jtable scroll">' + (list.length ? list.map(e => { const d = new Date(e.t), day = F.dayMonth(d); const h = day !== lastDay ? '<div class="jday">' + day + '</div>' : ''; lastDay = day;
        return h + '<div class="jrow"><span class="jt">' + F.time(d) + '</span><span class="ju">' + esc(e.un || '') + '</span><span class="jd"><b>' + esc(e.n) + '</b> ' + esc(e.txt) + '<small>' + esc(e.r || '') + '</small></span><span class="jw" title="' + esc(e.wx || '') + '">' + ico(B.wxIcon(e.wc || 0, e.night)) + (e.temp != null ? e.temp + '°' : '') + '</span><span class="js">' + esc(SEASON[e.se] || '') + '</span><span class="jsrc">' + esc(SRC[e.src] || e.src) + '</span></div>'; }).join('') : '<p class="muted" style="padding:10px">Aucune action pour ces filtres. Chaque geste dans Bêta OS (et chaque changement venant de Home Assistant) s’inscrit ici.</p>') + '</div>' +
      '<div class="row" style="margin-top:10px;gap:8px;flex-wrap:wrap"><button class="btn sm" data-act="jCsv">' + ico('download') + 'Exporter (CSV)</button><button class="btn sm" data-act="jJson">' + ico('files') + 'Exporter (JSON)</button>' +
      (B.isAdmin && B.isAdmin() ? '<span style="flex:1"></span><button class="btn sm" data-act="jDemo">' + ico('sparkle') + 'Simuler 3 semaines</button><button class="btn sm dan" data-act="jClear">' + ico('trash') + 'Vider</button>' : '') + '</div>';
  };
  RENDER.jsugg = () => {
    const sug = analyze();
    if (!sug.length) return '<div class="hint2">' + ico('sparkle') + '<p>Bêta IA cherche vos habitudes : quand la même action revient au même moment au moins 3 jours, elle vous propose de l’automatiser. Utilisez la maison normalement quelques jours' + (B.isAdmin && B.isAdmin() ? ', ou touchez « Simuler 3 semaines » pour voir le principe' : '') + '.</p></div>';
    return '<div class="list scroll" style="flex:1">' + sug.map(s => s.info ? '<div class="sug info">' + ico('info') + '<div><b>' + esc(s.un) + '</b><span>' + esc(s.txt) + '</span></div></div>'
      : '<div class="sug">' + ico(B.iconOf ? B.iconOf(DATA.DEVICES[s.id]) : 'sparkle') + '<div><b>' + esc(s.un) + ' · ' + esc(s.name) + ' (' + esc(s.room) + ')</b><span>« ' + esc(s.txt) + ' » vers <b>' + s.at + '</b> ' + s.label + ' — ' + s.n + ' jours observés' + (s.rain > .6 ? ', surtout quand il pleut' : '') + '</span><i class="conf"><b style="width:' + Math.round(s.conf * 100) + '%"></b></i></div>' +
        (s.exists ? '<span class="tag2">Déjà créé</span>' : '<button class="btn sm pri" data-act="jMake" data-arg="' + esc(s.key) + '">' + ico('plus') + 'Automatiser</button>') + '</div>').join('') + '</div>';
  };
  RENDER.jstats = () => {
    const wk = S.journal.filter(e => e.t > Date.now() - 7 * 864e5), by = {};
    wk.forEach(e => { by[e.un] = (by[e.un] || 0) + 1; });
    const top = {}; wk.forEach(e => { if (DATA.DEVICES[e.d]) top[e.n + ' · ' + e.r] = (top[e.n + ' · ' + e.r] || 0) + 1; });
    const mx = Math.max(1, ...Object.values(by)), tops = Object.entries(top).sort((a, b) => b[1] - a[1]).slice(0, 4);
    return '<div class="jstats"><div>' + (Object.keys(by).length ? Object.entries(by).sort((a, b) => b[1] - a[1]).map(([n, c]) => '<div class="row" style="justify-content:space-between;font-size:13px;margin:4px 0"><span>' + esc(n) + '</span><span class="cy">' + c + '</span></div><div class="hbar" style="height:6px"><i style="width:' + c / mx * 100 + '%"></i></div>').join('') : '<p class="muted" style="font-size:13px">Pas encore d’actions cette semaine.</p>') + '</div>' +
      '<div><b style="font-weight:500;font-size:13px">Les plus utilisés</b>' + tops.map(([n, c]) => '<div class="row" style="justify-content:space-between;font-size:12.5px;margin-top:6px"><span class="ell">' + esc(n) + '</span><span class="muted">' + c + '</span></div>').join('') + '</div></div>';
  };
  B.act('jF', el => { const k = el.dataset.k; flt[k] = k === 'p' ? +el.value : el.value; B.emit('journal'); });
  const csvCell = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  function download(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); }
  B.act('jCsv', () => {
    const head = ['Date', 'Heure', 'Jour', 'Utilisateur', 'Niveau', 'Pièce', 'Appareil', 'Action', 'Origine', 'Météo', 'Température', 'Saison', 'Nuit'];
    const rows = S.journal.slice().reverse().map(e => { const d = new Date(e.t); return [F.ymd(d), F.time(d), F.JOURS[d.getDay()], e.un, e.f, e.r, e.n, e.txt, SRC[e.src] || e.src, e.wx, e.temp, SEASON[e.se] || e.se, e.night ? 'oui' : 'non'].map(csvCell).join(';'); });
    download('journal-beta-os-' + F.ymd(new Date()) + '.csv', '﻿' + head.join(';') + '\n' + rows.join('\n'), 'text/csv');
  });
  B.act('jJson', () => download('journal-beta-os-' + F.ymd(new Date()) + '.json', JSON.stringify(S.journal, null, 1), 'application/json'));
  B.act('jClear', () => { if (!confirm('Effacer tout le journal ?')) return; S.journal = []; B.save(); B.emit('journal'); });
  B.act('jMake', el => {
    const s = analyze().find(x => x.key === el.dataset.arg); if (!s) return;
    S.autos = S.autos || [];
    S.autos.push({ id: 'a' + Date.now(), on: true, trig: { type: 'time', v: s.at, days: s.days }, act: { type: 'device', v: s.id, a: s.a }, note: 'Habitude de ' + s.un });
    B.save(); B.emit('journal'); B.emit('autos'); B.toast('Automatisme créé : ' + s.name + ' à ' + s.at + ' ' + s.label, 'sparkle');
  });
  /* données de démonstration pour tester l'analyse */
  B.act('jDemo', () => {
    const now = new Date(), pick = a => a[Math.floor(Math.random() * a.length)];
    const plan = [['sarah', 'e1.ch1.cover', 'close', 'fermé', 21 * 60 + 40, 'wd'], ['bastien', 'rdc.salon.light', 'on', 'allumé', 19 * 60 + 5, 'wd'], ['leo', 'e2.bureau.light', 'on', 'allumé', 16 * 60 + 50, 'wd'], ['emma', 'rdc.robot', 'status', 'nettoyage lancé', 10 * 60, 'we'], ['bastien', 'e1.suite.cover', 'open', 'ouvert', 7 * 60 + 15, 'wd'], ['sarah', 'rdc.cuisine.centrale', 'on', 'allumé', 18 * 60 + 30, 'all']];
    for (let i = 21; i >= 1; i--) {
      const day = new Date(now); day.setDate(now.getDate() - i); const we = [0, 6].includes(day.getDay());
      plan.forEach(([u, id, a, txt, m, dt]) => {
        if ((dt === 'wd' && we) || (dt === 'we' && !we) || Math.random() < .15 || !DATA.DEVICES[id]) return;
        const t = new Date(day); t.setHours(0, m + Math.round((Math.random() - .5) * 30), Math.floor(Math.random() * 59), 0);
        const usr = S.users.find(x => x.id === u) || S.users[0], code = pick([0, 0, 1, 2, 3, 61, 63]);
        S.journal.push({ t: +t, d: id, n: DATA.DEVICES[id].name, r: DATA.DEVICES[id].room, f: B.floorOf ? B.floorOf(id) : '', a, txt, src: 'ui', u: usr.id, un: usr.name, temp: Math.round(8 + Math.random() * 10), wc: code, wx: B.wxText(code), se: B.fx ? B.fx.season() : '', night: m > 19 * 60, demo: true });
      });
    }
    S.journal.sort((a, b) => b.t - a.t); B.save(); B.emit('journal'); B.toast('3 semaines d’habitudes simulées', 'sparkle');
  });

  B.route('journal', { title: 'Journal', bg: BG, render: () => B.side('journal') + B.header({ id: 'journal', title: 'Journal', sub: 'Qui a fait quoi, quand, et par quel temps', icon: 'journal', info: { t: 'infobox', keys: ['journal'], items: () => {
    const t0 = new Date(); t0.setHours(0, 0, 0, 0); const today = S.journal.filter(e => e.t >= +t0);
    return [{ icon: 'journal', v: today.length, l: 'Aujourd’hui', cls: 'c' }, { icon: 'history', v: S.journal.length, l: 'Au total' }, { icon: 'sparkle', v: analyze().filter(x => !x.info && !x.exists).length, l: 'Suggestions', cls: 'p' }, { icon: 'server', v: B.Server && B.Server.ok() ? 'NAS' : 'Local', l: 'Stockage', cls: 'g' }];
  } } }) +
    '<section class="card pcard abs" style="' + box([105, 235, 1000, 1012]) + '">' + B.whead('chart', 'Toutes les actions') + T({ t: 'jlist', keys: ['journal'] }) + '</section>' +
    '<section class="card pcard abs" style="' + box([1010, 235, 1522, 700]) + '">' + B.whead('ia', 'Habitudes repérées') + T({ t: 'jsugg', keys: ['journal', 'autos'] }) + '</section>' +
    '<section class="card pcard abs" style="' + box([1010, 710, 1522, 1012]) + '">' + B.whead('users', 'Cette semaine') + T({ t: 'jstats', keys: ['journal'] }) + '</section>' });

  /* ---------- envoi vers le serveur Bêta (NAS) quand il est installé ---------- */
  let pending = [];
  setInterval(() => { if (!pending.length || !B.Server || !B.Server.ok()) { if (!B.Server || !B.Server.ok()) pending = []; return; } const batch = pending.splice(0); B.Server.post('/api/journal', batch).catch(() => { pending = batch.concat(pending); }); }, 30000);
})();

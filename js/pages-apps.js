/* Bêta OS — Énergie, Musique, Plex, NAS, Calendrier, Mails, Bêta IA, Paramètres */
(function () {
  const B = window.BOS, { S, DATA, esc, F, dev, setDev, T, RENDER, box, px, WX, Music } = B;
  const A = 'assets/', BG = A + 'bg/generic.jpg';
  const card = (r, title, badge, body, right) => '<section class="card pcard abs" style="' + box(r) + '">' + B.whead(badge, title, right || '') + body + '</section>';
  /* en-tête : à droite, un bloc d'informations propre à la page (plus de boutons « tout éteindre ») */
  const head = (id, title, sub, icon, items, keys) => B.side(id) + B.header({ id, title, sub, icon, info: { t: 'infobox', items, keys: keys || ['house', 'music', 'plex', 'mails', 'events', 'ha', 'weather', 'energy'] } });
  const nf = (v, d) => String(typeof v === 'number' ? v.toFixed(d == null ? 1 : d) : v).replace('.', ',');

  /* ======================= ÉNERGIE ======================= */
  function hourly() {
    const prod = [], cons = [];
    for (let h = 0; h < 24; h++) {
      prod.push(Math.max(0, 4.6 * Math.sin(Math.PI * (h - 6.8) / 13.6)));
      cons.push(.45 + .25 * Math.sin(h / 3) + (h >= 7 && h <= 9 ? 1.4 : 0) + (h >= 18 && h <= 22 ? 1.7 : 0) + (h >= 12 && h <= 13 ? .8 : 0));
    }
    return { prod, cons };
  }
  function prodToday() { const { prod } = hourly(), h = new Date().getHours() + new Date().getMinutes() / 60; let t = 0; prod.forEach((v, i) => { if (i + 1 <= h) t += v; else if (i < h) t += v * (h - i); }); return t; }
  RENDER.echart = s => {
    const view = S.eview || 'jour', E = B.Energy, real = E.real();
    if (real && !E.cache[view] && !E.loading) { E.loading = true; E.load(view).finally(() => { E.loading = false; }); }
    const tabs = '<div class="tabs sm" style="margin:0 0 10px auto;align-self:flex-end">' + [['jour', 'Jour'], ['semaine', 'Semaine'], ['mois', 'Mois']].map(t => '<button class="' + (view === t[0] ? 'on' : '') + '" data-act="eView" data-arg="' + t[0] + '">' + t[1] + '</button>').join('') + '</div>';
    const W = 900, H = 250;
    let prod, cons, labels, max, unit;
    if (view === 'jour') {
      const d = real && E.cache.jour ? E.cache.jour : hourly();
      prod = (d.prod || hourly().prod).map(v => v || 0); cons = (d.cons || hourly().cons).map(v => v == null ? null : v);
      labels = Array.from({ length: 24 }, (_, i) => i % 3 ? '' : i + ' h'); unit = 'kW'; max = Math.max(5, ...prod, ...cons.filter(v => v != null));
    } else {
      const n = view === 'semaine' ? 7 : 30, d = real && E.cache[view] ? E.cache[view] : E.demoDays(n);
      prod = d.map(x => x.prod); cons = d.map(x => x.cons); unit = 'kWh';
      labels = d.map((x, i) => n === 7 ? F.d3(x.d) : (i % 5 ? '' : x.d.getDate() + '/' + (x.d.getMonth() + 1))); max = Math.max(5, ...prod, ...cons);
    }
    const N = prod.length, bw = (W - 40) / N, x = i => 30 + i * bw, y = v => H - 24 - v / max * (H - 40), now = new Date().getHours();
    const line = cons.map((v, i) => v == null ? '' : ((i && cons[i - 1] != null ? 'L' : 'M') + (x(i) + bw / 2).toFixed(1) + ' ' + y(v).toFixed(1))).join(' ');
    const step = max > 20 ? 10 : max > 10 ? 5 : 1;
    const tp = prod.reduce((a, v) => a + (v || 0), 0), tc = cons.reduce((a, v) => a + (v || 0), 0);
    return '<div class="row" style="align-items:center;margin-bottom:4px"><span class="muted" style="font-size:13px">' + (real ? 'Données réelles de Home Assistant' : 'Exemple (reliez vos capteurs d’énergie dans Paramètres › Home Assistant)') + (E.cache.err && real ? ' · ' + esc(E.cache.err) : '') + '</span>' + tabs + '</div>' +
      '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;flex:1;min-height:0" role="img" aria-label="Production et consommation"><defs><linearGradient id="pb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd84a"/><stop offset="1" stop-color="#ff8a34" stop-opacity=".45"/></linearGradient></defs>' +
      Array.from({ length: Math.floor(max / step) + 1 }, (_, i) => i * step).map(v => '<line x1="30" x2="' + (W - 10) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="rgba(120,170,255,.12)"/><text x="2" y="' + (y(v) + 4) + '" fill="#93a8cc" font-size="11">' + v + '</text>').join('') +
      prod.map((v, i) => '<rect x="' + (x(i) + bw * .15) + '" y="' + y(v || 0) + '" width="' + (bw * .7) + '" height="' + (H - 24 - y(v || 0)) + '" rx="2" fill="url(#pb)" opacity="' + (view !== 'jour' || i <= now ? 1 : .3) + '"><title>' + nf(v || 0) + ' ' + unit + '</title></rect>').join('') +
      '<path d="' + line + '" fill="none" stroke="#2fd3ff" stroke-width="2.5" style="filter:drop-shadow(0 0 6px rgba(40,200,255,.8))"/>' +
      (view === 'jour' ? '<line x1="' + (x(now) + bw / 2) + '" x2="' + (x(now) + bw / 2) + '" y1="10" y2="' + (H - 24) + '" stroke="#ff6fae" stroke-dasharray="4 4"/>' : '') +
      labels.map((l, i) => l ? '<text x="' + (x(i) + bw / 2) + '" text-anchor="middle" y="' + (H - 6) + '" fill="#93a8cc" font-size="11">' + l + '</text>' : '').join('') + '</svg>' +
      '<div class="row legend"><span><i style="background:#ffb53a"></i>Solaire ' + (view === 'jour' ? '' : '· ' + nf(tp, 0) + ' kWh') + '</span><span><i style="height:3px;background:#2fd3ff"></i>Consommation ' + (view === 'jour' ? '' : '· ' + nf(tc, 0) + ' kWh') + '</span>' + (view === 'jour' ? '<span><i style="height:0;border-top:2px dashed #ff6fae"></i>Maintenant</span>' : '<span>Autonomie ' + Math.min(100, Math.round(tp / tc * 100)) + ' %</span>') + '</div>';
  };
  B.act('eView', el => { S.eview = el.dataset.arg; B.emit('energy'); });
  RENDER.esolar = () => {
    const L = B.Energy.live(), sol = L.solar, today = L.real && B.Energy.num('solarTotal') == null ? prodToday() : prodToday();
    const panel = i => '<i class="pv" style="opacity:' + (.35 + .65 * Math.min(1, sol / 4.6)) + '"></i>';
    return '<div class="solar"><div class="pvgrid">' + Array.from({ length: 12 }, panel).join('') + '</div>' +
      '<div class="kpis"><div class="tile kpi"><small>En ce moment</small><b>' + nf(sol) + ' kW</b><em>' + (sol > .05 ? Math.round(sol / 4.8 * 100) + ' % de la puissance' : 'Les panneaux dorment') + '</em></div>' +
      '<div class="tile kpi"><small>Aujourd’hui</small><b>' + nf(today) + ' kWh</b><em>≈ ' + nf(today * .2276, 2) + ' € économisés</em></div>' +
      '<div class="tile kpi"><small>Ce mois-ci</small><b>' + nf(268 + today, 0) + ' kWh</b><em>' + nf((268 + today) * .056, 0) + ' kg de CO₂ évités</em></div>' +
      '<div class="tile kpi"><small>Installation</small><b>4,8 kWc</b><em style="color:#cfdcf3">12 panneaux · plein sud · 30°</em></div></div></div>';
  };
  RENDER.erooms = () => {
    const rooms = {};
    for (const id in DATA.DEVICES) {
      const d = DATA.DEVICES[id], s = dev(id); let w = 0;
      if (d.type === 'light' && s.on) w = .02; if (d.type === 'group' && s.on) w = .01 * s.lit; if (d.type === 'clim' && s.on && id !== 'home.chauffage') w = .18;
      if (d.type === 'power' && s.on) w = { 'rdc.salon.tv': .12, 'rdc.salon.amp': .08, 'rdc.salon.pc': .15 }[id] || 0; if (d.type === 'app' && s.on) w = .55; if (d.type === 'charger' && s.on) w = 7.4;
      if (w) rooms[d.room] = (rooms[d.room] || 0) + w;
    }
    const list = Object.entries(rooms).sort((a, b) => b[1] - a[1]).slice(0, 8), max = list.length ? list[0][1] : 1;
    return '<div class="scroll" style="display:flex;flex-direction:column;gap:12px">' + (list.length ? list.map(r => '<div><div class="row" style="justify-content:space-between;font-size:14px;margin-bottom:5px"><span>' + esc(r[0]) + '</span><span class="cy">' + nf(r[1], 2) + ' kW</span></div><div class="hbar"><i style="width:' + (r[1] / max * 100) + '%"></i></div></div>').join('') : '<p class="muted">Tout est éteint, bravo !</p>') + '</div>';
  };
  RENDER.ebatt = () => {
    const b = dev('ext.borne'), L = B.Energy.live(), sol = L.solar, h = { kw: L.cons };
    return '<div style="display:flex;flex-direction:column;gap:12px">' +
      '<div class="erow tile">' + ico('batteryV').replace('class="ico', 'style="color:#22e3a4" class="ico') + '<b>' + nf(L.bat / 100 * 16) + ' / 16 kWh</b><small>Batterie' + (L.real ? '' : ' virtuelle') + '</small><div class="bar"><div><i style="width:' + Math.round(L.bat) + '%"></i></div>' + Math.round(L.bat) + ' %</div></div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><div class="tile kpi"><small>Achat au réseau</small><b>' + nf(Math.max(0, h.kw - sol)) + ' kW</b><em style="color:#cfdcf3">Heures ' + (new Date().getHours() >= 22 || new Date().getHours() < 6 ? 'creuses' : 'pleines') + '</em></div><div class="tile kpi"><small>Revente</small><b>' + nf(Math.max(0, sol - h.kw)) + ' kW</b><em>Surplus solaire</em></div></div>' +
      '<div class="tile" style="display:flex;align-items:center;gap:14px;padding:12px 14px">' + ico('charger').replace('class="ico', 'style="font-size:30px;color:#2fb6ff" class="ico') + '<div style="flex:1"><b style="font-weight:400">Borne de recharge</b><div class="muted" style="font-size:13px">' + (b.on ? 'Recharge en cours · 7,4 kW' : 'Libre · aucun véhicule branché') + '</div></div><button class="pbtn' + (b.on ? '' : ' off') + '" data-act="borne" aria-label="Recharge">' + ico('power') + '</button></div></div>';
  };
  RENDER.eactive = () => {
    const on = Object.values(DATA.DEVICES).filter(d => ['light', 'clim', 'power', 'app', 'charger', 'group'].includes(d.type) && dev(d.id).on && !d.id.startsWith('home.'));
    return '<div class="list scroll" style="flex:1">' + on.map(d => '<div class="li" style="min-height:44px"><span class="ic">' + ico({ light: 'bulbFill', group: 'bulbFill', clim: 'snow', power: 'power', app: 'washer', charger: 'charger' }[d.type]) + '</span><div><b>' + esc(d.name) + '</b><small>' + esc(d.room) + '</small></div><button class="sw on" data-act="toggle" data-id="' + d.id + '" aria-label="Éteindre ' + esc(d.name) + '"></button></div>').join('') + (on.length ? '' : '<p class="muted">Aucun appareil allumé.</p>') + '</div>';
  };
  B.route('energie', { title: 'Énergie', bg: BG, render: () => head('energie', 'Énergie', 'Production solaire et consommation', 'boltPlain', () => {
    const L = B.Energy.live(), sol = L.solar;
    return [{ icon: 'solar', v: nf(sol) + ' kW', l: L.real ? 'Panneaux (réel)' : 'Panneaux', cls: 'y' }, { icon: 'sun', v: nf(prodToday()) + ' kWh', l: 'Aujourd’hui', cls: 'y' }, { icon: 'chart', v: '4,6 kW', l: 'Pic du jour' }, { icon: 'leaf', v: '68 %', l: 'Autoconso.', cls: 'g' }];
  }) +
    card([105, 235, 760, 600], 'Panneaux solaires', 'solar', T({ t: 'esolar', keys: ['energy'] })) +
    card([770, 235, 1522, 600], 'Production et consommation', 'chart', T({ t: 'echart', keys: ['energy'] })) +
    card([105, 612, 560, 1012], 'Batterie & réseau', 'battery', T({ t: 'ebatt', keys: ['dev:ext.borne', 'house', 'energy'] })) +
    card([570, 612, 1040, 1012], 'Qui consomme ?', 'home', T({ t: 'erooms', keys: ['house'] })) +
    card([1050, 612, 1522, 1012], 'Allumés en ce moment', 'power', T({ t: 'eactive', keys: ['house'] })) });

  /* ======================= MUSIQUE ======================= */
  RENDER.mnow = () => {
    const i = B.curInfo(), s = Music.cur();
    return '<div class="mnow"><div class="big">' + B.mcover(i, 250) + (Music.playing ? '<span class="eq lg"><i></i><i></i><i></i><i></i></span>' : '') + '</div>' +
      '<div class="nfo">' + B.srcPill(i) + '<b class="t">' + esc(i.title) + '</b><span class="a">' + esc(i.artist) + '</span>' + (i.kind !== 'radio' && s.name !== i.title ? '<span class="muted" style="font-size:13px">' + ico(i.kind === 'yt' ? 'youtube' : 'nas').replace('class="ico', 'style="display:inline;vertical-align:-2px;margin-right:6px" class="ico') + esc(s.name) + '</span>' : '') +
      B.transport() + T({ t: 'mprog', keys: ['mtime', 'music'] }) + B.volRow() +
      '<div class="row" style="flex-wrap:wrap;gap:8px;margin-top:auto"><button class="btn" data-act="zone">' + ico('speaker') + esc(B.zoneName()) + '</button>' +
      (i.kind === 'yt' ? '<button class="btn" data-act="ytShow">' + ico('video') + 'Vidéo</button><button class="btn" data-act="mExternal">' + ico('youtube') + 'Ouvrir dans YouTube</button>' : '') + '</div></div></div>';
  };
  const libRow = x => {
    const k = Music.kindOf(x), on = S.music.src === x.id;
    return '<div class="li' + (on ? ' cur' : '') + '"><button class="ic th" data-act="mPlay" data-arg="' + x.id + '" aria-label="Lire">' + (k === 'radio' ? B.radioLogo(x, 40) : '<img src="' + (x.cover || A + 'media/playlist-1.jpg') + '" alt="">') + '<span class="po">' + ico(on && Music.playing ? 'pause' : 'play') + '</span></button>' +
      '<div style="min-width:0"><b class="ell">' + esc(x.name) + '</b><small class="ell">' + (k === 'yt' ? (B.ytParse(x.ref).list && !B.ytParse(x.ref).v ? 'Playlist YouTube' : 'YouTube') : k === 'radio' ? 'Radio en direct' : 'NAS / lien audio') + (x.artist && k !== 'radio' ? ' · ' + esc(x.artist) : '') + '</small></div>' +
      '<div class="row" style="gap:4px"><button class="sq like' + (Music.isFav(x.id) ? ' on' : '') + '" data-act="mLike" data-arg="' + x.id + '" aria-label="J’aime">' + ico(Music.isFav(x.id) ? 'heartFill' : 'heart') + '</button>' +
      (x.group === 'Ambiances' ? '<button class="sq" data-act="editList" data-arg="' + x.id + '" aria-label="Modifier">' + ico('edit') + '</button>' : x.group !== 'Radio' ? '<button class="sq" data-act="mRemove" data-arg="' + x.id + '" aria-label="Retirer">' + ico('trash') + '</button>' : '') + '</div></div>';
  };
  RENDER.mlib = () => {
    const tab = S.music.ltab || 'yt';
    const tabs = '<div class="tabs sm" style="align-self:flex-start;margin:12px 0 8px">' + [['yt', 'YouTube'], ['nas', 'NAS'], ['amb', 'Ambiances'], ['ha', 'Enceintes']].map(t => '<button class="' + (tab === t[0] ? 'on' : '') + '" data-act="mlTab" data-arg="' + t[0] + '">' + t[1] + '</button>').join('') + '</div>';
    if (tab === 'ha') return tabs + B.YTM.haPanel();
    const list = tab === 'yt' ? Music.sources().filter(x => x.group === 'YouTube') : tab === 'nas' ? Music.sources().filter(x => x.group === 'NAS') : S.playlists.map(p => Music.get(p.id));
    return (tab === 'yt' ? B.YTM.bar() : '<form class="addlink" data-submit="mAdd">' + ico('link') + '<input name="url" placeholder="Collez un lien YouTube (vidéo ou playlist) ou l’adresse d’un fichier audio du NAS" autocomplete="off" inputmode="url" aria-label="Lien à ajouter"><button class="btn pri">' + ico('play') + 'Lire</button></form>') +
      tabs + (tab === 'yt' ? B.YTM.results() : '') +
      '<div class="list scroll" style="flex:1">' + (list.length ? list.map(libRow).join('') : '<p class="muted" style="font-size:13.5px;line-height:1.5">' + (tab === 'yt' ? 'Aucun lien pour l’instant. Collez ci-dessus l’adresse d’une vidéo ou d’une playlist YouTube : elle sera lue ici et gardée dans votre bibliothèque.' : 'Collez l’adresse d’un fichier audio partagé par votre NAS (ex. http://192.168.1.20:5000/musique/titre.mp3) ou d’une webradio.') + '</p>') + '</div>';
  };
  RENDER.mradios = () => '<div class="rgrid scroll">' + DATA.RADIOS.map(r => {
    const on = S.music.src === r.id;
    return '<div class="tile rtile' + (on ? ' cur' : '') + '"><button data-act="mPlay" data-arg="' + r.id + '" class="rb">' + B.radioLogo(r, 46) + '<span><b>' + esc(r.name) + '</b><small>' + (on && Music.playing ? '♪ En écoute' : 'En direct') + '</small></span></button><button class="like' + (Music.isFav(r.id) ? ' on' : '') + '" data-act="mLike" data-arg="' + r.id + '" aria-label="Favori">' + ico(Music.isFav(r.id) ? 'heartFill' : 'heart') + '</button></div>';
  }).join('') + '</div>';
  RENDER.mfavs = () => {
    const f = Music.favs().map(id => Music.get(id)).filter(Boolean);
    return f.length ? '<div class="list scroll" style="flex:1">' + f.map(libRow).join('') + '</div>' : '<p class="muted" style="font-size:14px;line-height:1.5">Touchez ♡ sur une radio, une vidéo YouTube ou une ambiance pour la retrouver ici et sur l’accueil.</p>';
  };
  B.act('mlTab', el => { S.music.ltab = el.dataset.arg; B.save(); B.emit('music'); });
  B.act('mAdd', el => { const u = el.url.value.trim(); if (!u) return; const it = Music.addItem(u); if (!it) return; el.url.value = ''; S.music.ltab = it.kind === 'yt' ? 'yt' : 'nas'; Music.play(it.id); B.toast(it.kind === 'yt' ? 'Lecture YouTube lancée' : 'Lecture du fichier lancée', it.kind === 'yt' ? 'youtube' : 'nas'); });
  B.act('mRemove', el => { if (S.music.src === el.dataset.arg) { Music.pause(); S.music.src = S.playlists[0].id; } Music.removeItem(el.dataset.arg); });
  B.act('editList', el => {
    const p = S.playlists.find(x => x.id === el.dataset.arg);
    B.modal('<h2>' + ico('edit') + 'Modifier « ' + esc(p.name) + ' »</h2><form data-submit="saveList" data-arg="' + p.id + '" style="display:flex;flex-direction:column;gap:12px">' +
      '<label class="field">Nom<input name="name" value="' + esc(p.name) + '" required></label>' +
      '<label class="field">Lien YouTube (vidéo, direct ou playlist) ou adresse d’un flux audio<input name="ref" value="' + esc(p.kind === 'yt' && /^[\w-]{11}$/.test(p.ref) ? 'https://www.youtube.com/watch?v=' + p.ref : p.ref) + '" required></label>' +
      '<label class="field">Sous-titre<input name="artist" value="' + esc(p.artist || '') + '"></label>' +
      '<div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-act="closeModal">Annuler</button><button class="btn pri">' + ico('check') + 'Enregistrer</button></div></form>', 'sm');
  });
  B.act('saveList', el => {
    const p = S.playlists.find(x => x.id === el.dataset.arg), f = new FormData(el);
    const ref = String(f.get('ref')).trim();
    p.name = String(f.get('name')).trim() || p.name; p.artist = String(f.get('artist')).trim();
    p.kind = B.ytParse(ref) ? 'yt' : 'radio'; p.ref = ref;
    B.save(); B.closeModal(); B.emit('music'); B.toast('C’est enregistré', 'check');
  });
  B.route('musique', { title: 'Musique', bg: BG, render: () => head('musique', 'Musique', 'Radios, YouTube et fichiers du NAS', 'musicFill', () => {
    const i = Music.info();
    return [{ icon: Music.playing ? 'pause' : 'play', v: Music.playing ? 'En lecture' : 'En pause', l: ({ radio: 'Radio', yt: 'YouTube', audio: 'NAS' })[i.kind], cls: 'c' }, { icon: 'speaker', v: esc(B.zoneName()), l: 'Pièce' }, { icon: 'volume', v: S.music.vol + ' %', l: 'Volume' }, { icon: 'heartFill', v: Music.favs().length, l: 'Favoris', cls: 'p' }];
  }, ['music']) +
    card([105, 235, 760, 640], 'En écoute', 'music', T({ t: 'mnow', keys: ['music'] })) +
    card([770, 235, 1522, 640], 'Ma bibliothèque', 'link', T({ t: 'mlib', keys: ['music'] })) +
    card([105, 652, 760, 1012], 'Radios en direct', 'radio', T({ t: 'mradios', keys: ['music'] })) +
    card([770, 652, 1522, 1012], 'Favoris de ' + esc(B.user().name), 'heart', T({ t: 'mfavs', keys: ['music'] })) });
  B.route('multimedia', { title: 'Musique', bg: BG, render: () => { setTimeout(() => B.go('musique')); return ''; } });

  /* ======================= PLEX ======================= */
  RENDER.psel = () => {
    const p = B.Plex.sel(), fav = (S.plexFavs || []).includes(p.id);
    return '<div class="psel"><img src="' + p.img + '" alt="">' +
      '<div class="nfo"><span class="spill plex">' + ico('plex') + esc(p.kind) + (p.genre ? ' · ' + esc(p.genre) : '') + '</span><b class="t">' + esc(p.title) + '</b><span class="a">' + p.year + ' · ' + esc(p.dur) + (p.sub ? ' · ' + esc(p.sub) : '') + '</span>' +
      (p.summary ? '<p>' + esc(p.summary) + '</p>' : '') +
      (p.progress ? '<div class="row" style="gap:10px;font-size:13px"><i class="pgbar" style="flex:1"><b style="width:' + p.progress + '%"></b></i>' + p.progress + ' % vu</div>' : '') +
      '<label class="field">Regarder sur<select data-change="plexTv">' + ['Suite parentale - TV', 'TV Salon', 'Salle de jeux - TV'].map(t => '<option' + ((S.plexTv || 'Suite parentale - TV') === t ? ' selected' : '') + '>' + t + '</option>').join('') + '</select></label>' +
      '<div class="row" style="flex-wrap:wrap;gap:8px;margin-top:auto"><button class="btn pri" data-act="plexPlay" data-toggle="1">' + ico(S.plexPlaying ? 'pause' : 'play') + (S.plexPlaying ? 'Mettre en pause' : p.progress ? 'Reprendre' : 'Regarder') + '</button>' +
      '<button class="btn' + (fav ? ' on' : '') + '" data-act="plexFav" data-arg="' + p.id + '">' + ico(fav ? 'heartFill' : 'heart') + (fav ? 'Dans mes favoris' : 'Favori') + '</button><button class="btn" data-act="plexOpen">' + ico('plex') + 'Ouvrir dans Plex</button></div></div></div>';
  };
  RENDER.plib = () => {
    const q = (S.plexQ || '').toLowerCase(), list = B.Plex.list().filter(p => !q || p.title.toLowerCase().includes(q));
    return '<div class="row" style="flex-wrap:wrap;gap:8px;margin-bottom:12px">' + [['recent', 'Tout'], ['films', 'Films'], ['series', 'Séries'], ['anime', 'Anime'], ['favs', 'Favoris']].map(c => '<button class="cat' + (S.plexCat === c[0] ? ' on' : '') + '" style="padding:0 16px" data-act="plexCat" data-arg="' + c[0] + '">' + c[1] + '</button>').join('') +
      '<input class="search" placeholder="Rechercher un titre…" value="' + esc(S.plexQ || '') + '" data-change="plexQ" aria-label="Rechercher"></div>' +
      '<div class="pgrid2 scroll">' + (list.length ? list.map(p => '<div class="pcell">' + B.poster(p) + '<span class="ell">' + esc(p.title) + '</span><small>' + esc(p.kind) + ' · ' + p.year + '</small></div>').join('') : '<p class="muted">Aucun titre ne correspond.</p>') + '</div>';
  };
  RENDER.pserver = () => {
    const s = S.settings, st = B.Plex.real ? ['', 'Connecté · ' + B.Plex.real.length + ' titres'] : B.Plex.error ? ['off', 'Erreur : ' + B.Plex.error] : ['wait', 'Bibliothèque de démonstration'];
    return '<form data-submit="plexSave" style="display:flex;flex-direction:column;gap:10px;flex:1" title="Avec l’adresse et le jeton, Bêta OS affiche votre vraie bibliothèque. Le jeton reste sur cet appareil."><span class="tag2 ' + st[0] + '" style="align-self:flex-start">' + esc(st[1]) + '</span>' +
      '<div class="grid2"><label class="field">Adresse du serveur Plex<input name="server" placeholder="http://192.168.1.20:32400" value="' + esc(s.plexServer || '') + '"></label><label class="field">Jeton Plex (X-Plex-Token)<input name="token" type="password" value="' + esc(s.plexToken || '') + '"></label></div>' +
      '<label class="field">Lien « Ouvrir dans Plex »<input name="url" value="' + esc(s.plexUrl) + '"></label>' +
      '<div class="row" style="margin-top:auto"><button class="btn pri">' + ico('check') + 'Enregistrer et actualiser</button></div></form>';
  };
  B.act('plexTv', el => { S.plexTv = el.value; B.save(); B.emit('plex'); });
  B.act('plexQ', el => { S.plexQ = el.value; B.emit('plex'); });
  B.act('plexSave', el => { const f = new FormData(el); S.settings.plexServer = String(f.get('server')).trim(); S.settings.plexToken = String(f.get('token')).trim(); S.settings.plexUrl = String(f.get('url')).trim() || S.settings.plexUrl; B.save(); B.Plex.real = null; B.Plex.error = ''; B.Plex.load(); B.emit('plex'); B.toast(S.settings.plexServer ? 'Connexion au serveur Plex…' : 'Bibliothèque de démonstration', 'plex'); });
  B.route('plex', { title: 'Plex', bg: BG, render: () => head('plex', 'Plex', 'Films, séries et anime de la maison', 'plex', () => {
    const p = B.Plex.sel();
    return [{ icon: S.plexPlaying ? 'play' : 'pause', v: S.plexPlaying ? 'En lecture' : 'En pause', l: esc(p.title), cls: 'y' }, { icon: 'tv', v: esc((S.plexTv || 'Suite parentale - TV').replace(' - TV', '')), l: 'Écran' }, { icon: 'film', v: B.Plex.all().length, l: 'Titres' }, { icon: 'heartFill', v: (S.plexFavs || []).length, l: 'Favoris', cls: 'p' }];
  }, ['plex']) +
    card([105, 235, 760, 700], 'Sélection', 'film', T({ t: 'psel', keys: ['plex'] })) +
    card([770, 235, 1522, 1012], 'Bibliothèque', 'plex', T({ t: 'plib', keys: ['plex'] })) +
    card([105, 712, 760, 1012], 'Serveur Plex', 'gear', T({ t: 'pserver', keys: ['plex'] })),
    after: () => B.Plex.load() });

  /* ======================= NAS ======================= */
  const VOLS = [['Volume 1 · RAID 1', 8.2, 10], ['Volume 2 · cache SSD', .7, 1], ['Volume 3 · sauvegardes', 3.5, 5]];
  const SVCS = [['Nextcloud', 'cloud', 'En ligne', ''], ['Photos AI', 'photo', 'En ligne', ''], ['Surveillance', 'shield', '9 caméras', ''], ['Plex Media Server', 'plex', 'En ligne', ''], ['Home Assistant', 'homeFill', 'À configurer', 'wait'], ['Téléchargements', 'download', '2 en cours', 'wait'], ['Sauvegarde cloud', 'cloudUp', 'Cette nuit 03:00', ''], ['Docker', 'nas', '12 conteneurs', '']];
  B.route('nas', { title: 'NAS', bg: BG, render: () => head('nas', 'NAS UGREEN', 'Stockage, services et sauvegardes', 'nas', () => [{ icon: 'nas', v: '78 %', l: 'Rempli', cls: 'c' }, { icon: 'therm', v: '41 °C', l: 'Température' }, { icon: 'download', v: '2', l: 'Téléchargements' }, { icon: 'shieldCheck', v: 'OK', l: 'Sauvegarde', cls: 'g' }], []) +
    card([105, 235, 760, 600], 'Espace disque', 'nas', '<div class="nasbox tile" style="margin:0 0 12px"><img src="' + A + 'devices/nas.jpg" alt=""><span class="l">Stockage total</span><span class="r">12,4 / 16 To</span><div class="bar"><i style="width:78%"></i></div><span class="pct">78 %</span></div>' +
      VOLS.map(v => '<div style="margin:8px 0"><div class="row" style="justify-content:space-between;font-size:14px;margin-bottom:6px"><span>' + v[0] + '</span><span class="muted">' + nf(v[1]) + ' / ' + v[2] + ' To</span></div><div class="hbar"><i style="width:' + (v[1] / v[2] * 100) + '%"></i></div></div>').join('') +
      '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:auto"><div class="tile kpi"><small>Processeur</small><b>12 %</b></div><div class="tile kpi"><small>Mémoire</small><b>5,1 Go</b><em style="color:#cfdcf3">sur 16 Go</em></div><div class="tile kpi"><small>Température</small><b>41 °C</b><em>Tout va bien</em></div></div>') +
    card([770, 235, 1522, 600], 'Services', 'shield', '<div class="list scroll" style="display:grid;grid-template-columns:1fr 1fr;column-gap:10px">' + SVCS.map(s => '<div class="li"><span class="ic">' + ico(s[1]) + '</span><div><b>' + s[0] + '</b></div><span class="tag2 ' + s[3] + '">' + s[2] + '</span></div>').join('') + '</div>') +
    card([105, 612, 760, 1012], 'Activité récente', 'download', '<div class="list">' + [['Ubuntu 26.04 LTS.iso', 64], ['Vacances Japon 2025 (photos)', 27]].map(d => '<div class="li"><span class="ic">' + ico('download') + '</span><div><b>' + d[0] + '</b><div class="hbar" style="margin-top:6px;height:6px"><i style="width:' + d[1] + '%"></i></div></div><span class="cy">' + d[1] + ' %</span></div>').join('') +
      '<div class="li"><span class="ic">' + ico('cloudUp') + '</span><div><b>Sauvegarde complète</b><small>Terminée cette nuit à 03:00 · 182 Go</small></div><span class="tag2">OK</span></div>' +
      '<div class="li"><span class="ic">' + ico('shieldCheck') + '</span><div><b>Contrôle des disques</b><small>Aucune erreur détectée</small></div><span class="tag2">Sain</span></div></div>') +
    card([770, 612, 1522, 1012], 'Accès rapide', 'folder', '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px">' + [['files', 'Fichiers'], ['photo', 'Photos'], ['video', 'Vidéos'], ['cloudUp', 'Sauvegarde']].map(b => '<button class="tile" data-act="nasOpen" data-arg="' + b[1] + '" style="height:120px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;font-size:15px">' + ico(b[0]).replace('class="ico', 'style="font-size:40px;color:#2fb6ff;filter:drop-shadow(0 0 8px rgba(40,170,255,.6))" class="ico') + b[1] + '</button>').join('') + '</div>' +
      '<p class="muted" style="font-size:13px;margin:16px 0 10px">' + (S.settings.nasUrl ? 'Interface : ' + esc(S.settings.nasUrl) : 'Ajoutez l’adresse de votre NAS (ex. http://192.168.1.20:9999) dans Paramètres pour ouvrir UGOS Pro d’un geste.') + '</p>' +
      '<div class="row" style="margin-top:auto"><button class="btn pri" data-act="nasOpen">' + ico('nas') + 'Ouvrir UGOS Pro</button><a class="btn" href="#musique">' + ico('musicFill') + 'Écouter la musique du NAS</a></div>') });

  /* ======================= CALENDRIER ======================= */
  let calView = new Date(); calView.setDate(1);
  let calSel = F.ymd(new Date());
  const COLORS = ['#1f7dff', '#ff8a34', '#22d3ee', '#5ee7ff', '#ff5fae', '#9b6bff', '#22e3a4'];
  /* lecture d'un fichier .ics (événements simples ; les récurrences complexes ne sont pas développées) */
  function parseICS(txt) {
    const un = String(txt).replace(/\r?\n[ \t]/g, ''), out = [];
    un.split('BEGIN:VEVENT').slice(1).forEach((b, n) => {
      const g = k => { const m = b.match(new RegExp('^' + k + '[^:\\n]*:(.*)$', 'm')); return m ? m[1].trim() : ''; };
      const ds = g('DTSTART'), de = g('DTEND'); if (!ds) return;
      const p = s => { const m = s.match(/(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/); if (!m) return null; return s.endsWith('Z') ? new Date(Date.UTC(+m[1], m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0))) : new Date(+m[1], m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)); };
      const a = p(ds), z = de ? p(de) : null; if (!a) return;
      const clean = v => v.replace(/\\,/g, ',').replace(/\;/g, ';').replace(/\\n/gi, ' ');
      out.push({ id: 'i' + Date.now() + '-' + n, date: F.ymd(a), time: /T\d/.test(ds) ? F.time(a) : '00:00', dur: z ? Math.max(15, Math.round((z - a) / 6e4)) : 60, title: clean(g('SUMMARY')) || 'Événement', place: clean(g('LOCATION')), uid: g('UID'), color: '#9b6bff' });
    });
    return out;
  }
  function addEvents(list, src) {
    let n = 0;
    list.forEach(e => { if (e.uid && S.events.some(x => x.uid === e.uid)) return; if (S.events.some(x => x.date === e.date && x.time === e.time && x.title === e.title)) return; S.events.push(e); n++; });
    B.save(); B.emit('cal'); B.emit('events');
    B.toast(n ? n + ' événement' + (n > 1 ? 's ajoutés' : ' ajouté') + ' à l’agenda' + (src ? ' (' + src + ')' : '') : 'Ces événements sont déjà dans l’agenda', 'calendar');
    if (n === 1) { calSel = list[0].date; const d = new Date(calSel + 'T12:00'); calView = new Date(d.getFullYear(), d.getMonth(), 1); }
    return n;
  }
  B.parseICS = parseICS; B.addEvents = addEvents;
  B.calGoto = k => { calSel = k; const d = new Date(k + 'T12:00'); calView = new Date(d.getFullYear(), d.getMonth(), 1); B.current === 'calendrier' ? B.emit('cal') : B.go('calendrier'); };
  RENDER.calgrid = () => {
    const y = calView.getFullYear(), m = calView.getMonth(), first = new Date(y, m, 1), start = new Date(first);
    start.setDate(1 - ((first.getDay() + 6) % 7));
    const today = F.ymd(new Date());
    let cells = '';
    for (let i = 0; i < 42; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      const k = F.ymd(d), evs = S.events.filter(e => e.date === k).sort((a, b) => a.time.localeCompare(b.time));
      cells += '<div class="day' + (d.getMonth() !== m ? ' out' : '') + (k === today ? ' today' : '') + (k === calSel ? ' sel' : '') + '" data-act="calDay" data-arg="' + k + '"><span class="n">' + d.getDate() + '</span>' +
        evs.slice(0, 3).map(e => '<span class="e" style="--c:' + e.color + '">' + e.time + ' ' + esc(e.title) + '</span>').join('') + (evs.length > 3 ? '<span class="mo">+' + (evs.length - 3) + ' autres</span>' : '') + '</div>';
    }
    return '<div style="display:flex;flex-direction:column;flex:1;min-height:0"><div class="row calbar"><button class="sq" data-act="calNav" data-arg="-1" aria-label="Mois précédent">' + ico('chevL') + '</button><b>' + F.MOIS[m] + ' ' + y + '</b><button class="sq" data-act="calNav" data-arg="1" aria-label="Mois suivant">' + ico('chevR') + '</button><button class="btn" data-act="calNav" data-arg="0">Aujourd’hui</button><span style="flex:1"></span>' +
      '<label class="btn pri" style="cursor:pointer">' + ico('upload') + 'Ajouter un fichier .ics<input type="file" accept=".ics,text/calendar" multiple data-change="icsImport" hidden></label><button class="btn" data-act="icsUrl">' + ico('link') + 'Depuis un lien</button><button class="btn" data-act="icsExport" title="Exporter l’agenda">' + ico('download') + '</button></div>' +
      '<div class="cal" style="grid-template-rows:auto repeat(6,1fr)">' + ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map(d => '<span class="dh">' + d + '</span>').join('') + cells + '</div></div>';
  };
  RENDER.calday = () => {
    const d = new Date(calSel + 'T12:00'), evs = S.events.filter(e => e.date === calSel).sort((a, b) => a.time.localeCompare(b.time));
    return '<div style="display:flex;flex-direction:column;gap:12px;flex:1;min-height:0"><b style="font-size:19px;font-weight:400" class="cy">' + F.dayMonth(d) + '</b>' +
      '<div class="list scroll" style="flex:1">' + (evs.length ? evs.map(e => '<div class="li" style="grid-template-columns:10px 1fr auto"><i style="width:8px;height:34px;border-radius:4px;background:' + e.color + ';box-shadow:0 0 8px ' + e.color + '"></i><div><b>' + esc(e.title) + '</b><small>' + e.time + ' · ' + (e.dur >= 60 ? nf(e.dur / 60) + ' h' : e.dur + ' min') + (e.place ? ' · ' + esc(e.place) : '') + '</small></div><div class="row" style="gap:4px"><button class="sq" data-act="calEdit" data-arg="' + e.id + '" aria-label="Modifier">' + ico('edit') + '</button><button class="sq" data-act="calDel" data-arg="' + e.id + '" aria-label="Supprimer">' + ico('trash') + '</button></div></div>').join('') : '<p class="muted">Journée libre, rien de prévu.</p>') + '</div>' +
      '<form data-submit="calAdd" style="display:flex;flex-direction:column;gap:10px;border-top:1px solid rgba(90,150,240,.2);padding-top:12px"><input type="hidden" name="id" value="">' +
      '<label class="field">Titre<input name="title" required placeholder="Nouvel événement"></label><div class="grid2"><label class="field">Heure<input type="time" name="time" value="09:00" required></label><label class="field">Durée (min)<input type="number" name="dur" value="60" min="5" step="5"></label></div>' +
      '<div class="row" style="gap:8px">' + COLORS.map((c, i) => '<label style="cursor:pointer"><input type="radio" name="color" value="' + c + '"' + (i ? '' : ' checked') + ' hidden><span class="cdot" style="--c:' + c + '"></span></label>').join('') + '<span style="flex:1"></span><button class="btn pri">' + ico('plus') + 'Ajouter</button></div></form></div>';
  };
  B.act('calNav', el => { const a = +el.dataset.arg; if (!a) { calView = new Date(); calView.setDate(1); calSel = F.ymd(new Date()); } else calView.setMonth(calView.getMonth() + a); B.emit('cal'); });
  B.act('calDay', el => { calSel = el.dataset.arg; B.emit('cal'); });
  B.act('calDel', el => { S.events = S.events.filter(e => e.id !== el.dataset.arg); B.save(); B.emit('cal'); B.emit('events'); B.toast('Événement supprimé', 'trash'); });
  B.act('calEdit', el => {
    const e = S.events.find(x => x.id === el.dataset.arg), f = document.querySelector('[data-submit="calAdd"]');
    f.id.value = e.id; f.title.value = e.title; f.time.value = e.time; f.dur.value = e.dur;
    const r = f.querySelector('input[value="' + e.color + '"]'); if (r) r.checked = true;
    f.querySelector('.btn.pri').lastChild.textContent = 'Enregistrer'; f.title.focus();
  });
  B.act('calAdd', el => {
    const f = new FormData(el), id = f.get('id');
    const ev = { id: id || 'e' + Date.now(), date: calSel, time: f.get('time'), dur: +f.get('dur') || 60, title: String(f.get('title')).trim(), color: f.get('color') || '#1f7dff' };
    if (id) Object.assign(S.events.find(x => x.id === id), ev); else S.events.push(ev);
    B.save(); B.emit('cal'); B.emit('events'); B.toast(id ? 'Événement modifié' : 'C’est noté dans l’agenda', 'calendar');
  });
  B.act('icsImport', el => { Array.from(el.files || []).forEach(file => file.text().then(txt => { const l = parseICS(txt); if (!l.length) return B.toast('Aucun événement trouvé dans ' + file.name, 'info'); addEvents(l, file.name); })); el.value = ''; });
  B.act('icsUrl', () => B.modal('<h2>' + ico('link') + 'Ajouter un agenda en ligne</h2><form data-submit="icsUrlGo" style="display:flex;flex-direction:column;gap:12px"><label class="field">Lien de l’agenda (.ics ou webcal://)<input name="url" required placeholder="https://… /calendar.ics" inputmode="url"></label>' +
    '<p class="muted" style="font-size:12.5px;margin:0;line-height:1.5">Google Agenda : Paramètres › votre agenda › « Adresse secrète au format iCal ». iCloud : partager l’agenda en public. Certains services bloquent la lecture directe depuis un navigateur ; dans ce cas, téléchargez le fichier .ics et utilisez « Ajouter un fichier .ics ».</p>' +
    '<div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-act="closeModal">Annuler</button><button class="btn pri">' + ico('download') + 'Importer</button></div></form>', 'sm'));
  B.act('icsUrlGo', async el => {
    const url = el.url.value.trim().replace(/^webcal:/i, 'https:');
    try { const r = await fetch(url); if (!r.ok) throw new Error('HTTP ' + r.status); const l = parseICS(await r.text()); if (!l.length) throw new Error('aucun événement'); B.closeModal(); addEvents(l, 'lien'); S.icsUrls = Array.from(new Set((S.icsUrls || []).concat(url))); B.save(); }
    catch (e) { B.toast('Lecture impossible (' + (e.message === 'Failed to fetch' ? 'le service bloque l’accès direct' : e.message) + ')', 'info'); }
  });
  B.act('icsExport', () => {
    const z = d => d.replace(/[-:]/g, '');
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Beta OS//FR'].concat(...S.events.map(e => { const a = new Date(e.date + 'T' + e.time), b = new Date(+a + e.dur * 6e4), f = d => F.ymd(d).replace(/-/g, '') + 'T' + F.time(d).replace(':', '') + '00'; return ['BEGIN:VEVENT', 'UID:' + (e.uid || e.id + '@beta-os'), 'DTSTART:' + f(a), 'DTEND:' + f(b), 'SUMMARY:' + e.title.replace(/,/g, '\\,'), 'END:VEVENT']; }), ['END:VCALENDAR']);
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/calendar' })); a.download = 'agenda-beta-os.ics'; a.click(); void z;
  });
  B.route('calendrier', { title: 'Calendrier', bg: BG, render: () => head('calendrier', 'Calendrier', 'Agenda de la famille', 'calendar', () => {
    const now = new Date(), nx = S.events.filter(e => new Date(e.date + 'T' + e.time) >= now).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))[0];
    const tm = F.ymd(new Date(Date.now() + 864e5));
    return [{ icon: 'calendar', v: nx ? nx.time : '—', l: nx ? esc(nx.title) : 'Rien à venir', cls: 'c' }, { icon: 'sun', v: S.events.filter(e => e.date === F.ymd(now)).length, l: 'Aujourd’hui' }, { icon: 'moon', v: S.events.filter(e => e.date === tm).length, l: 'Demain' }, { icon: 'mail', v: S.mails.filter(m => m.invite && !m.inviteDone).length, l: 'Invitations', go: 'mails', cls: 'p' }];
  }, ['events', 'mails']) +
    card([105, 235, 1100, 1012], 'Agenda', 'cal', T({ t: 'calgrid', keys: ['cal'] })) +
    card([1110, 235, 1522, 1012], 'Jour sélectionné', 'edit', T({ t: 'calday', keys: ['cal'] })) });

  /* ======================= MAILS ======================= */
  const JN = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  /* date d'une invitation : « jeudi », « demain », « 24/10 »… */
  function inviteDate(inv) {
    const w = (inv.when || '').toLowerCase(), now = new Date();
    if (inv.date) return inv.date;
    if (w === 'demain') return F.ymd(new Date(Date.now() + 864e5));
    if (w === "aujourd'hui" || w === 'aujourd’hui') return F.ymd(now);
    const j = JN.indexOf(w); if (j >= 0) { const d = new Date(now); let k = (j - d.getDay() + 7) % 7; if (!k) k = 7; d.setDate(d.getDate() + k); return F.ymd(d); }
    const m = w.match(/(\d{1,2})\/(\d{1,2})/); if (m) { const d = new Date(now.getFullYear(), +m[2] - 1, +m[1]); if (d < now) d.setFullYear(d.getFullYear() + 1); return F.ymd(d); }
    return F.ymd(now);
  }
  /* détecte un rendez-vous dans un mail sans invitation : « jeudi à 18:00 », « demain 9h30 » */
  function detectInvite(m) {
    if (m.invite) return m.invite;
    const t = (m.subj + ' ' + m.body).toLowerCase();
    const r = t.match(/(demain|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|\d{1,2}\/\d{1,2})[^.\n]{0,25}?(\d{1,2})\s*[h:]\s*(\d{2})?/);
    if (!r) return null;
    return { title: m.subj, when: r[1], time: String(r[2]).padStart(2, '0') + ':' + (r[3] || '00'), dur: 60, guessed: true };
  }
  function inviteText(inv) { const d = new Date(inviteDate(inv) + 'T12:00'); return F.dayMonth(d) + ' à ' + inv.time; }
  function addInvite(id) {
    const m = S.mails.find(x => x.id === id), inv = detectInvite(m); if (!inv) return;
    const ev = { id: 'm' + Date.now(), date: inviteDate(inv), time: inv.time, dur: inv.dur || 60, title: inv.title, place: inv.place || '', color: '#9b6bff' };
    S.events.push(ev); m.inviteDone = ev.id; B.save(); B.emit('events'); B.emit('cal'); B.emit('mailview'); B.emit('mails');
    B.toast('« ' + inv.title + ' » ajouté à l’agenda (' + inviteText(inv) + ')', 'calendar');
  }
  B.act('mailInvite', el => { addInvite(el.dataset.arg); B.$$('.notify[data-mail="' + el.dataset.arg + '"]').forEach(n => n.remove()); });
  B.act('mailInviteNo', el => { const m = S.mails.find(x => x.id === el.dataset.arg); if (m) m.inviteDone = 'non'; B.save(); B.emit('mailview'); B.$$('.notify[data-mail="' + el.dataset.arg + '"]').forEach(n => n.remove()); });
  RENDER.mlist = () => '<div class="mlist scroll" style="flex:1">' + S.mails.map(m => '<div class="m' + (m.read ? ' read' : '') + (S.openMail === m.id ? ' sel' : '') + '" data-act="mailSel" data-arg="' + m.id + '"><span class="mrow" style="height:auto"><span class="lg" style="background:' + m.bg + '">' + esc(m.logo) + '</span></span><div style="min-width:0"><b>' + esc(m.from) + '</b><small>' + esc(m.subj) + '</small></div><span class="tm">' + m.time + (detectInvite(m) ? ico('calendar', 'inv') : '') + '</span></div>').join('') + '</div>' +
    '<div class="row" style="margin-top:10px;flex-wrap:wrap"><button class="btn" data-act="mailAllRead">' + ico('check') + 'Tout marquer comme lu</button><label class="btn" style="cursor:pointer" title="Importer une invitation reçue">' + ico('upload') + '.ics<input type="file" accept=".ics,text/calendar" data-change="icsImport" hidden></label></div>';
  RENDER.mread = () => {
    const m = S.mails.find(x => x.id === S.openMail);
    if (!m) return '<div class="mread empty">' + ico('mail') + 'Choisissez un message à gauche</div>';
    const inv = detectInvite(m);
    const banner = inv ? (m.inviteDone && m.inviteDone !== 'non' ? '<div class="invite done">' + ico('check') + '<span>Ajouté à votre agenda · ' + esc(inviteText(inv)) + '</span><a class="btn" href="#calendrier">Voir l’agenda</a></div>'
      : m.inviteDone === 'non' ? '' : '<div class="invite">' + B.badge('cal') + '<span><b>' + (inv.guessed ? 'Un rendez-vous dans ce message ?' : 'Invitation') + '</b>' + esc(inv.title) + ' · ' + esc(inviteText(inv)) + (inv.place ? ' · ' + esc(inv.place) : '') + '</span><button class="btn pri" data-act="mailInvite" data-arg="' + m.id + '">' + ico('plus') + 'Ajouter à l’agenda</button><button class="btn" data-act="mailInviteNo" data-arg="' + m.id + '">Non merci</button></div>') : '';
    return '<div class="mread"><div class="row" style="align-items:flex-start;gap:14px"><span class="mrow" style="height:auto"><span class="lg" style="background:' + m.bg + ';width:46px;height:46px;font-size:22px">' + esc(m.logo) + '</span></span><div style="flex:1"><h3>' + esc(m.subj) + '</h3><div class="meta">' + esc(m.from) + ' · aujourd’hui à ' + m.time + '</div></div></div>' + banner +
      '<div class="body scroll" style="flex:1">' + esc(m.body) + '</div><div class="row" style="margin-top:12px;flex-wrap:wrap"><a class="btn pri" href="mailto:?subject=' + encodeURIComponent('Re: ' + m.subj) + '">' + ico('send') + 'Répondre</a><button class="btn" data-act="mailUnread" data-arg="' + m.id + '">' + ico('mail') + 'Marquer non lu</button><button class="btn dan" data-act="mailDel" data-arg="' + m.id + '">' + ico('trash') + 'Supprimer</button></div></div>';
  };
  function mailsChanged() { B.save(); B.emit('mails'); B.emit('mailview'); }
  B.act('mailSel', el => { S.openMail = el.dataset.arg; const m = S.mails.find(x => x.id === el.dataset.arg); if (m) m.read = true; mailsChanged(); });
  B.act('mailAllRead', () => { S.mails.forEach(m => m.read = true); mailsChanged(); });
  B.act('mailUnread', el => { S.mails.find(x => x.id === el.dataset.arg).read = false; mailsChanged(); });
  B.act('mailDel', el => { S.mails = S.mails.filter(x => x.id !== el.dataset.arg); S.openMail = null; mailsChanged(); B.toast('Message supprimé', 'trash'); });
  /* réception d'un nouveau message : si c'est une invitation, Bêta OS propose de l'ajouter à l'agenda */
  function receiveMail(m) {
    S.mails.unshift(m); mailsChanged();
    const inv = detectInvite(m);
    B.notify({ mail: m.id, badge: inv ? 'cal' : 'mail', title: 'Nouveau message de ' + m.from, text: inv ? esc(inv.title) + ' · ' + esc(inviteText(inv)) + '<br>Je l’ajoute à l’agenda ?' : esc(m.subj),
      actions: inv ? [['Ajouter', 'mailInvite', m.id, 'pri'], ['Plus tard', 'notifyClose', m.id]] : [['Lire', 'openMail', m.id, 'pri']] });
  }
  B.receiveMail = receiveMail;
  B.route('mails', { title: 'Mails', bg: BG, render: () => {
    const m = S.mails.find(x => x.id === S.openMail); if (m && !m.read) { m.read = true; B.save(); }
    return head('mails', 'Mails', 'Vos messages, sans prise de tête', 'mail', () => [{ icon: 'mail', v: B.unread(), l: 'Non lus', cls: 'c' }, { icon: 'calendar', v: S.mails.filter(x => detectInvite(x) && !x.inviteDone).length, l: 'Rendez-vous', go: 'calendrier', cls: 'p' }, { icon: 'files', v: S.mails.length, l: 'Messages' }, { icon: 'shieldCheck', v: 'Démo', l: 'Boîte' }], ['mails']) +
      card([105, 235, 640, 1012], 'Boîte de réception', 'mail', T({ t: 'mlist', keys: ['mailview'] })) +
      card([650, 235, 1522, 1012], 'Lecture', 'edit', T({ t: 'mread', keys: ['mailview'] }));
  } });

  /* ======================= BÊTA IA ======================= */
  const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  function scopeOf(q) {
    if (/etage ?1|1er|premier/.test(q)) return 'e1.';
    if (/etage ?2|2e|deuxieme|second/.test(q)) return 'e2.';
    if (/rdc|rez/.test(q)) return 'rdc.';
    if (/exterieur|jardin|dehors|terrasse|cour/.test(q)) return 'ext.';
    const room = Object.values(DATA.DEVICES).find(d => q.includes(norm(d.room)));
    if (room) return { room: room.room };
    return '';
  }
  function devsIn(scope, ...types) {
    return Object.values(DATA.DEVICES).filter(d => types.includes(d.type) && (typeof scope === 'string' ? d.id.startsWith(scope) : d.room === scope.room)).map(d => d.id);
  }
  function ia(text) {
    const q = norm(text), sc = scopeOf(q), where = typeof sc === 'string' ? ({ 'e1.': ' à l’étage 1', 'e2.': ' à l’étage 2', 'rdc.': ' au RDC', 'ext.': ' à l’extérieur', '': ' dans toute la maison' }[sc]) : ' (' + sc.room + ')';
    let m;
    const link = text.match(/https?:\/\/\S+/);
    if (link && (B.ytParse(link[0]) || /\.(mp3|m4a|aac|ogg|flac|wav)(\?|$)/i.test(link[0]))) { const it = Music.addItem(link[0]); if (it) { Music.play(it.id); return 'Je lance la lecture. Vous la retrouverez dans Musique › Ma bibliothèque.'; } }
    const rt = (S.routines || []).find(r => q.includes(norm(r.name)) || (r.id === 'depart' && /je (m.en )?vais|je sors|on part/.test(q)) || (r.id === 'nuit' && /dodo|je vais dormir|au lit/.test(q)));
    if (rt) { B.runRoutine(rt.id, true); return 'Routine « ' + rt.name + ' » lancée. ' + ({ depart: 'Bonne journée, la maison se met en veille.', retour: 'Bon retour à la maison !', nuit: 'Bonne nuit, à demain.', reveil: 'Debout ! Bonne journée.' }[rt.id] || ''); }
    if (/routine|automatisme/.test(q)) { setTimeout(() => B.go('routines'), 400); return 'Je vous ouvre les routines et automatismes.'; }
    if (/j.?aime|like|favori/.test(q) && !/radio|playlist/.test(q)) { Music.like(); return Music.isFav(S.music.src) ? 'Ajouté à vos favoris ♥' : 'Retiré de vos favoris.'; }
    if (/(eteins|eteint|coupe|ferme).*(lumi|lampe|eclair|tout)|tout eteindre/.test(q)) { devsIn(sc, 'light', 'group').forEach(id => setDev(id, { on: false })); return 'C’est fait : lumières éteintes' + where + '.'; }
    if (/(allume|active).*(lumi|lampe|eclair)|allume/.test(q) && !/tondeuse|arrosage|tv|tele/.test(q)) { devsIn(sc, 'light', 'group').forEach(id => setDev(id, { on: true })); return 'Lumières allumées' + where + '.'; }
    if (/(ferme|baisse|descend).*volet/.test(q)) { devsIn(sc, 'cover').filter(id => id !== 'ext.store' && id !== 'rdc.garage.door').forEach(id => setDev(id, { pos: 0 })); return 'Je ferme les volets' + where + '.'; }
    if (/(ouvre|leve|monte).*volet/.test(q)) { devsIn(sc, 'cover').filter(id => id !== 'ext.store' && id !== 'rdc.garage.door').forEach(id => setDev(id, { pos: 100 })); return 'J’ouvre les volets' + where + '.'; }
    if (/store/.test(q)) { const o = /ouvr|deroul|sort/.test(q); setDev('ext.store', { pos: o ? 100 : 0 }); return o ? 'Store banne ouvert.' : 'Store banne fermé.'; }
    if (/porte.*garage|garage.*porte/.test(q)) { const o = /ouvr/.test(q); setDev('rdc.garage.door', { pos: o ? 100 : 0 }); return o ? 'J’ouvre la porte du garage.' : 'Porte du garage fermée.'; }
    if (/arrosage|arrose/.test(q)) { const off = /stop|arrete|coupe|eteins/.test(q); m = q.match(/(\d+)\s*min/); setDev('ext.arrosage', { on: !off, min: m ? +m[1] : 10 }); return off ? 'Arrosage coupé.' : 'Arrosage démarré pour ' + (m ? m[1] : 10) + ' minutes.'; }
    if (/tondeuse|tondre|pelouse/.test(q)) { const off = /stop|arrete|range|base/.test(q); setDev('ext.tondeuse', { status: off ? 'docked' : 'mowing' }); return off ? 'La tondeuse rentre à sa base.' : 'La tondeuse démarre la tonte.'; }
    if (/aspirateur|nettoyage|menage|robot/.test(q)) { const off = /stop|arrete|base|rentre/.test(q); setDev('rdc.robot', { status: off ? 'returning' : 'cleaning' }); return off ? 'L’aspirateur retourne à sa base.' : 'Aspirateur robot lancé au RDC.'; }
    if ((m = q.match(/(\d{2}(?:[.,]\d)?)\s*(?:°|degre)/))) { const t = parseFloat(m[1].replace(',', '.')); devsIn(sc || 'e1.', 'clim').forEach(id => setDev(id, { on: true, temp: t })); return 'Climatisation réglée à ' + t + ' °C' + where + '.'; }
    if (/mode soir|soiree|cinema/.test(q)) { SC('soir:' + (sc === 'e1.' ? 'e1' : sc === 'e2.' ? 'e2' : 'rdc')); return 'Mode soirée activé : volets fermés et lumières d’ambiance.'; }
    if (/mode jour|reveil|matin/.test(q)) { SC('jour:' + (sc === 'e1.' ? 'e1' : sc === 'e2.' ? 'e2' : 'rdc')); return 'Mode jour : volets ouverts, lumières éteintes.'; }
    if (/meteo|temps|temperature dehors|pleu|fait.il/.test(q)) return S.settings.city + ' : ' + WX.now.temp + ' °C, ' + B.wxText(WX.now.code).toLowerCase() + '. Vent ' + WX.now.wind + ' km/h, pluie ' + WX.now.rain + ' %. Demain : ' + WX.days[0].max + '° / ' + WX.days[0].min + '°.';
    if (/plex|film|serie/.test(q)) { setTimeout(() => B.go('plex'), 400); return 'Je vous ouvre Plex. « ' + B.Plex.sel().title + ' » vous attend.'; }
    if (/radio/.test(q)) { const r = DATA.RADIOS.find(r => q.includes(norm(r.name))) || DATA.RADIOS[2]; Music.play(r.id); return 'Lecture de ' + r.name + '.'; }
    if (/playlist|musique|joue|lance/.test(q)) {
      if (/pause|stop|arrete|coupe/.test(q)) { Music.pause(); return 'Musique en pause.'; }
      const p = S.playlists.find(p => q.includes(norm(p.name))) || (/japon/.test(q) ? S.playlists[0] : S.playlists.find(p => p.id === S.music.src) || S.playlists[0]);
      Music.play(p.id); return 'Lecture : ' + p.name + '.';
    }
    if (/agenda|calendrier|rendez|programme|planning/.test(q)) { const t = F.ymd(new Date()), ev = S.events.filter(e => e.date === t).sort((a, b) => a.time.localeCompare(b.time)); return ev.length ? 'Aujourd’hui : ' + ev.map(e => e.time + ' ' + e.title).join(', ') + '.' : 'Rien de prévu aujourd’hui.'; }
    if (/mail|message|courrier/.test(q)) { const u = S.mails.filter(m => !m.read); return u.length ? u.length + ' message(s) non lu(s) : ' + u.map(m => m.from).join(', ') + '.' : 'Aucun nouveau message.'; }
    if (/conso|energie|electricite|solaire/.test(q)) { const h = B.house(); return 'Consommation actuelle : ' + h.kw.toFixed(1) + ' kW. Production solaire : ' + B.solarNow().toFixed(1) + ' kW. Batterie virtuelle à 76 %.'; }
    if (/camera|mouvement|securite|alarme/.test(q)) { if (/active.*alarme|alarme.*(on|active)/.test(q)) { S.alarm = true; B.save(); B.emit('house'); return 'Alarme activée.'; } if (/desactive.*alarme|alarme.*off/.test(q)) { S.alarm = false; B.save(); B.emit('house'); return 'Alarme désactivée.'; } const ev = Object.keys(DATA.CAMS).filter(id => B.camEv(id).dot); return ev.length ? 'Événements : ' + ev.map(id => DATA.CAMS[id].name + ' — ' + B.camEv(id).txt.replace(/<[^>]+>/g, '')).join(' ; ') + '.' : 'Aucun mouvement détecté.'; }
    if (/controle la maison|etat|resume|bilan|point/.test(q)) { const h = B.house(); return 'La maison : ' + h.on + ' lumière(s) allumée(s), ' + (h.open ? h.open + ' volet(s) ouvert(s)' : 'volets fermés') + ', consommation ' + h.kw.toFixed(1) + ' kW, ' + (h.motion ? h.motion + ' mouvement(s) caméra' : 'aucun mouvement') + '. Dites par exemple « éteins le RDC » ou « ferme les volets de l’étage 1 ».'; }
    if (/bonjour|salut|hello|coucou/.test(q)) return 'Bonjour ' + B.user().name + ' ! Je peux piloter les lumières, volets, clim, arrosage, tondeuse, aspirateur, musique et vous donner la météo ou l’agenda.';
    return 'Je n’ai pas compris. Essayez : « éteins tout au RDC », « ferme les volets étage 1 », « mets 21 degrés », « lance la playlist Gaming », « météo », « mes mails ».';
  }
  function SC(k) { const q = B.SCENES[k]; if (q) q.run(); }
  B.ia = ia;
  function askIA(text) {
    if (!text || !text.trim()) return '';
    const reply = (B.iaX || ia)(text.trim());
    S.chat.push({ me: true, t: text.trim() }, { me: false, t: reply });
    S.chat = S.chat.slice(-60); B.save(); B.emit('chat');
    return reply;
  }
  B.askIA = askIA;
  /* barre IA : la réponse s'affiche dans une bulle au-dessus de la barre */
  function bubble(host, reply) {
    const b = host && host.querySelector('.iareply');
    if (!b) return B.toast(reply, 'ai');
    b.innerHTML = brainSVG() + '<span>' + esc(reply) + '</span><button data-act="iaOpen" class="btn sm">Continuer</button><button class="x2" data-act="iaBubbleClose" aria-label="Fermer">' + ico('x') + '</button>';
    b.hidden = false; clearTimeout(b._t); b._t = setTimeout(() => { b.hidden = true; }, 9000);
  }
  B.act('iaBubbleClose', el => { el.closest('.iareply').hidden = true; });
  B.act('ia', el => { const i = el.querySelector('input'); const r = B.askIA(i.value); i.value = ''; if (r) bubble(el.closest('.iabar'), r); });
  B.act('iaHome', el => { const i = el.querySelector('input'); const r = B.askIA(i.value); i.value = ''; if (r) iaSheet(); });
  B.act('iaAsk', el => { B.askIA(el.dataset.arg); iaSheet(); });
  B.act('iaPage', el => { const i = el.querySelector('input'); B.askIA(i.value); i.value = ''; i.focus(); });
  B.act('iaSheetSend', el => { const i = el.querySelector('input'); B.askIA(i.value); i.value = ''; i.focus(); });
  B.act('iaChip', el => B.askIA(el.dataset.arg));
  B.act('chatClear', () => { S.chat = []; B.save(); B.emit('chat'); });
  const SUGG = ['Fais le point sur la maison', 'Je pars', 'Bonne nuit', 'Éteins tout au RDC', 'Ferme les volets de l’étage 1', 'Mets 21 degrés dans la suite parentale', 'Démarre l’arrosage 15 min', 'Lance la playlist Gaming', 'Mets la radio FIP', 'Quel temps fait-il ?', 'Qu’est-ce que j’ai aujourd’hui ?', 'Ai-je des mails ?', 'Combien je consomme ?', 'Mode soirée'];
  /* conversation dans un panneau, accessible depuis toutes les pages */
  function iaSheet() {
    if (document.querySelector('.modal .iasheet')) return;
    const m = B.modal('<div class="iasheet"><h2>' + brainSVG().replace('<svg', '<svg style="width:34px;height:34px"') + 'Bêta IA<span style="flex:1"></span><button class="btn sm pri" data-act="voice">' + ico('mic') + 'Mode vocal</button><button class="btn sm" data-act="chatClear">' + ico('trash') + 'Effacer</button></h2>' +
      T({ t: 'chat', keys: ['chat'] }) +
      '<div class="sugg2">' + SUGG.slice(0, 6).map(s => '<button data-act="iaChip" data-arg="' + esc(s) + '">' + esc(s) + '</button>').join('') + '</div>' +
      '<form data-submit="iaSheetSend" class="iainput"><button type="button" class="mic" data-act="mic" aria-label="Dicter">' + ico('mic') + '</button><input name="q" placeholder="Écrivez ou dictez votre demande…" autocomplete="off" enterkeyhint="send" aria-label="Message"><button class="btn pri" aria-label="Envoyer">' + ico('send') + '</button></form></div>', 'sheet ia');
    setTimeout(() => { const i = m.querySelector('input'); if (i && window.innerWidth > 760) i.focus(); const c = m.querySelector('.chat'); if (c) c.scrollTop = c.scrollHeight; }, 50);
  }
  B.iaSheet = iaSheet;
  B.act('iaOpen', () => { B.$$('.iareply').forEach(b => b.hidden = true); if (B.current === 'ia') { const i = document.querySelector('[data-submit="iaPage"] input'); if (i) i.focus(); return; } iaSheet(); });
  B.act('mic', el => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return B.toast('La dictée vocale n’est pas disponible sur ce navigateur', 'mic');
    const r = new SR(); r.lang = 'fr-FR'; r.interimResults = false;
    const btn = el; btn.classList.add('rec');
    r.onresult = e => { const t = e.results[0][0].transcript; const rep = askIA(t); const bar = el.closest('.iabar'); if (bar) bubble(bar, rep); };
    r.onend = () => btn.classList.remove('rec');
    r.onerror = () => { btn.classList.remove('rec'); B.toast('Micro indisponible', 'mic'); };
    r.start();
  });
  RENDER.chat = () => '<div class="chat scroll">' + (S.chat.length ? '' : '<div class="msg bot">' + B.hello() + ' ' + esc(B.user().name) + ' 👋\nJe m’occupe de la maison : lumières, volets, clim, arrosage, tondeuse, aspirateur, musique… Je peux aussi vous donner la météo, votre agenda ou vos mails. Demandez-moi simplement, comme à quelqu’un de la maison.</div>') +
    S.chat.map(c => '<div class="msg ' + (c.me ? 'me' : 'bot') + '">' + esc(c.t) + '</div>').join('') + '</div>';
  new MutationObserver(() => B.$$('.chat').forEach(c => { if (c.dataset.s !== String(S.chat.length)) { c.dataset.s = S.chat.length; c.scrollTop = c.scrollHeight; } })).observe(document.documentElement, { childList: true, subtree: true });
  B.route('ia', { title: 'Bêta IA', bg: BG, render: () => head('ia', 'Bêta IA', 'Votre assistant à la maison', 'ai', () => [{ icon: 'shieldCheck', v: 'Local', l: 'Rien ne sort', cls: 'g' }, { icon: 'chat', v: Math.floor(S.chat.length / 2), l: 'Échanges' }, { icon: 'mic', v: (window.SpeechRecognition || window.webkitSpeechRecognition) ? 'Oui' : 'Non', l: 'Dictée' }, { icon: 'homeFill', v: B.HA.enabled() ? 'Réelle' : 'Démo', l: 'Maison', cls: 'c' }], ['chat', 'ha']) +
    '<section class="card pcard abs" style="' + box([105, 235, 1100, 1012]) + '">' + B.whead('ia', 'Conversation', '<button class="btn sm" data-act="chatClear">' + ico('trash') + 'Effacer</button>') +
    T({ t: 'chat', keys: ['chat'] }) +
    '<form data-submit="iaPage" class="iainput"><button type="button" class="mic" data-act="mic" aria-label="Dicter">' + ico('mic') + '</button><input name="q" placeholder="Écrivez ou dictez votre demande…" autocomplete="off" enterkeyhint="send" aria-label="Message"><button class="btn pri" aria-label="Envoyer">' + ico('send') + '</button></form></section>' +
    card([1110, 235, 1522, 1012], 'Idées de demandes', 'edit', '<div class="list scroll">' + SUGG.map(s => '<button class="li" style="grid-template-columns:30px 1fr;width:100%;text-align:left" data-act="iaChip" data-arg="' + esc(s) + '"><span class="ic" style="width:28px;height:28px;font-size:15px">' + ico('chat') + '</span><span>' + esc(s) + '</span></button>').join('') + '</div>') });

  /* ======================= PARAMÈTRES ======================= */
  const isAdmin = () => !!(B.user() && B.user().admin);
  B.isAdmin = isAdmin;
  RENDER.sprof = () => '<div class="list scroll" style="flex:1">' + S.users.map(u => '<div class="li prow" style="grid-template-columns:64px 1fr 1fr 78px 54px;gap:12px">' +
    '<button class="u" style="width:58px" data-act="pickAvatar" data-arg="' + u.id + '" aria-label="Changer l’avatar"><span class="av" style="width:56px;height:56px;margin:0;padding:3px;--ring:' + u.ring + ';--glow:' + (u.glow || (/gradient/.test(u.ring) ? '#ff6fae' : u.ring)) + '"><img src="' + u.avatar + '" alt=""></span></button>' +
    '<label class="field">Prénom<input value="' + esc(u.name) + '" data-change="uName" data-id="' + u.id + '"></label>' +
    '<label class="field">Où est-il/elle ?<select data-change="uPlace" data-id="' + u.id + '">' + Object.keys(DATA.PLACES).map(k => '<option value="' + k + '"' + (u.place === k ? ' selected' : '') + '>' + DATA.PLACES[k].label + '</option>').join('') + '</select></label>' +
    '<label class="field">Code<input type="password" inputmode="numeric" maxlength="4" pattern="[0-9]*" placeholder="····" value="' + esc(u.pin || '') + '" data-change="uPin" data-id="' + u.id + '"></label>' +
    '<label class="field" title="Les administrateurs gèrent les pièces et les appareils">Admin<button class="sw sm' + (u.admin ? ' on' : '') + '" data-act="uAdmin" data-id="' + u.id + '" role="switch" aria-label="Administrateur"' + (isAdmin() ? '' : ' disabled') + '></button></label></div>').join('') + '</div>' +
    '<label class="row" style="margin-top:10px;font-size:14px;gap:10px"><button class="sw sm' + (S.settings.guest ? ' on' : '') + '" data-act="setFlag" data-arg="guest" aria-label="Profil invité"></button>Profil « Invité » (sans Mails, NAS, Calendrier ni Paramètres)</label>';
  B.act('uAdmin', el => {
    if (!isAdmin()) return B.toast('Seul un administrateur peut changer ce réglage', 'lock');
    const u = S.users.find(x => x.id === el.dataset.id);
    if (u.admin && S.users.filter(x => x.admin).length === 1) return B.toast('Il faut garder au moins un administrateur', 'info');
    u.admin = !u.admin; B.save(); B.emit('sprof');
  });
  RENDER.sha = () => {
    const s = S.settings, st = !B.HA.enabled() ? ['wait', 'Pas encore relié — mode démo'] : B.HA.wsOk ? ['', 'Connecté en temps réel'] : B.HA.online ? ['', 'Connecté'] : ['off', B.HA.lastError ? 'Erreur : ' + B.HA.lastError : 'Connexion…'];
    const n = Object.values(s.haMap || {}).filter(v => v && v !== '-').length;
    return '<form data-submit="haSave" style="display:flex;flex-direction:column;gap:12px;flex:1">' +
      '<div class="row" style="flex-wrap:wrap"><span class="tag2 ' + st[0] + '">' + esc(st[1]) + '</span>' + (B.HA.enabled() ? '<span class="tag2 wait">' + n + ' appareil' + (n > 1 ? 's' : '') + ' relié' + (n > 1 ? 's' : '') + '</span>' : '') + '</div>' +
      '<label class="field">Adresse de Home Assistant<input name="url" placeholder="http://homeassistant.local:8123" value="' + esc(s.haUrl) + '"></label>' +
      '<label class="field">Jeton d’accès longue durée<input name="token" type="password" placeholder="Profil HA › Sécurité › Jetons d’accès longue durée" value="' + esc(s.haToken) + '"></label>' +
      '<p class="muted" style="font-size:12.5px;margin:0;line-height:1.5">Autorisez Bêta OS dans <code>configuration.yaml</code> : <code>http: cors_allowed_origins:</code> avec l’adresse de Bêta OS. Le jeton reste sur cet appareil.</p>' +
      '<div class="row" style="margin-top:auto;flex-wrap:wrap"><button class="btn pri">' + ico('check') + 'Enregistrer et tester</button><button type="button" class="btn" data-act="haWizard">' + ico('sparkle') + 'Assistant d’association</button><button type="button" class="btn sm" data-act="haMap">' + ico('edit') + 'À la main</button></div></form>';
  };
  B.act('haSave', async el => {
    const f = new FormData(el); S.settings.haUrl = String(f.get('url')).trim(); S.settings.haToken = String(f.get('token')).trim(); B.save();
    if (B.HA.ws) try { B.HA.ws.close(); } catch (e) { }
    if (!B.HA.enabled()) { B.emit('ha'); return B.toast('Home Assistant désactivé : mode démo', 'info'); }
    try { await B.HA.req('/api/'); B.HA.online = true; B.HA.wsOk = false; B.toast('Home Assistant répond ! Lancez l’assistant pour relier vos appareils', 'check'); B.HA.sync(); }
    catch (e) { B.HA.online = false; B.HA.lastError = e.message === 'Failed to fetch' ? 'injoignable ou CORS' : e.message; B.toast('Échec : ' + B.HA.lastError, 'info'); }
    B.emit('ha');
  });
  B.act('haMap', () => {
    const rows = Object.values(DATA.DEVICES).map(d => ['dev', d.id, d.room + ' · ' + d.name, B.HA.entity(d.id)]).concat(Object.keys(DATA.CAMS).map(id => ['cam', id, 'Caméra · ' + DATA.CAMS[id].name, B.HA.camEntity(id)]));
    B.modal('<h2>' + ico('homeFill') + 'Appareils Home Assistant</h2><form data-submit="haMapSave"><div class="scroll" style="max-height:60vh;display:grid;grid-template-columns:1fr 1fr;gap:8px 14px">' +
      rows.map(r => '<label class="field" style="font-size:12px">' + esc(r[2]) + '<input name="' + r[1] + '" value="' + esc(r[3]) + '" spellcheck="false"></label>').join('') + '</div>' +
      '<div class="row" style="justify-content:flex-end;margin-top:14px"><button type="button" class="btn" data-act="closeModal">Annuler</button><button class="btn pri">' + ico('check') + 'Enregistrer</button></div></form>', 'wide');
  });
  B.act('haMapSave', el => { const f = new FormData(el); const map = Object.assign({}, S.settings.haMap); for (const [k, v] of f.entries()) map[k] = String(v).trim() || '-'; S.settings.haMap = map; B.save(); B.closeModal(); B.toast('Appareils reliés', 'check'); B.HA.wsOk ? B.HA.applyAll() : B.HA.sync(); });
  RENDER.sgen = () => {
    const s = S.settings;
    return '<form data-submit="genSave" style="display:flex;flex-direction:column;gap:12px;flex:1"><div class="grid2"><label class="field">Ville (météo)<input name="city" value="' + esc(s.city) + '"></label><div class="field">&nbsp;<button type="button" class="btn" data-act="geo">' + ico('pin') + 'Trouver</button></div></div>' +
      '<div class="grid2"><label class="field">Latitude<input name="lat" value="' + s.lat + '"></label><label class="field">Longitude<input name="lon" value="' + s.lon + '"></label></div>' +
      '<label class="field">Adresse du NAS (UGOS Pro)<input name="nasUrl" placeholder="http://192.168.1.20:9999" value="' + esc(s.nasUrl) + '"></label>' +
      '<label class="row" style="font-size:14px;gap:10px"><button type="button" class="sw sm' + (s.skipLock ? ' on' : '') + '" data-act="setFlag" data-arg="skipLock" aria-label="Sans verrouillage"></button>Ouvrir directement l’accueil</label>' +
      '<div class="row" style="margin-top:auto"><button class="btn pri">' + ico('check') + 'Enregistrer</button></div></form>';
  };
  /* ambiance, saisons, effets, sons */
  RENDER.sfx = () => {
    const s = S.settings, o = (list, cur) => list.map(x => '<option value="' + x[0] + '"' + (cur === x[0] ? ' selected' : '') + '>' + x[1] + '</option>').join('');
    return '<div style="display:flex;flex-direction:column;gap:12px;flex:1">' +
      '<label class="field">Saison<select data-change="fxSet" data-arg="season">' + o([['auto', 'Automatique (selon la date) · ' + B.fx.SEASONS[B.fx.season()]], ['printemps', '🌸 Printemps — sakura'], ['ete', '✨ Été — lucioles'], ['automne', '🍁 Automne — érables'], ['hiver', '❄️ Hiver — neige']], s.season) + '</select></label>' +
      '<label class="field">Ambiance<select data-change="fxSet" data-arg="ambiance">' + o([['auto', 'Automatique (lever / coucher du soleil)'], ['nuit', 'Nuit'], ['jour', 'Jour']], s.ambiance) + '</select></label>' +
      '<label class="field">Effets animés<select data-change="fxSet" data-arg="fx">' + o([['lock', 'Sur l’écran verrouillé'], ['all', 'Partout (discret)'], ['off', 'Aucun']], s.fx) + '</select></label>' +
      '<label class="field">Transparence des panneaux · <span id="glassv">' + (s.glass == null ? 45 : s.glass) + ' %</span><input type="range" class="range thin" min="0" max="100" value="' + (s.glass == null ? 45 : s.glass) + '" style="--p:' + (s.glass == null ? 45 : s.glass) + '%" data-input="fxGlass" aria-label="Transparence"></label>' +
      '<label class="row" style="font-size:14px;gap:10px"><button type="button" class="sw sm' + (s.sound ? ' on' : '') + '" data-act="fxSound" aria-label="Sons"></button>Sons et vibrations discrets</label>' +
      '<div class="row" style="margin-top:auto;gap:8px;flex-wrap:wrap"><button class="btn sm" data-act="fxTest" data-arg="chime">' + ico('volume') + 'Essayer</button><button class="btn sm" data-act="fxTest" data-arg="dingdong">' + ico('bellFill') + 'Sonnette</button></div></div>';
  };
  B.act('fxSet', el => { S.settings[el.dataset.arg] = el.value; B.save(); B.fx.particles(true); B.fx.apply(); B.emit('sfx'); });
  B.act('fxGlass', el => { S.settings.glass = +el.value; el.style.setProperty('--p', el.value + '%'); const v = document.getElementById('glassv'); if (v) v.textContent = el.value + ' %'; B.fx.glass(); B.save(); });
  B.act('fxSound', el => { S.settings.sound = !S.settings.sound; B.save(); el.classList.toggle('on', S.settings.sound); if (S.settings.sound) B.fx.sound('on'); });
  B.act('fxTest', el => B.fx.sound(el.dataset.arg));
  B.act('genSave', el => { const f = new FormData(el); const s = S.settings; s.city = String(f.get('city')).trim() || s.city; s.lat = parseFloat(f.get('lat')) || s.lat; s.lon = parseFloat(f.get('lon')) || s.lon; s.nasUrl = String(f.get('nasUrl')).trim(); B.save(); B.loadWeather(); B.toast('C’est enregistré', 'check'); });
  B.act('geo', async () => {
    const inp = document.querySelector('[name=city]'); const q = inp.value.trim(); if (!q) return;
    try { const r = await fetch('https://geocoding-api.open-meteo.com/v1/search?count=1&language=fr&name=' + encodeURIComponent(q)); const j = await r.json(); const g = j.results && j.results[0]; if (!g) return B.toast('Ville introuvable', 'info'); document.querySelector('[name=lat]').value = g.latitude.toFixed(4); document.querySelector('[name=lon]').value = g.longitude.toFixed(4); inp.value = g.name; B.toast(g.name + ' (' + (g.admin1 || g.country) + ')', 'pin'); }
    catch (e) { B.toast('Recherche impossible hors ligne', 'info'); }
  });
  B.act('setFlag', el => { const k = el.dataset.arg; S.settings[k] = !S.settings[k]; B.save(); el.classList.toggle('on', S.settings[k]); });
  B.act('uName', el => { const u = S.users.find(x => x.id === el.dataset.id); u.name = el.value.trim() || u.name; B.save(); B.emit('users'); });
  B.act('uPlace', el => { const u = S.users.find(x => x.id === el.dataset.id); u.place = el.value; B.save(); B.emit('users'); });
  B.act('uPin', el => { const u = S.users.find(x => x.id === el.dataset.id), v = el.value.replace(/\D/g, '').slice(0, 4); if (v && v.length !== 4) { B.toast('Le code doit faire 4 chiffres', 'lock'); return; } u.pin = v; B.save(); B.toast(v ? 'Code enregistré pour ' + u.name : 'Code retiré', 'lock'); });
  B.act('pickAvatar', el => {
    const u = S.users.find(x => x.id === el.dataset.arg);
    B.modal('<h2>' + ico('user') + 'Avatar de ' + esc(u.name) + '</h2><div class="avgrid">' + DATA.AVATARS.map(g => '<h4><span class="sym">' + g.sym + '</span>' + g.group.toUpperCase() + ' <small>(' + g.items.length + ' avatars)</small></h4><div class="g">' +
      g.items.map(a => '<button class="' + (u.avatar === a.src ? 'sel' : '') + '" style="--ring:' + a.ring + ';--glow:' + a.ring + '" data-act="setAvatar" data-id="' + u.id + '" data-arg="' + a.src + '" data-ring="' + a.ring + '"><img src="' + a.src + '" alt="" loading="lazy"></button>').join('') + '</div>').join('') + '</div>', 'wide');
  });
  B.act('setAvatar', el => { const u = S.users.find(x => x.id === el.dataset.id); u.avatar = el.dataset.arg; u.ring = el.dataset.ring; u.glow = el.dataset.ring; B.save(); B.closeModal(); B.emit('users'); B.emit('sprof'); B.toast('Nouvel avatar pour ' + u.name, 'user'); });
  RENDER.sdata = () => '<div style="display:flex;flex-direction:column;gap:12px;flex:1">' +
    '<div class="tile" style="padding:12px 14px;display:flex;align-items:center;gap:12px">' + B.badge('home') + '<div style="flex:1"><b style="font-weight:500">Pièces & appareils</b><div class="muted" style="font-size:12.5px">' + (isAdmin() ? 'Ajouter, retirer ou masquer' : 'Réservé aux administrateurs') + '</div></div>' + (isAdmin() ? '<button class="btn sm pri" data-act="roomsManager">' + ico('edit') + 'Gérer</button>' : ico('lock').replace('class="ico', 'style="font-size:20px;color:#93a8cc" class="ico')) + '</div>' +
    '<a class="tile" href="#pieces" style="padding:12px 14px;display:flex;align-items:center;gap:12px">' + B.badge('folder') + '<div style="flex:1"><b style="font-weight:500">Toutes les pièces</b><div class="muted" style="font-size:12.5px">Vue d’ensemble, pièces ajoutées comprises</div></div>' + ico('chevR') + '</a>' +
    '<div class="row" style="flex-wrap:wrap;margin-top:auto"><button class="btn sm" data-act="exportCfg">' + ico('download') + 'Exporter</button><label class="btn sm" style="cursor:pointer">' + ico('upload') + 'Importer<input type="file" accept="application/json" data-change="importCfg" hidden></label><button class="btn sm dan" data-act="resetCfg">' + ico('refresh') + 'Réinitialiser</button></div>' +
    '<span class="muted" style="font-size:12px">Bêta OS 5.2 · réglages gardés sur cet appareil</span></div>';
  B.act('exportCfg', () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' })); a.download = 'beta-os-sauvegarde.json'; a.click(); });
  B.act('importCfg', el => { const f = el.files[0]; if (!f) return; f.text().then(t => { try { const j = JSON.parse(t); if (j.v !== 5) throw 0; localStorage.setItem('betaos.v5', JSON.stringify(j)); location.reload(); } catch (e) { B.toast('Ce fichier n’est pas une sauvegarde Bêta OS', 'info'); } }); });
  B.act('resetCfg', () => { if (confirm('Remettre Bêta OS à zéro ? Vos réglages, favoris et agenda seront effacés.')) { localStorage.removeItem('betaos.v5'); location.reload(); } });
  B.route('parametres', { title: 'Paramètres', bg: BG, render: () => head('parametres', 'Paramètres', 'Profils, connexions et préférences', 'gearFill', () => [{ icon: 'homeFill', v: B.HA.enabled() ? (B.HA.wsOk ? 'Temps réel' : B.HA.online ? 'Relié' : 'Erreur') : 'Démo', l: 'Home Assistant', cls: 'c' }, { icon: 'family', v: S.users.length, l: 'Profils' }, { icon: 'wand', v: S.routines.length, l: 'Routines', go: 'routines' }, { icon: 'info', v: '5.2', l: 'Version' }], ['ha', 'users']) +
    card([105, 235, 760, 640], 'Profils (4 maximum)', 'users', T({ t: 'sprof', keys: ['sprof'] })) +
    card([770, 235, 1522, 640], 'Home Assistant', 'home', T({ t: 'sha', keys: ['ha'] })) +
    card([105, 650, 560, 1012], 'Général', 'gear', T({ t: 'sgen' })) +
    card([570, 650, 1040, 1012], 'Ambiance & saisons', 'weather', T({ t: 'sfx', keys: ['sfx'] })) +
    card([1050, 650, 1522, 1012], 'Maison & sauvegarde', 'nas', T({ t: 'sdata', keys: ['sprof'] })) });

})();

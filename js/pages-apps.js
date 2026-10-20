/* Bêta OS — Énergie, Multimédia, NAS, Calendrier, Mails, Bêta IA, Paramètres */
(function () {
  const B = window.BOS, { S, DATA, esc, F, dev, setDev, T, RENDER, box, px, WX, Music } = B;
  const A = 'assets/', BG = A + 'bg/generic.jpg';
  const card = (r, title, icon, body, extra) => '<section class="card pcard abs" style="' + box(r) + '"' + (extra || '') + '><h2>' + ico(icon) + '<span>' + title + '</span><span class="sp"></span></h2>' + body + '</section>';
  const head = (id, title, sub, icon, quick) => B.side(id) + B.header({ id, title, sub, icon, quick });

  /* ======================= ÉNERGIE ======================= */
  function hourly() {
    const prod = [], cons = [];
    for (let h = 0; h < 24; h++) {
      prod.push(Math.max(0, 4.6 * Math.sin(Math.PI * (h - 6.8) / 13.6)));
      cons.push(.45 + .25 * Math.sin(h / 3) + (h >= 7 && h <= 9 ? 1.4 : 0) + (h >= 18 && h <= 22 ? 1.7 : 0) + (h >= 12 && h <= 13 ? .8 : 0));
    }
    return { prod, cons };
  }
  RENDER.echart = s => {
    const { prod, cons } = hourly(), W = 900, H = 260, now = new Date().getHours();
    const x = i => 30 + i * (W - 40) / 24, y = v => H - 24 - v / 5 * (H - 40);
    const line = cons.map((v, i) => (i ? 'L' : 'M') + (x(i) + 15).toFixed(1) + ' ' + y(v).toFixed(1)).join(' ');
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;flex:1;min-height:0" role="img" aria-label="Production et consommation sur 24 heures"><defs><linearGradient id="pb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#47e6ff"/><stop offset="1" stop-color="#1366ff" stop-opacity=".5"/></linearGradient></defs>' +
      [0, 1, 2, 3, 4, 5].map(v => '<line x1="30" x2="' + (W - 10) + '" y1="' + y(v) + '" y2="' + y(v) + '" stroke="rgba(120,170,255,.12)"/><text x="4" y="' + (y(v) + 4) + '" fill="#93a8cc" font-size="11">' + v + '</text>').join('') +
      prod.map((v, i) => '<rect x="' + (x(i) + 5) + '" y="' + y(v) + '" width="' + ((W - 40) / 24 - 10) + '" height="' + (H - 24 - y(v)) + '" rx="2" fill="url(#pb)" opacity="' + (i <= now ? 1 : .35) + '"/>').join('') +
      '<path d="' + line + '" fill="none" stroke="#ff6fae" stroke-width="2.5" style="filter:drop-shadow(0 0 6px rgba(255,100,170,.8))"/>' +
      '<line x1="' + (x(now) + 15) + '" x2="' + (x(now) + 15) + '" y1="10" y2="' + (H - 24) + '" stroke="#ffd23f" stroke-dasharray="4 4"/>' +
      [0, 3, 6, 9, 12, 15, 18, 21].map(h => '<text x="' + (x(h) + 6) + '" y="' + (H - 6) + '" fill="#93a8cc" font-size="11">' + h + 'h</text>').join('') + '</svg>' +
      '<div class="row" style="gap:20px;font-size:13px;color:#cfdcf3"><span class="row" style="gap:8px"><i style="width:14px;height:10px;border-radius:2px;background:#2fb6ff"></i>Production solaire (kW)</span><span class="row" style="gap:8px"><i style="width:14px;height:3px;background:#ff6fae"></i>Consommation (kW)</span><span class="row" style="gap:8px"><i style="width:14px;height:0;border-top:2px dashed #ffd23f"></i>Maintenant</span></div>';
  };
  RENDER.ekpi = () => {
    const h = B.house(), sol = B.solarNow();
    return '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;flex:1">' +
      '<div class="tile kpi"><small>Consommation</small><b>' + h.kw.toFixed(1) + ' kW</b><em>vs -32 % hier</em></div>' +
      '<div class="tile kpi"><small>Production</small><b>' + sol.toFixed(1) + ' kW</b><em>18.6 kWh aujourd’hui</em></div>' +
      '<div class="tile kpi"><small>Aujourd’hui</small><b>14.2 kWh</b><em style="color:#cfdcf3">≈ 2,84 € TTC</em></div>' +
      '<div class="tile kpi"><small>Autoconsommation</small><b>68 %</b><em>Objectif 70 %</em></div></div>';
  };
  RENDER.erooms = () => {
    const rooms = {};
    for (const id in DATA.DEVICES) {
      const d = DATA.DEVICES[id], s = dev(id); let w = 0;
      if (d.type === 'light' && s.on) w = .02; if (d.type === 'group' && s.on) w = .01 * s.lit; if (d.type === 'clim' && s.on && id !== 'home.chauffage') w = .18;
      if (d.type === 'power' && s.on) w = { 'rdc.salon.tv': .12, 'rdc.salon.amp': .08, 'rdc.salon.pc': .15 }[id] || 0; if (d.type === 'app' && s.on) w = .55; if (d.type === 'charger' && s.on) w = 7.4;
      if (w) rooms[d.room] = (rooms[d.room] || 0) + w;
    }
    const list = Object.entries(rooms).sort((a, b) => b[1] - a[1]).slice(0, 7), max = list.length ? list[0][1] : 1;
    return '<div class="scroll" style="display:flex;flex-direction:column;gap:12px">' + (list.length ? list.map(r => '<div><div class="row" style="justify-content:space-between;font-size:14px;margin-bottom:5px"><span>' + esc(r[0]) + '</span><span class="cy">' + r[1].toFixed(2) + ' kW</span></div><div class="hbar"><i style="width:' + (r[1] / max * 100) + '%"></i></div></div>').join('') : '<p class="muted">Tout est éteint.</p>') + '</div>';
  };
  RENDER.eactive = () => {
    const on = Object.values(DATA.DEVICES).filter(d => ['light', 'clim', 'power', 'app', 'charger', 'group'].includes(d.type) && dev(d.id).on && !d.id.startsWith('home.'));
    return '<div class="list scroll" style="flex:1">' + on.map(d => '<div class="li" style="min-height:44px"><span class="ic">' + ico({ light: 'bulbFill', group: 'bulbFill', clim: 'snow', power: 'power', app: 'washer', charger: 'charger' }[d.type]) + '</span><div><b>' + esc(d.name) + '</b><small>' + esc(d.room) + '</small></div><button class="sw on" data-act="toggle" data-id="' + d.id + '" aria-label="Éteindre ' + esc(d.name) + '"></button></div>').join('') + (on.length ? '' : '<p class="muted">Aucun appareil actif.</p>') + '</div>';
  };
  RENDER.ebatt = () => {
    const b = dev('ext.borne');
    return '<div style="display:flex;flex-direction:column;gap:14px">' +
      '<div class="erow tile" style="grid-template-columns:52px auto 1fr">' + ico('batteryV').replace('class="ico', 'style="color:#22e3a4" class="ico') + '<b>12.4 kWh / 16 kWh</b><small>Batterie virtuelle</small><div class="bar" style="width:150px"><div><i style="width:76%"></i></div>76%</div></div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><div class="tile kpi"><small>Réseau (import)</small><b>0.4 kW</b><em style="color:#cfdcf3">Heures creuses</em></div><div class="tile kpi"><small>Revente (export)</small><b>' + (B.solarNow() > 1.5 ? (B.solarNow() - 1.2).toFixed(1) : '0.0') + ' kW</b><em>Surplus solaire</em></div></div>' +
      '<div class="tile" style="display:flex;align-items:center;gap:14px;padding:12px 14px">' + ico('charger').replace('class="ico', 'style="font-size:30px;color:#2fb6ff" class="ico') + '<div style="flex:1"><b style="font-weight:400">Borne de recharge</b><div class="muted" style="font-size:13px">' + (b.on ? 'Charge en cours · 7.4 kW' : 'Disponible · véhicule non connecté') + '</div></div><button class="pbtn' + (b.on ? '' : ' off') + '" data-act="borne" aria-label="Charge">' + ico('power') + '</button></div></div>';
  };
  B.route('energie', { title: 'Énergie', bg: BG, render: () => head('energie', 'Énergie', 'Suivez votre consommation et votre production', 'boltPlain', ['off:all', 'eco', 'cov:all', 'jour:rdc']) +
    card([105, 235, 560, 600], 'Vue instantanée', 'bolt', T({ t: 'ekpi', keys: ['house'] })) +
    card([570, 235, 1522, 600], 'Production & consommation — 24 h', 'solar', T({ t: 'echart' })) +
    card([105, 610, 560, 935], 'Batterie & réseau', 'batteryV', T({ t: 'ebatt', keys: ['dev:ext.borne'] })) +
    card([570, 610, 1040, 935], 'Consommation par pièce', 'homeFill', T({ t: 'erooms', keys: ['house'] })) +
    card([1050, 610, 1522, 935], 'Appareils actifs', 'power', T({ t: 'eactive', keys: ['house'] })) +
    B.iabar(box([105, 944, 1522, 1012]), ['off:all', 'eco', 'cov:all', 'soir:rdc']) });

  /* ======================= MULTIMÉDIA ======================= */
  RENDER.mnow = () => {
    const c = Music.cur();
    return '<div style="display:grid;grid-template-columns:230px 1fr;gap:22px;flex:1;min-height:0">' +
      '<div style="border-radius:12px;overflow:hidden;box-shadow:0 0 30px rgba(40,140,255,.35)">' + (c.cover ? '<img src="' + c.cover + '" alt="" style="width:100%;height:100%;object-fit:cover">' : B.radioArt(c)) + '</div>' +
      '<div style="display:flex;flex-direction:column;gap:10px;min-width:0"><span class="cy" style="font-size:14px">' + (Music.playing ? 'En lecture' : 'En pause') + ' · ' + (c.kind === 'radio' ? 'Radio' : 'YouTube') + '</span>' +
      '<b style="font-size:30px;font-weight:400">' + esc(c.name) + '</b><span class="muted" style="font-size:15px">' + esc(c.artist || '') + '</span>' +
      '<div style="margin:6px 0">' + B.transport() + '</div>' + B.volRow().replace('class="volrow"', 'class="volrow" style="display:flex"') +
      T({ t: 'mprog', keys: ['mtime', 'music'] }).replace('class="prog"', 'class="prog" style="display:flex;align-items:center;gap:12px;font-size:14px"') +
      '<div class="outs" style="flex-direction:row;flex-wrap:wrap;gap:6px;margin-top:auto">' + DATA.OUTPUTS.map(o => '<button style="grid-template-columns:22px auto;width:auto" class="' + (S.music.out === o.id ? 'on' : '') + '" data-act="mOut" data-arg="' + o.id + '">' + ico(o.icon) + '<span>' + o.name + '</span></button>').join('') + '</div>' +
      '<button class="btn" style="align-self:flex-start" data-act="ytShow">' + ico('video') + 'Afficher / masquer la vidéo</button></div></div>';
  };
  RENDER.mlists = () => '<div class="scroll" style="display:grid;grid-template-columns:repeat(5,1fr);gap:14px;flex:1">' + S.playlists.map(p =>
    '<div class="tile" style="padding:8px;display:flex;flex-direction:column;gap:8px' + (S.music.src === p.id ? ';border-color:#2fd3ff;box-shadow:0 0 14px rgba(40,200,255,.45)' : '') + '"><button data-act="mPlay" data-arg="' + p.id + '" style="position:relative"><img src="' + p.cover + '" alt="" style="width:100%;height:150px;object-fit:cover;border-radius:7px"><span style="position:absolute;right:8px;bottom:8px;width:38px;height:38px;border-radius:50%;display:grid;place-items:center;background:rgba(10,30,70,.8);border:1px solid #2fd3ff;color:#fff;font-size:18px">' + ico(S.music.src === p.id && Music.playing ? 'pause' : 'play') + '</span></button>' +
    '<b style="font-weight:500;font-size:15px">' + esc(p.name) + '</b><small class="muted" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(p.artist || '') + '</small>' +
    '<div class="row" style="gap:6px"><button class="sq" data-act="fav" data-arg="' + p.id + '" aria-label="Favori" style="color:' + (S.favs.includes(p.id) ? '#ff5fae' : '#9fdcff') + '">' + ico(S.favs.includes(p.id) ? 'heartFill' : 'heart') + '</button><button class="sq" data-act="editList" data-arg="' + p.id + '" aria-label="Modifier la source">' + ico('edit') + '</button></div></div>').join('') + '</div>';
  RENDER.mradios = () => '<div class="scroll" style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;flex:1;align-content:start">' + DATA.RADIOS.map(r =>
    '<button class="tile" data-act="mPlay" data-arg="' + r.id + '" style="display:flex;align-items:center;gap:10px;padding:10px;height:64px;text-align:left' + (S.music.src === r.id ? ';border-color:#2fd3ff;box-shadow:0 0 14px rgba(40,200,255,.45)' : '') + '"><span style="width:42px;height:42px;flex:none;border-radius:10px;display:grid;place-items:center;font-size:20px;background:radial-gradient(circle at 30% 20%,' + r.color + ',#0a1636 80%)">' + ico(S.music.src === r.id && Music.playing ? 'pause' : 'radio') + '</span><span style="font-size:14px">' + esc(r.name) + '<small class="muted" style="display:block;font-size:12px">En direct</small></span></button>').join('') +
    '</div><p class="muted" style="font-size:12px;margin:8px 0 0">Flux officiels (connexion Internet requise). Sur iPhone, la lecture démarre après un toucher.</p>';
  B.act('fav', el => { const i = S.favs.indexOf(el.dataset.arg); if (i >= 0) S.favs.splice(i, 1); else S.favs.push(el.dataset.arg); B.save(); B.emit('music'); });
  B.act('ytShow', () => { const b = document.getElementById('ytbox'); if (!b || !b.innerHTML) return B.toast('Aucune vidéo YouTube en cours', 'video'); b.classList.toggle('show'); });
  B.act('editList', el => {
    const p = S.playlists.find(x => x.id === el.dataset.arg);
    B.modal('<h2>' + ico('edit') + 'Source de « ' + esc(p.name) + ' »</h2><form data-submit="saveList" data-arg="' + p.id + '" style="display:flex;flex-direction:column;gap:12px">' +
      '<label class="field">Nom<input name="name" value="' + esc(p.name) + '" required></label>' +
      '<label class="field">Lien YouTube (vidéo, live ou playlist) ou URL de flux audio<input name="ref" value="' + esc(p.kind === 'yt' && /^[\w-]{11}$/.test(p.ref) ? 'https://www.youtube.com/watch?v=' + p.ref : p.ref) + '" required></label>' +
      '<label class="field">Sous-titre<input name="artist" value="' + esc(p.artist || '') + '"></label>' +
      '<div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-act="closeModal">Annuler</button><button class="btn pri">' + ico('check') + 'Enregistrer</button></div></form>', 'sm');
  });
  B.act('saveList', el => {
    const p = S.playlists.find(x => x.id === el.dataset.arg), f = new FormData(el);
    const ref = String(f.get('ref')).trim();
    p.name = String(f.get('name')).trim() || p.name; p.artist = String(f.get('artist')).trim();
    p.kind = Music.ytId(ref) ? 'yt' : 'radio'; p.ref = ref;
    B.save(); B.closeModal(); B.emit('music'); B.toast('Source enregistrée', 'check');
  });
  RENDER.mplex = () => '<div style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px">' + DATA.PLEX.map((p, i) => '<button data-act="plexItem" data-arg="' + i + '" style="display:flex;flex-direction:column;gap:6px;text-align:left"><img src="' + p.img + '" alt="" style="width:100%;aspect-ratio:72/78;object-fit:cover;border-radius:7px;box-shadow:0 4px 14px rgba(0,0,0,.5)"><span style="font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(p.title) + '</span>' + (p.progress ? '<div class="hbar" style="height:4px"><i style="width:' + p.progress + '%"></i></div>' : '<small class="muted">' + p.kind + '</small>') + '</button>').join('') + '</div>' +
    '<div class="row" style="margin-top:auto;gap:8px;flex-wrap:wrap">' + ['Films', 'Séries', 'Anime', 'Ajouts récents', 'Favoris'].map((c, i) => '<button class="cat' + (S.plexCat === ['films', 'series', 'anime', 'recent', 'favs'][i] ? ' on' : '') + '" style="padding:0 14px" data-act="plexCat" data-arg="' + ['films', 'series', 'anime', 'recent', 'favs'][i] + '">' + c + '</button>').join('') + '<span style="flex:1"></span><button class="btn pri" data-act="scene" data-arg="plex:open">' + ico('plex') + 'Ouvrir Plex</button></div>';
  B.route('multimedia', { title: 'Multimédia', bg: BG, render: () => head('multimedia', 'Multimédia', 'Musique, radios, YouTube et Plex', 'media', ['off:rdc', 'soir:rdc', 'plex:open', 'music:japon']) +
    card([105, 235, 760, 600], 'Lecture en cours', 'musicFill', T({ t: 'mnow', keys: ['music'] })) +
    card([770, 235, 1522, 600], 'Mes playlists', 'heart', T({ t: 'mlists', keys: ['music'] })) +
    card([105, 610, 800, 935], 'Radios', 'radio', T({ t: 'mradios', keys: ['music'] })) +
    card([810, 610, 1522, 935], 'Plex', 'plex', T({ t: 'mplex', keys: ['plex'] })) +
    B.iabar(box([105, 944, 1522, 1012]), ['music:japon', 'plex:open', 'soir:rdc', 'off:rdc']) });

  /* ======================= NAS ======================= */
  const VOLS = [['Volume 1 · RAID 1', 8.2, 10], ['Volume 2 · SSD cache', .7, 1], ['Volume 3 · Sauvegardes', 3.5, 5]];
  const SVCS = [['Nextcloud', 'cloud', 'En ligne', ''], ['Photos AI', 'photo', 'En ligne', ''], ['Surveillance', 'shield', '9 caméras', ''], ['Plex Media Server', 'plex', 'En ligne', ''], ['Home Assistant', 'homeFill', 'Configurer', 'wait'], ['Téléchargements', 'download', '2 en cours', 'wait'], ['Sauvegarde Cloud', 'cloudUp', 'Hier 03:00', ''], ['Docker', 'nas', '12 conteneurs', '']];
  B.route('nas', { title: 'NAS', bg: BG, render: () => head('nas', 'NAS UGREEN', 'Stockage, services et sauvegardes', 'nas', ['off:all', 'eco', 'plex:open', 'cov:all']) +
    card([105, 235, 760, 560], 'Stockage', 'nas', '<div class="nasbox tile" style="margin:0 0 12px"><img src="' + A + 'devices/nas.jpg" alt=""><span class="l">Stockage total</span><span class="r">12.4 To / 16 To</span><div class="bar"><i style="width:78%"></i></div><span class="pct">78%</span></div>' +
      VOLS.map(v => '<div style="margin:8px 0"><div class="row" style="justify-content:space-between;font-size:14px;margin-bottom:6px"><span>' + v[0] + '</span><span class="muted">' + v[1] + ' / ' + v[2] + ' To</span></div><div class="hbar"><i style="width:' + (v[1] / v[2] * 100) + '%"></i></div></div>').join('') +
      '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:auto"><div class="tile kpi"><small>CPU</small><b>12 %</b></div><div class="tile kpi"><small>Mémoire</small><b>5.1 Go</b><em style="color:#cfdcf3">sur 16 Go</em></div><div class="tile kpi"><small>Température</small><b>41 °C</b><em>Normale</em></div></div>') +
    card([770, 235, 1522, 560], 'Services', 'sparkle', '<div class="list scroll" style="display:grid;grid-template-columns:1fr 1fr;column-gap:10px">' + SVCS.map(s => '<div class="li"><span class="ic">' + ico(s[1]) + '</span><div><b>' + s[0] + '</b></div><span class="tag2 ' + s[3] + '">' + s[2] + '</span></div>').join('') + '</div>') +
    card([105, 570, 760, 935], 'Activité', 'download', '<div class="list">' + [['Ubuntu 26.04 LTS.iso', 64], ['Vacances Japon 2025 (photos)', 27]].map(d => '<div class="li"><span class="ic">' + ico('download') + '</span><div><b>' + d[0] + '</b><div class="hbar" style="margin-top:6px;height:6px"><i style="width:' + d[1] + '%"></i></div></div><span class="cy">' + d[1] + '%</span></div>').join('') +
      '<div class="li"><span class="ic">' + ico('cloudUp') + '</span><div><b>Sauvegarde complète</b><small>Terminée hier à 03:00 · 182 Go</small></div><span class="tag2">OK</span></div>' +
      '<div class="li"><span class="ic">' + ico('shieldCheck') + '</span><div><b>Vérification RAID</b><small>Aucune erreur détectée</small></div><span class="tag2">Sain</span></div></div>') +
    card([770, 570, 1522, 935], 'Raccourcis', 'folder', '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px">' + [['files', 'Fichiers'], ['photo', 'Photos'], ['video', 'Vidéos'], ['cloudUp', 'Sauvegarde']].map(b => '<button class="tile" data-act="nasOpen" data-arg="' + b[1] + '" style="height:120px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;font-size:15px">' + ico(b[0]).replace('class="ico', 'style="font-size:40px;color:#2fb6ff;filter:drop-shadow(0 0 8px rgba(40,170,255,.6))" class="ico') + b[1] + '</button>').join('') + '</div>' +
      '<p class="muted" style="font-size:13px;margin:16px 0 10px">' + (S.settings.nasUrl ? 'Interface : ' + esc(S.settings.nasUrl) : 'Ajoutez l’adresse de votre NAS (ex. http://192.168.1.20:9999) dans Paramètres pour ouvrir UGOS Pro.') + '</p>' +
      '<div class="row" style="margin-top:auto"><button class="btn pri" data-act="nasOpen">' + ico('nas') + 'Ouvrir UGOS Pro</button><a class="btn" href="#parametres">' + ico('gear') + 'Paramètres</a></div>') +
    B.iabar(box([105, 944, 1522, 1012]), ['off:all', 'eco', 'plex:open', 'music:japon']) });

  /* ======================= CALENDRIER ======================= */
  let calView = new Date(); calView.setDate(1);
  let calSel = F.ymd(new Date());
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
    return '<div style="display:flex;flex-direction:column;flex:1;min-height:0"><div class="row" style="margin-bottom:12px"><button class="sq" data-act="calNav" data-arg="-1" aria-label="Mois précédent">' + ico('chevL') + '</button><b style="font-size:22px;font-weight:400;min-width:220px;text-align:center">' + F.MOIS[m] + ' ' + y + '</b><button class="sq" data-act="calNav" data-arg="1" aria-label="Mois suivant">' + ico('chevR') + '</button><button class="btn" data-act="calNav" data-arg="0">Aujourd’hui</button><span style="flex:1"></span>' +
      '<label class="btn" style="cursor:pointer">' + ico('upload') + 'Importer .ics<input type="file" accept=".ics,text/calendar" data-change="icsImport" hidden></label></div>' +
      '<div class="cal" style="grid-template-rows:auto repeat(6,1fr)">' + ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map(d => '<span class="dh">' + d + '</span>').join('') + cells + '</div></div>';
  };
  RENDER.calday = () => {
    const d = new Date(calSel + 'T12:00'), evs = S.events.filter(e => e.date === calSel).sort((a, b) => a.time.localeCompare(b.time));
    return '<div style="display:flex;flex-direction:column;gap:12px;flex:1;min-height:0"><b style="font-size:19px;font-weight:400" class="cy">' + F.dayMonth(d) + '</b>' +
      '<div class="list scroll" style="flex:1">' + (evs.length ? evs.map(e => '<div class="li" style="grid-template-columns:10px 1fr auto"><i style="width:8px;height:34px;border-radius:4px;background:' + e.color + ';box-shadow:0 0 8px ' + e.color + '"></i><div><b>' + esc(e.title) + '</b><small>' + e.time + ' · ' + e.dur + ' min</small></div><div class="row" style="gap:4px"><button class="sq" data-act="calEdit" data-arg="' + e.id + '" aria-label="Modifier">' + ico('edit') + '</button><button class="sq" data-act="calDel" data-arg="' + e.id + '" aria-label="Supprimer">' + ico('trash') + '</button></div></div>').join('') : '<p class="muted">Aucun événement.</p>') + '</div>' +
      '<form data-submit="calAdd" style="display:flex;flex-direction:column;gap:10px;border-top:1px solid rgba(90,150,240,.2);padding-top:12px"><input type="hidden" name="id" value="">' +
      '<label class="field">Titre<input name="title" required placeholder="Nouvel événement"></label><div class="grid2"><label class="field">Heure<input type="time" name="time" value="09:00" required></label><label class="field">Durée (min)<input type="number" name="dur" value="60" min="5" step="5"></label></div>' +
      '<div class="row" style="gap:8px">' + ['#1f7dff', '#ff8a34', '#22d3ee', '#5ee7ff', '#ff5fae', '#9b6bff', '#22e3a4'].map((c, i) => '<label style="cursor:pointer"><input type="radio" name="color" value="' + c + '"' + (i ? '' : ' checked') + ' hidden><span style="display:block;width:24px;height:24px;border-radius:50%;background:' + c + ';box-shadow:0 0 8px ' + c + '"></span></label>').join('') + '<span style="flex:1"></span><button class="btn pri">' + ico('plus') + 'Ajouter</button></div></form></div>';
  };
  B.act('calNav', el => { const a = +el.dataset.arg; if (!a) { calView = new Date(); calView.setDate(1); calSel = F.ymd(new Date()); } else calView.setMonth(calView.getMonth() + a); B.emit('cal'); });
  B.act('calDay', el => { calSel = el.dataset.arg; B.emit('cal'); });
  B.act('calDel', el => { S.events = S.events.filter(e => e.id !== el.dataset.arg); B.save(); B.emit('cal'); B.emit('events'); B.toast('Événement supprimé', 'trash'); });
  B.act('calEdit', el => {
    const e = S.events.find(x => x.id === el.dataset.arg), f = document.querySelector('[data-submit="calAdd"]');
    f.id.value = e.id; f.title.value = e.title; f.time.value = e.time; f.dur.value = e.dur;
    const r = f.querySelector('input[value="' + e.color + '"]'); if (r) r.checked = true;
    f.querySelector('.btn.pri').lastChild.textContent = 'Modifier'; f.title.focus();
  });
  B.act('calAdd', el => {
    const f = new FormData(el), id = f.get('id');
    const ev = { id: id || 'e' + Date.now(), date: calSel, time: f.get('time'), dur: +f.get('dur') || 60, title: String(f.get('title')).trim(), color: f.get('color') || '#1f7dff' };
    if (id) Object.assign(S.events.find(x => x.id === id), ev); else S.events.push(ev);
    B.save(); B.emit('cal'); B.emit('events'); B.toast(id ? 'Événement modifié' : 'Événement ajouté', 'calendar');
  });
  B.act('icsImport', el => {
    const file = el.files[0]; if (!file) return;
    file.text().then(txt => {
      const un = txt.replace(/\r?\n[ \t]/g, ''); let n = 0;
      un.split('BEGIN:VEVENT').slice(1).forEach(b => {
        const g = k => { const m = b.match(new RegExp('^' + k + '[^:]*:(.*)$', 'm')); return m ? m[1].trim() : ''; };
        const ds = g('DTSTART'), de = g('DTEND'); if (!ds) return;
        const p = s => { const m = s.match(/(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/); if (!m) return null; const d = s.endsWith('Z') ? new Date(Date.UTC(+m[1], m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0))) : new Date(+m[1], m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)); return d; };
        const a = p(ds), z = de ? p(de) : null; if (!a) return;
        S.events.push({ id: 'i' + Date.now() + n, date: F.ymd(a), time: /T\d/.test(ds) ? F.time(a) : '00:00', dur: z ? Math.max(15, Math.round((z - a) / 6e4)) : 60, title: g('SUMMARY').replace(/\\,/g, ',').replace(/\\n/g, ' ') || 'Événement', color: '#9b6bff' });
        n++;
      });
      B.save(); B.emit('cal'); B.emit('events'); B.toast(n + ' événement(s) importé(s)', 'calendar');
    });
  });
  B.route('calendrier', { title: 'Calendrier', bg: BG, render: () => head('calendrier', 'Calendrier', 'Agenda familial et rendez-vous', 'calendar', ['off:all', 'soir:rdc', 'jour:rdc', 'cov:all']) +
    card([105, 235, 1100, 1012], 'Agenda', 'calendar', T({ t: 'calgrid', keys: ['cal'] })) +
    card([1110, 235, 1522, 1012], 'Jour sélectionné', 'edit', T({ t: 'calday', keys: ['cal'] })) });

  /* ======================= MAILS ======================= */
  RENDER.mlist = () => '<div class="mlist scroll" style="flex:1">' + S.mails.map(m => '<div class="m' + (m.read ? ' read' : '') + (S.openMail === m.id ? ' sel' : '') + '" data-act="mailSel" data-arg="' + m.id + '"><span class="mrow" style="height:auto"><span class="lg" style="background:' + m.bg + '">' + esc(m.logo) + '</span></span><div style="min-width:0"><b>' + esc(m.from) + '</b><small>' + esc(m.subj) + '</small></div><span class="tm">' + m.time + '</span></div>').join('') + '</div>' +
    '<div class="row" style="margin-top:10px"><button class="btn" data-act="mailAllRead">' + ico('check') + 'Tout marquer lu</button><span class="muted" style="font-size:12px;margin-left:auto">Boîte de démonstration</span></div>';
  RENDER.mread = () => {
    const m = S.mails.find(x => x.id === S.openMail);
    if (!m) return '<div class="mread" style="display:grid;place-items:center;flex:1;color:#93a8cc">' + ico('mail').replace('class="ico', 'style="font-size:64px;opacity:.4" class="ico') + 'Sélectionnez un message</div>';
    return '<div class="mread" style="flex:1;display:flex;flex-direction:column;min-height:0"><div class="row" style="align-items:flex-start;gap:14px"><span class="mrow" style="height:auto"><span class="lg" style="background:' + m.bg + ';width:46px;height:46px;font-size:22px">' + esc(m.logo) + '</span></span><div style="flex:1"><h3>' + esc(m.subj) + '</h3><div class="meta">' + esc(m.from) + ' · aujourd’hui ' + m.time + '</div></div></div>' +
      '<div class="body scroll" style="flex:1">' + esc(m.body) + '</div><div class="row" style="margin-top:12px"><a class="btn pri" href="mailto:?subject=' + encodeURIComponent('Re: ' + m.subj) + '">' + ico('send') + 'Répondre</a><button class="btn" data-act="mailUnread" data-arg="' + m.id + '">' + ico('mail') + 'Marquer non lu</button><button class="btn dan" data-act="mailDel" data-arg="' + m.id + '">' + ico('trash') + 'Supprimer</button></div></div>';
  };
  function mailsChanged() { B.save(); B.emit('mails'); B.emit('mailview'); }
  B.act('mailSel', el => { S.openMail = el.dataset.arg; const m = S.mails.find(x => x.id === el.dataset.arg); if (m) m.read = true; mailsChanged(); });
  B.act('mailAllRead', () => { S.mails.forEach(m => m.read = true); mailsChanged(); });
  B.act('mailUnread', el => { S.mails.find(x => x.id === el.dataset.arg).read = false; mailsChanged(); });
  B.act('mailDel', el => { S.mails = S.mails.filter(x => x.id !== el.dataset.arg); S.openMail = null; mailsChanged(); B.toast('Message supprimé', 'trash'); });
  B.route('mails', { title: 'Mails', bg: BG, render: () => {
    const m = S.mails.find(x => x.id === S.openMail); if (m && !m.read) { m.read = true; B.save(); }
    return head('mails', 'Mails', 'Vos messages en un coup d’œil', 'mail', ['off:all', 'soir:rdc', 'jour:rdc', 'cov:all']) +
      card([105, 235, 640, 1012], 'Boîte de réception', 'mail', T({ t: 'mlist', keys: ['mailview'] })) +
      card([650, 235, 1522, 1012], 'Lecture', 'files', T({ t: 'mread', keys: ['mailview'] }));
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
    if (/plex|film|serie/.test(q)) { window.open(S.settings.plexUrl, '_blank'); return 'J’ouvre Plex.'; }
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
    if (/controle la maison|etat|resume|bilan/.test(q)) { const h = B.house(); return 'La maison : ' + h.on + ' lumière(s) allumée(s), ' + (h.open ? h.open + ' volet(s) ouvert(s)' : 'volets fermés') + ', consommation ' + h.kw.toFixed(1) + ' kW, ' + (h.motion ? h.motion + ' mouvement(s) caméra' : 'aucun mouvement') + '. Dites par exemple « éteins le RDC » ou « ferme les volets de l’étage 1 ».'; }
    if (/bonjour|salut|hello|coucou/.test(q)) return 'Bonjour ' + B.user().name + ' ! Je peux piloter les lumières, volets, clim, arrosage, tondeuse, aspirateur, musique et vous donner la météo ou l’agenda.';
    return 'Je n’ai pas compris. Essayez : « éteins tout au RDC », « ferme les volets étage 1 », « mets 21 degrés », « lance la playlist Gaming », « météo », « mes mails ».';
  }
  function SC(k) { const q = B.SCENES[k]; if (q) q.run(); }
  B.ia = ia;
  function askIA(text, silent) {
    if (!text || !text.trim()) return;
    const reply = ia(text);
    S.chat.push({ me: true, t: text }, { me: false, t: reply });
    S.chat = S.chat.slice(-60); B.save(); B.emit('chat');
    if (!silent && B.current !== 'ia') B.toast(reply, 'ai');
    return reply;
  }
  B.act('ia', el => { const i = el.querySelector('input'); askIA(i.value); i.value = ''; });
  B.act('iaHome', el => { const i = el.querySelector('input'); askIA(i.value); i.value = ''; });
  B.act('iaAsk', el => { askIA(el.dataset.arg); if (/plex/i.test(el.dataset.arg)) return; });
  B.act('iaPage', el => { const i = el.querySelector('input'); askIA(i.value, true); i.value = ''; i.focus(); });
  B.act('mic', el => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return B.toast('Dictée vocale non disponible sur ce navigateur', 'mic');
    const r = new SR(); r.lang = 'fr-FR'; r.interimResults = false;
    const btn = el.closest('.mic') || el; btn.classList.add('rec');
    r.onresult = e => { const t = e.results[0][0].transcript; askIA(t, B.current === 'ia'); };
    r.onend = () => btn.classList.remove('rec');
    r.onerror = () => { btn.classList.remove('rec'); B.toast('Micro indisponible', 'mic'); };
    r.start();
  });
  RENDER.chat = () => '<div class="chat scroll" id="chatlog">' + (S.chat.length ? '' : '<div class="msg bot">Bonjour ' + esc(B.user().name) + ' 👋\nJe suis Bêta IA. Je pilote la maison en local : lumières, volets, climatisation, arrosage, tondeuse, aspirateur, musique… et je réponds sur la météo, l’agenda et vos mails.</div>') +
    S.chat.map(c => '<div class="msg ' + (c.me ? 'me' : 'bot') + '">' + esc(c.t) + '</div>').join('') + '</div>';
  B.route('ia', { title: 'Bêta IA', bg: BG, render: () => head('ia', 'Bêta IA', 'Votre assistant domestique', 'ai', ['off:all', 'cov:all', 'soir:rdc', 'jour:rdc']) +
    '<section class="card pcard abs" style="' + box([105, 235, 1100, 1012]) + '"><h2>' + brainSVG().replace('<svg', '<svg style="width:34px;height:34px"') + '<span>Conversation</span><span class="sp"></span><button class="btn" data-act="chatClear">' + ico('trash') + 'Effacer</button></h2>' +
    T({ t: 'chat', keys: ['chat'] }) +
    '<form data-submit="iaPage" class="hia" style="display:block"><div style="display:flex;align-items:center;gap:10px;height:54px;padding:0 10px 0 16px;border-radius:12px;background:rgba(10,24,56,.6);border:1px solid rgba(90,160,255,.3)"><button type="button" class="mic" data-act="mic" style="border:0;background:none;font-size:24px;color:#2fb6ff" aria-label="Dicter">' + ico('mic') + '</button><input name="q" autofocus placeholder="Posez une question ou demandez une action..." style="flex:1;height:100%;background:none;border:0;outline:none;font-size:16px;color:#fff" autocomplete="off" aria-label="Message"><button class="btn pri" aria-label="Envoyer">' + ico('send') + '</button></div></form></section>' +
    card([1110, 235, 1522, 1012], 'Suggestions', 'sparkle', '<div class="list scroll">' + ['Contrôle la maison', 'Éteins tout au RDC', 'Ferme les volets de l’étage 1', 'Mets 21 degrés dans la suite parentale', 'Démarre l’arrosage 15 min', 'Lance la playlist Gaming', 'Mets la radio FIP', 'Quel temps fait-il ?', 'Mon agenda aujourd’hui', 'Ai-je des mails ?', 'Consommation électrique', 'Mode soirée'].map(s => '<button class="li" style="grid-template-columns:30px 1fr;width:100%;text-align:left" data-act="iaChip" data-arg="' + esc(s) + '"><span class="ic" style="width:28px;height:28px;font-size:15px">' + ico('chat') + '</span><span>' + esc(s) + '</span></button>').join('') + '</div>'),
    after: () => { const c = document.getElementById('chatlog'); if (c) c.scrollTop = c.scrollHeight; } });
  B.act('iaChip', el => askIA(el.dataset.arg, true));
  B.act('chatClear', () => { S.chat = []; B.save(); B.emit('chat'); });
  const _emit = B.emit;
  document.addEventListener('DOMContentLoaded', () => { });
  new MutationObserver(() => { const c = document.getElementById('chatlog'); if (c && c.dataset.s !== String(S.chat.length)) { c.dataset.s = S.chat.length; c.scrollTop = c.scrollHeight; } }).observe(document.documentElement, { childList: true, subtree: true });
  void _emit;

  /* ======================= PARAMÈTRES ======================= */
  RENDER.sprof = () => '<div class="list scroll" style="flex:1">' + S.users.map((u, i) => '<div class="li" style="grid-template-columns:64px 1fr 1fr auto;gap:12px">' +
    '<button class="u" style="width:58px" data-act="pickAvatar" data-arg="' + u.id + '" aria-label="Changer l’avatar"><span class="av" style="width:56px;height:56px;margin:0;padding:3px;--ring:' + u.ring + ';--glow:' + (u.glow || (/gradient/.test(u.ring) ? '#ff6fae' : u.ring)) + '"><img src="' + u.avatar + '" alt=""></span></button>' +
    '<label class="field">Nom<input value="' + esc(u.name) + '" data-change="uName" data-id="' + u.id + '"></label>' +
    '<label class="field">Statut<select data-change="uPlace" data-id="' + u.id + '">' + Object.keys(DATA.PLACES).map(k => '<option value="' + k + '"' + (u.place === k ? ' selected' : '') + '>' + DATA.PLACES[k].label + '</option>').join('') + '</select></label>' +
    '<span class="tag2' + (S.user === u.id ? '' : ' wait') + '">' + (S.user === u.id ? 'Actif' : 'Profil ' + (i + 1)) + '</span></div>').join('') + '</div>' +
    '<label class="row" style="margin-top:10px;font-size:14px;gap:10px"><button class="sw sm' + (S.settings.guest ? ' on' : '') + '" data-act="setFlag" data-arg="guest" aria-label="Profil invité"></button>Profil « Invité » (accès limité : sans Mails, NAS, Calendrier ni Paramètres)</label>';
  RENDER.sha = () => {
    const s = S.settings, st = !B.HA.enabled() ? ['wait', 'Non configuré — mode démo'] : B.HA.online ? ['', 'Connecté'] : ['off', B.HA.lastError ? 'Erreur : ' + B.HA.lastError : 'En attente…'];
    return '<form data-submit="haSave" style="display:flex;flex-direction:column;gap:12px;flex:1">' +
      '<div class="row"><span class="tag2 ' + st[0] + '">' + esc(st[1]) + '</span></div>' +
      '<label class="field">Adresse Home Assistant<input name="url" placeholder="http://homeassistant.local:8123" value="' + esc(s.haUrl) + '"></label>' +
      '<label class="field">Jeton d’accès longue durée<input name="token" type="password" placeholder="Profil HA › Sécurité › Jetons d’accès longue durée" value="' + esc(s.haToken) + '"></label>' +
      '<p class="muted" style="font-size:12.5px;margin:0;line-height:1.5">Ajoutez l’origine de Bêta OS dans <code>configuration.yaml</code> : <code>http: cors_allowed_origins:</code>. Le jeton reste uniquement dans ce navigateur.</p>' +
      '<div class="row" style="margin-top:auto;flex-wrap:wrap"><button class="btn pri">' + ico('check') + 'Enregistrer & tester</button><button type="button" class="btn" data-act="haMap">' + ico('edit') + 'Associer les entités</button></div></form>';
  };
  B.act('haSave', async el => {
    const f = new FormData(el); S.settings.haUrl = String(f.get('url')).trim(); S.settings.haToken = String(f.get('token')).trim(); B.save();
    if (!B.HA.enabled()) { B.emit('ha'); return B.toast('Home Assistant désactivé (mode démo)', 'info'); }
    try { await B.HA.req('/api/'); B.HA.online = true; B.toast('Connexion à Home Assistant réussie', 'check'); B.HA.sync(); }
    catch (e) { B.HA.online = false; B.HA.lastError = e.message === 'Failed to fetch' ? 'injoignable ou CORS' : e.message; B.toast('Échec : ' + B.HA.lastError, 'info'); }
    B.emit('ha');
  });
  B.act('haMap', () => {
    const rows = Object.values(DATA.DEVICES).map(d => ['dev', d.id, d.room + ' · ' + d.name, B.HA.entity(d.id)]).concat(Object.keys(DATA.CAMS).map(id => ['cam', id, 'Caméra · ' + DATA.CAMS[id].name, (S.settings.haMap[id] || DATA.CAMS[id].ha)]));
    B.modal('<h2>' + ico('homeFill') + 'Entités Home Assistant</h2><form data-submit="haMapSave"><div class="scroll" style="max-height:60vh;display:grid;grid-template-columns:1fr 1fr;gap:8px 14px">' +
      rows.map(r => '<label class="field" style="font-size:12px">' + esc(r[2]) + '<input name="' + r[1] + '" value="' + esc(r[3]) + '" spellcheck="false"></label>').join('') + '</div>' +
      '<div class="row" style="justify-content:flex-end;margin-top:14px"><button type="button" class="btn" data-act="closeModal">Annuler</button><button class="btn pri">' + ico('check') + 'Enregistrer</button></div></form>', 'wide');
  });
  B.act('haMapSave', el => { const f = new FormData(el); const map = {}; for (const [k, v] of f.entries()) { const def = (DATA.DEVICES[k] && DATA.DEVICES[k].ha) || (DATA.CAMS[k] && DATA.CAMS[k].ha); if (String(v).trim() && String(v).trim() !== def) map[k] = String(v).trim(); } S.settings.haMap = map; B.save(); B.closeModal(); B.toast('Associations enregistrées', 'check'); B.HA.sync(); });
  RENDER.sgen = () => {
    const s = S.settings;
    return '<form data-submit="genSave" style="display:flex;flex-direction:column;gap:12px;flex:1"><div class="grid2"><label class="field">Ville (météo)<input name="city" value="' + esc(s.city) + '"></label><div class="field">&nbsp;<button type="button" class="btn" data-act="geo">' + ico('pin') + 'Rechercher la ville</button></div></div>' +
      '<div class="grid2"><label class="field">Latitude<input name="lat" value="' + s.lat + '"></label><label class="field">Longitude<input name="lon" value="' + s.lon + '"></label></div>' +
      '<div class="grid2"><label class="field">Adresse Plex<input name="plexUrl" value="' + esc(s.plexUrl) + '"></label><label class="field">Adresse NAS (UGOS Pro)<input name="nasUrl" placeholder="http://192.168.1.20:9999" value="' + esc(s.nasUrl) + '"></label></div>' +
      '<label class="row" style="font-size:14px;gap:10px"><button type="button" class="sw sm' + (s.skipLock ? ' on' : '') + '" data-act="setFlag" data-arg="skipLock" aria-label="Sans verrouillage"></button>Ouvrir directement le tableau de bord (sans écran verrouillé)</label>' +
      '<div class="row" style="margin-top:auto"><button class="btn pri">' + ico('check') + 'Enregistrer</button></div></form>';
  };
  B.act('genSave', el => { const f = new FormData(el); const s = S.settings; s.city = String(f.get('city')).trim() || s.city; s.lat = parseFloat(f.get('lat')) || s.lat; s.lon = parseFloat(f.get('lon')) || s.lon; s.plexUrl = String(f.get('plexUrl')).trim() || s.plexUrl; s.nasUrl = String(f.get('nasUrl')).trim(); B.save(); B.loadWeather(); B.toast('Paramètres enregistrés', 'check'); });
  B.act('geo', async () => {
    const inp = document.querySelector('[name=city]'); const q = inp.value.trim(); if (!q) return;
    try { const r = await fetch('https://geocoding-api.open-meteo.com/v1/search?count=1&language=fr&name=' + encodeURIComponent(q)); const j = await r.json(); const g = j.results && j.results[0]; if (!g) return B.toast('Ville introuvable', 'info'); document.querySelector('[name=lat]').value = g.latitude.toFixed(4); document.querySelector('[name=lon]').value = g.longitude.toFixed(4); inp.value = g.name; B.toast(g.name + ' (' + (g.admin1 || g.country) + ')', 'pin'); }
    catch (e) { B.toast('Recherche impossible hors ligne', 'info'); }
  });
  B.act('setFlag', el => { const k = el.dataset.arg; S.settings[k] = !S.settings[k]; B.save(); el.classList.toggle('on', S.settings[k]); });
  B.act('uName', el => { const u = S.users.find(x => x.id === el.dataset.id); u.name = el.value.trim() || u.name; B.save(); B.emit('users'); });
  B.act('uPlace', el => { const u = S.users.find(x => x.id === el.dataset.id); u.place = el.value; B.save(); B.emit('users'); });
  B.act('pickAvatar', el => {
    const u = S.users.find(x => x.id === el.dataset.arg);
    B.modal('<h2>' + ico('user') + 'Avatar de ' + esc(u.name) + '</h2><div class="avgrid">' + DATA.AVATARS.map(g => '<h4><span class="sym">' + g.sym + '</span>' + g.group.toUpperCase() + ' <small>(' + g.items.length + ' avatars)</small></h4><div class="g">' +
      g.items.map(a => '<button class="' + (u.avatar === a.src ? 'sel' : '') + '" style="--ring:' + a.ring + ';--glow:' + a.ring + '" data-act="setAvatar" data-id="' + u.id + '" data-arg="' + a.src + '" data-ring="' + a.ring + '"><img src="' + a.src + '" alt="" loading="lazy"></button>').join('') + '</div>').join('') + '</div>', 'wide');
  });
  B.act('setAvatar', el => { const u = S.users.find(x => x.id === el.dataset.id); u.avatar = el.dataset.arg; u.ring = el.dataset.ring; u.glow = el.dataset.ring; B.save(); B.closeModal(); B.emit('users'); B.emit('sprof'); B.toast('Avatar mis à jour', 'user'); });
  RENDER.sdata = () => '<div style="display:flex;flex-direction:column;gap:12px;flex:1"><p class="muted" style="margin:0;font-size:13.5px;line-height:1.5">Les réglages, favoris, profils et l’agenda sont enregistrés dans ce navigateur. Exportez-les pour les transférer sur une autre tablette.</p>' +
    '<div class="row" style="flex-wrap:wrap"><button class="btn" data-act="exportCfg">' + ico('download') + 'Exporter</button><label class="btn" style="cursor:pointer">' + ico('upload') + 'Importer<input type="file" accept="application/json" data-change="importCfg" hidden></label><button class="btn dan" data-act="resetCfg">' + ico('refresh') + 'Réinitialiser la démo</button></div>' +
    '<div class="tile" style="padding:14px;margin-top:auto;display:flex;align-items:center;gap:14px">' + toriiSVG('').replace('<svg class=""', '<svg style="width:44px;height:42px;filter:drop-shadow(0 0 8px #1e90ff)"') + '<div><b style="font-weight:500">Bêta OS 5.0</b><div class="muted" style="font-size:13px">Interface maison intelligente · thème Japon nocturne</div></div></div></div>';
  B.act('exportCfg', () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' })); a.download = 'beta-os-sauvegarde.json'; a.click(); });
  B.act('importCfg', el => { const f = el.files[0]; if (!f) return; f.text().then(t => { try { const j = JSON.parse(t); if (j.v !== 5) throw 0; localStorage.setItem('betaos.v5', JSON.stringify(j)); location.reload(); } catch (e) { B.toast('Fichier invalide', 'info'); } }); });
  B.act('resetCfg', () => { if (confirm('Réinitialiser tous les réglages de Bêta OS ?')) { localStorage.removeItem('betaos.v5'); location.reload(); } });
  B.route('parametres', { title: 'Paramètres', bg: BG, render: () => head('parametres', 'Paramètres', 'Profils, connexions et préférences', 'gearFill', ['off:all', 'cov:all', 'soir:rdc', 'jour:rdc']) +
    card([105, 235, 800, 640], 'Profils (4 maximum)', 'user', T({ t: 'sprof', keys: ['sprof'] })) +
    card([810, 235, 1522, 640], 'Home Assistant', 'homeFill', T({ t: 'sha', keys: ['ha'] })) +
    card([105, 650, 800, 1012], 'Général', 'gear', T({ t: 'sgen' })) +
    card([810, 650, 1522, 1012], 'Données & sauvegarde', 'nas', T({ t: 'sdata' })) });
})();

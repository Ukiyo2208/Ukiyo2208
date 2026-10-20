/* Bêta OS — Accueil (tableau de bord) et écran de verrouillage */
(function () {
  const B = window.BOS, { S, DATA, esc, F, dev, T, RENDER, box, px, WX, Music } = B;
  const A = 'assets/';
  const ringVars = u => '--ring:' + u.ring + ';--glow:' + (u.glow || (/gradient/.test(u.ring) ? '#ff6fae' : u.ring));
  const place = u => DATA.PLACES[u.place] || DATA.PLACES.away;
  function avatarBlock(u, extra) {
    const p = place(u);
    return '<div class="u' + (extra || '') + '" data-act="userCard" data-arg="' + u.id + '" role="button" tabindex="0" style="' + ringVars(u) + '">' +
      '<div class="av"><img src="' + u.avatar + '" alt="">' + (u.id === S.user && u.place === 'home' ? '<span class="on"></span>' : '') + '</div>' +
      '<span class="nm">' + esc(u.name) + '</span>' +
      '<span class="bat"><span class="bat-i" style="color:' + (u.bc || '#22e3a4') + '"><i style="width:' + u.bat + '%"></i></span>' + u.bat + '%</span>' +
      '<span class="loc">' + ico(p.icon).replace('class="ico', 'style="color:' + p.color + '" class="ico') + esc(p.label) + '</span></div>';
  }

  /* ---------- statistiques maison ---------- */
  function house() {
    const D = DATA.DEVICES;
    const lights = Object.keys(D).filter(id => D[id].type === 'light' && !id.startsWith('ext.'));
    const on = lights.filter(id => dev(id).on).length;
    const covers = Object.keys(D).filter(id => D[id].type === 'cover' && id !== 'ext.store' && id !== 'rdc.garage.door');
    const open = covers.filter(id => dev(id).pos > 0).length;
    let kw = .25;
    for (const id in D) {
      const d = D[id], s = dev(id);
      if (d.type === 'light' && s.on) kw += .02;
      if (d.type === 'group' && s.on) kw += .01 * s.lit;
      if (d.type === 'clim' && s.on && id !== 'home.chauffage') kw += .18;
      if (d.type === 'power' && s.on) kw += { 'rdc.salon.tv': .12, 'rdc.salon.amp': .08, 'rdc.salon.pc': .15 }[id] || 0;
      if (d.type === 'app' && s.on) kw += .55;
      if (d.type === 'charger' && s.on) kw += 7.4;
      if (d.type === 'vacuum' && s.status === 'cleaning') kw += .04;
    }
    const motion = Object.keys(DATA.CAMS).filter(id => { const c = B.camState(id), ev = c.ev !== undefined ? c.ev : DATA.CAMS[id].ev; return ev && ev.type === 'motion' && !ev.ago; }).length;
    return { on, lights: lights.length, open, covers: covers.length, kw: Math.round(kw * 10) / 10, motion };
  }
  function solarNow() { const h = new Date().getHours() + new Date().getMinutes() / 60; return Math.max(0, 4.6 * Math.sin(Math.PI * (h - 6.8) / 13.6)); }
  B.house = house; B.solarNow = solarNow;

  /* ======================= ACCUEIL ======================= */
  RENDER.hdate = () => { const d = new Date(); return '<div class="hdate glass abs" style="' + box([400, 15, 632, 101]) + '"><span class="d">' + F.long(d) + '</span><span class="t">' + F.time(d) + '</span></div>'; };
  RENDER.hwxs = () => '<div class="hwxs glass abs hide-fluid" style="' + box([730, 15, 1192, 101]) + '" data-act="weather" role="button">' + ico(B.wxIcon(WX.now.code, B.isNight()), 'big') +
    '<div class="n">' + esc(S.settings.city) + '<b>' + WX.now.temp + '°C</b>' + B.wxText(WX.now.code) + '</div>' +
    WX.days.slice(0, 3).map((d, i) => { const ic = B.wxIcon(d.code, false); return '<div class="dd">' + ico(ic, ic === 'sun' ? '' : 'c').replace('class="ico c"', 'class="ico" style="color:#dfe8ff;filter:none"') + '<span>' + F.d3(new Date(Date.now() + (i + 1) * 864e5)) + '</span><span>' + d.max + '° / ' + d.min + '°</span></div>'; }).join('') + '</div>';
  RENDER.hicons = () => {
    const un = B.unread(), tm = new Date(Date.now() + 864e5), evs = S.events.filter(e => e.date === F.ymd(tm)).length;
    return '<div class="hicons glass abs" style="' + box([1300, 15, 1662, 92]) + '">' +
      '<a href="#mails" class="mailb" title="Mails">' + ico('mail') + (un ? '<span class="badge">' + un + '</span>' : '') + '</a>' +
      '<a href="#calendrier" class="calb" title="Calendrier">' + ico('calendar') + (evs ? '<span class="badge">' + evs + '</span>' : '') + '</a>' +
      '<button data-act="notifs" title="Notifications">' + ico('bellFill') + '</button>' +
      '<button data-act="haStatus" title="Réseau">' + ico('wifi') + '</button>' +
      '<a href="#ia" title="Bêta IA">' + ico('ai') + '</a>' +
      '<a href="#parametres" class="gearb" title="Paramètres">' + ico('gearFill') + '</a></div>';
  };
  RENDER.husers = s => '<section class="card hcard abs" style="' + s.style + '"><h2 class="h-title">Utilisateurs</h2><div class="users">' +
    S.users.slice(0, 4).map(u => avatarBlock(u)).join('') +
    '<a href="#parametres" class="rnd" style="align-self:center;margin:-40px 0 0 -6px" aria-label="Gérer les profils">' + ico('chevR') + '</a></div></section>';
  RENDER.hmeteo = s => '<section class="card hcard abs" style="' + s.style + '" data-act="weather" role="button"><h2 class="h-title">Météo</h2><div class="hwx">' +
    '<div class="now">' + ico(B.wxIcon(WX.now.code, B.isNight()), 'big') + '<span class="temp">' + WX.now.temp + '°C</span><span class="cond">' + B.wxText(WX.now.code) + '</span></div>' +
    '<div class="days">' + B.wxDays(3) + '</div>' +
    '<div class="stats"><div>' + ico('drop') + '<span>' + WX.now.rain + ' %</span><small>Pluie</small></div><div>' + ico('wind') + '<span>' + WX.now.wind + ' km/h</span><small>Vent</small></div><div>' + ico('uv', 'g') + '<span>UV ' + WX.now.uv + '</span><small>' + B.uvLabel(WX.now.uv) + '</small></div></div></div></section>';
  RENDER.hcal = s => {
    const t = new Date(), evs = S.events.filter(e => e.date === F.ymd(t)).sort((a, b) => a.time.localeCompare(b.time)).slice(0, 4);
    return '<section class="card hcard hcal abs" style="' + s.style + '" data-act="goto" data-arg="calendrier" role="button"><h2 class="h-title">Calendrier</h2><div class="today">Aujourd\'hui, ' + F.dayMonth(t) + '</div>' +
      (evs.length ? evs.map(e => '<div class="ev" style="--c:' + e.color + '"><i></i><span>' + e.time + '</span><span>' + esc(e.title) + '</span><span class="d">' + (e.dur >= 60 ? Math.round(e.dur / 60 * 10) / 10 + 'h' : e.dur + 'min') + '</span></div>').join('') : '<p class="muted">Aucun événement aujourd’hui</p>') + '</section>';
  };
  RENDER.hmail = s => {
    const un = B.unread();
    return '<section class="card hcard hmail abs" style="' + s.style + '"><h2 class="h-title" style="display:flex;align-items:center;gap:14px">' + ico('mail').replace('class="ico', 'style="font-size:30px;color:#cfe8ff" class="ico') + 'Mails</h2>' +
      '<a href="#mails" class="new">' + ico('bellFill') + un + ' nouveau' + (un > 1 ? 'x' : '') + '<span class="more">' + ico('chevR') + '</span></a>' +
      S.mails.slice(0, 4).map(m => '<div class="mrow' + (m.read ? ' read' : '') + '" data-act="openMail" data-arg="' + m.id + '"><span class="lg" style="background:' + m.bg + '">' + esc(m.logo) + '</span><span class="s">' + esc(m.from) + '<small>' + esc(m.subj) + '</small></span><span class="tm">' + m.time + '</span></div>').join('') + '</section>';
  };
  RENDER.henergy = s => {
    const h = house(), sol = solarNow(), pct = Math.min(1, h.kw / 2.3);
    const C = 2 * Math.PI * 66, arc = C * .8;
    const bars = [3, 5, 9, 14, 18, 22, 19, 16, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 4, 3, 3, 2, 2];
    const chs = S.dev['home.chauffage'] ? dev('home.chauffage') : dev('home.chauffage');
    const clims = Object.keys(DATA.DEVICES).filter(id => DATA.DEVICES[id].type === 'clim' && id !== 'home.chauffage' && dev(id).on).length;
    return '<section class="card hcard abs" style="' + s.style + '"><h2 class="h-title">Maison totale</h2><div class="energy">' +
      '<div class="gauge" data-act="goto" data-arg="energie" role="button"><svg viewBox="0 0 160 160"><defs><linearGradient id="gg" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#1f7dff"/><stop offset=".6" stop-color="#22c8ff"/><stop offset="1" stop-color="#2ff0d0"/></linearGradient></defs>' +
      '<circle cx="80" cy="80" r="66" fill="none" stroke="rgba(40,80,150,.45)" stroke-width="9" stroke-dasharray="' + arc + ' ' + C + '" transform="rotate(126 80 80)" stroke-linecap="round"/>' +
      '<circle cx="80" cy="80" r="66" fill="none" stroke="url(#gg)" stroke-width="9" stroke-dasharray="' + (arc * pct) + ' ' + C + '" transform="rotate(126 80 80)" stroke-linecap="round" style="filter:drop-shadow(0 0 6px rgba(40,200,255,.8))"/></svg>' +
      '<div class="in">' + ico('leaf') + '<b>' + h.kw.toFixed(1) + ' kW</b><span>Consommation</span><em>vs -32%</em></div></div>' +
      '<div class="erows"><div class="erow tile">' + ico('sun').replace('class="ico', 'style="color:#ffd23f;filter:drop-shadow(0 0 8px rgba(255,210,63,.8))" class="ico') +
      '<b>' + (sol > .05 ? sol.toFixed(1) + ' kW' : '18.6 kWh') + '</b><small>' + (sol > .05 ? 'Production solaire' : 'Production solaire du jour') + '</small><div class="chart">' + bars.map(v => '<i style="height:' + (v / 22 * 100) + '%"></i>').join('') + '</div></div>' +
      '<div class="erow tile">' + ico('batteryV').replace('class="ico', 'style="color:#22e3a4;filter:drop-shadow(0 0 8px rgba(34,227,164,.7))" class="ico') +
      '<b>12.4 kWh / 16 kWh</b><small>Batterie virtuelle</small><div class="bar"><div><i style="width:76%"></i></div>76%</div></div></div>' +
      '<div class="etiles">' +
      '<button class="tile etile" data-act="chauffage">' + ico('flame').replace('class="ico', 'style="color:#ff6a2b;filter:drop-shadow(0 0 8px rgba(255,100,40,.7))" class="ico') + '<span>Chauffage maison</span><span class="v">' + (chs.on ? chs.mode || 'Auto' : 'Arrêt') + '</span><span class="s" style="color:#e5eefc">' + ico('pin') + chs.temp + '°C</span></button>' +
      '<button class="tile etile" data-act="toggle" data-id="home.ecs">' + ico('hotWater').replace('class="ico', 'style="color:#2fb0ff;filter:drop-shadow(0 0 8px rgba(40,170,255,.7))" class="ico') + '<span>Eau chaude</span><span class="v">' + (dev('home.ecs').on ? '52°C' : 'Arrêt') + '</span><span class="s">' + (dev('home.ecs').on ? 'Normal' : 'Hors-gel') + '</span></button>' +
      '<button class="tile etile" data-act="toggle" data-id="home.climg">' + ico('snow').replace('class="ico', 'style="color:#2fd8ff;filter:drop-shadow(0 0 8px rgba(40,200,255,.7))" class="ico') + '<span>Climatisation globale</span><span class="v">' + (dev('home.climg').on ? 'Auto' : 'Arrêt') + '</span><span class="s">' + ico('user') + clims + ' zone' + (clims > 1 ? 's' : '') + '</span></button>' +
      '<button class="tile etile" data-act="goto" data-arg="multimedia">' + ico('plexBox').replace('class="ico', 'style="color:#ffd23f;filter:drop-shadow(0 0 8px rgba(255,210,63,.6))" class="ico') + '<span>Plex</span><span class="s">' + (S.plexPlaying ? 'En lecture' : 'En pause') + '</span></button>' +
      '<button class="tile etile" data-act="musicToggle">' + ico('musicFill').replace('class="ico', 'style="color:#2fb6ff;filter:drop-shadow(0 0 8px rgba(40,170,255,.7))" class="ico') + '<span>Musique</span><span class="s">' + (Music.playing ? 'En lecture' : 'En pause') + '</span></button>' +
      '</div></div></section>';
  };
  RENDER.hmm = s => {
    const cur = Music.cur(), tab = S.music.tab || 'plex';
    const list = tab === 'radio' ? DATA.RADIOS.slice(0, 4).map(r => ({ id: r.id, name: r.name, cover: '', color: r.color })) : S.playlists.slice(0, 4);
    return '<section class="card hcard abs" style="' + s.style + '"><div style="display:flex;align-items:center;gap:40px"><h2 class="h-title">Multimédia</h2>' +
      '<div class="tabs">' + [['plex', 'Plex'], ['musique', 'Musique'], ['radio', 'Radio']].map(t => '<button class="' + (tab === t[0] ? 'on' : '') + '" data-act="mmTab" data-arg="' + t[0] + '">' + t[1] + '</button>').join('') + '</div></div>' +
      '<div class="hmm"><div class="art">' + (cur.cover ? '<img src="' + cur.cover + '" alt="">' : radioArt(cur)) + '</div>' +
      '<div class="info"><b>' + (Music.playing ? 'En lecture' : 'En pause') + '</b><span>' + esc(cur.name) + '</span>' + B.transport() + '</div>' +
      '<div class="lists">' + list.map(p => '<button class="' + (S.music.src === p.id ? 'on' : '') + '" data-act="mPlay" data-arg="' + p.id + '">' + (p.cover ? '<img src="' + p.cover + '" alt="">' : radioArt(p, 115)) + esc(p.name) + '</button>').join('') + '</div>' +
      T({ t: 'mprog', keys: ['mtime', 'music'] }) + '</div></section>';
  };
  function radioArt(r, h) {
    const R = DATA.RADIOS.find(x => x.id === r.id) || r;
    return '<div style="width:100%;height:' + (h ? h + 'px' : '100%') + ';border-radius:6px;display:grid;place-items:center;text-align:center;padding:6px;font-weight:700;font-size:15px;background:radial-gradient(circle at 30% 20%,' + (R.color || '#2f7dff') + ',#0a1636 75%);box-shadow:inset 0 0 0 1px rgba(255,255,255,.12)">' + ico('radio').replace('class="ico', 'style="font-size:30px;margin:0 auto 6px" class="ico') + esc(R.name) + '</div>';
  }
  B.radioArt = radioArt;
  RENDER.mprog = () => {
    const cur = Music.cur(), t = Music.time(), live = cur.kind === 'radio';
    const mm = x => Math.floor(x / 60) + ':' + String(Math.floor(x % 60)).padStart(2, '0');
    const p = live ? 100 : Music.playing || t ? (t % 272) / 272 * 100 : 49;
    return '<div class="prog"><input type="range" class="range" min="0" max="100" value="' + p + '" style="--p:' + p + '%" aria-label="Progression" disabled><span>' + (live ? 'En direct' : (Music.playing || t ? mm(t % 272) : '2:14') + ' / 4:32') + '</span></div>';
  };
  RENDER.hnas = s => '<section class="card hcard abs" style="' + s.style + '"><h2 class="h-title" data-act="goto" data-arg="nas" role="button">NAS UGREEN</h2>' +
    '<div class="nasbox tile" data-act="goto" data-arg="nas" role="button"><img src="' + A + 'devices/nas.jpg" alt=""><span class="l">Stockage total</span><span class="r">12.4 To / 16 To</span><div class="bar"><i style="width:78%"></i></div><span class="pct">78%</span></div>' +
    '<div class="nasbtns">' + [['files', 'Fichiers'], ['photo', 'Photos'], ['video', 'Vidéos'], ['cloudUp', 'Sauvegarde']].map(b => '<button class="tile" data-act="nasOpen" data-arg="' + b[1] + '">' + ico(b[0]) + b[1] + '</button>').join('') + '</div>' +
    '<div style="font-size:16px;margin:10px 0 6px">Services</div><div class="svc">' +
    '<div><span class="si" style="background:#1f8bff">' + ico('cloud') + '</span>Nextcloud<small>En ligne</small></div>' +
    '<div><span class="si" style="background:linear-gradient(135deg,#ff6fae,#5fb8ff)">' + ico('photo') + '</span>Photos AI<small>En ligne</small></div>' +
    '<div><span class="si" style="color:#2fb6ff">' + ico('shield') + '</span>Surveillance<small class="w">' + Object.keys(DATA.CAMS).length + ' caméras</small></div>' +
    '<div><span class="si" style="color:#2fe3a6">' + ico('download') + '</span>Télécharg.<small class="w">2 en cours</small></div></div></section>';
  RENDER.hia = s => '<section class="card hcard hia abs" style="' + s.style + '"><div class="top">' + brainSVG() + '<div><h2>Bêta IA</h2><p>Bonjour ' + esc(B.user().name) + ',</p><p class="cy">Comment puis-je vous aider ?</p></div><a href="#ia" style="font-size:24px;color:#2fb6ff;padding:8px" aria-label="Ouvrir Bêta IA">' + ico('chevR') + '</a></div>' +
    '<div class="sugg"><button data-act="iaAsk" data-arg="Contrôle la maison">' + ico('sparkle') + 'Contrôle la maison</button><button data-act="iaAsk" data-arg="Montre la météo">' + ico('music') + 'Montre la météo</button><button data-act="iaAsk" data-arg="Ouvre Plex">' + ico('sunGear') + 'Ouvre Plex</button><button data-act="iaAsk" data-arg="Lance ma playlist Japon">' + ico('refresh') + 'Lance ma playlist Japon</button></div>' +
    '<form data-submit="iaHome"><button type="button" data-act="mic" aria-label="Dicter">' + ico('mic') + '</button><input name="q" placeholder="Posez une question ou demandez une action..." autocomplete="off" aria-label="Question"><button aria-label="Envoyer">' + ico('send') + '</button></form></section>';

  B.route('accueil', { title: 'Accueil', bg: A + 'bg/home.jpg', w: 1672, h: 941, render: () => {
    const C = [692, 375];
    const cams = [['cam.cour-garage', [708, 428, 931, 655]], ['cam.cour', [945, 428, 1169, 655]], ['cam.sonnette', [1182, 428, 1406, 655]], ['cam.jardin', [1420, 428, 1646, 655]]];
    return B.side('accueil') + B.logo(px(110, 12, 250, 72)) +
      T({ t: 'hdate', keys: ['clock'] }) + T({ t: 'hwxs', keys: ['weather'] }) + T({ t: 'hicons', keys: ['mails', 'events'] }) +
      T({ t: 'husers', style: box([105, 120, 640, 362]), keys: ['users'] }) +
      T({ t: 'hmeteo', style: box([652, 120, 1064, 362]), keys: ['weather'] }) +
      T({ t: 'hcal', style: box([1077, 120, 1357, 362]), keys: ['events'] }) +
      T({ t: 'hmail', style: box([1366, 120, 1662, 362]), keys: ['mails'] }) +
      T({ t: 'henergy', style: box([105, 375, 684, 660]), keys: ['house', 'music', 'plex'] }) +
      '<section class="card hcard abs" style="' + box([692, 375, 1662, 660]) + '"><h2 class="h-title" style="display:flex;align-items:center">Caméras extérieures<button class="more" data-act="allCams" style="margin-left:auto;color:#2fb6ff;font-size:22px" aria-label="Toutes">' + ico('chevR') + '</button></h2>' +
      '<div class="camgrid">' + cams.map(c => T({ t: 'cam', cam: c[0], style: box(c[1], C), bottom: true, tile: true, short: true, det: DATA.CAMS[c[0]].det.slice(0, 3), keys: ['cam:' + c[0]] })).join('') + '</div></section>' +
      T({ t: 'hmm', style: box([105, 683, 755, 912]), keys: ['music'] }) +
      T({ t: 'hnas', style: box([763, 683, 1172, 912]) }) +
      T({ t: 'hia', style: box([1180, 683, 1662, 912]), keys: ['users'] });
  } });

  /* ---------- actions accueil ---------- */
  B.act('goto', el => B.go(el.dataset.arg));
  B.act('mmTab', el => { S.music.tab = el.dataset.arg; B.save(); if (el.dataset.arg === 'plex') { B.emit('music'); return; } B.emit('music'); });
  B.act('chauffage', el => {
    const d = dev('home.chauffage');
    B.popover(el, '<b style="font-weight:500">Chauffage maison</b><div class="row" style="justify-content:space-between;margin:14px 0"><button class="sq" data-act="clim" data-id="home.chauffage" data-arg="-0.5">' + ico('minus') + '</button><b style="font-size:26px;font-weight:400" id="chT">' + d.temp.toFixed(1) + '°C</b><button class="sq" data-act="clim" data-id="home.chauffage" data-arg="0.5">' + ico('plus') + '</button></div>' +
      '<div class="row" style="gap:6px">' + ['Auto', 'Confort', 'Éco', 'Hors-gel'].map(m => '<button class="cat' + (d.mode === m ? ' on' : '') + '" style="flex:1;font-size:12px" data-act="chMode" data-arg="' + m + '">' + m + '</button>').join('') + '</div>');
  });
  B.act('chMode', el => { B.setDev('home.chauffage', { mode: el.dataset.arg, on: true }); B.$$('.pop .cat').forEach(b => b.classList.toggle('on', b === el)); });
  B.act('nasOpen', el => { if (S.settings.nasUrl) window.open(S.settings.nasUrl, '_blank'); else B.go('nas'); });
  B.act('notifs', el => {
    const h = house();
    const items = [];
    S.mails.filter(m => !m.read).slice(0, 3).forEach(m => items.push(['mail', m.from + ' — ' + m.subj, '#mails']));
    Object.keys(DATA.CAMS).forEach(id => { const e = B.camEv(id); if (e.dot) items.push(['camera', DATA.CAMS[id].name + ' : ' + e.txt.replace(/<[^>]+>/g, ''), '#exterieur']); });
    if (h.open) items.push(['blinds', h.open + ' volet(s) ouvert(s)', '#rdc']);
    B.popover(el, '<b style="font-weight:500">Notifications</b><div class="list" style="margin-top:8px">' + (items.length ? items.map(i => '<a class="li" href="' + i[2] + '" style="grid-template-columns:32px 1fr">' + '<span class="ic" style="width:30px;height:30px;font-size:16px">' + ico(i[0]) + '</span><small style="color:#e6eefc;font-size:13px">' + esc(i[1]) + '</small></a>').join('') : '<p class="muted">Rien à signaler</p>') + '</div>').style.width = '320px';
  });
  B.act('userCard', el => {
    const u = S.users.find(x => x.id === el.dataset.arg); if (!u) return;
    B.popover(el, '<div class="row"><img src="' + u.avatar + '" alt="" style="width:46px;height:46px;border-radius:50%"><div><b style="font-weight:500">' + esc(u.name) + '</b><div class="muted" style="font-size:13px">' + esc(place(u).label) + ' · ' + u.bat + '%</div></div></div>' +
      '<div class="list" style="margin-top:10px">' + Object.keys(DATA.PLACES).map(k => '<button class="li" style="grid-template-columns:28px 1fr;min-height:36px;width:100%;text-align:left' + (u.place === k ? ';background:rgba(30,100,220,.35)' : '') + '" data-act="setPlace" data-id="' + u.id + '" data-arg="' + k + '">' + ico(DATA.PLACES[k].icon).replace('class="ico', 'style="color:' + DATA.PLACES[k].color + '" class="ico') + '<span>' + DATA.PLACES[k].label + '</span></button>').join('') + '</div>' +
      '<div class="row" style="margin-top:10px"><button class="btn" style="flex:1" data-act="switchUser" data-arg="' + u.id + '">' + ico('user') + 'Utiliser ce profil</button><a class="btn" href="#parametres" aria-label="Modifier">' + ico('edit') + '</a></div>');
  });
  B.act('setPlace', el => { const u = S.users.find(x => x.id === el.dataset.id); u.place = el.dataset.arg; B.save(); B.$$('.pop').forEach(p => p.remove()); B.emit('users'); });
  B.act('switchUser', el => { S.user = el.dataset.arg; B.save(); B.$$('.pop').forEach(p => p.remove()); B.emit('users'); B.toast('Profil actif : ' + B.user().name, 'user'); });
  B.act('openMail', el => { S.openMail = el.dataset.arg; B.go('mails'); });
  B.act('weather', () => {
    const night = B.isNight();
    B.modal('<h2>' + ico('pinFill') + 'Météo · ' + esc(S.settings.city) + '</h2><div style="display:flex;align-items:center;gap:22px">' + ico(B.wxIcon(WX.now.code, night)).replace('class="ico', 'style="font-size:90px;filter:drop-shadow(0 0 14px rgba(170,200,255,.9))" class="ico') +
      '<div><div style="font-size:64px;font-weight:300;line-height:1">' + WX.now.temp + '°C</div><div style="font-size:18px;color:#dce8fa">' + B.wxText(WX.now.code) + '</div></div></div>' +
      '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:20px">' + WX.days.map((d, i) => '<div class="tile kpi" style="align-items:center">' + '<small>' + F.JOURS[new Date(Date.now() + (i + 1) * 864e5).getDay()] + '</small>' + ico(B.wxIcon(d.code, false)).replace('class="ico', 'style="font-size:34px;color:#ffd23f" class="ico') + '<b style="font-size:20px">' + d.max + '° / ' + d.min + '°</b><small>' + B.wxText(d.code) + '</small></div>').join('') + '</div>' +
      '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:10px"><div class="tile kpi"><small>Pluie</small><b>' + WX.now.rain + ' %</b></div><div class="tile kpi"><small>Vent</small><b>' + WX.now.wind + ' km/h</b></div><div class="tile kpi"><small>Indice UV</small><b>' + WX.now.uv + '</b><em>' + B.uvLabel(WX.now.uv) + '</em></div></div>' +
      '<p class="muted" style="font-size:12px;margin:14px 0 0">' + (WX.ok ? 'Données Open-Meteo, actualisées toutes les 15 minutes.' : 'Hors ligne : valeurs de démonstration affichées.') + '</p>', 'sm');
  });

  /* ======================= VERROUILLAGE ======================= */
  RENDER.lkclock = s => {
    const d = new Date(), tm = WX.tomorrow || WX.days[0];
    return '<div class="lk-clock glass abs" style="' + s.style + '"><div class="d">' + F.long(d) + '</div><div class="t">' + F.time(d) + '</div>' +
      '<div class="w">' + ico(B.wxIcon(WX.now.code, false) === 'sun' ? 'sun' : B.wxIcon(WX.now.code, false)) + '<span>' + B.wxText(WX.now.code) + '</span><b>' + WX.now.temp + '°C</b></div>' +
      '<div class="w">' + ico('cloud', 'cl') + '<span>Demain : ' + tm.max + '°C / ' + tm.min + '°C</span></div></div>';
  };
  RENDER.lkhouse = s => {
    const h = house(), b = dev('ext.borne'), m = dev('ext.tondeuse');
    const calm = !h.motion;
    const row = (i, l, v, c) => '<div class="r">' + ico(i) + '<span style="color:#eef4ff;font-size:17px">' + l + '</span><span class="' + (c || '') + '">' + v + '</span></div>';
    return '<div class="lk-house glass abs" style="' + s.style + '"><div class="h">' + ico('homeFill') + '<b>Maison</b><small><i style="' + (calm ? '' : 'background:#ff3a4c;box-shadow:0 0 8px #ff3a4c') + '"></i>' + (calm ? 'Tout est calme' : 'Mouvement détecté') + '</small></div>' +
      row('bulb', 'Éclairages', h.on + ' allumé' + (h.on > 1 ? 's' : ''), 'b') +
      row('blindsWin', 'Volets', h.open ? h.open + ' ouvert' + (h.open > 1 ? 's' : '') : 'Tous fermés') +
      row('cctv', 'Caméras', h.motion ? h.motion + ' mouvement' + (h.motion > 1 ? 's' : '') : 'Aucun mouvement') +
      row('shieldCheck', 'Alarme', S.alarm ? 'Activée' : 'Désactivée', S.alarm ? 'c' : '') +
      row('charger', 'Borne de recharge', b.on ? 'Connectée' : 'Disponible', 'c') +
      row('mowerRobot', 'Robot tondeuse', m.status === 'mowing' ? 'En tonte' : 'En charge') + '</div>';
  };
  RENDER.lkwx = s => '<div class="lk-wx glass abs" style="' + s.style + '"><div class="loc">' + ico('pinFill') + 'La Maison</div><div class="now">' + ico(B.isNight() ? 'sunLine' : 'sunLine') + '<b>' + WX.now.temp + '°C</b></div><div class="cond">' + B.wxText(WX.now.code) + '</div>' +
    ico(B.isNight() ? 'moon' : 'sun', 'moon') +
    '<div class="st"><div>' + ico('sunLine') + (WX.tomorrow ? WX.tomorrow.max : WX.days[0].max) + '°C<small>Demain</small></div><div>' + ico('dropFill', 'b') + WX.now.rain + '%<small>Pluie</small></div><div>' + ico('wind', 'b') + WX.now.wind + ' km/h<small>Vent</small></div><div>' + ico('uv', 'g') + 'UV ' + WX.now.uv + '<small>' + B.uvLabel(WX.now.uv) + '</small></div></div></div>';
  RENDER.lklinks = s => {
    const un = B.unread(), tm = F.ymd(new Date(Date.now() + 864e5)), evs = S.events.filter(e => e.date === tm).length, cur = Music.cur();
    const L = (y, icon, title, sub, to, cls, c) => '<a class="lk-link glass abs" href="#" data-act="unlockTo" data-arg="' + to + '" style="' + px(1200, y, 305, 76) + '">' + ico(icon) + '<div><b>' + title + '</b><small class="' + (cls || '') + '">' + (c ? '<i style="--c:' + c + '"></i>' : '') + sub + '</small></div>' + ico('chevR', 'chev') + '</a>';
    return '<div class="abs" style="left:0;top:0">' +
      L(329, 'mail', 'Mails', un + ' nouveau' + (un > 1 ? 'x' : ''), 'mails', '', '#2f8bff') +
      L(413, 'calendar', 'Calendrier', evs + ' événement' + (evs > 1 ? 's' : '') + ' demain', 'calendrier') +
      L(497, 'nas', 'UGREEN NAS', 'En ligne', 'nas', 'g', '#22e3a4') +
      L(581, 'musicFill', 'Musique', (Music.playing ? 'En lecture : ' : 'Prêt : ') + esc(cur.name), 'multimedia') +
      L(665, 'plex', 'Plex', '1 film à reprendre', 'multimedia') + '</div>';
  };
  RENDER.lkusers = s => '<div class="lk-users glass abs" style="' + s.style + '">' +
    S.users.slice(0, 4).map(u => avatarBlock(u, (S.lockSel || S.user) === u.id ? ' sel' : '').replace('data-act="userCard"', 'data-act="lockUser"')).join('') +
    (S.settings.guest ? '<div class="u add" data-act="lockUser" data-arg="guest" role="button" tabindex="0"><div class="av">' + ico('plus') + '</div><span class="nm">Invité</span><span class="loc" style="color:#cfdcf3">Accès limité</span></div>' : '') + '</div>';

  function fingerprint() {
    const ticks = Array.from({ length: 48 }, (_, i) => { const a = i / 48 * Math.PI * 2, r1 = 122, r2 = i % 4 ? 127 : 131; return '<line x1="' + (130 + r1 * Math.cos(a)).toFixed(1) + '" y1="' + (130 + r1 * Math.sin(a)).toFixed(1) + '" x2="' + (130 + r2 * Math.cos(a)).toFixed(1) + '" y2="' + (130 + r2 * Math.sin(a)).toFixed(1) + '"/>'; }).join('');
    return '<div class="fp abs" id="fp" style="' + px(638, 337, 260, 260) + '" data-act="unlock" role="button" tabindex="0" aria-label="Déverrouiller">' +
      '<svg class="rings" viewBox="0 0 260 260"><defs><linearGradient id="fpg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2fe0ff"/><stop offset="1" stop-color="#1a5cff"/></linearGradient></defs>' +
      '<circle cx="130" cy="130" r="112" fill="rgba(8,24,60,.35)" stroke="rgba(70,170,255,.35)" stroke-width="1.5"/>' +
      '<g stroke="rgba(90,190,255,.55)" stroke-width="1.6">' + ticks + '</g>' +
      '<g class="spin"><circle cx="130" cy="130" r="100" fill="none" stroke="url(#fpg)" stroke-width="7" stroke-linecap="round" stroke-dasharray="150 478" style="filter:drop-shadow(0 0 8px #24b8ff)"/></g>' +
      '<g class="spin2"><circle cx="130" cy="130" r="100" fill="none" stroke="#1e7bff" stroke-width="7" stroke-linecap="round" stroke-dasharray="90 538" stroke-dashoffset="-300" style="filter:drop-shadow(0 0 8px #1e7bff)"/></g>' +
      '<circle cx="130" cy="130" r="84" fill="none" stroke="rgba(80,180,255,.35)" stroke-width="1.2"/>' +
      '<line x1="10" y1="130" x2="30" y2="130" stroke="rgba(120,200,255,.6)"/><line x1="230" y1="130" x2="250" y2="130" stroke="rgba(120,200,255,.6)"/></svg>' +
      '<div class="core"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"><path d="M6.2 5.4A8.6 8.6 0 0 1 20 9.6M4.4 8.6a8.7 8.7 0 0 0-.6 3.2c0 2 .4 3.6 1 5"/><path d="M7.4 19.6a14 14 0 0 1-1.6-6.9 6.2 6.2 0 0 1 12.4-.6"/><path d="M18.4 15.4c0 1.6-.2 3.2-.7 4.6M10.4 21.1A16 16 0 0 1 8.4 13a3.6 3.6 0 0 1 7.2 0c0 2.6.2 4.9-.6 7.4"/><path d="M12 13c0 3.3.6 6.1 1.6 8.4"/><path d="M20.4 12.8c.1 2.4-.1 4.6-.6 6.4"/></svg><span class="scanline"></span></div></div>';
  }
  B.route('verrou', { title: 'Verrouillé', bg: A + 'bg/lock.jpg', render: () => {
    return '<div class="lk">' +
      '<div class="logo lk-logo abs hide-fluid" style="' + px(52, 24, 330, 84) + '">' + toriiSVG('torii') + '<span class="word"><span class="name">Bêta <span>os</span></span><span class="tag">MAISON INTELLIGENTE</span></span></div>' +
      '<div class="lk-kata abs" style="' + px(36, 128, 30, 180) + '">スマートホーム</div>' +
      T({ t: 'lkclock', style: box([75, 125, 400, 322]), keys: ['clock', 'weather'] }) +
      T({ t: 'lkhouse', style: box([75, 340, 400, 675]), keys: ['house'] }) +
      fingerprint() +
      '<div class="lk-hint abs" style="' + px(568, 602, 400, 70) + '"><b>Touchez pour déverrouiller</b><span>ou sélectionnez votre profil</span></div>' +
      T({ t: 'lkusers', style: box([410, 722, 1135, 942]), keys: ['users'] }) +
      T({ t: 'lkwx', style: box([1135, 70, 1505, 310]), keys: ['weather'] }) +
      T({ t: 'lklinks', keys: ['mails', 'music', 'events'] }) +
      '<div class="lk-quote abs" style="' + px(45, 915, 320, 85) + '"><b>家</b>Un foyer, plus qu’une maison,<br>un équilibre au quotidien.</div>' +
      '<div class="lk-quote r abs" style="' + px(1150, 935, 345, 60) + '"><b>日々、より良く</b>Chaque jour, un peu mieux.</div></div>';
  } });
  function unlock(to) {
    const fp = document.getElementById('fp');
    if (fp) fp.classList.add('scan');
    setTimeout(() => { if (fp) { fp.classList.remove('scan'); fp.classList.add('ok'); } }, 750);
    setTimeout(() => {
      S.user = S.lockSel || S.user; delete S.lockSel; B.save();
      sessionStorage.setItem('betaos.unlocked', '1');
      document.body.classList.add('unlocking');
      setTimeout(() => { document.body.classList.remove('unlocking'); B.go(to || 'accueil'); }, 520);
    }, 1050);
  }
  B.act('unlock', () => unlock());
  B.act('unlockTo', el => unlock(el.dataset.arg));
  B.act('lockUser', el => { S.lockSel = el.dataset.arg; B.emit('users'); unlock(); });
})();

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
  const hello = () => { const h = new Date().getHours(); return h < 5 ? 'Bonne nuit' : h < 12 ? 'Bonjour' : h < 18 ? 'Bon après-midi' : 'Bonsoir'; };
  B.hello = hello;
  RENDER.hdate = () => { const d = new Date(); return '<div class="hdate glass abs hide-fluid" style="' + box([400, 15, 632, 101]) + '"><span class="d">' + F.long(d) + '</span><span class="t">' + F.time(d) + '</span></div>'; };
  RENDER.hwxs = () => '<div class="hwxs glass abs hide-fluid" style="' + box([730, 15, 1192, 101]) + '" data-act="weather" role="button">' + ico(B.wxIcon(WX.now.code, B.isNight()), 'big') +
    '<div class="n">' + esc(S.settings.city) + '<b>' + WX.now.temp + '°C</b>' + B.wxText(WX.now.code) + '</div>' +
    WX.days.slice(0, 3).map((d, i) => { const ic = B.wxIcon(d.code, false); return '<div class="dd">' + ico(ic, ic === 'sun' ? '' : 'c').replace('class="ico c"', 'class="ico" style="color:#dfe8ff;filter:none"') + '<span>' + F.d3(new Date(Date.now() + (i + 1) * 864e5)) + '</span><span>' + d.max + '° / ' + d.min + '°</span></div>'; }).join('') + '</div>';
  RENDER.hicons = () => {
    const un = B.unread(), tm = new Date(Date.now() + 864e5), evs = S.events.filter(e => e.date === F.ymd(tm)).length;
    return '<div class="hicons glass abs hide-fluid" style="' + box([1300, 15, 1662, 92]) + '">' +
      '<a href="#mails" class="mailb" title="Mails">' + ico('mail') + (un ? '<span class="badge">' + un + '</span>' : '') + '</a>' +
      '<a href="#calendrier" class="calb" title="Calendrier">' + ico('calendar') + (evs ? '<span class="badge">' + evs + '</span>' : '') + '</a>' +
      '<button data-act="notifs" title="Notifications">' + ico('bellFill') + '</button>' +
      '<a href="#routines" title="Routines">' + ico('wand') + '</a>' +
      '<button data-act="iaOpen" class="iatop" title="Parler à Bêta IA">' + brainSVG() + '</button>' +
      '<a href="#parametres" class="gearb" title="Paramètres">' + ico('gearFill') + '</a></div>';
  };
  RENDER.husers = s => '<section class="card hcard abs" style="' + s.style + '">' + B.whead('users', 'La famille', '<a href="#parametres" class="wmore" aria-label="Gérer les profils">' + ico('chevR') + '</a>') + '<div class="users">' +
    S.users.slice(0, 4).map(u => avatarBlock(u)).join('') + '</div></section>';
  RENDER.hmeteo = s => '<section class="card hcard abs" style="' + s.style + '" data-act="weather" role="button">' + B.whead('weather', 'Météo du moment', '<span class="wsub">' + esc(S.settings.city) + '</span>') + '<div class="hwx">' +
    '<div class="now">' + ico(B.wxIcon(WX.now.code, B.isNight()), 'big') + '<span class="temp">' + WX.now.temp + '°C</span><span class="cond">' + B.wxText(WX.now.code) + '</span></div>' +
    '<div class="days">' + B.wxDays(3) + '</div>' +
    '<div class="stats"><div>' + ico('drop') + '<span>' + WX.now.rain + ' %</span><small>Pluie</small></div><div>' + ico('wind') + '<span>' + WX.now.wind + ' km/h</span><small>Vent</small></div><div>' + ico('uv', 'g') + '<span>UV ' + WX.now.uv + '</span><small>' + B.uvLabel(WX.now.uv) + '</small></div></div></div></section>';
  RENDER.hcal = s => {
    const t = new Date(), evs = S.events.filter(e => e.date === F.ymd(t)).sort((a, b) => a.time.localeCompare(b.time)).slice(0, 4);
    return '<section class="card hcard hcal abs" style="' + s.style + '" data-act="goto" data-arg="calendrier" role="button">' + B.whead('cal', 'Au programme') + '<div class="today">Aujourd\'hui, ' + F.dayMonth(t) + '</div>' +
      (evs.length ? evs.map(e => '<div class="ev" style="--c:' + e.color + '"><i></i><span>' + e.time + '</span><span class="tt">' + esc(e.title) + '</span><span class="d">' + (e.dur >= 60 ? Math.round(e.dur / 60 * 10) / 10 + ' h' : e.dur + ' min') + '</span></div>').join('') : '<p class="muted">Rien de prévu aujourd’hui. Profitez !</p>') + '</section>';
  };
  RENDER.hmail = s => {
    const un = B.unread();
    return '<section class="card hcard hmail abs" style="' + s.style + '">' + B.whead('mail', 'Courrier', '<a href="#mails" class="wcount">' + (un ? un + ' nouveau' + (un > 1 ? 'x' : '') : 'à jour') + ico('chevR') + '</a>') +
      '<div class="mlist2">' + S.mails.slice(0, 4).map(m => '<div class="mrow' + (m.read ? ' read' : '') + '" data-act="openMail" data-arg="' + m.id + '"><span class="lg" style="background:' + m.bg + '">' + esc(m.logo) + '</span><span class="s">' + esc(m.from) + '<small>' + esc(m.subj) + '</small></span><span class="tm">' + m.time + (m.invite ? ico('calendar', 'inv') : '') + '</span></div>').join('') + '</div></section>';
  };
  RENDER.henergy = s => {
    const L = B.Energy.live(), h = Object.assign(house(), { kw: L.cons }), sol = L.solar, pct = Math.min(1, h.kw / 2.3);
    const C = 2 * Math.PI * 56, arc = C * .78;
    const bars = [3, 5, 9, 14, 18, 22, 19, 16, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 4, 3, 3, 2, 2];
    const ch = dev('home.chauffage');
    const clims = Object.keys(DATA.DEVICES).filter(id => DATA.DEVICES[id].type === 'clim' && id !== 'home.chauffage' && dev(id).on).length;
    const pill = (act, icon, col, l, v, extra) => '<button class="tile epill" ' + act + '><span class="ei" style="--c:' + col + '">' + ico(icon) + '<small>' + l + '</small></span><span class="et"><b style="color:' + (extra || '#eaf2ff') + '">' + v + '</b></span></button>';
    return '<section class="card hcard abs" style="' + s.style + '">' + B.whead('energy', 'Énergie de la maison', '<a href="#energie" class="wmore" aria-label="Détails énergie">' + ico('chevR') + '</a>') + '<div class="energy">' +
      '<div class="gauge" data-act="goto" data-arg="energie" role="button"><svg viewBox="0 0 140 140"><defs><linearGradient id="gg" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#1f7dff"/><stop offset=".6" stop-color="#22c8ff"/><stop offset="1" stop-color="#2ff0d0"/></linearGradient></defs>' +
      '<circle cx="70" cy="70" r="56" fill="none" stroke="rgba(40,80,150,.45)" stroke-width="8" stroke-dasharray="' + arc + ' ' + C + '" transform="rotate(130 70 70)" stroke-linecap="round"/>' +
      '<circle cx="70" cy="70" r="56" fill="none" stroke="url(#gg)" stroke-width="8" stroke-dasharray="' + (arc * pct) + ' ' + C + '" transform="rotate(130 70 70)" stroke-linecap="round" style="filter:drop-shadow(0 0 6px rgba(40,200,255,.8))"/></svg>' +
      '<div class="in">' + ico('leaf') + '<b>' + h.kw.toFixed(1).replace('.', ',') + '<small> kW</small></b><span>consommés</span><em>' + ico('chevD') + '32 % vs hier</em></div></div>' +
      '<div class="erows"><div class="erow tile">' + ico('sun').replace('class="ico', 'style="color:#ffd23f;filter:drop-shadow(0 0 8px rgba(255,210,63,.8))" class="ico') +
      '<b>' + (sol > .05 ? sol.toFixed(1).replace('.', ',') + ' kW' : '18,6 kWh') + '</b><small>' + (sol > .05 ? 'Panneaux solaires' : 'Produits aujourd’hui') + '</small><div class="chart">' + bars.map((v, i) => '<i style="height:' + (v / 22 * 100) + '%;opacity:' + (i <= new Date().getHours() - 6 ? 1 : .35) + '"></i>').join('') + '</div></div>' +
      '<div class="erow tile">' + ico('batteryV').replace('class="ico', 'style="color:#22e3a4;filter:drop-shadow(0 0 8px rgba(34,227,164,.7))" class="ico') +
      '<b>' + (L.bat / 100 * 16).toFixed(1).replace('.', ',') + ' / 16 kWh</b><small>Batterie</small><div class="bar"><div><i style="width:' + Math.round(L.bat) + '%"></i></div>' + Math.round(L.bat) + ' %</div></div></div>' +
      '<div class="epills">' +
      pill('data-act="chauffage"', 'flame', '#ff6a2b', 'Chauffage', (ch.on ? (ch.mode || 'Auto') + ' · ' + String(ch.temp).replace('.', ',') + '°' : 'Arrêt')) +
      pill('data-act="toggle" data-id="home.ecs"', 'hotWater', '#2fb0ff', 'Eau chaude', dev('home.ecs').on ? '52 °C' : 'Hors-gel') +
      pill('data-act="toggle" data-id="home.climg"', 'snow', '#2fd8ff', 'Clim', dev('home.climg').on ? clims + ' pièce' + (clims > 1 ? 's' : '') : 'Arrêt') +
      pill('data-act="goto" data-arg="plex"', 'plex', '#ffb020', 'Plex', S.plexPlaying ? 'En lecture' : 'En pause', S.plexPlaying ? '#2ed3ff' : '') +
      pill('data-act="musicToggle"', 'musicFill', '#2fb6ff', 'Musique', Music.playing ? 'En lecture' : 'En pause', Music.playing ? '#2ed3ff' : '') +
      '</div></div></section>';
  };
  /* Musique (accueil) : morceau en cours + favoris de l'utilisateur */
  RENDER.hmusic = s => {
    const i = B.curInfo(), tab = S.music.htab || 'radio';
    const favs = Music.favs().map(id => Music.get(id)).filter(Boolean);
    let list = tab === 'radio' ? favs.filter(x => x.kind === 'radio') : tab === 'yt' ? favs.filter(x => Music.kindOf(x) === 'yt') : favs.filter(x => Music.kindOf(x) === 'audio' || x.group === 'Ambiances');
    const pool = tab === 'radio' ? DATA.RADIOS.map(r => Music.get(r.id)) : tab === 'yt' ? Music.sources().filter(x => Music.kindOf(x) === 'yt') : S.playlists.map(p => Music.get(p.id));
    list = list.concat(pool.filter(x => !list.some(y => y.id === x.id)).map(x => Object.assign({ sug: true }, x))).slice(0, 6);
    const fav = x => { const k = Music.kindOf(x), on = S.music.src === x.id; return '<button class="fav' + (on ? ' on' : '') + (x.sug ? ' sug' : '') + '" data-act="mPlay" data-arg="' + x.id + '" title="' + esc(x.name) + '">' + (k === 'radio' ? B.radioLogo(x, 46, true) : '<img src="' + (x.cover || 'assets/media/playlist-1.jpg') + '" alt="">') + (on && Music.playing ? '<span class="eq"><i></i><i></i><i></i></span>' : '') + '<span>' + esc(x.name) + '</span></button>'; };
    return '<section class="card hcard hmus abs" style="' + s.style + '">' + B.whead('music', 'Musique', '<div class="tabs sm">' + [['radio', 'Radios'], ['yt', 'YouTube'], ['amb', 'Ambiances']].map(t => '<button class="' + (tab === t[0] ? 'on' : '') + '" data-act="hmTab" data-arg="' + t[0] + '">' + t[1] + '</button>').join('') + '</div><a href="#musique" class="wmore" aria-label="Page Musique">' + ico('chevR') + '</a>') +
      '<div class="hmnow"><a href="#musique" class="cv">' + B.mcover(i, 84) + '</a><div class="nf">' + B.srcPill(i) + '<b>' + esc(i.title) + '</b><span>' + esc(i.artist) + '</span>' + B.transport() + '</div></div>' +
      '<div class="favs">' + list.slice(0, 6).map(fav).join('') + '</div></section>';
  };
  B.act('hmTab', el => { S.music.htab = el.dataset.arg; B.save(); B.emit('music'); });
  /* Plex (accueil) : film sélectionné + ajouts récents */
  RENDER.hplex = s => {
    const p = B.Plex.sel(), rec = B.Plex.list('recent').filter(x => x.id !== p.id).slice(0, 4);
    return '<section class="card hcard hplex abs" style="' + s.style + '">' + B.whead('plex', 'Soirée ciné', '<a href="#plex" class="wmore" aria-label="Page Plex">' + ico('chevR') + '</a>') +
      '<div class="hpx"><a href="#plex" class="pst"><img src="' + p.img + '" alt=""></a><div class="pi"><small>' + (S.plexPlaying ? 'En lecture sur la TV' : p.progress ? 'À reprendre' : 'À découvrir') + '</small><b>' + esc(p.title) + '</b><span>' + esc(p.kind) + ' · ' + p.year + ' · ' + esc(p.dur) + '</span>' +
      (p.progress ? '<i class="pgbar"><b style="width:' + p.progress + '%"></b></i>' : '') +
      '<div class="row"><button class="btn pri sm" data-act="plexPlay" data-toggle="1">' + ico(S.plexPlaying ? 'pause' : 'play') + (S.plexPlaying ? 'Pause' : p.progress ? 'Reprendre' : 'Regarder') + '</button>' + rec.slice(0, 3).map(x => B.poster(x, 'mini')).join('') + '</div></div></div></section>';
  };
  RENDER.hnas = s => '<section class="card hcard hnas abs" style="' + s.style + '">' + B.whead('nas', 'Stockage', '<span class="tag2">En ligne</span>') +
    '<div class="nasbox tile" data-act="goto" data-arg="nas" role="button"><img src="' + A + 'devices/nas.jpg" alt=""><span class="l">UGREEN</span><span class="r">12,4 / 16 To</span><div class="bar"><i style="width:78%"></i></div><span class="pct">78 %</span></div>' +
    '<div class="nasbtns">' + [['files', 'Fichiers'], ['photo', 'Photos'], ['video', 'Vidéos'], ['cloudUp', 'Sauvegarde']].map(b => '<button class="tile" data-act="nasOpen" data-arg="' + b[1] + '">' + ico(b[0]) + b[1] + '</button>').join('') + '</div>' +
    '<div class="nasst">' + ico('download') + '2 téléchargements · sauvegarde OK cette nuit</div></section>';
  RENDER.hia = s => '<section class="card hcard hia abs" style="' + s.style + '">' + B.whead('ia', 'Bêta IA', '<button class="wmore" data-act="iaOpen" aria-label="Ouvrir la conversation">' + ico('chevR') + '</button>') +
    '<p class="hello">' + hello() + ' ' + esc(B.user().name) + ' 👋<span class="cy">Que puis-je faire pour vous ?</span></p>' +
    '<div class="sugg"><button data-act="iaAsk" data-arg="Fais le point sur la maison">' + ico('sparkle') + 'Point maison</button><button data-act="iaAsk" data-arg="Quel temps fait-il ?">' + ico('cloudMoon') + 'Météo</button><button data-act="iaAsk" data-arg="Lance ma playlist Japon">' + ico('musicFill') + 'Playlist Japon</button></div>' +
    '<form data-submit="iaHome"><button type="button" data-act="mic" aria-label="Dicter">' + ico('mic') + '</button><input name="q" placeholder="Écrivez ou dictez…" autocomplete="off" enterkeyhint="send" aria-label="Question"><button aria-label="Envoyer">' + ico('send') + '</button></form></section>';

  B.route('accueil', { title: 'Accueil', bg: A + 'bg/home.jpg', w: 1672, h: 941, render: () => {
    const C = [692, 375];
    const cams = [['cam.cour-garage', [708, 428, 931, 655]], ['cam.cour', [945, 428, 1169, 655]], ['cam.sonnette', [1182, 428, 1406, 655]], ['cam.jardin', [1420, 428, 1646, 655]]];
    return B.side('accueil') + B.logo(px(110, 12, 250, 72)) +
      T({ t: 'hdate', keys: ['clock'] }) + T({ t: 'hwxs', keys: ['weather'] }) + T({ t: 'hicons', keys: ['mails', 'events'] }) +
      T({ t: 'husers', style: box([105, 120, 640, 362]), keys: ['users'] }) +
      T({ t: 'hmeteo', style: box([652, 120, 1064, 362]), keys: ['weather'] }) +
      T({ t: 'hcal', style: box([1077, 120, 1357, 362]), keys: ['events'] }) +
      T({ t: 'hmail', style: box([1366, 120, 1662, 362]), keys: ['mails'] }) +
      T({ t: 'henergy', style: box([105, 375, 684, 660]), keys: ['house', 'music', 'plex', 'energy'] }) +
      '<section class="card hcard abs hcams" style="' + box([692, 375, 1662, 660]) + '">' + B.whead('cam', 'Vidéosurveillance', '<button class="wmore" data-act="allCams" aria-label="Toutes les caméras">' + ico('chevR') + '</button>') +
      '<div class="camgrid">' + cams.map(c => T({ t: 'cam', cam: c[0], style: box(c[1], C), bottom: true, tile: true, short: true, det: DATA.CAMS[c[0]].det.slice(0, 3), keys: ['cam:' + c[0]] })).join('') + '</div></section>' +
      T({ t: 'hmusic', style: box([105, 683, 640, 912]), keys: ['music'] }) +
      T({ t: 'hplex', style: box([652, 683, 1064, 912]), keys: ['plex'] }) +
      T({ t: 'hnas', style: box([1077, 683, 1357, 912]) }) +
      T({ t: 'hia', style: box([1366, 683, 1662, 912]), keys: ['users'] });
  } });

  /* ---------- actions accueil ---------- */
  B.act('goto', el => B.go(el.dataset.arg));
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
  RENDER.wxhours = () => {
    const H = WX.hours.slice(0, 24), W = 760, Ht = 170, bw = (W - 20) / H.length;
    const tmin = Math.min(...H.map(x => x.temp)) - 2, tmax = Math.max(...H.map(x => x.temp)) + 2, ty = v => 20 + (1 - (v - tmin) / (tmax - tmin)) * 70;
    return '<svg viewBox="0 0 ' + W + ' ' + Ht + '" style="width:100%" role="img" aria-label="Prévisions heure par heure">' +
      H.map((h, i) => '<rect x="' + (10 + i * bw + bw * .18) + '" y="' + (150 - h.prob * .55) + '" width="' + (bw * .64) + '" height="' + (h.prob * .55) + '" rx="2" fill="' + (h.mm > 0 ? '#2f8bff' : 'rgba(80,140,230,.35)') + '"><title>' + h.prob + ' % · ' + h.mm + ' mm</title></rect>' +
        (i % 3 ? '' : '<text x="' + (10 + i * bw + bw / 2) + '" y="166" text-anchor="middle" fill="#93a8cc" font-size="11">' + h.t.getHours() + ' h</text><text x="' + (10 + i * bw + bw / 2) + '" y="' + (ty(h.temp) - 8) + '" text-anchor="middle" fill="#ffd84a" font-size="11">' + Math.round(h.temp) + '°</text>')).join('') +
      '<path d="' + H.map((h, i) => (i ? 'L' : 'M') + (10 + i * bw + bw / 2).toFixed(1) + ' ' + ty(h.temp).toFixed(1)).join(' ') + '" fill="none" stroke="#ffd84a" stroke-width="2" style="filter:drop-shadow(0 0 5px rgba(255,210,60,.7))"/></svg>' +
      '<div class="row legend"><span><i style="background:#2f8bff"></i>Probabilité de pluie</span><span><i style="height:3px;background:#ffd84a"></i>Température</span>' + (WX.sun ? '<span>' + ico('sun2') + ' ' + F.time(WX.sun.rise) + ' · ' + ico('moon') + ' ' + F.time(WX.sun.set) + '</span>' : '') + '</div>';
  };
  function alertsHTML() {
    const off = B.haAlert && B.haAlert(), list = (off ? [{ icon: 'alert', text: off.text, official: true }] : []).concat(B.wxAlerts());
    if (!list.length) return '<div class="wxok">' + ico('shieldCheck') + 'Aucune alerte météo dans les 24 heures</div>';
    return list.map(a => '<div class="wxalert' + (a.official ? ' off' : '') + '">' + ico(a.icon) + '<span><b>' + (a.official ? 'Vigilance Météo-France' : 'À surveiller') + '</b>' + esc(a.text) + '</span></div>').join('');
  }
  B.wxAlertsHTML = alertsHTML;
  B.act('weather', () => {
    const night = B.isNight();
    B.modal('<h2>' + ico('pinFill') + 'Météo · ' + esc(S.settings.city) + '</h2><div style="display:flex;align-items:center;gap:22px">' + ico(B.wxIcon(WX.now.code, night)).replace('class="ico', 'style="font-size:90px;filter:drop-shadow(0 0 14px rgba(170,200,255,.9))" class="ico') +
      '<div><div style="font-size:64px;font-weight:300;line-height:1">' + WX.now.temp + '°C</div><div style="font-size:18px;color:#dce8fa">' + B.wxText(WX.now.code) + '</div></div><div style="flex:1"></div><div class="wxal">' + alertsHTML() + '</div></div>' +
      '<h4 class="wxh">Les prochaines 24 heures</h4>' + T({ t: 'wxhours', keys: ['weather'] }) +
      '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:14px">' + WX.days.map((d, i) => '<div class="tile kpi" style="align-items:center">' + '<small>' + F.JOURS[new Date(Date.now() + (i + 1) * 864e5).getDay()] + '</small>' + ico(B.wxIcon(d.code, false)).replace('class="ico', 'style="font-size:34px;color:#ffd23f" class="ico') + '<b style="font-size:20px">' + d.max + '° / ' + d.min + '°</b><small>' + B.wxText(d.code) + '</small></div>').join('') + '</div>' +
      '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:10px"><div class="tile kpi"><small>Pluie maintenant</small><b>' + WX.now.rain + ' %</b></div><div class="tile kpi"><small>Vent</small><b>' + WX.now.wind + ' km/h</b></div><div class="tile kpi"><small>Indice UV</small><b>' + WX.now.uv + '</b><em>' + B.uvLabel(WX.now.uv) + '</em></div></div>' +
      '<p class="muted" style="font-size:12px;margin:14px 0 0">' + (WX.ok ? 'Prévisions Open-Meteo. Les alertes « À surveiller » sont calculées d’après ces prévisions ; la vigilance officielle s’affiche si l’intégration Météo-France est reliée dans Home Assistant.' : 'Hors ligne : valeurs de démonstration affichées.') + '</p>', 'wide');
  });

  /* ======================= VERROUILLAGE ======================= */
  RENDER.lkclock = s => {
    const d = new Date(), tm = WX.tomorrow || WX.days[0];
    const who = S.users.find(x => x.id === (S.lockSel || S.user));
    return '<div class="lk-clock glass abs" style="' + s.style + '"><div class="d">' + F.long(d) + '</div><div class="t">' + F.time(d) + '<small>' + B.hello() + (who ? ' ' + esc(who.name) : '') + '</small></div>' +
      '<div class="w">' + ico(B.wxIcon(WX.now.code, false) === 'sun' ? 'sun' : B.wxIcon(WX.now.code, false)) + '<span>' + B.wxText(WX.now.code) + ' <em>· demain ' + tm.max + '° / ' + tm.min + '°</em></span><b>' + WX.now.temp + '°C</b></div>' + nextEv() + '</div>';
  };
  function nextEv() {
    const now = new Date(), nx = S.events.filter(e => new Date(e.date + 'T' + e.time) >= now).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))[0];
    if (!nx) return '';
    const tm = nx.date === F.ymd(now) ? '' : nx.date === F.ymd(new Date(Date.now() + 864e5)) ? 'demain ' : F.dayMonth(new Date(nx.date + 'T12:00')) + ', ';
    return '<div class="nx" style="--c:' + nx.color + '"><i></i>' + tm + nx.time + ' · ' + esc(nx.title) + '</div>';
  }
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
    const un = B.unread(), tm = F.ymd(new Date(Date.now() + 864e5)), evs = S.events.filter(e => e.date === tm).length;
    const L = (y, icon, title, sub, to, cls, c) => '<a class="lk-link glass abs" href="#" data-act="unlockTo" data-arg="' + to + '" style="' + px(1200, y, 305, 76) + '">' + ico(icon) + '<div><b>' + title + '</b><small class="' + (cls || '') + '">' + (c ? '<i style="--c:' + c + '"></i>' : '') + sub + '</small></div>' + ico('chevR', 'chev') + '</a>';
    return '<div class="abs" style="left:0;top:0">' +
      L(329, 'mail', 'Mails', un + ' nouveau' + (un > 1 ? 'x' : ''), 'mails', '', '#2f8bff') +
      L(413, 'calendar', 'Calendrier', evs + ' événement' + (evs > 1 ? 's' : '') + ' demain', 'calendrier') +
      L(497, 'nas', 'UGREEN NAS', 'En ligne', 'nas', 'g', '#22e3a4') +
      '<div class="lk-link lk-music glass abs" style="' + px(1200, 581, 305, 76) + '">' + '<button class="cvb" data-act="unlockTo" data-arg="musique" aria-label="Ouvrir la musique">' + B.mcover(B.curInfo(), 46) + '</button><div><b>' + esc(B.curInfo().title) + '</b><small>' + (Music.playing ? '♪ ' : '') + esc(B.curInfo().artist) + '</small></div>' +
      '<button class="pp2" data-act="musicToggle" aria-label="Lecture/pause">' + ico(Music.playing ? 'pause' : 'play') + '</button></div>' +
      L(665, 'plex', 'Plex', esc(B.Plex.sel().title) + (B.Plex.sel().progress ? ' · à reprendre' : ''), 'plex') + '</div>';
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
      '<div class="lk-hint abs" style="' + px(568, 602, 400, 70) + '"><b>Touchez l’empreinte pour déverrouiller</b><span>Choisissez d’abord votre profil si besoin</span></div>' +
      T({ t: 'lkusers', style: box([410, 722, 1135, 942]), keys: ['users'] }) +
      T({ t: 'lkwx', style: box([1135, 70, 1505, 310]), keys: ['weather'] }) +
      T({ t: 'lklinks', keys: ['mails', 'music', 'events', 'plex'] }) +
      T({ t: 'lkalert', keys: ['cam:cam.sonnette', 'cam:cam.cour'] }) +
      '<div class="lk-routines abs" style="' + px(548, 672, 440, 42) + '">' + (S.routines || []).slice(0, 3).map(r => '<button class="glass" data-act="lockRoutine" data-arg="' + r.id + '">' + ico(r.icon) + esc(r.name) + '</button>').join('') + '</div>' +
      '<div class="lk-quote abs" style="' + px(45, 915, 320, 85) + '"><b>家</b>Un foyer, plus qu’une maison,<br>un équilibre au quotidien.</div>' +
      '<div class="lk-quote r abs" style="' + px(1150, 935, 345, 60) + '"><b>日々、より良く</b>Chaque jour, un peu mieux.</div></div>';
  } });
  RENDER.lkalert = () => {
    const ids = ['cam.sonnette', 'cam.cour'].filter(id => B.camEv(id).dot);
    if (!ids.length) {
      const al = (B.haAlert && B.haAlert()) || B.wxAlerts()[0];
      if (!al) return '<div class="lk-alert abs" hidden></div>';
      return '<button class="lk-alert warn glass abs" style="' + px(518, 24, 500, 46) + '" data-act="weather">' + ico('alert') + '<b>Météo</b><span>' + esc(al.text) + '</span></button>';
    }
    const id = ids[0], e = B.camEv(id);
    return '<button class="lk-alert glass abs" style="' + px(568, 24, 400, 46) + '" data-act="unlockTo" data-arg="exterieur"><span class="dot ' + e.dot + '"></span>' + ico(id === 'cam.sonnette' ? 'bellFill' : 'cctv') + '<b>' + esc(DATA.CAMS[id].name) + '</b><span>' + e.txt.replace(/<[^>]+>/g, '') + '</span></button>';
  };
  /* code à 4 chiffres (facultatif, réglé dans Paramètres › Profils) */
  function askPin(u, done) {
    let code = '';
    const m = B.modal('<div class="pinpad"><img src="' + u.avatar + '" alt=""><b>' + esc(u.name) + '</b><span class="muted">Entrez votre code</span><div class="dots">' + '<i></i>'.repeat(4) + '</div><div class="keys">' +
      [1, 2, 3, 4, 5, 6, 7, 8, 9, '', 0, '⌫'].map(k => k === '' ? '<span></span>' : '<button data-k="' + k + '">' + k + '</button>').join('') + '</div></div>', 'sm pin');
    m.addEventListener('click', e => {
      const b = e.target.closest('[data-k]'); if (!b) return;
      const k = b.dataset.k; code = k === '⌫' ? code.slice(0, -1) : (code + k).slice(0, 4);
      m.querySelectorAll('.dots i').forEach((d, i) => d.classList.toggle('on', i < code.length));
      if (code.length === 4) {
        if (code === u.pin) { B.closeModal(); done(); }
        else { const p = m.querySelector('.pinpad'); p.classList.add('shake'); setTimeout(() => { p.classList.remove('shake'); code = ''; m.querySelectorAll('.dots i').forEach(d => d.classList.remove('on')); }, 450); }
      }
    });
  }
  function unlock(to) {
    const u = S.users.find(x => x.id === (S.lockSel || S.user));
    if (u && u.pin && !unlock.ok) return askPin(u, () => { unlock.ok = true; unlock(to); });
    unlock.ok = false;
    const fp = document.getElementById('fp');
    if (fp) fp.classList.add('scan');
    if (B.fx) setTimeout(() => B.fx.sound('unlock'), 700);
    setTimeout(() => { const b = document.createElement('div'); b.className = 'burst'; document.body.appendChild(b); setTimeout(() => b.remove(), 1400); }, 760);
    setTimeout(() => { if (fp) { fp.classList.remove('scan'); fp.classList.add('ok'); } }, 750);
    setTimeout(() => {
      S.user = S.lockSel || S.user; delete S.lockSel; B.save();
      sessionStorage.setItem('betaos.unlocked', '1');
      document.body.classList.add('unlocking');
      setTimeout(() => { document.body.classList.remove('unlocking'); B.go(to || 'accueil'); }, 520);
    }, 1050);
  }
  B.act('lockRoutine', el => { B.runRoutine(el.dataset.arg); B.emit('house'); });
  /* Seule l'empreinte déverrouille. Un raccourci (Mails, Musique…) ou un profil ne fait que
     préparer l'ouverture : on touche ensuite l'empreinte. */
  const NAMES = { mails: 'vos mails', calendrier: 'le calendrier', nas: 'le NAS', musique: 'la musique', plex: 'Plex', exterieur: 'les caméras' };
  function pending(txt) {
    const h = document.querySelector('.lk-hint');
    if (h) h.innerHTML = '<b>Touchez l’empreinte</b><span>' + txt + '</span>';
    const fp = document.getElementById('fp');
    if (fp) { fp.classList.remove('nudge'); void fp.offsetWidth; fp.classList.add('nudge'); }
  }
  B.act('unlock', () => { const to = S.lockTo; delete S.lockTo; unlock(to); });
  B.act('unlockTo', el => { S.lockTo = el.dataset.arg; pending('pour ouvrir ' + (NAMES[el.dataset.arg] || 'la page')); });
  B.act('lockUser', el => { S.lockSel = el.dataset.arg; B.emit('users'); const u = S.users.find(x => x.id === el.dataset.arg); pending(u ? 'Profil choisi : ' + u.name : 'Profil Invité'); });
})();

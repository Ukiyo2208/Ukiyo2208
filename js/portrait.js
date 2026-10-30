/* Bêta home 7.18 — écrans verticaux et panneaux muraux :
   - accueil vertical (tablette tenue debout, iPhone) : heure, météo, famille, état de la maison, raccourcis,
     pièces favorites, caméras, agenda, musique. Les autres pages (Pièces, Sécurité, Énergie…) ne changent pas.
   - panneau mural d'une pièce (DotStarTech Wall Panel CM4, écran carré 720 × 720) : lumières, volet, chauffage,
     réveil en douceur, écran de nuit, missions d'une chambre d'enfant ; la sonnette n'y apparaît que si
     quelqu'un est réveillé dans la pièce (lumière allumée ou volet ouvert), jamais dans une chambre d'enfant.
   Réglages : Paramètres › Cet écran. Adresse directe d'un panneau : http://NAS:8090/?panneau=chambre-1 */
(function () {
  const B = window.BOS, { S, DATA, esc, F, dev, setDev, T, RENDER, WX } = B;
  const DK = 'betaos.device';
  const cfg = () => { try { return JSON.parse(localStorage.getItem(DK) || '{}'); } catch (e) { return {}; } };
  const setCfg = c => { try { localStorage.setItem(DK, JSON.stringify(c)); } catch (e) { } };
  const srv = () => B.Server && B.Server.ok();
  const status = () => (S.brain || {}).status || {};
  const fmt = v => String(Math.round(v * 10) / 10).replace('.', ',');
  const slug = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const today = () => F.ymd(new Date());

  /* ---------- pièces et appareils ---------- */
  const rooms = () => (B.roomsList ? B.roomsList(null) : []);
  const roomBy = key => rooms().find(r => r.key === key);
  const isLight = d => d.type === 'light' || d.type === 'group';
  const isCover = d => d.type === 'cover' && (!B.kindOf || B.kindOf(d) !== 'garage');
  const lightsOf = r => r.devs.filter(isLight);
  const coversOf = r => r.devs.filter(isCover);
  const climOf = r => r.devs.find(d => d.type === 'clim');
  const isOn = d => { const s = dev(d.id); return d.type === 'group' ? !!(s.on && (s.lit === undefined || s.lit > 0)) : !!s.on; };
  // température de la pièce : capteur de température, sinon la mesure de la clim
  function roomTemp(r) {
    const t = r.devs.find(d => d.type === 'sensor' && (d.kind === 'temp' || /°C/.test((d.def || {}).unit || '')));
    if (t && dev(t.id).val != null) return +dev(t.id).val;
    const c = climOf(r); return c && dev(c.id).cur != null ? +dev(c.id).cur : null;
  }
  function roomHum(r) { const h = r.devs.find(d => d.type === 'sensor' && (d.kind === 'hum' || (d.def || {}).unit === '%')); return h && dev(h.id).val != null ? +dev(h.id).val : null; }
  function setRoomLights(r, on) { lightsOf(r).forEach(d => { const s = dev(d.id); if (!!isOn(d) !== on) setDev(d.id, d.type === 'group' && on && !s.lit ? { on, lit: s.n } : { on }); }); }

  /* =================== ACCUEIL VERTICAL =================== */
  const phRooms = () => {
    const c = cfg().phome || {}, all = rooms().filter(r => r.floor !== 'ext' && lightsOf(r).length);
    const fav = (c.rooms || []).map(roomBy).filter(Boolean);
    return (fav.length ? fav : all.slice().sort((a, b) => lightsOf(b).length - lightsOf(a).length)).slice(0, 4);
  };
  const phCams = () => {
    const c = cfg().phome || {}, ids = Object.keys(DATA.CAMS), fav = (c.cams || []).filter(id => DATA.CAMS[id]);
    if (fav.length) return fav.slice(0, 2);
    const bell = ids.find(id => DATA.CAMS[id].bell || /sonnette/i.test(id));
    return (bell ? [bell] : []).concat(ids.filter(id => id !== bell)).slice(0, 2);
  };
  RENDER.phTop = () => {
    const now = new Date(), w = WX.now || {}, st = status(), tp = st.tempo, chips = [];
    if (tp && tp.today) chips.push(['boltPlain', 'Tempo ' + tp.today + (tp.tomorrow ? ' · demain ' + tp.tomorrow : ''), 't-' + tp.today]);
    const tm = F.ymd(new Date(Date.now() + 864e5)), tr = (S.events || []).filter(e => e.trashAuto && (e.date === today() || e.date === tm));
    tr.slice(0, 1).forEach(e => chips.push(['trash', e.title.replace(' (collecte)', '') + (e.date === tm ? ' demain' : ' aujourd’hui'), '']));
    const nx = (S.events || []).filter(e => !e.trashAuto && e.date === today() && (e.time || '') >= F.time(now)).sort((a, b) => (a.time || '').localeCompare(b.time || ''))[0];
    if (nx) chips.push(['calendar', (nx.time ? nx.time + ' ' : '') + nx.title, '']);
    const al = (B.wxAlerts ? B.wxAlerts() : [])[0]; if (al) chips.push([al.icon, al.text, 'w']);
    return '<div class="phtop"><div class="phclock"><b>' + F.time(now) + '</b><span>' + cap(now.toLocaleDateString(window.BETA_LANG === 'en' ? 'en-GB' : 'fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })) + '</span></div>' +
      '<button class="phwx" data-act="weather"><b>' + ico(B.wxIcon(w.code, B.isNight())) + Math.round(w.temp) + '°</b><small><span class="city">' + esc(S.settings.city || '') + ' · </span>' + (WX.today ? WX.today.max + '° / ' + WX.today.min + '°' : 'ressenti ' + w.feel + '°') + ' · pluie ' + (w.rain || 0) + ' %</small></button></div>' +
      (chips.length ? '<div class="phchips">' + chips.map(c => '<span class="' + c[2] + '">' + ico(c[0]) + esc(c[1]) + '</span>').join('') + '</div>' : '');
  };
  RENDER.phPeople = () => '<section class="card phpeople">' + S.users.slice(0, 5).map(u => {
    const p = DATA.PLACES[u.place] || DATA.PLACES.away || { label: '', icon: 'pin' }, home = u.place === 'home';
    return '<button class="phu' + (home ? ' home' : '') + '" data-act="userCard" data-arg="' + u.id + '"><img src="' + esc(u.avatar) + '" alt=""><b>' + esc(u.name) + '</b><small>' + ico(p.icon) + esc(p.label) + '</small></button>';
  }).join('') + '</section>';
  RENDER.phStatus = () => {
    const h = B.house ? B.house() : { on: 0, open: 0, kw: 0 }, a = (status().alarm || {}).status, temps = rooms().map(roomTemp).filter(v => v != null);
    const alarm = a ? (a === 'disarmed' ? ['Désarmée', 'ok'] : a === 'triggered' ? ['ALARME', 'bad'] : a === 'armed_night' ? ['Nuit', 'on'] : ['Activée', 'on']) : [S.alarm ? 'Activée' : 'Désarmée', S.alarm ? 'on' : 'ok'];
    const cell = (go, icon, v, l, cls) => '<a href="#' + go + '" class="' + (cls || '') + '">' + ico(icon) + '<b>' + v + '</b><small>' + l + '</small></a>';
    return '<section class="card phstatus">' + cell('securite', 'shieldCheck', alarm[0], 'Alarme', alarm[1]) +
      (temps.length ? cell('pieces', 'therm', fmt(temps.reduce((x, y) => x + y, 0) / temps.length) + '°', 'Intérieur') : cell('energie', 'boltPlain', fmt(h.kw) + ' kW', 'Consommation')) +
      cell('pieces', 'bulbFill', h.on + ' allumée' + (h.on > 1 ? 's' : ''), 'Lumières', h.on ? 'lit' : '') +
      cell('pieces', 'blindsWin', h.open ? h.open + ' ouvert' + (h.open > 1 ? 's' : '') : 'Tous fermés', 'Volets', h.open ? '' : 'ok') + '</section>';
  };
  // les mêmes raccourcis que la page Raccourcis de l'iPhone
  RENDER.phFavs = () => {
    const l = B.qkFavs ? B.qkFavs() : [], col = ['#ffb44d', '#22e3a4', '#9b6bff', '#8fb6ff'];
    return '<section class="phfavs" style="grid-template-columns:repeat(' + Math.max(1, Math.min(4, l.length)) + ',1fr)">' + l.slice(0, 4).map((f, i) => { const x = B.qkInfo(f); return x ? '<button class="card' + (x.on ? ' on' : '') + '" data-act="qkRun" data-arg="' + i + '" style="--c:' + col[i % 4] + '">' + ico(x.icon) + '<b>' + esc(x.name) + '</b></button>' : ''; }).join('') + '</section>';
  };
  RENDER.phRooms = () => '<section class="phrooms">' + phRooms().map(r => {
    const L = lightsOf(r), n = L.filter(isOn).length, t = roomTemp(r), f = B.floor && B.floor(r.floor);
    return '<div class="phroom" style="background-image:url(\'' + esc(r.img || 'assets/bg/generic.jpg') + '\')"><a href="#' + (f ? f.route : 'pieces') + '" class="in"><b>' + esc(r.label) + '</b><small><span class="' + (n ? 'lit' : '') + '">' + ico(n ? 'bulbFill' : 'bulb') + n + '</span>' + (t != null ? '<span>' + ico('therm') + fmt(t) + '°</span>' : '') + '</small></a>' +
      '<button class="sw' + (n ? ' on' : '') + '" data-act="phRoom" data-arg="' + esc(r.key) + '" role="switch" aria-label="Lumières ' + esc(r.label) + '"></button></div>';
  }).join('') + '</section>';
  B.act('phRoom', el => { const r = roomBy(el.dataset.arg); if (r) setRoomLights(r, !lightsOf(r).some(isOn)); });
  RENDER.phAgenda = () => {
    const l = (S.events || []).filter(e => e.date === today()).sort((a, b) => (a.time || '').localeCompare(b.time || '')).slice(0, 3);
    return '<a href="#calendrier" class="card phag">' + B.whead('cal', 'Aujourd’hui') + (l.length ? l.map(e => '<div style="--c:' + (e.color || '#2f8bff') + '"><b>' + esc(e.time || '—') + '</b><span>' + esc(e.title) + '</span></div>').join('') : '<p class="muted">Rien de prévu aujourd’hui</p>') + '</a>';
  };
  RENDER.phMusic = () => { const i = B.curInfo(); return '<section class="card phmus"><a href="#musique" class="cv">' + B.mcover(i, 64) + '</a><div class="nf"><b>' + esc(i.title) + '</b><small>' + esc(i.artist) + '</small></div>' + B.transport() + '</section>'; };
  B.portraitHome = () => B.side('accueil', { notop: true }) + '<div class="ph">' +
    T({ t: 'phTop', keys: ['clock', 'weather', 'brain', 'events'] }) +
    T({ t: 'phPeople', keys: ['users'] }) +
    T({ t: 'phStatus', keys: ['house', 'brain'] }) +
    T({ t: 'phFavs', keys: ['qk', 'house', 'plus'] }) +
    T({ t: 'phRooms', keys: ['house'] }) +
    '<div class="phcams">' + phCams().map(id => T({ t: 'cam', cam: id, bottom: true, tile: true, short: true, det: [], keys: ['cam:' + id] })).join('') + '</div>' +
    '<div class="phduo">' + T({ t: 'phAgenda', keys: ['events', 'clock'] }) + T({ t: 'phMusic', keys: ['music'] }) + '</div></div>';

  /* =================== PANNEAU MURAL D'UNE PIÈCE =================== */
  const panel = () => { const p = cfg().panel; return p && p.room ? Object.assign({ ring: 'auto', kid: '' }, p) : null; };
  B.panelCfg = panel;
  B.forceRoute = () => panel() ? 'panneau' : null;
  // adresse directe : ?panneau=chambre-1 (&enfant=leo &sonnette=jamais|toujours|auto)
  (function fromUrl(retry) {
    const q = new URLSearchParams(location.search), v = q.get('panneau'); if (v === null) return;
    const c = cfg();
    if (!v || v === 'non') delete c.panel;
    else {
      const r = rooms().find(x => slug(x.label) === slug(v) || slug(x.name) === slug(v) || x.key === v);
      // les appareils reliés au NAS arrivent quelques secondes après le démarrage : on réessaie une fois
      if (!r) { if (!retry) setTimeout(() => fromUrl(true), 5000); else B.toast('Pièce « ' + v + ' » introuvable : choisissez-la dans Paramètres › Cet écran', 'info'); return; }
      const kid = q.get('enfant'), u = kid && S.users.find(x => slug(x.name) === slug(kid) || x.id === kid);
      c.panel = Object.assign({}, c.panel, { room: r.key, kid: u ? u.id : (c.panel || {}).kid || '', ring: { jamais: 'never', toujours: 'always', auto: 'auto' }[q.get('sonnette')] || (c.panel || {}).ring || 'auto' });
    }
    setCfg(c); history.replaceState(null, '', location.pathname + '#panneau'); if (retry) { window.dispatchEvent(new Event('resize')); B.show(); }
  })();

  // la sonnette sur ce panneau ? jamais dans une chambre d'enfant ; en automatique, seulement si quelqu'un est réveillé
  // (une lumière allumée, ou un volet ouvert). Les autres écrans de la maison ne sont pas concernés.
  B.ringAllowed = () => {
    const p = panel(); if (!p) return true;
    if (p.ring === 'always') return true;
    if (p.ring === 'never' || p.kid) return false;
    const r = roomBy(p.room); if (!r) return true;
    const cv = coversOf(r);
    return lightsOf(r).some(isOn) || (cv.length > 0 && cv.some(d => dev(d.id).pos > 0));
  };

  const P = { view: 'main', light: null, wake: null, last: Date.now() };
  const pages = () => ['main', 'cover'].concat(panel() && panel().kid ? ['missions'] : []);
  const tabCfg = () => Object.assign({ night: true, from: '22:00', to: '07:00' }, cfg().tablet || {});
  const nightNow = () => { const t = tabCfg(); if (!t.night) return false; const n = F.time(new Date()); return t.from <= t.to ? n >= t.from && n < t.to : n >= t.from || n < t.to; };
  const kidUser = () => { const p = panel(); return p && p.kid ? S.users.find(u => u.id === p.kid) : null; };
  const go = v => { P.view = v; P.last = Date.now(); B.emit('mp'); };
  const ia = () => '<button class="mpia" data-act="iaOpen" aria-label="Bêta IA">' + brainSVG() + '</button>';
  const back = () => '<button class="mpbk" data-act="mpGo" data-arg="main" aria-label="Retour">' + ico('chevL') + '</button>';
  const dots = () => { const l = pages(); return l.length > 1 && l.includes(P.view) ? '<div class="mpdots">' + l.map(v => '<i class="' + (v === P.view ? 'on' : '') + '" data-act="mpGo" data-arg="' + v + '"></i>').join('') + '</div>' : ''; };
  const head = (r, title, sub, left, right) => '<div class="mphd">' + (left || '') + '<div class="t" data-lp="mpExit"><h1>' + esc(title) + '</h1><small>' + sub + '</small></div>' + (right || '') + '</div>';
  const climRow = c => { const s = dev(c.id); return '<div class="card mprow">' + ico('flame') + '<div><b>Chauffage</b><small>' + (s.on === false ? 'Arrêté' : 'Consigne ' + fmt(+s.temp || 21) + '°' + (s.cur != null ? ' · pièce ' + fmt(s.cur) + '°' : '')) + '</small></div><span class="mpbtns"><button data-act="rclim" data-id="' + c.id + '" data-arg="-1" aria-label="Moins">' + ico('minus') + '</button><button data-act="rclim" data-id="' + c.id + '" data-arg="1" aria-label="Plus">' + ico('plus') + '</button></span></div>'; };
  const coverRow = d => '<div class="card mprow">' + ico('blindsWin') + '<div><b>' + esc(d.name) + '</b><small>' + (dev(d.id).pos > 0 ? 'Ouvert à ' + Math.round(dev(d.id).pos) + ' %' : 'Fermé') + '</small></div><span class="mpbtns"><button data-act="cover" data-id="' + d.id + '" data-arg="up" aria-label="Monter">' + ico('chevU') + '</button><button data-act="cover" data-id="' + d.id + '" data-arg="stop" aria-label="Stop">' + ico('stop') + '</button><button data-act="cover" data-id="' + d.id + '" data-arg="down" aria-label="Descendre">' + ico('chevD') + '</button></span></div>';
  function scenesOf(r) {
    const l = ((B.P && B.P.cfg && B.P.cfg.scenes) || []).filter(s => s.room === r.name || s.room === r.label).slice(0, 2);
    return l.length ? l.map(s => '<button class="card" data-act="scRun" data-arg="' + esc(s.id) + '">' + ico(s.icon || 'sparkle') + '<b>' + esc(s.name) + '</b></button>').join('')
      : '<button class="card" data-act="mpScene" data-arg="read">' + ico('journal') + '<b>Lecture</b></button><button class="card" data-act="mpScene" data-arg="sleep">' + ico('moon') + '<b>Dodo</b></button>';
  }
  function viewMain(r) {
    const L = lightsOf(r), c = climOf(r), cv = coversOf(r), t = roomTemp(r), h = roomHum(r), now = new Date();
    return head(r, r.label, (t != null ? fmt(t) + '°' : '') + (h != null ? ' · humidité ' + Math.round(h) + ' %' : '') || ((L.filter(isOn).length || 'aucune') + ' lumière(s) allumée(s)'), '', '<div class="mpclock"><b>' + F.time(now) + '</b><small>' + cap(now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric' })) + '</small></div>' + ia()) +
      (L.length ? '<div class="mptiles n' + Math.min(L.length, 3) + '">' + L.slice(0, 6).map(d => { const s = dev(d.id), on = isOn(d); return '<button class="mpt' + (on ? ' on' : '') + '" data-act="mpTap" data-id="' + d.id + '" data-lp="mpLight" style="' + (on && s.color && d.def && d.def.rgb ? '--lc:' + s.color : '') + '">' + ico(on ? 'bulbFill' : 'bulb') + '<span><b>' + esc(d.name) + '</b><small>' + (on ? (s.bri ? Math.round(s.bri) + ' %' : 'Allumée') : 'Éteinte') + '</small></span></button>'; }).join('') + '</div>' : '') +
      (cv[0] ? coverRow(cv[0]) : '') + (c ? climRow(c) : '') +
      '<div class="mpsc">' + scenesOf(r) + '</div>' + dots();
  }
  const WHITES = [2200, 2700, 3200, 4000, 5000, 6500], WHEX = ['#ffb466', '#ffd29a', '#ffe9c9', '#fff7ec', '#eef4ff', '#d8e6ff'], COLORS = ['#ff4d6d', '#ff8a34', '#ffd23f', '#1fe0a0', '#2ed3ff', '#9b6bff'];
  function viewLight(r) {
    const d = DATA.DEVICES[P.light]; if (!d) return viewMain(r);
    const s = dev(d.id), on = isOn(d), bri = on ? Math.round(s.bri || 80) : 0;
    return head(r, d.name, esc(r.label), back(), '<button class="mppow' + (on ? ' on' : '') + '" data-act="mpTap" data-id="' + d.id + '" aria-label="Allumer / éteindre">' + ico('power') + '</button>') +
      '<p class="mplbl">Intensité</p><label class="mpslider"><input type="range" min="1" max="100" value="' + (bri || 1) + '" data-input="mpBriLive" data-change="mpBri" data-id="' + d.id + '" style="--p:' + bri + '%" aria-label="Intensité"><span>' + ico('sun') + '</span><em>' + bri + ' %</em></label>' +
      '<p class="mplbl">Blanc</p><div class="mpsw">' + WHITES.map((k, i) => '<button style="background:' + WHEX[i] + '" class="' + (s.ct && Math.abs(s.ct - k) < 250 ? 'on' : '') + '" data-act="mpCt" data-id="' + d.id + '" data-arg="' + k + '" aria-label="Blanc ' + k + ' K"></button>').join('') + '</div>' +
      (d.def && d.def.rgb ? '<p class="mplbl">Couleur</p><div class="mpsw">' + COLORS.map(c => '<button style="background:' + c + '" class="' + (s.color === c ? 'on' : '') + '" data-act="mpColor" data-id="' + d.id + '" data-arg="' + c + '" aria-label="Couleur"></button>').join('') + '</div>' : '');
  }
  function viewCover(r) {
    const cv = coversOf(r)[0], c = climOf(r);
    if (!cv && !c) return head(r, r.label, 'Ni volet ni chauffage dans cette pièce', back()) + dots();
    const pos = cv ? Math.round(dev(cv.id).pos || 0) : 0;
    return head(r, cv ? cv.name : 'Chauffage', cv ? 'Volet de ' + esc(r.label) : esc(r.label), back()) +
      (cv ? '<div class="mpcover"><div class="mpwin"><i style="height:' + (100 - pos) + '%"></i><b>' + (pos ? pos + ' %' : 'Fermé') + '</b></div><div class="mpcb">' +
        [['up', 'chevU', 'Ouvrir'], ['half', 'sun', 'Mi-hauteur'], ['stop', 'stop', 'Stop'], ['down', 'chevD', 'Fermer']].map(b => '<button class="card" data-act="' + (b[0] === 'half' ? 'mpHalf' : 'cover') + '" data-id="' + cv.id + '" data-arg="' + b[0] + '">' + ico(b[1]) + b[2] + '</button>').join('') + '</div></div>' : '') +
      (c ? climRow(c) : '') + dots();
  }
  function viewMissions(r) {
    const u = kidUser(), FM = B.FM || {}, d = new Date();
    if (!u) return viewMain(r);
    if (!FM.cfg) return head(r, 'Missions de ' + u.name, 'Serveur Bêta nécessaire', back()) + dots();
    const l = (FM.cfg.chores || []).filter(c => c.who === u.name && (!c.days || !c.days.length || c.days.includes(d.getDay())));
    const done = c => (FM.cfg.done || []).some(x => x.chore === c.id && x.day === today()), pts = ((FM.state || {}).points || {})[u.name] || 0;
    const nx = (FM.cfg.rewards || []).filter(x => +x.cost > pts).sort((a, b) => a.cost - b.cost)[0];
    return head(r, 'Missions de ' + u.name, '⭐ ' + pts + ' points' + (nx ? ' · encore ' + (nx.cost - pts) + ' pour « ' + esc(nx.name) + ' »' : ''), '', ia()) +
      '<div class="mpms">' + (l.length ? l.slice(0, 5).map(c => '<button class="' + (done(c) ? 'ok' : '') + '" data-act="msDo" data-arg="' + esc(c.id) + '"><span class="ck">' + (done(c) ? ico('check') : '') + '</span>' + esc(c.name) + '<small>+' + c.points + '</small></button>').join('') : '<p class="muted">Pas de mission aujourd’hui.</p>') + '</div>' + dots();
  }
  function nextWake(r) {
    const ids = r.devs.map(d => d.id), u = kidUser(), l = ((B.V && B.V.cfg && B.V.cfg.wakes) || []).filter(w => w.on !== false && w.time && ((w.lights || []).concat(w.covers || []).some(id => ids.includes(id)) || (u && w.who === u.name)));
    return l.map(w => w.time).sort()[0] || '';
  }
  function viewNight(r) {
    const t = roomTemp(r), a = (status().alarm || {}).status, wk = nextWake(r);
    return '<div class="mpnight" data-act="mpGo" data-arg="main"><b>' + F.time(new Date()) + '</b>' + (wk ? '<p>Réveil à ' + wk + '</p>' : '') +
      '<div>' + (t != null ? '<span>' + ico('therm') + fmt(t) + '°</span>' : '') + (a && a !== 'disarmed' ? '<span>' + ico('shieldCheck') + (a === 'armed_night' ? 'Alarme Nuit' : 'Alarme activée') + '</span>' : '') + '</div><small>Touchez pour afficher la pièce</small></div>';
  }
  function viewWake(r) {
    const u = kidUser(), w = WX.now || {}, nx = (S.events || []).filter(e => !e.trashAuto && e.date === today()).sort((a, b) => (a.time || '').localeCompare(b.time || ''))[0];
    return '<div class="mpwake"><div class="sun"></div><b>' + F.time(new Date()) + '</b><p>Bonjour' + (u ? ' ' + esc(u.name) : '') + ' ! ' + Math.round(w.temp) + '° dehors</p>' +
      (nx ? '<div class="chips"><span>' + ico('calendar') + esc((nx.time ? nx.time + ' ' : '') + nx.title) + '</span></div>' : '') +
      '<div class="btns"><button data-act="mpWake" data-arg="snooze">' + ico('moon') + '+ 10 min</button><button class="pri" data-act="mpWake" data-arg="up">' + ico('sun') + 'Je suis levé</button></div></div>';
  }
  RENDER.mpView = () => {
    const p = panel(), r = p && roomBy(p.room);
    if (!r) return '<div class="mp"><div class="mphd"><div class="t"><h1>Panneau</h1><small>Pièce introuvable : choisissez-la dans Paramètres › Cet écran</small></div></div><button class="btn" data-act="screenCfg">' + ico('gear') + 'Cet écran</button></div>';
    const v = P.view, body = v === 'light' ? viewLight(r) : v === 'cover' ? viewCover(r) : v === 'missions' ? viewMissions(r) : v === 'night' ? viewNight(r) : v === 'wake' ? viewWake(r) : viewMain(r);
    return '<div class="mp v-' + v + '"><div class="mpbg" style="background-image:url(\'' + esc(r.img || 'assets/bg/generic.jpg') + '\')"></div>' + body + '</div>';
  };
  B.route('panneau', { title: 'Panneau', bg: 'assets/bg/generic.jpg', render: () => T({ t: 'mpView', keys: ['mp', 'house', 'clock', 'famille', 'vie'] }) });

  /* ---------- gestes : appui court = allumer/éteindre, appui long = réglages ; glisser = écran suivant ---------- */
  let lpT = null, lpDone = false, sx = null, sy = 0;
  document.addEventListener('pointerdown', e => {
    if (!panel() || B.current !== 'panneau') return;
    P.last = Date.now(); lpDone = false; sx = e.clientX; sy = e.clientY;
    const el = e.target.closest('[data-lp]'); clearTimeout(lpT);
    if (el) lpT = setTimeout(() => { lpDone = true; if (navigator.vibrate) navigator.vibrate(20); B.ACT[el.dataset.lp] && B.ACT[el.dataset.lp](el); }, el.dataset.lp === 'mpExit' ? 2500 : 550);
  }, true);
  document.addEventListener('pointerup', e => {
    clearTimeout(lpT); if (!panel() || B.current !== 'panneau' || sx === null) return;
    const dx = e.clientX - sx, dy = e.clientY - sy; sx = null;
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5 && !e.target.closest('input')) { const l = pages(), i = l.indexOf(P.view); if (i >= 0) { lpDone = true; go(l[(i + (dx < 0 ? 1 : l.length - 1)) % l.length]); } }
  }, true);
  document.addEventListener('click', e => { if (lpDone && panel() && e.target.closest('.mp')) { e.stopPropagation(); e.preventDefault(); lpDone = false; } }, true);
  B.act('mpGo', el => go(el.dataset.arg));
  B.act('mpTap', el => { const d = DATA.DEVICES[el.dataset.id]; if (!d) return; if (B.canUse && !B.canUse(d.id)) return B.toast('Accès réservé', 'lock'); const s = dev(d.id), on = !isOn(d); setDev(d.id, d.type === 'group' && on && !s.lit ? { on, lit: s.n } : { on }); });
  B.act('mpLight', el => { P.light = el.dataset.id; go('light'); });
  B.act('mpBriLive', el => { el.style.setProperty('--p', el.value + '%'); const em = el.parentNode.querySelector('em'); if (em) em.textContent = el.value + ' %'; P.last = Date.now(); });
  B.act('mpBri', el => setDev(el.dataset.id, { on: true, bri: +el.value }));
  B.act('mpCt', el => setDev(el.dataset.id, { on: true, ct: +el.dataset.arg }));
  B.act('mpColor', el => setDev(el.dataset.id, { on: true, color: el.dataset.arg }));
  B.act('mpHalf', el => { setDev(el.dataset.id, { pos: 50 }); });
  B.act('mpScene', el => {
    const r = roomBy((panel() || {}).room); if (!r) return;
    if (el.dataset.arg === 'read') lightsOf(r).forEach((d, i) => setDev(d.id, { on: i === 0 || lightsOf(r).length === 1, bri: 40, ct: 2700 }));
    else { setRoomLights(r, false); coversOf(r).forEach(d => B.ACT.cover({ dataset: { id: d.id, arg: 'down' } })); }
  });
  B.act('mpWake', async el => {
    const w = P.wake; P.wake = null; go('main');
    if (w && srv()) try { await B.Server.req('/api/extra/wake', el.dataset.arg === 'up' ? { id: w.id, stop: true, up: true } : { id: w.id, snooze: 10 }); } catch (e) { B.toast(e.message, 'info'); }
    if (el.dataset.arg === 'snooze') B.toast('Je vous réveille dans 10 minutes', 'moon');
  });
  // sortir du panneau : appui long (2,5 s) sur le nom de la pièce, avec le code d'un parent
  B.act('mpExit', () => {
    const admins = S.users.filter(u => u.admin && u.pin);
    if (admins.length) { const p = prompt('Code d’un parent'); if (p == null) return; if (!admins.some(u => String(u.pin) === p)) return B.toast('Code incorrect', 'lock'); }
    B.screenCfg && B.screenCfg();
  });
  // inactivité : retour à la pièce, et écran de nuit aux heures de nuit
  setInterval(() => {
    if (!panel() || B.current !== 'panneau' || document.querySelector('.modal')) return;
    const idle = Date.now() - P.last;
    if (P.view === 'wake') { if (idle > 40 * 6e4) go('main'); return; }
    if (nightNow() && idle > 60e3 && P.view !== 'night') go('night');
    else if (!nightNow() && P.view === 'night') go('main');
    else if (idle > 90e3 && !['main', 'night'].includes(P.view)) go('main');
  }, 10000);
  // réveil en douceur qui concerne cette pièce (ses lumières ou ses volets) ou l'enfant de la chambre
  B.on && B.on('nas', ev => {
    const p = panel(); if (!p || ev.type !== 'wakestart') return;
    const r = roomBy(p.room), u = kidUser(); if (!r) return;
    const ids = r.devs.map(d => d.id);
    if ((ev.lights || []).concat(ev.covers || []).some(id => ids.includes(id)) || (u && ev.who === u.name)) { P.wake = { id: ev.id, name: ev.name }; go('wake'); }
  });

  /* ---------- réglages dans « Cet écran » ---------- */
  const se0 = B.screenExtra;
  B.screenExtra = c => {
    const p = c.panel || {}, list = rooms().filter(r => r.devs.length), kids = S.users.filter(u => u.child || !u.admin);
    const opt = (v, l, cur) => '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(l) + '</option>';
    const ph = c.phome || {}, favR = phRooms().map(r => r.key), favC = phCams();
    return '<div class="tbbox"><b>' + ico('rooms') + 'Panneau mural d’une pièce</b><p class="muted" style="font-size:12.5px;margin:4px 0 8px">Petit écran fixé au mur (DotStarTech Wall Panel, 4″) : il n’affiche que sa pièce. Pour en sortir : appui long sur le nom de la pièce, puis le code d’un parent.</p>' +
      '<label class="field">Pièce<select data-change="mpRoom">' + opt('', '— non, écran normal —', p.room || '') + list.map(r => opt(r.key, r.label + ((B.floor && B.floor(r.floor)) ? ' (' + B.floor(r.floor).name + ')' : ''), p.room || '')).join('') + '</select></label>' +
      (p.room ? '<label class="field">Chambre d’enfant (missions, jamais la sonnette)<select data-change="mpKid">' + opt('', '— non —', p.kid || '') + kids.map(u => opt(u.id, u.name, p.kid || '')).join('') + '</select></label>' +
        '<label class="field">Sonnette sur ce panneau<select data-change="mpRing">' + opt('auto', 'Automatique : seulement si la lumière est allumée ou le volet ouvert', p.ring || 'auto') + opt('always', 'Toujours', p.ring || 'auto') + opt('never', 'Jamais', p.ring || 'auto') + '</select></label>' : '') + '</div>' +
      '<div class="tbbox"><b>' + ico('homeFill') + 'Accueil vertical (tablette debout, iPhone)</b><div class="field">Pièces affichées (4)<div class="scpins">' + rooms().filter(r => lightsOf(r).length).map(r => '<button class="pinc' + (favR.includes(r.key) ? ' on' : '') + '" data-act="phPinRoom" data-arg="' + esc(r.key) + '">' + esc(r.label) + '</button>').join('') + '</div></div>' +
      '<div class="field">Caméras affichées (2)<div class="scpins">' + Object.keys(DATA.CAMS).map(id => '<button class="pinc' + (favC.includes(id) ? ' on' : '') + '" data-act="phPinCam" data-arg="' + id + '">' + esc(DATA.CAMS[id].name) + '</button>').join('') + '</div></div><p class="muted" style="font-size:12.5px;margin:0">Les 4 raccourcis sont ceux de la page Raccourcis.</p></div>' +
      (se0 ? se0(c) : '');
  };
  const upd = f => { const c = cfg(); f(c); setCfg(c); window.dispatchEvent(new Event('resize')); B.show(); if (B.screenCfg && document.querySelector('.scmodal')) B.screenCfg(); };
  B.act('mpRoom', el => upd(c => { if (el.value) c.panel = Object.assign({ ring: 'auto', kid: '' }, c.panel, { room: el.value }); else delete c.panel; P.view = 'main'; }));
  B.act('mpKid', el => upd(c => { c.panel.kid = el.value; }));
  B.act('mpRing', el => upd(c => { c.panel.ring = el.value; }));
  const pin = (k, n, cur) => el => upd(c => { const ph = c.phome = c.phome || {}, l = (ph[k] && ph[k].length ? ph[k] : cur()).slice(), i = l.indexOf(el.dataset.arg); if (i >= 0) l.splice(i, 1); else { if (l.length >= n) l.shift(); l.push(el.dataset.arg); } ph[k] = l; });
  B.act('phPinRoom', pin('rooms', 4, () => phRooms().map(r => r.key)));
  B.act('phPinCam', pin('cams', 2, phCams));
})();

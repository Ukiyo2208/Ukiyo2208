/* Bêta OS — composants (chrome, tuiles d'appareils, caméras, médias) */
(function () {
  const B = window.BOS, { S, DATA, esc, F, dev, setDev, T, RENDER, act, WX, Music } = B;
  const px = (x, y, w, h) => 'left:' + x + 'px;top:' + y + 'px;width:' + w + 'px;height:' + h + 'px';
  /* boîte en coordonnées de maquette : [x0,y0,x1,y1] (relatives à un parent optionnel) */
  const box = (r, p) => px(r[0] - (p ? p[0] : 0), r[1] - (p ? p[1] : 0), r[2] - r[0], r[3] - r[1]);
  const guest = () => S.user === 'guest';

  /* ---------- navigation ---------- */
  const NAV = [
    ['accueil', 'Accueil', 'home', 'homeFill'],
    ['exterieur', 'Extérieur', 'tree', 'treeFill'],
    ['rdc', 'RDC', 'rdc', 'homeFill'],
    ['etage1', 'Étage 1', 'floor1', 'homeFill'],
    ['etage2', 'Étage 2', 'floor2', 'homeFill'],
    ['energie', 'Énergie', 'bolt', 'bolt'],
    ['musique', 'Musique', 'music', 'musicFill'],
    ['plex', 'Plex', 'plexOutline', 'plex'],
    ['nas', 'NAS', 'nas', 'nas'],
    ['calendrier', 'Calendrier', 'calendar', 'calendar'],
    ['mails', 'Mails', 'mail', 'mail'],
    ['ia', 'Bêta IA', 'ai', 'ai'],
    ['routines', 'Routines', 'wand', 'wand'],
    ['pieces', 'Pièces', 'rooms', 'rooms', 'noside'],
    ['journal', 'Journal', 'journal', 'journal', 'noside'],
    ['connexions', 'Connexions', 'link', 'link', 'noside'],
    ['parametres', 'Paramètres', 'gear', 'gearFill']
  ];
  const GUEST_HIDE = ['nas', 'calendrier', 'mails', 'parametres'];
  const navItems = () => (B.navList ? B.navList(NAV) : NAV).filter(n => !(guest() && GUEST_HIDE.includes(n[0])));
  const unread = () => S.mails.filter(m => !m.read).length;
  const badgeHTML = id => id === 'mails' && unread() ? '<span class="badge">' + unread() + '</span>' : '';

  function side(active) {
    return '<aside class="side">' +
      '<button class="burger" data-act="lock" title="Verrouiller">' + ico('menu') + '</button><nav>' +
      navItems().filter(n => !n[4]).map(n => '<a href="#' + n[0] + '" class="' + (n[0] === active ? 'on' : '') + '">' + ico(n[0] === active ? n[3] : n[2]) + '<span>' + n[1] + '</span>' + badgeHTML(n[0]) + '</a>').join('') +
      '</nav><button class="sside" data-act="search" title="Rechercher (Ctrl + K)">' + ico('search2') + '<span>Chercher</span></button><div class="seal">' + toriiSVG('', true) + '<b>家</b><b>夜</b></div></aside>' + dock(active) + fluidTop();
  }
  /* dock mobile : raccourcis essentiels + bouton Bêta IA central */
  function dock(active) {
    const main = ['accueil', 'rdc', 'etage1', 'musique'], more = navItems().filter(n => !main.includes(n[0]) && n[0] !== 'ia');
    const it = n => '<a href="#' + n[0] + '" class="' + (n[0] === active ? 'on' : '') + '">' + ico(n[0] === active ? n[3] : n[2]) + '<span>' + n[1] + '</span>' + badgeHTML(n[0]) + '</a>';
    const m = main.map(id => NAV.find(n => n[0] === id));
    return '<nav class="dock">' + it(m[0]) + it(m[1]) + '<button class="iafab" data-act="iaOpen" aria-label="Parler à Bêta IA">' + brainSVG() + '</button>' + it(m[2]) +
      '<button data-act="moreNav" class="' + (more.some(n => n[0] === active) ? 'on' : '') + '">' + ico('grid9') + '<span>Plus</span>' + (unread() ? '<span class="badge">' + unread() + '</span>' : '') + '</button></nav>';
  }
  act('moreNav', el => {
    const main = ['accueil', 'rdc', 'etage1'];
    B.modal('<h2>' + ico('grid9') + 'Toutes les pages</h2><div class="navgrid">' + navItems().filter(n => !main.includes(n[0])).map(n => '<a href="#' + n[0] + '" class="tile" data-act="closeModalNav">' + ico(n[3]) + '<span>' + n[1] + '</span>' + badgeHTML(n[0]) + '</a>').join('') +
      '<button class="tile" data-act="lock">' + ico('lock') + '<span>Verrouiller</span></button></div>', 'sm sheet');
  });
  act('closeModalNav', el => { B.closeModal(); location.hash = el.getAttribute('href').slice(1); });
  /* en-tête mobile : logo + météo + accès IA */
  function fluidTop() {
    return '<div class="ftop">' + '<a href="#accueil" class="logo">' + toriiSVG('torii') + '<span class="word"><span class="name">Bêta <span>OS</span></span></span></a>' +
      '<div class="fright"><button class="fsearch" data-act="search" aria-label="Rechercher">' + ico('search2') + '</button>' + T({ t: 'wxchip', keys: ['weather', 'clock'] }) + '</div></div>';
  }
  RENDER.wxchip = () => '<button class="wxchip" data-act="weather" aria-label="Météo">' + ico(B.wxIcon(WX.now.code, B.isNight())) + '<b>' + WX.now.temp + '°</b>' + (B.wxAlerts().length || (B.haAlert && B.haAlert()) ? ico('alert', 'wa') : '') + '<span>' + F.time(new Date()) + '</span></button>';

  function logo(style, small) {
    return '<a href="#accueil" class="logo abs hide-fluid ' + (small ? '' : 'big') + '" style="' + style + '">' + toriiSVG('torii') +
      '<span class="word"><span class="name">Bêta <span>' + (small ? 'OS' : 'os') + '</span></span><span class="tag">MAISON INTELLIGENTE</span></span></a>';
  }
  /* badge d'icône (pastille dégradée) pour les titres de widgets */
  const BADGES = {
    users: ['family', '#2fd3ff', '#1d5bff'], weather: ['cloudMoon', '#7aa8ff', '#3b3bd6'], cal: ['calendar', '#ff9a4a', '#ff4f8b'], mail: ['mail', '#2fb6ff', '#2a5bff'],
    energy: ['boltPlain', '#2ff0b0', '#0fa0ff'], cam: ['camera', '#ff5f7e', '#b03bff'], music: ['musicFill', '#2fe0ff', '#7a5bff'], plex: ['plex', '#ffd23a', '#f08a12'],
    nas: ['nas', '#5fe7ff', '#2a6bff'], ia: ['ai', '#c06bff', '#36c6ff'], solar: ['solar', '#ffd23a', '#ff8a34'], heart: ['heartFill', '#ff6fae', '#ff3d6e'],
    radio: ['radio', '#ff5f7e', '#ff9a4a'], link: ['link', '#2fe0ff', '#1f7dff'], gear: ['gearFill', '#9fb4d8', '#4a6aa8'], home: ['homeFill', '#2fb6ff', '#1d5bff'],
    folder: ['folder', '#ffd23a', '#ff8a34'], shield: ['shieldCheck', '#2ff0b0', '#1f9bff'], download: ['download', '#2fe0ff', '#1f7dff'], film: ['film', '#ffd23a', '#f08a12'],
    battery: ['batteryV', '#2ff0b0', '#12a07a'], chart: ['chart', '#ff6fae', '#7a5bff'], power: ['power', '#2fe0ff', '#1f7dff'], edit: ['edit', '#9b6bff', '#2f7dff']
  };
  function badge(k, sz) { const b = BADGES[k] || BADGES.home; return '<span class="bdg" style="--g1:' + b[1] + ';--g2:' + b[2] + (sz ? ';--s:' + sz + 'px' : '') + '">' + ico(b[0]) + '</span>'; }
  function whead(k, title, right) { return '<div class="whead">' + badge(k) + '<h2>' + title + '</h2>' + (right || '') + '</div>'; }

  /* en-tête commun des pages intérieures */
  function header(o) {
    const nav = ['accueil', 'exterieur', 'rdc', 'etage1', 'etage2', 'energie', 'musique', 'plex', 'nas', 'calendrier', 'mails'];
    const q = o.quickBox || [1140, 120, 1520, 206];
    return logo(px(108, 14, 236, 66), true) +
      '<nav class="topnav glass abs" style="' + px(345, 20, 910, 50) + '">' +
      nav.filter(n => !(guest() && GUEST_HIDE.includes(n)) && !(B.navHidden && B.navHidden(n))).map(id => { const n = NAV.find(x => x[0] === id); return '<a href="#' + id + '" class="' + (id === o.id ? 'on' : '') + '">' + ico(id === o.id ? n[3] : n[2]) + n[1] + '</a>'; }).join('') +
      '</nav>' +
      T({ t: 'topicons', keys: ['mails', 'ha', 'music'] }) +
      T({ t: 'clockbox', keys: ['clock'] }) +
      '<div class="ptitle glass abs" style="' + box(o.titleBox || [105, 100, 500, 192]) + '">' + ico(o.icon || 'homeFill', 'pi' + (o.icon === 'treeFill' ? ' tree' : '')) +
      '<div><h1>' + esc(o.title) + '</h1><p>' + esc(o.sub) + '</p></div></div>' +
      T({ t: 'wxcard', keys: ['weather'], style: box(o.wxBox || [605, 85, 998, 205]) }) +
      (o.info ? T(Object.assign({ style: box(q) }, o.info)) : T({ t: 'quick', items: o.quick, style: box(q), keys: ['house'] }));
  }
  RENDER.topicons = () => '<div class="topicons glass abs hide-fluid" style="' + px(1262, 20, 120, 50) + '">' +
    '<button data-act="notifs" title="Notifications">' + ico('bellFill') + (unread() ? '<span class="badge">' + unread() + '</span>' : '') + '</button>' +
    '<a href="#routines" title="Routines" class="rtop">' + ico('wand') + '</a>' +
    '<button data-act="iaOpen" title="Parler à Bêta IA" class="iatop">' + brainSVG() + '</button></div>';
  RENDER.clockbox = () => { const d = new Date(); return '<div class="clockbox glass abs hide-fluid" style="' + px(1388, 18, 137, 54) + '"><span class="t">' + F.time(d) + '</span><span class="d">' + F.short(d) + '</span></div>'; };

  function wxDays(n) {
    return WX.days.slice(0, n || 3).map((d, i) => {
      const dt = new Date(Date.now() + (i + 1) * 864e5);
      const ic = B.wxIcon(d.code, false);
      return '<div class="wxday">' + ico(ic === 'sun' ? 'sun' : ic, ic === 'sun' ? '' : 'c') + '<span>' + F.d3(dt) + '</span><span>' + d.max + '° / ' + d.min + '°</span></div>';
    }).join('');
  }
  RENDER.wxcard = s => '<div class="wxcard glass abs" style="' + s.style + '" data-act="weather" role="button" tabindex="0"><div class="now"><div class="loc">' + ico('pinFill') + esc(S.settings.city) + '</div>' +
    ico(B.wxIcon(WX.now.code, B.isNight()), 'big') + '<div class="temp">' + WX.now.temp + '°C</div><div class="cond">' + B.wxText(WX.now.code) + '</div></div>' + (B.wxAlerts().length || (B.haAlert && B.haAlert()) ? '<span class="wxwarn" title="Alerte météo">' + ico('alert') + '</span>' : '') +
    '<div class="days">' + wxDays(3) + '</div></div>';

  /* actions rapides */
  RENDER.quick = s => '<div class="quick glass abs" style="' + s.style + '">' + s.items.map(k => { const q = SCENES[k]; return '<button class="' + (q.cls || '') + (q.active && q.active() ? ' active' : '') + '" data-act="scene" data-arg="' + k + '">' + ico(q.icon) + '<span>' + q.short + '</span></button>'; }).join('') + '</div>';
  /* bloc d'informations (à la place des actions rapides) */
  RENDER.infobox = s => '<div class="quick infobox glass abs" style="' + s.style + '">' + s.items().map(i => '<div' + (i.go ? ' data-act="goto" data-arg="' + i.go + '" role="button"' : '') + ' class="' + (i.cls || '') + '">' + ico(i.icon) + '<b>' + i.v + '</b><span>' + i.l + '</span></div>').join('') + '</div>';

  /* barre Bêta IA : question libre, réponse en bulle, dictée, raccourcis optionnels */
  function iabar(style, chips) {
    return '<div class="iabar card abs' + (chips && chips.length ? '' : ' nochips') + '" style="' + style + '">' +
      '<button class="who" data-act="iaOpen" title="Ouvrir la conversation">' + brainSVG() + '<span>Bêta IA</span></button>' +
      '<form data-submit="ia">' + ico('sparkle') + '<input name="q" placeholder="Demandez-moi… « éteins le salon »" autocomplete="off" enterkeyhint="send" aria-label="Demander à Bêta IA">' +
      '<button type="button" class="mic" data-act="mic" title="Dicter">' + ico('mic') + '</button><button class="send" aria-label="Envoyer">' + ico('send') + '</button></form>' +
      (chips && chips.length ? '<div class="chips">' + chips.map(k => { const q = SCENES[k]; return '<button class="chip" data-act="scene" data-arg="' + k + '">' + ico(q.icon, q.chip || '') + '<span>' + q.label + '</span></button>'; }).join('') + '</div>' : '') +
      '<div class="iareply" hidden></div></div>';
  }

  /* ---------- scènes / actions groupées ---------- */
  const isType = (id, ...t) => DATA.DEVICES[id] && t.includes(DATA.DEVICES[id].type);
  const ids = (prefix, ...types) => Object.keys(DATA.DEVICES).filter(id => (prefix === '' || (B.floorOf ? B.floorOf(id) + '.' === prefix : id.startsWith(prefix))) && isType(id, ...types) && !(S.custom && S.custom.hidden[id]));
  const HOUSE_COVERS = () => ['e1.', 'e2.', 'rdc.'].flatMap(p => ids(p, 'cover')).filter(id => id !== 'rdc.garage.door');
  function lightsOff(prefix) { ids(prefix, 'light', 'group').forEach(id => setDev(id, { on: false })); }
  function covers(list, pos) { list.forEach(id => setDev(id, { pos })); }
  const allOff = prefix => () => ids(prefix, 'light', 'group').every(id => !dev(id).on);
  const allClosed = list => () => list().every(id => dev(id).pos === 0);
  function floorCovers(p) { return () => ids(p, 'cover').filter(id => id !== 'rdc.garage.door' && id !== 'ext.store'); }
  function soir(p) {
    covers(floorCovers(p)(), 0);
    ids(p, 'light').forEach(id => { const d = DATA.DEVICES[id]; if (/amb|rgb|Applique/i.test(d.name + (d.def.rgb ? 'rgb' : ''))) setDev(id, Object.assign({ on: true }, d.def.rgb ? { color: '#ff9a4a' } : {})); else setDev(id, { on: false }); });
    S.mode = 'soir'; B.emit('house');
  }
  function jour(p) { covers(floorCovers(p)(), 100); lightsOff(p); S.mode = 'jour'; B.emit('house'); }
  const SCENES = {
    'off:e1': { icon: 'power', short: 'Tout éteindre', label: 'Tout éteindre étage 1', cls: '', chip: '', run: () => lightsOff('e1.'), active: allOff('e1.'), msg: 'Lumières de l’étage 1 éteintes' },
    'cov:e1': { icon: 'blinds', short: 'Volets fermés', label: 'Ferme les volets étage 1', chip: 'w', run: () => covers(floorCovers('e1.')(), 0), active: allClosed(floorCovers('e1.')), msg: 'Volets de l’étage 1 fermés' },
    'off:e2': { icon: 'power', short: 'Tout éteindre', label: 'Tout éteindre étage 2', run: () => lightsOff('e2.'), active: allOff('e2.'), msg: 'Lumières de l’étage 2 éteintes' },
    'cov:e2': { icon: 'blinds', short: 'Volets fermés', label: 'Ferme les volets étage 2', chip: 'w', run: () => covers(floorCovers('e2.')(), 0), active: allClosed(floorCovers('e2.')), msg: 'Volets de l’étage 2 fermés' },
    'off:rdc': { icon: 'power', short: 'Tout éteindre', label: 'Tout éteindre RDC', run: () => lightsOff('rdc.'), active: allOff('rdc.'), msg: 'Lumières du rez-de-chaussée éteintes' },
    'cov:rdc': { icon: 'blinds', short: 'Volets fermés', label: 'Ferme les volets RDC', chip: 'w', run: () => covers(floorCovers('rdc.')(), 0), active: allClosed(floorCovers('rdc.')), msg: 'Volets du RDC fermés' },
    'soir:e1': { icon: 'moon', short: 'Mode soir', label: 'Mode soirée', cls: 'c', chip: 'w', run: () => soir('e1.'), msg: 'Ambiance soirée : volets fermés, lumières tamisées' },
    'jour:e1': { icon: 'sun2', short: 'Mode jour', label: 'Mode jour', cls: 'c', chip: 'c', run: () => jour('e1.'), msg: 'Bonne journée ! Volets ouverts, lumières éteintes' },
    'soir:e2': { icon: 'moon', short: 'Mode soir', label: 'Mode soirée', cls: 'c', chip: 'w', run: () => soir('e2.'), msg: 'Ambiance soirée : volets fermés, lumières tamisées' },
    'jour:e2': { icon: 'sun2', short: 'Mode jour', label: 'Mode jour', cls: 'c', chip: 'c', run: () => jour('e2.'), msg: 'Bonne journée ! Volets ouverts, lumières éteintes' },
    'soir:rdc': { icon: 'moon', short: 'Mode soir', label: 'Mode soirée', cls: 'c', chip: 'w', run: () => soir('rdc.'), msg: 'Ambiance soirée : volets fermés, lumières tamisées' },
    'jour:rdc': { icon: 'sun2', short: 'Mode jour', label: 'Mode jour', cls: 'c', chip: 'c', run: () => jour('rdc.'), msg: 'Bonne journée ! Volets ouverts, lumières éteintes' },
    'vac:start': { icon: 'robotFill', short: 'Nettoyage', label: 'Démarrer le nettoyage', chip: 'c', run: () => setDev('rdc.robot', { status: 'cleaning' }), msg: 'L’aspirateur part faire le ménage' },
    'off:ext': { icon: 'leafFill', short: 'Tout éteint', label: 'Tout éteindre extérieur', cls: 'g', chip: 'g', run: () => lightsOff('ext.'), active: allOff('ext.'), msg: 'Éclairages extérieurs éteints' },
    'cov:all': { icon: 'blinds', short: 'Volets fermés', label: 'Ferme tous les volets', chip: 'w', run: () => covers(HOUSE_COVERS(), 0), active: allClosed(HOUSE_COVERS), msg: 'Tous les volets sont fermés' },
    'arro:off': { icon: 'dropFill', short: 'Arrosage OFF', label: 'Coupe l’arrosage', cls: 'c', chip: 'c', run: () => setDev('ext.arrosage', { on: false }), active: () => !dev('ext.arrosage').on, msg: 'Arrosage arrêté' },
    'tond:off': { icon: 'mowerRobot', short: 'Tondeuse OFF', label: 'Range la tondeuse', cls: 'g', chip: 'g', run: () => setDev('ext.tondeuse', { status: 'docked' }), active: () => dev('ext.tondeuse').status !== 'mowing', msg: 'La tondeuse rentre à sa base' },
    'store:close': { icon: 'awning', short: 'Store', label: 'Ferme le store banne', chip: 'w', run: () => setDev('ext.store', { pos: 0 }), msg: 'Store banne fermé' },
    'arro:on': { icon: 'dropFill', short: 'Arrosage', label: 'Démarre l’arrosage', chip: 'b', run: () => setDev('ext.arrosage', { on: true }), msg: 'Arrosage lancé pour 10 minutes' },
    'tond:on': { icon: 'mowerRobot', short: 'Tondeuse', label: 'Active la tondeuse', chip: 'g', run: () => setDev('ext.tondeuse', { status: 'mowing' }), msg: 'La tondeuse est partie tondre' },
    'off:all': { icon: 'power', short: 'Tout éteindre', label: 'Tout éteindre la maison', run: () => lightsOff(''), active: allOff(''), msg: 'Toutes les lumières de la maison sont éteintes' },
    'eco': { icon: 'eco', short: 'Mode éco', label: 'Mode éco', cls: 'g', chip: 'g', run: () => { lightsOff('e2.'); ['e1.couloir.clim', 'e2.ch.clim'].forEach(id => setDev(id, { on: false })); }, msg: 'Mode éco : étage 2 éteint, clims secondaires coupées' },
    'plex:open': { icon: 'plex', short: 'Plex', label: 'Ouvre Plex', chip: 'y', run: () => window.open(S.settings.plexUrl, '_blank'), msg: 'Ouverture de Plex' },
    'music:japon': { icon: 'musicFill', short: 'Japon', label: 'Lance ma playlist Japon', chip: 'c', run: () => Music.play('lofi'), msg: 'Lecture : LoFi Japon' }
  };
  act('scene', el => { const q = SCENES[el.dataset.arg]; if (!q) return; q.run(); B.toast(q.msg || q.label, q.icon); });

  /* ---------- tuiles d'appareils ---------- */
  const flex = s => s.f ? ' style="flex:' + s.f + '"' : '';
  RENDER.light = s => {
    const d = dev(s.id), on = d.on, rgb = s.rgb;
    return '<div class="tile t-light' + (on ? ' on' : '') + (rgb ? ' rgb' : '') + '"' + flex(s) + '>' +
      '<span class="bulb" data-act="toggle" data-id="' + s.id + '" role="button" aria-label="Allumer / éteindre">' + ico(on ? 'bulbFill' : 'bulb') + '</span>' +
      '<span class="lbl">' + esc(s.label || DATA.DEVICES[s.id].name) + '</span>' +
      '<button class="sw' + (on ? ' on' : '') + '" data-act="toggle" data-id="' + s.id + '" role="switch" aria-checked="' + on + '" aria-label="' + esc(s.label || DATA.DEVICES[s.id].name) + '"></button>' +
      (rgb ? '<span class="ringwrap"><button class="ring" data-act="color" data-id="' + s.id + '" aria-label="Couleur"></button><span class="dot" style="color:' + (on ? d.color : '#334') + '"></span></span>' : '') +
      '</div>';
  };
  RENDER.clim = s => {
    const d = dev(s.id);
    return '<div class="tile t-ctl"' + flex(s) + '><div class="hd">' + ico('snow') + '<span>' + esc(s.label || 'Climatisation') + '</span></div><div class="row">' +
      '<button class="sq" data-act="clim" data-id="' + s.id + '" data-arg="-0.5" aria-label="Moins">' + ico('minus') + '</button><span class="val">' + (d.on ? d.temp.toFixed(1) + '°C' : 'Arrêt') + '</span>' +
      '<button class="sq" data-act="clim" data-id="' + s.id + '" data-arg="0.5" aria-label="Plus">' + ico('plus') + '</button>' +
      (s.power ? '<button class="pbtn' + (d.on ? '' : ' off') + '" data-act="toggle" data-id="' + s.id + '" aria-label="Marche/arrêt">' + ico('power') + '</button>' : '') + '</div></div>';
  };
  RENDER.cover = s => {
    const d = dev(s.id), st = d.moving || (d.pos >= 100 ? 'up' : d.pos <= 0 ? 'down' : 'stop');
    return '<div class="tile t-ctl"' + flex(s) + '><div class="hd">' + ico(s.icon || 'blindsWin', s.violet ? 'v' : '') + '<span>' + esc(s.label || DATA.DEVICES[s.id].name) + '</span>' + (s.pct ? '<span class="muted" style="margin-left:auto">' + d.pos + '%</span>' : '') + '</div><div class="row">' +
      '<button class="sq' + (st === 'up' ? ' on' : '') + '" data-act="cover" data-id="' + s.id + '" data-arg="up" aria-label="Ouvrir">' + ico('chevU') + '</button>' +
      '<button class="sq stopb' + (st === 'stop' ? ' on' : '') + '" data-act="cover" data-id="' + s.id + '" data-arg="stop" aria-label="Stop">' + ico('stop') + '</button>' +
      '<button class="sq' + (st === 'down' ? ' on' : '') + '" data-act="cover" data-id="' + s.id + '" data-arg="down" aria-label="Fermer">' + ico('chevD') + '</button></div></div>';
  };
  RENDER.power = s => {
    const d = dev(s.id);
    return '<div class="tile t-pow"' + flex(s) + '><div class="hd">' + (s.icon ? ico(s.icon) : '') + '<span>' + esc(s.label || DATA.DEVICES[s.id].name) + '</span></div>' +
      '<button class="pbtn' + (d.on ? '' : ' off') + '" data-act="toggle" data-id="' + s.id + '" aria-label="Marche/arrêt">' + ico('power') + '</button></div>';
  };
  RENDER.app = s => {
    const d = dev(s.id);
    return '<div class="tile t-app"' + flex(s) + ' data-act="toggle" data-id="' + s.id + '" role="button" tabindex="0"><span class="ai' + (d.on ? '' : ' off') + '">' + ico('power') + '</span><span class="lbl">' + esc(s.label || DATA.DEVICES[s.id].name) + '</span>' +
      '<span class="sub">' + (d.on ? 'En marche · ' + esc(d.prog) : 'Arrêt') + '</span></div>';
  };
  RENDER.camstat = s => {
    const c = camEv(s.cam);
    return '<div class="tile t-stat"' + flex(s) + ' data-act="cam" data-id="' + s.cam + '" role="button" tabindex="0"><div class="hd">' + ico('camHouse') + '<span>' + esc(s.label) + '</span></div><div class="st"><span class="dot ' + c.dot + '"></span><span' + (c.dot ? ' style="color:#fff"' : '') + '>' + c.txt + '</span></div></div>';
  };
  RENDER.media = s => '<div class="tile" style="flex:' + (s.f || 2) + ';display:grid;grid-template-columns:1fr 1.3fr;grid-template-rows:1fr 1fr;gap:6px;padding:8px 10px">' +
    (s.noplex ? '' : '<button class="tile" style="display:flex;align-items:center;gap:12px;padding:0 10px;font-size:14px" data-act="goto" data-arg="plex">' + plexLogo('') .replace('<svg', '<svg style="width:22px;height:22px"') + 'Plex</button>') +
    '<button class="tile" style="display:flex;align-items:center;gap:12px;padding:0 12px;font-size:14px' + (s.noplex ? ';grid-column:1/3;justify-content:center' : '') + '" data-act="musicToggle">' + ico('musicFill', 'cy').replace('class="ico', 'style="font-size:22px;color:#2ed3ff" class="ico') + (Music.playing ? 'En lecture' : 'Musique') + '</button>' +
    '<div style="grid-column:1/3;display:flex;align-items:center;gap:12px;font-size:15px">' + ico('volume').replace('class="ico', 'style="font-size:22px;color:#cfe3ff" class="ico') +
    '<input type="range" class="range thin" min="0" max="100" value="' + S.music.vol + '" style="--p:' + S.music.vol + '%" data-input="vol" aria-label="Volume"><span class="pct">' + S.music.vol + '%</span></div></div>';

  /* tuiles de groupe (Extérieur) */
  RENDER.xlight = s => {
    const d = dev(s.id);
    return '<div class="xtile tile abs" style="' + s.style + '"><div class="hd">' + ico(s.icon || 'bulbFill', d.on ? 'yl' : '') + '<b>' + esc(DATA.DEVICES[s.id].name) + '</b><small>' + (d.on ? d.lit : 0) + ' / ' + d.n + ' allumés</small></div>' +
      '<div class="img fade" style="margin-top:8px"><img src="' + s.img + '" alt="" loading="lazy" style="' + (d.on ? '' : 'filter:brightness(.45) saturate(.6)') + '"></div>' +
      '<button class="sw lg' + (d.on ? ' on' : '') + '" data-act="toggle" data-id="' + s.id + '" role="switch" aria-checked="' + d.on + '" aria-label="' + esc(DATA.DEVICES[s.id].name) + '"></button></div>';
  };

  /* ---------- actions appareils ---------- */
  act('toggle', el => {
    const id = el.dataset.id, d = dev(id), on = !d.on;
    const p = { on };
    if (DATA.DEVICES[id].type === 'group' && on && !d.lit) p.lit = d.n;
    setDev(id, p);
  });
  act('clim', el => {
    const id = el.dataset.id, d = dev(id);
    setDev(id, { on: true, temp: Math.max(16, Math.min(30, (d.on ? d.temp : d.temp - +el.dataset.arg) + +el.dataset.arg)) });
  });
  const moveT = {};
  act('cover', el => {
    const id = el.dataset.id, a = el.dataset.arg, d = dev(id);
    clearInterval(moveT[id]);
    if (a === 'stop') { setDev(id, { moving: null }); B.HA.push(id, { moving: 'stop' }); return; }
    const target = a === 'up' ? 100 : 0;
    setDev(id, { moving: a }, { silent: true });
    B.HA.push(id, { pos: target });
    moveT[id] = setInterval(() => {
      const cur = dev(id).pos, step = target > cur ? 10 : -10, n = Math.max(0, Math.min(100, cur + step));
      Object.assign(dev(id), { pos: n });
      if (n === target) { clearInterval(moveT[id]); setDev(id, { pos: n, moving: null }, { silent: true }); }
      else B.emit('dev:' + id);
    }, 160);
  });
  const COLORS = ['#ffb35c', '#ff9a4a', '#fff2d6', '#ffffff', '#ff4f6d', '#ff5fae', '#c25bff', '#7a6bff', '#2f7dff', '#2ed3ff', '#22e3a4', '#b8ff4a'];
  act('color', el => {
    const id = el.dataset.id, d = dev(id);
    B.popover(el, '<b style="font-weight:500">' + esc(DATA.DEVICES[id].room) + ' · couleur</b><div class="sw6">' + COLORS.map(c => '<button style="--c:' + c + '" class="' + (c === d.color ? 'sel' : '') + '" data-act="setColor" data-id="' + id + '" data-arg="' + c + '" aria-label="' + c + '"></button>').join('') + '</div>' +
      '<label class="field">Couleur personnalisée<input type="color" value="' + d.color + '" data-change="setColorInput" data-id="' + id + '"></label>' +
      '<label class="field" style="margin-top:10px">Luminosité<input type="range" class="range thin" min="5" max="100" value="' + (d.bri || 80) + '" style="--p:' + (d.bri || 80) + '%" data-input="bri" data-id="' + id + '"></label>');
  });
  act('setColor', el => { setDev(el.dataset.id, { on: true, color: el.dataset.arg }); B.$$('.pop .sw6 button').forEach(b => b.classList.toggle('sel', b === el)); });
  act('setColorInput', el => setDev(el.dataset.id, { on: true, color: el.value }));
  act('bri', el => { el.style.setProperty('--p', el.value + '%'); dev(el.dataset.id).bri = +el.value; B.save(); });

  /* ---------- caméras ---------- */
  const DET = { person: 'user', car: 'carFill', animal: 'paw', motion: 'motion' };
  function camState(id) { if (!S.cams[id]) S.cams[id] = { det: {} }; if (!S.cams[id].det) S.cams[id].det = {}; return S.cams[id]; }
  function camEv(id) {
    const c = DATA.CAMS[id], ev = (camState(id).ev !== undefined ? camState(id).ev : c.ev);
    if (!ev) return { dot: '', txt: 'Aucun mouvement', icon: '' };
    if (ev.type === 'person') return { dot: 'blue', txt: '<span class="cy">Personne</span> • maintenant', icon: ico('user', 'usr') };
    return { dot: 'red', txt: 'Mouvement • ' + (ev.ago ? 'il y a ' + ev.ago + ' min' : 'maintenant'), icon: ico('walk', 'walk') };
  }
  B.camEv = camEv;
  RENDER.cam = s => {
    const c = DATA.CAMS[s.cam], st = camState(s.cam), ev = camEv(s.cam), img = st.live || c.img;
    const dets = (s.det || c.det).map(k => '<button class="' + (st.det[k] === false ? 'off' : '') + '" data-act="camDet" data-id="' + s.cam + '" data-arg="' + k + '" title="Détection ' + k + '">' + ico(DET[k]) + '</button>').join('');
    const short = s.short && ev.dot === 'red' ? ev.txt.replace('il y a ', '') : '';
    return '<div class="cam ' + (s.tile ? 'tile ' : '') + (s.style ? 'abs' : '') + '" style="' + (s.style || '') + '">' +
      '<div class="shot' + (s.bottom ? ' grad' : '') + '" data-act="cam" data-id="' + s.cam + '" role="button" tabindex="0" aria-label="Voir ' + esc(s.name || c.name) + '"><img src="' + img + '" alt="" loading="lazy">' +
      '<span class="nm' + (s.bottom ? ' bottom' : '') + '">' + esc(s.name || c.name) + '</span>' +
      '<div class="det">' + dets + '</div><div class="fs">' + (c.bell ? '<button data-act="camBell" data-id="' + s.cam + '" title="Notifications">' + ico('bellFill') + '</button>' : '') + '<button data-act="cam" data-id="' + s.cam + '" title="Plein écran">' + ico('expand') + '</button></div></div>' +
      '<div class="stat"><span class="dot ' + ev.dot + '"></span>' + ev.icon + '<span>' + (short || ev.txt) + '</span></div></div>';
  };
  act('camDet', (el, e) => { e.stopPropagation(); const st = camState(el.dataset.id); st.det[el.dataset.arg] = st.det[el.dataset.arg] === false; B.save(); B.emit('cam:' + el.dataset.id); B.toast('Détection ' + ({ person: 'personne', car: 'véhicule', animal: 'animal', motion: 'mouvement' }[el.dataset.arg]) + (st.det[el.dataset.arg] === false ? ' désactivée' : ' activée'), DET[el.dataset.arg]); });
  act('camBell', (el, e) => { e.stopPropagation(); const st = camState(el.dataset.id); st.mute = !st.mute; B.save(); B.toast(st.mute ? 'Notifications coupées' : 'Notifications activées', 'bellFill'); });
  act('cam', el => {
    const id = el.dataset.id, c = DATA.CAMS[id], st = camState(id), ev = camEv(id);
    const live = B.HA.online && B.HA.camUrl ? B.HA.camUrl(id, true) : '';
    B.modal('<h2>' + ico('camera') + esc(c.name) + '</h2><div class="camview"><img src="' + (live || st.live || c.img) + '" alt="' + esc(c.name) + '" onerror="if(this.dataset.f!==\'1\'){this.dataset.f=\'1\';this.src=\'' + c.img + '\'}"><span class="live">LIVE</span><span class="ts" id="camts"></span></div>' +
      '<div class="row" style="margin-top:14px;flex-wrap:wrap"><span class="dot ' + ev.dot + '"></span>' + ev.icon.replace('class="ico', 'style="font-size:18px" class="ico') + '<span>' + ev.txt + '</span><span style="flex:1"></span>' +
      '<button class="btn" data-act="camClear" data-id="' + id + '">' + ico('check') + 'Acquitter</button>' +
      '<button class="btn" data-act="snap" data-id="' + id + '">' + ico('photo') + 'Capture</button>' +
      (c.bell ? '<button class="btn pri" data-act="talk">' + ico('mic') + 'Parler</button>' : '') + '</div>' +
      '<p class="muted" style="font-size:13px;margin:12px 0 0">' + (live || st.live ? 'Flux en direct de Home Assistant (' + esc(B.HA.camEntity ? B.HA.camEntity(id) : c.ha) + ').' : 'Aperçu de démonstration — reliez l’entité <b>' + esc(c.ha) + '</b> dans Paramètres › Home Assistant pour le flux réel.') + '</p>', 'wide');
    const ts = () => { const e2 = document.getElementById('camts'); if (!e2) return clearInterval(t); const d = new Date(); e2.textContent = B.ymd(d) + ' ' + d.toLocaleTimeString('fr-FR'); };
    const t = setInterval(ts, 1000); ts();
  });
  act('camClear', el => { camState(el.dataset.id).ev = null; B.save(); B.emit('cam:' + el.dataset.id); B.closeModal(); B.toast('Événement acquitté'); });
  act('snap', () => B.toast('Capture enregistrée sur le NAS', 'photo'));
  act('talk', () => B.toast('Interphone : micro ouvert (démo)', 'mic'));

  /* ---------- Plex (serveur réel optionnel, sinon bibliothèque de démonstration) ---------- */
  const CATS = [['recent', 'Ajouts récents'], ['films', 'Films'], ['series', 'Séries'], ['anime', 'Anime'], ['favs', 'Favoris']];
  const KIND = { films: 'Film', series: 'Série', anime: 'Anime' };
  const Plex = {
    real: null, loading: false,
    all() { return this.real || DATA.PLEX; },
    list(cat) {
      cat = cat || S.plexCat || 'recent';
      const all = this.all();
      if (cat === 'favs') return all.filter(p => (S.plexFavs || []).includes(p.id));
      if (KIND[cat]) return all.filter(p => p.kind === KIND[cat]);
      return all;
    },
    sel() { const all = this.all(); return all.find(p => p.id === S.plexSel) || all.find(p => p.progress) || all[0]; },
    img(p) { return p.img; },
    async load() {
      const s = S.settings; if (!s.plexServer || !s.plexToken || this.loading) return;
      this.loading = true;
      const base = s.plexServer.replace(/\/+$/, ''), tk = 'X-Plex-Token=' + encodeURIComponent(s.plexToken);
      try {
        const get = async p => { const r = await fetch(base + p + (p.includes('?') ? '&' : '?') + tk, { headers: { Accept: 'application/json' } }); if (!r.ok) throw new Error('HTTP ' + r.status); return (await r.json()).MediaContainer.Metadata || []; };
        const [deck, recent] = await Promise.all([get('/library/onDeck'), get('/library/recentlyAdded?X-Plex-Container-Size=20')]);
        const map = m => ({ id: 'px' + m.ratingKey, key: m.ratingKey, title: m.type === 'episode' ? m.grandparentTitle : m.title, sub: m.type === 'episode' ? 'S' + m.parentIndex + ' · É' + m.index + ' — ' + m.title : '',
          img: base + (m.grandparentThumb && m.type === 'episode' ? m.grandparentThumb : m.thumb) + '?' + tk, kind: m.type === 'movie' ? 'Film' : /anim/i.test((m.Genre || []).map(g => g.tag).join()) ? 'Anime' : 'Série',
          year: m.year || '', dur: m.duration ? Math.round(m.duration / 60000) + ' min' : '', progress: m.viewOffset && m.duration ? Math.round(m.viewOffset / m.duration * 100) : 0, summary: m.summary || '', genre: (m.Genre || []).map(g => g.tag).slice(0, 2).join(', ') });
        const seen = new Set();
        this.real = deck.concat(recent).map(map).filter(p => !seen.has(p.id) && seen.add(p.id));
        this.error = '';
      } catch (e) { this.error = e.message === 'Failed to fetch' ? 'serveur injoignable (réseau ou CORS)' : e.message; }
      this.loading = false; B.emit('plex');
    },
    open(p) {
      const s = S.settings;
      if (p && p.key && s.plexServer) window.open(s.plexServer.replace(/\/+$/, '') + '/web/index.html#!/server/' + (s.plexMachine || '') + '/details?key=%2Flibrary%2Fmetadata%2F' + p.key, '_blank');
      else window.open(s.plexUrl, '_blank');
    }
  };
  B.Plex = Plex;
  function poster(p, cls) {
    const on = S.plexSel === p.id;
    return '<button class="poster' + (on ? ' on' : '') + (cls ? ' ' + cls : '') + '" data-act="plexSel" data-arg="' + p.id + '" title="' + esc(p.title) + '"><img src="' + p.img + '" alt="' + esc(p.title) + '" loading="lazy">' +
      (p.progress ? '<i class="pg"><b style="width:' + p.progress + '%"></b></i>' : '') + (on && S.plexPlaying ? '<span class="pl">' + ico('play') + '</span>' : '') + '</button>';
  }
  B.poster = poster;
  RENDER.plex = s => {
    const sel = Plex.sel(), list = Plex.list().slice(0, 5);
    const cats = CATS.map(c => '<button class="cat' + (S.plexCat === c[0] ? ' on' : '') + '" data-act="plexCat" data-arg="' + c[0] + '">' + c[1] + '</button>').join('');
    const posters = list.length ? list.map(p => poster(p)).join('') : '<p class="muted" style="grid-column:1/6;margin:0;font-size:13px">Rien dans cette catégorie.</p>';
    if (s.v === 'rdc') return '<div class="card abs plex rdc" style="' + s.style + '"><div class="pl"><div class="brand">' + plexLogo() + 'Plex</div><span class="now">' + (S.plexPlaying ? 'En lecture' : 'En pause') + '<b>' + esc(sel.title) + '</b></span></div>' +
      '<div class="pmid"><div class="posters">' + posters + '</div><div class="cats">' + cats + '</div></div>' +
      '<a class="nav" href="#plex" aria-label="Ouvrir la page Plex">' + ico('chevR') + '</a></div>';
    return '<div class="card abs plex" style="' + s.style + '"><div class="pl"><div class="brand">' + plexLogo() + 'Plex</div>' +
      '<div class="where">' + ico('pinFill') + '<span class="cy">' + esc(s.where || S.plexTv || 'Suite parentale - TV') + '</span><span>' + (S.plexPlaying ? 'En lecture' : 'En pause') + ' · ' + esc(sel.title) + '</span></div>' +
      (sel.progress ? '<i class="pgbar"><b style="width:' + sel.progress + '%"></b></i>' : '') + '</div>' +
      '<div class="pmid"><div class="posters">' + posters + '</div><div class="cats">' + cats + '</div></div>' +
      '<a class="nav" href="#plex" aria-label="Ouvrir la page Plex">' + ico('chevR') + '</a></div>';
  };
  act('plexCat', el => { S.plexCat = el.dataset.arg; B.save(); B.emit('plex'); });
  act('plexSel', el => {
    const p = Plex.all().find(x => x.id === el.dataset.arg); if (!p) return;
    if (S.plexSel === p.id && B.current !== 'plex') return B.go('plex');
    S.plexSel = p.id; B.save(); B.emit('plex');
  });
  act('plexPlay', el => {
    const p = Plex.all().find(x => x.id === (el.dataset.arg || S.plexSel)) || Plex.sel();
    S.plexSel = p.id; S.plexPlaying = !(S.plexPlaying && el.dataset.toggle);
    B.save(); B.emit('plex'); B.emit('house');
    B.toast(S.plexPlaying ? '« ' + p.title + ' » sur ' + (S.plexTv || 'Suite parentale - TV') : 'Lecture en pause', S.plexPlaying ? 'play' : 'pause');
  });
  act('plexFav', el => { const id = el.dataset.arg; S.plexFavs = S.plexFavs || []; const i = S.plexFavs.indexOf(id); if (i >= 0) S.plexFavs.splice(i, 1); else S.plexFavs.push(id); B.save(); B.emit('plex'); });
  act('plexOpen', () => Plex.open(Plex.sel()));

  /* ---------- Musique ---------- */
  const SRC = { radio: ['radio', 'Radio'], yt: ['youtube', 'YouTube'], audio: ['nas', 'NAS'] };
  function cover(i, size) {
    if (i.kind === 'radio' && !i.coverLive) return B.radioLogo({ id: i.id, name: i.station }, size);
    return '<img class="mcov" src="' + i.cover + '" alt="" style="width:' + size + 'px;height:' + size + 'px" onerror="this.replaceWith(document.createRange().createContextualFragment(\'<span class=&quot;rlogo&quot; style=&quot;width:' + size + 'px;height:' + size + 'px&quot;>♪</span>\'))">';
  }
  function curInfo() { const i = Music.info(); i.coverLive = i.kind === 'radio' && Music.meta.src === i.id && !!Music.meta.cover; if (i.kind === 'radio' && !i.coverLive) i.cover = ''; return i; }
  B.curInfo = curInfo; B.mcover = cover;
  function srcPill(i) { const s = SRC[i.kind]; return '<span class="spill ' + i.kind + '">' + ico(s[0]) + s[1] + (i.live ? ' · direct' : '') + '</span>'; }
  B.srcPill = srcPill;
  function transport(big) {
    const loading = Music.state === 'loading';
    return '<div class="transport"><button data-act="mPrev" aria-label="Précédent">' + ico('prev') + '</button><button class="pp' + (loading ? ' load' : '') + '" data-act="musicToggle" aria-label="Lecture/pause">' + ico(Music.playing && !loading ? 'pause' : 'play') + '</button><button data-act="mNext" aria-label="Suivant">' + ico('next') + '</button>' +
      '<button class="like' + (Music.isFav(S.music.src) ? ' on' : '') + '" data-act="mLike" aria-label="J’aime">' + ico(Music.isFav(S.music.src) ? 'heartFill' : 'heart') + '</button></div>';
  }
  function volRow() {
    return '<div class="volrow"><button class="mutebtn" data-act="mute" aria-label="' + (S.music.mute ? 'Réactiver le son' : 'Couper le son') + '">' + ico(S.music.mute ? 'volumeOff' : 'volume') + '</button><input type="range" class="range" min="0" max="100" value="' + S.music.vol + '" style="--p:' + S.music.vol + '%" data-input="vol" aria-label="Volume"><span class="pct">' + S.music.vol + '%</span></div>';
  }
  RENDER.music = s => {
    const i = curInfo(), rdc = s.v === 'rdc', cs = rdc ? 84 : 98;
    return '<div class="card abs music' + (rdc ? ' rdc' : '') + '" style="' + s.style + '">' +
      '<a class="mcover" href="#musique" aria-label="Ouvrir la page Musique">' + cover(i, cs) + (Music.playing ? '<span class="eq"><i></i><i></i><i></i></span>' : '') + '</a>' +
      '<div class="minfo"><div class="mtop">' + ico('musicFill', 'mi') + '<span>Musique</span>' + srcPill(i) + '</div><b class="mt">' + esc(i.title) + '</b><span class="ma">' + esc(i.artist) + '</span>' +
      '<button class="zone" data-act="zone">' + ico('speaker') + esc(zoneName()) + ' · ' + S.music.zoneVol + '%</button></div>' +
      '<div class="mctl">' + transport() + volRow() + '</div>' +
      (rdc ? '<div class="outs">' + DATA.OUTPUTS.slice(0, 3).map(o => '<button class="' + (S.music.out === o.id ? 'on' : '') + '" data-act="mOut" data-arg="' + o.id + '">' + ico(o.icon) + '<span>' + o.name + '</span>' + ico('chevR') + '</button>').join('') + '</div>'
        : '<div class="pw"><button class="pbtn lg' + (S.music.power ? '' : ' off') + '" data-act="mPower" aria-label="Marche/arrêt de la zone">' + ico('power') + '</button></div>') + '</div>';
  };
  RENDER.mprog = () => {
    const i = Music.info(), t = Music.time(), d = Music.dur;
    const p = i.live ? 100 : d ? t / d * 100 : 0;
    return '<div class="prog"><span class="tc">' + (i.live ? '<i class="livedot"></i>Direct' : Music.fmt(t)) + '</span><input type="range" class="range thin" min="0" max="100" step=".1" value="' + p + '" style="--p:' + p + '%" data-input="seek" aria-label="Position"' + (i.live || !d ? ' disabled' : '') + '><span class="tc">' + (i.live ? '∞' : d ? Music.fmt(d) : '--:--') + '</span></div>';
  };
  function zoneName() { const o = DATA.OUTPUTS.find(o => o.id === S.music.out); return o ? o.name : 'Suite parentale'; }
  B.zoneName = zoneName;
  act('musicToggle', () => Music.toggle());
  act('mPrev', () => Music.step(-1));
  act('mNext', () => Music.step(1));
  act('mPlay', el => { if (el.dataset.arg === S.music.src && Music.meta.src === S.music.src) Music.toggle(); else Music.play(el.dataset.arg); });
  act('mLike', el => Music.like(el.dataset.arg || S.music.src));
  act('mOut', el => { S.music.out = el.dataset.arg; B.save(); B.emit('music'); B.toast('Le son sort maintenant sur ' + DATA.OUTPUTS.find(o => o.id === el.dataset.arg).name, 'speaker'); });
  act('mPower', () => { S.music.power = !S.music.power; if (!S.music.power && Music.playing) Music.pause(); B.save(); B.emit('music'); });
  act('mute', () => { Music.mute(!S.music.mute); B.emit('music'); });
  act('seek', el => { el.style.setProperty('--p', el.value + '%'); Music.seek(+el.value); });
  act('zone', el => B.popover(el, '<b style="font-weight:500">Où jouer la musique ?</b><div class="outs" style="margin-top:10px">' + DATA.OUTPUTS.map(o => '<button class="' + (S.music.out === o.id ? 'on' : '') + '" data-act="mOut" data-arg="' + o.id + '">' + ico(o.icon) + '<span>' + o.name + '</span>' + ico('chevR') + '</button>').join('') + '</div>' +
    '<label class="field" style="margin-top:12px">Volume de la pièce<input type="range" class="range thin" min="0" max="100" value="' + S.music.zoneVol + '" style="--p:' + S.music.zoneVol + '%" data-input="zoneVol"></label>'));
  act('zoneVol', el => { S.music.zoneVol = +el.value; el.style.setProperty('--p', el.value + '%'); B.save(); clearTimeout(act.zt); act.zt = setTimeout(() => B.emit('music'), 400); });
  act('vol', el => {
    const v = +el.value; Music.vol(v);
    B.$$('[data-input="vol"]').forEach(r => { if (r !== el) r.value = v; r.style.setProperty('--p', v + '%'); const pc = r.parentElement.querySelector('.pct'); if (pc) pc.textContent = v + '%'; });
  });
  act('ytShow', () => { const b = document.getElementById('ytbox'); if (!b || Music.kindOf() !== 'yt') return B.toast('Aucune vidéo YouTube en cours', 'video'); b.classList.toggle('show'); });
  act('mExternal', () => Music.openExternal());

  /* ---------- verrouillage / divers ---------- */
  act('lock', () => { sessionStorage.removeItem('betaos.unlocked'); B.go('verrou'); });
  act('haStatus', () => B.toast(B.HA.enabled() ? (B.HA.online ? 'Home Assistant connecté' : 'Home Assistant : ' + (B.HA.lastError || 'en attente')) : 'Mode démo — Home Assistant non configuré', 'wifi'));

  Object.assign(B, { badge, whead, px, box, side, logo, header, iabar, SCENES, wxDays, NAV, unread, transport, volRow, guest, camState, ids });
})();

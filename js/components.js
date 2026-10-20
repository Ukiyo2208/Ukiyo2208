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
    ['multimedia', 'Multimédia', 'media', 'media'],
    ['nas', 'NAS', 'nas', 'nas'],
    ['calendrier', 'Calendrier', 'calendar', 'calendar'],
    ['mails', 'Mails', 'mail', 'mail'],
    ['ia', 'Bêta IA', 'ai', 'ai'],
    ['parametres', 'Paramètres', 'gear', 'gearFill']
  ];
  const GUEST_HIDE = ['nas', 'calendrier', 'mails', 'parametres'];
  const navItems = () => NAV.filter(n => !(guest() && GUEST_HIDE.includes(n[0])));
  const unread = () => S.mails.filter(m => !m.read).length;

  function side(active) {
    return '<aside class="side">' +
      '<button class="burger" data-act="lock" title="Verrouiller">' + ico('menu') + '</button><nav>' +
      navItems().map(n => '<a href="#' + n[0] + '" class="' + (n[0] === active ? 'on' : '') + '">' + ico(n[0] === active ? n[3] : n[2]) + '<span>' + n[1] + '</span>' +
        (n[0] === 'mails' && unread() ? '<span class="badge">' + unread() + '</span>' : '') + '</a>').join('') +
      '</nav><div class="seal">' + toriiSVG('', true) + '<b>家</b><b>夜</b></div></aside>' + dock(active);
  }
  function dock(active) {
    return '<nav class="dock">' + navItems().map(n => '<a href="#' + n[0] + '" class="' + (n[0] === active ? 'on' : '') + '">' + ico(n[0] === active ? n[3] : n[2]) + '<span>' + n[1] + '</span>' +
      (n[0] === 'mails' && unread() ? '<span class="badge">' + unread() + '</span>' : '') + '</a>').join('') +
      '<a href="#" data-act="lock">' + ico('lock') + '<span>Verrouiller</span></a></nav>';
  }
  function logo(style, small) {
    return '<a href="#accueil" class="logo abs ' + (small ? '' : 'big') + '" style="' + style + '">' + toriiSVG('torii') +
      '<span class="word"><span class="name">Bêta <span>' + (small ? 'OS' : 'os') + '</span></span><span class="tag">MAISON INTELLIGENTE</span></span></a>';
  }

  /* en-tête commun des pages « étage » */
  function header(o) {
    const nav = ['accueil', 'exterieur', 'rdc', 'etage1', 'etage2', 'energie', 'multimedia', 'nas', 'calendrier', 'mails'];
    const q = o.quickBox || [1140, 120, 1520, 206];
    return logo(px(108, 14, 236, 66), true) +
      '<nav class="topnav glass abs" style="' + px(345, 20, 910, 50) + '">' +
      nav.filter(n => !(guest() && GUEST_HIDE.includes(n))).map(id => { const n = NAV.find(x => x[0] === id); return '<a href="#' + id + '" class="' + (id === o.id ? 'on' : '') + '">' + ico(id === o.id ? n[3] : n[2]) + n[1] + '</a>'; }).join('') +
      '</nav>' +
      T({ t: 'topicons', keys: ['mails', 'ha'] }) +
      T({ t: 'clockbox', keys: ['clock'] }) +
      '<div class="ptitle glass abs" style="' + box(o.titleBox || [105, 100, 500, 192]) + '">' + ico(o.icon || 'homeFill', 'pi' + (o.icon === 'treeFill' ? ' tree' : '')) +
      '<div><h1>' + esc(o.title) + '</h1><p>' + esc(o.sub) + '</p></div></div>' +
      T({ t: 'wxcard', keys: ['weather'], style: box(o.wxBox || [605, 85, 998, 205]) }) +
      T({ t: 'quick', items: o.quick, style: box(q), keys: ['house'] });
  }
  RENDER.topicons = () => '<div class="topicons glass abs hide-fluid" style="' + px(1262, 20, 120, 50) + '">' +
    '<a href="#mails" title="Notifications">' + ico('bellFill') + (unread() ? '<span class="badge">' + unread() + '</span>' : '') + '</a>' +
    '<button data-act="haStatus" title="Connexion">' + ico('wifi') + '</button></div>';
  RENDER.clockbox = () => { const d = new Date(); return '<div class="clockbox glass abs hide-fluid" style="' + px(1388, 18, 137, 54) + '"><span class="t">' + F.time(d) + '</span><span class="d">' + F.short(d) + '</span></div>'; };

  function wxDays(n) {
    return WX.days.slice(0, n || 3).map((d, i) => {
      const dt = new Date(Date.now() + (i + 1) * 864e5);
      const ic = B.wxIcon(d.code, false);
      return '<div class="wxday">' + ico(ic === 'sun' ? 'sun' : ic, ic === 'sun' ? '' : 'c') + '<span>' + F.d3(dt) + '</span><span>' + d.max + '° / ' + d.min + '°</span></div>';
    }).join('');
  }
  RENDER.wxcard = s => '<div class="wxcard glass abs" style="' + s.style + '" data-act="weather" role="button" tabindex="0"><div class="now"><div class="loc">' + ico('pinFill') + esc(S.settings.city) + '</div>' +
    ico(B.wxIcon(WX.now.code, B.isNight()), 'big') + '<div class="temp">' + WX.now.temp + '°C</div><div class="cond">' + B.wxText(WX.now.code) + '</div></div>' +
    '<div class="days">' + wxDays(3) + '</div></div>';

  /* actions rapides */
  RENDER.quick = s => '<div class="quick glass abs" style="' + s.style + '">' + s.items.map(k => { const q = SCENES[k]; return '<button class="' + (q.cls || '') + (q.active && q.active() ? ' active' : '') + '" data-act="scene" data-arg="' + k + '">' + ico(q.icon) + '<span>' + q.short + '</span></button>'; }).join('') + '</div>';

  /* barre Bêta IA */
  function iabar(style, chips) {
    return '<div class="iabar card abs" style="' + style + '"><div class="who">' + brainSVG() + 'Bêta IA</div>' +
      '<form data-submit="ia">' + ico('chat') + '<input name="q" placeholder="Posez une question ou demandez une action..." autocomplete="off" aria-label="Demander à Bêta IA"></form>' +
      '<button class="mic" data-act="mic" title="Dicter">' + ico('mic') + '</button><div class="chips">' +
      chips.map(k => { const q = SCENES[k]; return '<button class="chip" data-act="scene" data-arg="' + k + '">' + ico(q.icon, q.chip || '') + '<span>' + q.label + '</span></button>'; }).join('') + '</div></div>';
  }

  /* ---------- scènes / actions groupées ---------- */
  const isType = (id, ...t) => DATA.DEVICES[id] && t.includes(DATA.DEVICES[id].type);
  const ids = (prefix, ...types) => Object.keys(DATA.DEVICES).filter(id => id.startsWith(prefix) && isType(id, ...types));
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
    'off:e1': { icon: 'power', short: 'Tout éteindre', label: 'Tout éteindre étage 1', cls: '', chip: '', run: () => lightsOff('e1.'), active: allOff('e1.'), msg: 'Étage 1 éteint' },
    'cov:e1': { icon: 'blinds', short: 'Volets fermés', label: 'Ferme les volets étage 1', chip: 'w', run: () => covers(floorCovers('e1.')(), 0), active: allClosed(floorCovers('e1.')), msg: 'Volets de l’étage 1 fermés' },
    'off:e2': { icon: 'power', short: 'Tout éteindre', label: 'Tout éteindre étage 2', run: () => lightsOff('e2.'), active: allOff('e2.'), msg: 'Étage 2 éteint' },
    'cov:e2': { icon: 'blinds', short: 'Volets fermés', label: 'Ferme les volets étage 2', chip: 'w', run: () => covers(floorCovers('e2.')(), 0), active: allClosed(floorCovers('e2.')), msg: 'Volets de l’étage 2 fermés' },
    'off:rdc': { icon: 'power', short: 'Tout éteindre', label: 'Tout éteindre RDC', run: () => lightsOff('rdc.'), active: allOff('rdc.'), msg: 'RDC éteint' },
    'cov:rdc': { icon: 'blinds', short: 'Volets fermés', label: 'Ferme les volets RDC', chip: 'w', run: () => covers(floorCovers('rdc.')(), 0), active: allClosed(floorCovers('rdc.')), msg: 'Volets du RDC fermés' },
    'soir:e1': { icon: 'moon', short: 'Mode soir', label: 'Mode soirée', cls: 'c', chip: 'w', run: () => soir('e1.'), msg: 'Mode soirée activé' },
    'jour:e1': { icon: 'sun2', short: 'Mode jour', label: 'Mode jour', cls: 'c', chip: 'c', run: () => jour('e1.'), msg: 'Mode jour activé' },
    'soir:e2': { icon: 'moon', short: 'Mode soir', label: 'Mode soirée', cls: 'c', chip: 'w', run: () => soir('e2.'), msg: 'Mode soirée activé' },
    'jour:e2': { icon: 'sun2', short: 'Mode jour', label: 'Mode jour', cls: 'c', chip: 'c', run: () => jour('e2.'), msg: 'Mode jour activé' },
    'soir:rdc': { icon: 'moon', short: 'Mode soir', label: 'Mode soirée', cls: 'c', chip: 'w', run: () => soir('rdc.'), msg: 'Mode soirée activé' },
    'jour:rdc': { icon: 'sun2', short: 'Mode jour', label: 'Mode jour', cls: 'c', chip: 'c', run: () => jour('rdc.'), msg: 'Mode jour activé' },
    'vac:start': { icon: 'robotFill', short: 'Nettoyage', label: 'Démarrer le nettoyage', chip: 'c', run: () => setDev('rdc.robot', { status: 'cleaning' }), msg: 'Aspirateur robot démarré' },
    'off:ext': { icon: 'leafFill', short: 'Tout éteint', label: 'Tout éteindre extérieur', cls: 'g', chip: 'g', run: () => lightsOff('ext.'), active: allOff('ext.'), msg: 'Extérieur éteint' },
    'cov:all': { icon: 'blinds', short: 'Volets fermés', label: 'Ferme tous les volets', chip: 'w', run: () => covers(HOUSE_COVERS(), 0), active: allClosed(HOUSE_COVERS), msg: 'Tous les volets sont fermés' },
    'arro:off': { icon: 'dropFill', short: 'Arrosage OFF', label: 'Coupe l’arrosage', cls: 'c', chip: 'c', run: () => setDev('ext.arrosage', { on: false }), active: () => !dev('ext.arrosage').on, msg: 'Arrosage coupé' },
    'tond:off': { icon: 'mowerRobot', short: 'Tondeuse OFF', label: 'Range la tondeuse', cls: 'g', chip: 'g', run: () => setDev('ext.tondeuse', { status: 'docked' }), active: () => dev('ext.tondeuse').status !== 'mowing', msg: 'Tondeuse à la base' },
    'store:close': { icon: 'awning', short: 'Store', label: 'Ferme le store banne', chip: 'w', run: () => setDev('ext.store', { pos: 0 }), msg: 'Store banne fermé' },
    'arro:on': { icon: 'dropFill', short: 'Arrosage', label: 'Démarre l’arrosage', chip: 'b', run: () => setDev('ext.arrosage', { on: true }), msg: 'Arrosage démarré (' + 10 + ' min)' },
    'tond:on': { icon: 'mowerRobot', short: 'Tondeuse', label: 'Active la tondeuse', chip: 'g', run: () => setDev('ext.tondeuse', { status: 'mowing' }), msg: 'Tondeuse en route' },
    'off:all': { icon: 'power', short: 'Tout éteindre', label: 'Tout éteindre la maison', run: () => lightsOff(''), active: allOff(''), msg: 'Toute la maison est éteinte' },
    'eco': { icon: 'eco', short: 'Mode éco', label: 'Mode éco', cls: 'g', chip: 'g', run: () => { lightsOff('e2.'); ['e1.couloir.clim', 'e2.jeux.clim', 'e2.bureau.clim'].forEach(id => setDev(id, { on: false })); }, msg: 'Mode éco : clims secondaires et étage 2 coupés' },
    'plex:open': { icon: 'plex', short: 'Plex', label: 'Ouvre Plex', chip: 'y', run: () => window.open(S.settings.plexUrl, '_blank'), msg: 'Ouverture de Plex' },
    'music:japon': { icon: 'musicFill', short: 'Japon', label: 'Lance ma playlist Japon', chip: 'c', run: () => Music.play('lofi'), msg: 'Lecture : LoFi Japon' }
  };
  act('scene', el => { const q = SCENES[el.dataset.arg]; if (!q) return; q.run(); B.toast(q.msg || q.label, q.icon); });

  /* ---------- tuiles d'appareils ---------- */
  const flex = s => s.f ? ' style="flex:' + s.f + '"' : '';
  RENDER.light = s => {
    const d = dev(s.id), on = d.on, rgb = s.rgb;
    return '<div class="tile t-light' + (on ? ' on' : '') + (rgb ? ' rgb' : '') + '"' + flex(s) + '>' +
      '<span data-act="toggle" data-id="' + s.id + '" role="button" aria-label="Basculer">' + ico(on ? 'bulbFill' : 'bulb', 'bulb') + '</span>' +
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
    '<button class="tile" style="display:flex;align-items:center;gap:12px;padding:0 10px;font-size:14px" data-act="scene" data-arg="plex:open">' + plexLogo('') .replace('<svg', '<svg style="width:22px;height:22px"') + 'Plex</button>' +
    '<button class="tile" style="display:flex;align-items:center;gap:12px;padding:0 12px;font-size:14px" data-act="musicToggle">' + ico('musicFill', 'cy').replace('class="ico', 'style="font-size:22px;color:#2ed3ff" class="ico') + (Music.playing ? 'En lecture' : 'Musique') + '</button>' +
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
    B.modal('<h2>' + ico('camera') + esc(c.name) + '</h2><div class="camview"><img src="' + (st.live || c.img) + '" alt="' + esc(c.name) + '"><span class="live">LIVE</span><span class="ts" id="camts"></span></div>' +
      '<div class="row" style="margin-top:14px;flex-wrap:wrap"><span class="dot ' + ev.dot + '"></span>' + ev.icon.replace('class="ico', 'style="font-size:18px" class="ico') + '<span>' + ev.txt + '</span><span style="flex:1"></span>' +
      '<button class="btn" data-act="camClear" data-id="' + id + '">' + ico('check') + 'Acquitter</button>' +
      '<button class="btn" data-act="snap" data-id="' + id + '">' + ico('photo') + 'Capture</button>' +
      (c.bell ? '<button class="btn pri" data-act="talk">' + ico('mic') + 'Parler</button>' : '') + '</div>' +
      '<p class="muted" style="font-size:13px;margin:12px 0 0">' + (st.live ? 'Image fournie par Home Assistant (' + esc(B.HA.entity(id) || c.ha) + ').' : 'Aperçu de démonstration — reliez l’entité <b>' + esc(c.ha) + '</b> dans Paramètres › Home Assistant pour le flux réel.') + '</p>', 'wide');
    const ts = () => { const e2 = document.getElementById('camts'); if (!e2) return clearInterval(t); const d = new Date(); e2.textContent = B.ymd(d) + ' ' + d.toLocaleTimeString('fr-FR'); };
    const t = setInterval(ts, 1000); ts();
  });
  act('camClear', el => { camState(el.dataset.id).ev = null; B.save(); B.emit('cam:' + el.dataset.id); B.closeModal(); B.toast('Événement acquitté'); });
  act('snap', () => B.toast('Capture enregistrée sur le NAS', 'photo'));
  act('talk', () => B.toast('Interphone : micro ouvert (démo)', 'mic'));

  /* ---------- Plex ---------- */
  const CATS = [['films', 'Films'], ['series', 'Séries'], ['anime', 'Anime'], ['recent', 'Ajouts récents'], ['favs', 'Favoris']];
  RENDER.plex = s => {
    const posters = DATA.PLEX.map((p, i) => '<button data-act="plexItem" data-arg="' + i + '" title="' + esc(p.title) + '"><img src="' + p.img + '" alt="' + esc(p.title) + '"></button>').join('');
    const cats = CATS.map(c => '<button class="cat' + (S.plexCat === c[0] ? ' on' : '') + '" data-act="plexCat" data-arg="' + c[0] + '">' + c[1] + '</button>').join('');
    if (s.v === 'rdc') return '<div class="card abs plex rdc" style="' + s.style + ';grid-template-columns:110px 1fr;padding:10px 14px 8px 16px"><div class="pl"><div class="brand">' + plexLogo() + 'Plex</div></div>' +
      '<div style="display:grid;grid-template-columns:24px 1fr 24px;align-items:center;column-gap:10px"><button class="nav" data-act="plexScroll" data-arg="-1" style="color:#2fb6ff;font-size:24px" aria-label="Précédent">' + ico('chevL') + '</button>' +
      '<div class="posters" style="gap:18px">' + posters + '</div><button class="nav" data-act="plexScroll" data-arg="1" style="color:#2fb6ff;font-size:24px" aria-label="Suivant">' + ico('chevR') + '</button>' +
      '<div class="cats" style="grid-column:1/4;margin:6px 0 0 -70px">' + cats + '</div></div></div>';
    return '<div class="card abs plex" style="' + s.style + '"><div class="pl"><div class="brand">' + plexLogo() + 'Plex</div>' +
      '<div class="where">' + ico('pinFill') + '<span class="cy">' + esc(s.where || 'Suite parentale - TV') + '</span><span>' + (S.plexPlaying ? 'En lecture' : 'En pause') + '</span></div></div>' +
      '<div><div class="posters">' + posters + '</div><div class="cats">' + cats + '</div></div>' +
      '<button class="nav" data-act="scene" data-arg="plex:open" aria-label="Ouvrir Plex">' + ico('chevR') + '</button></div>';
  };
  act('plexCat', el => { S.plexCat = el.dataset.arg; B.save(); B.emit('plex'); });
  act('plexScroll', () => { DATA.PLEX.push(DATA.PLEX.shift()); B.emit('plex'); });
  act('plexItem', el => {
    const p = DATA.PLEX[+el.dataset.arg];
    B.modal('<div style="display:grid;grid-template-columns:200px 1fr;gap:22px"><img src="' + p.img + '" alt="" style="width:100%;border-radius:10px;box-shadow:0 0 24px rgba(40,140,255,.4)"><div>' +
      '<h2 style="margin-bottom:6px">' + plexLogo().replace('<svg', '<svg style="width:26px;height:26px"') + esc(p.title) + '</h2><p class="muted">' + p.kind + ' · ' + p.year + ' · ' + p.dur + '</p>' +
      (p.progress ? '<div class="hbar" style="margin:16px 0 6px"><i style="width:' + p.progress + '%"></i></div><small class="muted">Reprendre à ' + p.progress + '%</small>' : '') +
      '<div class="row" style="margin-top:22px;flex-wrap:wrap"><button class="btn pri" data-act="plexPlay" data-arg="' + esc(p.title) + '">' + ico('play') + (p.progress ? 'Reprendre' : 'Lire') + ' sur TV Salon</button><button class="btn" data-act="scene" data-arg="plex:open">' + ico('plex') + 'Ouvrir Plex</button></div></div></div>', 'sm');
  });
  act('plexPlay', el => { S.plexPlaying = true; B.closeModal(); B.emit('plex'); B.emit('house'); B.toast('Plex : « ' + el.dataset.arg + ' » sur TV Salon', 'play'); });

  /* ---------- Musique ---------- */
  function transport(big) {
    return '<div class="transport"><button data-act="mPrev" aria-label="Précédent">' + ico('prev') + '</button><button class="pp" data-act="musicToggle" aria-label="Lecture/pause">' + ico(Music.playing ? 'pause' : 'play') + '</button><button data-act="mNext" aria-label="Suivant">' + ico('next') + '</button></div>';
  }
  function volRow() {
    return '<div class="volrow"><button class="sw sm' + (S.music.mute ? '' : ' on') + '" data-act="mute" role="switch" aria-label="Son"></button><input type="range" class="range" min="0" max="100" value="' + S.music.vol + '" style="--p:' + S.music.vol + '%" data-input="vol" aria-label="Volume"><span class="pct">' + S.music.vol + '%</span></div>';
  }
  function covers2() {
    return '<div class="covers">' + ['lofi', 'chill'].map(id => { const p = S.playlists.find(x => x.id === id); return '<button class="' + (S.music.src === id ? 'on' : '') + '" data-act="mPlay" data-arg="' + id + '"><img src="' + (p.thumb || p.cover) + '" alt="">' + esc(p.name) + '</button>'; }).join('') + '</div>';
  }
  RENDER.music = s => {
    const cur = Music.cur();
    if (s.v === 'rdc') return '<div class="card abs music rdc" style="' + s.style + ';grid-template-columns:160px 1fr 165px;padding:6px 14px 6px 12px">' +
      '<div class="ml"><div class="brand">' + ico('musicFill') + 'Musique</div>' + covers2() + '</div>' +
      '<div class="mc"><div class="zone" data-act="zone" role="button"><b>' + esc(zoneName()) + '</b>' + S.music.zoneVol + '%</div>' + transport() + volRow() + '</div>' +
      '<div class="outs">' + DATA.OUTPUTS.slice(0, 3).map(o => '<button class="' + (S.music.out === o.id ? 'on' : '') + '" data-act="mOut" data-arg="' + o.id + '">' + ico(o.icon) + '<span>' + o.name + '</span>' + ico('chevR') + '</button>').join('') + '</div></div>';
    return '<div class="card abs music" style="' + s.style + '"><div class="ml"><div class="brand">' + ico('musicFill') + 'Musique</div>' + covers2() + '</div>' +
      '<div class="mc"><div class="zone" data-act="zone" role="button"><b>' + esc(s.zone || zoneName()) + '</b>' + S.music.zoneVol + '%<div class="np-title">' + (Music.playing ? '♪ ' + esc(cur.name) : '') + '</div></div>' + transport() + volRow() + '</div>' +
      '<div class="pw"><button class="pbtn lg' + (S.music.power ? '' : ' off') + '" data-act="mPower" aria-label="Marche/arrêt">' + ico('power') + '</button></div></div>';
  };
  function zoneName() { const o = DATA.OUTPUTS.find(o => o.id === S.music.out); return o ? (o.id === 'tv' || o.id === 'spk' ? 'Salon + Enceintes' : o.name) : 'Suite parentale'; }
  act('musicToggle', () => Music.toggle());
  act('mPrev', () => Music.step(-1));
  act('mNext', () => Music.step(1));
  act('mPlay', el => Music.play(el.dataset.arg));
  act('mOut', el => { S.music.out = el.dataset.arg; B.save(); B.emit('music'); B.toast('Sortie audio : ' + DATA.OUTPUTS.find(o => o.id === el.dataset.arg).name, 'speaker'); });
  act('mPower', () => { S.music.power = !S.music.power; if (!S.music.power && Music.playing) Music.pause(); B.save(); B.emit('music'); });
  act('mute', () => { S.music.mute = !S.music.mute; if (Music.audio) Music.audio.muted = S.music.mute; Music.ytCmd(S.music.mute ? 'mute' : 'unMute'); B.save(); B.emit('music'); });
  act('zone', el => B.popover(el, '<b style="font-weight:500">Zone de diffusion</b><div class="outs" style="margin-top:10px">' + DATA.OUTPUTS.map(o => '<button class="' + (S.music.out === o.id ? 'on' : '') + '" data-act="mOut" data-arg="' + o.id + '">' + ico(o.icon) + '<span>' + o.name + '</span>' + ico('chevR') + '</button>').join('') + '</div>' +
    '<label class="field" style="margin-top:12px">Volume de la zone<input type="range" class="range thin" min="0" max="100" value="' + S.music.zoneVol + '" style="--p:' + S.music.zoneVol + '%" data-input="zoneVol"></label>'));
  act('zoneVol', el => { S.music.zoneVol = +el.value; el.style.setProperty('--p', el.value + '%'); B.save(); clearTimeout(act.zt); act.zt = setTimeout(() => B.emit('music'), 400); });
  act('vol', el => {
    const v = +el.value; Music.vol(v);
    B.$$('[data-input="vol"]').forEach(r => { if (r !== el) r.value = v; r.style.setProperty('--p', v + '%'); const pc = r.parentElement.querySelector('.pct'); if (pc) pc.textContent = v + '%'; });
  });

  /* ---------- verrouillage / divers ---------- */
  act('lock', () => { sessionStorage.removeItem('betaos.unlocked'); B.go('verrou'); });
  act('haStatus', () => B.toast(B.HA.enabled() ? (B.HA.online ? 'Home Assistant connecté' : 'Home Assistant : ' + (B.HA.lastError || 'en attente')) : 'Mode démo — Home Assistant non configuré', 'wifi'));

  Object.assign(B, { px, box, side, logo, header, iabar, SCENES, wxDays, NAV, unread, transport, volRow, guest, camState, ids });
})();

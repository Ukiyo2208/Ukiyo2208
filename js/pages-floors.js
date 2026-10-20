/* Bêta OS — pages Étage 1, Étage 2, RDC, Extérieur (fidèles aux maquettes) */
(function () {
  const B = window.BOS, { S, DATA, esc, dev, T, RENDER, box, px } = B;
  const A = 'assets/';
  const cam = o => T(Object.assign({ t: 'cam', keys: ['cam:' + o.cam] }, o));
  const tl = o => T(o);

  /* carte pièce : r = [x0,y0,x1,y1] ; ph = hauteur photo ; tiles = HTML */
  function room(r, o) {
    const ov = (S.rooms || {})[o.title] || {};
    return '<section class="card abs room" style="' + box(r) + '"><div class="chead">' + ico(o.icon, 'ci') + '<h3>' + esc(ov.name || o.title) + '</h3>' +
      '<button class="more" data-act="roomInfo" data-arg="' + esc(o.title) + '" aria-label="Détails">' + ico('chevR') + '</button></div>' +
      '<div class="photo" style="height:' + o.ph + 'px;margin:0 ' + (o.mx || 12) + 'px"><img src="' + (ov.img || o.img) + '" alt="' + esc(ov.name || o.title) + '" loading="lazy"></div>' +
      (o.tiles ? '<div class="tiles" style="height:' + (o.th || 82) + 'px;padding:8px ' + (o.mx || 12) + 'px ' + (o.pb || 10) + 'px">' + o.tiles + '</div>' : '') +
      '</section>';
  }

  /* ===================== ÉTAGE 1 ===================== */
  function etage(id, cfg) {
    return B.side(id) + B.header({ id, title: cfg.title, sub: cfg.sub, icon: 'homeFill', quick: ['off:' + cfg.k, 'cov:' + cfg.k, 'soir:' + cfg.k, 'jour:' + cfg.k] }) +
      room([105, 235, 682, 500], { title: cfg.r[0].t, icon: cfg.r[0].i, img: cfg.r[0].img, ph: 121, mx: 14, tiles:
        tl({ t: 'light', id: cfg.r[0].id + '.light', rgb: true, f: 200 }) + tl({ t: 'clim', id: cfg.r[0].id + '.clim', f: 188 }) + tl({ t: 'cover', id: cfg.r[0].id + '.cover', label: 'Volets', f: 156 }) }) +
      room([690, 235, 1102, 500], { title: cfg.r[1].t, icon: cfg.r[1].i, img: cfg.r[1].img, ph: 123, mx: 12, tiles:
        tl({ t: 'light', id: cfg.r[1].id + '.light', rgb: true, f: 205 }) + tl({ t: 'cover', id: cfg.r[1].id + '.cover', label: 'Volets', f: 180 }) }) +
      room([1112, 235, 1522, 500], { title: cfg.r[2].t, icon: cfg.r[2].i, img: cfg.r[2].img, ph: 123, mx: 12, tiles:
        tl({ t: 'light', id: cfg.r[2].id + '.light', rgb: true, f: 205 }) + tl({ t: 'cover', id: cfg.r[2].id + '.cover', label: 'Volets', f: 180 }) }) +
      room([105, 512, 792, 790], { title: cfg.r[3].t, icon: cfg.r[3].i, img: cfg.r[3].img, ph: 143, mx: 14, th: 80, tiles:
        tl({ t: 'light', id: cfg.r[3].id + '.light', f: 118 }) + tl({ t: 'light', id: cfg.r[3].id + '.amb', f: 140 }) + tl({ t: 'clim', id: cfg.r[3].id + '.clim', power: true, f: 230 }) + tl({ t: 'cover', id: cfg.r[3].id + '.cover', label: 'Volets', f: 150 }) }) +
      room([800, 512, 1232, 792], { title: cfg.r[4].t, icon: cfg.r[4].i, img: cfg.r[4].img, ph: 139, mx: 12, th: 86, tiles:
        tl({ t: 'light', id: cfg.r[4].id + '.light', f: 1 }) + tl({ t: 'media', f: 2.1, keys: ['music'] }) }) +
      room([1240, 512, 1522, 792], { title: cfg.r[5].t, icon: cfg.r[5].i, img: cfg.r[5].img, ph: 153, mx: 12, th: 74, tiles:
        tl({ t: 'light', id: cfg.r[5].id + '.light', f: 1 }) }) +
      tl({ t: 'plex', style: box([105, 798, 792, 932]), keys: ['plex'], where: cfg.plexWhere }) +
      tl({ t: 'music', style: box([800, 798, 1522, 932]), keys: ['music'], zone: cfg.zone }) +
      B.iabar(box([105, 944, 1522, 1012]), ['off:' + cfg.k, 'cov:' + cfg.k, 'soir:' + cfg.k, 'jour:' + cfg.k]);
  }
  B.route('etage1', { title: 'Étage 1', bg: A + 'bg/etage1.jpg', render: () => etage('etage1', {
    k: 'e1', title: 'Étage 1', sub: 'Contrôlez et gérez votre 1er étage', plexWhere: 'Suite parentale - TV',
    r: [
      { t: 'Escalier & Couloir', i: 'stairs', img: A + 'rooms/e1-couloir.jpg', id: 'e1.couloir' },
      { t: 'Chambre 1', i: 'bedFill', img: A + 'rooms/e1-chambre1.jpg', id: 'e1.ch1' },
      { t: 'Chambre 2', i: 'bedFill', img: A + 'rooms/e1-chambre2.jpg', id: 'e1.ch2' },
      { t: 'Suite parentale', i: 'bedFill', img: A + 'rooms/e1-suite.jpg', id: 'e1.suite' },
      { t: 'Salle de bains', i: 'bath', img: A + 'rooms/e1-sdb.jpg', id: 'e1.sdb' },
      { t: 'WC', i: 'toilet', img: A + 'rooms/e1-wc.jpg', id: 'e1.wc' }
    ] }) });
  /* Étage 2 : deux pièces (2 éclairages RGB, 2 volets, 1 climatisation) */
  B.route('etage2', { title: 'Étage 2', bg: A + 'bg/etage1.jpg', render: () => B.side('etage2') +
    B.header({ id: 'etage2', title: 'Étage 2', sub: 'Contrôlez et gérez votre 2e étage', icon: 'homeFill', quick: ['off:e2', 'cov:e2', 'soir:e2', 'jour:e2'] }) +
    room([105, 235, 812, 790], { title: 'Chambre d’amis', icon: 'bedFill', img: A + 'rooms/e2-amis.jpg', ph: 405, mx: 14, th: 92, tiles:
      tl({ t: 'light', id: 'e2.ch.light', rgb: true, f: 1.3 }) + tl({ t: 'cover', id: 'e2.ch.cover', label: 'Volets', f: 1 }) + tl({ t: 'clim', id: 'e2.ch.clim', power: true, f: 1.35 }) }) +
    room([822, 235, 1522, 790], { title: 'Bureau', icon: 'monitor', img: A + 'rooms/e2-jeux.jpg', ph: 405, mx: 14, th: 92, tiles:
      tl({ t: 'light', id: 'e2.bureau.light', rgb: true, f: 1.3 }) + tl({ t: 'cover', id: 'e2.bureau.cover', label: 'Volets', f: 1 }) + T({ t: 'e2sum', f: 1.35, keys: ['house'] }) }) +
    tl({ t: 'plex', style: box([105, 798, 792, 932]), keys: ['plex'], where: 'Salle de jeux - TV' }) +
    tl({ t: 'music', style: box([800, 798, 1522, 932]), keys: ['music'] }) +
    B.iabar(box([105, 944, 1522, 1012]), ['off:e2', 'cov:e2', 'soir:e2', 'jour:e2']) });
  RENDER.e2sum = s => {
    const ids = ['e2.ch.light', 'e2.bureau.light'], on = ids.filter(id => dev(id).on).length, c = dev('e2.ch.clim');
    return '<div class="tile t-stat" style="flex:' + s.f + '"><div class="hd">' + ico('therm') + '<span>Étage 2</span></div><div class="st" style="color:#dfe9fa">' + on + '/2 lumières · clim ' + (c.on ? String(c.temp).replace('.', ',') + ' °C' : 'arrêtée') + '</div></div>';
  };

  /* ===================== RDC ===================== */
  RENDER.vac = s => {
    const d = dev('rdc.robot'), st = { docked: 'En veille', cleaning: 'Nettoyage…', returning: 'Retour base…', zone: 'Nettoyage zone' }[d.status] || 'En veille';
    return '<section class="card abs vac" style="' + s.style + '"><div class="chead">' + ico('robotFill', 'ci') + '<h3>Aspirateur robot</h3><button class="more" data-act="roomInfo" data-arg="Aspirateur robot">' + ico('chevR') + '</button></div>' +
      '<div class="img"><img src="' + A + 'rooms/rdc-robot.jpg" alt="">' +
      '<span class="pill" style="left:6px">' + ico('target') + st + '</span><span class="pill" style="right:8px">' + ico('batteryV') + d.bat + '%</span></div>' +
      '<div class="btns"><button class="tile' + (d.status === 'cleaning' ? ' on' : '') + '" data-act="vac" data-arg="cleaning">' + ico('playCircle') + 'Démarrer</button>' +
      '<button class="tile' + (d.status === 'returning' ? ' on' : '') + '" data-act="vac" data-arg="returning">' + ico('baseHome') + 'Retour base</button>' +
      '<button class="tile' + (d.status === 'zone' ? ' on' : '') + '" data-act="vac" data-arg="zone">' + ico('target') + 'Nettoyage zone</button></div></section>';
  };
  B.act('vac', el => {
    const a = el.dataset.arg, d = dev('rdc.robot');
    B.setDev('rdc.robot', { status: d.status === a ? 'docked' : a });
    if (a === 'returning') setTimeout(() => dev('rdc.robot').status === 'returning' && B.setDev('rdc.robot', { status: 'docked' }, { silent: true }), 6000);
    B.toast({ cleaning: 'Nettoyage démarré', returning: 'Retour à la base', zone: 'Nettoyage de zone' }[a], 'robotFill');
  });
  RENDER.kitchen = s => {
    const ap = dev('rdc.cuisine.applique'), ce = dev('rdc.cuisine.centrale'), dw = dev('rdc.cuisine.dish');
    const mini = (id, d, l) => '<div class="tile" style="flex:1;display:flex;align-items:center;gap:6px;padding:0 6px;font-size:12.5px"><span data-act="toggle" data-id="' + id + '" role="button">' + ico('sun2').replace('class="ico', 'style="font-size:22px;color:' + (d.on ? '#ffd23f' : '#5d7299') + ';' + (d.on ? 'filter:drop-shadow(0 0 6px rgba(255,210,63,.8))' : '') + '" class="ico') + '</span><span style="flex:1">' + l + '</span><button class="sw sm' + (d.on ? ' on' : '') + '" data-act="toggle" data-id="' + id + '" role="switch" aria-label="' + l + '"></button></div>';
    return '<div style="' + s.style + '" class="kit">' +
      '<div style="display:flex;gap:6px;height:36px">' + mini('rdc.cuisine.applique', ap, 'Applique') + mini('rdc.cuisine.centrale', ce, 'Centrale') +
      '<div class="tile" style="flex:.7;display:flex;align-items:center;gap:6px;padding:0 8px;font-size:13px">' + ico('blindsWin').replace('class="ico', 'style="font-size:20px;color:#2ab6ff" class="ico') + 'Volet</div></div>' +
      '<div style="display:flex;gap:6px;height:44px;margin-top:6px">' +
      '<div class="tile t-app" style="flex:1.25;padding:4px 8px" data-act="toggle" data-id="rdc.cuisine.dish" role="button"><span class="ai' + (dw.on ? '' : ' off') + '">' + ico('power') + '</span><span class="lbl">Lave-vaisselle</span><span class="sub">' + (dw.on ? esc(dw.prog) : 'Arrêt') + '</span></div>' +
      '<div class="tile" style="flex:.8;display:flex;align-items:center;justify-content:space-between;padding:0 4px"><button class="sq" style="width:24px;border:0;background:none" data-act="dishProg" data-arg="-1" aria-label="Programme précédent">' + ico('chevL') + '</button><button class="sq stopb" style="width:28px;height:28px" data-act="toggle" data-id="rdc.cuisine.dish" aria-label="Démarrer/arrêter">' + ico('stop') + '</button><button class="sq" style="width:24px;border:0;background:none" data-act="dishProg" data-arg="1" aria-label="Programme suivant">' + ico('chevR') + '</button></div>' +
      '<div class="tile" style="flex:.85;display:flex;align-items:center;justify-content:space-between;padding:0 4px">' + ['up', 'stop', 'down'].map(a => '<button class="sq' + (a === 'stop' ? ' stopb' : '') + '" style="width:28px;height:30px" data-act="cover" data-id="rdc.cuisine.cover" data-arg="' + a + '" aria-label="' + a + '">' + ico(a === 'up' ? 'chevU' : a === 'down' ? 'chevD' : 'stop') + '</button>').join('') + '</div></div></div>';
  };
  const PROGS = ['Éco 50°', 'Intensif 70°', 'Rapide 45°', 'Verres 40°'];
  B.act('dishProg', el => { const d = dev('rdc.cuisine.dish'); const i = (PROGS.indexOf(d.prog) + +el.dataset.arg + PROGS.length) % PROGS.length; B.setDev('rdc.cuisine.dish', { prog: PROGS[i] }, { silent: true }); B.toast('Programme : ' + PROGS[i], 'dishwasher'); });

  B.route('rdc', { title: 'RDC', bg: A + 'bg/rdc.jpg', render: () => {
    const cams = [['cam.rdc-garage', [115, 254, 440, 428]], ['cam.rdc-entree', [455, 254, 788, 428]], ['cam.rdc-salon', [803, 254, 1147, 428]], ['cam.rdc-sejour', [1158, 254, 1510, 428]]];
    const C = [105, 213];
    return B.side('rdc') + B.header({ id: 'rdc', title: 'RDC', sub: 'Contrôlez et gérez votre rez-de-chaussée', icon: 'homeFill', titleBox: [100, 100, 502, 190], wxBox: [620, 85, 1008, 205], quickBox: [1132, 118, 1522, 206], quick: ['off:rdc', 'cov:rdc', 'soir:rdc', 'jour:rdc'] }) +
      '<section class="card abs" style="' + box([105, 213, 1522, 432]) + '"><div class="chead" style="height:42px">' + ico('camera', 'ci') + '<h3>Caméras RDC</h3><button class="more" data-act="allCams" aria-label="Toutes les caméras">' + ico('chevR') + '</button></div>' +
      '<div class="camgrid">' + cams.map(c => cam({ cam: c[0], style: box(c[1], C), tile: true })).join('') + '</div></section>' +
      room([105, 440, 397, 637], { title: 'Garage', icon: 'carFill', img: A + 'rooms/rdc-garage.jpg', ph: 80, mx: 10, th: 66, pb: 8, tiles:
        tl({ t: 'light', id: 'rdc.garage.light', f: 1 }) + tl({ t: 'cover', id: 'rdc.garage.door', icon: 'garage', violet: true, f: 1.4 }) }) +
      room([403, 440, 682, 637], { title: 'Buanderie', icon: 'washer', img: A + 'rooms/rdc-buanderie.jpg', ph: 80, mx: 10, th: 66, pb: 8, tiles:
        tl({ t: 'light', id: 'rdc.buand.light', f: 1 }) + tl({ t: 'app', id: 'rdc.buand.washer', f: 1.3 }) }) +
      room([687, 440, 860, 637], { title: 'WC', icon: 'toilet', img: A + 'rooms/rdc-wc.jpg', ph: 80, mx: 10, th: 66, pb: 8, tiles: tl({ t: 'light', id: 'rdc.wc.light', f: 1 }) }) +
      room([866, 440, 1167, 637], { title: 'Entrée', icon: 'door', img: A + 'rooms/rdc-entree.jpg', ph: 80, mx: 10, th: 66, pb: 8, tiles:
        tl({ t: 'light', id: 'rdc.entree.light', f: 1 }) + tl({ t: 'camstat', cam: 'cam.rdc-entree', label: 'Caméra entrée', f: 1.25, keys: ['cam:cam.rdc-entree'] }) }) +
      '<section class="card abs" style="' + box([1173, 440, 1522, 637]) + '"><div class="chead">' + ico('utensils', 'ci') + '<h3>Cuisine</h3><button class="more" data-act="roomInfo" data-arg="Cuisine">' + ico('chevR') + '</button></div>' +
      '<div class="photo" style="height:63px;margin:0 10px"><img src="' + A + 'rooms/rdc-cuisine.jpg" alt="Cuisine"></div>' +
      tl({ t: 'kitchen', style: 'padding:6px 10px 8px', keys: ['dev:rdc.cuisine.applique', 'dev:rdc.cuisine.centrale', 'dev:rdc.cuisine.dish', 'dev:rdc.cuisine.cover'] }) + '</section>' +
      room([105, 645, 785, 842], { title: 'Salon', icon: 'sofaFill', img: A + 'rooms/rdc-salon.jpg', ph: 77, mx: 12, th: 72, pb: 8, tiles:
        tl({ t: 'light', id: 'rdc.salon.light', f: 113 }) + tl({ t: 'power', id: 'rdc.salon.tv', icon: 'power', f: 84 }) + tl({ t: 'power', id: 'rdc.salon.amp', f: 92 }) + tl({ t: 'power', id: 'rdc.salon.pc', f: 90 }) +
        tl({ t: 'clim', id: 'rdc.salon.clim', f: 145 }) + tl({ t: 'cover', id: 'rdc.salon.cover', f: 115 }) }) +
      room([792, 645, 1202, 842], { title: 'Séjour', icon: 'umbrella', img: A + 'rooms/rdc-sejour.jpg', ph: 77, mx: 10, th: 72, pb: 8, tiles:
        tl({ t: 'light', id: 'rdc.sejour.light', f: 104 }) + tl({ t: 'camstat', cam: 'cam.rdc-sejour', label: 'Caméra séjour', f: 155, keys: ['cam:cam.rdc-sejour'] }) + tl({ t: 'cover', id: 'rdc.sejour.cover', f: 123 }) }) +
      tl({ t: 'vac', style: box([1210, 645, 1522, 842]), keys: ['dev:rdc.robot'] }) +
      tl({ t: 'plex', v: 'rdc', style: box([105, 848, 722, 957]), keys: ['plex'] }) +
      tl({ t: 'music', v: 'rdc', style: box([728, 848, 1522, 957]), keys: ['music'] }) +
      B.iabar(box([100, 963, 1522, 1015]), ['off:rdc', 'cov:rdc', 'soir:rdc', 'vac:start']);
  } });

  /* ===================== EXTÉRIEUR ===================== */
  RENDER.borne = s => {
    const d = dev('ext.borne');
    return '<div class="xtile tile abs tall" style="' + s.style + '"><div class="hd">' + ico('charger') + '<b>Borne de recharge</b><small class="' + (d.on ? 'cy' : 'gr') + '">' + (d.on ? 'En charge' : 'Disponible') + '</small></div>' +
      '<div class="img" style="flex:0 0 92px;margin:14px 0 0"><img src="' + A + 'devices/borne.jpg" alt=""></div>' +
      '<div style="display:flex;justify-content:flex-end;padding:4px 18px 0"><button class="pbtn lg' + (d.on ? '' : ' off') + '" data-act="borne" aria-label="Démarrer la charge" style="margin-top:-10px;' + (d.on ? '' : 'color:#2fc6ff;border-color:rgba(47,198,255,.85);box-shadow:0 0 14px rgba(40,180,255,.55)') + '">' + ico('power') + '</button></div>' +
      '<div style="display:grid;grid-template-columns:34px 1fr;align-items:center;padding:6px 16px 0;margin-top:auto;margin-bottom:22px">' + ico('power').replace('class="ico', 'style="font-size:26px;color:#cfe3ff;grid-row:1/3" class="ico') +
      '<b style="font-size:22px;font-weight:400">' + (d.on ? '7.4' : '0') + ' kW</b><small style="font-size:14.5px;color:#dfe9fa">' + (d.on ? 'Charge en cours · 32 A' : 'Véhicule non connecté') + '</small></div></div>';
  };
  B.act('borne', () => { const d = dev('ext.borne'); B.setDev('ext.borne', { on: !d.on }); B.toast(d.on ? 'Charge arrêtée' : 'Charge démarrée', 'charger'); });
  RENDER.arro = s => {
    const d = dev('ext.arrosage');
    return '<div class="xtile tile abs" style="' + s.style + '"><div class="hd">' + ico('sprinkler') + '<b>Arrosage automatique</b><small class="cy">' + (d.on ? 'ON · ' + d.min + ' min' : 'OFF') + '</small></div>' +
      '<div class="img" data-act="toggle" data-id="ext.arrosage" role="button" style="cursor:pointer"><img src="' + A + 'devices/arrosage.jpg" alt="" style="' + (d.on ? 'filter:saturate(1.3) brightness(1.15)' : '') + '"></div>' +
      '<div class="mins">' + [5, 10, 15].map(m => '<button class="' + (d.on && d.min === m ? 'on' : '') + '" data-act="arro" data-arg="' + m + '">' + m + ' min</button>').join('') + '</div></div>';
  };
  B.act('arro', el => { const m = +el.dataset.arg, d = dev('ext.arrosage'); const on = !(d.on && d.min === m); B.setDev('ext.arrosage', { on, min: m }); B.toast(on ? 'Arrosage ' + m + ' min démarré' : 'Arrosage arrêté', 'dropFill'); });
  RENDER.mower = s => {
    const d = dev('ext.tondeuse');
    return '<div class="xtile tile abs" style="' + s.style + '"><div class="hd">' + ico('mowerRobot', 'gr') + '<b>Tondeuse robot</b><small class="gr">' + (d.status === 'mowing' ? 'En tonte' : 'En veille') + '</small></div>' +
      '<div class="img"><img src="' + A + 'devices/tondeuse.jpg" alt=""></div>' +
      '<button class="pbtn lg" style="position:absolute;right:10px;bottom:14px;z-index:3;background:rgba(6,20,50,.85)" data-act="mowerT" aria-label="Lancer/arrêter">' + ico(d.status === 'mowing' ? 'pause' : 'play') + '</button></div>';
  };
  B.act('mowerT', () => { const d = dev('ext.tondeuse'); const st = d.status === 'mowing' ? 'docked' : 'mowing'; B.setDev('ext.tondeuse', { status: st }); B.toast(st === 'mowing' ? 'Tondeuse démarrée' : 'Tondeuse à la base', 'mowerRobot'); });
  RENDER.store = s => {
    const d = dev('ext.store');
    const st = d.moving ? (d.moving === 'up' ? 'Ouverture…' : 'Fermeture…') : d.pos >= 100 ? 'Ouvert' : d.pos <= 0 ? 'Fermé' : d.pos + '%';
    return '<div class="xtile tile abs" style="' + s.style + '"><div class="hd">' + ico('awning') + '<b>Store banne</b><small class="gr">' + st + '</small></div>' +
      '<div class="img" style="margin:10px 10px 10px;border-radius:6px;overflow:hidden"><img src="' + A + 'devices/store-banne.jpg" alt="" style="object-position:center ' + (100 - d.pos * .7) + '%;' + (d.pos < 10 ? 'filter:brightness(.6)' : '') + '"></div></div>';
  };
  RENDER.storectl = s => {
    const d = dev('ext.store'), st = d.moving || (d.pos >= 100 ? 'up' : d.pos <= 0 ? 'down' : 'stop');
    return '<div class="storectl tile abs" style="' + s.style + '">' + [['up', 'chevU', 'Monter'], ['stop', 'stop', 'Stop'], ['down', 'chevD', 'Descendre']].map(b =>
      '<div><button class="sq' + (b[0] === 'stop' ? ' stopb' : '') + (st === b[0] ? ' on' : '') + '" data-act="cover" data-id="ext.store" data-arg="' + b[0] + '" aria-label="' + b[2] + '">' + ico(b[1]) + '</button>' + b[2] + '</div>').join('') + '</div>';
  };

  B.route('exterieur', { title: 'Extérieur', bg: A + 'bg/ext.jpg', render: () => {
    const cams = [['cam.cour-garage', [120, 288, 445, 520]], ['cam.cour', [460, 288, 790, 520]], ['cam.sonnette', [805, 288, 1137, 520]], ['cam.jardin', [1150, 288, 1507, 520]]];
    const C = [105, 240], Co = [105, 545], J = [585, 545], Te = [1085, 545];
    return B.side('exterieur') + B.header({ id: 'exterieur', title: 'Extérieur', sub: 'Contrôlez et surveillez vos espaces extérieurs', icon: 'treeFill', titleBox: [105, 105, 497, 200], wxBox: [588, 92, 1000, 222], quickBox: [1075, 150, 1522, 232], quick: ['off:ext', 'cov:all', 'arro:off', 'tond:off'] }) +
      '<section class="card abs" style="' + box([105, 240, 1522, 527]) + '"><div class="chead" style="height:48px">' + ico('camera', 'ci') + '<h3 style="font-size:19px">Caméras extérieures</h3><button class="more" data-act="allCams">' + ico('chevR') + '</button></div>' +
      '<div class="camgrid">' + cams.map(c => cam({ cam: c[0], style: box(c[1], C), bottom: true, tile: true })).join('') + '</div></section>' +
      '<section class="card abs" style="' + box([105, 545, 575, 930]) + '"><div class="chead" style="height:50px">' + ico('carFill', 'ci') + '<h3 style="font-size:19px">Cour</h3><button class="more" data-act="roomInfo" data-arg="Cour">' + ico('chevR') + '</button></div><div class="xgrid">' +
      tl({ t: 'borne', style: box([120, 595, 345, 915], Co), keys: ['dev:ext.borne'] }) +
      tl({ t: 'xlight', id: 'ext.parking', img: A + 'devices/eclairage-parking.jpg', style: box([355, 595, 562, 748], Co) }) +
      tl({ t: 'xlight', id: 'ext.cour', img: A + 'devices/eclairage-cour.jpg', style: box([355, 758, 562, 915], Co) }) + '</div></section>' +
      '<section class="card abs" style="' + box([585, 545, 1075, 930]) + '"><div class="chead" style="height:50px">' + ico('leafFill', 'ci').replace('ci"', 'ci" style="color:#2fe3a6"') + '<h3 style="font-size:19px">Jardin</h3><button class="more" data-act="roomInfo" data-arg="Jardin">' + ico('chevR') + '</button></div><div class="xgrid">' +
      tl({ t: 'jcam', style: box([597, 595, 812, 752], J), keys: ['cam:cam.ext-jardin'] }) +
      tl({ t: 'arro', style: box([822, 595, 1062, 752], J), keys: ['dev:ext.arrosage'] }) +
      tl({ t: 'mower', style: box([597, 762, 812, 915], J), keys: ['dev:ext.tondeuse'] }) +
      tl({ t: 'xlight', id: 'ext.jardin', icon: 'bellFill', img: A + 'devices/eclairage-jardin.jpg', style: box([860, 762, 1062, 915], J) }) + '</div></section>' +
      '<section class="card abs" style="' + box([1085, 545, 1522, 930]) + '"><div class="chead" style="height:50px">' + ico('umbrella', 'ci') + '<h3 style="font-size:19px">Terrasse</h3><button class="more" data-act="roomInfo" data-arg="Terrasse">' + ico('chevR') + '</button></div><div class="xgrid">' +
      tl({ t: 'store', style: box([1097, 595, 1322, 765], Te), keys: ['dev:ext.store'] }) +
      tl({ t: 'storectl', style: box([1332, 595, 1510, 765], Te), keys: ['dev:ext.store'] }) +
      tl({ t: 'xlight', id: 'ext.ambiance', img: A + 'devices/eclairage-ambiance.jpg', style: box([1097, 778, 1300, 915], Te) }) +
      tl({ t: 'xlight', id: 'ext.spots', icon: 'sparkle', img: A + 'devices/spots-terrasse.jpg', style: box([1307, 778, 1510, 915], Te) }) + '</div></section>' +
      B.iabar(box([105, 944, 1522, 1012]), ['off:ext', 'store:close', 'arro:on', 'tond:on']);
  } });
  RENDER.jcam = s => {
    const ev = B.camEv('cam.ext-jardin');
    return '<div class="xtile tile abs" style="' + s.style + '"><div class="hd">' + ico('cctv') + '<b>Caméra jardin</b></div>' +
      '<div class="img" data-act="cam" data-id="cam.ext-jardin" role="button" style="cursor:zoom-in;margin-top:2px"><img src="' + (B.camState('cam.ext-jardin').live || A + 'devices/camera-jardin.jpg') + '" alt=""></div>' +
      '<div class="cam"><div class="stat" style="height:34px"><span class="dot ' + ev.dot + '"></span><span>' + ev.txt + '</span></div></div></div>';
  };

  /* ---------- vues communes ---------- */
  B.act('allCams', () => {
    B.modal('<h2>' + ico('camera') + 'Toutes les caméras</h2><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px">' +
      Object.keys(DATA.CAMS).map(id => { const c = DATA.CAMS[id], ev = B.camEv(id); return '<button class="tile" style="padding:8px;text-align:left" data-act="cam" data-id="' + id + '"><img src="' + (B.camState(id).live || c.img) + '" alt="" style="width:100%;height:130px;object-fit:cover;border-radius:7px"><div class="row" style="margin-top:8px;font-size:14px"><span class="dot ' + ev.dot + '"></span>' + esc(c.name) + '</div></button>'; }).join('') + '</div>', 'wide');
  });
  function openRoom(name) {
    const list = Object.values(DATA.DEVICES).filter(d => d.room === name);
    if (!list.length) { B.toast(name + ' : aucun appareil supplémentaire', 'info'); return; }
    const ov = (S.rooms || {})[name] || {};
    const m = B.modal('<h2>' + ico('homeFill') + esc(ov.name || name) + '</h2><div class="roomedit"><label class="field">Nom affiché<input value="' + esc(ov.name || name) + '" data-change="roomName" data-id="' + esc(name) + '"></label><label class="btn" style="cursor:pointer">' + ico('photo') + 'Changer la photo<input type="file" accept="image/*" data-change="roomPhoto" data-id="' + esc(name) + '" hidden></label>' + (ov.img ? '<button class="btn" data-act="roomPhotoReset" data-id="' + esc(name) + '">' + ico('refresh') + '</button>' : '') + '</div><div class="list">' + list.map(d => {
      const s = dev(d.id);
      const st = d.type === 'cover' ? s.pos + ' % ouvert' : d.type === 'clim' ? (s.on ? s.temp + ' °C' : 'Arrêt') : d.type === 'vacuum' ? ({ docked: 'En veille', cleaning: 'Nettoyage', returning: 'Retour base', zone: 'Nettoyage zone' }[s.status] || s.status) : d.type === 'mower' ? (s.status === 'mowing' ? 'En tonte' : 'En veille') : s.on ? 'Allumé' : 'Éteint';
      const ctl = d.type === 'cover' ? '<div class="row">' + ['up', 'stop', 'down'].map(a => '<button class="sq" data-act="cover" data-id="' + d.id + '" data-arg="' + a + '" aria-label="' + a + '">' + ico(a === 'up' ? 'chevU' : a === 'down' ? 'chevD' : 'stop') + '</button>').join('') + '</div>'
        : (d.type === 'vacuum' || d.type === 'mower') ? '' : '<button class="sw' + (s.on ? ' on' : '') + '" data-act="toggle" data-id="' + d.id + '" role="switch" aria-label="' + esc(d.name) + '"></button>';
      return '<div class="li"><span class="ic">' + ico({ light: 'bulbFill', group: 'bulbFill', cover: 'blindsWin', clim: 'snow', power: 'power', app: 'washer', charger: 'charger', sprinkler: 'sprinkler', vacuum: 'robotFill', mower: 'mowerRobot' }[d.type] || 'power') + '</span><div><b>' + esc(d.name) + '</b><small>' + st + ' · ' + esc(B.HA.entity(d.id)) + '</small></div>' + ctl + '</div>';
    }).join('') + '</div><p class="muted" style="font-size:12.5px;margin:14px 0 0">Les entités Home Assistant se modifient dans Paramètres › Home Assistant.</p>', 'sm');
    m.addEventListener('click', e => { if (e.target.closest('[data-act="toggle"],[data-act="cover"]')) setTimeout(() => { if (document.body.contains(m)) openRoom(name); }, e.target.closest('[data-act="cover"]') ? 1900 : 60); });
  }
  B.openRoom = openRoom;
  function roomSet(name, k, v) { S.rooms = S.rooms || {}; S.rooms[name] = Object.assign(S.rooms[name] || {}, { [k]: v }); if (v == null) delete S.rooms[name][k]; B.save(); B.show(); }
  B.act('roomName', el => roomSet(el.dataset.id, 'name', el.value.trim() || null));
  B.act('roomPhotoReset', el => { roomSet(el.dataset.id, 'img', null); B.closeModal(); });
  B.act('roomPhoto', el => {
    const f = el.files[0]; if (!f) return;
    const img = new Image(); img.onload = () => {
      const w = Math.min(1100, img.width), h = Math.round(img.height * w / img.width), c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      try { roomSet(el.dataset.id, 'img', c.toDataURL('image/jpeg', .8)); B.closeModal(); B.toast('Nouvelle photo pour ' + el.dataset.id, 'photo'); } catch (e) { B.toast('Photo trop lourde pour être gardée', 'info'); }
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(f);
  });
  B.act('roomInfo', el => openRoom(el.dataset.arg));
})();

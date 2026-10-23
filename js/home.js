/* Bêta OS — la maison : niveaux, pièces et appareils (tous les types Home Assistant),
   pages d'étage automatiques, mode édition, droits par utilisateur, import depuis Home Assistant. */
(function () {
  const B = window.BOS, { S, DATA, esc, dev, setDev, T, RENDER, box, px } = B;
  const A = 'assets/', BG = A + 'bg/generic.jpg';
  const C = S.custom = Object.assign({ rooms: [], devices: [], hidden: {}, floors: [], hiddenFloors: {}, hiddenRooms: {}, order: {}, wide: {}, layout: {}, floorNames: {}, devNames: {} }, S.custom || {});
  const isAdmin = () => !!(B.user() && B.user().admin);
  const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

  /* ---------- catalogue des types d'appareils ---------- */
  // clé : [libellé, icône, type interne, domaines Home Assistant, état par défaut, unité]
  const KIND = {
    light: ['Éclairage', 'bulbFill', 'light', ['light', 'switch'], { on: false, bri: 80 }],
    rgb: ['Éclairage RGB', 'bulbFill', 'light', ['light'], { on: false, bri: 80, color: '#ffb35c', rgb: true }],
    plug: ['Prise connectée', 'plug', 'power', ['switch'], { on: false }],
    power: ['Prise / appareil', 'plug', 'power', ['switch', 'media_player'], { on: false }],
    computer: ['Ordinateur', 'monitor', 'power', ['switch', 'button'], { on: false }],
    cover: ['Volet roulant', 'blindsWin', 'cover', ['cover'], { pos: 0, tilt: 50 }],
    awning: ['Store', 'awning', 'cover', ['cover'], { pos: 0 }],
    garage: ['Porte de garage', 'garage', 'cover', ['cover'], { pos: 0 }],
    clim: ['Climatisation / chauffage', 'snow', 'clim', ['climate'], { on: false, temp: 21, hvac: 'Auto', fanm: 'Auto', swing: false }],
    tv: ['Télévision', 'tv', 'media', ['media_player'], { on: false, vol: 25, src: 'HDMI 1' }],
    speaker: ['Enceinte', 'speaker', 'media', ['media_player'], { on: false, vol: 30, src: 'Bluetooth' }],
    fan: ['Ventilateur', 'fan', 'fan', ['fan'], { on: false, pct: 50, osc: false }],
    valve: ['Vanne / arrosage', 'dropFill', 'valve', ['valve', 'switch'], { on: false, min: 10 }],
    lock: ['Serrure', 'lock', 'lock', ['lock'], { locked: true }],
    alarm: ['Alarme (Verisure…)', 'shieldCheck', 'alarm', ['alarm_control_panel'], { mode: 'disarmed' }],
    heater: ['Chauffe-eau', 'hotWater', 'heater', ['water_heater', 'climate'], { on: true, temp: 55, mode: 'Éco' }],
    vacuum: ['Aspirateur robot', 'robotFill', 'vacuum', ['vacuum'], { status: 'docked', bat: 100, power: 'Standard' }],
    mower: ['Tondeuse robot', 'mowerRobot', 'mower', ['lawn_mower'], { status: 'docked', bat: 100 }],
    app: ['Électroménager', 'washer', 'app', ['switch', 'sensor'], { on: false, prog: 'Normal' }],
    temp: ['Capteur de température', 'therm', 'sensor', ['sensor'], { val: 21.4, unit: '°C' }],
    hum: ['Capteur d’humidité', 'drop', 'sensor', ['sensor'], { val: 48, unit: '%' }],
    co2: ['Qualité de l’air (CO₂)', 'wind', 'sensor', ['sensor'], { val: 620, unit: 'ppm' }],
    meter: ['Compteur de puissance', 'boltPlain', 'sensor', ['sensor'], { val: 340, unit: 'W' }],
    door: ['Ouverture porte / fenêtre', 'door', 'binary', ['binary_sensor'], { on: false }],
    motion: ['Détecteur de mouvement', 'walk', 'binary', ['binary_sensor'], { on: false }],
    leak: ['Détecteur de fuite', 'dropFill', 'binary', ['binary_sensor'], { on: false }],
    scene: ['Scène / script', 'sparkle', 'scene', ['scene', 'script'], {}]
  };
  const GROUPS = [['Éclairage & prises', ['light', 'rgb', 'plug', 'computer']], ['Ouvrants', ['cover', 'awning', 'garage', 'lock']], ['Confort', ['clim', 'fan', 'heater']], ['Multimédia', ['tv', 'speaker']],
    ['Robots & jardin', ['vacuum', 'mower', 'valve']], ['Électroménager & sécurité', ['app', 'alarm']], ['Capteurs', ['temp', 'hum', 'co2', 'meter', 'door', 'motion', 'leak']], ['Automatisations', ['scene']]];
  const TYPE_ICON = { light: 'bulbFill', group: 'bulbFill', cover: 'blindsWin', clim: 'snow', power: 'power', app: 'washer', vacuum: 'robotFill', mower: 'mowerRobot', sprinkler: 'sprinkler', charger: 'charger', media: 'tv', fan: 'fan', valve: 'dropFill', lock: 'lock', alarm: 'shieldCheck', heater: 'hotWater', sensor: 'therm', binary: 'door', scene: 'sparkle' };
  const kindOf = d => d.kind || ({ light: d.def && d.def.rgb ? 'rgb' : 'light', group: 'light', cover: /garage/i.test(d.name) ? 'garage' : /store/i.test(d.name) ? 'awning' : 'cover', clim: 'clim', power: /tv|ampli|marantz/i.test(d.name) ? 'tv' : /ordi/i.test(d.name) ? 'computer' : 'plug', app: 'app', vacuum: 'vacuum', mower: 'mower', sprinkler: 'valve', charger: 'plug' }[d.type]);
  const iconOf = d => (KIND[d.kind] || [])[1] || TYPE_ICON[d.type] || 'power';
  B.KIND = KIND; B.kindOf = kindOf; B.iconOf = iconOf;

  /* ---------- appareils personnalisés ---------- */
  function registerCustom() {
    Object.keys(DATA.DEVICES).forEach(id => { if (DATA.DEVICES[id].custom) delete DATA.DEVICES[id]; });
    C.devices.forEach(cd => {
      const k = KIND[cd.type] || KIND.plug;
      DATA.DEVICES[cd.id] = { id: cd.id, type: k[2], kind: KIND[cd.type] ? cd.type : 'plug', name: cd.name, room: cd.room, floor: cd.floor, def: Object.assign({}, k[4]), ha: cd.ha || '', custom: true };
    });
    Object.keys(C.devNames).forEach(id => { if (DATA.DEVICES[id]) DATA.DEVICES[id].name = C.devNames[id]; });
  }
  registerCustom();
  B.registerCustom = registerCustom;
  B.isHidden = id => !!C.hidden[id];

  /* ---------- niveaux ---------- */
  const BF = [{ id: 'ext', name: 'Extérieur', route: 'exterieur', icon: 'tree', level: -9 }, { id: 'rdc', name: 'RDC', route: 'rdc', icon: 'rdc', level: 0 }, { id: 'e1', name: 'Étage 1', route: 'etage1', icon: 'floor1', level: 1 }, { id: 'e2', name: 'Étage 2', route: 'etage2', icon: 'floor2', level: 2 }];
  function floors(all) {
    return BF.filter(f => all || !C.hiddenFloors[f.id]).map(f => Object.assign({}, f, { builtin: true, name: C.floorNames[f.id] || f.name }))
      .concat(C.floors.map(f => Object.assign({ icon: 'layers', level: 3 }, f, { route: 'niveau-' + f.id })))
      .sort((a, b) => a.level - b.level);
  }
  const floor = id => floors(true).find(f => f.id === id);
  B.floors = floors; B.floor = floor;
  B.navList = NAV => {
    const out = NAV.filter(n => !BF.some(f => f.route === n[0] && C.hiddenFloors[f.id]));
    const i = out.findIndex(n => n[0] === 'etage2') + 1 || out.findIndex(n => n[0] === 'energie');
    const extra = C.floors.slice().sort((a, b) => a.level - b.level).map(f => ['niveau-' + f.id, f.name, f.icon || 'layers', f.icon || 'layers']);
    out.splice(i, 0, ...extra);
    return out.map(n => { const f = BF.find(x => x.route === n[0]); return f && C.floorNames[f.id] ? [n[0], C.floorNames[f.id], n[2], n[3]] : n; });
  };
  B.navHidden = r => BF.some(f => f.route === r && C.hiddenFloors[f.id]);

  /* ---------- pièces ---------- */
  const ROOMMETA = {
    'Cour': ['carFill', 'ext-cour'], 'Jardin': ['leafFill', 'ext-jardin'], 'Terrasse': ['umbrella', 'ext-terrasse'],
    'Garage': ['carFill', 'rdc-garage'], 'Buanderie': ['washer', 'rdc-buanderie'], 'Entrée': ['door', 'rdc-entree'], 'Cuisine': ['utensils', 'rdc-cuisine'], 'Salon': ['sofaFill', 'rdc-salon'], 'Séjour': ['umbrella', 'rdc-sejour'], 'Aspirateur robot': ['robotFill', 'rdc-robot'],
    'Escalier & Couloir': ['stairs', 'e1-couloir'], 'Chambre 1': ['bedFill', 'e1-chambre1'], 'Chambre 2': ['bedFill', 'e1-chambre2'], 'Suite parentale': ['bedFill', 'e1-suite'], 'Salle de bains': ['bath', 'e1-sdb'],
    'Grenier 1': ['home', 'e2-amis'], 'Grenier 2': ['home', 'e2-jeux'], 'Chambre d’amis': ['bedFill', 'e2-amis'], 'Bureau': ['monitor', 'e2-jeux']
  };
  const WCIMG = { rdc: 'rdc-wc', e1: 'e1-wc' };
  function floorOf(id) {
    const d = DATA.DEVICES[id]; if (!d) return '';
    if (!d.custom) return id.split('.')[0];
    if (d.floor) return d.floor;
    const r = C.rooms.find(x => x.name === d.room); if (r) return r.floor;
    const b = Object.values(DATA.DEVICES).find(x => !x.custom && x.room === d.room);
    return b ? b.id.split('.')[0] : 'home';
  }
  B.floorOf = floorOf;
  const rkey = (f, n) => f + '|' + n;
  function rooms(fid, all) {
    const map = new Map();
    Object.values(DATA.DEVICES).forEach(d => { if (d.custom) return; const f = d.id.split('.')[0]; if (fid && f !== fid) return; const k = rkey(f, d.room); if (!map.has(k)) map.set(k, { key: k, floor: f, name: d.room, builtin: true }); });
    C.rooms.forEach(r => { if (fid && r.floor !== fid) return; const k = rkey(r.floor, r.name); map.set(k, Object.assign(map.get(k) || {}, { key: k, floor: r.floor, name: r.name, custom: r.id, icon: r.icon, img: r.img })); });
    let list = [...map.values()].filter(r => all || !C.hiddenRooms[r.key]);
    list.forEach(r => {
      const ov = (S.rooms || {})[r.name] || {}, m = ROOMMETA[r.name] || [];
      r.label = ov.name || r.name;
      r.icon = r.icon || m[0] || 'homeFill';
      r.img = ov.img || r.img || (m[1] ? A + 'rooms/' + m[1] + '.jpg' : r.name === 'WC' && WCIMG[r.floor] ? A + 'rooms/' + WCIMG[r.floor] + '.jpg' : '');
      r.devs = Object.values(DATA.DEVICES).filter(d => d.room === r.name && floorOf(d.id) === r.floor && (all || !C.hidden[d.id]));
    });
    const ord = C.order[fid] || [];
    if (fid) list.sort((a, b) => (ord.indexOf(a.key) + 1 || 999) - (ord.indexOf(b.key) + 1 || 999));
    return list;
  }
  B.roomsList = rooms;

  /* ---------- droits par utilisateur ---------- */
  if (!S.permsInit) { S.users.forEach(u => { if (!u.admin) u.deny = Array.from(new Set((u.deny || []).concat(['rdc.garage.door']))); }); S.permsInit = true; B.save(); }
  const SENSITIVE = d => ['garage', 'lock', 'alarm'].includes(kindOf(d));
  function canUse(id) {
    const u = B.user(), d = DATA.DEVICES[id];
    if (!d) return true;
    if (u.id === 'guest') return !SENSITIVE(d);
    return !(u.deny || []).includes(id);
  }
  B.canUse = canUse;
  const CTRL = new Set(['toggle', 'cover', 'clim', 'color', 'setColor', 'setColorInput', 'bri', 'vac', 'borne', 'arro', 'mowerT', 'gstat', 'pset', 'ptimer', 'pscene', 'pmedia', 'prangeC', 'pcolor', 'dishProg']);
  const guard = e => {
    const el = e.target.closest('[data-act],[data-change],[data-input]'); if (!el) return;
    const a = el.dataset.act || el.dataset.change || el.dataset.input;
    let id = el.dataset.id;
    if (!id) id = { vac: 'rdc.robot', borne: 'ext.borne', arro: 'ext.arrosage', mowerT: 'ext.tondeuse' }[a];
    if (!id || !CTRL.has(a) || canUse(id)) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (e.type === 'click') B.toast('« ' + DATA.DEVICES[id].name + ' » : accès réservé, demandez à un administrateur', 'lock');
  };
  ['click', 'input', 'change'].forEach(t => document.addEventListener(t, guard, true));

  /* ---------- tuiles ---------- */
  RENDER.gstat = s => {
    const d = DATA.DEVICES[s.id], st = dev(s.id), run = st.status === 'cleaning' || st.status === 'mowing';
    return '<div class="tile t-app"><span class="ai' + (run ? '' : ' off') + '">' + ico(iconOf(d)) + '</span><span class="lbl">' + esc(d.name) + '</span><span class="sub">' + (run ? 'En marche' : 'À la base') + (st.bat ? ' · ' + st.bat + ' %' : '') + '</span><button class="pbtn sm' + (run ? '' : ' off') + '" data-act="gstat" data-id="' + s.id + '" aria-label="Démarrer / arrêter" style="grid-row:1/3;grid-column:3">' + ico(run ? 'pause' : 'play') + '</button></div>';
  };
  B.act('gstat', el => { const d = DATA.DEVICES[el.dataset.id], st = dev(el.dataset.id), run = st.status === 'cleaning' || st.status === 'mowing'; setDev(el.dataset.id, { status: run ? (d.type === 'vacuum' ? 'returning' : 'docked') : (d.type === 'vacuum' ? 'cleaning' : 'mowing') }); });
  const ALARM = { disarmed: 'Désarmée', away: 'Absent', night: 'Nuit', home: 'Présence', triggered: 'Déclenchée !' };
  const fmtNum = v => typeof v === 'number' ? String(Math.round(v * 10) / 10).replace('.', ',') : v;
  function stateText(d, st) {
    switch (d.type) {
      case 'media': return st.on ? (st.title ? '♪ ' + st.title : (st.src || 'Allumé') + ' · ' + st.vol + ' %') : 'Éteint';
      case 'fan': return st.on ? st.pct + ' %' + (st.osc ? ' · oscillation' : '') : 'Arrêté';
      case 'valve': return st.on ? 'Ouverte' + (st.offAt ? ' · ' + Math.max(1, Math.round((st.offAt - Date.now()) / 6e4)) + ' min' : '') : 'Fermée';
      case 'lock': return st.locked ? 'Verrouillée' : 'Déverrouillée';
      case 'alarm': return ALARM[st.mode] || st.mode;
      case 'heater': return st.on ? fmtNum(st.temp) + ' °C · ' + st.mode : 'Arrêt';
      case 'sensor': return '';
      case 'binary': { const k = kindOf(d); return k === 'motion' ? (st.on ? 'Mouvement' : 'Calme') : k === 'leak' ? (st.on ? 'Fuite détectée !' : 'Sec') : (st.on ? 'Ouvert' : 'Fermé'); }
      case 'scene': return 'Prêt';
      default: return st.on ? 'Allumé' : 'Éteint';
    }
  }
  B.stateText = stateText;
  RENDER.dtile = s => {
    const d = DATA.DEVICES[s.id], st = dev(s.id), k = kindOf(d);
    const active = d.type === 'lock' ? !st.locked : d.type === 'alarm' ? st.mode !== 'disarmed' : d.type === 'binary' ? st.on : d.type === 'sensor' ? false : !!st.on;
    let ctl = '';
    if (['media', 'fan', 'valve', 'heater'].includes(d.type)) ctl = '<button class="pbtn sm' + (st.on ? '' : ' off') + '" data-act="toggle" data-id="' + s.id + '" aria-label="Marche/arrêt">' + ico('power') + '</button>';
    else if (d.type === 'lock') ctl = '<button class="pbtn sm' + (st.locked ? ' off' : '') + '" data-act="pset" data-id="' + s.id + '" data-k="locked" data-v="' + (!st.locked) + '" aria-label="Verrouiller / déverrouiller">' + ico(st.locked ? 'lock' : 'unlock') + '</button>';
    else if (d.type === 'scene') ctl = '<button class="pbtn sm" data-act="pscene" data-id="' + s.id + '" aria-label="Lancer">' + ico('play') + '</button>';
    else if (d.type === 'sensor') ctl = '<b class="sval">' + fmtNum(st.val) + '<small>' + esc(st.unit || '') + '</small></b>';
    else if (d.type === 'alarm') ctl = '<span class="dot ' + (st.mode === 'triggered' ? 'red' : st.mode === 'disarmed' ? '' : 'blue') + '"></span>';
    else if (d.type === 'binary') ctl = '<span class="dot ' + (st.on ? (k === 'leak' ? 'red' : 'blue') : '') + '"></span>';
    return '<div class="tile t-gen' + (active ? ' on' : '') + (d.type === 'binary' && st.on && k === 'leak' ? ' alert' : '') + '"><span class="gi">' + ico(iconOf(d)) + '</span><span class="lbl">' + esc(d.name) + '</span><span class="sub">' + esc(stateText(d, st)) + '</span>' + ctl + '</div>';
  };
  B.act('pscene', el => { B.HA.push(el.dataset.id, { run: true }); B.toast('« ' + DATA.DEVICES[el.dataset.id].name + ' » lancée', 'sparkle'); if (B.fire) B.fire('dev', { id: el.dataset.id, patch: { run: true } }); });
  function deviceTile(d) {
    const id = d.id, k = kindOf(d);
    switch (d.type) {
      case 'light': return T({ t: 'light', id, rgb: !!d.def.rgb });
      case 'group': return T({ t: 'light', id });
      case 'cover': return T({ t: 'cover', id, icon: iconOf(d) === 'blindsWin' ? '' : iconOf(d) });
      case 'clim': return T({ t: 'clim', id, power: true });
      case 'app': return T({ t: 'app', id });
      case 'power': case 'charger': case 'sprinkler': return T({ t: 'power', id, icon: iconOf(d) });
      case 'vacuum': case 'mower': return T({ t: 'gstat', id });
      default: return T({ t: 'dtile', id });
    }
    void k;
  }
  B.deviceTile = deviceTile;

  /* masquage des appareils + cadenas si l'utilisateur n'a pas le droit */
  const IDOF = { vac: () => 'rdc.robot', borne: () => 'ext.borne', arro: () => 'ext.arrosage', mower: () => 'ext.tondeuse', store: () => 'ext.store' };
  ['light', 'clim', 'cover', 'power', 'app', 'xlight', 'gstat', 'dtile', 'vac', 'borne', 'arro', 'mower', 'store'].forEach(t => {
    const orig = RENDER[t]; if (!orig) return;
    RENDER[t] = s => {
      const id = IDOF[t] ? IDOF[t]() : s.id;
      if (id && C.hidden[id] && !IDOF[t]) return '<span hidden></span>';
      const html = orig(s); if (!id || !DATA.DEVICES[id]) return html;
      if (canUse(id)) return html;
      return html.replace(/^(\s*<[a-z]+[^>]*>)/i, '$1<span class="tlock" title="Accès réservé">' + ico('lock') + '</span>');
    };
  });

  /* ---------- pages d'étage automatiques ---------- */
  let editing = false;
  function floorInfo(f) {
    const ds = rooms(f.id).flatMap(r => r.devs), sts = ds.map(d => [d, dev(d.id)]);
    const lights = sts.filter(([d, s]) => (d.type === 'light' || d.type === 'group') && s.on).length;
    const open = sts.filter(([d, s]) => d.type === 'cover' && s.pos > 0).length;
    const temps = sts.filter(([d, s]) => kindOf(d) === 'temp' && typeof s.val === 'number').map(([d, s]) => s.val);
    return [{ icon: 'bulbFill', v: lights, l: 'Lumières allumées', cls: 'y' }, { icon: 'blindsWin', v: open, l: 'Volets ouverts' }, { icon: 'rooms', v: rooms(f.id).length, l: 'Pièces', cls: 'c' },
      temps.length ? { icon: 'therm', v: fmtNum(temps.reduce((a, b) => a + b, 0) / temps.length) + ' °C', l: 'Température', cls: 'g' } : { icon: 'power', v: ds.length, l: 'Appareils', cls: 'g' }];
  }
  function roomCard(r) {
    const tiles = r.devs.map(deviceTile).join('');
    const ed = editing && isAdmin();
    return '<div class="tile froom' + (C.wide[r.key] ? ' wide' : '') + '"><div class="chead">' + ico(r.icon, 'ci') + '<h3>' + esc(r.label) + '</h3>' +
      (ed ? '<div class="redit"><button data-act="roomMove" data-arg="' + esc(r.key) + '" data-v="-1" aria-label="Avancer">' + ico('chevL') + '</button><button data-act="roomMove" data-arg="' + esc(r.key) + '" data-v="1" aria-label="Reculer">' + ico('chevR') + '</button><button data-act="roomWide" data-arg="' + esc(r.key) + '" aria-label="Largeur">' + ico('expand') + '</button><button data-act="roomEdit" data-arg="' + esc(r.key) + '" aria-label="Modifier">' + ico('edit') + '</button></div>'
        : '<button class="more" data-act="roomInfo" data-arg="' + esc(r.name) + '" data-floor="' + r.floor + '" aria-label="Toutes les commandes de la pièce">' + ico('dots') + '</button>') + '</div>' +
      '<div class="photo">' + (r.img ? '<img src="' + r.img + '" alt="" loading="lazy">' : '<span class="nophoto">' + ico(r.icon) + '</span>') + '</div>' +
      '<div class="tiles wrap">' + tiles + (ed ? '<button class="tile addtile" data-act="devAddIn" data-arg="' + esc(r.key) + '">' + ico('plus') + 'Appareil</button>' : (tiles ? '' : '<p class="muted" style="margin:6px 4px;font-size:13px">Aucun appareil pour l’instant.</p>')) + '</div></div>';
  }
  RENDER.fgrid = s => '<div class="fgrid scroll' + (editing ? ' editing' : '') + '">' + rooms(s.floor).map(roomCard).join('') +
    (editing && isAdmin() ? '<button class="tile addroom" data-act="roomAdd2" data-arg="' + s.floor + '">' + ico('plus') + '<span>Ajouter une pièce</span></button>' : '') + '</div>';
  function toolbar(f) {
    if (!isAdmin()) return '';
    return '<div class="row ftools">' + (editing ? '<button class="btn sm" data-act="roomAdd2" data-arg="' + f.id + '">' + ico('plus') + 'Pièce</button><button class="btn sm" data-act="haImport" data-arg="' + f.id + '">' + ico('download') + 'Importer de Home Assistant</button>' : '') +
      (f.builtin ? '<button class="btn sm" data-act="floorLayout" data-arg="' + f.id + '">' + ico('grid9') + 'Disposition d’origine</button>' : '') +
      '<button class="btn sm' + (editing ? ' pri' : '') + '" data-act="floorEdit">' + ico(editing ? 'check' : 'edit') + (editing ? 'Terminer' : 'Modifier') + '</button></div>';
  }
  function autoFloor(f) {
    return B.side(f.route) + B.header({ id: f.route, title: f.name, sub: 'Pièces et appareils', icon: f.builtin ? 'homeFill' : (f.icon || 'layers'), info: { t: 'infobox', keys: ['house'], items: () => floorInfo(f) } }) +
      '<section class="card pcard abs" style="' + box([105, 235, 1522, 932]) + '">' + B.whead('home', 'Pièces · ' + esc(f.name), toolbar(f)) + T({ t: 'fgrid', floor: f.id, keys: ['fgrid'] }) + '</section>' +
      B.iabar(box([105, 944, 1522, 1012]), []);
  }
  B.on('dev', () => { if (document.querySelector('.fgrid')) { /* les tuiles se redessinent seules */ } });
  // étages d'origine : disposition « maquette » ou automatique
  BF.forEach(f => {
    const def = B.ROUTES[f.route]; if (!def) return;
    const orig = def.render, bg = def.bg;
    const auto = () => C.layout[f.id] === 'auto';
    Object.defineProperty(def, 'bg', { get: () => auto() ? BG : bg, configurable: true });
    def.render = () => auto() ? autoFloor(floor(f.id)) : orig().replace(/(<div class="ptitle[^>]*>)/, '$1' + (isAdmin() ? '<button class="fedit" data-act="floorMenu" data-arg="' + f.id + '" aria-label="Organiser l’étage">' + ico('edit') + '</button>' : ''));
  });
  function registerFloorRoutes() { C.floors.forEach(f => B.route('niveau-' + f.id, { title: f.name, bg: BG, render: () => autoFloor(floor(f.id)) })); }
  registerFloorRoutes();
  B.registerFloorRoutes = registerFloorRoutes; B.custom = C;
  B.act('floorEdit', () => { editing = !editing; B.emit('fgrid'); B.show(); });
  B.act('floorLayout', el => { const id = el.dataset.arg; C.layout[id] = C.layout[id] === 'auto' ? 'maquette' : 'auto'; editing = false; B.save(); B.show(); });
  B.act('floorMenu', el => {
    const id = el.dataset.arg;
    B.popover(el, '<b style="font-weight:500">Organiser « ' + esc(floor(id).name) + ' »</b><div class="list" style="margin-top:8px">' +
      '<button class="li" style="grid-template-columns:28px 1fr;width:100%;text-align:left" data-act="floorLayout" data-arg="' + id + '">' + ico('grid9') + '<span>Disposition automatique<small>Toutes les pièces, ajout d’appareils</small></span></button>' +
      '<button class="li" style="grid-template-columns:28px 1fr;width:100%;text-align:left" data-act="roomsManager">' + ico('rooms') + '<span>Gérer niveaux, pièces et appareils</span></button></div>');
  });
  B.act('roomMove', el => {
    const k = el.dataset.arg, f = k.split('|')[0], list = rooms(f).map(r => r.key), i = list.indexOf(k), j = i + +el.dataset.v;
    if (j < 0 || j >= list.length) return; list.splice(i, 1); list.splice(j, 0, k); C.order[f] = list; B.save(); B.emit('fgrid');
  });
  B.act('roomWide', el => { const k = el.dataset.arg; C.wide[k] = !C.wide[k]; B.save(); B.emit('fgrid'); });

  /* ---------- formulaires : pièce, appareil, niveau ---------- */
  const ICONS = ['homeFill', 'bedFill', 'sofaFill', 'utensils', 'bath', 'toilet', 'door', 'stairs', 'monitor', 'tv', 'garage', 'carFill', 'washer', 'leafFill', 'tree', 'umbrella', 'musicFill', 'plex', 'robotFill', 'layers'];
  const iconPick = (name, cur) => '<div class="ipick">' + ICONS.map(i => '<label><input type="radio" name="' + name + '" value="' + i + '"' + (i === cur ? ' checked' : '') + ' hidden><span>' + ico(i) + '</span></label>').join('') + '</div>';
  const floorOpts = cur => floors(true).map(f => '<option value="' + f.id + '"' + (f.id === cur ? ' selected' : '') + '>' + esc(f.name) + '</option>').join('');
  const typeOpts = cur => GROUPS.map(g => '<optgroup label="' + g[0] + '">' + g[1].map(k => '<option value="' + k + '"' + (k === cur ? ' selected' : '') + '>' + KIND[k][0] + '</option>').join('') + '</optgroup>').join('');
  function readImg(file, max) {
    return new Promise((res, rej) => { const img = new Image(); img.onload = () => { const w = Math.min(max || 1000, img.width), h = Math.round(img.height * w / img.width), c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(img, 0, 0, w, h); URL.revokeObjectURL(img.src); res(c.toDataURL('image/jpeg', .8)); }; img.onerror = rej; img.src = URL.createObjectURL(file); });
  }
  function roomForm(r, floorId) {
    const isNew = !r, fid = r ? r.floor : floorId;
    B.modal('<h2>' + ico('rooms') + (isNew ? 'Nouvelle pièce' : 'Pièce « ' + esc(r.label) + ' »') + '</h2><form data-submit="roomSave" data-arg="' + (r ? esc(r.key) : '') + '" style="display:flex;flex-direction:column;gap:12px">' +
      '<div class="grid2"><label class="field">Nom<input name="name" required value="' + esc(r ? r.label : '') + '" placeholder="Salle de sport"></label><label class="field">Niveau<select name="floor"' + (r && r.builtin ? ' disabled' : '') + '>' + floorOpts(fid) + '</select></label></div>' +
      '<div class="field">Icône' + iconPick('icon', r ? r.icon : 'homeFill') + '</div>' +
      '<label class="field">Photo (facultatif)<input type="file" name="photo" accept="image/*"></label>' +
      '<div class="row" style="justify-content:space-between;flex-wrap:wrap">' + (r ? (!r.builtin ? '<button type="button" class="btn dan" data-act="roomDel2" data-arg="' + esc(r.key) + '">' + ico('trash') + 'Supprimer la pièce</button>' : '<button type="button" class="btn" data-act="roomHide" data-arg="' + esc(r.key) + '">' + ico('x') + 'Masquer la pièce</button>') : '<span></span>') +
      '<span class="row"><button type="button" class="btn" data-act="closeModal">Annuler</button><button class="btn pri">' + ico('check') + 'Enregistrer</button></span></div></form>', 'sm');
  }
  const findRoom = key => rooms(key.split('|')[0], true).find(r => r.key === key);
  B.act('roomAdd2', el => { if (!isAdmin()) return; roomForm(null, el.dataset.arg); });
  B.act('roomEdit', el => roomForm(findRoom(el.dataset.arg)));
  B.act('roomSave', async el => {
    const f = new FormData(el), key = el.dataset.arg, name = String(f.get('name')).trim(), icon = f.get('icon') || 'homeFill', file = f.get('photo');
    let img = ''; if (file && file.size) try { img = await readImg(file, 1000); } catch (e) { }
    if (!key) {
      const fl = f.get('floor');
      if (rooms(fl, true).some(r => r.name === name)) return B.toast('Cette pièce existe déjà à ce niveau', 'info');
      C.rooms.push({ id: uid('r'), name, floor: fl, icon, img });
      if (BF.some(b => b.id === fl) && C.layout[fl] !== 'auto') { C.layout[fl] = 'auto'; B.toast('L’étage passe en disposition automatique pour afficher la nouvelle pièce', 'grid9'); }
    } else {
      const r = findRoom(key);
      if (r.custom) { const cr = C.rooms.find(x => x.id === r.custom); const old = cr.name; cr.icon = icon; if (img) cr.img = img; if (name && name !== old) { cr.name = name; C.devices.forEach(d => { if (d.room === old && d.floor === cr.floor) d.room = name; }); } }
      else { S.rooms = S.rooms || {}; S.rooms[r.name] = Object.assign(S.rooms[r.name] || {}, { name: name !== r.name ? name : undefined }, img ? { img } : {}); }
      if (!r.custom) { const cr = C.rooms.find(x => x.floor === r.floor && x.name === r.name); if (cr) cr.icon = icon; else C.rooms.push({ id: uid('r'), name: r.name, floor: r.floor, icon, overlay: true }); }
    }
    registerCustom(); B.save(); B.closeModal(); B.emit('fgrid'); B.show();
  });
  B.act('roomDel2', el => {
    const r = findRoom(el.dataset.arg); if (!r || !confirm('Supprimer « ' + r.label + ' » et ses appareils ajoutés ?')) return;
    C.rooms = C.rooms.filter(x => x.id !== r.custom); C.devices = C.devices.filter(d => !(d.room === r.name && (d.floor || floorOf(d.id)) === r.floor));
    registerCustom(); B.save(); B.closeModal(); B.show();
  });
  B.act('roomHide', el => { C.hiddenRooms[el.dataset.arg] = true; B.save(); B.closeModal(); B.show(); B.toast('Pièce masquée (réaffichable dans Gérer › Pièces)', 'x'); });

  function devForm(o) {
    o = o || {};
    const fid = o.floor || 'rdc', rs = rooms(fid, true);
    const ents = Object.keys(B.HA.states || {});
    B.modal('<h2>' + ico('plus') + 'Ajouter un appareil</h2><form data-submit="devSave" style="display:flex;flex-direction:column;gap:12px">' +
      '<div class="grid2"><label class="field">Nom<input name="name" required placeholder="Lampe de chevet"></label><label class="field">Type<select name="type" data-change="devTypeHint">' + typeOpts(o.type || 'light') + '</select></label></div>' +
      '<div class="grid2"><label class="field">Niveau<select name="floor" data-change="devFloorSel">' + floorOpts(fid) + '</select></label><label class="field">Pièce<select name="room">' + rs.map(r => '<option' + (r.name === o.room ? ' selected' : '') + '>' + esc(r.name) + '</option>').join('') + '</select></label></div>' +
      '<label class="field">Entité Home Assistant <small class="muted">(facultatif, ex. light.salon)</small><input name="ha" list="haents2" spellcheck="false" autocomplete="off"><datalist id="haents2">' + ents.slice(0, 600).map(e => '<option value="' + esc(e) + '">').join('') + '</datalist></label>' +
      '<div class="row" style="justify-content:flex-end"><button type="button" class="btn" data-act="closeModal">Annuler</button><button class="btn pri">' + ico('check') + 'Ajouter</button></div></form>', 'sm');
  }
  B.devForm = devForm;
  B.act('devAddIn', el => { const r = findRoom(el.dataset.arg); devForm({ floor: r.floor, room: r.name }); });
  B.act('devFloorSel', el => { const sel = el.form.room; sel.innerHTML = rooms(el.value, true).map(r => '<option>' + esc(r.name) + '</option>').join(''); });
  B.act('devTypeHint', () => { });
  B.act('devSave', el => {
    const f = new FormData(el), name = String(f.get('name')).trim(), fl = f.get('floor');
    if (!name || !f.get('room')) return B.toast('Choisissez une pièce (créez-en une d’abord si besoin)', 'info');
    C.devices.push({ id: fl + '.c' + uid(''), type: f.get('type'), name, room: f.get('room'), floor: fl, ha: String(f.get('ha') || '').trim() });
    registerCustom(); B.save(); B.closeModal(); B.emit('fgrid'); B.emit('house'); B.show(); B.toast('« ' + name + ' » ajouté', 'check');
  });

  /* ---------- gestionnaire complet (admin) ---------- */
  let mtab = 'floors';
  function manager() {
    if (!isAdmin()) return B.toast('Réservé aux administrateurs', 'lock');
    const tabs = '<div class="tabs" style="margin-bottom:14px;align-self:flex-start">' + [['floors', 'Niveaux'], ['rooms', 'Pièces'], ['devices', 'Appareils'], ['import', 'Home Assistant']].map(t => '<button class="' + (mtab === t[0] ? 'on' : '') + '" data-act="mgrTab" data-arg="' + t[0] + '">' + t[1] + '</button>').join('') + '</div>';
    let body = '';
    if (mtab === 'floors') {
      body = '<div class="list">' + floors(true).map(f => '<div class="li" style="grid-template-columns:40px 1fr auto"><span class="ic">' + ico(f.icon) + '</span><div><b>' + esc(f.name) + '</b><small>' + (f.builtin ? 'Niveau d’origine' + (C.hiddenFloors[f.id] ? ' · masqué' : '') : 'Ajouté') + ' · ' + rooms(f.id).length + ' pièces</small></div><div class="row" style="gap:6px">' +
        '<button class="sq" data-act="floorRename" data-arg="' + f.id + '" aria-label="Renommer">' + ico('edit') + '</button>' +
        (f.builtin ? '<button class="sw sm' + (C.hiddenFloors[f.id] ? '' : ' on') + '" data-act="floorHide" data-arg="' + f.id + '" role="switch" aria-label="Afficher"></button>' : '<button class="sq" data-act="floorDel" data-arg="' + f.id + '" aria-label="Supprimer">' + ico('trash') + '</button>') + '</div></div>').join('') + '</div>' +
        '<h4>Ajouter un niveau</h4><form data-submit="floorAdd" class="row" style="flex-wrap:wrap;gap:8px"><input class="search" name="name" required placeholder="Étage 3, Sous-sol, Abri de jardin…"><select class="search" name="level" style="flex:0 0 170px"><option value="-1">Sous le RDC</option><option value="3" selected>Au-dessus de l’étage 2</option><option value="9">Annexe / dépendance</option></select><button class="btn pri sm">' + ico('plus') + 'Ajouter</button></form>';
    } else if (mtab === 'rooms') {
      body = floors(true).map(f => '<h4>' + esc(f.name) + '</h4><div class="list">' + rooms(f.id, true).map(r => '<div class="li" style="grid-template-columns:40px 1fr auto"><span class="ic">' + ico(r.icon) + '</span><div><b>' + esc(r.label) + '</b><small>' + r.devs.length + ' appareils' + (C.hiddenRooms[r.key] ? ' · masquée' : '') + (!r.builtin ? ' · ajoutée' : '') + '</small></div><div class="row" style="gap:6px"><button class="sq" data-act="roomEdit" data-arg="' + esc(r.key) + '" aria-label="Modifier">' + ico('edit') + '</button>' +
        (!r.builtin ? '<button class="sq" data-act="roomDel2" data-arg="' + esc(r.key) + '" aria-label="Supprimer">' + ico('trash') + '</button>' : '<button class="sw sm' + (C.hiddenRooms[r.key] ? '' : ' on') + '" data-act="roomShow" data-arg="' + esc(r.key) + '" role="switch" aria-label="Afficher"></button>') + '</div></div>').join('') +
        '</div><button class="btn sm" style="margin-top:6px" data-act="roomAdd2" data-arg="' + f.id + '">' + ico('plus') + 'Pièce à « ' + esc(f.name) + ' »</button>').join('');
    } else if (mtab === 'devices') {
      body = '<div class="row" style="margin-bottom:10px"><button class="btn pri sm" data-act="devAddAny">' + ico('plus') + 'Ajouter un appareil</button></div>' + floors(true).map(f => rooms(f.id, true).filter(r => r.devs.length).map(r => '<div class="mroom"><div class="row"><b>' + esc(r.label) + '</b><small class="muted">' + esc(f.name) + '</small></div>' +
        r.devs.map(d => '<div class="mdev"><span>' + ico(iconOf(d)).replace('class="ico', 'style="display:inline;vertical-align:-3px;margin-right:6px;color:#8fd0ff" class="ico') + esc(d.name) + ' <small class="muted">' + ((KIND[kindOf(d)] || [])[0] || d.type) + (B.HA.entity(d.id) ? ' · ' + esc(B.HA.entity(d.id)) : '') + '</small></span><span class="row" style="gap:6px"><button class="sq" data-act="panel" data-id="' + d.id + '" aria-label="Réglages">' + ico('dots') + '</button>' + (d.custom ? '<button class="sq" data-act="devDel" data-arg="' + d.id + '" aria-label="Supprimer">' + ico('trash') + '</button>' : '<button class="sw sm' + (C.hidden[d.id] ? '' : ' on') + '" data-act="devHide" data-arg="' + d.id + '" role="switch" aria-label="Installé"></button>') + '</span></div>').join('') + '</div>').join('')).join('');
    } else body = importBody();
    B.modal('<h2>' + ico('rooms') + 'Niveaux, pièces et appareils</h2>' + tabs + '<div class="scroll" style="max-height:62vh;padding-right:6px">' + body + '</div>', 'wide mgrm');
  }
  B.act('roomsManager', manager);
  B.act('mgrTab', el => { mtab = el.dataset.arg; manager(); if (mtab === 'import') loadImport(); });
  const refresh = () => { registerCustom(); B.save(); B.emit('fgrid'); B.emit('house'); manager(); };
  B.act('floorAdd', el => { const f = new FormData(el), n = String(f.get('name')).trim(); if (!n) return; const id = uid('f'); C.floors.push({ id, name: n, level: +f.get('level'), icon: 'layers' }); registerFloorRoutes(); refresh(); B.toast('Niveau « ' + n + ' » ajouté au menu', 'layers'); });
  B.act('floorDel', el => { const f = C.floors.find(x => x.id === el.dataset.arg); if (!f || !confirm('Supprimer « ' + f.name + ' », ses pièces et ses appareils ?')) return; C.floors = C.floors.filter(x => x !== f); C.rooms = C.rooms.filter(r => r.floor !== f.id); C.devices = C.devices.filter(d => d.floor !== f.id); refresh(); });
  B.act('floorHide', el => { const id = el.dataset.arg; C.hiddenFloors[id] = !C.hiddenFloors[id]; refresh(); });
  B.act('floorRename', el => { const f = floor(el.dataset.arg), n = prompt('Nouveau nom', f.name); if (!n) return; if (f.builtin) C.floorNames[f.id] = n.trim(); else C.floors.find(x => x.id === f.id).name = n.trim(); registerFloorRoutes(); refresh(); });
  B.act('roomShow', el => { const k = el.dataset.arg; if (C.hiddenRooms[k]) delete C.hiddenRooms[k]; else C.hiddenRooms[k] = true; refresh(); });
  B.act('devAddAny', () => devForm({}));
  B.act('devDel', el => { const d = DATA.DEVICES[el.dataset.arg]; if (!d || !confirm('Supprimer « ' + d.name + ' » ?')) return; C.devices = C.devices.filter(x => x.id !== d.id); delete S.dev[d.id]; refresh(); });
  B.act('devHide', el => { const id = el.dataset.arg; if (C.hidden[id]) delete C.hidden[id]; else C.hidden[id] = true; B.save(); el.classList.toggle('on', !C.hidden[id]); B.emit('fgrid'); B.emit('house'); });

  /* ---------- import depuis Home Assistant (pièces = zones HA) ---------- */
  const DOMKIND = { light: 'light', switch: 'plug', cover: 'cover', climate: 'clim', media_player: 'tv', fan: 'fan', valve: 'valve', lock: 'lock', alarm_control_panel: 'alarm', water_heater: 'heater', vacuum: 'vacuum', lawn_mower: 'mower', scene: 'scene', script: 'scene' };
  let imp = null;
  function guessKind(e, s) {
    const dom = e.split('.')[0], a = (s && s.attributes) || {}, dc = a.device_class || '';
    if (dom === 'light') return (a.supported_color_modes || []).some(m => /rgb|hs|xy/.test(m)) ? 'rgb' : 'light';
    if (dom === 'cover') return dc === 'garage' ? 'garage' : dc === 'awning' ? 'awning' : 'cover';
    if (dom === 'media_player') return dc === 'speaker' || /enceinte|speaker|sonos|homepod|echo/i.test(a.friendly_name || e) ? 'speaker' : 'tv';
    if (dom === 'switch') return /pc|ordi|computer/i.test(e) ? 'computer' : 'plug';
    if (dom === 'sensor') return dc === 'temperature' ? 'temp' : dc === 'humidity' ? 'hum' : dc === 'carbon_dioxide' ? 'co2' : dc === 'power' ? 'meter' : null;
    if (dom === 'binary_sensor') return ['door', 'window', 'opening', 'garage_door'].includes(dc) ? 'door' : ['motion', 'occupancy', 'presence'].includes(dc) ? 'motion' : dc === 'moisture' ? 'leak' : null;
    return DOMKIND[dom] || null;
  }
  B.guessKind = guessKind;
  async function loadImport() {
    if (!B.HA.enabled()) { imp = { err: 'Reliez d’abord Home Assistant (Paramètres › Connexions).' }; return manager(); }
    imp = { loading: true }; manager();
    try {
      const st = await B.HA.req('/api/states'); st.forEach(s => B.HA.states[s.entity_id] = s);
      let areas = {}, entArea = {};
      if (B.HA.wsOk) try {
        const [ar, en, dv] = await Promise.all([B.HA.wsSend({ type: 'config/area_registry/list' }), B.HA.wsSend({ type: 'config/entity_registry/list' }), B.HA.wsSend({ type: 'config/device_registry/list' })]);
        ar.forEach(a => areas[a.area_id] = a.name); const devA = {}; dv.forEach(d => devA[d.id] = d.area_id); en.forEach(e => entArea[e.entity_id] = areas[e.area_id || devA[e.device_id]] || '');
      } catch (e) { }
      const linked = new Set(Object.keys(DATA.DEVICES).map(id => B.HA.entity(id)).filter(Boolean));
      imp = { list: st.map(s => ({ e: s.entity_id, name: s.attributes.friendly_name || s.entity_id, kind: guessKind(s.entity_id, s), area: entArea[s.entity_id] || '' })).filter(x => x.kind && !linked.has(x.e)).sort((a, b) => (a.area || 'zzz').localeCompare(b.area || 'zzz') || a.name.localeCompare(b.name)) };
    } catch (e) { imp = { err: 'Home Assistant ne répond pas (' + e.message + ')' }; }
    if (mtab === 'import') manager();
  }
  function importBody() {
    if (!imp || imp.loading) return '<p class="muted">Lecture de vos appareils Home Assistant…</p>';
    if (imp.err) return '<p class="muted">' + esc(imp.err) + '</p>';
    if (!imp.list.length) return '<p class="muted">Tous vos appareils Home Assistant sont déjà dans Bêta OS.</p>';
    const all = floors(true).flatMap(f => rooms(f.id, true).map(r => [f, r]));
    const match = area => { const n = (area || '').toLowerCase(); const hit = all.find(([f, r]) => r.name.toLowerCase() === n || r.label.toLowerCase() === n); return hit ? hit[1].key : ''; };
    return '<p class="muted" style="margin:0 0 10px;font-size:13px">' + imp.list.length + ' appareils pas encore dans Bêta OS. Les zones Home Assistant sont associées aux pièces du même nom ; « Nouvelle pièce » crée la zone comme pièce.</p><form data-submit="haImportGo"><div class="implist">' +
      imp.list.map((x, i) => '<label class="imrow"><input type="checkbox" name="on' + i + '"' + (match(x.area) ? ' checked' : '') + '><span><b>' + esc(x.name) + '</b><small>' + esc(x.e) + (x.area ? ' · zone « ' + esc(x.area) + ' »' : '') + '</small></span><select name="k' + i + '">' + typeOpts(x.kind) + '</select>' +
        '<select name="r' + i + '"><option value="new:' + esc(x.area || 'Divers') + '">Nouvelle pièce : ' + esc(x.area || 'Divers') + '</option>' + all.map(([f, r]) => '<option value="' + esc(r.key) + '"' + (match(x.area) === r.key ? ' selected' : '') + '>' + esc(f.name + ' · ' + r.label) + '</option>').join('') + '</select></label>').join('') +
      '</div><div class="row" style="justify-content:flex-end;margin-top:12px;gap:8px;flex-wrap:wrap"><select class="search" name="newfloor" style="flex:0 0 200px" aria-label="Niveau des nouvelles pièces">' + floorOpts(imp.target || 'rdc') + '</select><button class="btn pri">' + ico('download') + 'Importer la sélection</button></div></form>';
  }
  B.act('haImport', el => { mtab = 'import'; manager(); if (imp) imp.target = el.dataset.arg; loadImport(); });
  B.act('haImportGo', el => {
    const f = new FormData(el), nf = f.get('newfloor'); let n = 0;
    imp.list.forEach((x, i) => {
      if (!f.get('on' + i)) return;
      let rk = f.get('r' + i), fl, room;
      if (rk.startsWith('new:')) { room = rk.slice(4); fl = nf; if (!rooms(fl, true).some(r => r.name === room)) C.rooms.push({ id: uid('r'), name: room, floor: fl, icon: 'homeFill' }); }
      else { fl = rk.split('|')[0]; room = rk.split('|').slice(1).join('|'); }
      C.devices.push({ id: fl + '.c' + uid(''), type: f.get('k' + i), name: x.name, room, floor: fl, ha: x.e }); n++;
    });
    if (BF.some(b => C.devices.slice(-n).some(d => d.floor === b.id))) C.devices.slice(-n).forEach(d => { if (BF.some(b => b.id === d.floor)) C.layout[d.floor] = 'auto'; });
    imp = null; registerCustom(); B.save(); B.closeModal(); B.HA.applyAll && B.HA.applyAll(); B.show(); B.toast(n + ' appareil' + (n > 1 ? 's importés' : ' importé'), 'download');
  });

  /* ---------- page Pièces (vue d'ensemble) ---------- */
  RENDER.pieces = () => {
    const fl = S.piecesFloor || 'rdc', fs = floors().concat([{ id: 'home', name: 'Maison' }]);
    const list = fl === 'home' ? [{ key: 'home|Maison', label: 'Maison', icon: 'homeFill', img: '', devs: Object.values(DATA.DEVICES).filter(d => d.id.startsWith('home.')) }] : rooms(fl);
    return '<div class="row" style="gap:8px;margin-bottom:12px;flex-wrap:wrap">' + fs.map(f => '<button class="cat' + (fl === f.id ? ' on' : '') + '" style="padding:0 16px" data-act="piecesFloor" data-arg="' + f.id + '">' + esc(f.name) + '</button>').join('') + (isAdmin() ? '<span style="flex:1"></span><button class="btn sm pri" data-act="roomsManager">' + ico('edit') + 'Gérer</button>' : '') + '</div>' +
      '<div class="pieces scroll">' + list.map(r => '<div class="tile proom"><div class="chead">' + ico(r.icon, 'ci') + '<h3>' + esc(r.label) + '</h3>' + (r.floor ? '<button class="more" data-act="roomInfo" data-arg="' + esc(r.name) + '" data-floor="' + r.floor + '" aria-label="Commandes de la pièce">' + ico('dots') + '</button>' : '') + '</div>' + (r.img ? '<div class="photo" style="height:96px"><img src="' + r.img + '" alt="" loading="lazy"></div>' : '') +
        '<div class="tiles wrap">' + (r.devs.map(deviceTile).join('') || '<p class="muted" style="margin:6px 4px;font-size:13px">Aucun appareil.</p>') + '</div></div>').join('') + '</div>';
  };
  B.act('piecesFloor', el => { S.piecesFloor = el.dataset.arg; B.emit('pieces'); });
  B.route('pieces', { title: 'Pièces', bg: BG, render: () => B.side('pieces') + B.header({ id: 'pieces', title: 'Pièces', sub: 'Toute la maison, pièce par pièce', icon: 'rooms', info: { t: 'infobox', keys: ['pieces', 'house'], items: () => [{ icon: 'layers', v: floors().length, l: 'Niveaux', cls: 'c' }, { icon: 'rooms', v: floors().reduce((a, f) => a + rooms(f.id).length, 0), l: 'Pièces' }, { icon: 'power', v: Object.keys(DATA.DEVICES).filter(id => !C.hidden[id]).length, l: 'Appareils' }, { icon: 'homeFill', v: B.HA.enabled() ? 'Relié' : 'Démo', l: 'Home Assistant', cls: 'g' }] } }) +
    '<section class="card pcard abs" style="' + box([105, 235, 1522, 1012]) + '">' + B.whead('home', 'Pièces et appareils') + T({ t: 'pieces', keys: ['pieces', 'house', 'fgrid'] }) + '</section>' });

  /* ---------- droits d'accès ---------- */
  B.act('permsEdit', el => {
    if (!isAdmin()) return B.toast('Réservé aux administrateurs', 'lock');
    const u = S.users.find(x => x.id === el.dataset.arg), deny = new Set(u.deny || []);
    B.modal('<h2>' + ico('lock') + 'Droits de ' + esc(u.name) + '</h2><p class="muted" style="margin:-4px 0 12px;font-size:13px">Décochez ce que ' + esc(u.name) + ' ne doit pas pouvoir commander. Alarme et serrures Verisure : à verrouiller ici, le code reste géré par Verisure.</p><form data-submit="permsSave" data-arg="' + u.id + '"><div class="permgrid scroll">' +
      floors(true).concat([{ id: 'home', name: 'Maison' }]).map(f => { const ds = Object.values(DATA.DEVICES).filter(d => floorOf(d.id) === f.id && !C.hidden[d.id]); return ds.length ? '<h4>' + esc(f.name) + '</h4>' + ds.map(d => '<label class="pck"><input type="checkbox" name="' + d.id + '"' + (deny.has(d.id) ? '' : ' checked') + '>' + ico(iconOf(d)) + '<span>' + esc(d.room + ' · ' + d.name) + '</span>' + (SENSITIVE(d) ? '<em>sensible</em>' : '') + '</label>').join('') : ''; }).join('') +
      '</div><div class="row" style="justify-content:space-between;margin-top:12px;flex-wrap:wrap"><button type="button" class="btn sm" data-act="permsPreset">' + ico('lock') + 'Bloquer garage, serrures et alarme</button><span class="row"><button type="button" class="btn" data-act="closeModal">Annuler</button><button class="btn pri">' + ico('check') + 'Enregistrer</button></span></div></form>', 'wide');
  });
  B.act('permsPreset', el => el.closest('form').querySelectorAll('input[type=checkbox]').forEach(c => { const d = DATA.DEVICES[c.name]; if (d && SENSITIVE(d)) c.checked = false; }));
  B.act('permsSave', el => { const u = S.users.find(x => x.id === el.dataset.arg); u.deny = [...el.querySelectorAll('input[type=checkbox]')].filter(c => !c.checked).map(c => c.name); B.save(); B.closeModal(); B.toast('Droits de ' + u.name + ' enregistrés', 'lock'); });
  const sprof0 = RENDER.sprof;
  RENDER.sprof = s => sprof0(s) + (isAdmin() ? '<div class="row" style="margin-top:8px;gap:6px;flex-wrap:wrap;font-size:13px"><span class="muted">Droits :</span>' + S.users.map(u => '<button class="btn sm" data-act="permsEdit" data-arg="' + u.id + '">' + ico('lock') + esc(u.name) + (u.admin ? '' : ' (' + (u.deny || []).length + ')') + '</button>').join('') + '</div>' : '');
})();

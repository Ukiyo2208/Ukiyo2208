/* Bêta OS 7 — installation : assistant de premier démarrage (Démo, Manuel, Assisté, Automatique),
   réinitialisation, création de pièces à partir de modèles en cochant les appareils, import complet
   depuis Home Assistant (étages, zones, appareils) et réglages propres à chaque écran. */
(function () {
  const B = window.BOS, { S, DATA, esc } = B;
  const C = B.custom, A = 'assets/';
  const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  if (!S.setup) S.setup = { done: !B.fresh, mode: 'demo' };
  const isAdmin = () => !!(B.user() && B.user().admin);
  // met à jour une fenêtre déjà ouverte au lieu de la recréer (pas de clignotement entre les étapes)
  function paint(html, cls) {
    const box = document.querySelector('.modal .box.' + cls.split(' ')[0]);
    if (!box) return B.modal(html, cls);
    const sc = box.querySelector('.sw-body, .rgal'), y = sc ? sc.scrollTop : 0, x = box.querySelector('.rgal') ? box.querySelector('.rgal').scrollLeft : 0, top = box.scrollTop;
    box.innerHTML = '<button class="x" data-act="closeModal" aria-label="Fermer">' + ico('x') + '</button>' + html;
    box.scrollTop = top; const g = box.querySelector('.rgal'); if (g) g.scrollLeft = x;
  }

  /* ======================= MODÈLES DE PIÈCES ======================= */
  // appareils proposés : type (catalogue Home Assistant de Bêta OS) → nombre
  const TPL = [
    ['salon', 'Salon', 'sofaFill', 'rdc-salon', { light: 2, cover: 1, tv: 1, speaker: 1, clim: 1, plug: 1 }],
    ['sejour', 'Séjour / salle à manger', 'umbrella', 'rdc-sejour', { light: 2, cover: 1, speaker: 0 }],
    ['cuisine', 'Cuisine', 'utensils', 'rdc-cuisine', { light: 2, cover: 1, plug: 1, app: 1 }],
    ['chambre', 'Chambre', 'bedFill', 'e1-chambre1', { light: 1, cover: 1, clim: 1, plug: 1 }],
    ['enfant', 'Chambre d’enfant', 'bedFill', 'e1-chambre2', { rgb: 1, cover: 1, temp: 1 }],
    ['suite', 'Suite parentale', 'bedFill', 'e1-suite', { light: 2, cover: 1, clim: 1, tv: 1 }],
    ['sdb', 'Salle de bains', 'bath', 'e1-sdb', { light: 1, hum: 1, leak: 1 }],
    ['wc', 'WC', 'toilet', 'rdc-wc', { light: 1 }],
    ['bureau', 'Bureau', 'monitor', 'e2-jeux', { light: 1, computer: 1, plug: 1, clim: 1 }],
    ['entree', 'Entrée', 'door', 'rdc-entree', { light: 1, door: 1, motion: 1 }],
    ['couloir', 'Couloir / escalier', 'stairs', 'e1-couloir', { light: 1, motion: 1 }],
    ['garage', 'Garage', 'garage', 'rdc-garage', { light: 1, garage: 1, plug: 1 }],
    ['buanderie', 'Buanderie', 'washer', 'rdc-buanderie', { light: 1, app: 1, leak: 1 }],
    ['grenier', 'Grenier', 'homeFill', 'e2-amis', { light: 1, cover: 1 }],
    ['jardin', 'Jardin', 'leafFill', 'ext-jardin', { light: 1, valve: 1 }],
    ['terrasse', 'Terrasse', 'umbrella', 'ext-terrasse', { light: 1, awning: 1 }],
    ['cour', 'Cour / parking', 'carFill', 'ext-cour', { light: 1, garage: 0 }],
    ['vide', 'Pièce vide', 'homeFill', '', {}]
  ];
  const tpl = id => TPL.find(t => t[0] === id) || TPL[TPL.length - 1];
  // types proposés dans la liste à cocher (les plus courants d'abord)
  const PICK = ['light', 'rgb', 'plug', 'cover', 'clim', 'tv', 'speaker', 'fan', 'computer', 'app', 'garage', 'awning', 'lock', 'valve', 'heater', 'vacuum', 'mower', 'temp', 'hum', 'co2', 'door', 'motion', 'leak', 'meter', 'scene'];
  const GALLERY = ['rdc-salon', 'rdc-sejour', 'rdc-cuisine', 'rdc-entree', 'rdc-wc', 'rdc-garage', 'rdc-buanderie', 'e1-suite', 'e1-chambre1', 'e1-chambre2', 'e1-sdb', 'e1-wc', 'e1-couloir', 'e2-amis', 'e2-jeux', 'ext-jardin', 'ext-terrasse', 'ext-cour', 'ext-parking'];
  const roomImg = k => k ? A + 'rooms/' + k + '.jpg' : '';
  B.roomTemplates = TPL;

  /* ======================= CRÉER DES PIÈCES ET DES APPAREILS ======================= */
  function makeRoom(o) {
    // o : { floor, name, icon, img, devs: { type: nombre }, ha: [{ type, name, ha }] }
    if (B.roomsList(o.floor, true).some(r => r.name === o.name)) o.name += ' ' + (B.roomsList(o.floor, true).filter(r => r.name.startsWith(o.name)).length + 1);
    C.rooms.push({ id: uid('r'), name: o.name, floor: o.floor, icon: o.icon || 'homeFill', img: o.img || '' });
    const used = {};
    Object.keys(o.devs || {}).forEach(t => { for (let i = 0; i < o.devs[t]; i++) { used[t] = (used[t] || 0) + 1; const base = (B.KIND[t] || ['Appareil'])[0].replace(/ \/.*$/, '').replace(/^Capteur d[e’'] ?/, ''); C.devices.push({ id: o.floor + '.c' + uid(''), type: t, name: base.charAt(0).toUpperCase() + base.slice(1) + (o.devs[t] > 1 ? ' ' + (i + 1) : ''), room: o.name, floor: o.floor, ha: '' }); } });
    (o.ha || []).forEach(d => C.devices.push({ id: o.floor + '.c' + uid(''), type: d.type, name: d.name, room: o.name, floor: o.floor, ha: d.ha }));
    if (['ext', 'rdc', 'e1', 'e2'].includes(o.floor)) C.layout[o.floor] = 'auto';
    return o.name;
  }
  let draft = null; // pièce en cours de création
  function roomWizard(floorId) {
    if (!isAdmin()) return B.toast('Réservé aux administrateurs', 'lock');
    if (!draft) { const t = tpl('salon'); draft = { floor: floorId || (B.floors()[0] || {}).id, t: t[0], name: t[1], icon: t[2], img: roomImg(t[3]), devs: Object.assign({}, t[4]) }; }
    const d = draft;
    paint('<h2>' + ico('rooms') + 'Nouvelle pièce</h2><form class="rwiz" data-submit="rwSave">' +
      '<div class="field">Modèle<div class="rtpl">' + TPL.map(t => '<button type="button" class="' + (d.t === t[0] ? 'on' : '') + '" data-act="rwTpl" data-arg="' + t[0] + '">' + ico(t[2]) + '<span>' + t[1] + '</span></button>').join('') + '</div></div>' +
      '<div class="grid2"><label class="field">Nom<input name="name" value="' + esc(d.name) + '" required data-input="rwName"></label><label class="field">Niveau<select data-change="rwFloor">' + B.floors(true).map(f => '<option value="' + f.id + '"' + (f.id === d.floor ? ' selected' : '') + '>' + esc(f.name) + '</option>').join('') + '</select></label></div>' +
      '<div class="field">Image<div class="rgal"><label class="up" title="Ma photo">' + ico('upload') + '<input type="file" accept="image/*" data-change="rwPhoto" hidden></label><button type="button" class="' + (!d.img ? 'on' : '') + '" data-act="rwImg" data-arg="" title="Sans image">' + ico(d.icon) + '</button>' +
        (d.img && d.img.startsWith('data:') ? '<button type="button" class="on" title="Ma photo"><img src="' + d.img + '" alt=""></button>' : '') +
        GALLERY.map(g => '<button type="button" class="' + (d.img === roomImg(g) ? 'on' : '') + '" data-act="rwImg" data-arg="' + roomImg(g) + '"><img src="' + roomImg(g) + '" alt="" loading="lazy"></button>').join('') + '</div></div>' +
      '<div class="field">Appareils de la pièce <small class="muted">— cochez ce que vous avez, le nombre se règle avec + / −</small><div class="rdevs">' + PICK.map(k => { const n = d.devs[k] || 0; return '<div class="rdev' + (n ? ' on' : '') + '"><button type="button" class="rdt" data-act="rwTog" data-arg="' + k + '">' + ico(B.KIND[k][1]) + '<span>' + B.KIND[k][0] + '</span></button><span class="rdn"><button type="button" data-act="rwN" data-arg="' + k + '" data-v="-1" aria-label="Moins">−</button><b>' + n + '</b><button type="button" data-act="rwN" data-arg="' + k + '" data-v="1" aria-label="Plus">+</button></span></div>'; }).join('') + '</div></div>' +
      '<p class="muted" style="font-size:12px;margin:0">Les tuiles sont créées tout de suite. Reliez ensuite chaque appareil à Home Assistant depuis sa tuile (menu ⋯ de la pièce › appareil › Modifier), ou avec « Relier à Home Assistant » ci-dessous.</p>' +
      '<div class="row" style="justify-content:flex-end;gap:8px;flex-wrap:wrap"><button type="button" class="btn" data-act="rwCancel">Annuler</button><button class="btn pri">' + ico('check') + 'Créer la pièce (' + Object.values(d.devs).reduce((a, b) => a + b, 0) + ' appareils)</button></div></form>', 'roomw wide');
  }
  B.roomWizard = roomWizard;
  const rw = () => roomWizard(draft && draft.floor);
  B.act('roomAdd2', el => { draft = null; roomWizard(el.dataset.arg); });
  B.act('rwTpl', el => { const t = tpl(el.dataset.arg); Object.assign(draft, { t: t[0], name: t[0] === 'vide' ? draft.name : t[1], icon: t[2], img: roomImg(t[3]), devs: Object.assign({}, t[4]) }); rw(); });
  B.act('rwName', el => { draft.name = el.value; });
  B.act('rwFloor', el => { draft.floor = el.value; });
  B.act('rwImg', el => { draft.img = el.dataset.arg; rw(); });
  B.act('rwPhoto', el => { const f = el.files && el.files[0]; if (!f) return; const img = new Image(); img.onload = () => { const w = Math.min(1100, img.width), c = document.createElement('canvas'); c.width = w; c.height = Math.round(img.height * w / img.width); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); draft.img = c.toDataURL('image/jpeg', .85); rw(); }; img.src = URL.createObjectURL(f); });
  B.act('rwTog', el => { const k = el.dataset.arg; draft.devs[k] = draft.devs[k] ? 0 : 1; rw(); });
  B.act('rwN', el => { const k = el.dataset.arg; draft.devs[k] = Math.max(0, Math.min(9, (draft.devs[k] || 0) + +el.dataset.v)); rw(); });
  B.act('rwCancel', () => { draft = null; B.closeModal(); });
  B.act('rwSave', () => {
    const d = draft; if (!d || !d.name.trim()) return;
    const name = makeRoom({ floor: d.floor, name: d.name.trim(), icon: d.icon, img: d.img, devs: d.devs });
    draft = null; B.registerCustom(); B.save(); B.closeModal(); B.emit('fgrid'); B.emit('house');
    const f = B.floor(d.floor); if (f && B.current !== f.route) B.go(f.route); else B.show();
    B.toast('« ' + name + ' » créée', 'rooms');
  });

  /* ======================= IMPORT HOME ASSISTANT (étages, zones, appareils) ======================= */
  const USEFUL = /^(light|switch|cover|climate|media_player|fan|valve|lock|alarm_control_panel|water_heater|vacuum|lawn_mower|sensor|binary_sensor|scene)\./;
  async function readHA() {
    const H = B.HA;
    const st = await H.req('/api/states'); st.forEach(s => H.states[s.entity_id] = s);
    let floors = [], areas = [], ents = [], devs = [];
    if (!H.wsOk && H.connect) { H.connect(); await new Promise(r => setTimeout(r, 1500)); }
    if (H.wsOk) {
      const q = t => H.wsSend({ type: t }).catch(() => []);
      [floors, areas, ents, devs] = await Promise.all([q('config/floor_registry/list'), q('config/area_registry/list'), q('config/entity_registry/list'), q('config/device_registry/list')]);
    }
    const reg = {}; (ents || []).forEach(e => reg[e.entity_id] = e);
    const devArea = {}; (devs || []).forEach(d => devArea[d.id] = d.area_id);
    const fl = (floors || []).sort((a, b) => (a.level || 0) - (b.level || 0)).map(f => ({ id: f.floor_id, name: f.name, level: f.level || 0 }));
    const ar = (areas || []).map(a => ({ id: a.area_id, name: a.name, floor: a.floor_id || '' }));
    const list = st.filter(s => USEFUL.test(s.entity_id)).map(s => {
      const r = reg[s.entity_id] || {};
      if (r.hidden_by || r.disabled_by || r.entity_category) return null;
      const kind = B.guessKind(s.entity_id, s); if (!kind) return null;
      return { e: s.entity_id, name: s.attributes.friendly_name || s.entity_id, kind, area: r.area_id || devArea[r.device_id] || '' };
    }).filter(Boolean);
    const cams = st.filter(s => s.entity_id.startsWith('camera.')).map(s => ({ e: s.entity_id, name: s.attributes.friendly_name || s.entity_id }));
    return { fl, ar, list, cams };
  }
  // propose un placement : étages et zones de Home Assistant, sinon déduits des noms
  function propose(h) {
    const ICON = n => { const t = TPL.find(x => new RegExp(x[1].split(/[ /]/)[0], 'i').test(n)) || TPL.find(x => n.toLowerCase().includes(x[0])); return t ? [t[2], roomImg(t[3])] : ['homeFill', '']; };
    let floors = h.fl.length ? h.fl.map(f => ({ key: f.id, name: f.name, level: f.level })) : [{ key: 'maison', name: 'Maison', level: 0 }];
    const rooms = h.ar.map(a => { const ic = ICON(a.name); return { key: a.id, name: a.name, floor: h.fl.some(f => f.id === a.floor) ? a.floor : floors[0].key, icon: ic[0], img: ic[1], on: true }; });
    const items = h.list.map(x => { let area = x.area; if (!rooms.some(r => r.key === area)) { const r = rooms.find(r => x.name.toLowerCase().includes(r.name.toLowerCase())); area = r ? r.key : ''; } return Object.assign({}, x, { room: area || 'autres', on: true }); });
    if (items.some(x => x.room === 'autres')) rooms.push({ key: 'autres', name: 'Autres appareils', floor: floors[0].key, icon: 'layers', img: '', on: true });
    return { floors, rooms, items, cams: h.cams };
  }
  function applyPlan(p) {
    const fid = {};
    p.floors.forEach(f => { const id = uid('f'); fid[f.key] = id; C.floors.push({ id, name: f.name, level: f.level, icon: 'layers' }); });
    p.rooms.filter(r => r.on).forEach(r => {
      const its = p.items.filter(x => x.on && x.room === r.key); if (!its.length && r.key === 'autres') return;
      makeRoom({ floor: fid[r.floor], name: r.name, icon: r.icon, img: r.img, ha: its.map(x => ({ type: x.kind, name: x.name, ha: x.e })) });
    });
    // caméras : les premières caméras de Home Assistant prennent les emplacements existants
    S.camNames = S.camNames || {}; const slots = Object.keys(DATA.CAMS);
    (p.cams || []).slice(0, slots.length).forEach((c, i) => { S.settings.haMap[slots[i]] = c.e; S.camNames[slots[i]] = c.name; DATA.CAMS[slots[i]].name = c.name; });
    B.registerFloorRoutes(); B.registerCustom();
  }
  (function camNames() { Object.keys(S.camNames || {}).forEach(k => { if (DATA.CAMS[k]) DATA.CAMS[k].name = S.camNames[k]; }); })();

  /* ======================= MAISON VIERGE ======================= */
  function blank(users) {
    ['ext', 'rdc', 'e1', 'e2'].forEach(f => C.hiddenFloors[f] = true);
    Object.keys(DATA.DEVICES).forEach(id => { if (!DATA.DEVICES[id].custom) C.hidden[id] = true; });
    C.rooms = []; C.devices = []; C.floors = []; C.order = {}; C.wide = {};
    S.events = []; S.mails = []; S.journal = []; S.autos = []; S.alarm = false; S.trash = [];
    if (S.car) S.car.hidden = true;
    if (users && users.length) { S.users = users; S.user = users[0].id; }
    B.registerCustom();
  }
  if (S.car && S.car.hidden && !Object.values(S.car.ent || {}).some(Boolean)) { const nl = B.navList; B.navList = NAV => nl(NAV).filter(n => n[0] !== 'voiture'); }
  if (S.setup.mode && S.setup.mode !== 'demo' && S.car && S.car.hidden && B.car) { const r0 = B.car.row; B.car.row = () => Object.values(S.car.ent || {}).some(Boolean) ? r0() : null; }

  /* ======================= ASSISTANT DE DÉMARRAGE ======================= */
  let W = null; // état de l'assistant
  const MODES = [
    ['demo', 'sparkle', 'Démo', 'Une maison d’exemple toute prête, pour découvrir Bêta OS sans rien brancher.'],
    ['manual', 'edit', 'Manuel', 'Vous créez vos étages et vos pièces (avec modèles et images), puis cochez les appareils.'],
    ['scan', 'search2', 'Assisté', 'Bêta OS lit Home Assistant et propose un placement ; vous validez ou corrigez.'],
    ['auto', 'bolt', 'Automatique', 'Mode « flemmard » : étages, pièces et appareils repris tels quels de Home Assistant.']
  ];
  const AV = DATA.AVATARS.flatMap(g => g.items);
  function wiz() {
    const w = W, steps = w.mode === 'demo' ? ['hello', 'mode'] : ['hello', 'mode', 'users', w.mode === 'manual' ? 'floors' : 'ha'].concat(w.mode === 'scan' ? ['review'] : []);
    const st = steps[w.step] || 'hello', last = w.step >= steps.length - 1;
    let h = '';
    if (st === 'hello') h = '<div class="sw-hero"><img src="' + A + 'icon-512.png" alt=""><h2>Bienvenue dans Bêta OS</h2><p>Le tableau de bord de votre maison. En quelques étapes, on le prépare pour <b>votre</b> maison.</p>' +
      '<label class="field" style="max-width:260px;margin:6px auto 0">Langue<select data-change="swLang"><option value="fr" selected>Français</option><option value="en" disabled>English (bientôt)</option></select></label></div>';
    if (st === 'mode') h = '<h3>Comment voulez-vous commencer ?</h3><div class="sw-modes">' + MODES.map(m => '<button class="sw-mode' + (w.mode === m[0] ? ' on' : '') + '" data-act="swMode" data-arg="' + m[0] + '">' + ico(m[1]) + '<b>' + m[2] + '</b><small>' + m[3] + '</small></button>').join('') + '</div>' +
      (w.mode === 'scan' || w.mode === 'auto' ? '<p class="muted" style="font-size:12.5px;margin:10px 0 0">Il faudra l’adresse de Home Assistant et un jeton d’accès (profil › Sécurité › Jetons longue durée).</p>' : '');
    if (st === 'users') h = '<h3>Qui habite ici ?</h3><p class="muted" style="margin:0 0 10px;font-size:13px">4 profils maximum. Le premier est administrateur (réglages, pièces, droits).</p><div class="sw-users">' +
      w.users.map((u, i) => '<div class="sw-user"><button type="button" class="sw-av" data-act="swAv" data-arg="' + i + '" style="--ring:' + u.ring + '"><img src="' + u.avatar + '" alt=""></button><input value="' + esc(u.name) + '" placeholder="Prénom" data-input="swName" data-arg="' + i + '"><label class="row" style="gap:6px;font-size:12.5px"><input type="checkbox" class="ck" data-change="swAdmin" data-arg="' + i + '"' + (u.admin ? ' checked' : '') + '>Admin</label><input class="pin" inputmode="numeric" maxlength="4" placeholder="Code (option)" value="' + esc(u.pin || '') + '" data-input="swPin" data-arg="' + i + '">' + (i ? '<button type="button" class="sq" data-act="swDel" data-arg="' + i + '" aria-label="Retirer">' + ico('x') + '</button>' : '') + '</div>').join('') + '</div>' +
      (w.users.length < 4 ? '<button class="btn sm" data-act="swAdd">' + ico('plus') + 'Ajouter un profil</button>' : '');
    if (st === 'floors') h = '<h3>Vos niveaux</h3><p class="muted" style="margin:0 0 10px;font-size:13px">Touchez pour choisir. Vous ajouterez ensuite les pièces de chaque niveau.</p><div class="sw-chips">' +
      ['Extérieur', 'Sous-sol', 'RDC', 'Étage 1', 'Étage 2', 'Grenier'].concat(w.floors.filter(f => !['Extérieur', 'Sous-sol', 'RDC', 'Étage 1', 'Étage 2', 'Grenier'].includes(f))).map(f => '<button class="pinc' + (w.floors.includes(f) ? ' on' : '') + '" data-act="swFloor" data-arg="' + esc(f) + '">' + esc(f) + '</button>').join('') + '</div>' +
      '<form class="row" data-submit="swFloorAdd" style="margin-top:10px;gap:8px"><input class="search" name="n" placeholder="Autre niveau (ex. Dépendance)"><button class="btn sm">' + ico('plus') + 'Ajouter</button></form>';
    if (st === 'ha') h = '<h3>Connexion à Home Assistant</h3><div style="display:flex;flex-direction:column;gap:10px"><label class="field">Adresse<input id="swHaUrl" value="' + esc(S.settings.haUrl || '') + '" placeholder="http://192.168.1.10:8123" spellcheck="false"></label><label class="field">Jeton d’accès longue durée<input id="swHaTok" type="password" value="' + esc(S.settings.haToken || '') + '"></label>' +
      '<p class="muted" style="font-size:12px;margin:0;line-height:1.5">Home Assistant › votre profil › Sécurité › « Jetons d’accès longue durée » › Créer. Le site doit être ouvert en https si Home Assistant l’est, et Home Assistant doit autoriser cette adresse (cors_allowed_origins).</p>' +
      (w.err ? '<p class="warn">' + esc(w.err) + '</p>' : '') + (w.busy ? '<p class="muted">' + ico('refresh') + ' Lecture de votre maison…</p>' : '') + (w.plan ? '<p class="ok2">' + ico('check') + ' ' + w.plan.floors.length + ' niveau(x), ' + w.plan.rooms.length + ' pièce(s), ' + w.plan.items.length + ' appareil(s), ' + w.plan.cams.length + ' caméra(s) trouvés.</p>' : '') + '</div>';
    if (st === 'review') {
      const p = w.plan, fo = k => p.floors.map(f => '<option value="' + esc(f.key) + '"' + (f.key === k ? ' selected' : '') + '>' + esc(f.name) + '</option>').join(''), ro = k => p.rooms.map(r => '<option value="' + esc(r.key) + '"' + (r.key === k ? ' selected' : '') + '>' + esc(r.name) + '</option>').join('');
      h = '<h3>Vérifiez le placement</h3><div class="sw-review scroll">' + p.rooms.map((r, ri) => { const its = p.items.map((x, i) => [x, i]).filter(([x]) => x.room === r.key); return '<section><div class="sw-rh"><input type="checkbox" class="ck" data-change="swRoomOn" data-arg="' + ri + '"' + (r.on ? ' checked' : '') + '>' + ico(r.icon) + '<b>' + esc(r.name) + '</b><select data-change="swRoomFloor" data-arg="' + ri + '">' + fo(r.floor) + '</select><small>' + its.length + ' appareil(s)</small></div>' +
        its.map(([x, i]) => '<label class="sw-it"><input type="checkbox" class="ck" data-change="swItOn" data-arg="' + i + '"' + (x.on ? ' checked' : '') + '>' + ico(B.KIND[x.kind][1]) + '<span>' + esc(x.name) + '<small>' + esc(x.e) + '</small></span><select data-change="swItRoom" data-arg="' + i + '">' + ro(x.room) + '</select></label>').join('') + '</section>'; }).join('') + '</div>';
    }
    paint('<div class="setupw"><div class="sw-steps">' + steps.map((s, i) => '<i class="' + (i < w.step ? 'done' : i === w.step ? 'on' : '') + '"></i>').join('') + '</div><div class="sw-body">' + h + '</div>' +
      '<div class="sw-nav">' + (w.step ? '<button class="btn" data-act="swPrev">' + ico('chevL') + 'Retour</button>' : '<span></span>') +
      (st === 'ha' && !w.plan ? '<button class="btn pri" data-act="swHa"' + (w.busy ? ' disabled' : '') + '>' + ico('search2') + 'Lire ma maison</button>' : '<button class="btn pri" data-act="' + (last ? 'swDone' : 'swNext') + '"' + (st === 'mode' && !w.mode ? ' disabled' : '') + '>' + (last ? ico('check') + 'Terminer' : 'Suivant' + ico('chevR')) + '</button>') + '</div></div>', 'setup wide');
    const x = document.querySelector('.modal .box.setup .x'); if (x && !S.setup.done) x.remove();
  }
  function startWizard() { W = { step: 0, mode: '', users: [{ id: 'u1', name: '', avatar: AV[12].src, ring: AV[12].ring, admin: true, place: 'home', bat: 100 }], floors: ['RDC', 'Étage 1'] }; wiz(); }
  B.setupWizard = startWizard;
  B.act('swLang', () => { });
  B.act('swMode', el => { W.mode = el.dataset.arg; wiz(); });
  B.act('swNext', () => { if (W.step === 2 && !W.users.some(u => u.name.trim())) return B.toast('Indiquez au moins un prénom', 'user'); W.step++; wiz(); });
  B.act('swPrev', () => { W.step--; if (W.step < 3) W.plan = null; wiz(); });
  B.act('swAdd', () => { const a = AV[(W.users.length * 7) % AV.length]; W.users.push({ id: 'u' + (W.users.length + 1) + Date.now().toString(36), name: '', avatar: a.src, ring: a.ring, admin: false, place: 'home', bat: 100 }); wiz(); });
  B.act('swDel', el => { W.users.splice(+el.dataset.arg, 1); wiz(); });
  B.act('swName', el => { W.users[+el.dataset.arg].name = el.value; });
  B.act('swPin', el => { W.users[+el.dataset.arg].pin = el.value.replace(/\D/g, '').slice(0, 4); });
  B.act('swAdmin', el => { W.users[+el.dataset.arg].admin = el.checked; });
  B.act('swAv', el => { const u = W.users[+el.dataset.arg], i = AV.findIndex(a => a.src === u.avatar), a = AV[(i + 1) % AV.length]; u.avatar = a.src; u.ring = a.ring; wiz(); });
  B.act('swFloor', el => { const f = el.dataset.arg, i = W.floors.indexOf(f); i >= 0 ? W.floors.splice(i, 1) : W.floors.push(f); wiz(); });
  B.act('swFloorAdd', el => { const n = el.n.value.trim(); if (n && !W.floors.includes(n)) W.floors.push(n); wiz(); });
  B.act('swHa', async () => {
    const u = document.getElementById('swHaUrl').value.trim().replace(/\/+$/, ''), t = document.getElementById('swHaTok').value.trim();
    if (!u || !t) { W.err = 'Adresse et jeton nécessaires.'; return wiz(); }
    S.settings.haUrl = u; S.settings.haToken = t; B.save(); W.err = ''; W.busy = true; wiz();
    try { W.plan = propose(await readHA()); W.busy = false; if (!W.plan.items.length) W.err = 'Aucun appareil trouvé : vérifiez le jeton et les droits.'; }
    catch (e) { W.busy = false; W.err = 'Home Assistant ne répond pas (' + (e.message === 'Failed to fetch' ? 'adresse injoignable ou CORS' : e.message) + ').'; }
    wiz();
  });
  B.act('swRoomOn', el => { W.plan.rooms[+el.dataset.arg].on = el.checked; });
  B.act('swRoomFloor', el => { W.plan.rooms[+el.dataset.arg].floor = el.value; });
  B.act('swItOn', el => { W.plan.items[+el.dataset.arg].on = el.checked; });
  B.act('swItRoom', el => { W.plan.items[+el.dataset.arg].room = el.value; wiz(); });
  B.act('swDone', () => {
    const w = W;
    if (w.mode !== 'demo') {
      const users = w.users.filter(u => u.name.trim()).map((u, i) => Object.assign({}, u, { id: (u.name.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\W+/g, '') || 'u') + i, name: u.name.trim(), admin: u.admin || i === 0 }));
      blank(users);
      if (w.mode === 'manual') { w.floors.forEach((n, i) => C.floors.push({ id: uid('f'), name: n, level: /ext/i.test(n) ? -9 : /sous/i.test(n) ? -1 : /rdc/i.test(n) ? 0 : /grenier/i.test(n) ? 9 : (parseInt((n.match(/\d+/) || [i])[0], 10) || i), icon: /ext/i.test(n) ? 'tree' : 'layers' })); B.registerFloorRoutes(); }
      else if (w.plan) applyPlan(w.plan);
    }
    S.setup = { done: true, mode: w.mode || 'demo', at: Date.now() };
    sessionStorage.setItem('betaos.unlocked', '1'); try { localStorage.setItem('betaos.v5', JSON.stringify(S)); } catch (e) { } B.closeModal();
    const first = B.floors().find(f => f.level >= 0) || B.floors()[0];
    if (w.mode === 'manual' && first) { B.go(first.route); setTimeout(() => { B.toast('Ajoutez vos pièces : bouton « Modifier » puis « + Pièce »', 'rooms'); }, 600); }
    else B.go('accueil');
    setTimeout(() => location.reload(), w.mode === 'demo' ? 0 : 1200);
  });
  // au premier démarrage, l'assistant s'ouvre tout seul
  if (!S.setup.done) setTimeout(startWizard, 300);

  /* ======================= RÉINITIALISATION ======================= */
  B.act('resetCfg', () => B.modal('<h2>' + ico('refresh') + 'Réinitialiser Bêta OS</h2><div style="display:flex;flex-direction:column;gap:10px;font-size:14px">' +
    '<p style="margin:0;line-height:1.5">Bêta OS repart de zéro et l’assistant de démarrage se relance (Démo, Manuel, Assisté ou Automatique).</p>' +
    '<button class="btn" data-act="exportCfg">' + ico('download') + 'D’abord, télécharger une sauvegarde</button>' +
    '<button class="btn pri" data-act="resetGo" data-arg="keep">' + ico('link') + 'Réinitialiser en gardant mes connexions</button>' +
    '<button class="btn dan" data-act="resetGo" data-arg="all">' + ico('trash') + 'Tout effacer</button>' +
    '<p class="muted" style="margin:0;font-size:12px">« Garder mes connexions » conserve Home Assistant, le NAS, Plex, Google, la météo et les notifications. Le reste (pièces, appareils, profils, agenda, journal) est effacé.</p></div>', 'sm'));
  B.act('resetGo', el => {
    if (!confirm(el.dataset.arg === 'all' ? 'Tout effacer définitivement sur cet appareil ?' : 'Réinitialiser la maison (connexions gardées) ?')) return;
    if (el.dataset.arg === 'all') { localStorage.removeItem('betaos.v5'); localStorage.removeItem('betaos.device'); }
    else {
      const keepS = {}; ['haUrl', 'haToken', 'haMap', 'plexServer', 'plexToken', 'plexUrl', 'ytClient', 'ytRedir', 'city', 'lat', 'lon', 'haDoorbell', 'haMotion', 'haEnergy', 'haAlert'].forEach(k => { if (S.settings[k] != null) keepS[k] = S.settings[k]; });
      keepS.haMap = {};
      localStorage.setItem('betaos.v5', JSON.stringify({ v: 5, settings: keepS, conn: S.conn, notif: S.notif ? { to: S.notif.to } : undefined, setup: { done: false } }));
    }
    sessionStorage.removeItem('betaos.unlocked'); location.hash = ''; location.reload();
  });

  /* ======================= RÉGLAGES DE CET ÉCRAN (tablette, téléphone…) ======================= */
  const DK = 'betaos.device';
  const devCfg = () => { try { return JSON.parse(localStorage.getItem(DK) || '{}'); } catch (e) { return {}; } };
  const setDevCfg = c => { try { localStorage.setItem(DK, JSON.stringify(c)); } catch (e) { } };
  const pages = () => (B.navList ? B.navList(B.NAV) : B.NAV).filter((n, i, a) => a.findIndex(x => x[0] === n[0]) === i && !(B.navHidden && B.navHidden(n[0])));
  B.dockItems = () => { const c = devCfg(); if (c.dock && c.dock.length) return c.dock; const fl = B.floors().filter(f => f.level >= 0).concat(B.floors().filter(f => f.level < 0)).slice(0, 2).map(f => f.route); return ['accueil'].concat(fl).slice(0, 3); };
  B.startPage = () => { const c = devCfg(); return c.start && B.ROUTES[c.start] ? c.start : 'accueil'; };
  function screenCfg() {
    const c = devCfg(), dock = B.dockItems(), ps = pages();
    B.modal('<h2>' + ico('monitor') + 'Cet écran</h2><div class="scfg"><p class="muted" style="margin:0 0 6px;font-size:13px">Ces réglages ne concernent que cet appareil (' + (document.documentElement.classList.contains('fluid') ? 'téléphone' : 'tablette / ordinateur') + ') : chaque écran de la maison peut avoir les siens.</p>' +
      '<label class="field">Page qui s’ouvre en premier<select data-change="scStart">' + ps.map(n => '<option value="' + n[0] + '"' + (B.startPage() === n[0] ? ' selected' : '') + '>' + esc(n[1]) + '</option>').join('') + '</select></label>' +
      '<div class="field">Boutons épinglés dans la barre du bas (3 maximum, dans l’ordre)<div class="scpins">' + ps.filter(n => n[0] !== 'ia').map(n => { const i = dock.indexOf(n[0]); return '<button class="pinc' + (i >= 0 ? ' on' : '') + '" data-act="scPin" data-arg="' + n[0] + '">' + (i >= 0 ? '<b>' + (i + 1) + '</b>' : '') + ico(n[2]) + esc(n[1]) + '</button>'; }).join('') + '</div></div>' +
      '<label class="field">Nom de cet écran (pour s’y retrouver)<input value="' + esc(c.name || '') + '" placeholder="Tablette du salon" data-change="scName"></label>' +
      '<div class="row" style="justify-content:flex-end"><button class="btn" data-act="scReset">Valeurs par défaut</button><button class="btn pri" data-act="closeModal">' + ico('check') + 'OK</button></div></div>', 'sm');
  }
  B.screenCfg = screenCfg;
  B.act('screenCfg', screenCfg);
  B.act('scStart', el => { const c = devCfg(); c.start = el.value; setDevCfg(c); B.toast('Cet écran s’ouvrira sur « ' + el.selectedOptions[0].textContent + ' »', 'monitor'); });
  B.act('scPin', el => { const c = devCfg(), d = B.dockItems().slice(), id = el.dataset.arg, i = d.indexOf(id); if (i >= 0) d.splice(i, 1); else { if (d.length >= 3) d.shift(); d.push(id); } c.dock = d; setDevCfg(c); screenCfg(); B.show(); });
  B.act('scName', el => { const c = devCfg(); c.name = el.value.trim(); setDevCfg(c); });
  B.act('scReset', () => { setDevCfg({}); screenCfg(); B.show(); });
  // le menu du téléphone gagne « Personnaliser cet écran »
  const mn0 = B.ACT.moreNav;
  B.act('moreNav', el => { mn0(el); const g = document.querySelector('.modal .navsecs'); if (g) g.insertAdjacentHTML('beforeend', '<button class="btn scbtn" data-act="screenCfg">' + ico('edit') + 'Personnaliser cet écran (page de départ, boutons épinglés)</button>'); });
  // au lancement (sans adresse précise), on ouvre la page choisie pour cet écran
  if (!location.hash && sessionStorage.getItem('betaos.unlocked') && B.startPage() !== 'accueil') setTimeout(() => B.go(B.startPage()), 50);
  // Paramètres › Général : accès aux réglages de l'écran
  const sg0 = B.RENDER.sgen;
  B.RENDER.sgen = s => sg0(s).replace('<button type="button" class="btn sm" data-act="obStart">', '<button type="button" class="btn sm" data-act="screenCfg">' + ico('monitor') + 'Cet écran</button><button type="button" class="btn sm" data-act="setupAgain">' + ico('sparkle') + 'Assistant</button><button type="button" class="btn sm" data-act="obStart">');
  B.act('setupAgain', () => { if (!isAdmin()) return B.toast('Réservé aux administrateurs', 'lock'); B.modal('<h2>' + ico('sparkle') + 'Assistant de démarrage</h2><p style="font-size:14px;line-height:1.5;margin:0 0 12px">Pour repartir avec un autre mode (Démo, Manuel, Assisté, Automatique), réinitialisez Bêta OS : vous pouvez garder vos connexions.</p><div class="row" style="justify-content:flex-end"><button class="btn" data-act="closeModal">Annuler</button><button class="btn pri" data-act="resetCfg">' + ico('refresh') + 'Réinitialiser…</button></div>', 'sm'); });
})();

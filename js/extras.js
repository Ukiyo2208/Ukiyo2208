/* Bêta OS 6.1 — recherche globale, mode nuit automatique, Bêta IA plus futée,
   écran Absence & sécurité et visite guidée au premier lancement de chaque profil. */
(function () {
  const B = window.BOS, { S, DATA, esc, F, T, RENDER, dev, setDev, box } = B;
  const BG = 'assets/bg/generic.jpg';
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’'\-]/g, ' ');
  const isAdmin = () => !!B.user().admin;
  const visible = id => !(B.isHidden && B.isHidden(id));
  const canOn = id => { const d = DATA.DEVICES[id]; return d && 'on' in dev(id) && !['sensor', 'binary', 'scene'].includes(d.type); };
  const fname = f => ((B.floor && B.floor(f)) || {}).name || '';

  /* ======================= RECHERCHE GLOBALE ======================= */
  const PAGES = () => (B.navList ? B.navList(B.NAV) : B.NAV).concat([['absence', 'Absence & sécurité', 'shield', 'shieldCheck'], ['pieces', 'Pièces', 'rooms', 'rooms']]);
  function results(q0) {
    const q = norm(q0).trim(), words = q.split(/\s+/).filter(Boolean);
    if (!q) return [];
    const hit = txt => { const t = norm(txt); return words.every(w => t.includes(w)); };
    const out = [];
    const add = (g, icon, title, sub, act, arg, extra) => out.push({ g, icon, title, sub, act, arg, extra });
    PAGES().forEach(n => { if (hit(n[1] + ' ' + n[0])) add('Pages', n[3], n[1], 'Ouvrir la page', 'goto', n[0]); });
    (B.roomsList ? B.roomsList() : []).forEach(r => { if (hit(r.label + ' ' + fname(r.floor))) add('Pièces', r.icon, r.label, fname(r.floor) + ' · ' + r.devs.length + ' appareil' + (r.devs.length > 1 ? 's' : ''), 'roomInfo', r.name, ' data-floor="' + r.floor + '"'); });
    Object.values(DATA.DEVICES).filter(d => visible(d.id) && hit(d.name + ' ' + d.room + ' ' + fname(B.floorOf ? B.floorOf(d.id) : '') + ' ' + (B.kindOf ? (B.KIND[B.kindOf(d)] || [])[0] || '' : ''))).slice(0, 14)
      .forEach(d => add('Appareils', B.iconOf ? B.iconOf(d) : 'power', d.name, d.room + ' · ' + (B.stateText ? B.stateText(d, dev(d.id)) : ''), 'srchDev', d.id, canOn(d.id) ? '' : null));
    (S.routines || []).forEach(r => { if (hit(r.name + ' routine')) add('Routines', 'wand', r.name, 'Lancer la routine', 'srchRoutine', r.id); });
    DATA.RADIOS.forEach(r => { if (hit(r.name + ' radio')) add('Musique', 'radio', r.name, 'Radio', 'srchPlay', r.id); });
    S.playlists.forEach(p => { if (hit(p.name + ' playlist')) add('Musique', 'musicFill', p.name, 'Playlist', 'srchPlay', p.id); });
    (B.Plex ? B.Plex.all() : []).forEach(p => { if (hit(p.title + ' ' + (p.genre || '') + ' ' + (p.kind || ''))) add('Films & séries', 'film', p.title, (p.kind || '') + (p.year ? ' · ' + p.year : ''), 'srchPlex', p.id); });
    S.mails.forEach(m => { if (hit(m.from + ' ' + m.subj + ' ' + (m.body || ''))) add('Mails', 'mail', m.subj, m.from + ' · ' + m.time, 'srchMail', m.id); });
    S.events.slice().sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).forEach(e => { if (hit(e.title + ' ' + (e.place || ''))) add('Agenda', 'calendar', e.title, F.dayMonth(new Date(e.date + 'T12:00')) + ' · ' + e.time, 'srchEvent', e.date); });
    return out.slice(0, 40);
  }
  RENDER.srch = () => {
    const q = srchQ, list = results(q);
    if (!q.trim()) return '<div class="srchempty"><p class="muted">Appareils, pièces, pages, radios, films, mails, agenda…</p><div class="row" style="flex-wrap:wrap;gap:6px">' + ['salon', 'volet', 'clim', 'radio', 'garage', 'yoga'].map(x => '<button class="chip" data-act="srchFill" data-arg="' + x + '">' + x + '</button>').join('') + '</div></div>';
    if (!list.length) return '<div class="srchempty"><p class="muted">Rien trouvé pour « ' + esc(q) + ' ».</p><button class="btn pri" data-act="srchIA">' + ico('sparkle') + 'Demander à Bêta IA</button></div>';
    let g0 = '', html = '';
    list.forEach((r, i) => {
      if (r.g !== g0) { html += '<h4>' + r.g + '</h4>'; g0 = r.g; }
      const sw = r.act === 'srchDev' && r.extra === '' ? '<button class="sw sm' + (dev(r.arg).on ? ' on' : '') + '" data-act="srchToggle" data-arg="' + r.arg + '" aria-label="Allumer / éteindre"></button>' : '';
      html += '<div class="sres' + (i ? '' : ' first') + '"><button class="sgo" data-act="' + r.act + '" data-arg="' + esc(r.arg) + '"' + (r.extra || '') + '>' + ico(r.icon) + '<span><b>' + esc(r.title) + '</b><small>' + esc(r.sub) + '</small></span></button>' + sw + '</div>';
    });
    return html + '<button class="btn sm" data-act="srchIA" style="margin-top:8px">' + ico('sparkle') + 'Demander « ' + esc(q) + ' » à Bêta IA</button>';
  };
  let srchQ = '';
  function openSearch() {
    srchQ = '';
    B.modal('<form class="srchbox" data-submit="srchGo">' + ico('search2') + '<input name="q" placeholder="Rechercher dans la maison…" autocomplete="off" enterkeyhint="search" data-input="srchType" aria-label="Rechercher"><kbd class="hide-fluid">Échap</kbd></form><div class="srchres scroll">' + T({ t: 'srch', keys: ['srch'] }) + '</div>', 'gsearch');
    setTimeout(() => { const i = document.querySelector('.srchbox input'); if (i) i.focus(); }, 60);
  }
  B.search = openSearch;
  B.act('search', openSearch);
  B.act('srchType', el => { srchQ = el.value; B.emit('srch'); });
  B.act('srchFill', el => { const i = document.querySelector('.srchbox input'); i.value = srchQ = el.dataset.arg; B.emit('srch'); i.focus(); });
  B.act('srchGo', () => { const f = document.querySelector('.sres.first .sgo'); if (f) f.click(); else if (srchQ.trim()) B.ACT.srchIA(); });
  const leave = fn => { B.closeModal(); setTimeout(fn, 60); };
  B.act('srchDev', el => leave(() => B.panel.open(el.dataset.arg)));
  B.act('srchToggle', (el, e) => { e.stopPropagation(); const id = el.dataset.arg; if (B.canUse && !B.canUse(id)) return B.toast('Vous n’avez pas le droit de piloter cet appareil', 'lock'); setDev(id, { on: !dev(id).on }); B.emit('srch'); });
  B.act('srchRoutine', el => leave(() => B.runRoutine(el.dataset.arg)));
  B.act('srchPlay', el => leave(() => B.Music.play(el.dataset.arg)));
  B.act('srchPlex', el => leave(() => { S.plexSel = el.dataset.arg; B.save(); B.go('plex'); }));
  B.act('srchMail', el => leave(() => { S.openMail = el.dataset.arg; B.save(); B.go('mails'); }));
  B.act('srchEvent', el => leave(() => { B.calGoto ? B.calGoto(el.dataset.arg) : B.go('calendrier'); }));
  B.act('srchIA', () => { const q = srchQ.trim(); leave(() => { if (q) B.askIA(q); B.ACT.iaOpen && B.ACT.iaOpen(); }); });
  // roomInfo / goto depuis la recherche : on ferme d'abord la fenêtre
  ['roomInfo', 'goto'].forEach(n => { const f = B.ACT[n]; if (f) B.ACT[n] = (el, e) => { if (el.closest('.srchres')) { B.closeModal(); } return f(el, e); }; });
  if (!B.ACT.goto) B.act('goto', el => { B.closeModal(); B.go(el.dataset.arg); });
  document.addEventListener('keydown', e => {
    if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !e.target.closest('input,textarea,select'))) { e.preventDefault(); if (B.current !== 'verrou') openSearch(); }
  });

  /* ======================= MODE NUIT AUTOMATIQUE ======================= */
  if (!S.settings.night) S.settings.night = { on: true, from: '23:00', to: '06:30', dim: 75, mute: true, idle: 60 };
  const N = () => S.settings.night;
  const mins = t => { const [h, m] = String(t || '0:0').split(':').map(Number); return h * 60 + (m || 0); };
  function nightNow() {
    if (!N().on) return false;
    const d = new Date(), n = d.getHours() * 60 + d.getMinutes(), a = mins(N().from), b = mins(N().to);
    return a <= b ? n >= a && n < b : n >= a || n < b;
  }
  B.nightNow = nightNow;
  let veil, idleT, forced = false;
  function veilHTML() {
    const d = new Date();
    return '<div class="nv-in"><b>' + F.time(d) + '</b><span>' + esc(F.dayMonth ? F.dayMonth(d) : '') + ' · ' + B.WX.now.temp + '°</span><small>' + ico('moon') + 'Mode nuit · touchez pour réveiller</small></div>';
  }
  function sleep() {
    if (veil || document.querySelector('.modal, .rpanel, .fpanel:not(.min)')) return;
    veil = document.createElement('div'); veil.className = 'nightveil'; veil.style.setProperty('--dim', (N().dim || 75) / 100);
    veil.innerHTML = veilHTML(); document.body.appendChild(veil);
    requestAnimationFrame(() => veil && veil.classList.add('on'));
    veil._t = setInterval(() => { if (veil) veil.innerHTML = veilHTML(); }, 30000);
    // le premier toucher réveille seulement l'écran, sans déclencher de bouton
    const wake = e => { e.preventDefault(); e.stopPropagation(); awake(); };
    veil.addEventListener('pointerdown', wake); veil.addEventListener('click', wake);
  }
  function awake() { if (!veil) return arm(); const v = veil; veil = null; forced = false; clearInterval(v._t); v.classList.remove('on'); setTimeout(() => v.remove(), 400); arm(); }
  function arm() { clearTimeout(idleT); if (forced || !nightNow()) return; idleT = setTimeout(sleep, (N().idle || 60) * 1000); }
  ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(ev => document.addEventListener(ev, () => { if (!veil) arm(); }, { passive: true, capture: true }));
  setInterval(() => { document.documentElement.classList.toggle('nightmode', nightNow()); if (!veil) arm(); else if (!nightNow() && !forced) awake(); }, 60000);
  document.documentElement.classList.toggle('nightmode', nightNow()); arm();
  // sons coupés la nuit (la sonnette et les alertes restent audibles)
  if (B.fx) { const s0 = B.fx.sound; B.fx.sound = k => { if (nightNow() && N().mute && !['dingdong', 'alarm', 'alert'].includes(k)) return; return s0(k); }; }
  B.act('nightCfg', () => {
    const n = N();
    B.modal('<h2>' + ico('moon') + 'Mode nuit automatique</h2><form data-submit="nightSave" style="display:flex;flex-direction:column;gap:12px;font-size:14px">' +
      '<label class="row" style="gap:10px"><input type="checkbox" name="on"' + (n.on ? ' checked' : '') + ' class="ck">Activer le mode nuit</label>' +
      '<div class="grid2"><label class="field">De<input type="time" name="from" value="' + n.from + '"></label><label class="field">À<input type="time" name="to" value="' + n.to + '"></label></div>' +
      '<label class="field">Assombrir après (secondes sans toucher)<input type="number" name="idle" min="10" max="900" step="5" value="' + n.idle + '"></label>' +
      '<label class="field">Intensité de l’assombrissement · ' + n.dim + ' %<input type="range" class="range thin" name="dim" min="30" max="95" value="' + n.dim + '" style="--p:' + n.dim + '%" oninput="this.style.setProperty(\'--p\',this.value+\'%\')"></label>' +
      '<label class="row" style="gap:10px"><input type="checkbox" name="mute"' + (n.mute ? ' checked' : '') + ' class="ck">Couper les sons la nuit (sauf sonnette et alertes)</label>' +
      '<div class="row" style="justify-content:flex-end;flex-wrap:wrap"><button type="button" class="btn" data-act="nightTry">' + ico('moon') + 'Essayer</button><button class="btn pri">' + ico('check') + 'Enregistrer</button></div></form>', 'sm');
  });
  B.act('nightSave', el => { const f = new FormData(el); Object.assign(N(), { on: !!f.get('on'), from: f.get('from') || '23:00', to: f.get('to') || '06:30', idle: Math.max(10, +f.get('idle') || 60), dim: +f.get('dim') || 75, mute: !!f.get('mute') }); B.save(); B.closeModal(); arm(); document.documentElement.classList.toggle('nightmode', nightNow()); B.toast(N().on ? 'Mode nuit de ' + N().from + ' à ' + N().to : 'Mode nuit désactivé', 'moon'); });
  B.act('nightTry', () => { B.closeModal(); forced = true; setTimeout(sleep, 300); });
  B.nightSleep = () => { forced = true; sleep(); };
  /* fond d'écran du téléphone : celui de Bêta OS ou une photo à soi */
  const mbg = () => { if (S.settings.mbg) document.documentElement.style.setProperty('--mbg', 'url("' + S.settings.mbg + '")'); else document.documentElement.style.removeProperty('--mbg'); };
  mbg();
  B.act('mbgPick', el => {
    const f = el.files && el.files[0]; el.value = ''; if (!f) return;
    const img = new Image(), url = URL.createObjectURL(f);
    img.onload = () => {
      const k = Math.min(1, 1290 / img.width), c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      S.settings.mbg = c.toDataURL('image/jpeg', .84); B.save(); mbg(); B.emit('sfx'); B.toast('Fond d’écran du téléphone changé', 'photo');
    };
    img.src = url;
  });
  B.act('mbgReset', () => { delete S.settings.mbg; B.save(); mbg(); B.emit('sfx'); B.toast('Fond d’écran Bêta OS rétabli', 'photo'); });
  const sfx0 = RENDER.sfx;
  RENDER.sfx = s => sfx0(s).replace('<div class="row" style="margin-top:auto;gap:8px;flex-wrap:wrap">', '<div class="row" style="margin-top:auto;gap:8px;flex-wrap:wrap"><label class="btn sm" style="cursor:pointer" title="Fond d’écran sur téléphone">' + ico('photo') + 'Fond tél.<input type="file" accept="image/*" data-change="mbgPick" hidden></label>' + (S.settings.mbg ? '<button class="btn sm" data-act="mbgReset" title="Fond Bêta OS">' + ico('refresh') + '</button>' : '') + '<button class="btn sm" data-act="nightCfg">' + ico('moon') + 'Mode nuit' + (N().on ? ' · ' + N().from + '–' + N().to : ' · off') + '</button>');

  /* ======================= BÊTA IA PLUS FUTÉE ======================= */
  const VERB = /^(?:et\s+)?(allume|eteins|eteint|eteindre|ferme|fermer|ouvre|ouvrir|baisse|monte|leve|descend|mets|met|regle|lance|joue|coupe|active|desactive|arrete|stop|demarre|passe|augmente|diminue)\b/;
  const FLOOR_RE = /\b(?:a |au |de |du |dans |sur )?(?:l |la |le )?(?:etage ?[12]|1er|premier etage|deuxieme etage|rdc|rez de chaussee|exterieur|jardin|dehors|terrasse|cour)\b/g;
  const roomNames = () => Array.from(new Set(Object.values(DATA.DEVICES).map(d => norm(d.room)))).sort((a, b) => b.length - a.length);
  function placeOf(q) {
    const r = roomNames().find(n => q.includes(n)); if (r) return r;
    const m = q.match(/etage ?[12]|1er|premier etage|deuxieme etage|rdc|rez de chaussee|exterieur|jardin|dehors|terrasse|cour/); return m ? m[0] : '';
  }
  const stripPlace = q => { let t = q.replace(FLOOR_RE, ' '); roomNames().forEach(n => { t = t.split(n).join(' '); }); return t.replace(/\b(dans|de|du|au|a) (la |le |l )?\s*$/, ' ').replace(/\s+/g, ' ').trim(); };
  let last = null; // dernière commande comprise (pour « et dans la chambre ? »)
  const failed = r => /^Je n’ai pas compris/.test(r);
  function journalQ(q) {
    if (!/^(qui|quand|a quelle heure)\b|qu est ce qui s est passe|que s est il passe|historique|derniere fois/.test(q)) return null;
    const now = new Date(), d0 = new Date(now); d0.setHours(0, 0, 0, 0);
    let from = +d0 - 6 * 864e5, to = Date.now(), when = 'cette semaine';
    if (/hier/.test(q)) { from = +d0 - 864e5; to = +d0; when = 'hier'; }
    else if (/aujourd|ce matin|ce soir|cet apres/.test(q)) { from = +d0; when = 'aujourd’hui'; }
    else if (/cette nuit/.test(q)) { from = +d0 - 6 * 36e5; to = +d0 + 8 * 36e5; when = 'cette nuit'; }
    let list = (S.journal || []).filter(e => e.t >= from && e.t < to);
    const A = [[/ouvert|ouvre|leve/, ['open', 'unlock', 'on']], [/ferme|baisse/, ['close', 'lock', 'off']], [/allume/, ['on']], [/eteint|eteind|coupe/, ['off']], [/verrouill/, ['lock']], [/lance|demarre|joue|ecoute/, ['run', 'status', 'play']], [/regle|mis|mets|change/, ['temp', 'pos', 'mode', 'hvac', 'bri', 'color']]];
    const a = A.find(x => x[0].test(q)); if (a) list = list.filter(e => a[1].includes(e.a));
    // appareils évoqués : on garde ceux dont le nom ou la pièce correspond le mieux
    const words = q.split(/\s+/).filter(w => w.length > 2 && !/^(qui|quand|est|hier|les|des|aujourd|semaine|cette|nuit|heure|quelle|derniere|fois|passe|hui|ouvert|ferme|allume|eteint|lumiere)$/.test(w));
    const lum = /lumiere|lampe|eclairage/.test(q);
    const score = e => { const t = norm(e.n + ' ' + e.r); return words.filter(w => t.includes(w.replace(/s$/, ''))).length + (lum && DATA.DEVICES[e.d] && DATA.DEVICES[e.d].type === 'light' ? 1 : 0); };
    const best = list.reduce((m, e) => Math.max(m, score(e)), 0);
    if (words.length && best) list = list.filter(e => score(e) === best);
    else if (lum) list = list.filter(e => DATA.DEVICES[e.d] && DATA.DEVICES[e.d].type === 'light');
    if (!list.length) return 'Je ne vois rien de tel dans le journal ' + when + '.';
    if (/qu est ce qui s est passe|que s est il passe|historique/.test(q) && !words.length) {
      const by = {}; list.forEach(e => { by[e.un] = (by[e.un] || 0) + 1; });
      return list.length + ' action' + (list.length > 1 ? 's' : '') + ' ' + when + ' : ' + Object.keys(by).map(k => k + ' (' + by[k] + ')').join(', ') + '. Dernière : ' + list[0].un + ' — ' + list[0].n + ' ' + list[0].txt + ' à ' + F.time(new Date(list[0].t)) + '.';
    }
    const fmt = e => { const d = new Date(e.t), day = d >= d0 ? '' : (+d >= +d0 - 864e5 ? 'hier ' : F.d3(d) + ' '); return e.un + ' (' + e.n + ' · ' + e.r + ', ' + e.txt + ', ' + day + 'à ' + F.time(d) + (e.src && e.src !== 'ui' ? ', via ' + ({ ia: 'Bêta IA', routine: 'une routine', auto: 'un automatisme', ha: 'Home Assistant', scene: 'une action rapide', timer: 'la minuterie' }[e.src] || e.src) : '') + ')'; };
    if (/^quand|a quelle heure|derniere fois/.test(q)) return 'La dernière fois : ' + fmt(list[0]) + '.';
    const uniq = list.slice(0, 4);
    return (when === 'cette semaine' ? 'Cette semaine : ' : when.charAt(0).toUpperCase() + when.slice(1) + ' : ') + uniq.map(fmt).join(' ; ') + (list.length > 4 ? ' … et ' + (list.length - 4) + ' autre(s).' : '.');
  }
  function sensorQ(q) {
    if (!/(quelle|combien).*(temperature|degre|humidite)|il fait combien|temperature (du|de la|dans)/.test(q) || /dehors|exterieur|meteo/.test(q)) return null;
    const pl = placeOf(q); if (!pl) return null;
    const ds = Object.values(DATA.DEVICES).filter(d => norm(d.room) === pl || norm(d.room).includes(pl));
    const hum = /humidite/.test(q);
    const s = ds.map(d => dev(d.id)).find(st => hum ? st.curhum != null || (st.unit === '%' && st.val != null) : st.cur != null || (st.unit === '°C' && st.val != null));
    const cl = ds.find(d => d.type === 'clim');
    if (!s && cl && !hum) return 'Pas de sonde dans cette pièce ; la climatisation (' + cl.room + ') est ' + (dev(cl.id).on ? 'réglée sur ' + String(dev(cl.id).temp).replace('.', ',') + ' °C' : 'à l’arrêt') + '.';
    if (!s) return 'Je n’ai pas de capteur ' + (hum ? 'd’humidité' : 'de température') + ' dans cette pièce.';
    const v = hum ? (s.curhum != null ? s.curhum : s.val) : (s.cur != null ? s.cur : s.val);
    return (hum ? 'Humidité : ' + v + ' %' : 'Il fait ' + String(v).replace('.', ',') + ' °C') + ' (' + ds[0].room + ').';
  }
  // « éteins la cuisine » = les lumières de la cuisine
  const OBJ = /lumi|lampe|eclair|tout|volet|store|clim|chauff|tv|tele|radio|musique|playlist|arrosage|tondeuse|aspirateur|robot|garage|alarme|ventil|prise|ordi|ampli|machine|lave/;
  const fill = c => /^(?:et )?(allume|eteins|eteint|eteindre)\b/.test(c) && !OBJ.test(c) && placeOf(c) ? c.replace(/^((?:et )?\w+)/, '$1 les lumieres') : c;
  function iaX(text) {
    const raw = text.trim(), q = fill(norm(raw));
    const j = journalQ(q) || sensorQ(q); if (j) return j;
    if (/https?:\/\//.test(raw)) return B.ia(raw);
    // « et dans la chambre ? » : on reprend la dernière commande avec le nouveau lieu
    if (/^et\b/.test(q) && !VERB.test(q) && last && placeOf(q)) { const cmd = fill(stripPlace(last) + ' ' + q.replace(/^et\s+/, '').replace(/\?/g, '')); const r = B.ia(cmd); if (!failed(r)) { last = cmd; return r; } }
    // plusieurs ordres : « éteins le salon et ferme les volets, puis lance la radio »
    const parts = raw.split(/\s*(?:,|;|\bpuis\b|\bensuite\b|\bet\b|\bainsi que\b)\s*/i).map(s => s.trim()).filter(s => s.length > 1);
    if (parts.length < 2) { const r = B.ia(q === norm(raw) ? raw : q); if (!failed(r)) last = q; return r; }
    let prev = '', prevPlace = '';
    const cmds = parts.map(p => {
      let c = norm(p);
      if (!VERB.test(c) && prev && placeOf(c)) c = stripPlace(prev) + ' ' + c;          // « … du salon et de la cuisine »
      else if (!placeOf(c) && prevPlace && VERB.test(c)) c = c + ' ' + prevPlace; // le lieu reste celui de la phrase
      c = fill(c); prev = c; prevPlace = placeOf(c) || prevPlace; return c;
    });
    const out = cmds.map(c => B.ia(c));
    if (out.some(failed)) { const r = B.ia(raw); if (!failed(r)) { last = q; return r; } }
    last = cmds[cmds.length - 1];
    return out.filter(r => !failed(r)).join(' ') || out[0];
  }
  B.iaX = iaX;

  /* ======================= ABSENCE & SÉCURITÉ ======================= */
  const byType = (...t) => Object.values(DATA.DEVICES).filter(d => t.includes(d.type) && visible(d.id));
  const kind = d => B.kindOf ? B.kindOf(d) : d.type;
  const stillOn = () => Object.values(DATA.DEVICES).filter(d => visible(d.id) && ['light', 'group', 'power', 'app', 'clim', 'fan', 'heater', 'media', 'charger'].includes(d.type) && dev(d.id).on && !d.id.startsWith('ext.'));
  const openings = () => Object.values(DATA.DEVICES).filter(d => visible(d.id) && ((d.type === 'cover' && kind(d) !== 'awning' && dev(d.id).pos > 0) || (d.type === 'binary' && kind(d) === 'door' && dev(d.id).on) || (d.type === 'lock' && dev(d.id).locked === false)));
  const home = () => S.users.filter(u => u.place === 'home');
  RENDER.abscams = () => '<div class="abscams">' + Object.keys(DATA.CAMS).slice(0, 4).map(id => T({ t: 'cam', cam: id, tile: true, keys: ['cam:' + id] })).join('') + '</div>';
  RENDER.abssec = () => {
    const al = byType('alarm'), lk = byType('lock'), op = openings(), garage = DATA.DEVICES['rdc.garage.door'];
    const row = (icon, title, sub, cls, btn) => '<div class="li absrow"><span class="aico ' + (cls || '') + '">' + ico(icon) + '</span><div><b>' + title + '</b><small>' + sub + '</small></div>' + (btn || '') + '</div>';
    const alarmOn = al.length ? al.some(d => dev(d.id).mode && dev(d.id).mode !== 'disarmed') : !!S.alarm;
    return '<div class="list scroll" style="flex:1">' +
      row('shieldCheck', 'Alarme' + (al.length ? ' (' + esc(al[0].name) + ')' : ''), alarmOn ? 'Activée — la maison est sous surveillance' : 'Désactivée', alarmOn ? 'g' : 'w', '<button class="sw' + (alarmOn ? ' on' : '') + '" data-act="absAlarm" aria-label="Alarme"></button>') +
      lk.map(d => row('lock', esc(d.name), esc(d.room) + ' · ' + (dev(d.id).locked === false ? 'déverrouillée' : 'verrouillée'), dev(d.id).locked === false ? 'w' : 'g', '<button class="btn sm" data-act="absLock" data-arg="' + d.id + '">' + (dev(d.id).locked === false ? 'Verrouiller' : 'Ouvrir') + '</button>')).join('') +
      (garage ? row('garage', 'Porte du garage', dev(garage.id).pos > 0 ? 'Ouverte à ' + dev(garage.id).pos + ' %' : 'Fermée', dev(garage.id).pos > 0 ? 'w' : 'g', dev(garage.id).pos > 0 ? '<button class="btn sm" data-act="absClose" data-arg="' + garage.id + '">Fermer</button>' : '') : '') +
      row('blinds', 'Ouvertures', op.length ? op.filter(d => d.id !== 'rdc.garage.door').map(d => esc(d.room + ' · ' + d.name)).join(', ') || 'Tout est fermé' : 'Tout est fermé', op.filter(d => d.id !== 'rdc.garage.door').length ? 'w' : 'g', op.some(d => d.type === 'cover' && d.id !== 'rdc.garage.door') ? '<button class="btn sm" data-act="absCovers">Tout fermer</button>' : '') +
      row('motion', 'Mouvements', Object.keys(DATA.CAMS).filter(id => B.camEv(id).dot).map(id => DATA.CAMS[id].name).join(', ') || 'Rien à signaler', Object.keys(DATA.CAMS).some(id => B.camEv(id).dot === 'red') ? 'w' : 'g') +
      byType('binary').filter(d => kind(d) === 'leak' || kind(d) === 'motion').map(d => row(kind(d) === 'leak' ? 'dropFill' : 'motion', esc(d.name), esc(d.room) + ' · ' + (dev(d.id).on ? (kind(d) === 'leak' ? 'fuite détectée !' : 'mouvement') : 'calme'), dev(d.id).on ? 'w' : 'g')).join('') +
      '</div>';
  };
  RENDER.abson = () => {
    const l = stillOn();
    return '<div style="display:flex;flex-direction:column;gap:10px;flex:1;min-height:0"><div class="list scroll" style="flex:1">' + (l.length ? l.map(d => '<div class="li absrow"><span class="aico w">' + ico(B.iconOf ? B.iconOf(d) : 'power') + '</span><div><b>' + esc(d.name) + '</b><small>' + esc(d.room) + ' · ' + esc(fname(B.floorOf(d.id))) + '</small></div><button class="sw on" data-act="absOff" data-arg="' + d.id + '" aria-label="Éteindre"></button></div>').join('') : '<p class="muted" style="text-align:center;margin-top:30px">' + ico('check') + ' Tout est éteint dans la maison.</p>') + '</div>' +
      (l.length ? '<button class="btn pri" data-act="absAllOff">' + ico('power') + 'Tout éteindre (' + l.length + ')</button>' : '') + '</div>';
  };
  RENDER.abswho = () => '<div class="abswho">' + S.users.map(u => { const p = DATA.PLACES[u.place] || DATA.PLACES.away; return '<div class="tile' + (u.place === 'home' ? ' in' : '') + '"><img src="' + esc(u.avatar) + '" alt="" style="--ring:' + esc(u.ring) + '"><b>' + esc(u.name) + '</b><small style="color:' + p.color + '">' + ico(p.icon) + esc(p.label) + '</small></div>'; }).join('') + '</div>' +
    '<p class="muted" style="font-size:12.5px;margin:10px 0 0">' + (home().length ? home().length + ' personne' + (home().length > 1 ? 's' : '') + ' à la maison.' : 'Personne à la maison.') + (B.HA.enabled() ? ' Position via Home Assistant (person.*).' : ' Position modifiable dans Paramètres › Profils.') + '</p>';
  RENDER.absmode = () => {
    const h = B.house(), sim = !!S.presenceSim;
    return '<div style="display:flex;flex-direction:column;gap:12px;flex:1">' +
      '<div class="absbig">' + ico('bolt') + '<div><b>' + h.kw.toFixed(1).replace('.', ',') + ' kW</b><small>consommation · solaire ' + B.solarNow().toFixed(1).replace('.', ',') + ' kW</small></div></div>' +
      '<label class="row absrow2"><button type="button" class="sw sm' + (sim ? ' on' : '') + '" data-act="absSim" aria-label="Simulation de présence"></button><span><b>Simulation de présence</b><small>Allume quelques lumières le soir quand personne n’est là</small></span></label>' +
      '<div class="row" style="margin-top:auto;flex-wrap:wrap;gap:8px"><button class="btn pri" data-act="absLeave">' + ico('walk') + 'Je pars : tout sécuriser</button><button class="btn" data-act="absBack">' + ico('homeFill') + 'Je rentre</button></div></div>';
  };
  B.act('absAlarm', () => {
    const al = byType('alarm');
    if (al.length) { const on = al.some(d => dev(d.id).mode && dev(d.id).mode !== 'disarmed'); if (B.canUse && !B.canUse(al[0].id)) return B.toast('Réservé aux administrateurs', 'lock'); al.forEach(d => setDev(d.id, { mode: on ? 'disarmed' : 'armed_away' })); }
    else { S.alarm = !S.alarm; B.save(); }
    B.emit('house'); B.emit('abs'); B.toast(S.alarm || byType('alarm').some(d => dev(d.id).mode !== 'disarmed') ? 'Alarme activée' : 'Alarme désactivée', 'shieldCheck');
  });
  B.act('absLock', el => { const id = el.dataset.arg; if (B.canUse && !B.canUse(id)) return B.toast('Réservé aux administrateurs', 'lock'); setDev(id, { locked: dev(id).locked === false }); B.emit('abs'); });
  B.act('absClose', el => { const id = el.dataset.arg; if (B.canUse && !B.canUse(id)) return B.toast('Vous n’avez pas le droit de piloter la porte du garage', 'lock'); setDev(id, { pos: 0 }); B.emit('abs'); });
  B.act('absCovers', () => { openings().filter(d => d.type === 'cover' && d.id !== 'rdc.garage.door').forEach(d => setDev(d.id, { pos: 0 })); B.emit('abs'); B.toast('Volets fermés', 'blinds'); });
  B.act('absOff', el => { setDev(el.dataset.arg, { on: false }); B.emit('abs'); });
  B.act('absAllOff', () => { const l = stillOn(); l.forEach(d => setDev(d.id, { on: false })); B.emit('abs'); B.toast(l.length + ' appareil' + (l.length > 1 ? 's' : '') + ' éteint' + (l.length > 1 ? 's' : ''), 'power'); });
  B.act('absSim', el => { S.presenceSim = !S.presenceSim; B.save(); el.classList.toggle('on', S.presenceSim); B.toast(S.presenceSim ? 'Simulation de présence activée' : 'Simulation de présence coupée', 'bulb'); });
  B.act('absLeave', () => {
    B.src = 'scene';
    stillOn().filter(d => ['light', 'group', 'power', 'app', 'fan', 'media'].includes(d.type) && !/frigo|congel|box|nas/i.test(d.name)).forEach(d => setDev(d.id, { on: false }));
    if (DATA.DEVICES['rdc.garage.door'] && dev('rdc.garage.door').pos > 0 && (!B.canUse || B.canUse('rdc.garage.door'))) setDev('rdc.garage.door', { pos: 0 });
    byType('lock').forEach(d => { if (!B.canUse || B.canUse(d.id)) setDev(d.id, { locked: true }); });
    const al = byType('alarm'); if (al.length) { if (!B.canUse || B.canUse(al[0].id)) al.forEach(d => setDev(d.id, { mode: 'armed_away' })); } else S.alarm = true;
    const u = S.users.find(x => x.id === B.user().id); if (u) u.place = 'away';
    B.src = null; B.save(); B.emit('house'); B.emit('abs'); B.emit('users');
    B.toast('Maison sécurisée : lumières éteintes, garage fermé, alarme activée. À bientôt !', 'shieldCheck');
  });
  B.act('absBack', () => {
    const al = byType('alarm'); if (al.length) al.forEach(d => setDev(d.id, { mode: 'disarmed' })); else S.alarm = false;
    const u = S.users.find(x => x.id === B.user().id); if (u) u.place = 'home';
    const r = (S.routines || []).find(x => x.id === 'retour'); if (r) B.runRoutine('retour', true);
    B.save(); B.emit('house'); B.emit('abs'); B.emit('users'); B.toast('Bon retour à la maison !', 'homeFill');
  });
  // simulation de présence : le soir, quand personne n'est à la maison
  setInterval(() => {
    if (!S.presenceSim || home().length) return;
    const h = new Date().getHours(); if (!(B.isNight() && h >= 17 && h < 23)) { if (h >= 23 || h < 6) { const l = byType('light').filter(d => !d.id.startsWith('ext.') && dev(d.id).on && dev(d.id).sim); l.forEach(d => setDev(d.id, { on: false, sim: false }, { silent: false })); } return; }
    const l = byType('light').filter(d => /^(rdc|e1)\./.test(d.id)); if (!l.length) return;
    const d = l[Math.floor(Math.random() * l.length)]; B.src = 'auto'; setDev(d.id, { on: !dev(d.id).on, sim: true }); B.src = null;
  }, 8 * 6e4);
  B.route('absence', { title: 'Absence', bg: BG, render: () => B.side('absence') + B.header({ id: 'absence', title: 'Absence', sub: 'Sécurité : tout vérifier avant de partir', icon: 'shieldCheck', info: { t: 'infobox', keys: ['house', 'abs', 'users'], items: () => {
    const al = byType('alarm'), on = al.length ? al.some(d => dev(d.id).mode && dev(d.id).mode !== 'disarmed') : !!S.alarm;
    return [{ icon: 'shieldCheck', v: on ? 'Activée' : 'Off', l: 'Alarme', cls: on ? 'g' : 'p' }, { icon: 'bulb', v: stillOn().length, l: 'Encore allumés' }, { icon: 'blinds', v: openings().length, l: 'Ouvertures' }, { icon: 'family', v: home().length, l: 'À la maison', cls: 'c' }];
  } } }) +
    '<section class="card pcard abs" style="' + box([105, 235, 830, 640]) + '">' + B.whead('shield', 'Caméras') + T({ t: 'abscams' }) + '</section>' +
    '<section class="card pcard abs" style="' + box([840, 235, 1522, 640]) + '">' + B.whead('shield', 'Sécurité') + T({ t: 'abssec', keys: ['house', 'abs'] }) + '</section>' +
    '<section class="card pcard abs" style="' + box([105, 650, 560, 1012]) + '">' + B.whead('users', 'Qui est là ?') + T({ t: 'abswho', keys: ['users'] }) + '</section>' +
    '<section class="card pcard abs" style="' + box([570, 650, 1040, 1012]) + '">' + B.whead('power', 'Encore allumé') + T({ t: 'abson', keys: ['house', 'abs'] }) + '</section>' +
    '<section class="card pcard abs" style="' + box([1050, 650, 1522, 1012]) + '">' + B.whead('battery', 'Mode absence') + T({ t: 'absmode', keys: ['house', 'abs'] }) + '</section>' });
  B.on('dev', () => B.emit('abs'));
  // « Absence » dans le menu (fenêtre « Toutes les pages » et barre latérale réduite)
  const nl0 = B.navList;
  B.navList = NAV => { const out = (nl0 ? nl0(NAV) : NAV).slice(); const i = out.findIndex(n => n[0] === 'parametres'); out.splice(i < 0 ? out.length : i, 0, ['absence', 'Absence', 'shield', 'shieldCheck', 'noside']); return out; };

  /* ======================= VISITE GUIDÉE (profils existants) ======================= */
  if (!S.onboard) S.onboard = {};
  let step = 0;
  const STEPS = () => {
    const u = B.user(), adm = isAdmin();
    const st = [
      () => '<div class="ob-hero"><img src="' + esc(u.avatar) + '" alt="" style="--ring:' + esc(u.ring) + '"><h2>Bienvenue ' + esc(u.name) + ' !</h2><p>Bêta OS pilote toute la maison depuis cet écran. On fait le tour en une minute ?</p></div>',
      () => '<h3>' + ico('user') + 'Votre profil</h3><div style="display:flex;flex-direction:column;gap:12px"><label class="field">Prénom affiché<input value="' + esc(u.name) + '" data-change="uName" data-id="' + u.id + '"></label>' +
        '<label class="field">Où êtes-vous en ce moment ?<select data-change="uPlace" data-id="' + u.id + '">' + Object.keys(DATA.PLACES).map(k => '<option value="' + k + '"' + (u.place === k ? ' selected' : '') + '>' + DATA.PLACES[k].label + '</option>').join('') + '</select></label>' +
        '<button class="btn" data-act="pickAvatar" data-arg="' + u.id + '">' + ico('user') + 'Choisir un autre avatar</button></div>',
      () => '<h3>' + ico('sparkle') + 'Ambiance</h3><div style="display:flex;flex-direction:column;gap:12px;font-size:14px">' +
        '<label class="row" style="gap:10px"><button type="button" class="sw sm' + (S.settings.sound ? ' on' : '') + '" data-act="fxSound" aria-label="Sons"></button>Sons et vibrations discrets</label>' +
        '<label class="row" style="gap:10px"><button type="button" class="sw sm' + (N().on ? ' on' : '') + '" data-act="obNight" aria-label="Mode nuit"></button>Mode nuit automatique (' + N().from + ' – ' + N().to + ') : écran assombri et sons coupés</label>' +
        '<label class="field">Transparence des panneaux<input type="range" class="range thin" min="0" max="100" value="' + (S.settings.glass == null ? 45 : S.settings.glass) + '" style="--p:' + (S.settings.glass == null ? 45 : S.settings.glass) + '%" data-input="fxGlass"></label></div>',
      adm ? () => '<h3>' + ico('link') + 'Connexions (administrateur)</h3><div class="list">' +
        [['homeFill', 'Home Assistant', B.HA.enabled() ? (B.HA.online ? 'Relié' : 'Configuré') : 'Non relié (mode démo)', B.HA.enabled()], ['youtube', 'Compte Google (YouTube + Agenda)', B.YTM && B.YTM.connected() ? 'Connecté' : 'Non connecté', B.YTM && B.YTM.connected()], ['server', 'Serveur Bêta sur le NAS', B.Server && B.Server.ok() ? 'Relié' : 'Plus tard', B.Server && B.Server.ok()]]
          .map(r => '<div class="li absrow"><span class="aico ' + (r[3] ? 'g' : 'w') + '">' + ico(r[0]) + '</span><div><b>' + r[1] + '</b><small>' + r[2] + '</small></div></div>').join('') + '</div><button class="btn" data-act="obGo" data-arg="connexions" style="margin-top:10px">' + ico('link') + 'Ouvrir Connexions</button>' : null,
      () => '<h3>' + ico('info') + 'Les bons réflexes</h3><ul class="obtips">' +
        '<li>' + ico('search2') + '<span><b>Chercher</b> un appareil, une radio, un mail : la loupe ou <kbd>Ctrl K</kbd>.</span></li>' +
        '<li>' + ico('dots') + '<span>Les <b>…</b> d’une pièce ouvrent tous ses réglages : thermostat, couleurs, volets.</span></li>' +
        '<li>' + ico('sparkle') + '<span>Bêta IA comprend plusieurs ordres : « éteins le salon et ferme les volets », ou « qui a ouvert le garage hier ? ».</span></li>' +
        '<li>' + ico('shieldCheck') + '<span>Avant de partir, la page <b>Absence</b> vérifie tout en un coup d’œil.</span></li></ul>'
    ];
    return st.filter(Boolean);
  };
  function obShow() {
    const st = STEPS(); step = Math.max(0, Math.min(step, st.length - 1));
    B.modal('<div class="onboard">' + st[step]() + '<div class="obnav"><div class="obdots">' + st.map((x, i) => '<i class="' + (i === step ? 'on' : '') + '"></i>').join('') + '</div>' +
      (step ? '<button class="btn" data-act="obPrev">' + ico('chevL') + 'Retour</button>' : '<button class="btn" data-act="obDone">Passer</button>') +
      (step < st.length - 1 ? '<button class="btn pri" data-act="obNext">Suivant' + ico('chevR') + '</button>' : '<button class="btn pri" data-act="obDone">' + ico('check') + 'C’est parti !</button>') + '</div></div>', 'sm');
  }
  function obStart() { step = 0; obShow(); }
  B.onboard = obStart;
  B.act('obStart', obStart);
  B.act('obNext', () => { step++; obShow(); });
  B.act('obPrev', () => { step--; obShow(); });
  B.act('obDone', () => { S.onboard[B.user().id] = Date.now(); B.save(); B.closeModal(); B.toast('Bonne découverte de Bêta OS !', 'sparkle'); });
  B.act('obGo', el => { S.onboard[B.user().id] = Date.now(); B.save(); B.closeModal(); B.go(el.dataset.arg); });
  B.act('obNight', el => { N().on = !N().on; B.save(); el.classList.toggle('on', N().on); arm(); });
  // au premier passage de chaque profil existant (pas l'invité)
  function obCheck() {
    const u = B.user();
    if (B.current === 'verrou' || u.id === 'guest' || S.onboard[u.id] || !S.users.some(x => x.id === u.id) || document.querySelector('.modal')) return;
    setTimeout(() => { if (B.current !== 'verrou' && !S.onboard[B.user().id] && !document.querySelector('.modal')) obStart(); }, 900);
  }
  window.addEventListener('hashchange', () => setTimeout(obCheck, 50));
  setTimeout(obCheck, 1200);
  const sgen0 = RENDER.sgen;
  RENDER.sgen = s => sgen0(s).replace('<div class="row" style="margin-top:auto"><button class="btn pri">', '<div class="row" style="margin-top:auto;flex-wrap:wrap"><button type="button" class="btn" data-act="obStart">' + ico('sparkle') + 'Revoir la visite</button><button class="btn pri">');

  /* ======================= MENU iPHONE PAR SECTIONS ======================= */
  const GROUPS = [
    ['Pièces', 'rooms', id => /^(accueil|exterieur|rdc|etage1|etage2|pieces)$/.test(id) || /^niveau-/.test(id)],
    ['Domotique', 'homeFill', id => /^(energie|routines|absence|journal)$/.test(id)],
    ['Outils', 'grid9', id => /^(musique|plex|nas|calendrier|mails|ia)$/.test(id)],
    ['Réglages', 'gearFill', id => /^(connexions|parametres)$/.test(id)]
  ];
  B.act('moreNav', () => {
    const items = PAGES().filter((n, i, a) => a.findIndex(x => x[0] === n[0]) === i && !(B.guest && B.guest() && /^(nas|calendrier|mails|parametres|connexions|journal)$/.test(n[0])));
    const unread = B.unread ? B.unread() : 0;
    const tile = n => '<a href="#' + n[0] + '" class="tile' + (n[0] === B.current ? ' on' : '') + '" data-act="closeModalNav">' + ico(n[3]) + '<span>' + n[1] + '</span>' + (n[0] === 'mails' && unread ? '<span class="badge">' + unread + '</span>' : '') + '</a>';
    const sec = g => { const l = items.filter(n => g[2](n[0])); return l.length || g[0] === 'Réglages' ? '<section class="navsec"><h4>' + ico(g[1]) + g[0] + '</h4><div class="navgrid">' + l.map(tile).join('') +
      (g[0] === 'Outils' ? '<button class="tile" data-act="search">' + ico('search2') + '<span>Chercher</span></button>' : '') +
      (g[0] === 'Réglages' ? '<button class="tile lockt" data-act="lock">' + ico('lock') + '<span>Verrouiller</span></button>' : '') + '</div></section>' : ''; };
    B.modal('<h2>' + ico('grid9') + 'Menu</h2><div class="navsecs">' + GROUPS.map(sec).join('') + '</div>', 'sm sheet');
  });

  /* ======================= PAS DE ZOOM SUR iOS ======================= */
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(ev => document.addEventListener(ev, e => e.preventDefault(), { passive: false }));
  document.addEventListener('touchmove', e => { if (e.scale !== undefined && e.scale !== 1) e.preventDefault(); }, { passive: false });

  /* ======================= MENUS AU PREMIER PLAN ======================= */
  // Quand un panneau de pièce (…) ou un panneau d'appareil sur téléphone est ouvert, un voile
  // bloque le site derrière (un toucher sur le voile ferme le panneau) et la page ne défile plus.
  const fluid = () => document.documentElement.classList.contains('fluid');
  const blocking = () => Array.from(document.querySelectorAll('.rpanel, .fpanel')).filter(p => p.classList.contains('rpanel') || fluid());
  let pveil = null;
  function guard() {
    const ps = blocking(), modal = !!document.querySelector('.modal');
    if (ps.length) {
      if (!pveil) { pveil = document.createElement('div'); pveil.className = 'pveil'; pveil.addEventListener('click', () => { blocking().forEach(p => p.remove()); guard(); }); document.body.appendChild(pveil); }
      pveil.style.zIndex = Math.min(...ps.map(p => +p.style.zIndex || 90)) - 1;
    } else if (pveil) { pveil.remove(); pveil = null; }
    document.documentElement.classList.toggle('noscroll', !!(modal || ps.length));
  }
  new MutationObserver(guard).observe(document.body, { childList: true });
})();

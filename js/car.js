/* Bêta OS 6.5 — voiture (Ford via l'intégration FordPass de Home Assistant) :
   état, commandes, et départs automatiques selon l'agenda (préchauffage / clim + itinéraire sur le téléphone). */
(function () {
  const B = window.BOS, { S, esc, F, T, RENDER, box, WX } = B;
  const HA = B.HA, BG = 'assets/bg/generic.jpg';
  const C = S.car = Object.assign({
    name: 'Ford Explorer', ent: {}, adminOnly: true, trips: {}, done: {}, pref: {},
    auto: { on: true, cold: 8, hot: 24, margin: 10, lead: 12, nav: 'apple', home: '' },
    demo: { bat: 68, range: 245, fuel: null, charging: true, plug: true, locked: true, doors: 'Fermées', windows: 'Fermées', home: true, odo: 18452, tires: 'OK', oil: null, b12: 12.6, start: false, endAt: '06:00', at: Date.now() }
  }, S.car || {});
  const A = C.auto;
  const FIELDS = [
    ['bat', 'Batterie de traction (%)', /soc|battery_level|elveh|charge_level|state_of_charge|batterie/i, ['sensor']],
    ['range', 'Autonomie (km)', /range|autonomie|distance_to_empty|dte/i, ['sensor']],
    ['fuel', 'Carburant (%)', /fuel|carburant/i, ['sensor']],
    ['charging', 'Charge en cours', /charging|charge_status|evcc|en_charge/i, ['sensor', 'binary_sensor']],
    ['plug', 'Câble branché', /plug|branch/i, ['sensor', 'binary_sensor']],
    ['lock', 'Verrouillage', /lock|doorlock|verrou/i, ['lock', 'sensor']],
    ['doors', 'Portes', /door|porte/i, ['sensor', 'binary_sensor']],
    ['windows', 'Fenêtres', /window|fenetre/i, ['sensor', 'binary_sensor']],
    ['location', 'Position', /tracker|location|position|gps/i, ['device_tracker', 'sensor']],
    ['odo', 'Kilométrage', /odometer|odo|kilometrage/i, ['sensor']],
    ['tires', 'Pneus', /tire|tyre|pneu/i, ['sensor']],
    ['oil', 'Huile (%)', /oil|huile/i, ['sensor']],
    ['b12', 'Batterie 12 V', /12v|battery$|batt_12|aux/i, ['sensor']],
    ['start', 'Démarrage à distance', /remote_start|ignition|start|demarr/i, ['switch', 'button']],
    ['refresh', 'Actualiser', /refresh|update|actualis/i, ['button']]
  ];
  const real = () => HA.enabled() && Object.values(C.ent).some(Boolean);
  const st = k => { const e = C.ent[k]; return e && HA.states[e] ? HA.states[e] : null; };
  const num = k => { const s = st(k); const v = s ? parseFloat(s.state) : NaN; return isNaN(v) ? null : v; };
  const on = (k, re) => { const s = st(k); if (!s) return null; return re.test(String(s.state)); };

  /* ---------- état unifié (vrai ou démo) ---------- */
  function state() {
    if (!real()) return Object.assign({ demo: true }, C.demo);
    const loc = st('location'), lk = st('lock'), ch = st('charging');
    return {
      bat: num('bat'), range: num('range'), fuel: num('fuel'), odo: num('odo'), oil: num('oil'), b12: num('b12'),
      charging: ch ? /charging|on|true|en charge|in_progress/i.test(ch.state) : null,
      plug: on('plug', /on|true|connected|plugged|branch/i),
      locked: lk ? /locked|verrouill/i.test(lk.state) && !/unlocked/i.test(lk.state) : null,
      doors: st('doors') ? (/closed|off|false|ferm/i.test(st('doors').state) ? 'Fermées' : 'Ouvertes') : null,
      windows: st('windows') ? (/closed|off|false|ferm/i.test(st('windows').state) ? 'Fermées' : 'Ouvertes') : null,
      tires: st('tires') ? (/normal|ok|good|false|off/i.test(st('tires').state) ? 'OK' : 'À vérifier') : null,
      home: loc ? /home|maison/i.test(loc.state) : null, where: loc ? loc.state : null,
      start: st('start') ? /on|true|running/i.test(st('start').state) : false,
      endAt: (ch && ch.attributes && (ch.attributes.estimated_end_time || ch.attributes.charge_end_time)) || null,
      at: Math.max(...['bat', 'range', 'fuel', 'lock', 'location'].map(k => st(k) ? +new Date(st(k).last_updated) : 0))
    };
  }
  const canCmd = () => { const u = B.user(); return u.id !== 'guest' && (!C.adminOnly || u.admin); };
  async function cmd(what, auto) {
    if (!auto && !canCmd()) return B.toast('Commandes de la voiture réservées aux administrateurs', 'lock');
    const d = C.demo;
    if (!real()) {
      if (what === 'lock') d.locked = true; if (what === 'unlock') d.locked = false; if (what === 'start') d.start = auto ? true : !d.start; d.at = Date.now();
      B.save(); B.emit('car'); return B.toast({ lock: 'Voiture verrouillée', unlock: 'Voiture déverrouillée', start: d.start ? 'Démarrage à distance lancé (démo)' : 'Moteur arrêté', refresh: 'Données actualisées' }[what] + (real() ? '' : ' — mode démo'), 'carFill');
    }
    const e = C.ent[what === 'unlock' ? 'lock' : what];
    if (!e) return B.toast('Commande non reliée (Voiture › Relier)', 'info');
    const dom = e.split('.')[0];
    if (what === 'lock' || what === 'unlock') await HA.call('lock', what, { entity_id: e });
    else if (dom === 'button') await HA.call('button', 'press', { entity_id: e });
    else if (dom === 'switch') await HA.call('switch', state().start && !auto ? 'turn_off' : 'turn_on', { entity_id: e });
    B.toast({ lock: 'Verrouillage demandé…', unlock: 'Déverrouillage demandé…', start: 'Démarrage à distance demandé…', refresh: 'Actualisation demandée à Ford…' }[what] + ' (peut prendre 1 min)', 'carFill');
    if (B.fire) B.fire('dev', { id: 'car', patch: { cmd: what } });
  }
  B.act('carCmd', el => cmd(el.dataset.arg));
  B.on('state', ({ eid }) => { if (Object.values(C.ent).includes(eid)) B.emit('car'); });

  /* ---------- trajets : adresse → temps de route (OpenStreetMap, sans compte) ---------- */
  const geo = async q => { const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=fr&q=' + encodeURIComponent(q)); const j = await r.json(); if (!j[0]) throw new Error('adresse introuvable'); return [+j[0].lat, +j[0].lon]; };
  async function homePos() { if (A.home) { if (!C.homeAt || C.homeAt.q !== A.home) { const p = await geo(A.home); C.homeAt = { q: A.home, p }; B.save(); } return C.homeAt.p; } return [S.settings.lat, S.settings.lon]; }
  async function trip(place) {
    const k = place.trim().toLowerCase(), c = C.trips[k];
    if (c && Date.now() - c.at < 30 * 864e5) return c;
    const [h, d] = [await homePos(), await geo(place)];
    const r = await (await fetch('https://router.project-osrm.org/route/v1/driving/' + h[1] + ',' + h[0] + ';' + d[1] + ',' + d[0] + '?overview=false')).json();
    if (!r.routes || !r.routes[0]) throw new Error('itinéraire introuvable');
    const t = { min: Math.round(r.routes[0].duration / 60 * 1.15), km: Math.round(r.routes[0].distance / 100) / 10, at: Date.now() };
    C.trips[k] = t; B.save(); return t;
  }
  const navUrl = p => A.nav === 'google' ? 'https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=' + encodeURIComponent(p) : A.nav === 'waze' ? 'https://waze.com/ul?navigate=yes&q=' + encodeURIComponent(p) : 'https://maps.apple.com/?dirflg=d&daddr=' + encodeURIComponent(p);
  const TRASH = /poubelle|ordure|d[ée]chet|collecte|verre|bio ?d[ée]chet|encombrant|papier/i;
  const pref = e => C.pref[e.id] || 'auto';
  const wants = e => pref(e) === 'on' || (pref(e) === 'auto' && !!(e.place && e.place.trim()) && !TRASH.test(e.title) && !e.allDay);
  const tAt = t => { const h = WX.hours.reduce((b, x) => Math.abs(+x.t - t) < Math.abs(+b.t - t) ? x : b, WX.hours[0]); return h ? h.temp : WX.now.temp; };
  const mode = t => { const v = tAt(t); return v <= A.cold ? 'heat' : v >= A.hot ? 'cool' : null; };
  function departures() {
    const now = Date.now();
    return S.events.filter(e => wants(e) && new Date(e.date + 'T' + e.time) > now && new Date(e.date + 'T' + e.time) - now < 3 * 864e5)
      .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).slice(0, 6)
      .map(e => { const k = (e.place || '').trim().toLowerCase(), t = C.trips[k], start = +new Date(e.date + 'T' + e.time), dep = start - ((t ? t.min : 20) + A.margin) * 6e4; return { e, t, dep, m: mode(dep) }; });
  }
  // calcule à l'avance les trajets des prochains rendez-vous
  async function prefetch() { for (const x of departures()) if (!x.t && x.e.place) { try { await trip(x.e.place); } catch (er) { C.trips[x.e.place.trim().toLowerCase()] = { err: er.message, min: 20, km: null, at: Date.now() - 29 * 864e5 }; } } B.emit('car'); }
  setTimeout(prefetch, 5000); setInterval(prefetch, 30 * 6e4);
  const isSender = () => { try { return localStorage.getItem('betaos.notifier') === '1'; } catch (e) { return false; } };
  if (S.notif && S.notif.rules && !S.notif.rules.car) S.notif.rules.car = { on: true, who: 'admins' };
  // à la minute : faut-il préparer la voiture ?
  setInterval(() => {
    if (!A.on) return;
    // l'écran « émetteur » s'en charge ; un écran où l'émission a été coupée ne fait rien
    const flagged = (() => { try { return localStorage.getItem('betaos.notifier') !== null; } catch (e) { return false; } })();
    if (flagged && !isSender()) return;
    const now = Date.now(), s = state();
    departures().forEach(x => {
      const key = x.e.id + '@' + x.e.date + x.e.time; if (C.done[key]) return;
      if (now < x.dep - A.lead * 6e4 || now > x.dep) return;
      C.done[key] = now; B.save();
      const temp = Math.round(tAt(x.dep)), what = x.m === 'heat' ? 'préchauffage' : x.m === 'cool' ? 'climatisation' : '';
      const home = s.home !== false;
      if (what && home) { B.src = 'auto'; cmd('start', true); B.src = null; }
      const msg = 'Départ à ' + F.time(new Date(x.dep)) + ' pour « ' + x.e.title + ' »' + (x.t && x.t.min ? ' (' + x.t.min + ' min de route)' : '') + (what && home ? ' · ' + what + ' lancé (' + temp + ' °C dehors)' : '');
      B.toast(msg, 'carFill');
      if (B.notifySend) B.notifySend('car', '🚗 ' + x.e.title, msg, { url: navUrl(x.e.place), go: 'voiture', urgent: 1, tag: 'car-' + x.e.id, actions: [{ action: 'URI', title: 'Itinéraire', uri: navUrl(x.e.place) }, { action: 'URI', title: 'Bêta OS', uri: location.origin + location.pathname.replace(/index\.html$/, '') + '#voiture' }] });
    });
    Object.keys(C.done).forEach(k => { if (now - C.done[k] > 3 * 864e5) delete C.done[k]; });
  }, 60e3);

  /* ---------- rendu ---------- */
  const fmtAge = t => { if (!t) return '—'; const m = Math.round((Date.now() - t) / 6e4); return m < 1 ? 'à l’instant' : m < 60 ? 'il y a ' + m + ' min' : 'il y a ' + Math.floor(m / 60) + ' h'; };
  const pct = v => v == null ? '—' : Math.round(v) + ' %';
  RENDER.carhero = () => {
    const s = state(), lvl = s.bat != null ? s.bat : s.fuel, ev = s.bat != null;
    return '<div class="carhero"><div class="cimg"><img src="assets/car.jpg" alt=""><span class="cname">' + esc(C.name) + (s.demo ? ' <small class="tag2 wait">démo</small>' : '') + '</span></div>' +
      '<div class="cbig"><div class="cgauge" style="--p:' + (lvl || 0) + '%;--c:' + (lvl > 50 ? '#22e3a4' : lvl > 20 ? '#ffd23f' : '#ff5a6a') + '"><b>' + pct(lvl) + '</b><small>' + (ev ? 'Batterie' : 'Carburant') + '</small></div>' +
      '<div class="cfacts"><div><b>' + (s.range != null ? Math.round(s.range) + ' km' : '—') + '</b><small>Autonomie</small></div>' +
      '<div><b>' + (s.charging ? 'En charge' : s.plug ? 'Branchée' : ev ? 'Débranchée' : '—') + '</b><small>' + (s.charging && s.endAt ? 'fin vers ' + esc(/^\d\d:\d\d$/.test(s.endAt) ? s.endAt : isNaN(new Date(s.endAt)) ? String(s.endAt) : F.time(new Date(s.endAt))) : 'Recharge') + '</small></div>' +
      '<div><b class="' + (s.locked === false ? 'w' : 'g') + '">' + (s.locked == null ? '—' : s.locked ? 'Verrouillée' : 'Ouverte') + '</b><small>Portes</small></div>' +
      '<div><b>' + (s.home == null ? (s.where || '—') : s.home ? 'À la maison' : 'Partie') + '</b><small>Position</small></div></div></div>' +
      '<div class="cbtns2"><button class="btn' + (s.locked ? ' on' : '') + '" data-act="carCmd" data-arg="lock">' + ico('lock') + 'Verrouiller</button><button class="btn" data-act="carCmd" data-arg="unlock">' + ico('unlock') + 'Ouvrir</button>' +
      '<button class="btn pri' + (s.start ? ' on' : '') + '" data-act="carCmd" data-arg="start">' + ico('flame') + (s.start ? 'Arrêter' : 'Préchauffer / clim') + '</button><button class="sq" data-act="carCmd" data-arg="refresh" title="Actualiser">' + ico('refresh') + '</button></div>' +
      '<small class="muted cupd">Mis à jour ' + fmtAge(s.at) + (s.demo ? ' · données de démonstration — reliez FordPass (Réglages ci-contre)' : ' · via FordPass / Home Assistant') + '</small></div>';
  };
  RENDER.carstate = () => {
    const s = state(), r = (i, l, v, c) => '<div class="li absrow"><span class="aico ' + (c || '') + '">' + ico(i) + '</span><div><b>' + l + '</b></div><span class="cv">' + v + '</span></div>';
    return '<div class="list scroll" style="flex:1">' +
      r('door', 'Portes', s.doors || '—', s.doors === 'Ouvertes' ? 'w' : 'g') + r('blindsWin', 'Fenêtres', s.windows || '—', s.windows === 'Ouvertes' ? 'w' : 'g') +
      r('target', 'Pression des pneus', s.tires || '—', s.tires && s.tires !== 'OK' ? 'w' : 'g') +
      (s.oil != null ? r('drop', 'Huile', pct(s.oil), s.oil < 20 ? 'w' : 'g') : '') +
      r('battery', 'Batterie 12 V', s.b12 != null ? String(s.b12).replace('.', ',') + (s.b12 > 20 ? ' %' : ' V') : '—', s.b12 != null && s.b12 < 12 && s.b12 > 5 ? 'w' : 'g') +
      r('history', 'Kilométrage', s.odo != null ? Math.round(s.odo).toLocaleString('fr-FR') + ' km' : '—') +
      r('pin', 'Position', s.home == null ? esc(s.where || '—') : s.home ? 'À la maison' : esc(s.where || 'Partie')) + '</div>';
  };
  RENDER.cartrips = () => {
    const l = departures();
    return '<div class="list scroll" style="flex:1">' + (l.length ? l.map(x => {
      const p = pref(x.e), m = x.m === 'heat' ? ['flame', 'Préchauffage', '#ff8a3c'] : x.m === 'cool' ? ['snow', 'Clim', '#2fd3ff'] : ['carFill', 'Aucun', '#93a8cc'];
      return '<div class="li ctrip"><span class="aico" style="color:' + m[2] + '">' + ico(m[0]) + '</span><div><b>' + esc(x.e.title) + '</b><small>' + F.dayMonth(new Date(x.e.date + 'T12:00')) + ' · ' + x.e.time + ' · ' + esc(x.e.place || '') + '</small><small class="cy">Départ ' + F.time(new Date(x.dep)) + (x.t && x.t.min ? ' · ' + x.t.min + ' min' + (x.t.km ? ' · ' + String(x.t.km).replace('.', ',') + ' km' : '') : x.t && x.t.err ? ' · trajet : ' + esc(x.t.err) : ' · calcul du trajet…') + ' · ' + m[1] + '</small></div>' +
        '<div class="row" style="gap:6px"><a class="sq" href="' + esc(navUrl(x.e.place || '')) + '" target="_blank" rel="noopener" title="Itinéraire">' + ico('pin') + '</a><button class="btn sm" data-act="carPref" data-arg="' + x.e.id + '">' + (p === 'auto' ? 'Auto' : p === 'on' ? 'Toujours' : 'Jamais') + '</button></div></div>';
    }).join('') : '<p class="muted" style="margin:16px 4px;line-height:1.5">Aucun départ prévu dans les 3 jours. Ajoutez un <b>lieu</b> à vos rendez-vous dans le calendrier : Bêta OS calcule l’heure de départ et prépare la voiture.</p>') + '</div>';
  };
  RENDER.carcfg = () => '<form class="ccfg" data-submit="carSave">' +
    '<label class="row" style="gap:10px;font-size:14px"><button type="button" class="sw sm' + (A.on ? ' on' : '') + '" data-act="carAuto" aria-label="Automatique"></button>Préparer la voiture avant mes rendez-vous</label>' +
    '<div class="grid2"><label class="field">Préchauffer sous (°C)<input type="number" name="cold" value="' + A.cold + '" step="1"></label><label class="field">Climatiser au-dessus de (°C)<input type="number" name="hot" value="' + A.hot + '" step="1"></label></div>' +
    '<div class="grid2"><label class="field">Marge avant départ (min)<input type="number" name="margin" value="' + A.margin + '" min="0" max="60"></label><label class="field">Démarrer avant le départ (min)<input type="number" name="lead" value="' + A.lead + '" min="5" max="30"></label></div>' +
    '<div class="grid2"><label class="field">Application GPS<select name="nav">' + [['apple', 'Plans (Apple)'], ['google', 'Google Maps'], ['waze', 'Waze']].map(o => '<option value="' + o[0] + '"' + (A.nav === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></label><label class="field">Nom de la voiture<input name="name" value="' + esc(C.name) + '"></label></div>' +
    '<label class="field">Adresse de la maison (pour les trajets)<input name="home" value="' + esc(A.home) + '" placeholder="12 rue …, Strasbourg"></label>' +
    '<label class="row" style="gap:10px;font-size:13.5px"><button type="button" class="sw sm' + (C.adminOnly ? ' on' : '') + '" data-act="carAdmin" aria-label="Admins"></button>Commandes réservées aux administrateurs</label>' +
    '<div class="row" style="gap:8px;flex-wrap:wrap;margin-top:auto"><button class="btn pri">' + ico('check') + 'Enregistrer</button><button type="button" class="btn" data-act="carLink">' + ico('link') + 'Relier FordPass</button></div></form>';
  B.act('carSave', el => { const f = new FormData(el); ['cold', 'hot', 'margin', 'lead'].forEach(k => { const v = parseFloat(f.get(k)); if (!isNaN(v)) A[k] = v; }); A.nav = f.get('nav'); A.home = String(f.get('home') || '').trim(); C.name = String(f.get('name') || '').trim() || C.name; C.trips = {}; B.save(); B.emit('car'); prefetch(); B.toast('Réglages de la voiture enregistrés', 'carFill'); });
  B.act('carAuto', el => { A.on = !A.on; B.save(); el.classList.toggle('on', A.on); });
  B.act('carAdmin', el => { if (!B.user().admin) return B.toast('Réservé aux administrateurs', 'lock'); C.adminOnly = !C.adminOnly; B.save(); el.classList.toggle('on', C.adminOnly); });
  B.act('carPref', el => { const id = el.dataset.arg, p = pref({ id }); C.pref[id] = p === 'auto' ? 'on' : p === 'on' ? 'off' : 'auto'; B.save(); B.emit('car'); });

  /* ---------- relier les entités FordPass ---------- */
  function guess() {
    const ents = Object.keys(HA.states), ford = ents.filter(e => /ford|fordpass|explorer|voiture|car_/i.test(e + ' ' + ((HA.states[e].attributes || {}).friendly_name || '')));
    const pool = ford.length ? ford : ents, out = {};
    FIELDS.forEach(([k, , re, doms]) => { const m = pool.find(e => doms.includes(e.split('.')[0]) && re.test(e + ' ' + ((HA.states[e].attributes || {}).friendly_name || '')) && !Object.values(out).includes(e)); if (m) out[k] = m; });
    return out;
  }
  B.act('carLink', () => {
    if (!HA.enabled()) return B.modal('<h2>' + ico('carFill') + 'Relier FordPass</h2><ol class="steps"><li>Dans Home Assistant, installez <b>HACS</b> puis l’intégration <b>FordPass</b> (recherchez « FordPass » dans HACS).</li><li>Redémarrez Home Assistant, puis Paramètres › Appareils › Ajouter une intégration › FordPass : connectez votre compte Ford (le même que l’application FordPass). Suivez la méthode de connexion indiquée par l’intégration : Ford la change de temps en temps.</li><li>Reliez Home Assistant dans Bêta OS (Connexions), puis revenez ici.</li></ol><p class="muted" style="font-size:12.5px;margin:10px 0 0;line-height:1.5">Gardez un rafraîchissement raisonnable (≥ 5 min) : trop de demandes peuvent décharger la batterie 12 V.</p>', 'sm');
    const g = Object.assign(guess(), C.ent), ents = Object.keys(HA.states).sort();
    B.modal('<h2>' + ico('carFill') + 'Relier la voiture</h2><form data-submit="carLinkSave"><div class="carmap">' + FIELDS.map(([k, label, , doms]) => '<label class="field">' + label + '<select name="' + k + '"><option value="">—</option>' + ents.filter(e => doms.includes(e.split('.')[0])).map(e => '<option value="' + e + '"' + (g[k] === e ? ' selected' : '') + '>' + esc(((HA.states[e].attributes || {}).friendly_name || e)) + ' · ' + e + '</option>').join('') + '</select></label>').join('') + '</div>' +
      '<div class="row" style="justify-content:flex-end;margin-top:12px;gap:8px"><button type="button" class="btn" data-act="carUnlink">Revenir à la démo</button><button class="btn pri">' + ico('check') + 'Enregistrer</button></div></form>', 'wide');
  });
  B.act('carLinkSave', el => { const f = new FormData(el); C.ent = {}; FIELDS.forEach(([k]) => { const v = f.get(k); if (v) C.ent[k] = v; }); B.save(); B.closeModal(); B.emit('car'); B.toast(real() ? 'Voiture reliée à Home Assistant' : 'Aucune entité choisie : mode démo', 'carFill'); });
  B.act('carUnlink', () => { C.ent = {}; B.save(); B.closeModal(); B.emit('car'); });

  /* ---------- page, menu, écran verrouillé, IA ---------- */
  B.route('voiture', { title: 'Voiture', bg: BG, render: () => B.side('voiture') + B.header({ id: 'voiture', title: C.name, sub: 'Connectée · départs automatiques', icon: 'carFill', info: { t: 'infobox', keys: ['car', 'weather'], items: () => {
    const s = state(), lvl = s.bat != null ? s.bat : s.fuel, d = departures()[0];
    return [{ icon: s.bat != null ? 'battery' : 'drop', v: pct(lvl), l: s.bat != null ? 'Batterie' : 'Carburant', cls: 'g' }, { icon: 'target', v: s.range != null ? Math.round(s.range) + ' km' : '—', l: 'Autonomie' }, { icon: 'lock', v: s.locked == null ? '—' : s.locked ? 'Fermée' : 'Ouverte', l: 'Verrouillage', cls: s.locked === false ? 'p' : '' }, { icon: 'calendar', v: d ? F.time(new Date(d.dep)) : '—', l: d ? 'Prochain départ' : 'Aucun départ', cls: 'c' }];
  } } }) +
    '<section class="card pcard abs" style="' + box([105, 235, 830, 640]) + '">' + B.whead('power', 'Ma voiture') + T({ t: 'carhero', keys: ['car'] }) + '</section>' +
    '<section class="card pcard abs" style="' + box([840, 235, 1522, 640]) + '">' + B.whead('shield', 'État du véhicule') + T({ t: 'carstate', keys: ['car'] }) + '</section>' +
    '<section class="card pcard abs" style="' + box([105, 650, 900, 1012]) + '">' + B.whead('cal', 'Prochains départs', '<a href="#calendrier" class="wmore" aria-label="Calendrier">' + ico('chevR') + '</a>') + T({ t: 'cartrips', keys: ['car', 'events', 'weather'] }) + '</section>' +
    '<section class="card pcard abs" style="' + box([910, 650, 1522, 1012]) + '">' + B.whead('gear', 'Réglages') + T({ t: 'carcfg' }) + '</section>' });
  const nl0 = B.navList;
  B.navList = NAV => { const out = (nl0 ? nl0(NAV) : NAV).slice(); if (!out.some(n => n[0] === 'voiture')) { const i = out.findIndex(n => n[0] === 'energie'); out.splice(i < 0 ? out.length : i + 1, 0, ['voiture', 'Voiture', 'carFill', 'carFill', 'noside']); } return out; };
  B.car = {
    state, cmd, departures,
    row() {
      const s = state(), lvl = s.bat != null ? s.bat : s.fuel, d = departures()[0];
      if (s.locked === false && s.home !== true) return { lvl: 2, icon: 'carFill', l: 'Voiture', v: 'Non verrouillée !', go: 'voiture' };
      if (s.tires && s.tires !== 'OK') return { lvl: 2, icon: 'carFill', l: 'Voiture', v: 'Pneus à vérifier', go: 'voiture' };
      if (d && d.dep - Date.now() < 3 * 36e5) return { lvl: 1, icon: 'carFill', l: 'Départ', v: F.time(new Date(d.dep)) + ' · ' + d.e.title, go: 'voiture' };
      return { lvl: s.charging ? 1 : 0, icon: 'carFill', l: 'Voiture', v: pct(lvl) + (s.range != null ? ' · ' + Math.round(s.range) + ' km' : '') + (s.charging ? ' · en charge' : ''), go: 'voiture' };
    }
  };
  // le calendrier gagne un champ « Lieu » (pour calculer le trajet)
  const day0 = RENDER.calday;
  RENDER.calday = s => day0(s).replace('<div class="grid2"><label class="field">Heure', '<label class="field">Lieu (adresse, pour la voiture)<input name="place" placeholder="Ex. 3 place Kléber, Strasbourg" autocomplete="street-address"></label><div class="grid2"><label class="field">Heure');
  const add0 = B.ACT.calAdd;
  B.ACT.calAdd = (el, ev) => {
    const before = new Set(S.events.map(e => e.id)), id = el.id && el.id.value, place = el.place ? el.place.value.trim() : '';
    const r = add0(el, ev);
    const e = id ? S.events.find(x => x.id === id) : S.events.find(x => !before.has(x.id));
    if (e && el.place) { e.place = place; B.save(); if (e.gid && B.gcal) B.gcal.push(e); prefetch(); }
    return r;
  };
  const edit0 = B.ACT.calEdit;
  B.ACT.calEdit = (el, ev) => { const r = edit0(el, ev); const e = S.events.find(x => x.id === el.dataset.arg), f = document.querySelector('[data-submit="calAdd"]'); if (e && f && f.place) f.place.value = e.place || ''; return r; };
  // Bêta IA : « préchauffe la voiture », « autonomie de la voiture », « verrouille la voiture »
  if (B.iaX) {
    const x0 = B.iaX;
    B.iaX = text => {
      const q = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
      if (/voiture|auto\b|explorer|ford/.test(q)) {
        const s = state();
        if (/prechauff|chauffe|clim|demarre|degivre/.test(q)) { cmd('start'); return 'Je lance le démarrage à distance de la ' + C.name + (real() ? '.' : ' (démo).'); }
        if (/deverrouill|ouvre/.test(q)) { cmd('unlock'); return 'J’ouvre la voiture.'; }
        if (/verrouill|ferme/.test(q)) { cmd('lock'); return 'Je verrouille la voiture.'; }
        if (/ou est|position|garee/.test(q)) return s.home ? 'La voiture est à la maison.' : 'La voiture n’est pas à la maison' + (s.where ? ' (' + s.where + ')' : '') + '.';
        const d = departures()[0];
        return C.name + ' : ' + (s.bat != null ? 'batterie ' + Math.round(s.bat) + ' %' : s.fuel != null ? 'carburant ' + Math.round(s.fuel) + ' %' : '') + (s.range != null ? ', ' + Math.round(s.range) + ' km d’autonomie' : '') + (s.charging ? ', en charge' : '') + (s.locked === false ? ', NON verrouillée' : ', verrouillée') + '.' + (d ? ' Prochain départ à ' + F.time(new Date(d.dep)) + ' pour « ' + d.e.title + ' ».' : '');
      }
      return x0(text);
    };
  }
})();

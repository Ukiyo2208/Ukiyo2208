/* Bêta home 7.3 — Carte : position des utilisateurs (Home Assistant ou partage depuis le téléphone),
   voiture, zones, et trajets (moto, voiture, vélo…) enregistrés en direct ou importés en GPX.
   Les positions et trajets restent sur l'appareil (puis sur le serveur Bêta du NAS). */
(function () {
  const B = window.BOS, { S, DATA, esc, F, T, RENDER, box } = B;
  const HA = B.HA, BG = 'assets/bg/generic.jpg', LF = 'assets/vendor/leaflet/';
  const G = S.geo = Object.assign({ users: {}, ent: {}, share: {}, trips: [], vehicles: null, sel: null, tab: 'famille', vf: 'all' }, S.geo || {});
  if (!G.vehicles) G.vehicles = [
    { id: 'moto', name: 'Yamaha MT-07', type: 'moto', color: '#ff5fae', icon: 'moto' },
    { id: 'car', name: (S.car && S.car.name) || 'Voiture', type: 'voiture', color: '#2fd3ff', icon: 'carFill' },
    { id: 'velo', name: 'Vélo', type: 'velo', color: '#22e3a4', icon: 'route' }
  ];
  const veh = id => G.vehicles.find(v => v.id === id) || G.vehicles[0];
  const home = () => [+S.settings.lat || 48.5734, +S.settings.lon || 7.7521];
  const R = 6371e3, rad = x => x * Math.PI / 180;
  const dist = (a, b) => { const dl = rad(b[0] - a[0]), dn = rad(b[1] - a[1]), h = Math.sin(dl / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
  const km = m => (m / 1000).toFixed(m < 10000 ? 1 : 0).replace('.', ',') + ' km';
  const dur = s => { const h = Math.floor(s / 3600), m = Math.round(s % 3600 / 60); return h ? h + ' h ' + String(m).padStart(2, '0') : m + ' min'; };
  const ago = t => { const m = Math.round((Date.now() - t) / 6e4); return m < 1 ? 'à l’instant' : m < 60 ? 'il y a ' + m + ' min' : m < 1440 ? 'il y a ' + Math.floor(m / 60) + ' h' : F.dayMonth(new Date(t)); };
  const save = () => { if (G.trips.length > 300) G.trips.length = 300; B.save(); B.emit('geo'); };

  /* ---------- statistiques d'un trajet ---------- */
  function stats(p) {
    let d = 0, vmax = 0;
    for (let i = 1; i < p.length; i++) { const s = dist(p[i - 1], p[i]); d += s; const dt = p[i][2] - p[i - 1][2]; if (dt > 0) { const v = s / dt * 3.6; if (v < 300) vmax = Math.max(vmax, v); } }
    const t = p.length > 1 ? p[p.length - 1][2] - p[0][2] : 0;
    return { d, t, vavg: t ? d / t * 3.6 : 0, vmax };
  }
  // trajets légers : un point tous les ~15 m, 5 décimales
  function slim(p) { const out = []; p.forEach(x => { const q = [+x[0].toFixed(5), +x[1].toFixed(5), Math.round(x[2]), x[3] == null ? null : Math.round(x[3])]; if (!out.length || dist(out[out.length - 1], q) > 15) out.push(q); }); const lp = p[p.length - 1]; if (p.length && out.length && Math.round(lp[2]) !== out[out.length - 1][2]) out.push([+lp[0].toFixed(5), +lp[1].toFixed(5), Math.round(lp[2])]); return out; }
  function addTrip(o) { const p = slim(o.pts); if (p.length < 2) return null; const t = Object.assign({ id: 't' + Date.now().toString(36), at: p[0][2] * 1000, by: B.user().id }, o, { pts: p }, stats(p)); G.trips.unshift(t); save(); return t; }

  /* ---------- démo : positions et deux balades ---------- */
  if (!G.demo && (!S.setup || S.setup.mode === 'demo')) {
    G.demo = true; const h = home();
    const P = { home: h, work: [48.5839, 7.7455], school: [48.5795, 7.7633], city: [48.5822, 7.7502], friends: [48.5600, 7.7300] };
    S.users.forEach(u => { const p = P[u.place] || P.city; G.users[u.id] = { lat: p[0] + (u.place === 'home' ? 0 : (Math.random() - .5) * .002), lon: p[1] + (u.place === 'home' ? 0 : (Math.random() - .5) * .002), acc: 12, t: Date.now() - Math.random() * 30 * 6e4, src: 'démo' }; G.share[u.id] = true; });
    const route = (wps, t0, kmh) => { const pts = []; let t = t0; for (let i = 1; i < wps.length; i++) { const a = wps[i - 1], b = wps[i], n = Math.max(4, Math.round(dist(a, b) / 120)); for (let k = 0; k < n; k++) { const f = k / n, c = [a[0] + (b[0] - a[0]) * f + Math.sin(k * 1.7 + i) * .0009, a[1] + (b[1] - a[1]) * f + Math.cos(k * 1.3 + i) * .0011]; if (pts.length) t += dist(pts[pts.length - 1], c) / (kmh / 3.6) * (0.8 + Math.random() * .5) * 1000; pts.push([c[0], c[1], t / 1000]); } } pts.push([wps[wps.length - 1][0], wps[wps.length - 1][1], t / 1000 + 60]); return pts; };
    const d1 = new Date(); d1.setDate(d1.getDate() - 2); d1.setHours(14, 10, 0, 0);
    addTrip({ name: 'Balade Mont Sainte-Odile', veh: 'moto', pts: route([h, [48.541, 7.492], [48.498, 7.471], [48.4376, 7.4044], [48.4078, 7.4485], [48.4626, 7.4815], [48.5148, 7.644], h], +d1, 62) });
    const d2 = new Date(); d2.setDate(d2.getDate() - 6); d2.setHours(10, 0, 0, 0);
    addTrip({ name: 'Route des Vins', veh: 'moto', pts: route([h, [48.4626, 7.4815], [48.2860, 7.4550], [48.1916, 7.3470], [48.0790, 7.3580], [48.1930, 7.5040], h], +d2, 70) });
    G.trips.sort((a, b) => b.at - a.at); B.save();
  }

  /* ---------- positions : Home Assistant, ce téléphone ---------- */
  const ents = () => Object.keys(HA.states || {}).filter(e => /^(person|device_tracker)\./.test(e) && HA.states[e].attributes && HA.states[e].attributes.latitude != null);
  function fromHA(uid) {
    const e = G.ent[uid], s = e && HA.states[e]; if (!s || s.attributes.latitude == null) return;
    const a = s.attributes; G.users[uid] = { lat: a.latitude, lon: a.longitude, acc: a.gps_accuracy || 20, t: +new Date(s.last_updated), src: 'Home Assistant', zone: s.state };
    placeFrom(uid);
  }
  function placeFrom(uid) {
    const u = S.users.find(x => x.id === uid), p = G.users[uid]; if (!u || !p || p.src === 'démo') return;
    const inHome = dist(home(), [p.lat, p.lon]) < 150 || p.zone === 'home';
    if (inHome && u.place !== 'home') { u.place = 'home'; B.emit('users'); } else if (!inHome && u.place === 'home') { u.place = 'away'; B.emit('users'); }
  }
  B.on('state', ({ eid }) => { Object.keys(G.ent).forEach(uid => { if (G.ent[uid] === eid) { fromHA(uid); B.save(); B.emit('geo'); refreshMarkers(); } }); });
  setTimeout(() => { Object.keys(G.ent).forEach(fromHA); }, 3000);
  let watch = null;
  function shareMine(on) {
    const uid = B.user().id;
    if (watch != null) { navigator.geolocation.clearWatch(watch); watch = null; }
    G.share[uid] = on; B.save();
    if (!on) return;
    if (!navigator.geolocation) return B.toast('La localisation n’est pas disponible sur cet appareil', 'pin');
    watch = navigator.geolocation.watchPosition(p => { G.users[uid] = { lat: p.coords.latitude, lon: p.coords.longitude, acc: Math.round(p.coords.accuracy), t: Date.now(), src: 'téléphone' }; placeFrom(uid); B.save(); B.emit('geo'); refreshMarkers(); },
      e => B.toast(e.code === 1 ? 'Localisation refusée : autorisez-la pour ce site (Réglages › Safari › Position)' : 'Position indisponible', 'pin'), { enableHighAccuracy: true, maximumAge: 30000, timeout: 20000 });
  }
  if (G.share[B.user().id] && G.users[B.user().id] && G.users[B.user().id].src === 'téléphone') setTimeout(() => shareMine(true), 2000);

  /* ---------- enregistrer un trajet ---------- */
  let rec = null, lock = null;
  async function recStart(v) {
    if (!navigator.geolocation) return B.toast('GPS indisponible sur cet appareil', 'pin');
    rec = { veh: v, pts: [], t0: Date.now() };
    try { if (navigator.wakeLock) lock = await navigator.wakeLock.request('screen'); } catch (e) { }
    rec.w = navigator.geolocation.watchPosition(p => {
      const q = [p.coords.latitude, p.coords.longitude, p.timestamp / 1000, p.coords.speed != null ? p.coords.speed * 3.6 : null];
      if (p.coords.accuracy > 60) return;
      const last = rec.pts[rec.pts.length - 1]; if (!last || dist(last, q) > 12 || q[2] - last[2] > 15) rec.pts.push(q);
      B.emit('geo'); drawRec();
    }, () => B.toast('Signal GPS perdu…', 'pin'), { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
    B.toast('Enregistrement lancé — gardez Bêta home ouvert, écran allumé', 'route'); B.emit('geo');
  }
  function recStop(keep) {
    if (!rec) return; navigator.geolocation.clearWatch(rec.w); try { lock && lock.release(); } catch (e) { } lock = null;
    const r = rec; rec = null; B.emit('geo');
    if (!keep) return B.toast('Enregistrement annulé', 'x');
    const t = addTrip({ name: (veh(r.veh).type === 'moto' ? 'Balade' : 'Trajet') + ' du ' + F.dayMonth(new Date(r.t0)).toLowerCase(), veh: r.veh, pts: r.pts });
    if (!t) return B.toast('Trajet trop court pour être gardé', 'info');
    G.sel = t.id; G.tab = 'trajets'; save(); B.toast(veh(r.veh).name + ' : ' + km(t.d) + ' en ' + dur(t.t), 'route'); showTrip(t);
  }

  /* ---------- GPX ---------- */
  function parseGPX(txt) {
    const doc = new DOMParser().parseFromString(txt, 'application/xml'), pts = [];
    doc.querySelectorAll('trkpt, rtept').forEach(n => { const tm = n.querySelector('time'); pts.push([+n.getAttribute('lat'), +n.getAttribute('lon'), tm ? Date.parse(tm.textContent) / 1000 : pts.length * 5]); });
    const nm = doc.querySelector('trk > name, metadata > name, rte > name');
    return { name: nm ? nm.textContent.trim() : '', pts };
  }
  const gpx = t => '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Bêta home" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>' + esc(t.name) + '</name><trkseg>' + t.pts.map(p => '<trkpt lat="' + p[0] + '" lon="' + p[1] + '"><time>' + new Date(p[2] * 1000).toISOString() + '</time></trkpt>').join('') + '</trkseg></trk></gpx>';

  /* ---------- la carte (Leaflet, intégré au projet) ---------- */
  let L = null, map = null, layer = null, markers = {}, tripLine = null, recLine = null, loading = null;
  function loadLeaflet() {
    if (window.L) return Promise.resolve(window.L);
    return loading || (loading = new Promise((ok, ko) => { const c = document.createElement('link'); c.rel = 'stylesheet'; c.href = LF + 'leaflet.css'; document.head.appendChild(c); const s = document.createElement('script'); s.src = LF + 'leaflet.js'; s.onload = () => ok(window.L); s.onerror = ko; document.head.appendChild(s); }));
  }
  const fluid = () => document.documentElement.classList.contains('fluid');
  function place() {
    const slot = document.getElementById('mapslot'); if (!slot || !layer) return;
    if (fluid()) { if (layer.parentNode !== slot) { slot.appendChild(layer); layer.style.cssText = 'position:absolute;inset:0'; } }
    else { if (layer.parentNode !== document.body) document.body.appendChild(layer); const r = slot.getBoundingClientRect(); layer.style.cssText = 'position:fixed;left:' + r.left + 'px;top:' + r.top + 'px;width:' + r.width + 'px;height:' + r.height + 'px'; }
    if (map) map.invalidateSize();
  }
  function avatarIcon(u, p) {
    return L.divIcon({ className: 'mapav', iconSize: [46, 54], iconAnchor: [23, 52], popupAnchor: [0, -48], html: '<div class="mav" style="--ring:' + esc(u.ring || '#2fb6ff') + '"><img src="' + esc(u.avatar) + '" alt=""></div><i></i>' + (p && Date.now() - p.t > 3 * 36e5 ? '<b class="old"></b>' : '') });
  }
  function refreshMarkers() {
    if (!map) return;
    Object.values(markers).forEach(m => m.remove()); markers = {};
    const h = home();
    markers.home = L.marker(h, { icon: L.divIcon({ className: 'maphome', iconSize: [38, 38], iconAnchor: [19, 19], html: '<span>' + ico('homeFill') + '</span>' }) }).addTo(map).bindPopup('<b>Maison</b><br>' + esc(S.settings.city || ''));
    markers.homeZone = L.circle(h, { radius: 150, color: '#2fb6ff', weight: 1, fillOpacity: .06 }).addTo(map);
    S.users.forEach(u => {
      const p = G.users[u.id]; if (!p || G.share[u.id] === false) return;
      const pl = DATA.PLACES[u.place] || {};
      markers[u.id] = L.marker([p.lat, p.lon], { icon: avatarIcon(u, p), zIndexOffset: 500 }).addTo(map)
        .bindPopup('<b>' + esc(u.name) + '</b><br>' + esc(pl.label || '') + ' · ' + km(dist(h, [p.lat, p.lon])) + ' de la maison<br><small>' + ago(p.t) + ' · ' + esc(p.src) + (p.acc ? ' · ± ' + p.acc + ' m' : '') + '</small>');
    });
    const c = carPos(); if (c) markers.car = L.marker(c, { icon: L.divIcon({ className: 'mapcar', iconSize: [36, 36], iconAnchor: [18, 18], html: '<span>' + ico('carFill') + '</span>' }) }).addTo(map).bindPopup('<b>' + esc((S.car && S.car.name) || 'Voiture') + '</b>');
  }
  function carPos() {
    const e = S.car && S.car.ent && S.car.ent.location, s = e && HA.states[e];
    if (s && s.attributes && s.attributes.latitude != null) return [s.attributes.latitude, s.attributes.longitude];
    return S.car && !S.car.hidden && (!S.car.ent || !S.car.ent.location) ? home().map((x, i) => x + (i ? .0004 : -.0002)) : null;
  }
  function showTrip(t) {
    if (!map) return; if (tripLine) { tripLine.remove(); tripLine = null; }
    if (!t) return;
    const c = veh(t.veh).color;
    tripLine = L.layerGroup([
      L.polyline(t.pts.map(p => [p[0], p[1]]), { color: c, weight: 9, opacity: .25 }),
      L.polyline(t.pts.map(p => [p[0], p[1]]), { color: c, weight: 4, opacity: .95 }),
      L.circleMarker([t.pts[0][0], t.pts[0][1]], { radius: 7, color: '#fff', weight: 2, fillColor: '#22e3a4', fillOpacity: 1 }).bindTooltip('Départ'),
      L.circleMarker([t.pts[t.pts.length - 1][0], t.pts[t.pts.length - 1][1]], { radius: 7, color: '#fff', weight: 2, fillColor: '#ff5a6a', fillOpacity: 1 }).bindTooltip('Arrivée')
    ]).addTo(map);
    map.fitBounds(L.latLngBounds(t.pts.map(p => [p[0], p[1]])), { padding: [40, 40] });
  }
  function drawRec() { if (!map || !rec) return; if (recLine) recLine.remove(); recLine = L.polyline(rec.pts.map(p => [p[0], p[1]]), { color: veh(rec.veh).color, weight: 5 }).addTo(map); const l = rec.pts[rec.pts.length - 1]; if (l) map.panTo([l[0], l[1]]); }
  async function mount() {
    try { L = await loadLeaflet(); } catch (e) { const s = document.getElementById('mapslot'); if (s) s.innerHTML = '<p class="muted" style="padding:20px">Carte indisponible.</p>'; return; }
    if (B.current !== 'carte') return;
    if (map) { map.remove(); map = null; } if (layer) layer.remove();
    layer = document.createElement('div'); layer.className = 'maplayer'; place();
    map = L.map(layer, { zoomControl: false, attributionControl: true }).setView(home(), 13);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19, subdomains: 'abcd', attribution: '© OpenStreetMap · © CARTO' }).addTo(map);
    place(); refreshMarkers();
    const t = G.trips.find(x => x.id === G.sel); if (t && G.tab === 'trajets') showTrip(t); else fitFamily();
    setTimeout(() => { place(); if (t && G.tab === 'trajets') showTrip(t); else fitFamily(); }, 250);
    drawRec();
  }
  function fitFamily() { if (!map) return; const pts = [home()].concat(S.users.map(u => G.users[u.id]).filter(Boolean).map(p => [p.lat, p.lon])); if (pts.length > 1) map.fitBounds(L.latLngBounds(pts), { padding: [50, 50], maxZoom: 14 }); }
  function unmount() { if (map) { map.remove(); map = null; } if (layer) { layer.remove(); layer = null; } markers = {}; tripLine = recLine = null; }
  window.addEventListener('hashchange', () => { if (B.current !== 'carte') unmount(); });
  window.addEventListener('resize', () => setTimeout(place, 60));
  window.addEventListener('scroll', () => { if (!fluid()) place(); }, true);
  // les fenêtres (modales, panneaux) passent au-dessus de la carte
  new MutationObserver(() => { if (layer) layer.style.visibility = document.querySelector('.modal') ? 'hidden' : ''; }).observe(document.body, { childList: true });

  /* ---------- panneau de droite ---------- */
  RENDER.mapside = () => {
    const tabs = '<div class="tabs sm mtabs">' + [['famille', 'Famille'], ['trajets', 'Trajets'], ['vehicules', 'Véhicules']].map(t => '<button class="' + (G.tab === t[0] ? 'on' : '') + '" data-act="mapTab" data-arg="' + t[0] + '">' + t[1] + '</button>').join('') + '</div>';
    let h = '';
    if (G.tab === 'famille') {
      const me = B.user().id;
      h = '<div class="list scroll mfam">' + S.users.map(u => { const p = G.users[u.id], pl = DATA.PLACES[u.place] || {}; return '<button class="li" data-act="mapUser" data-arg="' + u.id + '"><img src="' + esc(u.avatar) + '" alt="" style="--ring:' + esc(u.ring) + '"><div><b>' + esc(u.name) + '</b><small>' + esc(pl.label || '') + (p ? ' · ' + km(dist(home(), [p.lat, p.lon])) : ' · position inconnue') + '</small><small class="muted">' + (p ? ago(p.t) + ' · ' + esc(p.src) : 'Reliez son téléphone ci-dessous') + '</small></div>' + ico('pin') + '</button>'; }).join('') + '</div>' +
        '<label class="row mshare"><button type="button" class="sw sm' + (G.share[me] && watch != null ? ' on' : '') + '" data-act="mapShare" aria-label="Partager ma position"></button><span><b>Partager ma position</b><small>Depuis ce téléphone, tant que Bêta home est ouvert</small></span></label>' +
        '<button class="btn sm" data-act="mapLink">' + ico('link') + 'Relier les téléphones (Home Assistant)</button>';
    }
    if (G.tab === 'trajets') {
      const list = G.trips.filter(t => G.vf === 'all' || t.veh === G.vf), month = G.trips.filter(t => new Date(t.at).getMonth() === new Date().getMonth() && new Date(t.at).getFullYear() === new Date().getFullYear());
      h = (rec ? '<div class="mrec"><span class="dot red"></span><div><b>Enregistrement · ' + esc(veh(rec.veh).name) + '</b><small>' + km(stats(rec.pts).d) + ' · ' + dur((Date.now() - rec.t0) / 1000) + '</small></div><button class="btn sm" data-act="recStop" data-arg="0">Annuler</button><button class="btn sm pri" data-act="recStop" data-arg="1">' + ico('check') + 'Terminer</button></div>'
        : '<div class="row mtools"><button class="btn sm pri" data-act="recPick">' + ico('route') + 'Enregistrer un trajet</button><label class="btn sm" style="cursor:pointer">' + ico('upload') + 'GPX<input type="file" accept=".gpx,application/gpx+xml" multiple data-change="gpxIn" hidden></label></div>') +
        '<div class="vfilt"><button class="' + (G.vf === 'all' ? 'on' : '') + '" data-act="mapVf" data-arg="all">Tous</button>' + G.vehicles.map(v => '<button class="' + (G.vf === v.id ? 'on' : '') + '" data-act="mapVf" data-arg="' + v.id + '" style="--c:' + v.color + '">' + ico(v.icon) + esc(v.name) + '</button>').join('') + '</div>' +
        '<p class="mstat">' + ico('chart') + 'Ce mois : <b>' + km(month.reduce((a, t) => a + t.d, 0)) + '</b> en ' + month.length + ' trajet' + (month.length > 1 ? 's' : '') + '</p>' +
        '<div class="list scroll mtrips">' + (list.length ? list.map(t => { const v = veh(t.veh); return '<div class="li mtrip' + (G.sel === t.id ? ' on' : '') + '" data-act="mapTrip" data-arg="' + t.id + '" role="button"><span class="aico" style="color:' + v.color + '">' + ico(v.icon) + '</span><div><b class="ell">' + esc(t.name) + '</b><small>' + F.dayMonth(new Date(t.at)) + ' · ' + km(t.d) + ' · ' + dur(t.t) + '</small>' + (G.sel === t.id ? '<small class="cy">Moy. ' + Math.round(t.vavg) + ' km/h · max ' + Math.round(t.vmax) + ' km/h</small><span class="row" style="gap:6px;margin-top:6px"><button class="btn sm" data-act="tripGpx" data-arg="' + t.id + '">' + ico('download') + 'GPX</button><button class="btn sm" data-act="tripRename" data-arg="' + t.id + '">' + ico('edit') + 'Renommer</button><button class="btn sm dan" data-act="tripDel" data-arg="' + t.id + '">' + ico('trash') + '</button></span>' : '') + '</div></div>'; }).join('') : '<p class="muted" style="margin:10px 4px">Aucun trajet. Enregistrez votre prochaine balade ou importez un fichier GPX (Calimoto, Strava, Komoot…).</p>') + '</div>';
    }
    if (G.tab === 'vehicules') {
      h = '<div class="list scroll">' + G.vehicles.map((v, i) => { const ts = G.trips.filter(t => t.veh === v.id), tot = ts.reduce((a, t) => a + t.d, 0); return '<div class="li mveh"><span class="aico" style="color:' + v.color + '">' + ico(v.icon) + '</span><div><input value="' + esc(v.name) + '" data-change="vehName" data-arg="' + i + '" aria-label="Nom"><small>' + ts.length + ' trajet' + (ts.length > 1 ? 's' : '') + ' · ' + km(tot) + ' au total</small></div><input type="color" value="' + v.color + '" data-change="vehColor" data-arg="' + i + '" aria-label="Couleur"></div>'; }).join('') + '</div>' +
        '<button class="btn sm" data-act="vehAdd">' + ico('plus') + 'Ajouter un véhicule</button>';
    }
    return '<div class="mside">' + tabs + h + '<p class="muted mpriv">' + ico('shieldCheck') + 'Positions et trajets restent sur vos appareils. Seul le fond de carte vient d’internet (OpenStreetMap / CARTO).</p></div>';
  };
  B.act('mapTab', el => { G.tab = el.dataset.arg; B.save(); B.emit('geo'); if (G.tab === 'famille') { showTrip(null); fitFamily(); } else if (G.tab === 'trajets') { const t = G.trips.find(x => x.id === G.sel) || G.trips[0]; if (t) { G.sel = t.id; showTrip(t); B.emit('geo'); } } });
  B.act('mapUser', el => { const p = G.users[el.dataset.arg]; if (p && map) { map.flyTo([p.lat, p.lon], 15); markers[el.dataset.arg] && markers[el.dataset.arg].openPopup(); } else B.toast('Position inconnue : reliez son téléphone', 'pin'); });
  B.act('mapShare', el => { const on = !(G.share[B.user().id] && watch != null); shareMine(on); el.classList.toggle('on', on); if (!on) refreshMarkers(); });
  B.act('mapTrip', (el, e) => { if (e.target.closest('button')) return; G.sel = el.dataset.arg; B.save(); B.emit('geo'); showTrip(G.trips.find(t => t.id === G.sel)); });
  B.act('mapVf', el => { G.vf = el.dataset.arg; B.save(); B.emit('geo'); });
  B.act('recPick', () => B.modal('<h2>' + ico('route') + 'Enregistrer un trajet</h2><p class="muted" style="margin:0 0 12px;font-size:13px;line-height:1.5">Le GPS du téléphone trace le trajet. Gardez Bêta home ouvert, écran allumé (support moto conseillé). Pour un suivi écran éteint, utilisez une appli GPS (Calimoto, Strava…) puis importez le GPX.</p><div class="list">' + G.vehicles.map(v => '<button class="li" data-act="recGo" data-arg="' + v.id + '" style="width:100%;text-align:left;grid-template-columns:40px 1fr"><span class="aico" style="color:' + v.color + '">' + ico(v.icon) + '</span><b>' + esc(v.name) + '</b></button>').join('') + '</div>', 'sm'));
  B.act('recGo', el => { B.closeModal(); G.tab = 'trajets'; recStart(el.dataset.arg); });
  B.act('recStop', el => recStop(el.dataset.arg === '1'));
  B.act('gpxIn', el => { Array.from(el.files || []).forEach(f => f.text().then(txt => { const g = parseGPX(txt); const v = /moto|calimoto|balade/i.test(g.name + f.name) ? 'moto' : G.vf !== 'all' ? G.vf : 'moto'; const t = addTrip({ name: g.name || f.name.replace(/\.gpx$/i, ''), veh: v, pts: g.pts }); if (!t) return B.toast('Aucun tracé dans ' + f.name, 'info'); G.sel = t.id; G.tab = 'trajets'; save(); showTrip(t); B.toast('« ' + t.name + ' » importé : ' + km(t.d), 'route'); })); el.value = ''; });
  B.act('tripGpx', el => { const t = G.trips.find(x => x.id === el.dataset.arg); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([gpx(t)], { type: 'application/gpx+xml' })); a.download = t.name.replace(/[^\w\- ]+/g, '').trim() + '.gpx'; a.click(); });
  B.act('tripRename', el => { const t = G.trips.find(x => x.id === el.dataset.arg), n = prompt('Nom du trajet', t.name); if (n && n.trim()) { t.name = n.trim(); save(); } });
  B.act('tripDel', el => { if (!confirm('Supprimer ce trajet ?')) return; G.trips = G.trips.filter(x => x.id !== el.dataset.arg); G.sel = null; save(); showTrip(null); });
  B.act('vehName', el => { G.vehicles[+el.dataset.arg].name = el.value.trim() || G.vehicles[+el.dataset.arg].name; save(); });
  B.act('vehColor', el => { G.vehicles[+el.dataset.arg].color = el.value; save(); });
  B.act('vehAdd', () => { G.vehicles.push({ id: 'v' + Date.now().toString(36), name: 'Nouveau véhicule', type: 'autre', color: '#ffd23f', icon: 'route' }); save(); });
  B.act('mapLink', () => {
    const l = ents();
    B.modal('<h2>' + ico('link') + 'Relier les téléphones</h2><p class="muted" style="margin:0 0 12px;font-size:13px;line-height:1.5">Avec l’application Home Assistant sur chaque téléphone, sa position (person.* ou device_tracker.*) suit en continu, même écran éteint.</p>' +
      (HA.enabled() ? '<div class="list">' + S.users.map(u => '<div class="li" style="grid-template-columns:40px 1fr"><img src="' + esc(u.avatar) + '" alt="" style="width:36px;height:36px;border-radius:50%"><label class="field">' + esc(u.name) + '<select data-change="mapEnt" data-arg="' + u.id + '"><option value="">—</option>' + l.map(e => '<option value="' + e + '"' + (G.ent[u.id] === e ? ' selected' : '') + '>' + esc((HA.states[e].attributes || {}).friendly_name || e) + ' · ' + e + '</option>').join('') + '</select></label></div>').join('') + '</div>' : '<p class="warn">Reliez d’abord Home Assistant (Connexions).</p>'), 'sm');
  });
  B.act('mapEnt', el => { G.ent[el.dataset.arg] = el.value; fromHA(el.dataset.arg); save(); refreshMarkers(); });
  setInterval(() => { if (rec) B.emit('geo'); }, 5000);

  /* ---------- page ---------- */
  B.route('carte', { title: 'Carte', bg: BG, render: () => B.side('carte') + B.header({ id: 'carte', title: 'Carte', sub: 'Famille, véhicules et balades', icon: 'map', info: { t: 'infobox', keys: ['geo', 'users'], items: () => {
    const at = S.users.filter(u => u.place === 'home').length, moto = G.trips.filter(t => veh(t.veh).type === 'moto'), last = G.trips[0];
    return [{ icon: 'homeFill', v: at + '/' + S.users.length, l: 'À la maison', cls: 'c' }, { icon: 'moto', v: km(moto.reduce((a, t) => a + t.d, 0)), l: 'À moto' }, { icon: 'route', v: G.trips.length, l: 'Trajets' }, { icon: 'history', v: last ? new Date(last.at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) : '—', l: 'Dernier', cls: 'p' }];
  } } }) +
    '<section class="card pcard abs" style="' + box([105, 235, 1110, 1012]) + '">' + B.whead('map', 'Carte', '<button class="wmore" data-act="mapFit" aria-label="Recentrer">' + ico('target') + '</button>') + '<div class="mapslot" id="mapslot"></div></section>' +
    '<section class="card pcard abs" style="' + box([1120, 235, 1522, 1012]) + '">' + T({ t: 'mapside', keys: ['geo', 'users'] }) + '</section>',
    after: () => { setTimeout(mount, 30); } });
  B.act('mapFit', () => { if (G.tab === 'trajets' && G.sel) showTrip(G.trips.find(t => t.id === G.sel)); else fitFamily(); });
  // menu : « Carte » dans les outils
  const nl0 = B.navList;
  B.navList = NAV => { const out = (nl0 ? nl0(NAV) : NAV).slice(); if (!out.some(n => n[0] === 'carte')) { const i = out.findIndex(n => n[0] === 'calendrier'); out.splice(i < 0 ? out.length : i, 0, ['carte', 'Carte', 'map', 'map', 'noside']); } return out; };

  /* ---------- Bêta IA : « où est Sarah ? », « combien de km à moto ce mois ? » ---------- */
  const ia0 = B.ia;
  B.ia = text => {
    const q = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const u = /\bou (est|sont)\b|position|localis/.test(q) && S.users.find(x => q.includes(x.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')));
    if (u) { const p = G.users[u.id], pl = DATA.PLACES[u.place] || {}; return u.name + ' : ' + (pl.label || 'position inconnue') + (p ? ', à ' + km(dist(home(), [p.lat, p.lon])) + ' de la maison (' + ago(p.t) + ').' : '.'); }
    if (/(km|kilometre|trajet|balade|roule)/.test(q) && /moto|velo|voiture|ce mois|cette semaine|total/.test(q)) {
      const v = /moto/.test(q) ? 'moto' : /velo/.test(q) ? 'velo' : /voiture/.test(q) ? 'voiture' : null, from = /semaine/.test(q) ? Date.now() - 7 * 864e5 : /mois/.test(q) ? +new Date(new Date().getFullYear(), new Date().getMonth(), 1) : 0;
      const l = G.trips.filter(t => (!v || veh(t.veh).type === v) && t.at >= from); return (v ? ({ moto: 'À moto', velo: 'À vélo', voiture: 'En voiture' })[v] : 'Au total') + (from ? (/semaine/.test(q) ? ' cette semaine' : ' ce mois') : '') + ' : ' + km(l.reduce((a, t) => a + t.d, 0)) + ' en ' + l.length + ' trajet' + (l.length > 1 ? 's' : '') + (l[0] ? '. Dernier : « ' + l[0].name + ' ».' : '.');
    }
    return ia0(text);
  };
})();

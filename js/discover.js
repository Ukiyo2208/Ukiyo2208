/* Bêta home 7.4 — « Découvrir » : le serveur Bêta scanne le réseau (caméras ONVIF/RTSP, Bonjour, UPnP)
   et propose pour chaque appareil la bonne façon de le relier : caméra ajoutée directement (avec
   pont HomeKit via go2rtc), marque reliée dans « Marques », ou intégration Home Assistant. */
(function () {
  const B = window.BOS, { S, DATA, esc } = B;
  if (!S.netcams) S.netcams = [];                        // caméras ajoutées : { id, name, slot, homekit, pin, ip }
  const Srv = () => B.Server;
  const online = () => Srv() && Srv().ok();
  const key = () => ((S.conn || {}).server || {}).key || '';
  const media = (id, kind) => Srv().url() + '/api/cams/' + kind + '/' + id + '?k=' + encodeURIComponent(key()) + (kind === 'frame' ? '&t=' + Math.floor(Date.now() / 10000) : '');
  const fmtPin = p => p ? p.slice(0, 3) + '-' + p.slice(3, 5) + '-' + p.slice(5) : '';
  const TYPES = { camera: ['Caméras', 'camera'], hub: ['Ponts et box', 'homeFill'], lampe: ['Éclairage', 'bulbFill'], prise: ['Prises et modules', 'plug'], telecommande: ['Télécommandes', 'tv'], robot: ['Robots', 'robotFill'], module: ['Prises et modules', 'plug'], matter: ['Matter', 'link'], clim: ['Climatisation', 'snow'], homekit: ['HomeKit', 'homeFill'], multimedia: ['Multimédia', 'speaker'], imprimante: ['Imprimantes', 'files'], nas: ['NAS et partages', 'nas'], box: ['Box internet', 'wifi'], autre: ['Autres', 'grid9'] };

  /* ---------- caméras ajoutées → emplacements de caméra de Bêta home ---------- */
  function applyCams() {
    S.netcams.forEach(c => {
      const slot = c.slot || ('cam.n_' + c.id);
      DATA.CAMS[slot] = Object.assign(DATA.CAMS[slot] || { det: ['person', 'car', 'animal', 'motion'] }, { name: c.name, net: c.id, ha: '' });
      if (online() && !c.demo) { DATA.CAMS[slot].img = media(c.id, 'frame'); B.camState(slot).live = media(c.id, 'frame'); }
      if (!DATA.CAMS[slot].img) DATA.CAMS[slot].img = 'assets/cams/rdc-entree.jpg';
    });
  }
  applyCams();
  // l'image des caméras se rafraîchit toutes les 10 s quand une page les affiche
  setInterval(() => { if (!online() || document.hidden) return; S.netcams.forEach(c => { if (c.demo) return; const slot = c.slot || ('cam.n_' + c.id); B.camState(slot).live = media(c.id, 'frame'); B.emit('cam:' + slot); }); }, 10000);
  // en grand : le direct (MJPEG relayé par le serveur)
  const cam0 = B.ACT.cam;
  B.ACT.cam = (el, e) => { const r = cam0(el, e); const c = S.netcams.find(x => (x.slot || 'cam.n_' + x.id) === el.dataset.id); if (c && online() && !c.demo) { const img = document.querySelector('.camview img'); if (img) img.src = media(c.id, 'mjpeg'); const p = document.querySelector('.modal .box p.muted:last-child'); if (p) p.textContent = 'Direct depuis la caméra (go2rtc sur le NAS).'; } return r; };

  /* ---------- exemple (sans serveur) ---------- */
  const DEMO = { at: Date.now(), took: 3400, subnets: ['192.168.1'], demo: true, devices: [
    { ip: '192.168.1.60', type: 'camera', name: 'Tapo C200', brand: 'TP-Link Tapo', model: 'C200', via: ['ONVIF', 'RTSP'], onvif: 'http://192.168.1.60:2020/onvif/device_service', link: 'camera' },
    { ip: '192.168.1.61', type: 'camera', name: 'Reolink RLC-510A', brand: 'Reolink', model: 'RLC-510A', via: ['ONVIF'], onvif: 'http://192.168.1.61:8000/onvif/device_service', link: 'camera' },
    { ip: '192.168.1.64', type: 'camera', name: 'Caméra 192.168.1.64', via: ['RTSP'], rtspPort: 554, link: 'camera' },
    { ip: '192.168.1.41', type: 'hub', name: 'Hue Bridge', brand: 'Philips Hue', via: ['mDNS'], link: 'brand:hue' },
    { ip: '192.168.1.40', type: 'hub', name: 'TaHoma Switch', brand: 'Somfy TaHoma', via: ['mDNS'], link: 'brand:tahoma' },
    { ip: '192.168.1.50', type: 'lampe', name: 'Elgato Key Light', brand: 'Elgato', via: ['mDNS'], link: 'brand:elgato' },
    { ip: '192.168.1.70', type: 'prise', name: 'shellyplug-s-A1B2C3', brand: 'Shelly', via: ['mDNS'], link: 'brand:shelly' },
    { ip: '192.168.1.90', type: 'module', name: 'capteur-garage', brand: 'ESPHome', via: ['mDNS'], link: 'brand:esphome' },
    { ip: '192.168.1.85', type: 'multimedia', name: 'Salon', brand: 'Sonos', model: 'Era 100', via: ['mDNS', 'UPnP'], link: 'brand:sonos' },
    { ip: '192.168.1.80', type: 'multimedia', name: 'Salon TV', brand: 'Google Cast', via: ['mDNS'], link: 'brand:cast' },
    { ip: '192.168.1.62', type: 'multimedia', name: 'TV salon', brand: 'TV LG', model: 'OLED48C1', via: ['UPnP'], link: 'brand:lgtv' },
    { ip: '192.168.1.71', type: 'prise', name: 'Prise bureau', brand: 'TP-Link Kasa', model: 'KP115', via: ['UDP'], link: 'brand:kasa' },
    { ip: '192.168.1.81', type: 'multimedia', name: 'Echo Dot cuisine', brand: 'Amazon Echo / Fire', via: ['mDNS'], link: 'alexa' },
    { ip: '192.168.1.20', type: 'nas', name: 'UGREEN DXP', brand: 'UGREEN', via: ['mDNS', 'UPnP'], link: '' },
    { ip: '192.168.1.1', type: 'box', name: 'Freebox', brand: 'Box internet', via: ['UPnP'], link: '' }] };

  /* ---------- fenêtre « Découvrir » ---------- */
  let res = null, busy = false;
  function linkBtn(d, i) {
    const known = S.netcams.some(c => c.ip === d.ip);
    if (d.type === 'camera') return known ? '<span class="tag2">Ajoutée</span>' : '<button class="btn sm pri" data-act="dcAddCam" data-arg="' + i + '">' + ico('plus') + 'Ajouter</button>';
    if (/^brand:/.test(d.link)) return '<button class="btn sm" data-act="dcBrand" data-arg="' + i + '">' + ico('link') + 'Relier</button>';
    if (d.link === 'homekit') return '<span class="muted dsmall">Accessoire HomeKit : app Maison</span>';
    if (d.link === 'airplay') return '<span class="muted dsmall">AirPlay : depuis l’iPhone</span>';
    if (d.link === 'alexa') return '<span class="muted dsmall">Via Alexa (Matter)</span>';
    return '';
  }
  function body() {
    if (busy) return '<div class="dscan"><span class="dring"></span><b>Recherche sur le réseau…</b><small>Caméras (ONVIF, RTSP), Bonjour, UPnP — environ 5 secondes</small></div>';
    if (!res) return '<div class="dintro"><p>Bêta home cherche les appareils de votre réseau : <b>caméras</b>, ponts et box (Hue, TaHoma…), prises, enceintes, TV, imprimantes. Pour chacun, il propose la bonne façon de le relier.</p>' +
      (online() ? '<button class="btn pri" data-act="dcScan">' + ico('search2') + 'Lancer la recherche</button>' : '<p class="warn">La recherche se fait depuis le <b>serveur Bêta</b> (Docker sur le NAS) : un navigateur ne peut pas explorer le réseau.</p><div class="row" style="gap:8px;flex-wrap:wrap"><a class="btn" href="#connexions" data-act="closeModalNav">' + ico('link') + 'Connexions</a><button class="btn pri" data-act="dcDemo">' + ico('sparkle') + 'Voir un exemple</button></div>') + '</div>';
    const groups = {};
    res.devices.forEach((d, i) => { const g = (TYPES[d.type] || TYPES.autre)[0]; (groups[g] = groups[g] || []).push([d, i]); });
    return '<p class="muted dsum">' + res.devices.length + ' appareil(s) trouvé(s) en ' + (res.took / 1000).toFixed(1).replace('.', ',') + ' s' + (res.demo ? ' · <b>exemple</b>' : '') + '</p><div class="dlist scroll">' +
      Object.keys(groups).map(g => '<section><h4>' + ico((Object.values(TYPES).find(t => t[0] === g) || TYPES.autre)[1]) + g + '</h4>' + groups[g].map(([d, i]) => '<div class="li dli"><div><b>' + esc(d.name || d.ip) + '</b><small>' + esc([d.brand, d.brand && d.model && !d.brand.includes(d.model) ? d.model : '', d.ip, (d.via || []).join(', ')].filter(Boolean).join(' · ')) + '</small></div>' + linkBtn(d, i) + '</div>').join('') + '</section>').join('') + '</div>' +
      '<div class="row" style="justify-content:space-between;gap:8px;flex-wrap:wrap"><button class="btn" data-act="camMgr">' + ico('camera') + 'Caméras & HomeKit</button>' + (res.demo ? '' : '<button class="btn" data-act="dcScan">' + ico('refresh') + 'Relancer</button>') + '</div>';
  }
  const paint = () => { const b = document.querySelector('.modal .box.discover'); if (b) b.innerHTML = '<button class="x" data-act="closeModal" aria-label="Fermer">' + ico('x') + '</button><h2>' + ico('search2') + 'Découvrir le réseau</h2>' + body(); else B.modal('<h2>' + ico('search2') + 'Découvrir le réseau</h2>' + body(), 'discover wide'); };
  B.act('discover', () => { if (!B.user().admin) return B.toast('Réservé aux administrateurs', 'lock'); paint(); });
  B.act('dcDemo', () => { res = DEMO; paint(); });
  B.act('dcScan', async () => { busy = true; paint(); try { res = await Srv().post('/api/discover', { rtsp: true }); } catch (e) { B.toast('Recherche impossible : ' + e.message, 'info'); } busy = false; paint(); });
  B.act('dcBrand', el => {
    const d = res.devices[+el.dataset.arg], id = d.link.slice(6); B.closeModal(); B.go('marques');
    if (B.brandOff && B.brandOff(id)) { delete S.settings.brandsOff[id]; B.save(); B.toast('Marque réaffichée dans la page Marques', 'link'); }
    setTimeout(() => { if (B.ACT.hubOpen) B.ACT.hubOpen({ dataset: { arg: id } }); setTimeout(() => { if (id === 'matter') return B.toast('Saisissez le code d’appairage de l’appareil, puis « Ajouter cet appareil »', 'link'); const f = document.querySelector('form[data-submit="hubSave"][data-arg="' + id + '"]'); const one = f && f.querySelector('[name=host]'), many = f && f.querySelector('[name=hosts]'), val = id === 'cast' ? d.ip + ':' + d.name : d.ip; if (one && !one.value) one.value = d.ip; if (many && !many.value.includes(d.ip)) many.value = (many.value.trim() ? many.value.trim() + ', ' : '') + val; if (one || many) B.toast(d.ip + ' ajouté : « Enregistrer », puis « Tester » et « Ajouter les appareils »', 'link'); }, 250); }, 400);
  });

  /* ---------- ajouter une caméra ---------- */
  let draft = null;
  function camForm() {
    const d = draft, slots = Object.keys(DATA.CAMS).filter(k => !S.netcams.some(c => c.slot === k));
    B.modal('<h2>' + ico('camera') + 'Ajouter une caméra</h2><form class="camf" data-submit="cfSave">' +
      '<div class="grid2"><label class="field">Nom<input name="name" value="' + esc(d.name) + '" required></label><label class="field">Emplacement dans Bêta home<select name="slot"><option value="">Nouvel emplacement</option>' + slots.map(k => '<option value="' + k + '"' + (d.slot === k ? ' selected' : '') + '>Remplacer « ' + esc(DATA.CAMS[k].name) + ' »</option>').join('') + '</select></label></div>' +
      (d.onvif ? '<div class="grid2"><label class="field">Identifiant de la caméra<input name="user" value="' + esc(d.user || '') + '" autocomplete="off" placeholder="admin"></label><label class="field">Mot de passe<input name="pass" type="password" autocomplete="new-password"></label></div>' +
        '<button type="button" class="btn sm" data-act="cfOnvif">' + ico('search2') + 'Trouver le flux vidéo (ONVIF)</button>' + (d.err ? '<p class="warn">' + esc(d.err) + '</p>' : '') +
        (d.streams ? '<div class="cfstreams">' + d.streams.map((s, i) => '<label class="row"><input type="radio" name="st" value="' + i + '"' + (i === (d.pick || 0) ? ' checked' : '') + ' data-change="cfPick"><span><b>' + (i ? 'Flux secondaire (léger)' : 'Flux principal (haute qualité)') + '</b><small>' + esc(s.rtsp.replace(/\/\/[^@/]*@/, '//')) + '</small></span></label>').join('') + '</div>' : '') : '') +
      '<label class="field">Adresse vidéo (RTSP) <small class="muted">— trouvée automatiquement, ou à saisir</small><input name="rtsp" value="' + esc(d.rtsp || '') + '" placeholder="rtsp://identifiant:motdepasse@' + esc(d.ip || '192.168.1.60') + ':554/stream1" spellcheck="false" autocomplete="off"></label>' +
      '<label class="row cfhk"><button type="button" class="sw sm' + (d.homekit ? ' on' : '') + '" data-act="cfHk" aria-label="HomeKit"></button><span><b>Ajouter à HomeKit (app Maison)</b><small>Uniquement les caméras passent par le pont HomeKit de Bêta home (go2rtc)</small></span></label>' +
      '<p class="muted" style="font-size:12px;margin:0">L’adresse vidéo et le mot de passe restent sur le NAS : le navigateur ne les garde pas.</p>' +
      '<div class="row" style="justify-content:flex-end;gap:8px"><button type="button" class="btn" data-act="closeModal">Annuler</button><button class="btn pri">' + ico('check') + 'Ajouter</button></div></form>', 'sm');
  }
  B.act('dcAddCam', el => { const d = res.devices[+el.dataset.arg]; draft = { name: d.name.replace(/^Caméra /, 'Caméra '), ip: d.ip, onvif: d.onvif, homekit: true, demo: !!res.demo, rtsp: d.onvif ? '' : 'rtsp://' + d.ip + ':' + (d.rtspPort || 554) + '/' }; camForm(); });
  B.act('camAddManual', () => { draft = { name: 'Nouvelle caméra', homekit: true, demo: !online() }; camForm(); });
  B.act('cfHk', el => { draft.homekit = !draft.homekit; el.classList.toggle('on', draft.homekit); });
  B.act('cfPick', el => { draft.pick = +el.value; const f = el.form; f.rtsp.value = draft.streams[draft.pick].rtsp; });
  B.act('cfOnvif', async el => {
    const f = el.form; Object.assign(draft, { name: f.name.value, slot: f.slot.value, user: f.user.value.trim() });
    if (draft.demo) { draft.streams = [{ rtsp: 'rtsp://' + draft.ip + ':554/stream1' }, { rtsp: 'rtsp://' + draft.ip + ':554/stream2' }]; draft.rtsp = draft.streams[0].rtsp; draft.err = ''; return camForm(); }
    try { const r = await Srv().post('/api/cams/onvif', { xaddr: draft.onvif, user: draft.user, pass: f.pass.value }); if (r.error) throw new Error(r.error);
      // l'identifiant et le mot de passe sont ajoutés dans l'adresse ; elle part ensuite au NAS, pas dans le navigateur
      const auth = draft.user ? encodeURIComponent(draft.user) + ':' + encodeURIComponent(f.pass.value) + '@' : '';
      draft.streams = r.streams.map(s => ({ rtsp: s.rtsp.replace(/^rtsp:\/\/(?:[^@/]*@)?/, 'rtsp://' + auth) })); draft.pick = 0; draft.rtsp = draft.streams[0].rtsp; draft.err = ''; }
    catch (e) { draft.err = 'ONVIF : ' + e.message + '. Vous pouvez saisir l’adresse RTSP à la main.'; }
    camForm();
  });
  async function pushCams(extra) {
    const list = S.netcams.filter(c => !c.demo).map(c => Object.assign({ id: c.id, name: c.name, ip: c.ip, homekit: !!c.homekit }, extra && extra.id === c.id ? { rtsp: extra.rtsp } : {}));
    if (extra && !extra.id) list.push({ name: extra.name, ip: extra.ip, homekit: extra.homekit, rtsp: extra.rtsp });
    const r = await Srv().post('/api/cams', { cams: list });
    if (r.error) throw new Error(r.error);
    S.netcams = S.netcams.filter(c => c.demo).concat(r.cams.map((c, i) => { const old = S.netcams.filter(x => !x.demo)[i] || {}; return Object.assign({}, old, { id: c.id, name: c.name, ip: c.ip, homekit: c.homekit, pin: c.pin }, i === r.cams.length - 1 && extra && !extra.id ? { slot: extra.slot } : {}); }));
    if (r.go2rtc !== 'ok') B.toast('Caméras enregistrées. ' + r.go2rtc + ' — démarrez le conteneur go2rtc pour le direct et HomeKit.', 'info');
  }
  B.act('cfSave', async el => {
    const f = new FormData(el), rtsp = String(f.get('rtsp') || '').trim();
    const c = { name: String(f.get('name')).trim(), slot: f.get('slot') || '', ip: draft.ip || '', homekit: draft.homekit, rtsp };
    if (!rtsp) return B.toast('Indiquez l’adresse vidéo (ou « Trouver le flux »)', 'camera');
    try {
      if (draft.demo || !online()) S.netcams.push(Object.assign({ id: 'demo' + Date.now().toString(36), demo: true, pin: c.homekit ? String(Math.floor(1e7 + Math.random() * 9e7)) : '' }, c, { rtsp: undefined }));
      else await pushCams(c);
      applyCams(); B.save(); B.closeModal(); B.emit('cams'); B.show();
      const n = S.netcams[S.netcams.length - 1];
      B.toast('« ' + c.name + ' » ajoutée' + (c.homekit && n.pin ? ' · code HomeKit ' + fmtPin(n.pin) : '') + (draft.demo ? ' (exemple)' : ''), 'camera');
      setTimeout(() => B.ACT.camMgr(), 400);
    } catch (e) { B.toast('Ajout impossible : ' + e.message, 'info'); }
  });

  /* ---------- caméras & HomeKit ---------- */
  B.act('camMgr', () => {
    const l = S.netcams;
    B.modal('<h2>' + ico('camera') + 'Caméras & HomeKit</h2><div class="list cmgr">' + (l.length ? l.map((c, i) => '<div class="li"><span class="aico">' + ico('camera') + '</span><div><b>' + esc(c.name) + (c.demo ? ' <small class="tag2 wait">exemple</small>' : '') + '</b><small>' + esc(c.ip || '') + (c.slot ? ' · remplace « ' + esc((DATA.CAMS[c.slot] || {}).name || c.slot) + ' »' : '') + '</small>' +
      (c.homekit && c.pin ? '<span class="hkcode">' + ico('homeFill') + 'HomeKit · <b>' + fmtPin(c.pin) + '</b></span>' : '') + '</div><div class="row" style="gap:6px"><button type="button" class="sw sm' + (c.homekit ? ' on' : '') + '" data-act="cmHk" data-arg="' + i + '" title="HomeKit"></button><button class="sq" data-act="cmDel" data-arg="' + i + '" aria-label="Retirer">' + ico('trash') + '</button></div></div>').join('') : '<p class="muted" style="margin:6px 4px">Aucune caméra ajoutée.</p>') + '</div>' +
      '<div class="hkhelp">' + ico('info') + '<span><b>Ajouter dans l’app Maison :</b> Maison › ＋ › Ajouter un accessoire › « Plus d’options… » : la caméra apparaît (même réseau). Touchez-la et saisissez son <b>code HomeKit</b> ci-dessus. Chaque caméra est un accessoire à part : c’est ce qu’Apple recommande pour la vidéo, plus fluide qu’un pont unique.</span></div>' +
      '<div class="row" style="justify-content:space-between;gap:8px;flex-wrap:wrap"><button class="btn" data-act="camAddManual">' + ico('plus') + 'Ajouter à la main</button><button class="btn pri" data-act="discover">' + ico('search2') + 'Découvrir des caméras</button></div>', 'sm');
  });
  B.act('cmHk', async el => { const c = S.netcams[+el.dataset.arg]; c.homekit = !c.homekit; if (c.demo) { c.pin = c.homekit ? (c.pin || String(Math.floor(1e7 + Math.random() * 9e7))) : ''; } else { try { await pushCams(); } catch (e) { B.toast(e.message, 'info'); } } B.save(); B.ACT.camMgr(); });
  B.act('cmDel', async el => { const c = S.netcams[+el.dataset.arg]; if (!confirm('Retirer « ' + c.name + ' » ?')) return; S.netcams.splice(+el.dataset.arg, 1); if (!c.slot) delete DATA.CAMS['cam.n_' + c.id]; if (!c.demo && online()) { try { await pushCams(); } catch (e) { } } B.save(); B.ACT.camMgr(); B.show(); });

  /* ---------- accès : Connexions, Marques, menu ---------- */
  const conn0 = B.RENDER.conn;
  if (conn0) B.RENDER.conn = s => conn0(s).replace('<div class="csave">', '<div class="ccard tile wide2 dcard"><div class="cch">' + B.badge('home') + '<div><b>Découvrir le réseau</b><small>Caméras, ponts, prises, enceintes… et pont HomeKit pour les caméras · ' + S.netcams.length + ' caméra(s) ajoutée(s)</small></div></div><div class="row" style="gap:8px;flex-wrap:wrap"><button type="button" class="btn sm pri" data-act="discover">' + ico('search2') + 'Découvrir</button><button type="button" class="btn sm" data-act="camMgr">' + ico('camera') + 'Caméras & HomeKit</button></div></div><div class="csave">');
  const mq = B.ROUTES.marques;
  if (mq) { const r0 = mq.render; mq.render = () => r0().replace(/(<section class="card pcard abs"[^>]*>)/, '$1<button class="btn sm pri mqdisc" data-act="discover">' + ico('search2') + 'Découvrir</button>'); }
  B.discover = { applyCams, demo: () => { res = DEMO; } };
})();

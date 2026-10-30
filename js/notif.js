/* Bêta home — notifications sur les téléphones. Deux modes :
   - ntfy (7.7, sans Home Assistant) : le serveur Bêta du NAS envoie lui-même, 24 h/24, avec l'appli gratuite ntfy,
     et surveille les appareils reliés en direct (sonnette, fuite, garage…) ; la sonnette fait aussi parler les tablettes ;
   - Home Assistant (6.4) : appli Home Assistant « Companion », service notify.mobile_app_…, envoi par l'écran
     « émetteur » ou automatisations Home Assistant exportées. */
(function () {
  const B = window.BOS, { S, DATA, esc, F, dev } = B;
  const HA = B.HA;
  const N = S.notif = Object.assign({ to: {}, rules: {}, garageMin: 10, trashAt: '18:30', log: {}, topic: {}, ntfy: 'https://ntfy.sh', bell: '', garage: '', cam: '', tab: { say: true, show: true, text: 'On sonne à la porte', tv: false } }, S.notif || {});
  // mode : ntfy (serveur Bêta, sans Home Assistant) dès qu'il n'y a pas de Home Assistant
  const via = () => N.via || (HA.enabled() ? 'ha' : 'ntfy');
  const srv = () => B.Server && B.Server.ok();
  const WATCHED = ['doorbell', 'person', 'garage', 'leak', 'alarm', 'appliance'];   // gérés par le serveur pour les appareils reliés en direct
  const RULES = [
    ['doorbell', 'bellFill', 'Sonnette', 'Avec la photo de la caméra', 'all'],
    ['person', 'user', 'Personne détectée', 'Seulement en mode absent ou alarme activée', 'all'],
    ['garage', 'garage', 'Garage resté ouvert', 'Après quelques minutes (réglable)', 'all'],
    ['leak', 'dropFill', 'Fuite d’eau', 'Alerte critique, même en silencieux', 'all'],
    ['alarm', 'shieldCheck', 'Alarme déclenchée', 'Alerte critique, même en silencieux', 'all'],
    ['trash', 'trash', 'Poubelles à sortir', 'La veille au soir, d’après le calendrier', 'all'],
    ['appliance', 'washer', 'Machine terminée', 'Lave-linge, lave-vaisselle', 'all'],
    ['weather', 'rain', 'Alerte météo', 'Pluie imminente, orage, vent fort, gel', 'all'],
    ['away', 'walk', 'Mode absent', 'Quand la maison passe en absent ou revient', 'admins'],
    ['presence', 'pin', 'Arrivées et départs', 'Quand quelqu’un arrive ou quitte la maison (OwnTracks)', 'admins'],
    ['tempo', 'boltPlain', 'Jour rouge Tempo', 'La veille, pour décaler machines et recharge', 'all'],
    ['health', 'heart', 'Santé de la maison', 'Appareil hors ligne, pile faible, sauvegarde ratée', 'admins'],
    ['energy', 'chart', 'Consommation inhabituelle', 'Plus de 1,5 fois la normale à la même heure', 'all'],
    ['water', 'sprinkler', 'Arrosage annulé', 'Quand il a plu ou qu’il va pleuvoir', 'all'],
    ['network', 'wifi', 'Réseau', 'Appareil inconnu, coupure internet, débit en chute', 'admins'],
    ['reminder', 'history', 'Rappels et bilan', 'Entretien de la maison, récompenses, bilan du mois', 'all']
  ];
  RULES.forEach(r => { if (!N.rules[r[0]]) N.rules[r[0]] = { on: r[0] !== 'away', who: r[4] }; });
  const isSender = () => { try { return localStorage.getItem('betaos.notifier') === '1'; } catch (e) { return false; } };
  const svcOf = u => (N.to[u.id] || '').replace(/^notify\./, '');
  const site = () => location.origin + location.pathname.replace(/index\.html$/, '');

  /* ---------- envoi ---------- */
  async function send(rule, title, message, o) {
    o = o || {};
    const r = N.rules[rule]; if (!r || !r.on) return 0;
    if (via() === 'ntfy') {
      if (!srv() || (WATCHED.includes(rule) && o.hub)) return 0;   // appareil relié en direct : le serveur s'en charge déjà
      try { return (await B.Server.post('/api/notify/send', { rule, title, message, go: o.go, urgent: o.urgent, critical: o.critical, key: o.tag || rule })).sent; } catch (e) { return 0; }
    }
    if (!HA.enabled()) return 0;
    const users = S.users.filter(u => svcOf(u) && (r.who !== 'admins' || u.admin));
    const data = { url: site() + '#' + (o.go || 'accueil'), clickAction: site() + '#' + (o.go || 'accueil'), group: 'beta-' + rule, tag: o.tag || 'beta-' + rule };
    if (o.image) data.image = o.image;
    if (o.url) data.url = data.clickAction = o.url;
    if (o.actions) data.actions = o.actions;
    if (o.critical) data.push = { sound: { name: 'default', critical: 1, volume: 1 }, 'interruption-level': 'critical' }, data.ttl = 0, data.priority = 'high', data.channel = 'Alertes Bêta home';
    else if (o.urgent) data.push = { 'interruption-level': 'time-sensitive' };
    let n = 0;
    for (const u of users) { try { await HA.req('/api/services/notify/' + svcOf(u), { title, message, data }); n++; } catch (e) { HA.lastError = 'notification : ' + e.message; } }
    return n;
  }
  // une seule fois par clé et par délai, et uniquement depuis l'écran « émetteur »
  function once(key, ms, fn) {
    if (!isSender()) return;
    const t = N.log[key] || 0; if (Date.now() - t < ms) return;
    N.log[key] = Date.now(); B.save(); fn();
  }
  B.notifySend = send;

  /* ---------- déclencheurs ---------- */
  const camImg = cid => { const e = HA.camEntity ? HA.camEntity(cid) : ''; return e ? '/api/camera_proxy/' + e : undefined; };
  const hubbed = id => !!(S.settings.hubMap && S.settings.hubMap[id]);
  B.on('doorbell', src => src !== 'server' && once('doorbell', 60e3, () => send('doorbell', 'Sonnette', 'Quelqu’un sonne à la porte', { image: camImg('cam.sonnette'), go: 'exterieur', urgent: 1 })));
  B.on('motion', cid => { if (!(S.away || S.alarm)) return; once('person:' + cid, 10 * 6e4, () => send('person', 'Mouvement détecté', ((DATA.CAMS[cid] || {}).name || 'Caméra') + ' — alors que la maison est en absence', { image: camImg(cid), go: 'absence', urgent: 1 })); });
  B.on('dev', ({ id, patch }) => {
    const d = DATA.DEVICES[id]; if (!d) return;
    const k = B.kindOf ? B.kindOf(d) : d.type;
    if (via() === 'ntfy' && hubbed(id)) return;   // surveillé 24 h/24 par le serveur
    if (k === 'leak' && patch.on) once('leak:' + id, 30 * 6e4, () => send('leak', 'Fuite d’eau !', d.name + ' — ' + d.room, { critical: 1, go: 'absence' }));
    if (d.type === 'alarm' && patch.mode === 'triggered') once('alarm:' + id, 5 * 6e4, () => send('alarm', 'ALARME DÉCLENCHÉE', d.name + ' — vérifiez les caméras', { critical: 1, go: 'exterieur' }));
    if (d.type === 'app' && patch.on === false) once('app:' + id, 30 * 6e4, () => send('appliance', d.name + ' terminé', 'Le cycle est fini (' + d.room + ')', { go: 'rdc' }));
    if (id === 'rdc.garage.door' && 'pos' in patch) { if (patch.pos > 0) N.garageAt = N.garageAt || Date.now(); else N.garageAt = 0; B.save(); }
  });
  if (B.awayLock) { const a0 = B.awayLock; B.awayLock = () => { if (via() !== 'ntfy') once('away:on', 60e3, () => send('away', 'Mode absent activé', 'Maison sécurisée par ' + B.user().name, { go: 'absence' })); return a0(); }; }
  // vérifications à la minute : garage, poubelles, météo
  setInterval(() => {
    if (!isSender()) return;
    const now = new Date();
    if (N.garageAt && dev('rdc.garage.door').pos > 0 && Date.now() - N.garageAt > N.garageMin * 6e4) once('garage', 30 * 6e4, () => send('garage', 'Garage ouvert', 'La porte du garage est ouverte depuis ' + Math.round((Date.now() - N.garageAt) / 6e4) + ' min', { go: 'absence', urgent: 1 }));
    const [hh, mm] = (N.trashAt || '18:30').split(':').map(Number);
    if (now.getHours() * 60 + now.getMinutes() >= hh * 60 + mm) {
      const tm = F.ymd(new Date(Date.now() + 864e5)), ev = S.events.filter(e => e.date === tm && /poubelle|ordure|d[ée]chet|collecte|verre|bio ?d[ée]chet|encombrant|papier/i.test(e.title));
      if (ev.length && !N.trashServer) once('trash:' + tm, 20 * 36e5, () => send('trash', 'Poubelles', 'À sortir ce soir : ' + ev.map(e => e.title).join(', '), { go: 'calendrier' }));
    }
    const a = (B.wxAlerts ? B.wxAlerts() : [])[0];
    if (a) once('wx:' + a.icon, 6 * 36e5, () => send('weather', 'Alerte météo', a.text + ' (' + S.settings.city + ')', { go: 'accueil' }));
    else { const h = B.WX.hours.find(x => +x.t > Date.now() && +x.t < Date.now() + 36e5 && x.prob >= 70); if (h && B.WX.now.code < 51) once('wx:rain', 6 * 36e5, () => send('weather', 'Pluie bientôt', 'Pluie probable vers ' + F.time(h.t) + ' à ' + S.settings.city + ' — linge dehors ?', { go: 'accueil' })); }
  }, 60e3);


  /* ---------- mode ntfy : réglages gardés par le serveur Bêta (il envoie 24 h/24) ---------- */
  const hubDevs = test => Object.keys(S.settings.hubMap || {}).filter(id => !(B.brandOff && B.brandOff(S.settings.hubMap[id].brand))).map(id => DATA.DEVICES[id] && Object.assign({ id, k: B.kindOf ? B.kindOf(DATA.DEVICES[id]) : DATA.DEVICES[id].type }, DATA.DEVICES[id])).filter(d => d && (!test || test(d)));
  const WATCH_KINDS = ['leak', 'motion', 'door', 'alarm', 'app', 'garage'];
  function watchList() {
    return hubDevs().map(d => { const r = S.settings.hubMap[d.id], role = d.id === N.bell ? 'doorbell' : d.id === N.garage ? 'garage' : ''; return (role || WATCH_KINDS.includes(d.k)) ? { brand: r.brand, id: r.id, kind: d.k, name: d.name, room: d.room || '', role } : null; }).filter(Boolean);
  }
  let syncT = 0, tok = null;
  function sync(now) {
    clearTimeout(syncT); if (via() !== 'ntfy' || !srv()) return Promise.resolve();
    if (now) return push();
    syncT = setTimeout(push, 600);
  }
  async function push() {
    const users = {}; S.users.forEach(u => { if (N.topic[u.id]) users[u.id] = { name: u.name, topic: N.topic[u.id], admin: !!u.admin }; });
    const body = { ntfy: { url: N.ntfy || 'https://ntfy.sh' }, users, rules: N.rules, watch: watchList(), tablets: N.tab, cam: N.cam || '', site: site(), garageMin: N.garageMin };
    if (tok != null) body.ntfy.token = tok;
    try { await B.Server.req('/api/notify', body, 'PUT'); tok = null; } catch (e) { B.toast('Serveur Bêta : réglages des notifications non enregistrés', 'info'); }
  }
  setTimeout(() => sync(true), 6000);            // au démarrage : liste des appareils surveillés à jour
  setInterval(() => sync(true), 10 * 6e4);
  // évènements du serveur (sonnette) : tous les écrans ouverts réagissent (son, caméra)
  let evAt = 0, lastAway;
  setInterval(async () => {
    if (via() !== 'ntfy' || !srv()) return;
    const a = !!S.away;   // la maison passe en absence depuis cet écran : on prévient le serveur
    if (lastAway !== undefined && a !== lastAway) B.Server.post('/api/notify/away', { away: a, by: B.user().name }).catch(() => { });
    lastAway = a;
    if (document.hidden) return;
    try {
      const r = await B.Server.req('/api/notify/events?since=' + evAt);
      if (evAt) r.events.forEach(ev => { if (ev.type !== 'doorbell') return; B.fire('doorbell', 'server'); const c = S.netcams && S.netcams.find(x => x.id === ev.cam), slot = c && (c.slot || 'cam.n_' + c.id); if (slot && DATA.CAMS[slot] && B.ACT.cam && N.tab.show) setTimeout(() => { const el = document.createElement('i'); el.dataset.id = slot; B.ACT.cam(el); }, 400); });
      evAt = r.now;
    } catch (e) { }
  }, 4000);
  const ringUrl = () => B.Server.url() + '/api/notify/ring' + (S.conn.server.key ? '?k=' + encodeURIComponent(S.conn.server.key) : '');
  const modeSw = () => '<div class="nfmode"><button type="button" class="pinc' + (via() === 'ntfy' ? ' on' : '') + '" data-act="nfVia" data-arg="ntfy">' + ico('send') + 'ntfy · sans Home Assistant</button><button type="button" class="pinc' + (via() === 'ha' ? ' on' : '') + '" data-act="nfVia" data-arg="ha">' + ico('homeFill') + 'Home Assistant</button></div>';
  const rulesBox = () => '<section><h4>' + ico('bellFill') + 'Quand prévenir</h4><div class="list">' + RULES.map(r => { const c = N.rules[r[0]]; return '<div class="li nfr"><span class="aico">' + ico(r[1]) + '</span><div><b>' + r[2] + '</b><small>' + r[3] + '</small></div>' +
      '<select data-change="nfWho" data-arg="' + r[0] + '"><option value="all"' + (c.who === 'all' ? ' selected' : '') + '>Tous</option><option value="admins"' + (c.who === 'admins' ? ' selected' : '') + '>Admins</option></select>' +
      '<button type="button" class="sw sm' + (c.on ? ' on' : '') + '" data-act="nfRule" data-arg="' + r[0] + '" aria-label="' + r[2] + '"></button></div>'; }).join('') + '</div>' +
    '<div class="grid2" style="margin-top:10px"><label class="field">Garage ouvert depuis (min)<input type="number" min="1" max="120" value="' + N.garageMin + '" data-change="nfGarage"></label><label class="field">Rappel poubelles à<input type="time" value="' + esc(N.trashAt) + '" data-change="nfTrash"></label></div></section>';
  function bodyNtfy() {
    const sel = (act, cur, list, none) => '<select data-change="' + act + '"><option value="">' + none + '</option>' + list.map(d => '<option value="' + esc(d.id) + '"' + (d.id === cur ? ' selected' : '') + '>' + esc(d.name + (d.room ? ' — ' + d.room : '')) + '</option>').join('') + '</select>';
    const sw = (k, label) => '<label class="row nfsw"><button type="button" class="sw sm' + (N.tab[k] ? ' on' : '') + '" data-act="nfTab" data-arg="' + k + '" aria-label="' + label + '"></button><span>' + label + '</span></label>';
    const n = watchList().length;
    return modeSw() + '<div class="nfgrid">' +
      '<section><h4>' + ico('user') + 'Qui reçoit les notifications</h4>' + (!srv() ? '<p class="warn">Reliez d’abord le serveur Bêta (Connexions) : c’est lui qui envoie, 24 h/24.</p>' : '') +
      '<div class="list">' + S.users.map(u => '<div class="li nfu"><img src="' + esc(u.avatar) + '" alt=""><div><b>' + esc(u.name) + (u.admin ? ' <small class="tag2">admin</small>' : '') + '</b>' +
        '<input placeholder="sujet ntfy (ex. beta-' + esc(u.id) + '-x7k2)" value="' + esc(N.topic[u.id] || '') + '" data-change="nfTopic" data-id="' + u.id + '" spellcheck="false" autocomplete="off"></div>' +
        (N.topic[u.id] ? '<button class="btn sm" data-act="nfTest" data-id="' + u.id + '">' + ico('send') + 'Tester</button>' : '<button class="btn sm" data-act="nfGen" data-id="' + u.id + '">' + ico('sparkle') + 'Créer</button>') + '</div>').join('') + '</div>' +
      '<ol class="steps nfsteps"><li>Installez l’appli gratuite <b>ntfy</b> (App Store / Google Play) sur chaque téléphone.</li><li>Dans ntfy : <b>+</b> › saisissez le sujet de la personne' + (/ntfy\.sh/.test(N.ntfy) ? '' : ' et le serveur <code>' + esc(N.ntfy) + '</code>') + ' › S’abonner.</li><li><b>Tester</b> : la notification arrive en quelques secondes.</li></ol>' +
      '<div class="grid2"><label class="field">Serveur ntfy<input value="' + esc(N.ntfy) + '" data-change="nfUrl" spellcheck="false" placeholder="https://ntfy.sh"></label><label class="field">Jeton d’accès (option)<input type="password" placeholder="tk_…" data-change="nfTok" autocomplete="off"></label></div>' +
      '<p class="muted nfp">Le sujet sert de mot de passe : gardez-le long et secret. Pour que rien ne passe par internet hors du NAS, installez votre propre serveur ntfy (bloc prêt dans le docker-compose).</p></section>' +
      rulesBox() +
      '<section class="wide"><h4>' + ico('cam') + 'Sonnette, garage et tablettes</h4><div class="nfbell">' +
        '<label class="field">Bouton de la sonnette' + sel('nfBell', N.bell, hubDevs(), '— aucun (bouton appelant l’adresse ci-dessous) —') + '</label>' +
        '<label class="field">Caméra de la sonnette' + sel('nfCam', N.cam, (S.netcams || []).filter(c => !c.demo), '— aucune —') + '</label>' +
        '<label class="field">Porte de garage surveillée' + sel('nfGarageDev', N.garage, hubDevs(d => ['garage', 'cover', 'door'].includes(d.k)), '— aucune —') + '</label>' +
        '<label class="field">Annonce sur les tablettes<input value="' + esc(N.tab.text || '') + '" data-change="nfTabText" maxlength="80"></label>' +
      '</div><div class="nfsws">' + sw('say', 'Annonce vocale sur les tablettes (Fully Kiosk)') + sw('show', 'Allumer l’écran et afficher la caméra') + sw('tv', 'Message sur la TV LG') + '</div>' +
      '<p class="muted nfp">Un bouton qui ne sait qu’appeler une adresse (Shelly Button, ESPHome, sonnette Wi-Fi) : faites-lui appeler <code class="sel">' + esc(srv() ? ringUrl() : 'http://NAS:8090/api/notify/ring?k=…') + '</code></p>' +
      '<label class="row nfsw" style="margin-top:8px"><button type="button" class="sw sm' + (isSender() ? ' on' : '') + '" data-act="nfSender" aria-label="Cet écran envoie les rappels"></button><span>Cet écran envoie les rappels calculés par Bêta home (poubelles, météo) — à activer sur une seule tablette toujours allumée</span></label>' +
      '<div class="row nfbtns"><span class="muted">' + ico('shieldCheck') + n + ' appareil(s) surveillé(s) 24 h/24 par le serveur</span><button class="btn" data-act="nfRing"' + (srv() ? '' : ' disabled') + '>' + ico('bellFill') + 'Tester la sonnette</button></div></section></div>';
  }
  B.act('nfVia', el => { N.via = el.dataset.arg; B.save(); redraw(); sync(); });
  B.act('nfTopic', el => { N.topic[el.dataset.id] = el.value.trim().replace(/[^\w-]/g, ''); B.save(); redraw(); sync(); });
  B.act('nfGen', el => { const r = Array.from(crypto.getRandomValues(new Uint8Array(6)), b => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join(''); N.topic[el.dataset.id] = 'beta-' + el.dataset.id.replace(/[^\w]/g, '').slice(0, 10) + '-' + r; B.save(); redraw(); sync(); });
  B.act('nfUrl', el => { N.ntfy = el.value.trim().replace(/\/+$/, '') || 'https://ntfy.sh'; B.save(); sync(); });
  B.act('nfTok', el => { tok = el.value.trim(); sync(); });
  B.act('nfBell', el => { N.bell = el.value; B.save(); sync(); redraw(); });
  B.act('nfCam', el => { N.cam = el.value; B.save(); sync(); });
  B.act('nfGarageDev', el => { N.garage = el.value; B.save(); sync(); redraw(); });
  B.act('nfTabText', el => { N.tab.text = el.value.trim() || 'On sonne à la porte'; B.save(); sync(); });
  B.act('nfTab', el => { const k = el.dataset.arg; N.tab[k] = !N.tab[k]; B.save(); el.classList.toggle('on', N.tab[k]); sync(); });
  B.act('nfRing', async () => { try { await sync(true); const r = await B.Server.post('/api/notify/ring', {}); B.toast(r.skipped ? 'Déjà sonné il y a moins de 15 s' : 'Sonnette testée : ' + r.phones + ' téléphone(s)' + (r.photo ? ' avec photo' : ''), 'bellFill'); } catch (e) { B.toast('Échec : ' + e.message, 'info'); } });

  /* ---------- réglages ---------- */
  let svcs = null;
  async function loadSvcs() {
    if (!HA.enabled()) return [];
    try { const l = await HA.req('/api/services'); const n = l.find(x => x.domain === 'notify'); svcs = n ? Object.keys(n.services).filter(s => s !== 'notify' && s !== 'send_message' && s !== 'persistent_notification').sort() : []; }
    catch (e) { svcs = []; }
    return svcs;
  }
  function body() {
    const opt = (cur) => '<option value="">— personne —</option>' + (svcs || []).map(s => '<option' + (s === cur ? ' selected' : '') + '>' + esc(s) + '</option>').join('') + (cur && svcs && !svcs.includes(cur) ? '<option selected>' + esc(cur) + '</option>' : '');
    return modeSw() + '<div class="nfgrid">' +
      '<section><h4>' + ico('user') + 'Qui reçoit les notifications</h4>' + (!HA.enabled() ? '<p class="warn">Reliez d’abord Home Assistant (Connexions).</p>' : '') +
      '<div class="list">' + S.users.map(u => '<div class="li nfu"><img src="' + esc(u.avatar) + '" alt=""><div><b>' + esc(u.name) + (u.admin ? ' <small class="tag2">admin</small>' : '') + '</b>' +
        (svcs && svcs.length ? '<select data-change="nfTo" data-id="' + u.id + '">' + opt(svcOf(u)) + '</select>' : '<input placeholder="mobile_app_iphone_de_' + esc(u.id) + '" value="' + esc(svcOf(u)) + '" data-change="nfTo" data-id="' + u.id + '" spellcheck="false">') +
        '</div><button class="btn sm" data-act="nfTest" data-id="' + u.id + '"' + (svcOf(u) ? '' : ' disabled') + '>' + ico('send') + 'Tester</button></div>').join('') + '</div>' +
      '<p class="muted" style="font-size:12px;line-height:1.5;margin:8px 0 0">Installez l’application <b>Home Assistant</b> sur chaque téléphone et connectez-la : un service <code>notify.mobile_app_…</code> apparaît alors ici.</p></section>' +
      '<section><h4>' + ico('bellFill') + 'Quand prévenir</h4><div class="list">' + RULES.map(r => { const c = N.rules[r[0]]; return '<div class="li nfr"><span class="aico">' + ico(r[1]) + '</span><div><b>' + r[2] + '</b><small>' + r[3] + '</small></div>' +
        '<select data-change="nfWho" data-arg="' + r[0] + '"><option value="all"' + (c.who === 'all' ? ' selected' : '') + '>Tous</option><option value="admins"' + (c.who === 'admins' ? ' selected' : '') + '>Admins</option></select>' +
        '<button type="button" class="sw sm' + (c.on ? ' on' : '') + '" data-act="nfRule" data-arg="' + r[0] + '" aria-label="' + r[2] + '"></button></div>'; }).join('') + '</div>' +
      '<div class="grid2" style="margin-top:10px"><label class="field">Garage ouvert depuis (min)<input type="number" min="1" max="120" value="' + N.garageMin + '" data-change="nfGarage"></label><label class="field">Rappel poubelles à<input type="time" value="' + N.trashAt + '" data-change="nfTrash"></label></div></section>' +
      '<section class="wide"><h4>' + ico('homeFill') + 'Qui envoie</h4>' +
      '<label class="row" style="gap:10px;font-size:14px"><button type="button" class="sw sm' + (isSender() ? ' on' : '') + '" data-act="nfSender" aria-label="Cet écran envoie"></button><span><b>Cet écran envoie les notifications</b><br><small class="muted">À activer sur un seul appareil toujours allumé (tablette murale). Les alertes partent tant que Bêta home y est ouvert.</small></span></label>' +
      '<div class="nfrec">' + ico('sparkle') + '<span><b>Recommandé : automatisations Home Assistant.</b> Elles tournent 24 h/24 dans Home Assistant, même si aucun écran n’est allumé (sonnette, garage, fuite, alarme, machines). Les poubelles et la météo restent envoyées par l’écran émetteur.</span><button class="btn sm pri" data-act="nfYaml">' + ico('download') + 'Créer les automatisations</button></div></section></div>';
  }
  const bodyAny = () => via() === 'ntfy' ? bodyNtfy() : body();
  async function open() { if (via() === 'ha' && svcs === null) await loadSvcs(); B.modal('<h2>' + ico('bellFill') + 'Notifications sur les téléphones</h2>' + bodyAny(), 'wide nfmodal'); }
  B.notifSettings = open;
  const redraw = () => { const m = document.querySelector('.nfmodal'); if (m) { const sc = m.scrollTop; m.innerHTML = '<button class="x" data-act="closeModal" aria-label="Fermer">' + ico('x') + '</button><h2>' + ico('bellFill') + 'Notifications sur les téléphones</h2>' + bodyAny(); m.scrollTop = sc; } };
  B.act('nfOpen', open);
  B.act('nfTo', el => { N.to[el.dataset.id] = el.value.trim().replace(/^notify\./, ''); B.save(); redraw(); });
  B.act('nfWho', el => { N.rules[el.dataset.arg].who = el.value; B.save(); sync(); });
  B.act('nfRule', el => { const r = N.rules[el.dataset.arg]; r.on = !r.on; B.save(); el.classList.toggle('on', r.on); sync(); });
  B.act('nfGarage', el => { N.garageMin = Math.max(1, +el.value || 10); B.save(); sync(); });
  B.act('nfTrash', el => { N.trashAt = el.value || '18:30'; B.save(); });
  B.act('nfSender', el => { const on = !isSender(); try { localStorage.setItem('betaos.notifier', on ? '1' : '0'); } catch (e) { } el.classList.toggle('on', on); B.toast(on ? 'Cet écran enverra les notifications' : 'Cet écran n’envoie plus de notifications', 'bellFill'); });
  B.act('nfTest', async el => {
    const u = S.users.find(x => x.id === el.dataset.id);
    if (via() === 'ntfy') { await sync(true); try { await B.Server.post('/api/notify/test', { user: u.id }); return B.toast('Notification envoyée à ' + u.name, 'send'); } catch (e) { return B.toast('Échec : ' + e.message, 'info'); } }
    try { await HA.req('/api/services/notify/' + svcOf(u), { title: 'Bêta home', message: 'Bonjour ' + u.name + ' ! Les notifications fonctionnent 🎉', data: { url: site(), clickAction: site() } }); B.toast('Notification envoyée à ' + u.name, 'send'); }
    catch (e) { B.toast('Échec : ' + e.message + ' — vérifiez le service', 'info'); }
  });

  /* ---------- export en automatisations Home Assistant ---------- */
  function yaml() {
    const q = s => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
    const to = rule => S.users.filter(u => svcOf(u) && (N.rules[rule].who !== 'admins' || u.admin)).map(u => 'notify.' + svcOf(u));
    const act = (rule, title, msg, extra) => to(rule).map(s => '      - service: ' + s + '\n        data:\n          title: ' + q(title) + '\n          message: ' + q(msg) + '\n          data:\n            url: ' + q(site() + '#' + (extra && extra.go || 'accueil')) + '\n            clickAction: ' + q(site() + '#' + (extra && extra.go || 'accueil')) +
      (extra && extra.image ? '\n            image: ' + q(extra.image) : '') + (extra && extra.critical ? '\n            ttl: 0\n            priority: high\n            push:\n              interruption-level: critical\n              sound:\n                name: default\n                critical: 1\n                volume: 1' : '')).join('\n');
    const out = [], A = (id, alias, trig, rule, title, msg, extra) => { if (!N.rules[rule].on || !to(rule).length || !trig) return; out.push('- id: beta_os_' + id + '\n  alias: ' + q('Bêta home – ' + alias) + '\n  mode: single\n  trigger:\n' + trig + '\n  action:\n' + act(rule, title, msg, extra)); };
    const bell = S.settings.haDoorbell;
    if (bell) A('sonnette', 'Sonnette', bell.startsWith('event.') ? '    - platform: state\n      entity_id: ' + bell : '    - platform: state\n      entity_id: ' + bell + '\n      to: "on"', 'doorbell', 'Sonnette', 'Quelqu’un sonne à la porte', { image: camImg('cam.sonnette'), go: 'exterieur' });
    const g = HA.entity('rdc.garage.door');
    if (g && g !== '-') A('garage', 'Garage resté ouvert', '    - platform: state\n      entity_id: ' + g + '\n      to: "open"\n      for:\n        minutes: ' + N.garageMin, 'garage', 'Garage ouvert', 'La porte du garage est ouverte depuis ' + N.garageMin + ' min', { go: 'absence' });
    Object.values(DATA.DEVICES).forEach(d => {
      const e = HA.entity(d.id), k = B.kindOf ? B.kindOf(d) : d.type; if (!e || e === '-') return;
      if (k === 'leak') A('fuite_' + d.id.replace(/\W/g, '_'), 'Fuite ' + d.room, '    - platform: state\n      entity_id: ' + e + '\n      to: "on"', 'leak', 'Fuite d’eau !', d.name + ' — ' + d.room, { critical: 1, go: 'absence' });
      if (d.type === 'alarm') A('alarme_' + d.id.replace(/\W/g, '_'), 'Alarme déclenchée', '    - platform: state\n      entity_id: ' + e + '\n      to: "triggered"', 'alarm', 'ALARME DÉCLENCHÉE', d.name + ' — vérifiez les caméras', { critical: 1, go: 'exterieur' });
      if (d.type === 'app') A('fin_' + d.id.replace(/\W/g, '_'), d.name + ' terminé', '    - platform: state\n      entity_id: ' + e + '\n      from: "on"\n      to: "off"', 'appliance', d.name + ' terminé', 'Le cycle est fini (' + d.room + ')', { go: 'rdc' });
    });
    if (N.rules.person.on) Object.keys(S.settings.haMotion || {}).forEach(cid => { const m = S.settings.haMotion[cid]; if (m) A('mouvement_' + cid.replace(/\W/g, '_'), 'Mouvement ' + (DATA.CAMS[cid] || {}).name, '    - platform: state\n      entity_id: ' + m + '\n      to: "on"', 'person', 'Mouvement détecté', ((DATA.CAMS[cid] || {}).name || 'Caméra') + ' — maison en absence', { image: camImg(cid), go: 'absence' }); });
    return out.length ? '# Bêta home — automatisations de notifications (à coller dans automations.yaml)\n# Généré le ' + new Date().toLocaleString('fr-FR') + '\n' + out.join('\n') + '\n' : '';
  }
  B.act('nfYaml', () => {
    const y = yaml();
    if (!y) return B.toast('Choisissez au moins un destinataire et reliez les appareils à Home Assistant', 'info');
    B.modal('<h2>' + ico('homeFill') + 'Automatisations Home Assistant</h2><ol class="steps"><li>Home Assistant › Paramètres › Automatisations › ⋮ › <b>Modifier en YAML</b> (une par une), ou ajoutez tout d’un coup à la fin de <code>automations.yaml</code> (File editor / Studio Code Server).</li><li>Outils de développement › YAML › <b>Recharger les automatisations</b>.</li><li>Désactivez ensuite « Cet écran envoie » pour ces alertes si vous ne voulez pas de doublons (sonnette, garage, fuite, alarme, machines).</li></ol>' +
      '<textarea class="yaml" readonly spellcheck="false">' + esc(y) + '</textarea><div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn" data-act="nfYamlDl">' + ico('download') + 'Télécharger</button><button class="btn pri" data-act="nfYamlCopy">' + ico('files') + 'Copier</button></div>', 'wide');
  });
  B.act('nfYamlCopy', () => { const t = document.querySelector('textarea.yaml'); if (!t) return; t.select(); (navigator.clipboard ? navigator.clipboard.writeText(t.value) : Promise.reject()).then(() => B.toast('Copié', 'check'), () => { document.execCommand('copy'); B.toast('Copié', 'check'); }); });
  B.act('nfYamlDl', () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([yaml()], { type: 'text/yaml' })); a.download = 'beta-home-notifications.yaml'; a.click(); });

  /* ---------- accès : carte dans Connexions + Paramètres ---------- */
  const conn0 = B.RENDER.conn;
  if (conn0) B.RENDER.conn = s => conn0(s).replace('<div class="csave">', '<div class="ccard tile wide2"><div class="cch">' + B.badge('chart') + '<div><b>Notifications sur les téléphones</b><small>' + (via() === 'ntfy' ? 'Avec ntfy, envoyées par le serveur Bêta · ' + S.users.filter(u => N.topic[u.id]).length : 'Via l’application Home Assistant · ' + S.users.filter(u => svcOf(u)).length) + ' destinataire(s)' + (isSender() ? ' · cet écran émet' : '') + '</small></div></div><div class="row" style="gap:8px;flex-wrap:wrap"><button type="button" class="btn sm pri" data-act="nfOpen">' + ico('bellFill') + 'Configurer</button>' + (via() === 'ha' ? '<button type="button" class="btn sm" data-act="nfYaml">' + ico('download') + 'Automatisations HA</button>' : '') + '</div></div><div class="csave">');
  const sfx1 = B.RENDER.sfx;
  if (sfx1) B.RENDER.sfx = s => sfx1(s).replace('<button class="btn sm" data-act="nightCfg">', '<button class="btn sm" data-act="brandsCfg">' + ico('grid9') + 'Marques</button><button class="btn sm" data-act="nfOpen">' + ico('bellFill') + 'Notifs</button><button class="btn sm" data-act="nightCfg">');
})();

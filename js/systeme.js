/* Bêta home 7.17 — installer, vérifier, régler, parler :
   - page Installation : guide pas à pas (✅ / ❌) et « Tester toute la maison » (diagnostic du NAS + de cet écran), rapport à copier
   - page Réglages : tous les réglages rangés par thème, avec recherche
   - « Bêta, … » : commande vocale sur les tablettes (reconnaissance vocale du navigateur)
   - page Raccourcis : version simple et rapide pour l'iPhone (état de la maison + boutons favoris)
   - tablettes modestes (Fire) : mode performance automatique */
(function () {
  const B = window.BOS, { S, DATA, esc, F, T, RENDER, box } = B;
  const srv = () => B.Server && B.Server.ok();
  const isAdmin = () => !!(B.isAdmin ? B.isAdmin() : B.user() && B.user().admin);
  const DK = 'betaos.device', dcfg = () => { try { return JSON.parse(localStorage.getItem(DK) || '{}'); } catch (e) { return {}; } }, dset = c => { try { localStorage.setItem(DK, JSON.stringify(c)); } catch (e) { } };
  const go = id => () => { B.closeModal(); location.hash = id; };
  const act = id => () => { const f = B.ACT[id]; if (f) f({ dataset: {} }); else B.toast('Indisponible', 'info'); };

  /* ======================= 3. tablettes modestes ======================= */
  // Fire HD (Silk ou Fully sur Fire OS) ou peu de mémoire : mode performance par défaut (sans flous ni animations)
  const weak = /\bKF[A-Z]{2,5}\b|Silk|Fire/i.test(navigator.userAgent) || (navigator.deviceMemory && navigator.deviceMemory <= 2) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4 && /Android/.test(navigator.userAgent));
  B.weakDevice = !!weak;

  /* ======================= 1-2. installation et diagnostic ======================= */
  const D = { srv: null, at: 0, busy: false };
  const ST = { ok: ['ok', 'check', 'OK'], warn: ['y', 'alert', 'À voir'], err: ['p', 'x', 'À corriger'], off: ['', 'info', 'Facultatif'] };
  function localChecks() {
    const K = S.conn.server || {}, out = [], add = (cat, st, title, detail, fix) => out.push({ cat, st, title, detail, fix });
    add('Cet écran', srv() ? 'ok' : K.url ? 'err' : 'warn', 'Serveur Bêta', srv() ? 'Relié : ' + K.url : K.url ? 'Injoignable : ' + K.url + ' (' + String((S.conn.status || {}).server || '').replace(/^err:/, '') + ')' : 'Pas encore installé', 'Installez Bêta home sur le NAS (docker compose up -d), puis Connexions › Serveur Bêta.');
    if (srv()) add('Cet écran', K.device ? 'ok' : 'warn', 'Accès de cet écran', K.device ? 'Associé par code (sans la clé maître)' : 'Utilise la clé maître du serveur', 'Paramètres › Sécurité › « Associer cet écran » : chaque écran a son propre accès, révocable.');
    add('Cet écran', window.fully ? 'ok' : 'off', 'Fully Kiosk', window.fully ? 'Détecté : veille, luminosité, annonces et réveil par mouvement disponibles' : 'Navigateur classique', 'Sur les tablettes murales, utilisez Fully Kiosk (mode kiosque, écran toujours allumé).');
    const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    if (/iPhone|iPad|Android/i.test(navigator.userAgent) && !window.fully) add('Cet écran', standalone ? 'ok' : 'warn', 'Application installée', standalone ? 'Ouverte comme une application' : 'Ouverte dans le navigateur', 'iPhone : Safari › Partager › « Sur l’écran d’accueil ».');
    add('Cet écran', window.isSecureContext ? 'ok' : 'off', 'Adresse sécurisée (https)', window.isSecureContext ? 'Oui : dictée et micro possibles' : 'Non (http) : la commande vocale et la dictée peuvent être refusées', 'Avec Tailscale, ouvrez Bêta home par https://beta-home.<votre-réseau>.ts.net.');
    add('Cet écran', B.weakDevice ? 'ok' : 'off', 'Performance', B.weakDevice ? 'Tablette modeste détectée : mode performance ' + (document.documentElement.classList.contains('perf') ? 'activé' : 'désactivé') : 'Appareil rapide', 'Paramètres › Cet écran › Mode performance.');
    let bytes = 0; try { bytes = (localStorage.getItem('betaos.v5') || '').length; } catch (e) { }
    add('Cet écran', bytes > 4e6 ? 'warn' : 'ok', 'Mémoire de l’écran', Math.round(bytes / 1024) + ' Ko utilisés', 'Paramètres › Réinitialiser cet écran si l’application devient lente.');
    if (S.conn.mail && S.conn.mail.pass) add('Sécurité', 'warn', 'Mot de passe mail sur cet écran', 'Gardé dans le navigateur de cet écran', 'Outils › Colis › « Reprendre la messagerie » le met sur le NAS ; effacez-le ensuite de Connexions.');
    return out;
  }
  async function runDiag() {
    if (D.busy) return; D.busy = true; B.emit('diag');
    if (B.Server && S.conn.server.url) await B.Server.ping();
    if (srv()) { try { D.srv = await B.Server.req('/api/diag'); } catch (e) { D.srv = { error: e.message }; } }
    D.local = localChecks(); D.at = Date.now(); D.busy = false; B.emit('diag'); B.emit('guide');
  }
  const allChecks = () => (D.local || localChecks()).concat((D.srv && D.srv.checks) || []);
  const find = (id, cat) => ((D.srv && D.srv.checks) || []).find(c => c.id === id && (!cat || c.cat === cat));
  // le guide : les étapes de l'installation, dans l'ordre, chacune vérifiée
  function steps() {
    const K = S.conn.server || {}, P = B.P && B.P.cfg, s = id => (find(id) || {}).st;
    const brands = ((D.srv && D.srv.checks) || []).filter(c => /^b:/.test(c.id));
    return [
      { t: 'Installer Bêta home sur le NAS', d: 'UGOS › Docker › Projet › Créer avec server/docker-compose.yml (ou « docker compose up -d »).', st: srv() ? 'ok' : 'err', a: ['Connexions', go('connexions')] },
      { t: 'Choisir une clé personnelle', d: 'Une longue phrase dans BETA_KEY du docker-compose.', st: srv() ? s('key') || 'warn' : 'off' },
      { t: 'Associer cet écran', d: 'Chaque écran reçoit son accès (sans recopier la clé).', st: !srv() ? 'off' : K.device ? 'ok' : 'warn', a: ['Associer', act('secOpen')] },
      { t: 'Relier vos appareils', d: 'Plug & play : Bêta cherche Bbox, Deco, lumières, prises, caméras…', st: !srv() ? 'off' : !brands.length ? 'warn' : brands.some(b => b.st === 'err') ? 'warn' : 'ok', a: ['Marques', go('marques')] },
      { t: 'Tablettes murales', d: 'Fully Kiosk sur chaque tablette, Remote Administration activée, puis Marques › Fully Kiosk.', st: !srv() ? 'off' : s('fully') === 'off' ? 'warn' : s('fully') || 'warn', a: ['Fully Kiosk', () => { B.closeModal(); location.hash = 'marques'; setTimeout(() => B.ACT.hubOpen && B.ACT.hubOpen({ dataset: { arg: 'fully' } }), 600); }] },
      { t: 'Notifications sur les iPhone', d: 'App ntfy, un sujet par personne.', st: !srv() ? 'off' : s('ntfy') || 'warn', a: ['Notifs', act('nfOpen')] },
      { t: 'Codes PIN et mode sécurisé', d: 'Un code par parent ; les réglages demandent ce code.', st: !srv() ? 'off' : s('pin') === 'ok' && s('secure') === 'ok' ? 'ok' : 'warn', a: ['Sécurité', act('secOpen')] },
      { t: 'Sauvegarde de la nuit', d: 'Mot de passe des sauvegardes, et copie sur une clé USB si possible.', st: !srv() ? 'off' : P && P.backup && P.backup.auto !== false && P.backup.pass === '••••' ? 'ok' : 'warn', a: ['Sauvegarde', act('bkOpen')] },
      { t: 'iPhone : application et Siri', d: 'Ajouter à l’écran d’accueil, raccourcis Siri, widget.', st: !srv() ? 'off' : 'off', a: ['iPhone', act('iphOpen')] },
      { t: 'Accès depuis l’extérieur (facultatif)', d: 'Tailscale : sans ouvrir la box.', st: !srv() ? 'off' : s('remote') || 'off' }
    ];
  }
  RENDER.guide = () => {
    const l = steps(), done = l.filter(x => x.st === 'ok').length;
    return '<div class="guide scroll"><div class="gdbar"><i style="width:' + Math.round(done / l.length * 100) + '%"></i></div><small class="muted">' + done + ' étape(s) sur ' + l.length + (D.at ? ' · vérifié à ' + F.time(new Date(D.at)) : '') + '</small>' +
      l.map((x, i) => '<div class="gdst ' + (ST[x.st] || ST.off)[0] + '"><span class="gdn">' + (x.st === 'ok' ? ico('check') : i + 1) + '</span><div><b>' + esc(x.t) + '</b><small>' + esc(x.d) + '</small></div>' + (x.a ? '<button class="btn sm" data-act="dgGo" data-arg="' + i + '">' + esc(x.a[0]) + '</button>' : '') + '</div>').join('') + '</div>';
  };
  RENDER.diagList = () => {
    if (D.busy) return '<p class="muted">' + ico('refresh') + ' Vérification de toute la maison… (jusqu’à 20 secondes)</p>';
    if (!D.at) return '<div class="secempty">' + ico('check') + '<b>Tester toute la maison</b><p class="muted">Le NAS essaie chaque marque, les tablettes, les notifications, internet et la sécurité ; cet écran vérifie sa propre connexion.</p><button class="btn pri" data-act="dgRun">' + ico('play') + 'Lancer le test</button></div>';
    const l = allChecks(), cats = [...new Set(l.map(c => c.cat))], n = k => l.filter(c => c.st === k).length;
    return '<div class="dgsum"><span class="g">' + ico('check') + n('ok') + ' OK</span><span class="y">' + ico('alert') + n('warn') + ' à voir</span><span class="p">' + ico('x') + n('err') + ' à corriger</span><button class="btn sm" data-act="dgRun">' + ico('refresh') + 'Relancer</button><button class="btn sm" data-act="dgCopy">' + ico('files') + 'Copier le rapport</button></div>' +
      (D.srv && D.srv.error ? '<p class="warn">Diagnostic du NAS : ' + esc(D.srv.error) + '</p>' : '') +
      '<div class="dglist list scroll">' + cats.map(c => '<h4 class="rlh">' + esc(c) + '</h4>' + l.filter(x => x.cat === c).sort((a, b) => 'err warn off ok'.indexOf(a.st) - 'err warn off ok'.indexOf(b.st)).map(x => '<div class="li dgi ' + (ST[x.st] || ST.off)[0] + '"><span class="ic">' + ico((ST[x.st] || ST.off)[1]) + '</span><div><b>' + esc(x.title) + '</b><small>' + esc(x.detail) + '</small>' + (x.st !== 'ok' && x.fix ? '<small class="dgfix">→ ' + esc(x.fix) + '</small>' : '') + '</div></div>').join('')).join('') + '</div>';
  };
  const report = () => { const l = allChecks(); return 'Bêta home — rapport du ' + new Date(D.at).toLocaleString('fr-FR') + '\nVersion du serveur : ' + ((D.srv && D.srv.version) || '?') + ' · écran : ' + navigator.userAgent.slice(0, 120) + '\n\n' + l.map(c => ({ ok: '✅', warn: '⚠️', err: '❌', off: '·' }[c.st] || '·') + ' [' + c.cat + '] ' + c.title + ' — ' + c.detail).join('\n'); };
  B.route('installation', { title: 'Installation', bg: 'assets/bg/generic.jpg', render: () => B.side('installation') + B.header({ id: 'installation', title: 'Installation', sub: 'Guide pas à pas et diagnostic', icon: 'check', info: { t: 'infobox', keys: ['diag'], items: () => { const l = D.at ? allChecks() : []; return [{ icon: 'check', v: l.filter(c => c.st === 'ok').length || '—', l: 'OK', cls: 'g' }, { icon: 'alert', v: l.filter(c => c.st === 'warn').length || '—', l: 'À voir', cls: 'y' }, { icon: 'x', v: l.filter(c => c.st === 'err').length || '—', l: 'À corriger', cls: l.some(c => c.st === 'err') ? 'p' : '' }]; } } }) +
    '<section class="card pcard abs" style="' + box([105, 235, 700, 1012]) + '">' + B.whead('check', 'Étapes de l’installation') + T({ t: 'guide', keys: ['guide', 'diag'] }) + '</section>' +
    '<section class="card pcard abs" style="' + box([710, 235, 1522, 1012]) + '">' + B.whead('heart', 'Test de toute la maison') + T({ t: 'diagList', keys: ['diag'] }) + '</section>', after: () => { if (!D.at || Date.now() - D.at > 10 * 6e4) runDiag(); } });
  B.act('dgRun', runDiag);
  B.act('dgGo', el => { const x = steps()[+el.dataset.arg]; if (x && x.a) x.a[1](); });
  B.act('dgCopy', () => { const t = report(); (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => B.toast('Rapport copié : collez-le dans votre message', 'check'), () => prompt('Copiez le rapport :', t)); });

  /* ======================= 4. tous les réglages au même endroit ======================= */
  const R = [
    ['Maison', 'homeFill', [['Profils et droits', 'family', go('parametres')], ['Modules', 'layers', act('modOpen')], ['Marques et appareils', 'grid9', go('marques')], ['Connexions', 'link', go('connexions')], ['Pièces et étages', 'rooms', act('roomsManager')], ['Scènes', 'sparkle', go('scenes')], ['Règles « Si… alors… »', 'wand', go('routines')]]],
    ['Sécurité', 'shieldCheck', [['Codes PIN, mode sécurisé, écrans', 'lock', act('secOpen')], ['Alarme', 'shieldCheck', act('alCfg')], ['Présence et absent auto', 'walk', act('presenceCfg')], ['Mode vacances', 'walk', act('vacOpen')], ['Simulation de présence', 'bulb', act('simOpen')], ['Détection caméras', 'cctv', act('detOpen')], ['Sonnette : réponses', 'bellFill', act('visOpen')], ['Profils enfants', 'family', act('kidOpen')], ['Mode baby-sitter', 'heart', act('sitOpen')]]],
    ['Énergie et confort', 'boltPlain', [['Tarif et coûts', 'chart', act('enOpen')], ['Conseiller Tempo', 'boltPlain', act('tpOpen')], ['Chauffage', 'flame', go('chauffage')], ['Recharge de la voiture', 'charger', act('evOpen')], ['Arrosage', 'sprinkler', act('waOpen')], ['Réveil en douceur', 'sun', act('wkOpen')]]],
    ['Famille', 'family', [['Notifications', 'bellFill', act('nfOpen')], ['Calendriers iPhone', 'calendar', act('icOpen')], ['Colis', 'download', act('pkOpen')], ['Tempo, vigilance, collectes', 'sun2', act('svcOpen')], ['Rappels de la maison', 'history', act('rmOpen')], ['Missions et récompenses', 'heart', act('msCfg')], ['Tableau du matin', 'route', act('mcOpen')]]],
    ['Écrans et iPhone', 'monitor', [['Cet écran (disposition, veille, langue)', 'monitor', act('screenCfg')], ['Cadre photo', 'photo', act('phOpen')], ['Interphone : tablettes', 'mic', go('interphone')], ['iPhone : Siri et widgets', 'mic', act('iphOpen')], ['Commande vocale « Bêta »', 'mic', act('wakeCfg')]]],
    ['Réseau', 'wifi', [['Box et Wi-Fi', 'wifi', go('reseau')], ['Wi-Fi invités', 'wifi', act('gwOpen')]]],
    ['Système', 'server', [['Installation et diagnostic', 'check', go('installation')], ['Sauvegarde', 'cloudUp', act('bkOpen')], ['Mises à jour', 'download', act('upOpen')], ['Administration', 'server', go('admin')], ['Santé de la maison', 'heart', go('sante')]]]
  ];
  let RQ = '';
  const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, '');   // « wifi » trouve « Wi-Fi »
  RENDER.regl = () => '<div class="regl"><input class="search" placeholder="Chercher un réglage (ex. wifi, code, photo)…" value="' + esc(RQ) + '" data-input="rgQ"><div class="reglg scroll">' + R.map((g, gi) => { const l = g[2].map((x, i) => [x, i]).filter(([x]) => !RQ || norm(x[0] + ' ' + g[0]).includes(norm(RQ))); return l.length ? '<section><h4>' + ico(g[1]) + esc(g[0]) + '</h4><div class="reglt">' + l.map(([x, i]) => '<button class="tool" data-act="rgGo" data-arg="' + gi + '|' + i + '">' + ico(x[1]) + '<b>' + esc(x[0]) + '</b></button>').join('') + '</div></section>' : ''; }).join('') + '</div></div>';
  B.route('reglages', { title: 'Réglages', bg: 'assets/bg/generic.jpg', render: () => B.side('reglages') + B.header({ id: 'reglages', title: 'Réglages', sub: 'Tout au même endroit', icon: 'gearFill', info: { t: 'infobox', keys: [], items: () => [{ icon: 'grid9', v: R.reduce((n, g) => n + g[2].length, 0), l: 'Réglages', cls: 'c' }, { icon: 'family', v: B.user().name, l: 'Profil' }] } }) + '<section class="card pcard abs" style="' + box([105, 235, 1522, 1012]) + '">' + B.whead('gear', 'Réglages') + T({ t: 'regl', keys: ['regl'] }) + '</section>' });
  B.act('rgGo', el => { const [g, i] = el.dataset.arg.split('|').map(Number); R[g][2][i][2](); });
  let rgT = 0;
  B.act('rgQ', el => { RQ = el.value; clearTimeout(rgT); rgT = setTimeout(() => { B.emit('regl'); const i = document.querySelector('[data-input="rgQ"]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 200); });
  const sfx = RENDER.sfx; if (sfx) RENDER.sfx = s => sfx(s).replace('<div class="row" style="margin-top:auto;gap:8px;flex-wrap:wrap">', '<div class="row" style="margin-top:auto;gap:8px;flex-wrap:wrap"><a class="btn sm pri" href="#reglages">' + ico('gearFill') + 'Tous les réglages</a><a class="btn sm" href="#installation">' + ico('check') + 'Installation</a>');

  /* ======================= 6. « Bêta, … » : commande vocale ======================= */
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const W = { on: false, rec: null, armed: 0 };
  const WAKE = /\b(b[eéè]ta|betta|beta home|bêta home)\b[ ,.!]*/i;
  function say(text) {
    if (!text) return;
    if (window.fully && window.fully.textToSpeech) { try { window.fully.textToSpeech(text, 'fr_FR'); return; } catch (e) { } }
    if (window.speechSynthesis) { const u = new SpeechSynthesisUtterance(text); u.lang = 'fr-FR'; speechSynthesis.speak(u); }
  }
  function bubble(heard, reply) {
    let o = document.querySelector('.wkpop'); if (!o) { o = document.createElement('div'); o.className = 'wkpop'; o.addEventListener('click', () => o.remove()); document.body.appendChild(o); }
    o.innerHTML = ico('mic') + '<div><small>' + esc(heard) + '</small>' + (reply ? '<b>' + esc(reply) + '</b>' : '<b class="muted">…</b>') + '</div>'; clearTimeout(o.t); o.t = setTimeout(() => o.remove(), 9000);
  }
  async function command(cmd) {
    bubble(cmd);
    let r = ''; try { r = await Promise.resolve(B.iaX ? B.iaX(cmd) : B.ia(cmd)); } catch (e) { r = 'Désolé, je n’ai pas compris.'; }
    r = String(r || 'C’est fait.').replace(/<[^>]+>/g, ''); bubble(cmd, r); say(r.length > 220 ? r.slice(0, 220) : r);
  }
  function listen() {
    if (!SR || W.rec) return;
    const r = new SR(); r.lang = 'fr-FR'; r.continuous = true; r.interimResults = false;
    r.onresult = e => {
      const t = e.results[e.results.length - 1][0].transcript.trim(); if (!t) return;
      const m = t.match(WAKE);
      if (m) { const cmd = t.slice(m.index + m[0].length).trim(); if (cmd) command(cmd); else { W.armed = Date.now(); bubble('Oui ?'); if (B.tabletWake) B.tabletWake(); } }
      else if (W.armed && Date.now() - W.armed < 8000) { W.armed = 0; command(t); }
    };
    r.onerror = e => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { W.on = false; B.toast('Micro refusé : la commande vocale a besoin de l’autorisation du micro (et souvent d’une adresse https)', 'mic'); } };
    r.onend = () => { W.rec = null; if (W.on) setTimeout(listen, 400); };
    try { r.start(); W.rec = r; } catch (e) { W.rec = null; }
  }
  function wakeSet(on) { W.on = on; const c = dcfg(); c.wake = on; dset(c); if (on) listen(); else if (W.rec) try { W.rec.stop(); } catch (e) { } fab(); }
  function fab() {
    let b = document.querySelector('.wkfab');
    if (!dcfg().wakeBtn) { if (b) b.remove(); return; }
    if (!b) { b = document.createElement('button'); b.className = 'wkfab'; b.setAttribute('aria-label', 'Parler à Bêta'); b.addEventListener('click', () => { if (!SR) return B.toast('Reconnaissance vocale indisponible sur ce navigateur', 'mic'); const r = new SR(); r.lang = 'fr-FR'; r.onresult = e => command(e.results[0][0].transcript.replace(WAKE, '').trim()); r.onerror = () => B.toast('Micro indisponible ici (autorisation ou https)', 'mic'); try { r.start(); bubble('Je vous écoute…'); } catch (e) { } }); document.body.appendChild(b); }
    b.innerHTML = ico('mic'); b.classList.toggle('live', W.on);
  }
  B.act('wakeCfg', () => {
    const c = dcfg();
    B.modal('<h2>' + ico('mic') + 'Commande vocale « Bêta »</h2><p class="muted" style="font-size:13px;line-height:1.5">Dites « <b>Bêta, allume le salon</b> », « Bêta, état de la maison », « Bêta, ajoute du lait à la liste de courses »… Bêta comprend les mêmes phrases que Bêta IA et répond à voix haute.</p>' +
      (SR ? '' : '<p class="warn">Ce navigateur n’a pas de reconnaissance vocale (c’est le cas de la WebView de Fully Kiosk sur certaines tablettes Fire, et de Firefox). Sur ces tablettes, utilisez Alexa avec le pont Matter.</p>') + (window.isSecureContext ? '' : '<p class="warn">Adresse en http : le navigateur peut refuser le micro. Ouvrez Bêta home en https (Tailscale) pour une écoute fiable.</p>') +
      '<label class="row tbsw"><button type="button" class="sw sm' + (c.wakeBtn ? ' on' : '') + '" data-act="wkBtn"></button><span><b>Bouton micro</b> sur cet écran (appuyer puis parler)</span></label>' +
      '<label class="row tbsw"><button type="button" class="sw sm' + (c.wake ? ' on' : '') + '" data-act="wkListen"' + (SR ? '' : ' disabled') + '></button><span><b>Écoute permanente</b> du mot « Bêta » (tablette murale branchée ; le micro reste ouvert)</span></label>' +
      '<p class="muted" style="font-size:12px">La reconnaissance est faite par le navigateur (Google sur Android, Apple sur iPhone) : le son peut passer par leurs serveurs.</p>', 'wide');
  });
  B.act('wkBtn', () => { const c = dcfg(); c.wakeBtn = !c.wakeBtn; dset(c); fab(); B.closeModal(); B.ACT.wakeCfg(); });
  B.act('wkListen', () => { wakeSet(!dcfg().wake); B.closeModal(); B.ACT.wakeCfg(); });
  setTimeout(() => { fab(); if (dcfg().wake && SR) wakeSet(true); }, 3000);

  /* ======================= 7. page Raccourcis (iPhone) ======================= */
  const favs = () => (S.settings.favs2 = S.settings.favs2 || [{ t: 'routine', id: 'depart' }, { t: 'routine', id: 'retour' }, { t: 'routine', id: 'nuit' }]);
  const favInfo = f => {
    if (f.t === 'routine') { const r = (S.routines || []).find(x => x.id === f.id); return r && { icon: r.icon || 'wand', name: r.name, sub: 'Routine' }; }
    if (f.t === 'scene') { const s = ((B.P && B.P.cfg && B.P.cfg.scenes) || []).find(x => x.id === f.id); return s && { icon: s.icon || 'sparkle', name: s.name, sub: 'Scène' }; }
    if (f.t === 'dev') { const d = DATA.DEVICES[f.id]; if (!d) return null; const st = S.dev[f.id] || d.def || {}; return { icon: B.iconOf ? B.iconOf(d) : 'power', name: d.name, sub: B.stateText ? B.stateText(d, st) || (st.on ? 'Allumé' : 'Éteint') : '', on: !!(st.on || st.pos > 0 || st.locked) }; }
    if (f.t === 'page') { const n = (B.navList ? B.navList(B.NAV || []) : []).find(x => x[0] === f.id); return { icon: n ? n[3] : 'grid9', name: n ? n[1] : f.id, sub: 'Page' }; }
  };
  B.qkFavs = favs; B.qkInfo = favInfo;   // repris par l'accueil vertical (portrait.js)
  RENDER.qkStatus = () => {
    const st = (S.brain || {}).status || {}, a = (st.alarm || {}).status, pres = Object.values(st.presence || {}), tp = st.tempo, w = B.WX && B.WX.now, al = (B.wxAlerts ? B.wxAlerts() : [])[0];
    return '<div class="qkst">' + (w ? '<span>' + (B.wxIcon ? ico(B.wxIcon(w.code, !w.day)) : '') + '<b>' + Math.round(w.temp) + '°</b></span>' : '') + (a ? '<span class="' + (a === 'disarmed' ? '' : 'g') + '">' + ico('shieldCheck') + (a === 'disarmed' ? 'Alarme coupée' : a === 'triggered' ? 'ALARME' : 'Alarme activée') + '</span>' : '') + (pres.length ? '<span>' + ico('family') + pres.filter(Boolean).length + '/' + pres.length + ' à la maison</span>' : '') + (S.away ? '<span class="y">' + ico('walk') + 'Mode absent</span>' : '') + (tp && tp.today ? '<span class="t-' + tp.today + '">' + ico('boltPlain') + 'Tempo ' + tp.today + '</span>' : '') + '</div>' + (al ? '<p class="qkal">' + ico(al.icon || 'info') + esc(al.text) + '</p>' : '');
  };
  RENDER.qkFavs = () => '<div class="qkgrid">' + favs().map((f, i) => { const x = favInfo(f); return x ? '<button class="qkb' + (x.on ? ' on' : '') + '" data-act="qkRun" data-arg="' + i + '">' + ico(x.icon) + '<b>' + esc(x.name) + '</b><small>' + esc(x.sub) + '</small></button>' : ''; }).join('') + '<button class="qkb add" data-act="qkEdit">' + ico('plus') + '<b>Modifier</b><small>mes raccourcis</small></button></div>';
  B.route('raccourcis', { title: 'Raccourcis', bg: 'assets/bg/generic.jpg', render: () => B.side('raccourcis') + B.header({ id: 'raccourcis', title: 'Bonjour ' + B.user().name, sub: 'Vos raccourcis', icon: 'grid9', info: { t: 'infobox', keys: ['brain'], items: () => [{ icon: 'family', v: (pr => pr.length ? pr.filter(Boolean).length : '—')(Object.values(((S.brain || {}).status || {}).presence || {})), l: 'À la maison', cls: 'c' }] } }) +
    '<section class="card pcard abs" style="' + box([105, 235, 1522, 400]) + '">' + B.whead('home', 'La maison') + T({ t: 'qkStatus', keys: ['brain', 'house', 'weather'] }) + '</section>' +
    '<section class="card pcard abs" style="' + box([105, 410, 1522, 1012]) + '">' + B.whead('grid9', 'Raccourcis') + T({ t: 'qkFavs', keys: ['house', 'qk', 'plus'] }) + '</section>' });
  B.act('qkRun', el => {
    const f = favs()[+el.dataset.arg]; if (!f) return;
    if (f.t === 'routine' && B.runRoutine) { const r = (S.routines || []).find(x => x.id === f.id), u = B.user(); if (r && r.a && r.a.alarm && u && (u.id === 'guest' || u.child)) return B.toast('Cette routine touche l’alarme : réservée aux parents', 'lock'); B.runRoutine(f.id); }
    else if (f.t === 'scene') B.ACT.scRun && B.ACT.scRun({ dataset: { arg: f.id } });
    else if (f.t === 'page') location.hash = f.id;
    else if (f.t === 'dev') { const d = DATA.DEVICES[f.id], st = S.dev[f.id] || d.def || {}, k = B.kindOf(d); if (B.canUse && !B.canUse(f.id)) return B.toast('Accès réservé', 'lock'); B.setDev(f.id, ['cover', 'awning', 'garage'].includes(k) ? { pos: st.pos > 0 ? 0 : 100 } : k === 'lock' ? { locked: !st.locked } : { on: !st.on }); }
    if (navigator.vibrate) navigator.vibrate(15); B.emit('qk');
  });
  B.act('qkEdit', () => {
    const cur = favs(), has = (t, id) => cur.some(f => f.t === t && f.id === id), row = (t, id, label) => '<label class="rlck"><input type="checkbox" data-change="qkPick" data-arg="' + t + '|' + esc(id) + '"' + (has(t, id) ? ' checked' : '') + '>' + esc(label) + '</label>';
    const devs = Object.values(DATA.DEVICES).filter(d => !(B.isHidden && B.isHidden(d.id)) && !['sensor', 'binary', 'camera'].includes(d.type));
    B.modal('<h2>' + ico('grid9') + 'Mes raccourcis</h2><p class="muted" style="font-size:13px">Cochez ce que vous voulez sous le pouce (6 à 9 conseillés).</p><h4 class="rlh">Routines</h4><div class="alpick">' + (S.routines || []).map(r => row('routine', r.id, r.name)).join('') + '</div>' +
      ((B.P && B.P.cfg && B.P.cfg.scenes || []).length ? '<h4 class="rlh">Scènes</h4><div class="alpick">' + B.P.cfg.scenes.map(s => row('scene', s.id, s.name)).join('') + '</div>' : '') +
      '<h4 class="rlh">Appareils</h4><div class="alpick">' + devs.map(d => row('dev', d.id, (d.room ? d.room + ' · ' : '') + d.name)).join('') + '</div><h4 class="rlh">Pages</h4><div class="alpick">' + ['exterieur', 'securite', 'listes', 'matin', 'chauffage', 'musique'].map(p => row('page', p, p.charAt(0).toUpperCase() + p.slice(1))).join('') + '</div>', 'wide');
  });
  B.act('qkPick', el => { const [t, ...r] = el.dataset.arg.split('|'), id = r.join('|'), l = favs().filter(f => !(f.t === t && f.id === id)); if (el.checked) l.push({ t, id }); S.settings.favs2 = l; B.save(); B.emit('qk'); });
  // sur un téléphone, la page Raccourcis s'ouvre en premier (sauf si un autre choix a été fait dans « Cet écran »)
  const sp0 = B.startPage;
  if (sp0) B.startPage = () => { const c = dcfg(); return !c.start && /iPhone|Android.*Mobile/.test(navigator.userAgent) && !window.fully ? 'raccourcis' : sp0(); };
  if (!location.hash && sessionStorage.getItem('betaos.unlocked') && B.startPage() === 'raccourcis') setTimeout(() => B.go('raccourcis'), 80);

  /* ---------- invité : pas de pages de réglages, même en tapant l'adresse ---------- */
  window.addEventListener('hashchange', () => { const u = B.user(); if (u && u.id === 'guest' && (B.GUEST_HIDE || []).includes(location.hash.slice(1))) setTimeout(() => B.go('accueil'), 0); });

  /* ---------- menus ---------- */
  const nl0 = B.navList;
  B.navList = NAV => { const out = (nl0 ? nl0(NAV) : NAV).slice(); const add = (id, label, icon, after) => { if (out.some(n => n[0] === id)) return; const i = out.findIndex(n => n[0] === after); out.splice(i < 0 ? out.length : i + 1, 0, [id, label, icon, icon, 'noside']); }; add('raccourcis', 'Raccourcis', 'grid9', 'accueil'); if (document.documentElement.classList.contains('sitter') || (B.user() && (B.user().id === 'guest' || B.user().child))) return out; add('reglages', 'Réglages', 'gearFill', 'parametres'); if (isAdmin()) add('installation', 'Installation', 'check', 'reglages'); return out; };
})();

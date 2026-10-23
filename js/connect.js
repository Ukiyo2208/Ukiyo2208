/* Bêta OS — page « Connexions » (tous les services au même endroit) et client du serveur Bêta (NAS) :
   sauvegardes automatiques, journal partagé, relais vers les services que le navigateur ne peut pas joindre. */
(function () {
  const B = window.BOS, { S, esc, T, RENDER, box, F } = B;
  const BG = 'assets/bg/generic.jpg';
  const K = S.conn = Object.assign({ server: { url: '', key: '' }, ugreen: { url: '', ip: '', user: '' }, nextcloud: { url: '', user: '', pass: '' }, mail: { imap: '', port: 993, user: '', pass: '', smtp: '', sport: 465 }, ips: [], status: {}, backup: { last: 0, auto: true } }, S.conn || {});
  if (!K.ugreen.url && S.settings.nasUrl) K.ugreen.url = S.settings.nasUrl;
  const isAdmin = () => !!(B.isAdmin && B.isAdmin());

  /* ---------- client du serveur Bêta ---------- */
  const Server = {
    url: () => (K.server.url || '').replace(/\/+$/, ''),
    ok: () => !!(Server.url() && K.status.server === 'ok'),
    async req(path, body, method) {
      const r = await fetch(Server.url() + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', 'X-Beta-Key': K.server.key || '' }, body: body ? JSON.stringify(body) : undefined });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    },
    post(path, body) { return this.req(path, body, 'POST'); },
    async ping() { try { const j = await this.req('/api/ping'); K.status.server = 'ok'; K.status.serverVer = j.version; } catch (e) { K.status.server = 'err:' + (e.message === 'Failed to fetch' ? 'injoignable' : e.message); } B.save(); B.emit('conn'); return K.status.server === 'ok'; },
    /* relais : le serveur va chercher une adresse à la place du navigateur (Nextcloud, NAS…) */
    proxy(url, opts) { return this.post('/api/proxy', Object.assign({ url }, opts || {})); }
  };
  B.Server = Server;
  if (Server.url()) setTimeout(() => Server.ping(), 2000);

  /* ---------- sauvegardes (débloquées quand le serveur est installé) ---------- */
  const snapshot = () => { const c = JSON.parse(JSON.stringify(S)); delete c.journal; return c; };
  async function backup(manual) {
    if (!Server.ok()) { if (manual) B.toast('Installez d’abord le serveur Bêta sur le NAS (voir ci-dessous)', 'server'); return; }
    try { const r = await Server.post('/api/backup', { at: Date.now(), by: B.user().name, data: snapshot() }); K.backup.last = Date.now(); K.backup.name = r.name; B.save(); B.emit('conn'); if (manual) B.toast('Sauvegarde enregistrée sur le NAS', 'cloudUp'); }
    catch (e) { if (manual) B.toast('Sauvegarde impossible : ' + e.message, 'info'); }
  }
  setInterval(() => { const d = new Date(); if (K.backup.auto && d.getHours() === 3 && Date.now() - (K.backup.last || 0) > 20 * 36e5) backup(false); }, 5 * 6e4);
  B.backup = backup;

  /* ---------- tests de connexion ---------- */
  const set = (k, v) => { K.status[k] = v; B.save(); B.emit('conn'); };
  const err = e => 'err:' + (e && e.message === 'Failed to fetch' ? 'injoignable ou bloqué (CORS)' : (e && e.message) || 'erreur');
  const TESTS = {
    async ha() { if (!B.HA.enabled()) return set('ha', 'err:adresse ou jeton manquant'); try { await B.HA.req('/api/'); B.HA.online = true; B.HA.sync(); set('ha', 'ok'); } catch (e) { set('ha', err(e)); } },
    server: () => Server.ping(),
    async ugreen() { const u = K.ugreen.url || (K.ugreen.ip ? 'http://' + K.ugreen.ip + ':9999' : ''); if (!u) return set('ugreen', 'err:adresse manquante'); try { await fetch(u, { mode: 'no-cors' }); set('ugreen', 'ok'); } catch (e) { set('ugreen', err(e)); } },
    async nextcloud() {
      const u = (K.nextcloud.url || '').replace(/\/+$/, ''); if (!u) return set('nextcloud', 'err:adresse manquante');
      try { const j = Server.ok() ? await Server.proxy(u + '/status.php') : await (await fetch(u + '/status.php')).json(); const st = typeof j.body === 'string' ? JSON.parse(j.body) : j; set('nextcloud', st && st.installed ? 'ok' : 'err:réponse inattendue'); }
      catch (e) { set('nextcloud', Server.ok() ? err(e) : 'err:bloqué par le navigateur — passera par le serveur Bêta'); }
    },
    async plex() { if (!S.settings.plexServer) return set('plex', 'err:adresse manquante'); B.Plex.real = null; B.Plex.error = ''; await B.Plex.load(); set('plex', B.Plex.real ? 'ok' : 'err:' + (B.Plex.error || 'aucune réponse')); },
    async google() { set('google', S.settings.ytClient ? (B.YTM && B.YTM.connected() ? 'ok' : 'warn:ID enregistré, compte non connecté') : 'err:ID client manquant'); },
    async mail() { if (!Server.ok()) return set('mail', 'err:nécessite le serveur Bêta'); try { const r = await Server.post('/api/mail/test', K.mail); set('mail', r.ok ? 'ok' : 'err:' + (r.error || 'refusé')); } catch (e) { set('mail', err(e)); } },
    async weather() { await B.loadWeather(); set('weather', B.WX.ok ? 'ok' : 'err:Open-Meteo injoignable'); }
  };
  B.act('cTest', el => { const k = el.dataset.arg; set(k, 'wait'); TESTS[k](); });

  /* ---------- page ---------- */
  const st = k => { const v = K.status[k] || ''; return v === 'ok' ? ['', 'Connecté'] : v === 'wait' ? ['wait', 'Test…'] : v.startsWith('warn:') ? ['wait', v.slice(5)] : v.startsWith('err:') ? ['off', v.slice(4)] : ['wait', 'Non testé']; };
  const fld = (sec, k, label, v, o) => '<label class="field">' + label + '<input name="' + sec + '.' + k + '" value="' + esc(v == null ? '' : v) + '"' + (o && o.pw ? ' type="password"' : '') + (o && o.ph ? ' placeholder="' + esc(o.ph) + '"' : '') + (o && o.num ? ' inputmode="numeric"' : '') + ' spellcheck="false" autocomplete="off"></label>';
  function card(k, icon, title, sub, fields, extra) {
    const s = st(k);
    return '<div class="ccard tile"><div class="cch">' + B.badge(icon) + '<div><b>' + title + '</b><small>' + sub + '</small></div><span class="tag2 ' + s[0] + '">' + esc(s[1]) + '</span></div>' + fields + '<div class="row" style="gap:8px;margin-top:auto;flex-wrap:wrap"><button type="button" class="btn sm" data-act="cTest" data-arg="' + k + '">' + ico('refresh') + 'Tester</button>' + (extra || '') + '</div></div>';
  }
  RENDER.conn = () => {
    const s = S.settings;
    return '<form class="cgrid scroll" data-submit="cSave">' +
      '<div class="cwarn">' + ico('alert') + '<span><b>Mode test :</b> ces informations sont gardées dans ce navigateur. Une fois le serveur Bêta installé sur le NAS, les mots de passe et jetons y seront déplacés.</span></div>' +
      card('ha', 'home', 'Home Assistant', 'Appareils, caméras, énergie, Verisure, Music Assistant', fld('s', 'haUrl', 'Adresse', s.haUrl, { ph: 'http://192.168.1.10:8123' }) + fld('s', 'haToken', 'Jeton d’accès longue durée', s.haToken, { pw: 1 }), '<button type="button" class="btn sm" data-act="haWizard">' + ico('sparkle') + 'Associer les appareils</button>') +
      card('server', 'nas', 'Serveur Bêta (NAS)', 'Sauvegardes, journal partagé, relais mails / Nextcloud', fld('k', 'server.url', 'Adresse', K.server.url, { ph: 'https://nas.maison:8090' }) + fld('k', 'server.key', 'Clé secrète', K.server.key, { pw: 1 }), '<button type="button" class="btn sm" data-act="cServerHelp">' + ico('info') + 'Installer</button>') +
      card('ugreen', 'nas', 'NAS UGREEN (UGOS Pro)', 'Accès aux fichiers et au tableau de bord', fld('k', 'ugreen.url', 'Adresse UGOS Pro', K.ugreen.url, { ph: 'http://192.168.1.20:9999' }) + '<div class="grid2">' + fld('k', 'ugreen.ip', 'Adresse IP', K.ugreen.ip, { ph: '192.168.1.20' }) + fld('k', 'ugreen.user', 'Utilisateur', K.ugreen.user) + '</div>') +
      card('nextcloud', 'link', 'Nextcloud', 'Fichiers, photos, agenda et contacts', fld('k', 'nextcloud.url', 'Adresse', K.nextcloud.url, { ph: 'https://cloud.maison.fr' }) + '<div class="grid2">' + fld('k', 'nextcloud.user', 'Utilisateur', K.nextcloud.user) + fld('k', 'nextcloud.pass', 'Mot de passe d’application', K.nextcloud.pass, { pw: 1 }) + '</div>') +
      card('mail', 'mail', 'Messagerie', 'Vrais mails et invitations (via le serveur Bêta)', '<div class="grid2">' + fld('k', 'mail.imap', 'Serveur IMAP', K.mail.imap, { ph: 'imap.gmail.com' }) + fld('k', 'mail.port', 'Port', K.mail.port, { num: 1 }) + fld('k', 'mail.user', 'Adresse mail', K.mail.user) + fld('k', 'mail.pass', 'Mot de passe d’application', K.mail.pass, { pw: 1 }) + fld('k', 'mail.smtp', 'Serveur SMTP (envoi)', K.mail.smtp, { ph: 'smtp.gmail.com' }) + fld('k', 'mail.sport', 'Port', K.mail.sport, { num: 1 }) + '</div>') +
      card('plex', 'plex', 'Plex', 'Bibliothèque et lecture sur les TV', fld('s', 'plexServer', 'Adresse du serveur', s.plexServer, { ph: 'http://192.168.1.20:32400' }) + fld('s', 'plexToken', 'Jeton X-Plex-Token', s.plexToken, { pw: 1 }) + fld('s', 'plexUrl', 'Lien « Ouvrir dans Plex »', s.plexUrl, { ph: 'https://app.plex.tv/desktop' })) +
      card('google', 'music', 'Google / YouTube', 'Playlists, titres aimés, recherche', fld('s', 'ytClient', 'ID client OAuth', s.ytClient, { ph: '….apps.googleusercontent.com' }), '<button type="button" class="btn sm" data-act="ytDiag">' + ico('info') + 'Infos</button>') +
      card('weather', 'weather', 'Météo', 'Open-Meteo, sans compte', '<div class="grid2">' + fld('s', 'city', 'Ville', s.city) + fld('s', 'lat', 'Latitude', s.lat) + fld('s', 'lon', 'Longitude', s.lon) + '</div>') +
      '<div class="ccard tile wide2"><div class="cch">' + B.badge('link') + '<div><b>Adresses IP des appareils</b><small>Pense-bête du réseau (box, NAS, caméras, PC…)</small></div></div><div class="iplist">' + K.ips.map((x, i) => '<div class="row"><input class="search" name="ip' + i + 'n" value="' + esc(x.name) + '" placeholder="Nom"><input class="search" name="ip' + i + 'a" value="' + esc(x.ip) + '" placeholder="192.168.1.x"><button type="button" class="sq" data-act="cIpDel" data-arg="' + i + '" aria-label="Retirer">' + ico('trash') + '</button></div>').join('') + '</div><div class="row" style="margin-top:8px"><button type="button" class="btn sm" data-act="cIpAdd">' + ico('plus') + 'Ajouter</button></div></div>' +
      '<div class="ccard tile wide2"><div class="cch">' + B.badge('shield') + '<div><b>Verisure (alarme et serrure)</b><small>Passe par l’intégration officielle Verisure de Home Assistant</small></div></div><p class="muted" style="margin:0;font-size:13px;line-height:1.5">Dans Home Assistant : Paramètres › Appareils › Ajouter une intégration › Verisure. Ajoutez ensuite l’alarme et la serrure dans Bêta OS (Pièces › Gérer › Appareils, types « Alarme » et « Serrure »). Les droits par utilisateur s’appliquent : par défaut seuls les administrateurs commandent la porte du garage.</p></div>' +
      RENDER.cbackup() +
      '<div class="csave"><button class="btn pri">' + ico('check') + 'Enregistrer toutes les connexions</button></div></form>';
  };
  B.act('cSave', el => {
    const f = new FormData(el);
    for (const [k, v] of f.entries()) {
      const [sec, ...p] = k.split('.'), key = p.join('.');
      if (sec === 's') S.settings[key] = ['lat', 'lon'].includes(key) ? parseFloat(v) || S.settings[key] : String(v).trim();
      else if (sec === 'k') { const [a, b] = key.split('.'); K[a][b] = /port$/.test(b) ? +v || K[a][b] : String(v).trim(); }
    }
    K.ips = K.ips.map((x, i) => ({ name: String(f.get('ip' + i + 'n') || '').trim(), ip: String(f.get('ip' + i + 'a') || '').trim() })).filter(x => x.name || x.ip);
    B.save(); B.toast('Connexions enregistrées', 'check'); B.emit('conn');
    if (S.settings.haUrl && S.settings.haToken) { if (B.HA.ws) try { B.HA.ws.close(); } catch (e) { } B.HA.sync(); }
    if (K.server.url) Server.ping();
  });
  B.act('cIpAdd', () => { K.ips.push({ name: '', ip: '' }); B.save(); B.emit('conn'); });
  B.act('cIpDel', el => { K.ips.splice(+el.dataset.arg, 1); B.save(); B.emit('conn'); });
  B.act('cServerHelp', () => B.modal('<h2>' + ico('nas') + 'Installer le serveur Bêta sur le NAS</h2><ol class="steps">' +
    '<li>Copiez le dossier <code>server</code> de Bêta OS sur le NAS (avec le reste de Bêta OS).</li>' +
    '<li>UGOS Pro › <b>Docker</b> › Projet › Créer, choisissez le fichier <code>server/docker-compose.yml</code>.</li>' +
    '<li>Dans ce fichier, changez <code>BETA_KEY</code> (votre clé secrète) puis lancez le projet.</li>' +
    '<li>Bêta OS est alors servi sur <code>http://IP-du-NAS:8090</code> ; ajoutez le reverse proxy https d’UGOS pour l’ouvrir en https.</li>' +
    '<li>Ici, mettez l’adresse et la même clé, puis « Tester ».</li></ol><p class="muted" style="font-size:12.5px;margin:12px 0 0;line-height:1.5">Le serveur garde les sauvegardes (30 jours), le journal partagé entre tous les appareils, et relaie Nextcloud et les mails que le navigateur ne peut pas joindre directement.</p>', 'sm'));

  RENDER.cbackup = () => {
    const ok = Server.ok();
    return '<div class="ccard tile' + (ok ? '' : ' locked') + '"><div class="cch">' + B.badge('download') + '<div><b>Sauvegarde automatique</b><small>' + (ok ? (K.backup.last ? 'Dernière : ' + new Date(K.backup.last).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : 'Pas encore de sauvegarde') : 'Se débloque avec le serveur Bêta') + '</small></div>' + (ok ? '' : ico('lock')) + '</div>' +
      '<label class="row" style="gap:10px;font-size:13.5px"><button type="button" class="sw sm' + (K.backup.auto ? ' on' : '') + '" data-act="cBackupAuto"' + (ok ? '' : ' disabled') + ' aria-label="Automatique"></button>Chaque nuit à 3 h (30 jours gardés)</label>' +
      '<div class="row" style="gap:8px;margin-top:auto"><button type="button" class="btn sm pri" data-act="cBackupNow"' + (ok ? '' : ' disabled') + '>' + ico('cloudUp') + 'Sauvegarder maintenant</button><button type="button" class="btn sm" data-act="cBackupList"' + (ok ? '' : ' disabled') + '>' + ico('history') + 'Restaurer…</button></div></div>';
  };
  B.act('cBackupAuto', el => { K.backup.auto = !K.backup.auto; B.save(); el.classList.toggle('on', K.backup.auto); });
  B.act('cBackupNow', () => backup(true));
  B.act('cBackupList', async () => {
    try { const l = await Server.req('/api/backups'); B.modal('<h2>' + ico('history') + 'Restaurer une sauvegarde</h2><div class="list">' + l.map(b => '<div class="li" style="grid-template-columns:1fr auto"><div><b>' + esc(b.name) + '</b><small>' + Math.round(b.size / 1024) + ' Ko</small></div><button class="btn sm" data-act="cRestore" data-arg="' + esc(b.name) + '">Restaurer</button></div>').join('') + '</div>', 'sm'); }
    catch (e) { B.toast('Liste impossible : ' + e.message, 'info'); }
  });
  B.act('cRestore', async el => {
    if (!confirm('Remplacer la configuration actuelle par « ' + el.dataset.arg + ' » ?')) return;
    try { const j = await Server.req('/api/backup/' + encodeURIComponent(el.dataset.arg)); const keep = S.journal; Object.keys(S).forEach(k => delete S[k]); Object.assign(S, j.data, { journal: keep }); B.save(); setTimeout(() => location.reload(), 300); }
    catch (e) { B.toast('Restauration impossible : ' + e.message, 'info'); }
  });

  B.route('connexions', { title: 'Connexions', bg: BG, render: () => B.side('parametres') + B.header({ id: 'connexions', title: 'Connexions', sub: 'Tous les services de la maison au même endroit', icon: 'link', info: { t: 'infobox', keys: ['conn', 'ha'], items: () => {
    const ks = Object.keys(TESTS), ok = ks.filter(k => K.status[k] === 'ok').length;
    return [{ icon: 'link', v: ok + '/' + ks.length, l: 'Services reliés', cls: 'c' }, { icon: 'homeFill', v: B.HA.wsOk ? 'Temps réel' : B.HA.online ? 'Relié' : 'Démo', l: 'Home Assistant' }, { icon: 'server', v: Server.ok() ? 'En ligne' : 'À installer', l: 'Serveur Bêta', cls: Server.ok() ? 'g' : 'y' }, { icon: 'cloudUp', v: K.backup.last ? F.time(new Date(K.backup.last)) : '—', l: 'Sauvegarde' }];
  } } }) +
    '<section class="card pcard abs" style="' + box([105, 235, 1522, 1012]) + '">' + B.whead('link', 'Connexions', isAdmin() ? '' : '<span class="tag2 wait">' + ico('lock') + 'Lecture seule</span>') + T({ t: 'conn', keys: ['conn'] }) + '</section>' });
  // la sauvegarde s'affiche aussi dans Paramètres
  const sdata0 = RENDER.sdata;
  RENDER.sdata = s => sdata0(s).replace('<div style="display:flex;flex-direction:column;gap:12px;flex:1">', '<div style="display:flex;flex-direction:column;gap:12px;flex:1"><a class="tile" href="#connexions" style="padding:12px 14px;display:flex;align-items:center;gap:12px">' + B.badge('link') + '<div style="flex:1"><b style="font-weight:500">Connexions</b><div class="muted" style="font-size:12.5px">Home Assistant, NAS, Nextcloud, mails, IP…</div></div>' + ico('chevR') + '</a><a class="tile" href="#journal" style="padding:12px 14px;display:flex;align-items:center;gap:12px">' + B.badge('chart') + '<div style="flex:1"><b style="font-weight:500">Journal & habitudes</b><div class="muted" style="font-size:12.5px">Qui fait quoi, suggestions de routines</div></div>' + ico('chevR') + '</a>');
})();

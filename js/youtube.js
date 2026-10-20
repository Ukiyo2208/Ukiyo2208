/* Bêta OS — compte YouTube (playlists, titres aimés, recherche) et enceintes Home Assistant / Music Assistant
   (pour écouter YouTube Music avec votre abonnement, sur vos vraies enceintes). */
(function () {
  const B = window.BOS, { S, esc } = B;
  const Music = B.Music;
  const SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';

  const Y = {
    token: null, exp: 0, res: null, busy: false,
    connected() { return !!(this.token && Date.now() < this.exp); },
    restore() { try { const t = JSON.parse(localStorage.getItem('betaos.yt') || 'null'); if (t && t.exp > Date.now()) { this.token = t.token; this.exp = t.exp; } } catch (e) { } },
    gsi() {
      if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
      return this._g || (this._g = new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.onload = res; s.onerror = () => { this._g = null; rej(new Error('Google inaccessible')); }; document.head.appendChild(s); }));
    },
    /* adresse de retour après la connexion Google : la page elle-même, sans le #… */
    redirectUri() { return location.origin + location.pathname; },
    /* Connexion par redirection (et non par fenêtre pop-up) : sur iPhone, dans Sitecase ou une
       appli, la fenêtre pop-up de Google ne peut pas revenir vers Bêta OS et reste blanche. */
    connect() {
      const cid = S.settings.ytClient;
      if (!cid) return this.setupModal();
      const q = new URLSearchParams({ client_id: cid, redirect_uri: this.redirectUri(), response_type: 'token', scope: SCOPE, include_granted_scopes: 'true', state: 'yt:' + (B.current || 'musique'), prompt: this.token ? 'select_account' : 'consent' });
      B.save();
      location.href = 'https://accounts.google.com/o/oauth2/v2/auth?' + q;
    },
    /* au retour de Google, le jeton arrive dans l'adresse (#access_token=…) */
    fromRedirect() {
      const h = location.hash.slice(1);
      if (!/(^|&)(access_token|error)=/.test(h)) return;
      const p = new URLSearchParams(h), st = p.get('state') || '';
      const back = st.startsWith('yt:') ? st.slice(3) : 'musique';
      sessionStorage.setItem('betaos.unlocked', '1');
      history.replaceState(null, '', location.pathname + location.search + '#' + back);
      if (p.get('error')) { this.pending = 'err:' + p.get('error'); return; }
      this.token = p.get('access_token'); this.exp = Date.now() + (+p.get('expires_in') || 3600) * 1000;
      localStorage.setItem('betaos.yt', JSON.stringify({ token: this.token, exp: this.exp }));
      this.pending = 'ok';
    },
    async api(path) {
      if (!this.connected()) { this.connect(); throw new Error('non connecté'); }
      const r = await fetch('https://www.googleapis.com/youtube/v3/' + path, { headers: { Authorization: 'Bearer ' + this.token } });
      if (r.status === 401) { this.token = null; localStorage.removeItem('betaos.yt'); B.emit('music'); throw new Error('session expirée, reconnectez-vous'); }
      const j = await r.json();
      if (!r.ok) throw new Error((j.error && j.error.message) || 'HTTP ' + r.status);
      return j;
    },
    async importAll() {
      this.busy = true; B.emit('music');
      let n = 0;
      try {
        const pl = await this.api('playlists?part=snippet,contentDetails&mine=true&maxResults=50');
        (pl.items || []).forEach(p => {
          const it = Music.addItem('https://www.youtube.com/playlist?list=' + p.id, { name: p.snippet.title, artist: 'Ma playlist · ' + p.contentDetails.itemCount + ' titres', silent: true });
          if (it) { it.name = p.snippet.title; it.artist = 'Ma playlist · ' + p.contentDetails.itemCount + ' titres'; it.cover = ((p.snippet.thumbnails || {}).medium || {}).url || it.cover; it.account = true; n++; }
        });
        const lk = await this.api('videos?part=snippet&myRating=like&maxResults=40');
        (lk.items || []).forEach(v => {
          const it = Music.addItem('https://www.youtube.com/watch?v=' + v.id, { silent: true });
          if (it) { it.name = v.snippet.title; it.artist = v.snippet.channelTitle.replace(/ - Topic$/, ''); it.cover = ((v.snippet.thumbnails || {}).medium || {}).url || it.cover; it.account = true; it.liked = true; n++; if (!Music.isFav(it.id)) Music.favs().push(it.id); }
        });
        S.ytImported = Date.now(); B.save();
        B.toast(n + ' playlists et titres aimés importés', 'youtube');
      } catch (e) { B.toast('Import YouTube : ' + e.message, 'info'); }
      this.busy = false; B.emit('music');
    },
    async search(q) {
      try {
        const j = await this.api('search?part=snippet&type=video&maxResults=15&q=' + encodeURIComponent(q));
        this.res = (j.items || []).map(v => ({ id: v.id.videoId, title: v.snippet.title.replace(/&#39;/g, '’').replace(/&quot;/g, '"').replace(/&amp;/g, '&'), channel: v.snippet.channelTitle.replace(/ - Topic$/, ''), cover: ((v.snippet.thumbnails || {}).medium || {}).url }));
        this.q = q; B.emit('music');
      } catch (e) { if (e.message !== 'non connecté') B.toast('Recherche YouTube : ' + e.message, 'info'); }
    },
    setupModal() {
      B.modal('<h2>' + ico('youtube') + 'Connecter mon compte YouTube</h2>' +
        '<p style="font-size:14px;line-height:1.55;margin:0 0 12px">Bêta OS peut lire <b>vos playlists</b> (YouTube et YouTube Music), <b>vos titres aimés</b> et faire des <b>recherches</b>. Google demande pour cela un identifiant gratuit, à créer une seule fois :</p>' +
        '<ol class="steps"><li>Ouvrez <b>console.cloud.google.com</b>, créez un projet « Bêta OS ».</li><li>« API et services » › Bibliothèque › activez <b>YouTube Data API v3</b>.</li><li>« Écran de consentement OAuth » : type Externe, ajoutez votre adresse Gmail comme utilisateur test.</li><li>« Identifiants » › Créer › <b>ID client OAuth</b> › Application Web. Dans « Origines JavaScript autorisées » : <code>' + esc(location.origin && location.origin !== 'null' ? location.origin : 'https://…') + '</code><br>Dans « <b>URI de redirection autorisés</b> » : <code>' + esc(Y.redirectUri()) + '</code></li><li>Copiez l’ID client (se termine par <code>.apps.googleusercontent.com</code>) ci-dessous.</li></ol>' +
        '<form data-submit="ytClientSave" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><input class="search" name="cid" required placeholder="123456-abc.apps.googleusercontent.com" value="' + esc(S.settings.ytClient || '') + '"><button class="btn pri">' + ico('check') + 'Connecter</button></form>' +
        '<p class="muted" style="font-size:12.5px;line-height:1.5;margin:12px 0 0">Google exige une adresse en https (ou http://localhost) : ouvrez Bêta OS depuis votre NAS en https. Votre mot de passe n’est jamais vu par Bêta OS. La lecture se fait avec le lecteur officiel YouTube : sur iPhone, la lecture écran éteint reste réservée à YouTube Premium dans l’app YouTube ; pour écouter YouTube Music en continu avec votre abonnement, utilisez l’onglet <b>Enceintes</b> (Music Assistant).</p>', 'sm');
    },

    /* ---------- interface (onglet YouTube) ---------- */
    bar() {
      const c = this.connected();
      return '<form class="addlink" data-submit="ytGo">' + ico('search2') + '<input name="q" placeholder="' + (c ? 'Rechercher sur YouTube ou coller un lien…' : 'Collez un lien YouTube (vidéo ou playlist)…') + '" autocomplete="off" aria-label="Lien ou recherche"><button class="btn pri">' + ico(c ? 'search2' : 'play') + (c ? 'Chercher' : 'Lire') + '</button></form>' +
        '<div class="ytacc">' + ico('youtube') + (c ? '<span>Compte YouTube connecté' + (this.busy ? ' · import…' : '') + '</span><button class="btn sm" data-act="ytImport">' + ico('refresh') + 'Réimporter</button>'
          : '<span>Connectez votre compte pour retrouver vos playlists, vos titres aimés et chercher des morceaux.</span><button class="btn sm pri" data-act="ytConnect">Connecter</button>') + '</div>';
    },
    results() {
      if (!this.res) return '';
      return '<div class="ytres"><div class="row" style="justify-content:space-between"><b>Résultats pour « ' + esc(this.q) + ' »</b><button class="x2" data-act="ytClear" aria-label="Fermer">' + ico('x') + '</button></div><div class="list scroll">' +
        this.res.map(v => '<div class="li"><button class="ic th" data-act="ytPlay" data-arg="' + v.id + '" aria-label="Lire"><img src="' + v.cover + '" alt=""><span class="po">' + ico('play') + '</span></button><div style="min-width:0"><b class="ell">' + esc(v.title) + '</b><small class="ell">' + esc(v.channel) + '</small></div><button class="sq like" data-act="ytLike" data-arg="' + v.id + '" aria-label="J’aime">' + ico('heart') + '</button></div>').join('') + '</div></div>';
    },

    /* ---------- enceintes Home Assistant (Music Assistant) ---------- */
    players() { return Object.keys(B.HA.states || {}).filter(e => e.startsWith('media_player.')); },
    haPanel() {
      if (!B.HA.enabled()) return '<div class="hint2">' + ico('speaker') + '<p>Reliez Home Assistant (Paramètres) pour piloter vos enceintes. Avec l’intégration <b>Music Assistant</b> et votre abonnement <b>YouTube Music</b>, vous écoutez tout votre catalogue, sans publicité, écran éteint, sur les enceintes de la maison — et vous le commandez d’ici.</p></div>';
      const list = this.players(), cur = S.settings.haPlayer || list[0] || '', s = B.HA.states[cur];
      const a = (s && s.attributes) || {}, pic = a.entity_picture ? (a.entity_picture.startsWith('http') ? a.entity_picture : B.HA.cfg().url + a.entity_picture) : '';
      const vol = Math.round((a.volume_level || 0) * 100), playing = s && s.state === 'playing';
      return '<label class="field">Enceinte<select data-change="haMpSel">' + (list.length ? list.map(e => '<option value="' + e + '"' + (e === cur ? ' selected' : '') + '>' + esc((B.HA.states[e].attributes || {}).friendly_name || e) + '</option>').join('') : '<option>Aucun lecteur trouvé</option>') + '</select></label>' +
        (s ? '<div class="haplayer tile">' + (pic ? '<img src="' + esc(pic) + '" alt="">' : '<span class="rlogo" style="width:84px;height:84px">♪</span>') +
          '<div class="nf"><span class="spill">' + ico('speaker') + esc(s.state === 'playing' ? 'En lecture' : s.state === 'paused' ? 'En pause' : s.state) + (a.app_name ? ' · ' + esc(a.app_name) : '') + '</span><b class="ell">' + esc(a.media_title || 'Rien en cours') + '</b><small class="ell">' + esc(a.media_artist || a.media_album_name || '') + '</small>' +
          '<div class="transport"><button data-act="haMp" data-arg="media_previous_track" aria-label="Précédent">' + ico('prev') + '</button><button class="pp" data-act="haMp" data-arg="media_play_pause" aria-label="Lecture/pause">' + ico(playing ? 'pause' : 'play') + '</button><button data-act="haMp" data-arg="media_next_track" aria-label="Suivant">' + ico('next') + '</button></div>' +
          '<div class="volrow">' + ico('volume') + '<input type="range" class="range thin" min="0" max="100" value="' + vol + '" style="--p:' + vol + '%" data-change="haMpVol" aria-label="Volume"><span class="pct">' + vol + '%</span></div></div></div>' : '') +
        '<form class="addlink" data-submit="haMpPlay" style="margin-top:10px">' + ico('search2') + '<input name="q" placeholder="Artiste, titre ou playlist YouTube Music…" autocomplete="off" aria-label="Que jouer ?"><button class="btn pri">' + ico('play') + 'Jouer</button></form>' +
        '<p class="muted" style="font-size:12px;margin:8px 0 0;line-height:1.45">La recherche passe par Music Assistant (fournisseur YouTube Music connecté à votre compte Premium).</p>';
    }
  };
  Y.restore();
  Y.fromRedirect();
  if (Y.pending) setTimeout(() => {
    if (Y.pending === 'ok') { S.music.ltab = 'yt'; B.save(); B.toast('Compte YouTube connecté — import de vos playlists…', 'youtube'); Y.importAll(); }
    else B.toast(Y.pending === 'err:access_denied' ? 'Connexion YouTube annulée ou refusée' : 'Connexion YouTube : ' + Y.pending.slice(4), 'info');
    Y.pending = null;
  }, 600);
  B.YTM = Y;

  /* première connexion par redirection : rappel de l'URI à déclarer chez Google */
  B.act('ytConnect', () => {
    if (!S.settings.ytClient || S.settings.ytRedir === Y.redirectUri()) return Y.connect();
    B.modal('<h2>' + ico('youtube') + 'Dernière étape chez Google</h2><p style="font-size:14px;line-height:1.55;margin:0 0 10px">Pour éviter l’écran blanc sur iPhone, la connexion se fait maintenant en pleine page. Ajoutez cette adresse une fois dans Google Cloud › <b>Clients</b> › Beta-os › <b>URI de redirection autorisés</b>, puis enregistrez :</p>' +
      '<div class="addlink"><input readonly value="' + esc(Y.redirectUri()) + '" onclick="this.select()" aria-label="Adresse à copier"><button class="btn sm" data-act="ytCopy">' + ico('files') + 'Copier</button></div>' +
      '<p class="muted" style="font-size:12.5px;margin:10px 0 14px">Google peut mettre quelques minutes à prendre en compte la modification.</p><div class="row" style="justify-content:flex-end"><button class="btn" data-act="closeModal">Plus tard</button><button class="btn pri" data-act="ytRedirOk">' + ico('check') + 'C’est fait, se connecter</button></div>', 'sm');
  });
  B.act('ytCopy', () => { navigator.clipboard && navigator.clipboard.writeText(Y.redirectUri()).then(() => B.toast('Adresse copiée', 'check'), () => { }); });
  B.act('ytRedirOk', () => { S.settings.ytRedir = Y.redirectUri(); B.save(); B.closeModal(); Y.connect(); });
  B.act('ytImport', () => Y.connected() ? Y.importAll() : Y.connect());
  B.act('ytClientSave', el => { S.settings.ytClient = el.cid.value.trim(); S.settings.ytRedir = Y.redirectUri(); B.save(); B.closeModal(); Y.connect(); });
  B.act('ytClear', () => { Y.res = null; B.emit('music'); });
  B.act('ytGo', el => {
    const q = el.q.value.trim(); if (!q) return;
    if (B.ytParse(q) || /^https?:/i.test(q)) { const it = Music.addItem(q); if (it) { el.q.value = ''; Music.play(it.id); } return; }
    if (!Y.connected()) { B.toast('Connectez votre compte YouTube pour chercher (ou collez un lien)', 'youtube'); return Y.connect(); }
    Y.search(q);
  });
  const fromRes = id => { const v = (Y.res || []).find(x => x.id === id); const it = Music.addItem('https://www.youtube.com/watch?v=' + id, { silent: true }); if (it && v) { it.name = v.title; it.artist = v.channel; it.cover = v.cover; B.save(); } return it; };
  B.act('ytPlay', el => { const it = fromRes(el.dataset.arg); if (it) Music.play(it.id); });
  B.act('ytLike', el => { const it = fromRes(el.dataset.arg); if (it) Music.like(it.id); });
  B.act('haMpSel', el => { S.settings.haPlayer = el.value; B.save(); B.emit('music'); });
  const mp = () => S.settings.haPlayer || Y.players()[0];
  B.act('haMp', el => B.HA.call('media_player', el.dataset.arg, { entity_id: mp() }));
  B.act('haMpVol', el => B.HA.call('media_player', 'volume_set', { entity_id: mp(), volume_level: +el.value / 100 }));
  B.act('haMpPlay', async el => {
    const q = el.q.value.trim(); if (!q || !mp()) return;
    try { await B.HA.req('/api/services/music_assistant/play_media', { entity_id: mp(), media_id: q, enqueue: 'replace' }); }
    catch (e) { await B.HA.call('media_player', 'play_media', { entity_id: mp(), media_content_id: q, media_content_type: 'music' }); }
    el.q.value = ''; B.toast('Lecture de « ' + q + ' » sur l’enceinte', 'speaker');
  });
  B.on('state', d => { if (d.eid === mp()) B.emit('music'); });
})();

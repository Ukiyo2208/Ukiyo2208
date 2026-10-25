/* Bêta home — moteur musique : radios en direct, YouTube (vidéos & playlists), fichiers du NAS / liens audio.
   La lecture continue quand on change de page (application monopage). */
(function () {
  const B = window.BOS, { S, DATA, esc } = B;
  const $ = s => document.querySelector(s);

  if (!S.library) S.library = [];
  if (!S.favsBy) S.favsBy = { [S.user]: (S.favs || ['lofi', 'r-fip']).slice() };
  if (!S.music.pos) S.music.pos = {};

  /* ---------- helpers ---------- */
  function ytParse(ref) {
    ref = String(ref || '').trim();
    const list = (ref.match(/[?&]list=([\w-]+)/) || [])[1];
    const v = (ref.match(/(?:v=|youtu\.be\/|embed\/|shorts\/|live\/)([\w-]{11})/) || [])[1] || (/^[\w-]{11}$/.test(ref) ? ref : null);
    if (!v && !list && /^(PL|OL|RD|UU|FL)[\w-]{10,}$/.test(ref)) return { list: ref };
    if (!v && !list) return null;
    return { v, list };
  }
  const isAudioUrl = u => /^https?:\/\/.+/i.test(u) && !ytParse(u);
  const RF = { 'r-inter': 'franceinter', 'r-info': 'franceinfo', 'r-fip': 'fip', 'r-musique': 'francemusique', 'r-culture': 'franceculture', 'r-mouv': 'mouv' };
  function hash(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h).toString(36); }
  function fmt(t) { t = Math.max(0, Math.floor(t || 0)); const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0'); }

  /* logos des radios : le vrai logo (trouvé en ligne via radio-browser.info, gardé en mémoire),
     sinon un logo dessiné aux couleurs de la station */
  const W = (bg, body) => 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="' + bg + '"/>' + body + '</svg>');
  const T = (y, size, txt, col, w, extra) => '<text x="50" y="' + y + '" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-weight="' + (w || 700) + '" font-size="' + size + '" fill="' + (col || '#fff') + '" ' + (extra || '') + '>' + txt + '</text>';
  const RFX = (bg, name, size) => W(bg, T(42, 15, 'france', '#fff', 400, 'letter-spacing="-.3"') + T(66, size || 25, name, '#fff', 700, 'letter-spacing="-1"'));
  const LOGOS = {
    'r-inter': RFX('#e20134', 'inter', 30),
    'r-info': W('#161b4e', T(58, 19.5, 'franceinfo', '#fff', 700, 'letter-spacing="-.8"') + '<circle cx="88" cy="47" r="2.6" fill="#ff3a3a"/><circle cx="88" cy="56" r="2.6" fill="#ff3a3a"/>'),
    'r-fip': W('#e2007a', T(66, 46, 'fip', '#fff', 800, 'letter-spacing="-2"')),
    'r-musique': RFX('#7b2dff', 'musique', 23),
    'r-culture': RFX('#8b1cff', 'culture', 24),
    'r-mouv': W('#111', T(64, 36, 'mouv’', '#fff', 800, 'letter-spacing="-2"') + '<rect x="18" y="72" width="64" height="5" rx="2.5" fill="#ff2d55"/>'),
    'r-nrj': W('#fff', T(66, 42, 'NRJ', '#e30613', 900, 'font-style="italic" stroke="#111" stroke-width="2.4" paint-order="stroke" letter-spacing="-2"')),
    'r-fg': W('#0b0b0b', T(68, 50, 'FG', '#fff', 900, 'letter-spacing="-3"') + '<circle cx="82" cy="64" r="5" fill="#1f9bff"/>')
  };
  if (!S.radioLogos) S.radioLogos = {};

  function radioLogo(r, size, round) {
    const R = DATA.RADIOS.find(x => x.id === r.id) || r, sz = size || 44;
    const src = S.radioLogos[R.id] || LOGOS[R.id];
    const shape = 'width:' + sz + 'px;height:' + sz + 'px;border-radius:' + (round ? '50%' : Math.round(sz / 4.5) + 'px');
    if (src) return '<span class="rlogo has" style="' + shape + ';background:' + (R.color || '#0a1636') + '"><img src="' + esc(src) + '" alt="' + esc(R.name || '') + '" loading="lazy" onerror="this.remove()"></span>';
    const ini = (R.name || '?').replace(/^France ?/i, 'F').slice(0, 3);
    return '<span class="rlogo" style="' + shape + ';background:radial-gradient(circle at 30% 20%,' + (R.color || '#2f7dff') + ',#0a1636 85%);font-size:' + Math.round(sz / 3.2) + 'px">' + esc(ini) + '</span>';
  }
  /* recherche du vrai logo (une fois par semaine au plus), uniquement s'il est assez grand */
  function findLogos() {
    if (S.radioLogosAt && Date.now() - S.radioLogosAt < 7 * 864e5) return;
    S.radioLogosAt = Date.now();
    const api = 'https://de1.api.radio-browser.info/json/stations/';
    const test = url => new Promise(ok => { if (!url || !/^https:/.test(url)) return ok(false); const i = new Image(); i.onload = () => ok(i.naturalWidth >= 96 && Math.abs(i.naturalWidth / i.naturalHeight - 1) < .5); i.onerror = () => ok(false); i.src = url; });
    DATA.RADIOS.forEach(async r => {
      try {
        let l = await (await fetch(api + 'byurl?url=' + encodeURIComponent(r.ref))).json();
        if (!l.some(x => x.favicon)) l = await (await fetch(api + 'search?countrycode=FR&order=votes&reverse=true&limit=5&name=' + encodeURIComponent(r.name))).json();
        for (const st of l.filter(x => x.favicon)) if (await test(st.favicon)) { S.radioLogos[r.id] = st.favicon; B.save(); B.emit('music'); break; }
      } catch (e) { }
    });
  }
  setTimeout(findLogos, 3000);

  const M = {
    state: 'idle', playing: false, meta: {}, t: 0, dur: 0, yt: null, ytReady: false, ytWant: null, audio: null, liveT: null,

    favs() { if (!S.favsBy[S.user]) S.favsBy[S.user] = []; return S.favsBy[S.user]; },
    isFav(id) { return this.favs().includes(id); },
    like(id) {
      id = id || S.music.src; const f = this.favs(), i = f.indexOf(id);
      if (i >= 0) f.splice(i, 1); else f.unshift(id);
      // un titre YouTube aimé pendant une playlist devient un favori à part entière
      if (i < 0 && this.meta.videoId && this.cur().kind === 'yt' && ytParse(this.cur().ref).list) {
        const it = this.addItem('https://www.youtube.com/watch?v=' + this.meta.videoId, { name: this.meta.title, artist: this.meta.artist, silent: true });
        if (it && !f.includes(it.id)) f.unshift(it.id);
      }
      B.save(); B.emit('music');
      B.toast(i >= 0 ? 'Retiré des favoris' : 'Ajouté à vos favoris', i >= 0 ? 'heart' : 'heartFill');
    },
    sources() {
      return S.playlists.map(p => Object.assign({ group: 'Ambiances' }, p))
        .concat(S.library.map(p => Object.assign({ group: p.kind === 'yt' ? 'YouTube' : 'NAS' }, p)))
        .concat(DATA.RADIOS.map(r => Object.assign({ kind: 'radio', group: 'Radio', artist: 'Radio en direct' }, r)));
    },
    get(id) { return this.sources().find(s => s.id === id); },
    cur() { return this.get(S.music.src) || S.playlists[0]; },
    kindOf(s) { s = s || this.cur(); return s.kind === 'radio' ? 'radio' : ytParse(s.ref) ? 'yt' : 'audio'; },

    /* titre / artiste / pochette du morceau courant */
    info() {
      const s = this.cur(), k = this.kindOf(s), m = this.meta.src === s.id ? this.meta : {};
      const y = k === 'yt' ? ytParse(s.ref) : null;
      return {
        kind: k, id: s.id, station: s.name,
        title: m.title || (k === 'radio' ? s.name : s.name),
        artist: m.artist || (k === 'radio' ? 'En direct' : s.artist || (k === 'yt' ? 'YouTube' : 'Bibliothèque NAS')),
        cover: m.cover || s.cover || (y && y.v ? 'https://i.ytimg.com/vi/' + y.v + '/hqdefault.jpg' : ''),
        live: k === 'radio'
      };
    },

    /* ---------- bibliothèque ---------- */
    addItem(url, o) {
      o = o || {};
      url = String(url || '').trim();
      const y = ytParse(url);
      if (!y && !isAudioUrl(url)) { if (!o.silent) B.toast('Lien non reconnu : collez un lien YouTube ou une adresse de fichier audio', 'info'); return null; }
      const id = (y ? 'y' : 'n') + hash(url);
      let it = S.library.find(x => x.id === id);
      if (!it) {
        it = { id, kind: y ? 'yt' : 'audio', ref: url, name: o.name || (y ? (y.list && !y.v ? 'Playlist YouTube' : 'Vidéo YouTube') : decodeURIComponent(url.split('/').pop().split('?')[0]).replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ')), artist: o.artist || (y ? 'YouTube' : 'NAS'), cover: y && y.v ? 'https://i.ytimg.com/vi/' + y.v + '/hqdefault.jpg' : '', added: Date.now() };
        S.library.unshift(it);
        if (y) this.oembed(it);
        B.save();
      }
      return it;
    },
    removeItem(id) { S.library = S.library.filter(x => x.id !== id); Object.keys(S.favsBy).forEach(u => S.favsBy[u] = S.favsBy[u].filter(x => x !== id)); B.save(); B.emit('music'); },
    async oembed(it) {
      try {
        const r = await fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(it.ref));
        if (!r.ok) return;
        const j = await r.json();
        if (j.title) it.name = j.title; if (j.author_name) it.artist = j.author_name; if (j.thumbnail_url && !it.cover) it.cover = j.thumbnail_url;
        B.save(); B.emit('music');
      } catch (e) { /* hors ligne : on garde le nom provisoire */ }
    },

    /* ---------- lecture ---------- */
    play(id) {
      if (id) S.music.src = id;
      const s = this.cur(), k = this.kindOf(s);
      if (!S.music.power) S.music.power = true;
      B.save();
      this.stopAll();
      this.meta = { src: s.id };
      this.t = 0; this.dur = 0;
      this.state = 'loading'; this.playing = true;
      if (k === 'yt') this.ytLoad(s);
      else this.audioLoad(s, k);
      if (k === 'radio') this.liveMeta();
      this.session();
      B.emit('music');
    },
    audioLoad(s, k) {
      if (!this.audio) {
        this.audio = new Audio();
        this.audio.preload = 'none';
        this.audio.setAttribute('playsinline', '');
        this.audio.addEventListener('playing', () => { this.state = 'playing'; this.playing = true; B.emit('music'); });
        this.audio.addEventListener('pause', () => { if (this.kindOf() !== 'yt') { this.playing = false; this.state = 'paused'; B.emit('music'); } });
        this.audio.addEventListener('timeupdate', () => { this.t = this.audio.currentTime; this.dur = isFinite(this.audio.duration) ? this.audio.duration : 0; });
        this.audio.addEventListener('ended', () => this.step(1));
        this.audio.addEventListener('error', () => { if (this.kindOf() !== 'yt' && this.state !== 'idle') { this.playing = false; this.state = 'error'; B.emit('music'); B.toast('Impossible de lire « ' + this.cur().name + ' » (flux indisponible ou hors ligne)', 'info'); } });
      }
      this.audio.src = s.ref;
      this.audio.volume = S.music.vol / 100; this.audio.muted = !!S.music.mute;
      const pos = S.music.pos[s.id];
      if (k === 'audio' && pos) this.audio.currentTime = pos;
      this.audio.play().catch(() => { this.playing = false; this.state = 'paused'; B.emit('music'); B.toast('Touchez ▶ pour lancer la lecture', 'play'); });
    },
    ytApi() {
      if (window.YT && window.YT.Player) return Promise.resolve();
      if (!this._api) this._api = new Promise(res => {
        const prev = window.onYouTubeIframeAPIReady;
        window.onYouTubeIframeAPIReady = () => { if (prev) prev(); res(); };
        const sc = document.createElement('script'); sc.src = 'https://www.youtube.com/iframe_api'; sc.async = true;
        sc.onerror = () => { this._api = null; if (this.ytWant) B.toast('YouTube inaccessible (connexion ?)', 'info'); };
        document.head.appendChild(sc);
      });
      return this._api;
    },
    ytBox() {
      let b = $('#ytbox');
      if (!b) {
        b = document.createElement('div'); b.id = 'ytbox'; b.className = 'ytbox';
        b.innerHTML = '<div class="ytbar"><span>' + ico('youtube') + 'YouTube</span><button data-act="ytShow" aria-label="Réduire la vidéo">' + ico('chevD') + '</button></div><div class="ytwrap"><div id="ytp"></div></div>' +
          '<div class="ythint">' + ico('volume') + '<span>Touchez la vidéo une fois pour lancer le son<br><small>(règle de sécurité d’iOS / du navigateur)</small></span></div>';
        document.body.appendChild(b);
      }
      return b;
    },
    /* Le lecteur YouTube est créé dès le démarrage : ainsi, toucher ▶ lance la vidéo immédiatement,
       dans le même geste, ce qu'exigent Safari/iOS et Chrome pour autoriser le son. */
    ytInit() {
      if (this.yt || this._init) return this._init;
      this.ytBox();
      this._init = this.ytApi().then(() => new Promise(res => {
        this.yt = new YT.Player('ytp', {
          width: '100%', height: '100%', host: 'https://www.youtube.com',
          playerVars: { playsinline: 1, rel: 0, modestbranding: 1, autoplay: 0, origin: location.origin && location.origin !== 'null' ? location.origin : undefined },
          events: {
            onReady: () => { this.ytReady = true; res(); if (this.ytWant) { const w = this.ytWant; this.ytWant = null; this.ytStart(w); } },
            onStateChange: e => this.ytState(e.data),
            onError: () => { this.playing = false; this.state = 'error'; B.emit('music'); B.toast('Cette vidéo refuse la lecture intégrée — ouvrez-la sur YouTube', 'video'); }
          }
        });
      }));
      return this._init;
    },
    ytState(st) {
      const b = $('#ytbox');
      if (st === 1) {
        this.state = 'playing'; this.playing = true; this.ytMeta();
        if (b && b.classList.contains('needtap')) { b.classList.remove('needtap'); setTimeout(() => b.classList.remove('show'), 2500); }
        clearTimeout(this.ytWatch);
        // le navigateur peut démarrer la vidéo en sourdine : on réactive le son, sinon on demande un toucher
        if (!S.music.mute) { try { this.yt.unMute(); this.yt.setVolume(S.music.vol); } catch (e) { } setTimeout(() => { try { if (this.yt.isMuted() && !S.music.mute) this.needTap(); } catch (e) { } }, 700); }
      }
      else if (st === 2) { this.state = 'paused'; this.playing = false; }
      else if (st === 0) { if (!ytParse(this.cur().ref).list) { delete S.music.pos[S.music.src]; this.step(1); return; } }
      else if (st === 3) this.state = 'loading';
      B.emit('music');
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = this.playing ? 'playing' : 'paused';
    },
    needTap() {
      const b = this.ytBox();
      b.classList.add('show', 'needtap');
      B.toast('Touchez la vidéo pour activer le son', 'volume');
    },
    ytStart(w) {
      const { y, start } = w;
      try {
        if (y.list) this.yt.loadPlaylist({ list: y.list, listType: 'playlist', index: 0, startSeconds: start });
        else this.yt.loadVideoById({ videoId: y.v, startSeconds: start });
        this.yt.setVolume(S.music.vol); if (S.music.mute) this.yt.mute(); else this.yt.unMute();
        this.yt.playVideo();
      } catch (e) { }
      clearTimeout(this.ytWatch);
      // si rien ne démarre (iOS bloque la lecture déclenchée hors de la vidéo), on affiche le lecteur à toucher
      this.ytWatch = setTimeout(() => { if (this.kindOf() === 'yt' && this.state !== 'playing') this.needTap(); }, 3500);
    },
    ytLoad(s) {
      const y = ytParse(s.ref), start = Math.floor(S.music.pos[s.id] || 0);
      if (this.yt && this.ytReady) return this.ytStart({ y, start });
      this.ytWant = { y, start };
      this.ytInit();
    },
    ytMeta() {
      try {
        const d = this.yt.getVideoData();
        if (d && d.title) {
          this.meta = { src: S.music.src, title: d.title, artist: d.author, videoId: d.video_id, cover: 'https://i.ytimg.com/vi/' + d.video_id + '/hqdefault.jpg' };
          const it = S.library.find(x => x.id === S.music.src);
          if (it && !ytParse(it.ref).list && (it.name === 'Vidéo YouTube' || !it.cover)) { it.name = d.title; it.artist = d.author; it.cover = this.meta.cover; B.save(); }
          this.session(); B.emit('music');
        }
      } catch (e) { }
    },
    async liveMeta() {
      clearTimeout(this.liveT);
      const s = this.cur(), slug = RF[s.id];
      if (!slug || this.kindOf() !== 'radio') return;
      try {
        const r = await fetch('https://www.radiofrance.fr/' + slug + '/api/live?webradio=' + slug, { cache: 'no-store' });
        const j = await r.json();
        const now = j.now || j;
        const t = now.firstLine && (now.firstLine.title || now.firstLine), a = now.secondLine && (now.secondLine.title || now.secondLine);
        const v = now.visuals && (now.visuals.card || now.visuals.player);
        if (S.music.src === s.id && (t || a)) { this.meta = { src: s.id, title: String(a || t), artist: a ? String(t) : s.name, cover: v && (v.src || v.webpSrc) || '' }; B.emit('music'); this.session(); }
      } catch (e) { /* titre en direct indisponible : on affiche le nom de la station */ }
      if (this.playing) this.liveT = setTimeout(() => this.liveMeta(), 30000);
    },
    stopAll() {
      if (this.audio) { this.audio.pause(); this.audio.removeAttribute('src'); try { this.audio.load(); } catch (e) { } }
      if (this.yt && this.ytReady) try { this.yt.stopVideo(); } catch (e) { }
      clearTimeout(this.liveT);
    },
    pause() {
      if (this.kindOf() === 'yt') { if (this.yt && this.ytReady) this.yt.pauseVideo(); }
      else if (this.audio) this.audio.pause();
      this.playing = false; this.state = 'paused'; this.savePos(); B.emit('music');
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
    },
    resume() {
      const k = this.kindOf();
      if (k === 'yt' && this.yt && this.ytReady && this.meta.src === S.music.src) { this.yt.playVideo(); this.playing = true; }
      else if (k !== 'yt' && this.audio && this.audio.getAttribute('src') && this.meta.src === S.music.src) { if (k === 'radio') this.audio.src = this.cur().ref; this.audio.play().catch(() => { }); this.playing = true; if (k === 'radio') this.liveMeta(); }
      else return this.play();
      B.emit('music');
    },
    toggle() { this.playing ? this.pause() : this.resume(); },
    step(dir) {
      const k = this.kindOf();
      if (k === 'yt' && this.yt && this.ytReady && ytParse(this.cur().ref).list) { dir > 0 ? this.yt.nextVideo() : this.yt.previousVideo(); return; }
      if (k === 'audio' && this.audio && dir < 0 && this.audio.currentTime > 5) { this.audio.currentTime = 0; return; }
      const grp = this.cur().group || 'Ambiances';
      let list = this.sources().filter(x => x.group === grp);
      const fav = this.favs();
      if (fav.includes(S.music.src)) list = fav.map(id => this.get(id)).filter(Boolean);
      const i = Math.max(0, list.findIndex(x => x.id === S.music.src));
      const n = list[(i + dir + list.length) % list.length];
      if (n) this.play(n.id);
    },
    seek(p) {
      if (!this.dur) return;
      const t = this.dur * p / 100;
      if (this.kindOf() === 'yt' && this.yt) this.yt.seekTo(t, true); else if (this.audio) this.audio.currentTime = t;
      this.t = t;
    },
    vol(v) {
      S.music.vol = v; B.save();
      if (this.audio) this.audio.volume = v / 100;
      if (this.yt && this.ytReady) this.yt.setVolume(v);
    },
    mute(m) {
      S.music.mute = m; B.save();
      if (this.audio) this.audio.muted = m;
      if (this.yt && this.ytReady) m ? this.yt.mute() : this.yt.unMute();
    },
    time() { return this.t; },
    fmt,
    savePos() {
      const k = this.kindOf();
      if (k !== 'radio' && this.t > 5 && (!this.dur || this.t < this.dur - 5)) S.music.pos[S.music.src] = Math.floor(this.t);
      B.save();
    },
    tick() {
      if (!this.playing) return;
      if (this.kindOf() === 'yt' && this.yt && this.ytReady) {
        try { this.t = this.yt.getCurrentTime() || 0; this.dur = this.yt.getDuration() || 0; const d = this.yt.getVideoData(); if (d && d.video_id && d.video_id !== this.meta.videoId) this.ytMeta(); } catch (e) { }
      }
      B.emit('mtime');
      if (Math.floor(this.t) % 5 === 0) this.savePos();
    },
    session() {
      if (!('mediaSession' in navigator)) return;
      const i = this.info();
      // logo Bêta home carré sur l'écran verrouillé, le Centre de contrôle et CarPlay
      const icon = new URL('assets/icon-512.png', location.href).href;
      try { navigator.mediaSession.metadata = new MediaMetadata({ title: i.title, artist: i.artist, album: i.live ? i.station : 'Bêta home', artwork: [{ src: icon, sizes: '512x512', type: 'image/png' }] }); } catch (e) { }
      try {
        navigator.mediaSession.setActionHandler('play', () => this.resume());
        navigator.mediaSession.setActionHandler('pause', () => this.pause());
        navigator.mediaSession.setActionHandler('previoustrack', () => this.step(-1));
        navigator.mediaSession.setActionHandler('nexttrack', () => this.step(1));
      } catch (e) { }
    },
    openExternal() {
      const s = this.cur(), y = ytParse(s.ref);
      const u = y ? (this.meta.videoId ? 'https://www.youtube.com/watch?v=' + this.meta.videoId + (this.t ? '&t=' + Math.floor(this.t) + 's' : '') : s.ref) : s.ref;
      window.open(u, '_blank');
    }
  };
  setInterval(() => M.tick(), 1000);
  // préparation du lecteur YouTube (sans lecture) pour que le premier ▶ soit instantané
  setTimeout(() => M.ytInit(), 1500);
  // en quittant / masquant l'application, on mémorise la position pour reprendre au même endroit
  document.addEventListener('visibilitychange', () => { if (document.hidden) M.savePos(); });
  window.addEventListener('pagehide', () => M.savePos());

  B.Music = M; B.ytParse = ytParse; B.radioLogo = radioLogo;
})();
